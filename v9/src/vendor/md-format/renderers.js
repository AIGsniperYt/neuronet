/* ============================================================================
 * renderers.js — the "drawing" half of md-format
 * ----------------------------------------------------------------------------
 * The parser hands us a tree (the AST from mdparser.js). These functions walk
 * that tree and produce a STRING in whatever format you asked for.
 *
 * Why is this separate from parsing? Because the tree describes MEANING, not
 * appearance. "This is a heading" can become <h2>, a bold terminal title, or
 * a line starting with "##". One parse → many outputs. That's the whole idea.
 *
 * The registry at the bottom maps a name → renderer function, and `format()`
 * is the gateway: `format(markdownText, "html")` does parse + render in one.
 *
 * RENDERER CONTRACT: every renderer here must handle every node type the
 * parser can emit (see the big comment at the top of mdparser.js). If you add
 * a node type there, add a branch here or you'll get a swallowed `null`.
 * ========================================================================== */

// The parser lives in its own file; we only need its `parse` entry point here.
import { parse } from "./mdparser.js";

/* ----------------------------------------------------------------------------
 * HTML escaping — THE most important security function in this file.
 * We render our own output into the page with innerHTML, so ANY user-supplied
 * text must be escaped before it goes into a tag body. "<img onerror=alert(1)>"
 * pasted into the editor would otherwise execute when the preview renders —
 * not a hack, that's just how html works.
 * ----------------------------------------------------------------------------
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* ----------------------------------------------------------------------------
 * flattenText(children) — recursively pull the plain words out of an inline
 * tree. Used for image alt text and as the base of the "text" renderer.
 * ----------------------------------------------------------------------------
 */
function flattenText(children) {
    if (!children) return "";
    let out = "";
    for (const node of children) {
        switch (node.type) {
            case "text": out += node.value; break;
            case "code": out += node.text; break;
            case "html": out += node.value; break;
            case "math": out += (node.display ? "$$" : "$") + node.tex + (node.display ? "$$" : "$"); break;
            case "image": out += node.alt; break;
            case "softbreak":
            case "hardbreak": out += "\n"; break;
            default: out += flattenText(node.children);
        }
    }
    return out;
}

/* ============================================================================
 * renderHtml(tree) — the default, prettier output. Produces real html for the
 * browser preview, GitHub-style.
 * ========================================================================== */
