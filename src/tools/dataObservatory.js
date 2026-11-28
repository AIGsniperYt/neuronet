import { getDataInsights } from "../dataInsights.js";
import { clearActivityEvents, getSyncConflicts, resolveSyncConflict } from "../db.js";

const CLOUD_COLLECTIONS = new Set([
  "nodes", "quotes", "cues", "cards", "heaps",
  "decks", "subjects", "tasks", "commitments"
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function formatDay(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value) {
  const timestamp = Number(value);
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export async function initDataObservatory() {
  const root = document.getElementById("dataObservatory");
  if (!root) return;

  const notice = root.querySelector("#obsNotice");
  const summary = root.querySelector("#obsSummary");
  const inventoryRows = root.querySelector("#obsInventoryRows");
  const syncDetails = root.querySelector("#obsSyncDetails");
  const activityEvents = root.querySelector("#obsActivityEvents");
  const conflictSection = root.querySelector("#obsConflictSection");
  const conflictList = root.querySelector("#obsConflictList");
  const refreshButton = root.querySelector("#obsRefresh");
  const clearActivityButton = root.querySelector("#obsClearActivity");
  let refreshing = false;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    if (refreshButton) refreshButton.disabled = true;
    if (clearActivityButton) clearActivityButton.disabled = true;
    if (notice) notice.textContent = "Reading local database…";

    try {
      const [insights, conflicts] = await Promise.all([
        getDataInsights({ days: 7, includeInventory: true }),
        getSyncConflicts()
      ]);
      const events = insights.recentActivityEvents || [];

      if (summary) {
        summary.innerHTML = [
          ["Stored items", insights.totalRecords],
          ["Estimated payload", formatBytes(insights.estimatedPayloadBytes)],
          ["Pending changes", insights.sync.pending],
          ["Conflicts", insights.sync.conflicts]
        ].map(([label, value]) => `
          <div class="nn-observatory-card">
            <span class="nn-observatory-label">${escapeHtml(label)}</span>
            <strong class="nn-observatory-value">${escapeHtml(value)}</strong>
          </div>
        `).join("");
      }

      if (inventoryRows) {
        const rows = Object.entries(insights.inventory)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, data]) => {
            const cloud = CLOUD_COLLECTIONS.has(name);
            const scope = cloud ? "Cloud-eligible" : "Local-only";
            return `
              <tr>
                <td>${escapeHtml(name)}</td>
                <td class="nn-mono">${Number(data.count).toLocaleString()}</td>
                <td class="nn-mono">${formatBytes(data.estimatedPayloadBytes)}</td>
                <td><span class="nn-observatory-status">${scope}</span></td>
              </tr>
            `;
          });
        inventoryRows.innerHTML = rows.join("") || '<tr><td colspan="4" class="nn-muted">No local records yet.</td></tr>';
      }

      if (syncDetails) {
        const lastSnapshot = insights.sync.lastSnapshot;
        const status = window.DEMO_MODE
          ? "Offline/demo mode — cloud requests are disabled"
          : "Cloud sync enabled — server storage metrics are not yet exposed";
        const details = [
          ["Mode", status],
          ["Ready to upload", insights.sync.ready],
          ["Blocked operations", insights.sync.blocked],
          ["Saved conflicts", insights.sync.conflicts],
          ["Pull cursor", insights.sync.cursor],
          ["Last recovered snapshot", lastSnapshot
            ? `revision ${lastSnapshot.revision} · ${formatDateTime(lastSnapshot.completedAt)}`
            : "No snapshot recorded"],
          ["Active recovery", insights.sync.activeSnapshot
            ? `revision ${insights.sync.activeSnapshot.revision}`
            : "None"]
        ];
        syncDetails.innerHTML = details.map(([label, value]) => `
          <div class="nn-observatory-event">
            <span class="nn-muted">${escapeHtml(label)}</span>
            <span>${escapeHtml(value)}</span>
          </div>
        `).join("");
      }

      if (conflictSection && conflictList) {
        conflictSection.hidden = conflicts.length === 0;
        conflictList.innerHTML = conflicts.map((conflict) => {
          const local = conflict.localOperation || {};
          const remote = conflict.remoteChange || {};
          const reason = remote.reason === "pending-operation-predates-compacted-baseline"
            ? "This local operation predates the retained cloud baseline. Keeping it locally is an explicit decision to recreate or reapply it."
            : remote.reason === "record-absent-from-cloud-snapshot"
              ? "This record is absent from the current cloud snapshot. The local and cloud copies may have diverged."
              : "The cloud record changed after this device's last acknowledged version.";
          const localPayload = local.payload ?? null;
          const remotePayload = remote.payload ?? null;
          return `
            <article class="nn-observatory-card">
              <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <strong>${escapeHtml(conflict.collection)} / ${escapeHtml(conflict.recordId)}</strong>
                <span class="nn-observatory-status">${escapeHtml(local.type || "local")} vs ${escapeHtml(remote.type || "remote")}</span>
              </div>
              <p style="margin:8px 0;">${escapeHtml(reason)}</p>
              <p class="nn-muted">Local base version: ${Number(local.baseVersion || 0)} · Cloud version: ${Number(remote.version || remote.currentVersion || 0)}</p>
              <details style="margin-top:10px;">
                <summary>Inspect local and cloud data</summary>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px;">
                  <div><p>Local copy</p><pre>${escapeHtml(JSON.stringify(localPayload, null, 2) || "No local payload")}</pre></div>
                  <div><p>Cloud copy</p><pre>${escapeHtml(JSON.stringify(remotePayload, null, 2) || "No cloud payload")}</pre></div>
                </div>
              </details>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                <button type="button" data-conflict-choice="local" data-collection="${escapeHtml(conflict.collection)}" data-record-id="${escapeHtml(conflict.recordId)}">Keep this device's copy</button>
                <button type="button" data-conflict-choice="remote" data-collection="${escapeHtml(conflict.collection)}" data-record-id="${escapeHtml(conflict.recordId)}">Use cloud copy</button>
              </div>
            </article>
          `;
        }).join("");
      }

      if (activityEvents) {
        const latest = events;
        activityEvents.innerHTML = latest.length
          ? latest.map((event) => `
              <div class="nn-observatory-event">
                <span>
                  <strong>${escapeHtml(event.kind)}</strong>
                  <span class="nn-muted"> · ${escapeHtml(event.recordId)}</span>
                </span>
                <span class="nn-muted">${escapeHtml(formatDay(event.day))}</span>
              </div>
            `).join("")
          : '<p class="nn-muted">No activity events recorded yet.</p>';
      }

      if (notice) {
        const localScope = "This is a per-device view; records are not being uploaded by the Observatory.";
        const retention = `${insights.activityEventsRetained} metadata events retained since ${formatDay(insights.activityHistoryStartDay)}.`;
        const cloud = window.DEMO_MODE
          ? "Cloud sync is disabled in this build. Your local database remains authoritative."
          : "Cloud baseline and retained-delta metrics will be shown when the server observability endpoint is deployed.";
        notice.textContent = [cloud, localScope, retention].join(" ");
      }
    } catch (error) {
      console.error("[OBSERVATORY] Failed to read local data:", error);
      if (notice) notice.textContent = "Unable to read the local database: " + (error?.message || "unknown error");
      if (inventoryRows) inventoryRows.innerHTML = '<tr><td colspan="4" class="nn-muted">Could not read local records.</td></tr>';
    } finally {
      refreshing = false;
      if (refreshButton) refreshButton.disabled = false;
      if (clearActivityButton) clearActivityButton.disabled = false;
    }
  }

  conflictList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-conflict-choice]");
    if (!button) return;
    const { collection, recordId, conflictChoice } = {
      collection: button.dataset.collection,
      recordId: button.dataset.recordId,
      conflictChoice: button.dataset.conflictChoice
    };
    const decision = conflictChoice === "local" ? "keep this device's copy" : "replace it with the cloud copy";
    if (!window.confirm(`Are you sure you want to ${decision} for ${collection} / ${recordId}?`)) return;
    button.disabled = true;
    try {
      await resolveSyncConflict(collection, recordId, conflictChoice);
      if (notice) notice.textContent = "Conflict choice saved. The next sync will apply it.";
      await refresh();
    } catch (error) {
      button.disabled = false;
      if (notice) notice.textContent = "Unable to resolve conflict: " + (error?.message || "unknown error");
    }
  });

  clearActivityButton?.addEventListener("click", async () => {
    if (!window.confirm("Clear the local activity history? This removes only progress-event metadata; cards, tasks, journals and other records remain untouched.")) return;
    try {
      const removed = await clearActivityEvents();
      await refresh();
      if (notice) notice.textContent = `Cleared ${removed} local activity events. Your study records were not changed.`;
    } catch (error) {
      if (notice) notice.textContent = "Unable to clear activity history: " + (error?.message || "unknown error");
    }
  });

  refreshButton?.addEventListener("click", refresh);
  await refresh();
}
