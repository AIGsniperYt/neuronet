/* ============================================================================
 * mdparser.js — the parsing half of md-format
 * ----------------------------------------------------------------------------
 * THE BIG IDEA
 * ------------
 * Markdown is just plain text with "rules" bolted onto it. We don't translate
 * it straight into html — we want to UNDERSTAND it first. So this works in
 * two stages:
 *
 *     text  ──parse──►  AST  ──render──►  html / text / ansi / markdown
 *              (this file)            (renderers.js does the second half)
 *
 * AST = Abstract Syntax Tree. It's just a normal JS object tree describing
 * what each piece of text MEANS ("this is a level-2 heading", "these words are
 * bold"). Because the tree is separate from the output, one parse feeds every
 * output format we have, and we can even INSPECT it (the demo has an "AST"
 * view — trees are cool).
 *
 * === THE NODE CONTRACT (every node this parser can produce) ===
 * Blocks (the big chunks laid out top-to-bottom):
 *   { type: "document",   children: [...] }          top of the tree
 *   { type: "heading",    level: 1-6, children: [] } inline children
 *   { type: "paragraph",  children: [] }             inline children
 *   { type: "blockquote", children: [...] }          child BLOCKS
 *   { type: "list",       ordered, start, items: [...] }
 *   { type: "listitem",   task?, checked?, children: [...] }  child BLOCKS
 *   { type: "code",       lang?, text }              raw text, no children
 *   { type: "hr" }
 *   { type: "table",      align, headers, rows }     pipe table; align per column
 *   { type: "math",       tex, display: true }       display maths block ($$...$$)
 *
 * Inlines (the words inside a paragraph/heading):
 *   { type: "text",          value }                 plain words
 *   { type: "strong",        children: [] }          **bold**
 *   { type: "emphasis",      children: [] }          *italic*
 *   { type: "strikethrough", children: [] }          ~~gone~~
 *   { type: "code",          text }                  `inline code`
 *   { type: "link",          url, title?, children } [text](url)
 *   { type: "image",         url, title?, alt }      ![alt](url)
 *   { type: "softbreak" }                            single newline inside a para
 *   { type: "hardbreak" }                            two spaces + newline
 *   { type: "html",         value }                  raw html passthrough
 *   { type: "math",         tex, display? }          $x$ or $$x$$; display if $$
 *
 * Renderers switch on these types: add a node type here and a renderer might
 * trip on it; write a renderer and it must handle every type above.
 * ========================================================================== */


/* ============================================================================
 * Tiny shared helpers
 * ========================================================================== */

// Normalise every newline to "\n". Windows (\r\n) and ancient-Mac (\r) files
// both split badly otherwise — this one-liner fixes all three.
function normalize(text) {
    return text.replace(/\r\n?/g, "\n");
}

// Is this line just whitespace? Blank lines separate blocks, we check this a lot.
function isBlank(line) {
    return /^[ \t]*$/.test(line);
}

// Number of columns of leading whitespace on a line (tabs step up to the next
// multiple of 4, same way a terminal counts). Used for list indentation maths.
function leadingSpaces(line) {
    let col = 0;
    for (const ch of line) {
        if (ch === " ") col += 1;
        else if (ch === "\t") col += 4 - (col % 4);
        else break;
    }
    return col;
}

// Same idea, but for a whitespace-only string ("  " after a list marker).
function wsWidth(str) {
    let col = 0;
    for (const ch of str) col += ch === "\t" ? 4 - (col % 4) : 1;
    return col;
}


/* ============================================================================
 * BLOCK REGEXES — how we spot "a new block starts on this line"
 * ----------------------------------------------------------------------------
 * CommonMark allows up to 3 leading spaces before block markers (4+ means
 * "this is code"). We keep that rule. We ALSO deliberately relax a couple of
 * things so that messy AI-pasted text still parses — see the ATX comment.
 * ========================================================================== */

// ``` or ~~~ fence, with an optional info string (usually the language name).
//   ```` js   <- opening fence, lang "js"
//   ````      <- closing fence
const FENCE_RE   = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