function renderHtml(tree, opts = {}) {
    if (tree.type === "document") {
        return tree.children.map((c, i) => {
            const gap = opts.softBreaks && i > 0 ? Math.max(0, (c.gapBefore || 0) - 1) : 0;
            const spacer = gap ? Array.from({ length: gap }, () => '<div class="md-blank-line" data-md-blank-line="1"><br></div>').join("\n") + "\n" : "";
            return spacer + renderHtml(c, opts);
        }).join("\n");
    }
    switch (tree.type) {

        case "heading": {
            return `<h${tree.level}>${renderHtmlInline(tree.children, opts)}</h${tree.level}>`;
        }

        case "paragraph": {
            return `<p>${renderHtmlInline(tree.children, opts)}</p>`;
        }

        case "blockquote": {
            return `<blockquote>\n${tree.children.map(c => renderHtml(c, opts)).join("\n")}\n</blockquote>`;
        }

        case "list": {
            const tag = tree.ordered ? "ol" : "ul";
            // "3. a" starts at 3 — carry that through so numbering stays honest
            const startAttr = tree.ordered && tree.start && tree.start !== 1
                ? ` start="${tree.start}"`
                : "";
            return `<${tag}${startAttr}>\n${tree.items.map(i => renderHtml(i, opts)).join("")}</${tag}>`;
        }

        case "listitem": {
            const checkbox = tree.task
                ? `<input type="checkbox" disabled${tree.checked ? " checked" : ""}> `
                : "";
            // CommonMark "tight list": a single-paragraph item renders INLINE
            // (no <p>), so "- [x] open task" shows checkbox+text on ONE line
            // and a WYSIWYG backspace can actually merge them. Only when an
            // item has multiple paragraphs (a loose list) do we wrap in <p>.
            const paraCount = tree.children.filter(b => b.type === "paragraph").length;
            const tight = paraCount <= 1;
            const inner = tight
                ? tree.children.map(b =>
                      b.type === "paragraph" ? renderHtmlInline(b.children, opts)
                                             : renderHtml(b, opts)).join("")
                : tree.children.map(c => renderHtml(c, opts)).join("\n");
            return `<li>${checkbox}${inner}</li>\n`;
        }

        case "code": {
            // fenced ```language blocks get a language- class for colouring;
            // plain indented code gets none.
            const cls = tree.lang ? ` class="language-${escapeHtml(tree.lang)}"` : "";
            return `<pre><code${cls}>${escapeHtml(tree.text)}</code></pre>`;
        }

        case "hr": {
            return `<hr>`;
        }

        case "math": {
            // block maths: a display-mode element. The tex is written into the
            // markup twice — the data-tex attribute is how we round-trip it
            // back to markdown, the body is the fallback text that shows even
            // with NO KaTeX loaded. renderMathWithKatex() (mdeditor.js)
            // swaps the body for real typeset maths when window.katex exists.
            return `<div class="md-math md-math-display" data-tex="${escapeHtml(tree.tex)}">${escapeHtml(tree.tex)}</div>`;
        }

        case "table": {
            // alignment marker per column; absent alignment emits no attribute.
            const al = a => a ? ` align="${a}"` : "";
            const head = tree.headers.length
                ? `<thead>\n<tr>${tree.headers.map((c, j) => `<th${al(tree.align[j])}>${renderHtmlInline(c, opts)}</th>`).join("")}</tr>\n</thead>`
                : "";
            const body = tree.rows.length
                ? `<tbody>\n${tree.rows.map(row =>
                    `<tr>${row.map((c, j) => `<td${al(tree.align[j])}>${renderHtmlInline(c, opts)}</td>`).join("")}</tr>`
                  ).join("\n")}\n</tbody>`
                : "";
            return `<table>\n${head}${body}</table>`;
        }

        default: {
            throw new Error(`renderHtml: unknown block type "${tree.type}"`);
        }
    }
}

/* renderHtmlInline(children, opts) — walk a list of INLINE nodes.
 * opts.softBreaks promotes a single newline (softbreak) to a visible line
 * break. The library is markdown-first: OFF by default, hosts that want a
 * "regular editor" feel (like neuronet) opt in explicitly. */
function renderHtmlInline(children, opts = {}) {
    let out = "";
    for (const node of children || []) {
        switch (node.type) {
            case "text":        out += escapeHtml(node.value); break;
            case "strong":      out += `<strong>${renderHtmlInline(node.children, opts)}</strong>`; break;
            case "emphasis":    out += `<em>${renderHtmlInline(node.children, opts)}</em>`; break;
            case "strikethrough": out += `<del>${renderHtmlInline(node.children, opts)}</del>`; break;
            case "code":        out += `<code>${escapeHtml(node.text)}</code>`; break;
            case "link": {
                const title = node.title ? ` title="${escapeHtml(node.title)}"` : "";
                const inner = node.children && node.children.length
                    ? renderHtmlInline(node.children, opts)
                    : escapeHtml(node.url);            // empty text → show the URL
                out += `<a href="${escapeHtml(node.url)}"${title}>${inner}</a>`;
                break;
            }
            case "image":
                out += `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt)}"${node.title ? ` title="${escapeHtml(node.title)}"` : ""}>`;
                break;
            case "softbreak":
                out += opts.softBreaks ? "<br>\n" : "\n"; break;
            case "hardbreak":   out += "<br>\n"; break;
            case "html":        out += node.value; break;   // raw html passthrough
            case "math": {
                const cls = node.display ? "md-math md-math-display" : "md-math";
                out += `<span class="${cls}" data-tex="${escapeHtml(node.tex)}">${escapeHtml(node.tex)}</span>`;
                break;
            }
            default:
                throw new Error(`renderHtmlInline: unknown inline type "${node.type}"`);
        }
    }
    return out;
}

