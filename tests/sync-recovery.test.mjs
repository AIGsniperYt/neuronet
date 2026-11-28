import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

globalThis.window = {
  DEMO_MODE: true,
  APP_VERSION: "sync-recovery-tests"
};
globalThis.document = {
  dispatchEvent() {}
};

const db = await import("../src/db.js");

async function openTestDatabase() {
  await db.initDB();
  return "neuronet-" + window.APP_VERSION;
}

async function waitForRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateOutboxRecord(databaseName, recordId, patch) {
  const connection = await waitForRequest(indexedDB.open(databaseName, 19));
  try {
    await new Promise((resolve, reject) => {
      const tx = connection.transaction("syncOutbox", "readwrite");
      const store = tx.objectStore("syncOutbox");
      const key = "nodes\u001f" + recordId;
      const request = store.get(key);
      request.onsuccess = () => {
        assert.ok(request.result, "expected a pending operation for " + recordId);
        store.put({ ...request.result, ...patch });
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    connection.close();
  }
}

async function injectLegacyLocalNode(databaseName, record) {
  const connection = await waitForRequest(indexedDB.open(databaseName, 19));
  try {
    await new Promise((resolve, reject) => {
      const tx = connection.transaction("nodes", "readwrite");
      tx.objectStore("nodes").put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    connection.close();
  }
}

async function syncNode(id, text, options = {}) {
  return db.addNode({
    id,
    type: "definition",
    text,
    subject: "Biology",
    ...options
  });
}

test("IndexedDB snapshot recovery stages safely, preserves local changes and rejects stale pages", async () => {
  const databaseName = await openTestDatabase();
  const compactedAt = Date.now();

  // A row acknowledged by the cloud should be removed if it is absent from a
  // later complete snapshot (the server has compacted its deletion marker).
  await syncNode("synced-and-removed", "Old local row");
  let queued = await db.getSyncOutbox(100);
  await db.acknowledgeSyncOperation(
    queued.find((operation) => operation.recordId === "synced-and-removed"),
    { version: 1, revision: 1 }
  );

  // A locally modified row whose remote version differs must become a
  // conflict, not be overwritten by snapshot recovery.
  await syncNode("edit-conflict", "Initial");
  queued = await db.getSyncOutbox(100);
  await db.acknowledgeSyncOperation(
    queued.find((operation) => operation.recordId === "edit-conflict"),
    { version: 1, revision: 2 }
  );
  await syncNode("edit-conflict", "Local edit");

  // An identical pending create should adopt its cloud version and clear its
  // outbox entry because no conflicting content exists.
  const identical = await syncNode("identical-pending", "Same content");

  // This represents a pre-outbox local row from an older NeuroNet release.
  await injectLegacyLocalNode(databaseName, {
    id: "legacy-untracked",
    type: "definition",
    text: "Legacy local record",
    subject: "Biology"
  });

  // Offline edits and deletes should remain pending (not become conflicts)
  // when the cloud record is still at the exact version this device knows.
  await syncNode("offline-edit", "Cloud base");
  queued = await db.getSyncOutbox(100);
  await db.acknowledgeSyncOperation(
    queued.find((operation) => operation.recordId === "offline-edit"),
    { version: 3, revision: 3 }
  );
  await syncNode("offline-edit", "Local offline edit");

  await syncNode("offline-delete", "Delete this offline");
  queued = await db.getSyncOutbox(100);
  await db.acknowledgeSyncOperation(
    queued.find((operation) => operation.recordId === "offline-delete"),
    { version: 2, revision: 4 }
  );
  await db.deleteNode("offline-delete");

  // A new local create remains safe to upload after snapshot recovery.
  await syncNode("new-local-create", "Keep this local record");

  // This old unacknowledged create could otherwise resurrect a compacted
  // deletion, so simulate an outbox row that predates the retained baseline.
  await syncNode("old-ambiguous-create", "Do not silently resurrect");
  await updateOutboxRecord(databaseName, "old-ambiguous-create", {
    queuedAt: compactedAt - 5000,
    firstQueuedAt: compactedAt - 5000
  });

  const remoteRecords = [
    {
      collection: "nodes",
      recordId: "edit-conflict",
      payload: { id: "edit-conflict", type: "definition", text: "Remote edit", subject: "Biology" },
      version: 2,
      revision: 12,
      updatedAt: Date.now()
    },
    {
      collection: "nodes",
      recordId: "identical-pending",
      payload: identical,
      version: 4,
      revision: 11,
      updatedAt: Date.now()
    },
    {
      collection: "nodes",
      recordId: "remote-only",
      payload: { id: "remote-only", type: "definition", text: "From the cloud", subject: "Biology" },
      version: 3,
      revision: 9,
      updatedAt: Date.now()
    },
    {
      collection: "nodes",
      recordId: "offline-edit",
      payload: { id: "offline-edit", type: "definition", text: "Cloud base", subject: "Biology" },
      version: 3,
      revision: 3,
      updatedAt: Date.now()
    },
    {
      collection: "nodes",
      recordId: "offline-delete",
      payload: { id: "offline-delete", type: "definition", text: "Delete this offline", subject: "Biology" },
      version: 2,
      revision: 4,
      updatedAt: Date.now()
    }
  ];

  // An interrupted download must not alter live records or the pull cursor.
  await db.beginSyncSnapshot("snapshot-incomplete-0001", 10);
  await db.stageSyncSnapshotPage("snapshot-incomplete-0001", remoteRecords.slice(0, 1));
  assert.equal(
    (await db.getAllNodes()).some((record) => record.id === "remote-only"),
    false
  );
  assert.equal(await db.getSyncCursor(), 0);

  // A replacement session invalidates the old staging area and its token.
  await db.beginSyncSnapshot("snapshot-complete-0002", 10);
  await assert.rejects(
    db.stageSyncSnapshotPage("snapshot-incomplete-0001", remoteRecords),
    /aborted|active snapshot/i
  );

  // Staging remains separate from live records until all pages are present.
  await db.stageSyncSnapshotPage("snapshot-complete-0002", remoteRecords);
  assert.equal(
    (await db.getAllNodes()).some((record) => record.id === "remote-only"),
    false
  );

  const summary = await db.completeSyncSnapshot(
    "snapshot-complete-0002",
    10,
    compactedAt
  );

  assert.equal(summary.revision, 10);
  assert.equal(summary.recordCount, 5);
  assert.equal(summary.removed, 1);
  assert.equal(summary.queuedOrphans, 1);
  assert.equal(summary.conflicts, 2);

  const localNodes = await db.getAllNodes();
  const byId = new Map(localNodes.map((record) => [record.id, record]));
  assert.equal(byId.has("synced-and-removed"), false);
  assert.equal(byId.get("edit-conflict").text, "Local edit");
  assert.equal(byId.get("offline-edit").text, "Local offline edit");
  assert.equal(byId.has("offline-delete"), false);
  assert.equal(byId.get("identical-pending").text, "Same content");
  assert.equal(byId.get("remote-only").text, "From the cloud");
  assert.equal(byId.get("new-local-create").text, "Keep this local record");
  assert.equal(byId.get("old-ambiguous-create").text, "Do not silently resurrect");
  assert.equal(byId.has("legacy-untracked"), true);

  const outbox = await db.getSyncOutbox(100);
  const outboxIds = new Set(outbox.map((operation) => operation.recordId));
  assert.equal(outboxIds.has("identical-pending"), false);
  assert.equal(outboxIds.has("new-local-create"), true);
  assert.equal(outboxIds.has("offline-edit"), true);
  assert.equal(outboxIds.has("offline-delete"), true);
  assert.equal(outbox.find((operation) => operation.recordId === "offline-delete")?.type, "delete");
  assert.equal(outboxIds.has("legacy-untracked"), true);

  const conflicts = await db.getSyncConflicts();
  const conflictIds = new Set(conflicts.map((conflict) => conflict.recordId));
  assert.equal(conflictIds.has("edit-conflict"), true);
  assert.equal(conflictIds.has("offline-edit"), false);
  assert.equal(conflictIds.has("offline-delete"), false);
  assert.equal(conflictIds.has("old-ambiguous-create"), true);

  assert.equal(await db.getSyncCursor(), 10);
  assert.equal(await db.getSyncState("activeSnapshot"), null);

  // Replaying a change older than a version already present in the snapshot
  // must not roll that record back, even though the cursor advances.
  await db.applyRemoteSyncChanges([{
    revision: 11,
    collection: "nodes",
    recordId: "remote-only",
    version: 2,
    operationId: "older-remote-operation",
    type: "upsert",
    payload: { id: "remote-only", type: "definition", text: "Older state", subject: "Biology" }
  }], 11);
  assert.equal(
    (await db.getAllNodes()).find((record) => record.id === "remote-only").text,
    "From the cloud"
  );
  assert.equal(await db.getSyncCursor(), 11);

  // A genuinely newer server revision is applied normally.
  await db.applyRemoteSyncChanges([{
    revision: 12,
    collection: "nodes",
    recordId: "remote-only",
    version: 5,
    operationId: "newer-remote-operation",
    type: "upsert",
    payload: { id: "remote-only", type: "definition", text: "Latest state", subject: "Biology" }
  }], 12);
  assert.equal(
    (await db.getAllNodes()).find((record) => record.id === "remote-only").text,
    "Latest state"
  );
  assert.equal(await db.getSyncCursor(), 12);
});

test("IndexedDB sync lease serialises tabs and expires safely", async () => {
  await openTestDatabase();
  assert.equal(await db.acquireSyncLock("tab-one"), true);
  assert.equal(await db.acquireSyncLock("tab-two"), false);
  assert.equal(await db.renewSyncLock("tab-one"), true);
  assert.equal(await db.releaseSyncLock("tab-one"), true);
  assert.equal(await db.acquireSyncLock("tab-two"), true);
  assert.equal(await db.releaseSyncLock("tab-one"), false);
  assert.equal(await db.releaseSyncLock("tab-two"), true);
});