// ATX heading: 1-6 hashes. Real CommonMark REQUIRES a space after the hashes,
// so "#title" technically isn't a heading. But real AI output writes
// "#title" constantly, and being forgiving about that is THE point of this
// tool — so 0+ spaces are allowed here instead.
const ATX_RE    = /^ {0,3}(#{1,6})[ \t]*(.+)$/;

// Setext heading underline: a "=====" or "-----" line directly under a line
// of text turns that text into an h1 (==) or h2 (--).
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;

// Horizontal rule: "---", "***", "___" (spaces between chars allowed).
const HR_RE     = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

// Blockquote: "> text". Up to three leading spaces, then the ">".
const QUOTE_RE  = /^ {0,3}>[ \t]?(.*)$/;

// List item line. Captures leading ws, the marker (-, *, + or "1." / "1)"),
// the ws after the marker, and the item's first-line content.
const LIST_MARKER_RE = /^([ \t]*)([*+-]|\d{1,9}[.)])([ \t]+)(.*)$/;

// Task-list checkbox in item content: "[ ] do it", "[x] done", "[X] done".
const TASK_RE   = /^\[([ xX])\][ \t]+/;


/* ============================================================================
 * BLOCK PARSING
 * ============================================================================
 * Strategy: one pass down the lines. At each line, ask "what block starts
 * here?", eat that whole block, move on. Nesting (quote > list > paragraph)
 * is handled by RECURSION: grab the raw inner lines, strip the wrapper
 * ("> ", marker, indent), and hand them back to parseBlocks() — which loops
 * and figures out the inner structure. Depth is unlimited because each level
 * just calls itself again.
 *
 * ----------------------------------------------------------------------------
 * Public API
 * ----------------------------------------------------------------------------
 */
export function parse(text) {
    return { type: "document", children: parseBlocks(normalize(text).split("\n")) };
}

/* ----------------------------------------------------------------------------
 * parseBlocks(lines) — the dispatcher. Returns an array of block nodes.
 * The order of the if-chain matters! e.g. fences must be checked before
 * headings, lists before indented-code, etc. — comments flag those traps.
 * ----------------------------------------------------------------------------
 */