/* ============================================================================
 * renderText(tree) — the plain, formatting-stripped output.
 * Headings lose their #; bold and italics lose their stars. It reads like a
 * clean paragraph (some folks paste this into chats/discord that only take
 * plain text). Links keep the URL in brackets so no info is lost.
 * ========================================================================== */
function renderText(tree) {
    if (tree.type === "document") {
        // separate the top-level blocks by a blank line, like prose paragraphs
        return tree.children.map(renderText).filter(s => s.length).join("\n\n");
    }
    switch (tree.type) {

        case "heading":
            return renderTextInline(tree.children);

        case "paragraph":
            return renderTextInline(tree.children);

        case "blockquote": {
            const inner = tree.children.map(renderText).filter(s => s.length).join("\n\n");
            return inner.split("\n").map(line => `> ${line}`).join("\n");
        }

        case "list": {
            const marker = tree.ordered ? (n) => `${tree.start + n}.` : () => "-";
            return tree.items.map((item, idx) => {
                const box = item.task ? `[${item.checked ? "x" : " "}] ` : "";
                const lines = renderText(item).split("\n");
                return [`${marker(idx)} ${box}${lines.shift()}`,
                        ...lines.map(l => "  " + l)].join("\n");
            }).join("\n");
        }

        case "listitem":
            return tree.children.map(renderText).filter(s => s.length).join("\n\n");

        case "code":
            return tree.text;   // code is code, nothing to strip

        case "math":
            return `$$\n${tree.tex}\n$$`;   // keep the delimiters, lose nothing

        case "hr":
            return "----------------------------------------";

        case "table": {
            // a table is just columns squared up with " | " — the header row
            // first, then every data row underneath it.
            const line = row => row.map(renderTextInline).join(" | ");
            return [line(tree.headers), ...tree.rows.map(line)].filter(s => s.length).join("\n");
        }

        default:
            throw new Error(`renderText: unknown block type "${tree.type}"`);
    }
}

/* renderTextInline — plain text; links become "label (url)". */
function renderTextInline(children) {
    let out = "";
    for (const node of children || []) {
        switch (node.type) {
            case "text":        out += node.value; break;
            case "strong":
            case "emphasis":
            case "strikethrough": out += renderTextInline(node.children); break;
            case "code":        out += node.text; break;
            case "link": {
                const label = renderTextInline(node.children);
                out += label ? `${label} (${node.url})` : node.url;
                break;
            }
            case "image":       out += node.alt; break;
            case "softbreak":
            case "hardbreak":   out += "\n"; break;
            case "html":        out += node.value; break;
            case "math": {
                const d = node.display ? "$$" : "$";
                out += d + node.tex + d;
                break;
            }
            default:
                throw new Error(`renderTextInline: unknown inline type "${node.type}"`);
        }
    }
    return out;
}

/* ============================================================================
 * renderAnsi(tree) — terminal output. Wraps stuff in ANSI escape codes:
 *   \x1b[1m  bold        \x1b[3m  italic     \x1b[4m  underline
 *   \x1b[9m  strike      \x1b[36m cyan       \x1b[0m  reset
 * Every span ends with a reset so the colour can't bleed into the next thing.
 * ========================================================================== */

const ANSI = {
    bold: "\x1b[1m", italic: "\x1b[3m", underline: "\x1b[4m",
    strike: "\x1b[9m", cyan: "\x1b[36m", gray: "\x1b[90m", reset: "\x1b[0m",
};

