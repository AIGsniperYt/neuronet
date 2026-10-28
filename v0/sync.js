import { getAllNodes, addNodes } from "./db.js";

const BACKEND = "https://showcase.invalid";

function getNodeTimestamp(node) {
  return Math.max(
    Number(node?.updatedAt || 0),
    Number(node?.createdAt || 0)
  );
}

function normalizeNode(node) {
  return {
    ...node,
    updatedAt: Number(node?.updatedAt || node?.createdAt || Date.now()),
    createdAt: Number(node?.createdAt || node?.updatedAt || Date.now())
  };
}

export function mergeNodeSets(localNodes = [], cloudNodes = []) {
  const merged = new Map();

  for (const sourceNode of [...localNodes, ...cloudNodes]) {
    if (!sourceNode?.id) continue;

    const node = normalizeNode(sourceNode);
    const existing = merged.get(node.id);

    if (!existing || getNodeTimestamp(node) >= getNodeTimestamp(existing)) {
      merged.set(node.id, node);
    }
  }

  return Array.from(merged.values());
}

export async function fetchCloudNodes() {
  const res = await fetch(`${BACKEND}/api/nodes`, {
    credentials: "include"
  });

  if (!res.ok) {
    throw new Error(`Cloud fetch failed with status ${res.status}`);
  }

  const cloudNodes = await res.json();
  return Array.isArray(cloudNodes) ? cloudNodes : [];
}

export async function syncLocalWithCloud() {
  const [localNodes, cloudNodes] = await Promise.all([
    getAllNodes(),
    fetchCloudNodes()
  ]);

  const mergedNodes = mergeNodeSets(localNodes, cloudNodes);
  await addNodes(mergedNodes);
  await syncToCloud(mergedNodes);

  return mergedNodes;
}

export async function syncToCloud(localNodes) {
  const res = await fetch(`${BACKEND}/api/nodes/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(localNodes)
  });

  if (!res.ok) {
    throw new Error(`Cloud sync failed with status ${res.status}`);
  }

  console.log("Sync to cloud complete");
}

export async function deleteCloudNode(id) {
  const res = await fetch(`${BACKEND}/api/nodes/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!res.ok) {
    throw new Error(`Cloud delete failed with status ${res.status}`);
  }
}