export function parseBlocks(lines) {
    const blocks = [];
    const n = lines.length;
    let i = 0;
    let blankLines = 0;

    // Keep the number of blank lines between blocks available to renderers.
    // The normal Markdown AST does not need this information, so it remains
    // metadata on the following block and is ignored by every non-HTML
    // renderer. The editor's optional Word-style mode uses it to avoid
    // collapsing repeated empty lines in the preview.
    const addBlock = (block) => {
        if (blankLines) block.gapBefore = blankLines;
        blocks.push(block);
        blankLines = 0;
    };

    while (i < n) {
        const line = lines[i];

        // ---- blank line: nothing here, skip ---------------------------------
        if (isBlank(line)) {
            blankLines++;
            i++;
            continue;
        }

        // ---- fenced code block: ```js ... ``` -------------------------------
        // Eat lines until the closing fence. If the fence is never closed we
        // run to the end of the document — friendly to unfinished pastes.
        const fence = line.match(FENCE_RE);
        if (fence) {
            const fenceChar = fence[1];                      // "```" or "~~~"
            const lang = (fence[2].trim().split(/[ \t]+/)[0] || undefined); // first word of info string
            const textLines = [];
            i++;
            while (i < n) {
                const close = lines[i].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
                // closing fence: same opening char, at least as many of them
                if (close && close[1][0] === fenceChar[0] && close[1].length >= fenceChar.length) {
                    i++;
                    break;
                }
                textLines.push(lines[i]);
                i++;
            }
            addBlock({ type: "code", lang, text: textLines.join("\n") });
            continue;
        }

        // ---- horizontal rule: ---  ***  ___ ----------------------------------
        if (HR_RE.test(line)) { addBlock({ type: "hr" }); i++; continue; }

        // ---- ATX heading: ## Hello -------------------------------------------
        const atx = line.match(ATX_RE);
        if (atx) {
            // "## Big ##" — trailing hashes are decoration, strip them.
            let headingText = (atx[2] ?? "").trim();
            headingText = headingText.replace(/[ \t]+#+[ \t]*$/, "");
            addBlock({ type: "heading", level: atx[1].length, children: parseInline(headingText) });
            i++;
            continue;
        }

        // ---- blockquote: > said the thing ------------------------------------
        // Grab every CONSECUTIVE ">" line, strip the "> ", recurse.
        // "> - a\n> - b" therefore becomes a blockquote holding a whole list,
        // which just works for free thanks to recursion.
        if (QUOTE_RE.test(line)) {
            const quoteLines = [];
            while (i < n && QUOTE_RE.test(lines[i])) {
                quoteLines.push(lines[i].match(QUOTE_RE)[1]);   // drop the "> "
                i++;
            }
            addBlock({ type: "blockquote", children: parseBlocks(quoteLines) });
            continue;
        }

        // ---- display maths: $$...$$ -------------------------------------------
        // A "$$" line opens a maths block: one line of "$$tex$$", or an opener
        // "$$" followed by tex lines until a closing "$$" (run to the end of
        // the document if never closed — friendly to unfinished pastes, like
        // fences). The tex is stored raw; the renderer decides how to draw it.
        if (/^ {0,3}\$\$/.test(line)) {
            const oneLine = line.match(/^ {0,3}\$\$(.*)\$\$[ \t]*$/);
            if (oneLine) {
                const tex = oneLine[1].trim();
                if (tex) { addBlock({ type: "math", tex, display: true }); i++; continue; }
            }
            const texLines = [];
            i++;
            while (i < n) {
                const close = lines[i].match(/^ {0,3}\$\$(.*)$/);
                if (close) {
                    const tail = close[1].trim();
                    if (tail) texLines.push(tail);   // "$$ tex $$" across two lines
                    i++;
                    break;
                }
                texLines.push(lines[i]);
                i++;
            }
            while (texLines.length && isBlank(texLines[texLines.length - 1])) texLines.pop();
            const tex = texLines.join("\n");
            if (tex) addBlock({ type: "math", tex, display: true });
            continue;
        }

        // ---- list: - item / 1. item -------------------------------------------
        // parseList eats the WHOLE list internally, so it must tell us which
        // line index it stopped at — otherwise the loop below would re-read
        // the first item line forever. (Learned that the hard way.)
        const listStart = matchListItem(line);
        if (listStart) {
            const { node, next } = parseList(lines, i, listStart);
            addBlock(node);
            i = next;
            continue;
        }

        // ---- indented code block (4 spaces, or a tab) -------------------------
        // Checked AFTER lists and quotes so an item's continuation lines can
        // never be mistaken for a code block by the top-level loop.
        if (/^( {4}|\t)/.test(line)) {
            const codeLines = [];
            while (i < n && (isBlank(lines[i]) || /^( {4}|\t)/.test(lines[i]))) {
                // strip exactly one 4-space indent (or tab) from each line
                codeLines.push(lines[i].replace(/^( {4}|\t)/, ""));
                i++;
            }
            // the greedy loop hoovered up trailing blanks — trim them
            while (codeLines.length && isBlank(codeLines[codeLines.length - 1])) codeLines.pop();
            addBlock({ type: "code", text: codeLines.join("\n") });
            continue;
        }

        // ---- pipe table: "| a | b |" over a "|---|" ruler ---------------------
        // A table is TWO committed lines: a header row that contains a pipe and
        // a delimiter row made of dashes (with optional alignment colons). No
        // delimiter → it's just a paragraph, so a stray "| a | b |" in prose
        // still falls through to the paragraph catch-all below.
        if (line.indexOf("|") >= 0 && i + 1 < n) {
            const ruler = splitCells(lines[i + 1]);
            const looksLikeTable = ruler.length > 0 &&
                ruler.every(c => /^:?-+:?$/.test(c)) &&
                ruler.some(c => c.includes("-"));
            if (looksLikeTable) {
                const { node, next } = parseTable(lines, i, line, lines[i + 1]);
                addBlock(node);
                i = next;
                continue;
            }
        }

        // ---- paragraph: the catch-all ------------------------------------------
        // Eat lines until something clearly starts a new block. One subtlety:
        // a "====" or "----" line right after text is a SETEXT heading, not a
        // new block — so we peek for that too.
        let setextLevel = null;
        const paraLines = [line];
        i++;
        while (i < n) {
            const next = lines[i];
            if (isBlank(next)) break;

            if (next.match(SETEXT_RE)) {            // text followed by "==" or "--"
                setextLevel = (next.match(/=/) ? 1 : 2);
                i++;                                 // consume the underline line
                break;
            }
            if (
                next.match(FENCE_RE) || next.match(ATX_RE) ||
                QUOTE_RE.test(next) || matchListItem(next) ||
                HR_RE.test(next) || /^( {4}|\t)/.test(next) ||
                /^ {0,3}\$\$/.test(next)
            ) break;

            paraLines.push(next);
            i++;
        }

        const paraChildren = parseInline(paraLines.join("\n"));
        addBlock(setextLevel
            ? { type: "heading", level: setextLevel, children: paraChildren }
            : { type: "paragraph", children: paraChildren });
    }

    return blocks;
}

/* ----------------------------------------------------------------------------
 * matchListItem(line) — is this line a list item marker?
 * Returns null, or { marker, ordered, content, contentCol }.
 *   contentCol = the column the item CONTENT starts at (indent + marker +
 *   following spaces, with tabs expanded). This number is how we tell
 *   siblings ("- b" right below "- a") from nested lists ("  - sub" under it).
 * ----------------------------------------------------------------------------
 */
function matchListItem(line) {
    const m = line.match(LIST_MARKER_RE);
    if (!m) return null;
    const marker = m[2];
    const ordered = /\d/.test(marker);
    const contentCol = leadingSpaces(line) + marker.length + wsWidth(m[3]);
    return { marker, ordered, content: m[4], contentCol };
}

/* ----------------------------------------------------------------------------
 * parseList(lines, start, first) — consume one whole list from the line stream.
 * Returns { node, next } where `next` is the index of the last line consumed
 * +1 (i.e. where block parsing should resume).
 * Rules (simplified on purpose):
 *   • an item = its marker line + everything more-indented that follows
 *   • a marker at the same-or-shallower indentation = the next sibling item
 *   • a marker indented DEEPER than the list's content column = a nested list
 *     INSIDE the current item (raw indentation is kept, so the item's own
 *     parseBlocks() pass sees it as an ordinary list and nests it)
 *   • blank lines make an item boundary only when followed by another marker;
 *     otherwise they're kept as internal breaks for the item's recursion
 * ----------------------------------------------------------------------------
 */
function parseList(lines, start, first) {
    const n = lines.length;
    const ordered = first.ordered;
    const startNum = ordered ? parseInt(first.marker, 10) : null;  // e.g. "3." → 3
    const contentIndent = first.contentCol; // the column siblings compare against
    const items = [];
    let i = start;

    while (i < n) {
        let m = matchListItem(lines[i]);

        // not a marker at all → this list is finished
        if (!m) break;
        // a marker of the other flavour ("1." vs "-") → CommonMark calls that
        // a DIFFERENT list. Stop; the main loop picks it up as a new list.
        if (m.ordered !== ordered) break;

        // ---- gather this item's raw lines ----
        const raw = [m.content];               // first line = text after the marker
        i++;
        while (i < n) {
            const nextLine = lines[i];
            const nextM = matchListItem(nextLine);

            if (isBlank(nextLine)) {
                // blank line: if another marker follows shortly, this item is
                // done (loose list — the blank separates the siblings).
                let j = i;
                while (j < n && isBlank(lines[j])) j++;
                const after = j < n ? matchListItem(lines[j]) : null;
                if (after && after.ordered === ordered) break;
                // otherwise it's an internal break / gap in nesting — keep it.
                raw.push(nextLine);
                i++;
                continue;
            }

            if (nextM) {
                // indented deeper than the list's content = nested list, keep
                if (nextM.contentCol > contentIndent) { raw.push(nextLine); i++; continue; }
                break; // same-or-shallower marker = next sibling → done
            }

            // A brand-new BLOCK starting at the top of the document (a fence,
            // heading, quote or horizontal rule) must END the list — those are
            // only ever "part of the item" if indented past our content column.
            // Without this, a ``` fence sitting under the list would get eaten
            // by the last item instead of becoming its own code block.
            if (
                leadingSpaces(nextLine) < contentIndent &&
                (nextLine.match(FENCE_RE) || nextLine.match(ATX_RE) ||
                 QUOTE_RE.test(nextLine) || HR_RE.test(nextLine))
            ) break;

            // non-marker line = continuation of this item. Its surviving
            // indentation tells the item's recursion what to make of it.
            raw.push(nextLine);
            i++;
        }

        // ---- task list booksitting ----
        // "- [x] done": detect and strip the checkbox so it doesn't render as
        // literal "[x]" text. `task`/`checked` are handed to the renderers.
        let task = false;
        let checked = false;
        if (raw.length && TASK_RE.test(raw[0])) {
            task = true;
            checked = TASK_RE.exec(raw[0])[1].toLowerCase() === "x";
            raw[0] = raw[0].replace(TASK_RE, "");
        }

        items.push({
            type: "listitem",
            task,
            ...(task ? { checked } : {}),
            children: parseBlocks(raw),
        });
    }

    // `next` = where parsing should resume (right after the last item line)
    return { node: { type: "list", ordered, start: startNum, items }, next: i };
}

/* ----------------------------------------------------------------------------
 * PIPE TABLES — the one "power" block kept on purpose.
 * ----------------------------------------------------------------------------
 * parseTable(lines, i, headLine, delimLine) consumes a table started on the
 * header line. Rows after the delimiter run until a blank line or a line
 * without a pipe — a brand-new paragraph ends the table. Every cell goes
 * through the normal INLINE parser, so **bold** and [links](url) inside a
 * table cell just work. Returns { node, next } like parseList does.
 */
function parseTable(lines, i, headLine, delimLine) {
    const n = lines.length;
    const align = splitCells(delimLine).map(cellAlign);
    const headers = splitCells(headLine).map(parseInline);
    const rows = [];
    let row = i + 2;
    while (row < n) {
        const line = lines[row];
        if (isBlank(line) || line.indexOf("|") < 0) break;
        rows.push(splitCells(line).map(parseInline));
        row++;
    }
    return { node: { type: "table", align, headers, rows }, next: row };
}

/* splitCells("| a | b |") → ["a", "b"]. Both "| a | b |" and bare "a | b"
 * work (leading/trailing pipes are optional), and a "\\|" is a literal pipe
 * inside a cell, not a separator. */
function splitCells(line) {
    let t = line.trim();
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|")) t = t.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let k = 0; k < t.length; k++) {
        const ch = t[k];
        if (ch === "\\" && t[k + 1] === "|") { cur += "|"; k++; }       // escaped pipe
        else if (ch === "|") { cells.push(cur.trim()); cur = ""; }
        else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
}

/* cellAlign(":---") → "left" | "center" | "right" | null. The delimiter row
 * is a pipe table's only alignment signal: colons on the ends put the content
 * against the fences ("---:" right, ":---" left) and both ends mean centered. */
function cellAlign(cell) {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.startsWith(":")) return "left";
    if (cell.endsWith(":")) return "right";
    return null;
}