function renderAnsi(tree) {
    if (tree.type === "document") {
        return tree.children.map(renderAnsi).filter(s => s.length).join("\n\n");
    }
    switch (tree.type) {

        case "heading":
            return `${ANSI.bold}${ANSI.cyan}${renderAnsiInline(tree.children)}${ANSI.reset}`;

        case "paragraph":
            return renderAnsiInline(tree.children);

        case "blockquote": {
            const inner = tree.children.map(renderAnsi).filter(s => s.length).join("\n\n");
            return inner.split("\n").map(line => `> ${line}`).join("\n");
        }

        case "list": {
            const marker = tree.ordered ? (n) => `${tree.start + n}.` : () => "-";
            return tree.items.map((item, idx) => {
                const box = item.task ? `[${item.checked ? "x" : " "}] ` : "";
                const lines = renderAnsi(item).split("\n");
                return [`${marker(idx)} ${box}${lines.shift()}`,
                        ...lines.map(l => "  " + l)].join("\n");
            }).join("\n");
        }

        case "listitem":
            return tree.children.map(renderAnsi).filter(s => s.length).join("\n\n");

        case "code":
            return `${ANSI.gray}${tree.text}${ANSI.reset}`;

        case "math":
            return `$$\n${tree.tex}\n$$`;   // terminals can't type-set; keep raw

        case "hr":
            return `${ANSI.gray}────────────────────────${ANSI.reset}`;

        case "table": {
            // a plain squared-up table; cells don't get their own codes, the
            // inline styling inside them (bold links etc.) already does.
            const line = row => row.map(renderAnsiInline).join(" | ");
            return [line(tree.headers), ...tree.rows.map(line)].filter(s => s.length).join("\n");
        }

        default:
            throw new Error(`renderAnsi: unknown block type "${tree.type}"`);
    }
}

function renderAnsiInline(children) {
    let out = "";
    for (const node of children || []) {
        switch (node.type) {
            case "text":        out += node.value; break;
            case "strong":      out += `${ANSI.bold}${renderAnsiInline(node.children)}${ANSI.reset}`; break;
            case "emphasis":    out += `${ANSI.italic}${renderAnsiInline(node.children)}${ANSI.reset}`; break;
            case "strikethrough": out += `${ANSI.strike}${renderAnsiInline(node.children)}${ANSI.reset}`; break;
            case "code":        out += `${ANSI.cyan}${node.text}${ANSI.reset}`; break;
            case "link": {
                const label = renderAnsiInline(node.children);
                out += `${ANSI.underline}${label || node.url}${ANSI.reset}${label ? ` (${node.url})` : ""}`;
                break;
            }
            case "image":       out += node.alt; break;
            case "softbreak":
            case "hardbreak":   out += "\n"; break;
            case "html":        out += node.value; break;
            case "math": {
                const d = node.display ? "$$" : "$";
                out += `${ANSI.cyan}${d}${node.tex}${d}${ANSI.reset}`;
                break;
            }
            default:
                throw new Error(`renderAnsiInline: unknown inline type "${node.type}"`);
        }
    }
    return out;
}

/* ============================================================================
 * renderMarkdown(tree) — the "round trip" output.
 * Turns the AST back into (re-*marked*) markdown. This normalises messy input:
 * weird spacing becomes canonical, and it's what "Copy as markdown" uses.
 * ========================================================================== */
