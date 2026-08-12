"use client";

/**
 * Offline submission queue for weak-network resilience.
 *
 * When an expense or leave-request submission fails because the network is
 * down (fetch TypeError / navigator.onLine false), the submission is stored
 * in IndexedDB (Blob-capable, survives reloads) and replayed automatically
 * when connectivity returns.
 *
 * Exactly-once (OFFLINE-01): every logical submission carries a single
 * client-generated clientRequestId (its `id`). The id is created BEFORE the
 * first network attempt and reused on every replay, so even if the server
 * commits a request whose response is then lost, the retry carries the same
 * id and the API returns the already-created row instead of duplicating.
 *
 * Account binding (OFFLINE-02): every queued item records the authenticated
 * identity (ownerUserId / ownerOrgId) that created it. On a shared browser an
 * item is only ever displayed or replayed for the same identity; items that
 * belong to a different signed-in user are quarantined (hidden + never
 * transmitted) rather than leaked or silently deleted.
 *
 * UX truthfulness: queued items are VISIBLE (pending-sync banner via
 * useOfflineQueue). Nothing is silently retried behind the user's back, and
 * nothing is silently dropped: a definitive server rejection (4xx) becomes a
 * visible `failed` state and an item older than MAX_QUEUE_AGE_MS becomes a
 * visible `stale` state — both require an explicit user action (Retry/Remove).
 */

export type QueuedSubmissionKind = "expense" | "leave_request";

/**
 * Fired on `window` after a queued submission successfully replays to the
 * server (detail: `{ kind }`). Pages listen for this to invalidate their
 * query caches — otherwise a synced expense/leave request disappears from the
 * offline banner but doesn't appear in the (still-fresh) list, which reads as
 * the app having lost the submission.
 */
export const SUBMISSION_SYNCED_EVENT = "crew-hub:submission-synced";

export type SubmissionSyncedDetail = { kind: QueuedSubmissionKind };

/**
 * Lifecycle of a queued submission:
 *  - pending:     waiting to transmit (default); auto-replayed when online.
 *  - failed:      the server saw it and rejected it (4xx); carries the error.
 *                 Never auto-retried — needs the user to Retry or Remove.
 *  - stale:       older than MAX_QUEUE_AGE_MS; needs human review, not silent
 *                 replay. Never auto-retried — needs Retry or Remove.
 *  - quarantined: created by a different signed-in identity; hidden from the
 *                 current user and never transmitted. Not deleted.
 */
export type QueuedSubmissionStatus = "pending" | "failed" | "stale" | "quarantined";

export type QueuedFile = {
  field: string;
  name: string;
  type: string;
  blob: Blob;
};

export type QueuedSubmission = {
  /** Also used as clientRequestId — one logical submission, one id. */
  id: string;
  kind: QueuedSubmissionKind;
  url: string;
  /** "json" posts fields as a JSON body; "form" rebuilds FormData. */
  encoding: "json" | "form";
  fields: Record<string, string>;
  files: QueuedFile[];
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Immutable identity that created this submission (OFFLINE-02). */
  ownerUserId: string;
  ownerOrgId: string;
  /** Visible lifecycle state (OFFLINE-02 — no silent drops). */
  status: QueuedSubmissionStatus;
  /** HTTP status of the last definitive server rejection, when failed. */
  failedStatus: number | null;
};

/** Identity of the currently authenticated user, threaded in at enqueue and
 * replay time so the queue can bind and gate items per account. */
export type QueueIdentity = {
  userId: string;
  orgId: string;
};

type QueueListener = (items: QueuedSubmission[]) => void;

const DB_NAME = "crew-hub-offline-queue";
const DB_VERSION = 1;
const STORE = "submissions";
/** Items older than this become a visible `stale` state — stale submissions
 * (e.g. an expense queued two days ago) need human review, not silent
 * replay. They are NOT deleted. */