/* ============================================================================
 * INLINE PARSING
 * ============================================================================
 * parseInline(text) — turns the words inside a paragraph/heading into a list
 * of inline nodes. One left-to-right scan: at each position we ask "does a
 * special thing start here?" (backtick, star, bracket, ...) and emit it;
 * everything in between accumulates as plain "text".
 *
 * Emphasis recurses, so "*a **b** c*" nests in parallel (strong inside
 * emphasis). The trick is findDelimiter's two-pass closer: an exact-length
 * run wins over a longer one, which is what makes nesting stay parallel
 * instead of "serial".
 *
 * Honest simplification: full CommonMark delimiter matching is a stack
 * machine with "flanking" rules — ours is a friendly approximation that
 * nails the 95% case and is MUCH easier to read. Really exotic spacing
 * (delimiters hugging punctuation mid-word, etc.) can still surprise.
 * That's a known trade — it keeps the code learnable.
 * ========================================================================== */

// The characters markdown lets you backslash-escape.
const PUNCT_ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

export function parseInline(text) {
    const out = [];
    let buf = "";                          // plain text waiting to be flushed

    // helper: dump buffered plain text as a text node
    const flush = () => { if (buf) { out.push({ type: "text", value: buf }); buf = ""; } };

    let i = 0;
    while (i < text.length) {
        const ch = text[i];

        // ---- backslash escape: \* renders a literal * ------------------------
        if (ch === "\\" && i + 1 < text.length && PUNCT_ESCAPABLE.test(text[i + 1])) {
            buf += text[i + 1];   // swallow both chars, keep only the escaped one
            i += 2;
            continue;
        }

        // ---- inline code: `...` ----------------------------------------------
        if (ch === "`") {
            const span = matchCodeSpan(text, i);
            if (span) { flush(); out.push({ type: "code", text: span.text }); i = span.end; continue; }
            buf += ch; i++;        // lone backtick: it's just text
            continue;
        }

        // ---- maths: $x$ and $$x$$ ----------------------------------------------
        // Detected BEFORE emphasis (and it's a distinct char, so order barely
        // matters) — the whole span is consumed in one step, which means the
        // `_`, `*`, `^` and backslashes inside the tex (e.g. \lim_{x\to 0})
        // can never be chewed up by the bold/italic/strike rules.
        if (ch === "$") {
            const display = text[i + 1] === "$";
            const closer = findDelimiter(text, i + (display ? 2 : 1), "$", display ? 2 : 1);
            if (closer) {
                const tex = text.slice(i + (display ? 2 : 1), closer.index);
                // sanity: non-empty, single-line, no leading/trailing space —
                // so "$5.00" and "a $ b" stay ordinary text. (Escape a lone
                // dollar as "\$" if you really mean it.)
                const first = tex[0], last = tex[tex.length - 1];
                if (tex.length && tex.indexOf("\n") === -1 && first !== " " && first !== "\t" && last !== " " && last !== "\t") {
                    flush();
                    out.push({ type: "math", tex, display });
                    i = closer.end;
                    continue;
                }
            }
            buf += ch; i++;
            continue;
        }

        // ---- image: ![alt](url) ----------------------------------------------
        if (ch === "!" && text[i + 1] === "[") {
            const link = matchLink(text, i + 1);
            if (link) {
                flush();
                out.push({
                    type: "image",
                    url: link.url,
                    ...(link.title ? { title: link.title } : {}),
                    alt: link.label,          // alt text; "report.md" etc
                });
                i = link.end + 1;  // +1 because we already consumed the "!"
                continue;
            }
            buf += ch; i++;
            continue;
        }

        // ---- link: [text](url) ------------------------------------------------
        if (ch === "[") {
            const link = matchLink(text, i);
            if (link) {
                flush();
                out.push({
                    type: "link",
                    url: link.url,
                    ...(link.title ? { title: link.title } : {}),
                    children: parseInline(link.label),
                });
                i = link.end;
                continue;
            }
            buf += ch; i++;
            continue;
        }

        // ---- autolink: <https://...> or <you@mail.com> --------------------------
        if (ch === "<") {
            // matches either "scheme:rest" or a bare email address
            const m = text.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9+.\-]{1,31}:[^ \t\n<>]+|[^ \t\n<>@]+@[^ \t\n<>@]+)>/);
            if (m) {
                flush();
                const url = m[1].includes("@") && !m[1].includes(":") ? "mailto:" + m[1] : m[1];
                out.push({ type: "link", url, children: [{ type: "text", value: m[1] }] });
                i += m[0].length;
                continue;
            }
            // fall through: maybe it's raw html (checked later)
        }

        // ---- bare URL: a raw https://... sitting in the sentence ----------------
        // AI text litters bare links everywhere, so we walk them into link
        // nodes. Trailing-punctuation trim stops "Visit https://x.com." eating
        // the full stop. We also require a sane char BEFORE so "abc.https://x"
        // doesn't link the middles of words.
        {
            const rest = text.slice(i);
            const m = rest.match(/^(?:https?:\/\/|www\.)[^\s<>()]+/);
            if (m && (i === 0 || /[\s(<]/.test(text[i - 1]))) {
                let url = m[0];
                const trimmed = url.replace(/[.,;:!?'")\]]+$/, "");   // backpedal junk
                if (trimmed === "https://" || trimmed === "http://" || trimmed === "www.") {
                    // nothing useful after the scheme — leave it as text
                } else {
                    url = trimmed;
                    flush();
                    out.push({
                        type: "link",
                        url: url.startsWith("www.") ? "http://" + url : url,
                        children: [{ type: "text", value: url }],
                    });
                    i += m[0].length;
                    continue;
                }
            }
        }

        // ---- inline raw HTML: <span class="x"> ------------------------------
        // Pass through verbatim. NOTE: whatever you feed this tool is rendered
        // into the preview without interrogation — it's your own text, and
        // trusting it is YOUR call, not the parser's.
        if (ch === "<") {
            const m = text.slice(i).match(/^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*?)?\/?>/);
            if (m) { flush(); out.push({ type: "html", value: m[0] }); i += m[0].length; continue; }
            buf += ch; i++;
            continue;
        }

        // ---- strong / emphasis: **x**, *x*, __x__, _x_ -------------------------
        if (ch === "*" || ch === "_") {
            const resume = parseEmphasisOrStrong(text, i, ch, flush, out);
            if (resume != null) {
                // parseEmphasisOrStrong already flushed + pushed its node(s)
                i = resume;
                continue;
            }
            buf += ch; i++;
            continue;
        }

        // ---- strikethrough: ~~x~~ ---------------------------------------------
        // Not real CommonMark, but every AI writes `~~text~~`, so support it.
        if (ch === "~" && text[i + 1] === "~") {
            const closer = findDelimiter(text, i + 2, "~", 2);
            if (closer) {
                flush();
                out.push({ type: "strikethrough", children: parseInline(text.slice(i + 2, closer.index)) });
                i = closer.end;
                continue;
            }
            buf += "~~"; i += 2;
            continue;
        }

        // ---- line breaks -------------------------------------------------------
        if (ch === "\n") {
            // two spaces before the newline = HARD break (forces a new line),
            // otherwise a SOFT break (just a line wrap inside the paragraph).
            if (buf.endsWith("  ")) {
                buf = buf.slice(0, -2);
                flush();
                out.push({ type: "hardbreak" });
            } else {
                flush();
                out.push({ type: "softbreak" });
            }
            i++;
            continue;
        }

        // ---- plain character — nothing special here ----------------------------
        buf += ch;
        i++;
    }

    flush();
    return out;
}

