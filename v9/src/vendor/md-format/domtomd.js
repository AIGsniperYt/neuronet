/* ============================================================================
 * domtomd.js — the inverse of renderers.js: DRAW the rendered DOM back into
 * markdown text.
 * ----------------------------------------------------------------------------
 * md-format normally flows markdown → parse → AST → rendered output. But the
 * live editor (index.html) wants BIDIRECTIONAL editing: when you type straight
 * into the rendered preview (a WYSIWYG surface), the browser edits real HTML
 * elements. That HTML is OUR own renderer's output (plus whatever the browser
 * does to it while you type), so we can walk it back to markdown and write that
 * into the source editor.
 *
 * This is deliberately a plain DOM walk — no framework, no virtual dom. It
 * mirrors the shapes that renderHtml() emits in renderers.js, so those two
 * files are designed to stay in step:
 *
 *   h1..h6 → #/##/###       strong/em/del → ** / * / ~~ markers
 *   p      → plain text     code (inline)  → `tick`      pre → ```fence```
 *   a      → [text](href)   img            → ![alt](src)
 *   ul/ol  → - / 1. markers li             → + checkbox if task
 *   blockquote → > lines    hr             → ---          br → "  " hard break
 *   table  → pipe table with a "---" gutter (alignment carried from th align)
 *   math   → $tex$ / $$tex$$ (raw tex lives in the data-tex attribute)
 *
 * Why is this in its own file and not stuck in index.html? Two reasons: it's
 * the third leg of the engine (md→out, out→md, inspect) so it deserves to be a
 * testable module, and it keeps the page file readable. It's meant to be used
 * in a browser only (it touches the DOM), so no node-import guarantees.
 * ========================================================================== */

/* block-level node → markdown string; `depth` = list nesting level. */
function mdBlock(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    if (node.hasAttribute("data-md-blank-line")) return "\n";
    switch (tag) {

        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
            return `${"#".repeat(+tag[1])} ${mdInlineChildren(node)}`;

        /* `div` is what browsers inject when you hit Enter inside a
         * contenteditable paragraph — treat it like a paragraph. */
        case "p":
        case "div": {
            const inner = mdInlineChildren(node);
            if (!inner.trim()) return "<br>";
            return inner;
        }

        case "blockquote": {
            /* A blockquote is usually dialogue or an excerpt: short inline
             * text, often separated by <br> hard breaks. The naive per-line
             * split below mangled those into "> >" empties and re-rendered
             * as paragraph gaps + a single collapsed run. Walk the children
             * instead: a <br> becomes a trailing hard-break marker ("  ") on
             * its line, every other child maps through mdBlock, and we emit
             * one "> " line per visual line. Empty blockquotes (or a
             * trailing <br>) evaporate. */
            const lines = [];
            let cur = "";
            const flush = (hard) => {
                const trimmed = cur.trimEnd();
                if (trimmed) lines.push(hard ? `${trimmed}  ` : trimmed);
                cur = "";
            };
            for (const child of node.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
                    flush(true);
                    continue;
                }
                if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) continue;
                // a nested block (blockquote/list) came back multi-line — carry
                // each line through as its own blockquote line
                const parts = mdBlock(child, depth).split("\n");
                for (let i = 0; i < parts.length; i++) {
                    cur += parts[i];
                    if (i < parts.length - 1) flush(false);
                }
            }
            flush(false);
            if (!lines.length) return "";
            // a dangling hard-break on the LAST line round-trips as dead
            // trailing spaces (nothing follows to break to) — drop it
            lines[lines.length - 1] = lines[lines.length - 1].replace(/[ \t]+$/, "");
            return lines.map(l => `> ${l}`).join("\n");
        }

        case "ul":
        case "ol":
            return mdList(node, depth);

        case "pre":
            return mdPre(node);

        case "hr":
            return "---";

        /* a <table> folds back to pipes. The header lives in <thead><tr><th>
         * (our renderer always emits one when the source had a header), and
         * the body rows are the <tr> in <tbody>. Alignment comes back out of
         * the th "align" attribute, so ":---" in the source stays honest. */
        case "table": {
            const out = [];
            const head = node.querySelector("thead > tr");
            if (head) {
                const ths = Array.from(head.children)
                    .filter(c => c.nodeType === Node.ELEMENT_NODE && c.tagName.toLowerCase() === "th");
                out.push(`| ${ths.map(th => mdInlineChildren(th).trim()).join(" | ")} |`);
                out.push(`| ${ths.map(th => mdTableAlign(th.getAttribute("align"))).join(" | ")} |`);
            }
            const body = node.querySelector("tbody") || node;
            for (const tr of body.querySelectorAll("tr")) {
                const tds = Array.from(tr.children)
                    .filter(c => c.nodeType === Node.ELEMENT_NODE && c.tagName.toLowerCase() === "td");
                out.push(`| ${tds.map(td => mdInlineChildren(td).trim()).join(" | ")} |`);
            }
            return out.join("\n");
        }
    }
    return mdInline(node);   // anything else → treat as inline text
}

/* --- table gutter: turn a th "align" attribute back into a delimiter cell --- */
function mdTableAlign(arr) {
    if (arr === "left") return ":---";
    if (arr === "center") return ":--:";
    if (arr === "right") return "---:";
    return "---";
}

/* --- lists: `- ` for unordered, `1. ` for ordered (keeping the start number) */
function mdList(list, depth) {
    const ordered = list.tagName.toLowerCase() === "ol";
    const start = parseInt(list.getAttribute("start") || "1", 10);
    let n = start;
    const out = [];
    for (const li of list.children) {
        if (li.tagName.toLowerCase() !== "li") continue;
        out.push(mdListItem(li, depth, ordered ? n++ : null));
    }
    return out.join("\n");
}