export const MAX_QUEUE_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Generates the single clientRequestId for a logical submission. Called
 * BEFORE the first network attempt so the very first request and every replay
 * carry the same id — the basis of exactly-once delivery (OFFLINE-01).
 */
export function createSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Non-secure fallback for environments without crypto.randomUUID.
  const hex = (n: number) => Math.floor(n).toString(16).padStart(2, "0");
  const bytes = Array.from({ length: 16 }, () => hex(Math.random() * 256));
  bytes[6] = ((Number.parseInt(bytes[6], 16) & 0x0f) | 0x40).toString(16).padStart(2, "0");
  bytes[8] = ((Number.parseInt(bytes[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${bytes.slice(0, 4).join("")}-${bytes.slice(4, 6).join("")}-${bytes
    .slice(6, 8)
    .join("")}-${bytes.slice(8, 10).join("")}-${bytes.slice(10, 16).join("")}`;
}

/* ── Pure decision logic (unit-tested without IndexedDB) ─────────────── */

/**
 * True when a queued item belongs to the given authenticated identity. Both
 * the user and the org must match — an item is only ever shown or replayed
 * under the exact account that created it (OFFLINE-02).
 */
export function ownsSubmission(
  item: Pick<QueuedSubmission, "ownerUserId" | "ownerOrgId">,
  identity: QueueIdentity | null
): boolean {
  if (!identity) return false;
  return item.ownerUserId === identity.userId && item.ownerOrgId === identity.orgId;
}

export type ReplayDisposition =
  | "transmit" // ok to send to the server
  | "quarantine" // belongs to a different identity — hide, never send
  | "stale" // too old — needs user review, do not send
  | "skip"; // already failed/stale/quarantined — leave for user action

/**
 * Decides what should happen to an item BEFORE a network attempt, given the
 * current identity and clock. Pure — no IO. This is the gate that prevents
 * account-mismatched or stale items from ever being transmitted.
 */
export function decideReplayDisposition(
  item: Pick<QueuedSubmission, "ownerUserId" | "ownerOrgId" | "createdAt" | "status">,
  identity: QueueIdentity | null,
  now: number,
  maxAgeMs: number = MAX_QUEUE_AGE_MS
): ReplayDisposition {
  if (!ownsSubmission(item, identity)) return "quarantine";
  if (item.status === "failed" || item.status === "stale" || item.status === "quarantined") {
    return "skip";
  }
  if (now - item.createdAt > maxAgeMs) return "stale";
  return "transmit";
}

/**
 * Maps an HTTP response to the item's next visible status after a transmit
 * attempt. Pure. 2xx (incl. idempotent replays) and 4xx are both definitive
 * — the queue drops the row on success and surfaces a visible `failed` state
 * on rejection (never a silent delete). 5xx leaves the item pending to retry.
 */
export function dispositionFromResponse(status: number):
  | { outcome: "done" }
  | { outcome: "failed"; failedStatus: number }
  | { outcome: "retry" } {
  if (status >= 200 && status < 300) return { outcome: "done" };
  if (status >= 400 && status < 500) return { outcome: "failed", failedStatus: status };
  return { outcome: "retry" };
}

/* ── IndexedDB plumbing ──────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const listeners = new Set<QueueListener>();
let replaying = false;
let initialized = false;
/** Current authenticated identity, kept in module scope so subscribers,
 * auto-replay (online/interval) and the banner all gate against the same
 * account. Set by setQueueIdentity() when the client mounts. */
let currentIdentity: QueueIdentity | null = null;

async function readAllRaw(): Promise<QueuedSubmission[]> {
  const items = await withStore<QueuedSubmission[]>("readonly", (store) =>
    store.getAll() as IDBRequest<QueuedSubmission[]>
  );
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Reads the queue and reconciles each item against the current identity and
 * clock: mismatched items become `quarantined` and over-age `pending` items
 * become `stale`. Reconciliation is persisted so the visible state is stable
 * and account-switch cleanup is durable (not just a render-time filter).
 */
async function readAll(): Promise<QueuedSubmission[]> {
  const items = await readAllRaw();
  const now = Date.now();
  const reconciled: QueuedSubmission[] = [];

  for (const item of items) {
    let next = item;

    if (!ownsSubmission(item, currentIdentity)) {
      if (item.status !== "quarantined") {
        next = { ...item, status: "quarantined" };
        await withStore("readwrite", (store) => store.put(next)).catch(() => undefined);
      }
    } else if (item.status === "quarantined") {
      // Owner signed back in — restore to pending (or keep prior terminal state
      // if it was failed/stale, which quarantine never overwrites here).
      next = { ...item, status: "pending" };
      await withStore("readwrite", (store) => store.put(next)).catch(() => undefined);
    } else if (item.status === "pending" && now - item.createdAt > MAX_QUEUE_AGE_MS) {
      next = { ...item, status: "stale" };
      await withStore("readwrite", (store) => store.put(next)).catch(() => undefined);
    }

    reconciled.push(next);
  }

  return reconciled;
}

/** Items the current user is allowed to see: theirs, never quarantined. */
function visibleFor(items: QueuedSubmission[], identity: QueueIdentity | null): QueuedSubmission[] {
  return items.filter((item) => ownsSubmission(item, identity) && item.status !== "quarantined");
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const items = await readAll().catch(() => []);
  const visible = visibleFor(items, currentIdentity);
  for (const listener of listeners) {
    listener(visible);
  }
}

/** True when the failure is a connectivity problem (worth queueing), as
 * opposed to a server rejection (validation/auth) the user must fix. */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError;
}

/** Splits a built FormData into the queue's storable shape. */
export function splitFormData(formData: FormData): {
  fields: Record<string, string>;
  files: QueuedFile[];
} {
  const fields: Record<string, string> = {};
  const files: QueuedFile[] = [];

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
    } else {
      files.push({ field: key, name: value.name, type: value.type, blob: value });
    }
  }

  return { fields, files };
}

/**
 * Registers the currently authenticated identity. Called by the offline-queue
 * hook when a client mounts. On an account switch this triggers a reconcile so
 * the previous user's items are quarantined (hidden, not deleted) and the new
 * user only ever sees and replays their own.
 */
export function setQueueIdentity(identity: QueueIdentity | null): void {
  const changed =
    currentIdentity?.userId !== identity?.userId || currentIdentity?.orgId !== identity?.orgId;
  currentIdentity = identity;
  if (changed) {
    void notify();
  }
}

export async function enqueueSubmission(input: {
  id: string;
  kind: QueuedSubmissionKind;
  url: string;
  encoding: "json" | "form";
  fields: Record<string, string>;
  files?: QueuedFile[];
  /** Authenticated identity that owns this submission (OFFLINE-02). */
  owner: QueueIdentity;
}): Promise<void> {
  const item: QueuedSubmission = {
    id: input.id,
    kind: input.kind,
    url: input.url,
    encoding: input.encoding,
    fields: input.fields,
    files: input.files ?? [],
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
    ownerUserId: input.owner.userId,
    ownerOrgId: input.owner.orgId,
    status: "pending",
    failedStatus: null
  };
  await withStore("readwrite", (store) => store.put(item));
  await notify();
}

export async function removeSubmission(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
  await notify();
}

/**
 * Moves a visible failed/stale item back to `pending` so the user can retry
 * it explicitly. Only the owning identity may do this.
 */
export async function retrySubmission(id: string): Promise<void> {
  const item = await withStore<QueuedSubmission | undefined>("readonly", (store) =>
    store.get(id) as IDBRequest<QueuedSubmission | undefined>
  );
  if (!item || !ownsSubmission(item, currentIdentity)) {
    return;
  }
  const next: QueuedSubmission = { ...item, status: "pending", lastError: null, failedStatus: null };
  await withStore("readwrite", (store) => store.put(next));
  await notify();
  void replayQueue();
}

/** Lists the current identity's visible items (excludes quarantined). */
export async function listSubmissions(): Promise<QueuedSubmission[]> {
  const items = await readAll();
  return visibleFor(items, currentIdentity);
}

function buildRequest(item: QueuedSubmission): { body: BodyInit; headers?: HeadersInit } {
  if (item.encoding === "json") {
    return {
      body: JSON.stringify({ ...item.fields, clientRequestId: item.id }),
      headers: { "Content-Type": "application/json" }
    };
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(item.fields)) {
    formData.append(key, value);
  }
  formData.append("clientRequestId", item.id);
  for (const file of item.files) {
    formData.append(file.field, new File([file.blob], file.name, { type: file.type }));
  }
  return { body: formData };
}

/**
 * Replays queued submissions in order, gated by identity and age. Each item's
 * disposition is decided by the pure decideReplayDisposition():
 *  - quarantine → marked quarantined (different account), never transmitted.
 *  - stale      → marked stale (over-age), surfaced for user action.
 *  - skip       → already failed/stale/quarantined; left for user action.
 *  - transmit   → sent; a 2xx (incl. idempotent replay) removes it, a 4xx
 *                 becomes a visible `failed` state, a 5xx/network error keeps
 *                 it pending for the next attempt.
 * Nothing is ever silently deleted. Returns the count that left the queue.
 */
export async function replayQueue(): Promise<number> {
  if (replaying) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  replaying = true;
  let settled = 0;

  try {
    const items = await readAllRaw();
    for (const item of items) {
      const disposition = decideReplayDisposition(item, currentIdentity, Date.now());

      if (disposition === "skip") {
        continue;
      }

      if (disposition === "quarantine") {
        if (item.status !== "quarantined") {
          await withStore("readwrite", (store) => store.put({ ...item, status: "quarantined" }));
        }
        continue;
      }

      if (disposition === "stale") {
        await withStore("readwrite", (store) => store.put({ ...item, status: "stale" }));
        continue;
      }

      try {
        const { body, headers } = buildRequest(item);
        const response = await fetch(item.url, { method: "POST", body, headers });
        const outcome = dispositionFromResponse(response.status);

        if (outcome.outcome === "done") {
          await removeSubmission(item.id);
          settled += 1;
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent<SubmissionSyncedDetail>(SUBMISSION_SYNCED_EVENT, {
                detail: { kind: item.kind }
              })
            );
          }
        } else if (outcome.outcome === "failed") {
          /* The server saw it and said no (4xx). Surface a VISIBLE failed
           * state with the error — never a silent delete. */
          await withStore("readwrite", (store) =>
            store.put({
              ...item,
              status: "failed",
              attempts: item.attempts + 1,
              failedStatus: outcome.failedStatus,
              lastError: `HTTP ${outcome.failedStatus}`
            })
          );
        } else {
          // 5xx — transient; keep pending and retry later.
          await withStore("readwrite", (store) =>
            store.put({
              ...item,
              attempts: item.attempts + 1,
              lastError: `HTTP ${response.status}`
            })
          );
        }
      } catch (error) {
        await withStore("readwrite", (store) =>
          store.put({
            ...item,
            attempts: item.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error)
          })
        );
        if (isNetworkFailure(error)) {
          break; // still offline — stop burning the queue
        }
      }
    }
  } finally {
    replaying = false;
    await notify();
  }

  return settled;
}

export function subscribeToQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  void readAll()
    .then((items) => listener(visibleFor(items, currentIdentity)))
    .catch(() => listener([]));

  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    window.addEventListener("online", () => void replayQueue());
    /* Periodic retry for connections that flap without firing online events */
    window.setInterval(() => void replayQueue(), 60_000);
    void replayQueue();
  }

  return () => {
    listeners.delete(listener);
  };
}
