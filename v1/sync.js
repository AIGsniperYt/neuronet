import { getAllNodes, addNodes, getAllQuotes, addQuotes } from "./db.js";

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

export async function fetchCloudQuotes() {
  const res = await fetch(`${BACKEND}/api/nodes/quotes`, {
    credentials: "include"
  });

  if (!res.ok) {
    throw new Error(`Cloud quote fetch failed with status ${res.status}`);
  }

  const cloudQuotes = await res.json();
  return Array.isArray(cloudQuotes) ? cloudQuotes : [];
}

export async function syncLocalWithCloud() {
  const [localNodes, cloudNodes, localQuotes, cloudQuotes] = await Promise.all([
    getAllNodes(),
    fetchCloudNodes(),
    getAllQuotes(),
    fetchCloudQuotes()
  ]);

  const mergedNodes = mergeNodeSets(localNodes, cloudNodes);
  const mergedQuotes = mergeNodeSets(localQuotes, cloudQuotes);
  await addNodes(mergedNodes);
  await addQuotes(mergedQuotes);
  await syncToCloud(mergedNodes, mergedQuotes);

  return { nodes: mergedNodes, quotes: mergedQuotes };
}

export async function syncToCloud(localNodes, localQuotes = []) {
  const [nodesRes, quotesRes] = await Promise.all([
    fetch(`${BACKEND}/api/nodes/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(localNodes)
    }),
    fetch(`${BACKEND}/api/nodes/quotes/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(localQuotes)
    })
  ]);

  if (!nodesRes.ok) {
    throw new Error(`Cloud node sync failed with status ${nodesRes.status}`);
  }

  if (!quotesRes.ok) {
    throw new Error(`Cloud quote sync failed with status ${quotesRes.status}`);
  }

  console.log("Sync to cloud complete");
}

export async function deleteCloudNode(id) {
  const res = await fetch(`${BACKEND}/api/nodes/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Cloud delete failed with status ${res.status}`);
  }
}

export async function deleteCloudQuote(id) {
  const res = await fetch(`${BACKEND}/api/nodes/quotes/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Cloud delete quote failed with status ${res.status}`);
  }
}