function mdListItem(li, depth, num) {
    const indent = "  ".repeat(depth);
    const marker = num !== null ? `${num}. ` : "- ";

    /* our renderer emits task items as <li><input type="checkbox"…> <p>… -->
     * read the live checked state so toggling a box in the UI lands in source */
    let task = "";
    const first = li.firstElementChild;
    if (first && first.tagName === "INPUT" && (first.type === "checkbox")) {
        task = first.checked ? "[x] " : "[ ] ";
    }

    /* build the item's content: paragraphs, bare text and nested lists. The
     * first piece rides on the marker line, everything after is indented so
     * the sequence still parses back as one list item. */
    const lines = [];
    let placedMarker = false;
    for (const child of li.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) continue;
        if (child === first && child.tagName === "INPUT") continue;

        const nested = child.nodeType === Node.ELEMENT_NODE &&
            (child.tagName === "UL" || child.tagName === "OL");
        const piece = nested ? mdList(child, depth + 1) : mdBlock(child, depth + 1);

        for (const line of piece.split("\n")) {
            if (!placedMarker) {
                /* an EMPTY first block must never own the marker line —
                 * contenteditable loves injecting a bare <div>/<p> into a task
                 * item on toggle/edit, and that pushed the real text onto an
                 * indented new line ("- [x]\n  open task") instead of the
                 * canonical single line ("- [x] open task"). Skip it. */
                if (!line.trim()) continue;
                lines.push(indent + marker + task + line.trimStart());
                placedMarker = true;
            } else {
                lines.push(indent + "  " + line);
            }
        }
    }
    if (!placedMarker) lines.push(indent + marker + task);

    return lines.join("\n");
}

/* --- fenced code block: steal the language off class="language-js" --------- */
function mdPre(node) {
    const code = node.querySelector("code");
    const text = (code || node).textContent || "";
    const cls = code ? code.getAttribute("class") || "" : "";
    const m = /language-([\w+#.\-]+)/.exec(cls);
    const lang = m ? m[1] : "";
    const fence = text.includes("```") ? "~~~~" : "```";   // never collide
    return `${fence}${lang ? " " + lang : ""}\n${text}\n${fence}`;
}

/* --- inline serialisation: turn element/Text children into markdown --------- */
function mdInline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    /* maths: our renderer writes the raw tex into data-tex, and (with KaTeX)
     * replaces the BODY with typeset html — so we always read the attribute,
     * never the live text. Emit the original delimiters back. */
    if (node.classList && node.classList.contains("md-math")) {
        const tex = node.getAttribute("data-tex") || node.textContent;
        const display = node.classList.contains("md-math-display");
        return display ? `$$\n${tex}\n$$` : `$${tex}$`;
    }

    const tag = node.tagName.toLowerCase();
    switch (tag) {
        case "br":         return "  \n";                    // hard line break
        case "strong": case "b":  return `**${mdInlineChildren(node)}**`;
        case "em":    case "i":  return `*${mdInlineChildren(node)}*`;
        case "del":   case "s":  return `~~${mdInlineChildren(node)}~~`;
        case "code":
            return "`" + node.textContent.replace(/`/g, "\\`") + "`";
        case "a": {
            const href = node.getAttribute("href") || "";
            const title = node.getAttribute("title");
            const label = mdInlineChildren(node) || href;
            /* a bare URL in the source comes out of the renderer as
             * <a href="https://x.y">https://x.y</a>. Writing that back as
             * [https://x.y](https://x.y) would DOUBLE the URL on every round
             * trip — any interaction in the editor would "duplicate links".
             * If the label IS the href, write it back as a plain URL. */
            if (label === href && !title && /^(https?:|www\.)/i.test(href)) return label;
            return `[${label}](${href}${title ? ` "${title}"` : ""})`;
        }
        case "img": {
            const src = node.getAttribute("src") || "";
            const alt = node.getAttribute("alt") || "";
            const title = node.getAttribute("title");
            return `![${alt}](${src}${title ? ` "${title}"` : ""})`;
        }
        /* spans (incl. the caret markers), unknown tags → just their text */
        default:
            return mdInlineChildren(node);
    }
}

function mdInlineChildren(el) {
    return Array.from(el.childNodes).map(mdInline).join("");
}

function mdBlockChildren(el, depth) {
    return Array.from(el.childNodes)
        .filter(n => n.nodeType !== Node.TEXT_NODE || n.textContent.trim())
        .map(n => mdBlock(n, depth));
}

/** domToMarkdown(container) — the one entry point. Feed it the rendered root
 * (the `.md` div) and get the whole document as markdown text. */
export function domToMarkdown(container) {
    const nodes = Array.from(container.childNodes)
        .filter(n => n.nodeType !== Node.TEXT_NODE || n.textContent.trim());
    let out = "";
    for (const node of nodes) {
        const value = mdBlock(node, 0);
        if (!value.length) continue;
        const isBlankMarker = node.nodeType === Node.ELEMENT_NODE &&
            node.hasAttribute("data-md-blank-line");
        if (isBlankMarker) {
            // A marker is one additional source newline. It replaces the
            // normal block separator at this position; treating it as a full
            // block and joining with \n\n would add two blank lines.
            out += out ? "\n" : "";
            continue;
        }
        if (out) out += "\n\n";
        out += value;
    }
    return out;
}