/* ----------------------------------------------------------------------------
 * parseEmphasisOrStrong — the meaty inline one.
 *
 * Rule: the OPENING delimiter is the whole run we just bumped into ("**", "*",
 * "***"). The CLOSER is the next matching run of the length we need:
 *   run of 1  → emphasis, closer also 1      (*x*)
 *   run of 2  → strong,   closer also 2      (**x**)
 *   run of 3+ → strong wrapping emphasis     (***x***, belt and braces)
 *
 * Underscore delimiters must sit at word boundaries, so "file_name" stays one
 * word — matching that incorrectly would drive anyone mad.
 *
 * Returns where scanning should resume, or null if we never found a closer
 * (in which case the caller emits the delimiter as plain text).
 * ----------------------------------------------------------------------------
 */
function parseEmphasisOrStrong(text, start, ch, flush, out) {
    // length of the delimiter run we're staring at
    let run = 0;
    while (text[start + run] === ch) run++;

    // we pair the WHOLE opener run against a closer run of the same size.
    // run 1 → *x* emphasis; run 2 → **x** strong; run 3+ → ***x*** strong+em.
    const uselen = run;

    // scan for the closer AFTER the whole opening run (start + run)
    const closer = findDelimiter(text, start + run, ch, uselen);
    if (!closer) return null;

    // word-boundary guard for underscores: refuse if either side of the
    // opener OR the closer touches a word character ("a_b" is not italic)
    if (ch === "_") {
        if (/[A-Za-z0-9]/.test(text[start - 1] || " ") || /[A-Za-z0-9]/.test(text[start + run] || " ")) return null;
        if (/[A-Za-z0-9]/.test(text[closer.index - 1] || " ") || /[A-Za-z0-9]/.test(text[closer.end] || " ")) return null;
    }

    const inner = text.slice(start + run, closer.index);
    const children = parseInline(inner);

    flush();
    if (run === 1) {
        out.push({ type: "emphasis", children });
    } else if (run === 2) {
        out.push({ type: "strong", children });
    } else {
        // 3+ stars: bold AND italics. Strong outside, emphasis inside.
        out.push({ type: "strong", children: [{ type: "emphasis", children }] });
    }
    return closer.end;
}

