"use client";

/**
 * Offline submission queue for weak-network resilience.
 *
 * When an expense or leave-request submission fails because the network is
 * down (fetch TypeError / navigator.onLine false), the submission is stored
 * in IndexedDB (Blob-capable, survives reloads) and replayed automatically
 * when connectivity returns. Every queued submission carries a
 * client-generated clientRequestId; the API uses it to make replays
 * idempotent, so a retry can never create a duplicate.
 *
 * UX truthfulness: queued items are VISIBLE (pending-sync banner via
 * useOfflineQueue) — nothing is silently retried behind the user's back.
 */

export type QueuedSubmissionKind = "expense" | "leave_request";

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
};

type QueueListener = (items: QueuedSubmission[]) => void;

const DB_NAME = "crew-hub-offline-queue";
const DB_VERSION = 1;
const STORE = "submissions";
/** Items older than this are dropped on load — stale submissions (e.g. an
 * expense queued two days ago) need human review, not silent replay. */
export const MAX_QUEUE_AGE_MS = 48 * 60 * 60 * 1000;

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

async function readAll(): Promise<QueuedSubmission[]> {
  const items = await withStore<QueuedSubmission[]>("readonly", (store) =>
    store.getAll() as IDBRequest<QueuedSubmission[]>
  );
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

async function notify(): Promise<void> {
  if (listeners.size === 0) return;
  const items = await readAll().catch(() => []);
  for (const listener of listeners) {
    listener(items);
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

export async function enqueueSubmission(input: {
  id: string;
  kind: QueuedSubmissionKind;
  url: string;
  encoding: "json" | "form";
  fields: Record<string, string>;
  files?: QueuedFile[];
}): Promise<void> {
  const item: QueuedSubmission = {
    ...input,
    files: input.files ?? [],
    createdAt: Date.now(),
    attempts: 0,
    lastError: null
  };
  await withStore("readwrite", (store) => store.put(item));
  await notify();
}

export async function removeSubmission(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
  await notify();
}

export async function listSubmissions(): Promise<QueuedSubmission[]> {
  return readAll();
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
 * Replays all queued submissions in order. Success or a definitive server
 * rejection (4xx — the server saw it and said no) removes the item; network
 * failures keep it queued for the next attempt. Returns the number of items
 * that left the queue.
 */
export async function replayQueue(): Promise<number> {
  if (replaying) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  replaying = true;
  let settled = 0;

  try {
    const items = await readAll();
    for (const item of items) {
      if (Date.now() - item.createdAt > MAX_QUEUE_AGE_MS) {
        await removeSubmission(item.id);
        continue;
      }

      try {
        const { body, headers } = buildRequest(item);
        const response = await fetch(item.url, { method: "POST", body, headers });

        if (response.ok || (response.status >= 400 && response.status < 500)) {
          /* Delivered (2xx, incl. idempotent 200 replays) or definitively
           * rejected (4xx) — either way the queue's job is done. */
          await removeSubmission(item.id);
          settled += 1;
        } else {
          item.attempts += 1;
          item.lastError = `HTTP ${response.status}`;
          await withStore("readwrite", (store) => store.put(item));
        }
      } catch (error) {
        item.attempts += 1;
        item.lastError = error instanceof Error ? error.message : String(error);
        await withStore("readwrite", (store) => store.put(item));
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
  void readAll().then((items) => listener(items)).catch(() => listener([]));

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
