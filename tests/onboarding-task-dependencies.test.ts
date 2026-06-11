import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findReblockableTasks,
  findUnlockableTasks
} from "../lib/onboarding/task-dependencies";
import { validateTaskDependencies } from "../lib/onboarding/validation";

type QResult = { data: unknown; error: unknown };
type UpdateCall = { table: string; payload: Record<string, unknown> };
type InsertCall = { table: string; payload: unknown };

const { getAuthenticatedSessionMock, createNotificationMock, logAuditMock, fromFn, tableQueues, updateCalls, insertCalls } =
  vi.hoisted(() => {
    const tableQueues: Record<string, QResult[]> = {};
    const updateCalls: UpdateCall[] = [];
    const insertCalls: InsertCall[] = [];

    function dequeue(table: string): QResult {
      const queue = tableQueues[table];
      if (!queue || queue.length === 0) {
        return { data: null, error: null };
      }
      return queue.shift()!;
    }

    function chain(table: string): Record<string, unknown> {
      const obj: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "is", "not", "order", "limit"]) {
        obj[method] = (..._args: unknown[]) => obj;
      }
      obj.maybeSingle = () => Promise.resolve(dequeue(table));
      obj.single = () => Promise.resolve(dequeue(table));
      obj.update = (payload: Record<string, unknown>) => {
        updateCalls.push({ table, payload });
        return obj;
      };
      obj.insert = (payload: unknown) => {
        insertCalls.push({ table, payload });
        return obj;
      };
      obj.then = (resolve?: (value: QResult) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(dequeue(table)).then(resolve, reject);
      return obj;
    }

    return {
      getAuthenticatedSessionMock: vi.fn(),
      createNotificationMock: vi.fn(async () => undefined),
      logAuditMock: vi.fn().mockResolvedValue(undefined),
      fromFn: (table: string) => chain(table),
      tableQueues,
      updateCalls,
      insertCalls
    };
  });

function enqueue(table: string, ...results: QResult[]) {
  if (!tableQueues[table]) tableQueues[table] = [];
  tableQueues[table].push(...results);
}

vi.mock("server-only", () => ({}));

vi.mock("../lib/auth/session", () => ({
  getAuthenticatedSession: getAuthenticatedSessionMock
}));

vi.mock("../lib/supabase/service-role", () => ({
  createSupabaseServiceRoleClient: () => ({ from: fromFn })
}));

vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({ from: fromFn })
}));

vi.mock("../lib/audit", () => ({
  logAudit: logAuditMock,
  logAuditBatch: vi.fn().mockResolvedValue(undefined),
  AUDIT_REDACTED: "[redacted]",
  diffAuditValues: (oldRecord: Record<string, unknown>, newRecord: Record<string, unknown>) => ({
    oldValue: oldRecord,
    newValue: newRecord,
    changedFields: Object.keys(newRecord)
  })
}));

vi.mock("../lib/notifications/service", () => ({
  createNotification: createNotificationMock,
  createBulkNotifications: vi.fn(async () => undefined)
}));

const ORG = "00000000-0000-4000-a000-000000000001";
const HR = "00000000-0000-4000-a000-000000000002";
const EMP = "00000000-0000-4000-a000-000000000003";
const INSTANCE = "00000000-0000-4000-a000-000000000010";
const TEMPLATE = "00000000-0000-4000-a000-000000000011";
const TASK_A = "00000000-0000-4000-a000-0000000000a1";
const TASK_B = "00000000-0000-4000-a000-0000000000b2";
const TASK_C = "00000000-0000-4000-a000-0000000000c3";

const hrSession = { profile: { id: HR, org_id: ORG, roles: ["HR_ADMIN"] } };
const employeeSession = { profile: { id: EMP, org_id: ORG, roles: ["EMPLOYEE"] } };

function resetMocks() {
  vi.clearAllMocks();
  for (const key of Object.keys(tableQueues)) delete tableQueues[key];
  updateCalls.length = 0;
  insertCalls.length = 0;
}