/* ----------------------------------------------------------------------------
 * findDelimiter(text, from, ch, len)
 * Scans forward for a closer made of `len` copies of `ch`.
 *
 * Two passes, and the ORDER matters:
 *   1. an EXACT-length run wins first. This is what keeps nested emphasis in
 *      parallel: "*outer **strong** inner*" needs the outer `*` to pair with
 *      the final `*`, skipping over the `**` runs entirely. If we just took
 *      the first star we saw, the outer `*` would close early on a star that
 *      belongs to the strong — the "serial" bug.
 *   2. only if NO exact run exists do we use the tail of a LONGER run, so
 *      "**bold *and italic***" can still close its "**" against the end "***".
 * Returns { index, end } of the closer, or null.
 * ----------------------------------------------------------------------------
 */
function findDelimiter(text, from, ch, len) {
    // pass 1 — exact-length run
    let k = from;
    while (k + len <= text.length) {
        if (text[k] === "\\") { k += 2; continue; }        // escaped — hop over
        if (text[k] !== ch) { k++; continue; }
        let run = 0;
        while (text[k + run] === ch) run++;
        if (run === len) return { index: k, end: k + len };
        k += run;                                          // skip the whole run
    }
    // pass 2 — tail of a longer run ("***" can provide a "**" closer)
    k = from;
    while (k + len <= text.length) {
        if (text[k] === "\\") { k += 2; continue; }
        if (text[k] !== ch) { k++; continue; }
        let run = 0;
        while (text[k + run] === ch) run++;
        if (run > len) return { index: k + run - len, end: k + run };
        k += run;
    }
    return null;
}

