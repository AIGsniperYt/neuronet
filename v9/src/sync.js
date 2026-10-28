import { getAllNodes, addNodes, getAllQuotes, addQuotes, getAllCues, addCues } from "./db.js";

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

export async function fetchCloudCues() {
  const res = await fetch(`${BACKEND}/api/nodes/cues`, {
    credentials: "include"
  });

  if (!res.ok) {
    throw new Error(`Cloud cue fetch failed with status ${res.status}`);
  }

  const cloudCues = await res.json();
  return Array.isArray(cloudCues) ? cloudCues : [];
}

export async function syncLocalWithCloud() {
  const [localNodes, cloudNodes, localQuotes, cloudQuotes, localCues, cloudCues] = await Promise.all([
    getAllNodes(),
    fetchCloudNodes(),
    getAllQuotes(),
    fetchCloudQuotes(),
    getAllCues(),
    fetchCloudCues()
  ]);

  const mergedNodes = mergeNodeSets(localNodes, cloudNodes);
  const mergedQuotes = mergeNodeSets(localQuotes, cloudQuotes);
  const mergedCues = mergeNodeSets(localCues, cloudCues);
  await addNodes(mergedNodes);
  await addQuotes(mergedQuotes);
  await addCues(mergedCues);
  await syncToCloud(mergedNodes, mergedQuotes, mergedCues);

  return { nodes: mergedNodes, quotes: mergedQuotes, cues: mergedCues };
}

export async function syncToCloud(localNodes, localQuotes = [], localCues = []) {
  const [nodesRes, quotesRes, cuesRes] = await Promise.all([
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
    }),
    fetch(`${BACKEND}/api/nodes/cues/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(localCues)
    })
  ]);

  if (!nodesRes.ok) {
    throw new Error(`Cloud node sync failed with status ${nodesRes.status}`);
  }

  if (!quotesRes.ok) {
    throw new Error(`Cloud quote sync failed with status ${quotesRes.status}`);
  }

  if (!cuesRes.ok) {
    throw new Error(`Cloud cue sync failed with status ${cuesRes.status}`);
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

export async function deleteCloudCue(id) {
  const res = await fetch(`${BACKEND}/api/nodes/cues/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Cloud delete cue failed with status ${res.status}`);
  }
}
