/* ============================================================================
 * sanitize.js — make rendered HTML safe to inject into the host page.
 * ----------------------------------------------------------------------------
 * md-format deliberately passes raw HTML through (see renderers.js). That is
 * useful for authors, but a host that renders stored Markdown into innerHTML
 * needs a safety boundary. This module is that boundary, kept in the library so
 * every host does not have to re-implement the same allow/deny rules.
 *
 * What it removes:
 *   - executable/embedded elements: script, style, iframe, object, embed…
 *   - form controls, except task-list checkboxes
 *   - inline event handlers (onclick, onerror, …)
 *   - javascript: href/src URLs
 *
 * It is intentionally DOM-based (browser only) and non-opinionated about
 * layout: classes, ids and data attributes survive.
 * ========================================================================== */

const REMOVE_TAGS = "script, style, iframe, object, embed, link, meta, form, textarea, select";

export function sanitizeHtml(html, opts = {}) {
    const allowCheckboxes = opts.allowCheckboxes !== false;
    const template = document.createElement("template");
    template.innerHTML = String(html ?? "");

    template.content.querySelectorAll(REMOVE_TAGS).forEach((node) => node.remove());

    template.content.querySelectorAll("input").forEach((node) => {
        const type = String(node.getAttribute("type") || "").toLowerCase();
        if (!allowCheckboxes || type !== "checkbox") {
            node.remove();
            return;
        }
        // Task checkboxes are display-only; keep just the state attributes.
        [...node.attributes].forEach((attr) => {
            if (!["type", "checked", "disabled"].includes(attr.name.toLowerCase())) {
                node.removeAttribute(attr.name);
            }
        });
    });

    template.content.querySelectorAll("*").forEach((node) => {
        [...node.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = String(attr.value || "").trim();
            if (name.startsWith("on")) node.removeAttribute(attr.name);
            if ((name === "href" || name === "src") && /^javascript:/i.test(value)) {
                node.removeAttribute(attr.name);
            }
        });
    });

    return template.innerHTML;
}