/* ----------------------------------------------------------------------------
 * matchCodeSpan(text, i) — parse "`code`" (or "`` code ``" for backticks that
 * want to contain a backtick). Returns { text, end } or null at a lone `.
 * ----------------------------------------------------------------------------
 */
function matchCodeSpan(text, i) {
    let run = 1;
    while (text[i + run] === "`") run++;
    const marker = "`".repeat(run);

    let j = i + run;
    while (j <= text.length - run) {
        if (text[j] !== "`") { j++; continue; }
        let r = 0;
        while (text[j + r] === "`") r++;
        if (r === run) {   // closing run of EXACTLY the same length
            let inner = text.slice(i + run, j);
            // newlines inside a code span become spaces (CommonMark rule)
            inner = inner.replace(/\n/g, " ");
            // a span wrapped in spaces collapses them (so " ` x ` " → "x")
            if (inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()) {
                inner = inner.slice(1, -1);
            }
            return { text: inner, end: j + run };
        }
        j += r;   // longer/shorter run: not our closer, keep scanning past it
    }
    return null;
}

/* ----------------------------------------------------------------------------
 * matchLink(text, i) — parse "[label](url "title")" starting at the "[".
 * Returns { label, url, title, end } or null.
 * ----------------------------------------------------------------------------
 */
function matchLink(text, i) {
    // find the closing "]" of the label (no nested brackets support — rare)
    let close = -1;
    for (let k = i + 1; k < text.length; k++) {
        if (text[k] === "[") return null;      // nested label: bail (keep simple)
        if (text[k] === "]") { close = k; break; }
    }
    if (close === -1) return null;

    let j = close + 1;
    if (text[j] !== "(") return null;

    // find the matching ")" allowing balanced parens inside (URLs with parens)
    let depth = 0;
    let end = -1;
    for (let k = j; k < text.length; k++) {
        if (text[k] === "\\") { k++; continue; }
        if (text[k] === "(") depth++;
        else if (text[k] === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end === -1) return null;

    // the inside: optional <url>, then an optional quoted/paren title
    const target = text.slice(j + 1, end).trim();
    const tm = target.match(
        /^(?:<([^<>]*)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?$/
    );
    if (!tm) return null;

    const url = tm[1] ?? tm[2] ?? "";
    const title = tm[3] ?? tm[4] ?? tm[5] ?? "";
    return { label: text.slice(i + 1, close), url, title, end: end + 1 };
}
