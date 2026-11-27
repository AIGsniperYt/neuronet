import {
  getAllNodes, getAllQuotes, getAllCues, getAllCards, getAllHeaps,
  getAllDecks, getAllSubjects, getAllTasks, getAllCommitments,
  getSyncOutbox, acknowledgeSyncOperation, saveSyncConflict,
  applyRemoteSyncChanges, getSyncCursor, getSyncState, setSyncState,
  queueSyncSnapshot, getSyncConflicts
} from "./db.js";

const BACKEND = "https://neuronet-backend.onrender.com";
const MAX_PULL_PAGES = 20;
const MAX_PUSH_BODY_BYTES = 360 * 1024;
let activeSync = null;

function emitStatus(status, detail = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("neuronet-sync-status", {
      detail: { status, at: Date.now(), ...detail }
    }));
  }
}

async function post(path, payload = {}) {
  const response = await fetch(BACKEND + "/api/sync/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let result = {};
  try { result = text ? JSON.parse(text) : {}; }
  catch { throw new Error("Cloud sync returned an invalid response (HTTP " + response.status + ")."); }

  if (!response.ok) {
    const error = new Error(result.error || "Cloud sync failed (HTTP " + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function localRecordCount() {
  const collections = await Promise.all([
    getAllNodes(), getAllQuotes(), getAllCues(), getAllCards(),
    getAllHeaps(), getAllDecks(), getAllSubjects(), getAllTasks(), getAllCommitments()
  ]);
  return collections.reduce((count, rows) => count + (rows || []).length, 0);
}

function toWorkerOperation(operation) {
  return {
    operationId: operation.operationId,
    collection: operation.collection,
    recordId: String(operation.recordId),
    type: operation.type,
    baseVersion: Number(operation.baseVersion) || 0,
    ...(operation.type === "upsert" ? { payload: operation.payload } : {})
  };
}

function splitBatches(operations) {
  const batches = [];
  let batch = [];
  let bytes = 2;

  for (const operation of operations) {
    const item = toWorkerOperation(operation);
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (itemBytes > MAX_PUSH_BODY_BYTES) {
      throw new Error("A pending " + operation.collection + " record is too large to synchronise.");
    }
    if (batch.length && (bytes + itemBytes > MAX_PUSH_BODY_BYTES || batch.length >= 100)) {
      batches.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(operation);
    bytes += itemBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function pullChanges() {
  let cursor = await getSyncCursor();
  let pulled = 0;

  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const result = await post("pull", { cursor, limit: 250 });
    const changes = Array.isArray(result.changes) ? result.changes : [];

    if (!changes.length) break;
    await applyRemoteSyncChanges(changes, result.nextCursor);
    pulled += changes.length;
    cursor = Number(result.nextCursor) || cursor;
    if (!result.hasMore) break;
  }
  return pulled;
}

async function pushChanges() {
  let pushed = 0;
  let conflicts = 0;

  for (let pass = 0; pass < 20; pass += 1) {
    const pending = await getSyncOutbox(100);
    if (!pending.length) break;

    const batches = splitBatches(pending);
    let acknowledgedThisPass = 0;

    for (const batch of batches) {
      const result = await post("push", { operations: batch.map(toWorkerOperation) });
      const results = Array.isArray(result.results) ? result.results : [];
      const byId = new Map(results.map((entry) => [entry.operationId, entry]));

      for (const operation of batch) {
        const outcome = byId.get(operation.operationId);
        if (!outcome) throw new Error("Cloud sync did not acknowledge an operation; it remains safely queued.");

        if (outcome.status === "applied" || outcome.status === "duplicate") {
          await acknowledgeSyncOperation(operation, outcome);
          acknowledgedThisPass += 1;
          pushed += 1;
          continue;
        }

        if (outcome.status === "conflict") {
          await saveSyncConflict({
            collection: operation.collection,
            recordId: String(operation.recordId),
            localOperation: operation,
            remoteChange: {
              type: outcome.currentDeleted ? "delete" : "upsert",
              payload: outcome.currentPayload || null,
              version: Number(outcome.currentVersion) || 0,
              revision: Number(outcome.currentRevision) || 0,
              operationId: outcome.currentOperationId || null
            }
          });
          conflicts += 1;
          continue;
        }

        if (outcome.status === "idempotency_mismatch") {
          await saveSyncConflict({
            collection: operation.collection,
            recordId: String(operation.recordId),
            localOperation: operation,
            remoteChange: { type: "idempotency_mismatch", version: Number(operation.baseVersion) || 0, revision: 0 }
          });
          conflicts += 1;
          continue;
        }

        throw new Error("Unexpected cloud sync result: " + String(outcome.status));
      }
    }

    if (!acknowledgedThisPass) break;
  }
  return { pushed, conflicts };
}

async function runSync(user) {
  if (!user || !user.id) {
    throw new Error("The signed-in account has no stable account ID. Please sign in again.");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    emitStatus("offline");
    throw new Error("You're offline. Your changes remain saved on this device.");
  }

  const accountId = String(user.id);
  const activeAccount = await getSyncState("activeAccount");
  if (activeAccount && activeAccount !== accountId) {
    throw new Error("This device's local NeuroNet data is associated with a different Google account. Sign back into that account before synchronising.");
  }
  if (!activeAccount) await setSyncState("activeAccount", accountId);

  emitStatus("syncing");
  const cloud = await post("bootstrap");
  const initialized = await getSyncState("initialized:" + accountId);

  if (!initialized && await localRecordCount() > 0) {
    // Existing local databases predate the outbox. Seed them once without
    // touching the journal or device-only preferences.
    await queueSyncSnapshot();
  }

  // Pull first: identical records can adopt cloud versions; differing edits
  // are preserved as conflicts instead of silently overwriting one another.
  const pulledBefore = await pullChanges();
  const pushed = await pushChanges();
  const pulledAfter = await pullChanges();

  await setSyncState("initialized:" + accountId, true);

  const remaining = await getSyncOutbox(100);
  const conflicts = await getSyncConflicts();
  const summary = {
    pulled: pulledBefore + pulledAfter,
    pushed: pushed.pushed,
    conflicts: conflicts.length,
    pending: remaining.length,
    cloudRevision: Number(cloud.revision) || 0
  };

  emitStatus(summary.conflicts ? "conflict" : summary.pending ? "pending" : "synced", summary);
  return summary;
}

export function syncNow(user = (typeof window !== "undefined" ? window.currentUser : null)) {
  if (activeSync) return activeSync;
  activeSync = runSync(user)
    .catch((error) => {
      emitStatus("error", { message: error && error.message ? error.message : "Cloud sync failed." });
      throw error;
    })
    .finally(() => { activeSync = null; });
  return activeSync;
}

export const syncLocalWithCloud = syncNow;
export const syncToCloud = syncNow;