function renderMarkdown(tree) {
    if (tree.type === "document") {
        return tree.children.map(renderMarkdown).filter(s => s.length).join("\n\n");
    }
    switch (tree.type) {

        case "heading": {
            const hashes = "#".repeat(tree.level);
            // rich headings keep their content lined up after the hashes
            return `${hashes} ${renderMarkdownInline(tree.children)}`;
        }

        case "paragraph":
            return renderMarkdownInline(tree.children);

        case "blockquote": {
            const inner = tree.children.map(renderMarkdown).filter(s => s.length).join("\n\n");
            return inner.split("\n").map(line => `> ${line || ">"}`).join("\n");
        }

        case "list": {
            const marker = tree.ordered ? (n) => `${tree.start + n}.` : () => "-";
            return tree.items.map((item, idx) => {
                const box = item.task ? `[${item.checked ? "x" : " "}] ` : "";
                const lines = renderMarkdown(item).split("\n");
                return [`${marker(idx)} ${box}${lines.shift()}`,
                        ...lines.map(l => "  " + l)].join("\n");
            }).join("\n");
        }

        case "listitem":
            return tree.children.map(renderMarkdown).filter(s => s.length).join("\n");

        case "code":
            // pick a fence that won't collide with the content being wrapped
            const fence = tree.text.includes("```") ? "~~~~" : "```";
            return `${fence}${tree.lang ? " " + tree.lang : ""}\n${tree.text}\n${fence}`;

        case "hr":
            return "---";

        case "math":
            return `$$\n${tree.tex}\n$$`;   // round-trips byte-for-byte

        case "table": {
            // round-trip faithful: the header, an alignment gutter, then the
            // body — every row wrapped in pipes so it re-parses exactly.
            const delim = j => tree.align[j] === "left" ? ":---"
                             : tree.align[j] === "center" ? ":--:"
                             : tree.align[j] === "right" ? "---:"
                             : "---";
            const line = row => `| ${row.map(renderMarkdownInline).join(" | ")} |`;
            const head = tree.headers.length ? line(tree.headers) : "";
            const gutter = head
                ? `| ${tree.headers.map((_, j) => " " + delim(j) + " ").join(" | ")} |`
                : "";
            return [head, gutter, ...tree.rows.map(line)].filter(s => s.length).join("\n");
        }

        default:
            throw new Error(`renderMarkdown: unknown block type "${tree.type}"`);
    }
}

function renderMarkdownInline(children) {
    let out = "";
    for (const node of children || []) {
        switch (node.type) {
            case "text":        out += node.value; break;
            case "strong":      out += `**${renderMarkdownInline(node.children)}**`; break;
            case "emphasis":    out += `*${renderMarkdownInline(node.children)}*`; break;
            case "strikethrough": out += `~~${renderMarkdownInline(node.children)}~~`; break;
            case "code":        out += "`" + node.text.replace(/`/g, "\\`") + "`"; break;
            case "link": {
                const label = renderMarkdownInline(node.children);
                const title = node.title ? ` "${node.title}"` : "";
                const url = node.url.includes(" ") ? `<${node.url}>` : node.url;
                out += `[${label}](${url}${title})`;
                break;
            }
            case "image": {
                const title = node.title ? ` "${node.title}"` : "";
                const url = node.url.includes(" ") ? `<${node.url}>` : node.url;
                out += `![${node.alt}](${url}${title})`;
                break;
            }
            case "softbreak":   out += "\n"; break;
            case "hardbreak":   out += "  \n"; break;   // two spaces = hard break
            case "html":        out += node.value; break;
            case "math": {
                const d = node.display ? "$$" : "$";
                out += d + node.tex + d;
                break;
            }
            default:
                throw new Error(`renderMarkdownInline: unknown inline type "${node.type}"`);
        }
    }
    return out;
}

/* ============================================================================
 * REGISTRY — maps an output name to its renderer, plus the public gateway.
 * `format(text, "ansi")` = parse + render in one call. Add a renderer above
 * and slot it in here to make it available everywhere (demo, API, CLI).
 * ========================================================================== */
const renderers = {
    html: renderHtml,
    text: renderText,
    ansi: renderAnsi,
    markdown: renderMarkdown,
};

/** render(ast, type, opts) — turn an already-parsed tree into output.
 * `opts.softBreaks` (default false) makes "html" output promote single
 * newlines to visible line breaks without changing the markdown semantics. */
export function render(ast, type = "html", opts = {}) {
    const fn = renderers[type];
    if (!fn) {
        throw new Error(`render: unknown output type "${type}" — know: ${Object.keys(renderers).join(", ")}`);
    }
    return fn(ast, opts);
}

/** format(markdownText, type, opts) — THE one-liner: "give me this formatted nicely." */
export function format(text, type = "html", opts = {}) {
    // one stop: parse the source into a tree, then hand the tree to `render`.
    // (the explicit two-step `parse()` + `render()` is identical under the hood)
    return render(parse(text), type, opts);
}
