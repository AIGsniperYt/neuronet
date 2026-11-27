import {
  getAllNodes, getAllQuotes, getAllCues, getAllCards, getAllHeaps,
  getAllDecks, getAllSubjects, getAllTasks, getAllCommitments,
  getSyncOutbox, acknowledgeSyncOperation, saveSyncConflict,
  applyRemoteSyncChanges, getSyncCursor, getSyncState, setSyncState,
  queueSyncSnapshot, getSyncConflicts,
  beginSyncSnapshot, stageSyncSnapshotPage, completeSyncSnapshot,
  acquireSyncLock, renewSyncLock, releaseSyncLock
} from "./db.js";

const BACKEND = "https://neuronet-backend.onrender.com";
const MAX_PULL_PAGES = 20;
const MAX_PUSH_BODY_BYTES = 360 * 1024;
const SYNC_LOCK_OWNER = crypto.randomUUID();
let activeSync = null;

function emitStatus(status, detail = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("neuronet-sync-status", {
      detail: { status, at: Date.now(), ...detail }
    }));
  }
}

async function post(path, payload = {}) {
  if (!await renewSyncLock(SYNC_LOCK_OWNER)) {
    throw new Error("Cloud sync lost its browser-tab lock. Your local changes remain safe; retry sync.");
  }
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
    firstQueuedAt: Number(operation.firstQueuedAt || operation.queuedAt) || Date.now(),
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
    if (result.resetRequired) {
      const error = new Error("Cloud change history has been compacted; this device needs a fresh snapshot.");
      error.resetRequired = true;
      error.baselineRevision = Number(result.baselineRevision) || 0;
      throw error;
    }
    const changes = Array.isArray(result.changes) ? result.changes : [];

    if (!changes.length) break;
    await applyRemoteSyncChanges(changes, result.nextCursor);
    pulled += changes.length;
    cursor = Number(result.nextCursor) || cursor;
    if (!result.hasMore) break;
  }
  return pulled;
}


async function restoreSnapshot() {
  emitStatus("snapshotting");
  const snapshot = await post("snapshot/start");
  if (!snapshot.snapshotId || !Number.isSafeInteger(Number(snapshot.revision)) || Number(snapshot.revision) < 0) {
    throw new Error("Cloud sync returned invalid snapshot metadata.");
  }

  await beginSyncSnapshot(snapshot.snapshotId, Number(snapshot.revision));
  let cursor = {};
  let pages = 0;
  let received = 0;
  let finished = false;

  try {
    while (pages < 10000) {
      const page = await post("snapshot/page", {
        snapshotId: snapshot.snapshotId,
        cursor,
        limit: 200
      });
      if (page.snapshotId !== snapshot.snapshotId ||
          Number(page.revision) !== Number(snapshot.revision) ||
          !Array.isArray(page.records)) {
        throw new Error("Cloud snapshot page did not match the active snapshot.");
      }

      await stageSyncSnapshotPage(snapshot.snapshotId, page.records);
      received += page.records.length;
      pages += 1;
      emitStatus("snapshotting", { pages, received, expected: Number(snapshot.recordCount) || null });

      if (!page.hasMore) {
        finished = true;
        break;
      }
      if (!page.nextCursor || typeof page.nextCursor.collection !== "string" ||
          typeof page.nextCursor.recordId !== "string") {
        throw new Error("Cloud snapshot pagination ended unexpectedly.");
      }
      cursor = page.nextCursor;
    }

    if (!finished) throw new Error("Cloud snapshot exceeded the maximum recovery page count.");
    const summary = await completeSyncSnapshot(
      snapshot.snapshotId,
      Number(snapshot.revision),
      Number(snapshot.lastCompactedAt) || 0
    );
    try {
      await post("snapshot/finish", { snapshotId: snapshot.snapshotId });
    } catch {
      // Snapshot leases expire automatically; a failed cleanup request must
      // not undo a locally committed snapshot.
    }
    return { ...summary, pages, received };
  } catch (error) {
    try {
      await post("snapshot/finish", { snapshotId: snapshot.snapshotId });
    } catch {
      // An abandoned lease is bounded by its server-side expiry.
    }
    throw error;
  }
}

async function pullWithSnapshotRecovery() {
  let pulled = 0;

  // Another device may compact again while this device is downloading or
  // reconciling its snapshot. Retry a bounded number of complete baselines
  // rather than failing after the first reset race.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return pulled + await pullChanges();
    } catch (error) {
      if (!error?.resetRequired) throw error;
      const snapshot = await restoreSnapshot();
      pulled += Number(snapshot?.recordCount || 0);
    }
  }

  throw new Error(
    "Cloud history is changing faster than this device can recover. Your local data remains safe; retry synchronisation shortly."
  );
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
              operationId: outcome.currentOperationId || null,
              reason: outcome.reason || null
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

async function runSyncUnlocked(user) {
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
  let snapshot = null;
  const localCursor = await getSyncCursor();
  if (localCursor < Number(cloud.baselineRevision || 0)) {
    snapshot = await restoreSnapshot();
  }

  const pulledBefore = await pullWithSnapshotRecovery();
  const pushed = await pushChanges();
  const pulledAfter = await pullWithSnapshotRecovery();

  await setSyncState("initialized:" + accountId, true);

  const remaining = await getSyncOutbox(100);
  const conflicts = await getSyncConflicts();
  const summary = {
    pulled: pulledBefore + pulledAfter,
    pushed: pushed.pushed,
    conflicts: conflicts.length,
    pending: remaining.length,
    cloudRevision: Number(cloud.revision) || 0,
    snapshotRestored: !!snapshot,
    snapshotRecords: Number(snapshot?.recordCount || 0)
  };

  emitStatus(summary.conflicts ? "conflict" : summary.pending ? "pending" : "synced", summary);
  return summary;
}


async function runSync(user) {
  const acquired = await acquireSyncLock(SYNC_LOCK_OWNER);
  if (!acquired) {
    emitStatus("busy");
    return { busy: true, pulled: 0, pushed: 0, conflicts: 0, pending: 0 };
  }

  try {
    return await runSyncUnlocked(user);
  } finally {
    try {
      await releaseSyncLock(SYNC_LOCK_OWNER);
    } catch {
      // A stale lock has a bounded expiry and cannot invalidate local data.
    }
  }
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