describe("validateTaskDependencies", () => {
  it("accepts tasks without dependencies", () => {
    expect(validateTaskDependencies([{}, {}, {}])).toEqual({ ok: true });
  });

  it("accepts a valid dependency chain", () => {
    const result = validateTaskDependencies([
      {},
      { dependsOnTaskIndexes: [0] },
      { dependsOnTaskIndexes: [0, 1] }
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("rejects out-of-range dependency indexes", () => {
    const result = validateTaskDependencies([{}, { dependsOnTaskIndexes: [5] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist");
    }
  });

  it("rejects self-referencing dependencies", () => {
    const result = validateTaskDependencies([{}, { dependsOnTaskIndexes: [1] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cannot depend on itself");
    }
  });

  it("rejects direct and indirect cycles", () => {
    const direct = validateTaskDependencies([
      { dependsOnTaskIndexes: [1] },
      { dependsOnTaskIndexes: [0] }
    ]);
    expect(direct.ok).toBe(false);

    const indirect = validateTaskDependencies([
      { dependsOnTaskIndexes: [2] },
      { dependsOnTaskIndexes: [0] },
      { dependsOnTaskIndexes: [1] }
    ]);
    expect(indirect.ok).toBe(false);
    if (!indirect.ok) {
      expect(indirect.message).toContain("cycle");
    }
  });
});

describe("dependency unlock/re-block helpers", () => {
  const baseTask = { assigned_to: EMP, title: "Task" };

  it("unlocks blocked tasks only when every prerequisite is completed", () => {
    const tasks = [
      { ...baseTask, id: TASK_A, status: "completed", depends_on_task_ids: [] },
      { ...baseTask, id: TASK_B, status: "blocked", depends_on_task_ids: [TASK_A] },
      { ...baseTask, id: TASK_C, status: "blocked", depends_on_task_ids: [TASK_A, TASK_B] }
    ];

    const unlockable = findUnlockableTasks(tasks);
    expect(unlockable.map((task) => task.id)).toEqual([TASK_B]);
  });

  it("leaves blocked tasks without recorded prerequisites alone", () => {
    const tasks = [
      { ...baseTask, id: TASK_A, status: "blocked", depends_on_task_ids: [] },
      { ...baseTask, id: TASK_B, status: "blocked", depends_on_task_ids: null }
    ];

    expect(findUnlockableTasks(tasks)).toEqual([]);
  });

  it("re-blocks only pending direct dependents of a reopened task", () => {
    const tasks = [
      { ...baseTask, id: TASK_A, status: "pending", depends_on_task_ids: [] },
      { ...baseTask, id: TASK_B, status: "pending", depends_on_task_ids: [TASK_A] },
      { ...baseTask, id: TASK_C, status: "in_progress", depends_on_task_ids: [TASK_A] }
    ];

    const reblockable = findReblockableTasks(tasks, TASK_A);
    expect(reblockable.map((task) => task.id)).toEqual([TASK_B]);
  });
});

describe("POST /api/v1/onboarding/templates — dependency validation", () => {
  beforeEach(resetMocks);

  async function importRoute() {
    return await import("../app/api/v1/onboarding/templates/route");
  }

  function post(body: Record<string, unknown>) {
    return new Request("http://localhost/api/v1/onboarding/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("rejects a template whose task dependencies form a cycle", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);

    const { POST } = await importRoute();
    const res = await POST(
      post({
        name: "Cyclic",
        tasks: [
          { title: "A", category: "setup", dependsOnTaskIndexes: [1] },
          { title: "B", category: "setup", dependsOnTaskIndexes: [0] }
        ]
      })
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("cycle");
    expect(insertCalls).toEqual([]);
  });

  it("rejects a template with out-of-range dependency indexes", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);

    const { POST } = await importRoute();
    const res = await POST(
      post({
        name: "Out of range",
        tasks: [
          { title: "A", category: "setup" },
          { title: "B", category: "setup", dependsOnTaskIndexes: [7] }
        ]
      })
    );
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("does not exist");
  });

  it("accepts a valid dependency chain and echoes dependsOnTaskIndexes", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);

    enqueue("onboarding_templates", {
      data: {
        id: TEMPLATE,
        name: "Valid chain",
        type: "onboarding",
        country_code: null,
        department: null,
        tasks: [
          { taskId: TASK_A, title: "A", description: "", category: "setup" },
          {
            taskId: TASK_B,
            title: "B",
            description: "",
            category: "setup",
            dependsOnTaskIndexes: [0]
          }
        ],
        created_at: "2026-06-11T00:00:00.000Z",
        updated_at: "2026-06-11T00:00:00.000Z"
      },
      error: null
    });

    const { POST } = await importRoute();
    const res = await POST(
      post({
        name: "Valid chain",
        tasks: [
          { title: "A", category: "setup" },
          { title: "B", category: "setup", dependsOnTaskIndexes: [0] }
        ]
      })
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.template.tasks[1].dependsOnTaskIndexes).toEqual([0]);

    const insertedTasks = (insertCalls[0]?.payload as { tasks: Record<string, unknown>[] }).tasks;
    expect(insertedTasks[1]?.dependsOnTaskIndexes).toEqual([0]);
    expect(insertedTasks[0]?.dependsOnTaskIndexes).toBeUndefined();
  });
});

describe("POST tasks/[taskId]/complete — dependency enforcement and unlock", () => {
  beforeEach(resetMocks);

  async function importRoute() {
    return await import(
      "../app/api/v1/onboarding/instances/[instanceId]/tasks/[taskId]/complete/route"
    );
  }

  function post(action: "complete" | "undo") {
    return new Request(
      `http://localhost/api/v1/onboarding/instances/${INSTANCE}/tasks/${TASK_B}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      }
    );
  }

  function context(taskId: string) {
    return { params: Promise.resolve({ instanceId: INSTANCE, taskId }) };
  }

  const activeInstance = {
    data: { id: INSTANCE, employee_id: EMP, status: "active", type: "onboarding" },
    error: null
  };

  it("rejects completing a blocked task whose prerequisites are incomplete", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(employeeSession);

    // Task fetch (parallel with instance fetch)
    enqueue("onboarding_tasks", {
      data: {
        id: TASK_B,
        instance_id: INSTANCE,
        title: "Order laptop",
        task_type: "manual",
        status: "blocked",
        assigned_to: EMP,
        completed_by: null,
        depends_on_task_ids: [TASK_A]
      },
      error: null
    });
    enqueue("onboarding_instances", activeInstance);
    // Prerequisite check
    enqueue("onboarding_tasks", {
      data: [{ id: TASK_A, title: "Sign contract", status: "pending" }],
      error: null
    });

    const { POST } = await importRoute();
    const res = await POST(post("complete"), context(TASK_B));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("DEPENDENCIES_NOT_MET");
    expect(json.error.message).toContain("Sign contract");
    expect(updateCalls).toEqual([]);
  });

  it("allows completion once prerequisites are completed", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(employeeSession);

    enqueue("onboarding_tasks", {
      data: {
        id: TASK_B,
        instance_id: INSTANCE,
        title: "Order laptop",
        task_type: "manual",
        status: "blocked",
        assigned_to: EMP,
        completed_by: null,
        depends_on_task_ids: [TASK_A]
      },
      error: null
    });
    enqueue("onboarding_instances", activeInstance);
    // Prerequisite check — completed
    enqueue("onboarding_tasks", {
      data: [{ id: TASK_A, title: "Sign contract", status: "completed" }],
      error: null
    });
    // Completion update
    enqueue("onboarding_tasks", { data: null, error: null });
    // allTasks fetch (one task still pending so the instance stays active)
    enqueue("onboarding_tasks", {
      data: [
        { id: TASK_A, status: "completed", track: "employee", title: "Sign contract", assigned_to: EMP, depends_on_task_ids: [] },
        { id: TASK_B, status: "completed", track: "employee", title: "Order laptop", assigned_to: EMP, depends_on_task_ids: [TASK_A] },
        { id: TASK_C, status: "pending", track: "operations", title: "Create accounts", assigned_to: HR, depends_on_task_ids: [] }
      ],
      error: null
    });

    const { POST } = await importRoute();
    const res = await POST(post("complete"), context(TASK_B));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.action).toBe("complete");
    expect(updateCalls[0]?.payload.status).toBe("completed");
  });

  it("flips dependents from blocked to pending, notifies and audits, when the last prerequisite completes", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(employeeSession);

    // Task being completed (TASK_B, no prerequisites)
    enqueue("onboarding_tasks", {
      data: {
        id: TASK_B,
        instance_id: INSTANCE,
        title: "Sign contract",
        task_type: "manual",
        status: "pending",
        assigned_to: EMP,
        completed_by: null,
        depends_on_task_ids: []
      },
      error: null
    });
    enqueue("onboarding_instances", activeInstance);
    // Completion update
    enqueue("onboarding_tasks", { data: null, error: null });
    // allTasks fetch: TASK_C blocked on [TASK_B] (now completed),
    // TASK_A blocked on [TASK_B, TASK_C] (still unmet)
    enqueue("onboarding_tasks", {
      data: [
        { id: TASK_B, status: "completed", track: "employee", title: "Sign contract", assigned_to: EMP, depends_on_task_ids: [] },
        { id: TASK_C, status: "blocked", track: "operations", title: "Create accounts", assigned_to: HR, depends_on_task_ids: [TASK_B] },
        { id: TASK_A, status: "blocked", track: "employee", title: "Set up laptop", assigned_to: EMP, depends_on_task_ids: [TASK_B, TASK_C] }
      ],
      error: null
    });
    // Unlock update for TASK_C
    enqueue("onboarding_tasks", { data: null, error: null });

    const { POST } = await importRoute();
    const res = await POST(post("complete"), context(TASK_B));

    expect(res.status).toBe(200);

    const statusUpdates = updateCalls.filter((call) => call.table === "onboarding_tasks");
    expect(statusUpdates[0]?.payload.status).toBe("completed");
    // Exactly one unlock — TASK_C; TASK_A still has an unmet prerequisite
    const unlockUpdates = statusUpdates.filter((call) => call.payload.status === "pending");
    expect(unlockUpdates).toHaveLength(1);

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HR,
        title: expect.stringContaining("Create accounts"),
        link: `/onboarding/${INSTANCE}`
      })
    );

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "updated",
        tableName: "onboarding_tasks",
        recordId: TASK_C,
        oldValue: { status: "blocked" },
        newValue: { status: "pending" }
      })
    );
  });

  it("re-blocks pending dependents when a completed prerequisite is undone", async () => {
    getAuthenticatedSessionMock.mockResolvedValueOnce(hrSession);

    enqueue("onboarding_tasks", {
      data: {
        id: TASK_B,
        instance_id: INSTANCE,
        title: "Sign contract",
        task_type: "manual",
        status: "completed",
        assigned_to: EMP,
        completed_by: EMP,
        depends_on_task_ids: []
      },
      error: null
    });
    enqueue("onboarding_instances", activeInstance);
    // Undo update
    enqueue("onboarding_tasks", { data: null, error: null });
    // allTasks fetch: TASK_C pending and dependent on TASK_B
    enqueue("onboarding_tasks", {
      data: [
        { id: TASK_B, status: "pending", track: "employee", title: "Sign contract", assigned_to: EMP, depends_on_task_ids: [] },
        { id: TASK_C, status: "pending", track: "operations", title: "Create accounts", assigned_to: HR, depends_on_task_ids: [TASK_B] }
      ],
      error: null
    });
    // Re-block update
    enqueue("onboarding_tasks", { data: null, error: null });

    const { POST } = await importRoute();
    const res = await POST(post("undo"), context(TASK_B));

    expect(res.status).toBe(200);

    const reblockUpdates = updateCalls.filter(
      (call) => call.table === "onboarding_tasks" && call.payload.status === "blocked"
    );
    expect(reblockUpdates).toHaveLength(1);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "updated",
        tableName: "onboarding_tasks",
        recordId: TASK_C,
        oldValue: { status: "pending" },
        newValue: { status: "blocked" }
      })
    );
  });
});

describe("createOnboardingInstance — dependency mapping", () => {
  beforeEach(resetMocks);

  const EMPLOYEE = { id: EMP, fullName: "Test Employee" };

  function makeCreateInstanceMock(insertedTaskIds: string[]) {
    const taskInserts: unknown[] = [];
    const dependencyUpdates: { payload: Record<string, unknown>; taskId: string | null }[] = [];

    const client = {
      from(table: string) {
        if (table === "onboarding_instances") {
          return {
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: INSTANCE,
                      employee_id: EMP,
                      template_id: TEMPLATE,
                      type: "onboarding",
                      status: "active",
                      started_at: "2026-06-11T00:00:00.000Z",
                      completed_at: null
                    },
                    error: null
                  })
              })
            }),
            update: () => {
              const chain = {
                eq: () => chain,
                then: (resolve?: (value: QResult) => unknown) =>
                  Promise.resolve({ data: null, error: null }).then(resolve)
              };
              return chain;
            }
          };
        }

        // onboarding_tasks
        return {
          insert: (rows: unknown[]) => {
            taskInserts.push(rows);
            return {
              select: () => ({
                then: (resolve?: (value: QResult) => unknown) =>
                  Promise.resolve({
                    data: rows.map((row, index) => ({
                      id: insertedTaskIds[index],
                      task_type: (row as Record<string, unknown>).task_type,
                      document_id: (row as Record<string, unknown>).document_id
                    })),
                    error: null
                  }).then(resolve)
              })
            };
          },
          update: (payload: Record<string, unknown>) => {
            const entry = { payload, taskId: null as string | null };
            dependencyUpdates.push(entry);
            const chain = {
              eq: (column: string, value: string) => {
                if (column === "id") entry.taskId = value;
                return chain;
              },
              then: (resolve?: (value: QResult) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve)
            };
            return chain;
          }
        };
      }
    };

    return { client, taskInserts, dependencyUpdates };
  }

  it("inserts dependent tasks as blocked and maps indexes to inserted uuids", async () => {
    const { createOnboardingInstance } = await import("../lib/onboarding/create-instance");
    const { client, taskInserts, dependencyUpdates } = makeCreateInstanceMock([
      TASK_A,
      TASK_B,
      TASK_C
    ]);

    await createOnboardingInstance({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      orgId: ORG,
      employee: EMPLOYEE,
      template: {
        id: TEMPLATE,
        name: "With deps",
        type: "onboarding",
        tasks: [
          { title: "A", category: "setup" },
          { title: "B", category: "setup", dependsOnTaskIndexes: [0] },
          { title: "C", category: "setup", depends_on_task_indexes: [0, 1] }
        ]
      }
    });

    const insertedRows = taskInserts[0] as Record<string, unknown>[];
    expect(insertedRows.map((row) => row.status)).toEqual(["pending", "blocked", "blocked"]);

    expect(dependencyUpdates).toHaveLength(2);
    expect(dependencyUpdates[0]).toMatchObject({
      taskId: TASK_B,
      payload: { depends_on_task_ids: [TASK_A] }
    });
    expect(dependencyUpdates[1]).toMatchObject({
      taskId: TASK_C,
      payload: { depends_on_task_ids: [TASK_A, TASK_B] }
    });
  });

  it("ignores dependencies entirely when the stored graph is invalid (cycle)", async () => {
    const { createOnboardingInstance } = await import("../lib/onboarding/create-instance");
    const { client, taskInserts, dependencyUpdates } = makeCreateInstanceMock([TASK_A, TASK_B]);

    await createOnboardingInstance({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      orgId: ORG,
      employee: EMPLOYEE,
      template: {
        id: TEMPLATE,
        name: "Cyclic legacy",
        type: "onboarding",
        tasks: [
          { title: "A", category: "setup", dependsOnTaskIndexes: [1] },
          { title: "B", category: "setup", dependsOnTaskIndexes: [0] }
        ]
      }
    });

    const insertedRows = taskInserts[0] as Record<string, unknown>[];
    expect(insertedRows.map((row) => row.status)).toEqual(["pending", "pending"]);
    expect(dependencyUpdates).toEqual([]);
  });
});
