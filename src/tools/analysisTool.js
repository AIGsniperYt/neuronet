import { createEditor, parse, render, domToMarkdown, renderMathWithKatex } from "../vendor/md-format/mdeditor.js";
import { dialog } from "./dialog.js";

export async function initAnalysisToolV2(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    getAllCues,
    getAllTags,
    getNode,
    addNode,
    addQuote,
    addTag,
    getQuote,
    deleteQuote,
    deleteCue,
    backupLocalNodesToCloud,
    removeNodeEverywhere,
    removeQuoteEverywhere,
    normalizeHierarchyPath,
    buildSection,
    parseTags,
    escapeHtml,
    getNodeTimestamp,
    isSourceNode,
    addCue,
    getCuesForQuote,
    removeCueEverywhere,
    findExistingQuote,
    findExistingQuoteByText,
    linkAnalysisToQuote,
    unlinkAnalysisFromQuote,
    getFormattedQuote,
    resolveQuoteInSource,
    recordActivity,
    toast
  } = deps;

  let textMap = null;

  const { subject: contextSubject, nodeId: contextNodeId } = context;
  const draftSourceId = context.newSource
    ? (context.sourceId || crypto.randomUUID())
    : "";

  if (typeof window.__neuronetAnalysisCleanup === "function") {
    window.__neuronetAnalysisCleanup();
  }

  const launchpadView = document.getElementById("analysisLaunchpad");
  const studyView = document.getElementById("studyView");
  const analysisStats = document.getElementById("analysisStats");
  const subjectList = document.getElementById("subjectList");
  const newSubjectName = document.getElementById("newSubjectName");
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  const toggleSubjectEdit = document.getElementById("toggleSubjectEdit");
  const backToLaunchpad = document.getElementById("backToLaunchpad");
  const studySubjectTitle = document.getElementById("studySubjectTitle");
  const sourceSelect = document.getElementById("sourceSelect");
  const sourceNavigatorBtn = document.getElementById("sourceNavigatorBtn");
  const sourceLibraryView = document.getElementById("sourceLibraryView");
  const sourceLibrarySubjects = document.getElementById("sourceLibrarySubjects");
  const sourceLibraryCount = document.getElementById("sourceLibraryCount");
  const sourceNavigatorSearch = document.getElementById("sourceNavigatorSearch");
  const sourceNavigatorNew = document.getElementById("sourceNavigatorNew");
  const sourceNavigatorRecent = document.getElementById("sourceNavigatorRecent");
  const sourceNavigatorList = document.getElementById("sourceNavigatorList");
  const sourceNavigatorEmpty = document.getElementById("sourceNavigatorEmpty");
  const layer1Select = document.getElementById("layer1Select");
  const layer2Select = document.getElementById("layer2Select");
  const layer3Select = document.getElementById("layer3Select");
  const deleteSourceBtn = document.getElementById("deleteSourceBtn");
  const saveSourceBtn = document.getElementById("saveSourceBtn");
  const sourceForm = document.getElementById("sourceForm");
  const sourceIdInput = document.getElementById("sourceId");
  const sourceSubjectInput = document.getElementById("sourceSubject");
  const sourceTitleInput = document.getElementById("sourceTitle");
  const sourceLevel1Input = document.getElementById("sourceLevel1");
  const sourceLevel2Input = document.getElementById("sourceLevel2");
  const sourceLevel3Input = document.getElementById("sourceLevel3");
  const sourceEditor = document.getElementById("sourceEditor");

  // Soft line breaks: the library is markdown-first (softBreaks OFF by
  // default). Neuronet opts IN by default so the editor behaves like a regular
  // word processor (single Enter = new line). The choice is remembered both
  // account-wide (default for new documents) and per document (meta).
  const SOFT_BREAKS_KEY = "nn-analysis-soft-breaks";
  function getSoftBreaksDefault() {
    try { return localStorage.getItem(SOFT_BREAKS_KEY) !== "0"; } catch { return true; }
  }
  function setSoftBreaksDefault(on) {
    try { localStorage.setItem(SOFT_BREAKS_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  }
  function sourceSoftBreaks(source) {
    if (source && typeof source.meta?.softBreaks === "boolean") return source.meta.softBreaks;
    return getSoftBreaksDefault();
  }
  const mdEditor = createEditor(sourceEditor, {
    view: "preview",
    storage: false,
    softBreaks: getSoftBreaksDefault(),
    onSoftBreaksChange: setSoftBreaksDefault
  });
  const newSourceBtn = document.getElementById("newSourceBtn");
  const studyGrid = document.querySelector(".study-grid");
  const analysisReader = document.getElementById("analysisReader");
  const analysisShell = document.querySelector(".analysis-shell");
  const resetAnalysisFormBtn = document.getElementById("resetAnalysisForm");
  const closeAnalysisCardBtn = document.getElementById("closeAnalysisCard");
  const analysisNodeIdInput = document.getElementById("analysisNodeId");
  const analysisNotesInput = document.getElementById("analysisNotes");
  const analysisTagsInput = document.getElementById("analysisTags");
  const analysisCleanupModal = document.getElementById("analysisCleanupModal");
  const analysisCleanupMessage = document.getElementById("analysisCleanupMessage");
  const analysisCleanupSummary = document.getElementById("analysisCleanupSummary");
  const analysisCleanupClose = document.getElementById("analysisCleanupClose");
  const analysisCleanupKeepBtn = document.getElementById("analysisCleanupKeepBtn");
  const analysisCleanupDeleteBtn = document.getElementById("analysisCleanupDeleteBtn");
  const analysisForm = document.getElementById("analysisForm");
  const analysisFloatCard = document.getElementById("analysisFloatCard");
  const cueFloatCard = document.getElementById("cueFloatCard");
  const analysisNodeList = document.getElementById("analysisNodeList");
  const readerWrapper = document.getElementById("readerWrapper");
  const editorWrapper = document.getElementById("editorWrapper");
  const quoteSelectionBtn = document.getElementById("quoteSelectionBtn");
  const toggleSourceModeBtn = document.getElementById("toggleSourceModeBtn");
  const cancelEditSourceBtn = document.getElementById("cancelEditSourceBtn");
  const quoteRefsListContainer = document.getElementById("quoteRefsList");
  const addQuoteRefBtn = document.getElementById("addQuoteRefBtn");
  const currentHierarchy = document.getElementById("currentHierarchy");
  const addAnalysisNodeBtn = document.getElementById("addAnalysisNodeBtn");
  const analysisCardKicker = document.getElementById("analysisCardKicker");
  const analysisSubmitBtn = document.getElementById("analysisSubmitBtn");

  // NEW: Parent choice modal elements
  const analysisParentModal = document.getElementById("analysisParentModal");
  const analysisParentMessage = document.getElementById("analysisParentMessage");
  const analysisParentToSourceBtn = document.getElementById("analysisParentToSourceBtn");
  const analysisParentToSubjectBtn = document.getElementById("analysisParentToSubjectBtn");
  const analysisParentClose = document.getElementById("analysisParentClose");

  if (!launchpadView || !studyView || !analysisForm || !analysisReader) {
    console.error("[ANALYSIS] Critical DOM elements missing. Analysis tool cannot initialize.", {
      launchpadView: !!launchpadView,
      studyView: !!studyView,
      analysisForm: !!analysisForm,
      analysisReader: !!analysisReader
    });
    return;
  }

function enforceUserSelect() {
    if (analysisReader) {
      analysisReader.style.userSelect = "text";
      analysisReader.style.webkitUserSelect = "text";
    }
  }
  // Run once after init for the reader area
  setTimeout(enforceUserSelect, 50);

  const allowedTags = new Set(["P","DIV","BR","STRONG","B","EM","I","U","UL","OL","LI","BLOCKQUOTE","H1","H2","H3","A"]);
  const state = {
    nodes: [],
    quotes: [],           // NEW: separate quote nodes
    cues: [],             // NEW: cue nodes for memory
    subjectNodes: [],
    sources: [],
    analysisNodes: [],
    selectedSubject: "",
    view: context.newSource || context.capture || context.subject || context.sourceId ? "study" : "library",
    libraryReturnView: "library",
    selectedSourceId: context.newSource ? "" : (context.sourceId || ""),
    draftSourceId,
    selectedRange: null,
    subjectEditMode: false,
    analysisEditMode: false,
    quoteEditMode: false, // NEW: for editing quotes
    wasInStudy: false,
    // Source editing is the primary workspace. The rendered reader remains
    // available through the explicit "View Reader" toggle.
    viewMode: context.sourceMode === "reader" ? "reader" : "editor",
    isCreatingSource: Boolean(context.newSource),
    focusedNodeId: null,
    /** When set, only this "start-end" highlight is active for the focused analysis (multi-quote UX). */
    focusedRangeKey: null,
    selectedQuoteRef: null, // NEW: for quote picker in analysis form
    cueEditMode: false,     // NEW: for editing cue nodes
    analysisSessionCreatedQuoteIds: [],
    lastLayer1Value: null
  };

  function rememberWorkspace() {
    if (typeof recordActivity !== "function") return;
    // A blank New draft is not resumable and must not erase the last saved
    // source from the dashboard's Resume action.
    if (state.isCreatingSource) return;
    recordActivity({
      subject: state.selectedSubject,
      sourceId: state.selectedSourceId,
      sourceTitle: getSourceById(state.selectedSourceId)?.title || "",
      sourceMode: state.viewMode
    });
  }

  function rebuildTextMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const map = [];
    let index = 0, node;

    while ((node = walker.nextNode())) {
      const length = node.nodeValue.length;
      map.push({ node, start: index, end: index + length });
      index += length;
    }

    textMap = map;
  }

  // A source can be intentionally unfiled. Enter the workspace when the
  // caller supplies either a subject or a concrete source, rather than
  // treating an empty subject as a reason to return to the launchpad.
  if (contextSubject || context.sourceId || context.newSource) {
    state.selectedSubject = contextSubject;
    state.view = "study";
  }

  // Capture mode: open straight into the source editor in the "Unfiled" bucket,
  // so users can start typing/pasting immediately without picking a subject.
  if (context.capture) {
    state.view = "study";
    if (!contextSubject) state.selectedSubject = "";
    state.selectedSourceId = "";
    state.viewMode = "editor";
    context.nodeId = null;
  }

  function htmlToMarkdown(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return mdNormalize(domToMarkdown(div) || "");
  }

  /* Legacy HTML → markdown round trips leave junk the parser turns back into
   * invisible blocks: a <br> inside a blockquote becomes a hardbreak that
   * domToMarkdown serialises as an empty '> >' line, which re-parses to an
   * empty nested blockquote → blank space in the reader/preview. Normalise the
   * markdown at the load boundary so both the reader and the editor agree. */
  function mdNormalize(md) {
    if (!md) return md;
    return md
      .split("\n")
      .filter((line) => !line.trim().match(/^>[\s>]*$/)) // drop empty blockquote markers ("> ", "> >")
      .join("\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .replace(/^\s+/, "")
      .replace(/\s+$/, "");
  }

  function sourceMarkdown(source) {
    if (!source) return "";
    let md = "";
    if (source.contentMarkdown) md = source.contentMarkdown;
    else if (source.contentHtml) md = htmlToMarkdown(source.contentHtml);
    else md = source.content || "";
    return mdNormalize(md);
  }


  function clampPriority(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 3;
    return Math.min(5, Math.max(1, Math.round(num)));
  }

  function getPriorityColor(priority) {
    switch (clampPriority(priority)) {
      case 1: return "#9aa4ad";
      case 2: return "#4ba3ff";
      case 3: return "#3fd07d";
      case 4: return "#ff9b39";
      case 5: return "#ff4d4d";
      default: return "#3fd07d";
    }
  }

  function cloneQuoteRef(ref = {}) {
    return {
      quoteId: ref.quoteId || crypto.randomUUID(),
      section: ref.section || "",
      quote: ref.quote || "",
      sourceId: ref.sourceId,
      start: Number.isFinite(Number(ref.start)) ? Number(ref.start) : undefined,
      end: Number.isFinite(Number(ref.end)) ? Number(ref.end) : undefined,
      priority: clampPriority(ref.priority)
    };
  }

  function buildQuoteRefFromQuoteNode(quoteNode) {
    const quote = quoteNode.quote || "";
    const sourceId = quoteNode.link?.sourceId || quoteNode.sourceId;
    const start = Number.isFinite(Number(quoteNode.link?.start)) ? Number(quoteNode.link.start) : undefined;
    const end = Number.isFinite(Number(quoteNode.link?.end)) ? Number(quoteNode.link.end) : undefined;
    // Skip building ref if critical data is missing
    if (!quote || !sourceId || start == null || end == null) {
      console.warn("buildQuoteRefFromQuoteNode: skipping broken quote node", quoteNode.id, { quote, sourceId, start, end });
      return null;
    }
    return {
      quoteId: quoteNode.id,
      section: quoteNode.section || "",
      quote,
      sourceId,
      start,
      end,
      priority: clampPriority(quoteNode.priority)
    };
  }

  function getSelectedQuoteRefs() {
    return Array.isArray(state.selectedQuoteRef) ? state.selectedQuoteRef : [];
  }

  function resetAnalysisSessionCreatedQuotes() {
    state.analysisSessionCreatedQuoteIds = [];
  }

  function markQuoteCreatedForAnalysisSession(quoteId) {
    if (!quoteId) return;
    if (!Array.isArray(state.analysisSessionCreatedQuoteIds)) {
      state.analysisSessionCreatedQuoteIds = [];
    }
    if (!state.analysisSessionCreatedQuoteIds.includes(quoteId)) {
      state.analysisSessionCreatedQuoteIds.push(quoteId);
    }
  }

  function getAnalysisSessionCreatedQuoteIds() {
    return Array.isArray(state.analysisSessionCreatedQuoteIds) ? state.analysisSessionCreatedQuoteIds : [];
  }

  function isCreatingAnalysisDraft() {
    return !state.analysisEditMode && !analysisNodeIdInput?.value;
  }

function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";

  const blockTags = new Set([
    "P", "DIV", "BLOCKQUOTE", "H1", "H2", "H3", "UL", "OL", "LI"
  ]);

  const result = [];
  let lastWasSpeaker = false;

  function addLineBreak(force = false) {
    if ((result.length && result[result.length - 1] !== "") || force) {
      result.push("");
    }
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.nodeValue || "";
      text = text.replace(/[ \t]+/g, " ");
      if (text.trim()) {
        result.push(text.trim());
        lastWasSpeaker = false;
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toUpperCase();

    const isBlock = blockTags.has(tag);
    const isSpeaker = tag === "B" || tag === "STRONG";
    const isStage = tag === "I" || tag === "EM";
    const isBreak = tag === "BR";

    // Break tag: just add a simple newline
    if (isBreak) {
      if (result.length && result[result.length - 1] !== "") {
        result.push("");
      }
      return;
    }

    // Stage directions: separate with newline
    if (isStage && !lastWasSpeaker) {
      addLineBreak();
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    // After speaker (bold): no break yet, wait for content
    if (isSpeaker) {
      lastWasSpeaker = true;
      return;
    }

    // After block: add break if not immediately after a speaker
    if (isBlock && !lastWasSpeaker) {
      addLineBreak();
    } else if (isBlock && lastWasSpeaker) {
      // After blockquote following a speaker: add single break
      addLineBreak();
      lastWasSpeaker = false;
    }

    if (isStage && lastWasSpeaker) {
      lastWasSpeaker = false;
    }
  }

  walk(div);

  return result
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

  function plainTextToHtml(text) {
    const lines = String(text || "").split("\n");
    const result = [];
    let emptyCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        emptyCount++;
      } else {
        // If we had empty lines, add newlines to represent the gaps
        if (emptyCount > 0) {
          for (let i = 0; i < emptyCount; i++) {
            result.push("<br>");
          }
          emptyCount = 0;
        }
        result.push(`${escapeHtml(line)}`);
      }
    }

    // Handle trailing empty lines - add gaps
    if (emptyCount > 0) {
      for (let i = 0; i < emptyCount; i++) {
        result.push("<br>");
      }
    }

    // If we only have one line with no newlines, still need to add <br> for single newline breaks
    if (result.length === 0) {
      return escapeHtml(text || "");
    }
    if (result.length === 1 && !text.includes("\n")) {
      return escapeHtml(text);
    }

    // Join lines with <br> between them
    return result.join("<br>");
  }

  function formatQuoteForDisplay(textOrRef, fallbackText = "") {
    if (typeof textOrRef === "object" && textOrRef !== null) {
      const sourceId = textOrRef.sourceId || textOrRef.link?.sourceId;
      if (sourceId) {
        const source = getSourceById(sourceId);
        if (source) {
          const fakeQuoteNode = {
             quote: textOrRef.quote || fallbackText,
             link: textOrRef.link || {
               start: textOrRef.start,
               end: textOrRef.end,
               prefix: textOrRef.prefix,
               suffix: textOrRef.suffix,
               context: textOrRef.context || textOrRef.link?.context
             }
          };
          return getFormattedQuote(fakeQuoteNode, source);
        }
      }
    }

    const plainQuoteText = typeof textOrRef === "string" ? textOrRef : (textOrRef?.quote || fallbackText || "");
    return escapeHtml(plainQuoteText).replace(/\n/g, "<br>");
  }

  function getFormattedFromSource(source, start, end) {
    const html = source.contentHtml;
    if (!html) return null;

    const temp = document.createElement("div");
    temp.innerHTML = html;
    const fullText = temp.textContent || "";

    const safeStart = Math.max(0, Math.min(start, fullText.length));
    const safeEnd = Math.max(safeStart, Math.min(end, fullText.length));

    if (safeEnd <= safeStart) return null;

    let pos = 0;
    const parts = [];
    let lastBlockTag = null;
    const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null, false);
    let node = walker.nextNode();

    while (node) {
      const text = node.nodeValue || "";
      const nodeStart = pos;
      const nodeEnd = pos + text.length;

      if (nodeEnd > safeStart && nodeStart < safeEnd) {
        const sliceStart = Math.max(0, safeStart - nodeStart);
        const sliceEnd = Math.min(text.length, safeEnd - nodeStart);

        if (sliceStart < sliceEnd) {
          const slice = text.slice(sliceStart, sliceEnd);

          // Walk UP to find block and formatting
          let parent = node.parentElement;
          let blockTag = null;
          let hasBold = false;
          let hasItalic = false;

          while (parent) {
            const tag = parent.tagName?.toUpperCase();
            if (!blockTag && ["DIV", "P", "BLOCKQUOTE", "LI", "H1", "H2", "H3"].includes(tag)) {
              blockTag = tag;
            }
            if (tag === "B" || tag === "STRONG") hasBold = true;
            if (tag === "I" || tag === "EM") hasItalic = true;
            if (tag === "BODY") break;
            parent = parent.parentElement;
          }

          // Add line break when entering new block
          if (parts.length > 0 && blockTag && blockTag !== lastBlockTag) {
            parts.push("<br>");
          }

          let formatted = escapeHtml(slice);
          if (hasBold) formatted = `<strong>${formatted}</strong>`;
          if (hasItalic) formatted = `<em>${formatted}</em>`;

          parts.push(formatted);
          lastBlockTag = blockTag;
        }
      }

      pos = nodeEnd;
      node = walker.nextNode();
      if (pos >= safeEnd) break;
    }

    return parts.length > 0 ? parts.join("") : null;
  }

  function sanitizeRichHtml(input, isPlainText = false) {
    const parser = new DOMParser();
    const raw = isPlainText ? plainTextToHtml(input) : String(input || "");
    const doc = parser.parseFromString(`<div>${raw}</div>`, "text/html");
    let container = doc.body.firstElementChild;
    const outDoc = document.implementation.createHTMLDocument("");
    const root = outDoc.createElement("div");

    const blockTags = new Set(["P", "DIV", "BLOCKQUOTE", "H1", "H2", "H3", "UL", "OL", "LI"]);

    function sanitizeNode(node, targetParent) {
      if (node.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(outDoc.createTextNode(node.nodeValue || ""));
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toUpperCase();

      if (!allowedTags.has(tag)) {
        const wrapper = outDoc.createElement("div");
        Array.from(node.childNodes).forEach((child) => sanitizeNode(child, wrapper));
        targetParent.appendChild(wrapper);
        return;
      }

      if (tag === "A") {
        Array.from(node.childNodes).forEach((child) => sanitizeNode(child, targetParent));
        return;
      }

      if (tag === "P") {
        const hasDirectText = Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.nodeValue || "").trim()
        );
        const hasBlockChildren = Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.ELEMENT_NODE && blockTags.has(child.tagName.toUpperCase())
        );

        if (!hasDirectText && !hasBlockChildren) {
          Array.from(node.childNodes).forEach((child) => sanitizeNode(child, targetParent));
          return;
        }
      }

      const canonical = tag === "B" ? "STRONG" : tag === "I" ? "EM" : tag;
      const clean = outDoc.createElement(canonical.toLowerCase());
      Array.from(node.childNodes).forEach((child) => sanitizeNode(child, clean));
      targetParent.appendChild(clean);
    }

    if (container) {
      Array.from(container.childNodes).forEach((child) => sanitizeNode(child, root));
    }

    const html = root.innerHTML || "<p><br></p>";
    return {
      contentHtml: html,
      contentText: htmlToPlainText(html)
    };
  }

  function normalizeSource(source) {
    if (!source) return { contentHtml: "<p><br></p>", contentText: "" };
    if (source.contentHtml) {
      return {
        contentHtml: source.contentHtml,
        contentText: source.contentText || htmlToPlainText(source.contentHtml)
      };
    }

    const fallbackText = source.content || "";
    return {
      contentHtml: plainTextToHtml(fallbackText),
      contentText: fallbackText
    };
  }

  function setSourceViewMode(mode) {
    state.viewMode = mode === "editor" ? "editor" : "reader";
    const isEditor = state.viewMode === "editor";

    if (readerWrapper && editorWrapper) {
      readerWrapper.classList.toggle("hidden", isEditor);
      editorWrapper.classList.toggle("hidden", !isEditor);
    }

    if (toggleSourceModeBtn) {
      toggleSourceModeBtn.textContent = isEditor ? "View Reader" : "Edit Source";
    }

    if (studyGrid) {
      studyGrid.classList.toggle("editor-expanded", isEditor);
    }

    // Show/hide save and cancel buttons based on edit mode
    if (saveSourceBtn) {
      saveSourceBtn.classList.toggle("visible", isEditor);
    }
    if (cancelEditSourceBtn) {
      cancelEditSourceBtn.classList.toggle("visible", isEditor);
    }

    if (!isEditor) {
      hideQuoteButton();
    }
    rememberWorkspace();
  }

  function showQuoteButton(range) {
    if (!quoteSelectionBtn || !range || !readerWrapper) return;
    try {
      const rect = range.getBoundingClientRect();
      const wrapperRect = readerWrapper.getBoundingClientRect();

      const top = rect.top - wrapperRect.top - 42;
      const left = rect.left - wrapperRect.left;

      quoteSelectionBtn.style.top = `${Math.max(10, Math.min(top, wrapperRect.height - 45))}px`;
      quoteSelectionBtn.style.left = `${Math.max(10, Math.min(left, wrapperRect.width - 140))}px`;
      quoteSelectionBtn.style.display = "block";
    } catch (err) {
      if (quoteSelectionBtn) quoteSelectionBtn.style.display = "none";
    }
  }

  function hideQuoteButton() {
    if (!quoteSelectionBtn) return;
    quoteSelectionBtn.style.display = "none";
  }

  function clearAllHighlights(root) {
    if (!root) return;

    const highlights = root.querySelectorAll(".highlight-quote");

    for (const span of highlights) {
      const parent = span.parentNode;
      if (!parent) continue;

      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }

      parent.removeChild(span);
    }

    // CRITICAL for your system (keeps indexing consistent)
    root.normalize();
  }

  function wrapTextRange(root, start, end, className, dataFocusId, dataRangeKey) {
    try {
      // Validate inputs - prevent invalid array operations
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      if (start < 0 || end < 0) return;
      if (end <= start) return;
      if (start > 1000000 || end > 1000000) return; // Sanity check for massive values

      if (!textMap) rebuildTextMap(root);

      const rangesToWrap = [];

      for (const entry of textMap) {
        if (entry.end <= start) continue;
        if (entry.start >= end) break;

        const nodeText = entry.node.nodeValue;
        const originalLength = nodeText.length;

        const localStart = Math.max(0, start - entry.start);
        const localEnd = Math.min(originalLength, end - entry.start);

        // Skip whitespace-only slivers — a quote window that includes the
        // speaker's name (name + paragraph break + quote) would otherwise
        // paint the blank newlines between the blocks as highlighted bars.
        if (localEnd > localStart && nodeText.slice(localStart, localEnd).search(/\S/) !== -1) {
          rangesToWrap.push({
            node: entry.node,
            localStart,
            localEnd,
            originalLength
          });
        }
      }

      for (const { node, localStart, localEnd, originalLength } of rangesToWrap) {
        try {
          if (localEnd < originalLength) {
            node.splitText(localEnd);
          }
          let target;
          if (localStart > 0) {
            target = node.splitText(localStart);
          } else {
            target = node;
          }

          if (target && target.parentNode) {
            const highlight = document.createElement("span");
            highlight.className = className;
            if (dataFocusId) highlight.dataset.focusId = dataFocusId;
            if (dataRangeKey) highlight.dataset.rangeKey = dataRangeKey;
            target.parentNode.replaceChild(highlight, target);
            highlight.appendChild(target);
          }
        } catch (e) {
          // Skip this range if splitText fails
          continue;
        }
      }
    } catch (e) {
      // Silently fail if highlighting fails to prevent site freeze
      console.warn("[HIGHLIGHT] Failed to wrap text range:", e.message);
    }
  }

  function highlightQuotedRanges(root, ranges) {
    if (!root || !ranges?.length) return;

    clearAllHighlights(root);
    rebuildTextMap(root);

    const sorted = [...ranges].sort((a, b) => a.start - b.start);

    // Merge overlaps (CRITICAL)
    const merged = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) {
        last.end = Math.max(last.end, r.end);
        // Merge focusIds (comma-separated)
        const lastIds = new Set((last.focusId || "").split(",").map(s => s.trim()).filter(Boolean));
        const newIds = new Set((r.focusId || r.nodeId || "").split(",").map(s => s.trim()).filter(Boolean));
        const mergedIds = new Set([...lastIds, ...newIds]);
        last.focusId = Array.from(mergedIds).join(",");
      } else {
        merged.push({ ...r });
      }
    }

    const totalLength = root.textContent.length;

    for (const range of merged) {
      if (
        !Number.isFinite(range.start) ||
        !Number.isFinite(range.end) ||
        range.end <= range.start ||
        range.end > totalLength
      ) continue;

      const focusId = range.focusId ?? range.nodeId;
      const rangeKey = `${range.start}-${range.end}`;

      // Check if ANY of the focusIds match ANY of the currently focused nodes
      const focusIds = focusId.split(",").map(s => s.trim()).filter(Boolean);
      const focusedIds = (state.focusedNodeId || "").split(",").map(s => s.trim()).filter(Boolean);
      const isActive =
        focusedIds.some(id => focusIds.includes(id)) &&
        (!state.focusedRangeKey || state.focusedRangeKey === rangeKey);

      const className = isActive
        ? "highlight-quote active"
        : "highlight-quote";

      wrapTextRange(root, range.start, range.end, className, focusId, rangeKey);
    }
  }

  /** True when quote hierarchy matches source at the finest shared depth (prefix alignment). */
  function pathsMatchForHighlight(quotePath, sourcePath) {
    const s = (sourcePath || []).map(String).map((x) => x.trim()).filter(Boolean);
    const q = (quotePath || []).map(String).map((x) => x.trim()).filter(Boolean);
    if (!s.length) return true;
    if (!q.length) return true;
    const n = Math.min(q.length, s.length);
    for (let i = 0; i < n; i++) {
      if (q[i] !== s[i]) return false;
    }
    return q.length <= s.length;
  }

  function resolveAnalysisIdForSidebar(focusId) {
    if (!focusId) return null;
    // Return ALL matching analysis IDs (comma-separated)
    const ids = focusId.split(",").map(s => s.trim()).filter(Boolean);
    const analysisIds = ids.filter(id => state.analysisNodes.some((n) => n.id === id));
    if (analysisIds.length > 0) {
      return analysisIds.join(",");
    }
    // Fallback: check if it's a quote node
    const qNode = state.quotes.find((n) => n.id === focusId);
    if (qNode?.meta?.analysisNodeIds?.length > 0) {
      return qNode.meta.analysisNodeIds.join(",");
    }
    return null;
  }

  function buildHighlightRangesForSource(source, domText) {
    const sourcePath =
      source?.meta?.hierarchyPath ||
      [source?.subject || "", ...(source?.section ? source.section.split(" > ") : [])].filter(Boolean);
    const byPosition = new Map();

    const mergeRange = (start, end, focusId) => {
      // Sanitize and validate range values
      const safStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
      const safEnd = Number.isFinite(end) ? Math.max(0, Math.floor(end)) : 0;

      if (safEnd <= safStart) return;
      if (safStart > 1000000 || safEnd > 1000000) return; // Sanity check

      const key = `${safStart}-${safEnd}`;
      const existing = byPosition.get(key);

      if (existing) {
        // Merge focusIds: combine existing and new, avoid duplicates
        const existingIds = new Set(existing.focusId.split(",").map(s => s.trim()).filter(Boolean));
        const newIds = focusId.split(",").map(s => s.trim()).filter(Boolean);
        for (const id of newIds) {
          existingIds.add(id);
        }
        existing.focusId = Array.from(existingIds).join(",");
        existing.nodeId = existing.focusId;
      } else {
        byPosition.set(key, {
          start: safStart,
          end: safEnd,
          focusId,
          nodeId: focusId
        });
      }
    };

    const resolvePositions = (quoteText, fallbackStart, fallbackEnd) => {
      if (quoteText && domText) {
        const loc = findQuoteInSource(quoteText, domText);
        if (loc) {
          return { start: loc.start, end: loc.end };
        }
      }
      return {
        start: fallbackStart,
        end: fallbackEnd
      };
    };

    const storedOffsetsMatch = (quote, text, s, e) => {
      if (!quote || !text) return false;
      if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > text.length) return false;
      const slice = text.slice(s, e);
      if (!slice) return false;
      const collapse = (t) => t.replace(/\s+/g, " ").trim();
      const strip = (t) => t.replace(/\s+/g, "");
      // Collapse-equal handles normal whitespace; strip-equal handles legacy
      // quotes whose old reader glued words together (window covers the newline).
      return collapse(slice) === collapse(quote) || strip(slice) === strip(quote);
    };

    for (const q of state.quotes) {
      if (q.subject !== state.selectedSubject) continue;
      if (q.link?.sourceId !== source.id) continue;
      if (q.meta?.hierarchyPath?.length && !pathsMatchForHighlight(q.meta.hierarchyPath, sourcePath)) {
        continue;
      }

      try {
        const quoteText = q.quote || "";
        let start = Number(q.link?.start ?? 0);
        let end = Number(q.link?.end ?? 0);

        // Sanitize NaN values
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) end = 0;

        if (!end && quoteText) {
          const pos = resolvePositions(quoteText, start, start + quoteText.length);
          start = Math.max(0, Number(pos.start) || 0);
          end = Math.max(start, Number(pos.end) || 0);
        } else if ((!Number.isFinite(end) || end <= start) && quoteText) {
          const pos = resolvePositions(quoteText, start, start + quoteText.length);
          start = Math.max(0, Number(pos.start) || 0);
          end = Math.max(start, Number(pos.end) || 0);
        } else if (end > start && quoteText && !storedOffsetsMatch(quoteText, domText, start, end)) {
          // Stored offsets were computed against the old reader text (contiguous
          // html). The markdown reader inserts newlines between blocks, so the
          // offsets drift and highlights land in the wrong place. Re-locate by
          // text when the slice no longer matches the quoted text.
          const loc = domText ? findQuoteInSource(quoteText, domText) : null;
          if (loc) {
            start = loc.start;
            end = loc.end;
          } else {
            start = 0;
            end = 0;
          }
        }

        const analysisIds = q.meta?.analysisNodeIds || [];
        // Store ALL analysis IDs for this quote (not just first one)
        // Use a special format to encode multiple IDs: "id1,id2,id3"
        const focusId = analysisIds.length > 0 ? analysisIds.join(",") : q.id;
        mergeRange(start, end, focusId);
      } catch (e) {
        // Skip this quote if there's an error
        continue;
      }
    }

    for (const node of state.analysisNodes) {
      if (node.subject !== state.selectedSubject) continue;
      if (node.link?.sourceId !== source.id) continue;

      try {
        const quoteText = node.quote || "";
        let start = Number(node?.link?.start ?? node?.meta?.sourceOrder ?? 0);
        let end = Number(node?.link?.end ?? 0);

        // Sanitize NaN values
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) end = 0;

        if (!quoteText && (!end || end <= start)) continue;
        if (!end || end <= start) {
          const pos = resolvePositions(quoteText, start, start + quoteText.length);
          start = Math.max(0, Number(pos.start) || 0);
          end = Math.max(start, Number(pos.end) || 0);
        } else if (end > start && quoteText && !storedOffsetsMatch(quoteText, domText, start, end)) {
          const loc = domText ? findQuoteInSource(quoteText, domText) : null;
          if (loc) {
            start = loc.start;
            end = loc.end;
          } else {
            start = 0;
            end = 0;
          }
        }
        mergeRange(start, end, node.id);
      } catch (e) {
        // Skip this node if there's an error
        continue;
      }
    }

    for (const node of state.analysisNodes) {
      if (node.subject !== state.selectedSubject || !Array.isArray(node.quoteRefs)) continue;
      for (const ref of node.quoteRefs) {
        if (ref.sourceId !== source.id) continue;
        const refText = ref.quote || "";
        let start = Number(ref.start);
        let end = Number(ref.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          if (refText && domText) {
            const pos = resolvePositions(refText, 0, 0);
            start = pos.start;
            end = pos.end;
          } else {
            continue;
          }
        }
        mergeRange(start, end, node.id);
      }
    }

    return Array.from(byPosition.values()).sort((a, b) => a.start - b.start);
  }

  function findQuoteInSource(quote, sourceText) {
    if (!quote || !sourceText) return null;

    // Helper: normalize for comparison (collapse whitespace)
    const normalize = (text) => {
      return text
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .join(" ")
        .trim();
    };

    const normalizedQuote = normalize(quote);

    // 1. Try exact match first
    let exactPos = sourceText.indexOf(quote);
    if (exactPos !== -1) {
      return {
        start: exactPos,
        end: exactPos + quote.length,
        quote: quote
      };
    }

    // 2. Try case-insensitive exact match
    exactPos = sourceText.toLowerCase().indexOf(quote.toLowerCase());
    if (exactPos !== -1) {
      return {
        start: exactPos,
        end: exactPos + quote.length,
        quote: sourceText.substring(exactPos, exactPos + quote.length)
      };
    }

    // 3. For multi-line quotes: normalize both and search
    const normalizedSource = normalize(sourceText);
    const normalizedPos = normalizedSource.indexOf(normalizedQuote);

    if (normalizedPos !== -1) {
      // Map normalized position back to original text by counting characters
      let originalStart = 0;
      let normalizedCount = 0;
      let inWhitespace = true;

      for (let i = 0; i < sourceText.length; i++) {
        const char = sourceText[i];
        const isWhitespace = /\s/.test(char);

        if (!isWhitespace) {
          if (inWhitespace && normalizedCount > 0) {
            normalizedCount++; // for the space character in normalized
          }
          if (normalizedCount === normalizedPos) {
            originalStart = i;
            break;
          }
          normalizedCount++;
          inWhitespace = false;
        } else if (!inWhitespace) {
          inWhitespace = true;
        }
      }

      // Advance original position to quote start
      let originalPos = originalStart;
      let quotePart = "";
      let charCount = 0;
      let lastWasSpace = false;

      // Collect text matching length of normalized quote
      for (let i = originalStart; i < sourceText.length && charCount < normalizedQuote.length; i++) {
        const char = sourceText[i];
        const isWhitespace = /\s/.test(char);

        if (!isWhitespace) {
          if (char.toLowerCase() === normalizedQuote[charCount].toLowerCase()) {
            quotePart += char;
            charCount++;
            lastWasSpace = false;
          } else if (charCount > 0) {
            // Partial match found - continue building
            quotePart += char;
            lastWasSpace = false;
          }
        } else if (!lastWasSpace && charCount > 0) {
          quotePart += " ";
          charCount++;
          lastWasSpace = true;
        }
      }

      // Trim trailing whitespace from quotePart
      quotePart = quotePart.trim();

      if (quotePart.length > 0) {
        // Find exact substring in source for this part
        const finalPos = sourceText.indexOf(quotePart, originalStart);
        if (finalPos !== -1) {
          return {
            start: finalPos,
            end: finalPos + quotePart.length,
            quote: quotePart
          };
        }
      }
    }

    // 4. Whitespace-stripped fallback: legacy sources glue words together (the
    //    old reader had no separator between adjacent blocks, e.g. speaker name
    //    + first line became "MACBETHSo foul and fair..."). Re-anchor by
    //    ignoring all whitespace. Only for long, unambiguous quotes.
    const strippedQuote = quote.replace(/\s+/g, "");
    if (strippedQuote.length >= 8) {
      const strippedSource = sourceText.replace(/\s+/g, "");
      const strippedIdx = strippedSource.indexOf(strippedQuote);
      if (strippedIdx !== -1) {
        let start = -1, pos = 0, end = -1;
        for (let i = 0; i < sourceText.length && pos <= strippedIdx + strippedQuote.length; i++) {
          if (/\s/.test(sourceText[i])) continue;
          if (pos === strippedIdx && start === -1) start = i;
          pos++;
          if (pos === strippedIdx + strippedQuote.length) { end = i + 1; break; }
        }
        if (start !== -1 && end > start) {
          return { start, end, quote };
        }
      }
    }

    return null;
  }

  function getSourceById(id) {
    return state.sources.find((item) => item.id === id) || null;
  }

  function getSubjectNodeByName(name) {
    return state.subjectNodes.find((node) => (node.subject || node.title) === name) || null;
  }

  function subjectExists(name) {
    const target = String(name || "").trim();
    if (!target) return false;
    if (getSubjectNodeByName(target)) return true;
    return state.sources.some((source) => source.subject === target);
  }

  function getSourcesForSelectedSubject() {
    return state.sources.filter((source) => source.subject === state.selectedSubject);
  }

  function sourceHierarchy(source) {
    const path = source?.meta?.hierarchyPath || [source?.subject, ...(source?.section ? source.section.split(" > ") : [])];
    return (path || []).map((part) => String(part || "").trim()).filter(Boolean);
  }

  function sourceLocation(source) {
    const path = sourceHierarchy(source);
    return path.length > 1 ? path.join(" / ") : (path[0] || "Unfiled");
  }

  function sourceNavigatorRecentIds() {
    try {
      return JSON.parse(localStorage.getItem("nn-analysis-recent-sources") || "[]");
    } catch {
      return [];
    }
  }

  function rememberRecentSource(sourceId) {
    if (!sourceId) return;
    const ids = [sourceId, ...sourceNavigatorRecentIds().filter((id) => id !== sourceId)].slice(0, 6);
    try { localStorage.setItem("nn-analysis-recent-sources", JSON.stringify(ids)); } catch { /* private mode */ }
  }

  function removeRecentSource(sourceId) {
    const ids = sourceNavigatorRecentIds().filter((id) => id !== sourceId);
    try { localStorage.setItem("nn-analysis-recent-sources", JSON.stringify(ids)); } catch { /* private mode */ }
  }

  function updateSourceNavigatorTrigger() {
    if (!sourceNavigatorBtn) return;
    const source = getSourceById(state.selectedSourceId);
    const label = source
      ? (source.title || "Untitled source")
      : (state.isCreatingSource ? "New unsaved source" : "Choose source");
    const labelEl = sourceNavigatorBtn.querySelector(".source-navigator-trigger-label");
    if (labelEl) labelEl.textContent = label;
    sourceNavigatorBtn.title = source ? sourceLocation(source) : label;
  }

  function sourceActionIcon(name) {
    const paths = {
      rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
      move: '<path d="M5 19h14"/><path d="M12 5v10"/><path d="m8 9 4-4 4 4"/>',
      duplicate: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"/>',
      delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 14h10l1-14M9 7V4h6v3"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
  }

  function sourceFileIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>';
  }

  function closeIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  }

  function renderSourceNavigator() {
    if (!sourceNavigatorList) return;
    const query = String(sourceNavigatorSearch?.value || "").trim().toLocaleLowerCase();
    const matches = state.sources.filter((source) => {
      if (!query) return true;
      return [source.title, source.subject, source.section, sourceLocation(source)]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
    const roots = new Map();

    for (const source of matches) {
      const hierarchy = sourceHierarchy(source);
      const folderPath = source.subject
        ? [source.subject, ...hierarchy.slice(1)]
        : ["Unfiled", ...hierarchy];
      let level = roots;
      let leaf = null;
      for (const label of folderPath) {
        if (!level.has(label)) level.set(label, { label, children: new Map(), sources: [] });
        const node = level.get(label);
        leaf = node;
        level = node.children;
      }
      leaf?.sources.push(source);
    }

    const sortNodes = (nodes) => Array.from(nodes.values()).sort((a, b) => {
      if (a.label === "Unfiled") return -1;
      if (b.label === "Unfiled") return 1;
      return a.label.localeCompare(b.label);
    });
    const renderSources = (sources) => sources
      .sort((a, b) => String(a.title || "Untitled source").localeCompare(String(b.title || "Untitled source")))
      .map((source) => `
        <div class="source-navigator-item" role="option" aria-selected="${source.id === state.selectedSourceId}">
          <button class="source-navigator-item-main" type="button" data-source-select="${escapeHtml(source.id)}">
            <span class="source-navigator-item-copy">
              <span class="source-navigator-item-title">${escapeHtml(source.title || "Untitled source")}</span>
              <span class="source-navigator-item-path">${escapeHtml(sourceLocation(source))}</span>
            </span>
          </button>
          <span class="source-navigator-item-actions">
            <button class="icon-btn edit-btn" type="button" data-source-action="rename" data-source-id="${escapeHtml(source.id)}" title="Rename source" aria-label="Rename ${escapeHtml(source.title || "source")}">${sourceActionIcon("rename")}</button>
            <button class="icon-btn" type="button" data-source-action="move" data-source-id="${escapeHtml(source.id)}" title="Move source" aria-label="Move ${escapeHtml(source.title || "source")}">${sourceActionIcon("move")}</button>
            <button class="icon-btn copy-btn" type="button" data-source-action="duplicate" data-source-id="${escapeHtml(source.id)}" title="Duplicate source" aria-label="Duplicate ${escapeHtml(source.title || "source")}">${sourceActionIcon("duplicate")}</button>
            <button class="icon-btn delete-btn danger" type="button" data-source-action="delete" data-source-id="${escapeHtml(source.id)}" title="Delete source" aria-label="Delete ${escapeHtml(source.title || "source")}">${sourceActionIcon("delete")}</button>
          </span>
        </div>
      `).join("");
    const sourceCount = (node) => node.sources.length + Array.from(node.children.values()).reduce((total, child) => total + sourceCount(child), 0);
    const renderNodes = (nodes, depth = 0) => sortNodes(nodes).flatMap((node) => {
      // A folder with one nested folder and no direct files adds navigation
      // friction without adding a choice. Keep root categories visible, but
      // promote redundant nested sections to the current level.
      if (depth > 0 && node.sources.length === 0 && node.children.size === 1) {
        return renderNodes(node.children, depth);
      }
      const isOpen = depth === 0 && node.label === "Unfiled";
      return [`
        <div class="source-navigator-group source-navigator-level-${depth}${isOpen ? " is-open" : ""}">
          <button class="source-navigator-group-title" type="button" aria-expanded="${isOpen}">
            <span>${escapeHtml(node.label)}</span>
            <span class="source-navigator-group-count">${sourceCount(node)}</span>
          </button>
          <div class="source-navigator-group-content">
            ${node.children.size ? renderNodes(node.children, depth + 1) : ""}
            ${node.sources.length ? renderSources(node.sources) : ""}
          </div>
        </div>
      `];
    }).join("");

    sourceNavigatorList.innerHTML = renderNodes(roots);
    sourceNavigatorEmpty.hidden = matches.length > 0;
    if (sourceLibraryCount) {
      sourceLibraryCount.textContent = `${state.sources.length} source${state.sources.length === 1 ? "" : "s"}`;
    }

    if (sourceNavigatorRecent) {
      const recent = sourceNavigatorRecentIds()
        .map((id) => getSourceById(id))
        .filter(Boolean)
        .slice(0, 4);
      sourceNavigatorRecent.innerHTML = recent.length && !query
        ? `<div class="source-navigator-recent-label">Recently opened</div><div class="source-navigator-recent-list">${recent.map((source) => `<div class="source-navigator-recent-item"><button class="source-navigator-recent-open" type="button" data-source-select="${escapeHtml(source.id)}"><span class="source-navigator-file-icon">${sourceFileIcon()}</span><span class="source-navigator-recent-copy"><strong>${escapeHtml(source.title || "Untitled source")}</strong><small>${escapeHtml(sourceLocation(source))}</small></span></button><button class="source-navigator-recent-remove" type="button" data-recent-remove="${escapeHtml(source.id)}" title="Remove from recently opened" aria-label="Remove ${escapeHtml(source.title || "source")} from recently opened">${closeIcon()}</button></div>`).join("")}</div>`
        : "";
    }
  }

  function closeSourceNavigator() {
    state.view = state.libraryReturnView || "launchpad";
    renderState();
  }

  function openSourceNavigator() {
    state.libraryReturnView = state.view === "study" ? "study" : "launchpad";
    state.view = "library";
    renderState();
    requestAnimationFrame(() => sourceNavigatorSearch?.focus());
  }

  function sourceFormIsDirty() {
    if (state.isCreatingSource) {
      return Boolean(sourceTitleInput?.value.trim() || sourceSubjectInput?.value.trim() || mdEditor.getMarkdown().trim());
    }
    const source = getSourceById(state.selectedSourceId);
    if (!source || state.viewMode !== "editor") return false;
    const path = sourceHierarchy(source);
    return sourceTitleInput.value.trim() !== String(source.title || "").trim()
      || sourceSubjectInput.value.trim() !== String(source.subject || "").trim()
      || sourceLevel1Input.value.trim() !== String(path[1] || "").trim()
      || sourceLevel2Input.value.trim() !== String(path[2] || "").trim()
      || sourceLevel3Input.value.trim() !== String(path[3] || "").trim()
      || mdEditor.getMarkdown().trim() !== String(sourceMarkdown(source) || "").trim();
  }

  async function confirmSourceNavigation() {
    if (!sourceFormIsDirty()) return true;
    return dialog.confirm("You have unsaved source changes. Discard them and continue?", "Discard", "danger");
  }

  async function persistSourcePatch(source, patch) {
    const stayInLibrary = state.view === "library";
    const updated = { ...source, ...patch, updatedAt: Date.now() };
    await addNode(updated);
    await refreshData();
    await backupLocalNodesToCloud();
    state.selectedSubject = updated.subject || "";
    state.selectedSourceId = updated.id;
    state.isCreatingSource = false;
    setSourceViewMode("reader");
    selectSource(updated.id);
    updateSourceNavigatorTrigger();
    if (stayInLibrary) {
      state.view = "library";
      renderState();
    }
  }

  async function deleteSourceById(sourceId) {
    const source = getSourceById(sourceId);
    if (!source) return;
    const linked = state.analysisNodes.filter((node) => analysisTouchesSource(node, source.id));
    const approved = await dialog.confirm(`Delete "${source.title || "Untitled source"}" and ${linked.length} linked analysis node(s)?`, "Delete", "danger");
    if (!approved) return;
    for (const node of linked) await deleteAnalysisNodeWithIntegrity(node);
    for (const quote of state.quotes.filter((item) => item.link?.sourceId === source.id)) await removeQuoteAndLinkedCuesEverywhere(quote.id);
    await removeNodeEverywhere(source.id);
    if (state.selectedSourceId === source.id) {
      state.selectedSourceId = "";
      resetSourceForm();
      setSourceViewMode("reader");
    }
    await refreshData();
    await backupLocalNodesToCloud();
    if (typeof toast === "function") toast("Source deleted");
    updateSourceNavigatorTrigger();
  }

  /** Human-readable location for a quote ref (e.g. "Act 1 > Scene 7"), omitting subject when redundant. */
  function formatQuoteRefOriginLabel(ref) {
    if (!ref) return "";
    let src = ref.sourceId ? getSourceById(ref.sourceId) : null;
    if (!src && ref.quoteId) {
      const qNode = state.quotes.find((q) => q.id === ref.quoteId);
      if (qNode?.link?.sourceId) {
        src = getSourceById(qNode.link.sourceId);
      }
      if (!src && qNode?.meta?.hierarchyPath?.length) {
        let parts = qNode.meta.hierarchyPath.map(String).map((s) => s.trim()).filter(Boolean);
        const subj = state.selectedSubject || qNode.subject || "";
        if (parts.length && subj && parts[0] === subj) parts = parts.slice(1);
        if (parts.length) return parts.join(" > ");
      }
    }
    if (src) {
      const path =
        src.meta?.hierarchyPath ||
        [src.subject || "", ...(src.section ? String(src.section).split(" > ") : [])].filter(Boolean);
      let parts = path.map(String).map((s) => s.trim()).filter(Boolean);
      const subj = state.selectedSubject || src.subject || "";
      if (parts.length && subj && parts[0] === subj) parts = parts.slice(1);
      if (parts.length) return parts.join(" > ");
      return String(src.title || "").trim();
    }
    const sec = ref.section && String(ref.section).trim();
    if (sec && sec !== state.selectedSubject) return sec;
    return "";
  }

  function quoteRefOriginLineHtml(ref) {
    const label = formatQuoteRefOriginLabel(ref);
    if (!label) return "";
    return `<div class="quote-ref-origin">→ ${escapeHtml(label)}</div>`;
  }

  function renderModalQuoteRefsListHtml(refs, previewLen = 100) {
    return (refs || [])
      .map((ref, idx) => {
        // Use formatQuoteForDisplay to properly render HTML formatting
        const displayHtml = formatQuoteForDisplay(ref, ref.quote || "");
        // Get plain text for the truncated version and Remove button
        const plainText = ref.quote || "";
        const truncated = plainText.substring(0, previewLen) + (plainText.length > previewLen ? "..." : "");
        const origin = quoteRefOriginLineHtml(ref);
        const priority = clampPriority(ref.priority);
        const stars = [1, 2, 3, 4, 5]
          .map((value) => {
            const active = value <= priority;
            const color = active ? getPriorityColor(value) : "rgba(230,255,245,0.2)";
            return `<button type="button" class="icon-btn" title="Set priority ${value}" aria-label="Set priority ${value}" onclick="setQuotePriorityForAnalysis(${idx}, ${value})" style="margin: 0; color: ${color};">${active ? "★" : "☆"}</button>`;
          })
          .join("");

        // Check if cue already exists for this quote
        const quoteId = ref.quoteId || ref.id;
        const hasCue = state.cues && state.cues.some(c => c.quoteId === quoteId);
        const cueBtnLabel = hasCue ? "Edit Cue" : "Add Cue";

        return `
            <div class="quote-ref-form-row" style="background: rgba(44, 255, 179, 0.08); padding: 8px; border-radius: 6px; font-size: 0.85rem;">
              <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
                <span style="flex: 1; line-height: 1.3; font-style: italic;">"${truncated}"</span>
                <div style="display: flex; gap: 4px;">
                  <button type="button" class="btn cue-btn" data-quote-id="${quoteId || ''}" style="padding: 4px 8px; font-size: 0.75rem; ${hasCue ? 'background: rgba(44, 255, 179, 0.2);' : ''}">${cueBtnLabel}</button>
                  <button type="button" data-idx="${idx}" class="btn" style="padding: 4px 8px; font-size: 0.75rem;" onclick="removeQuoteRefFromAnalysis(${idx})">Remove</button>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 4px; margin-top: 8px;">
                <span style="font-size: 0.75rem; color: rgba(230,255,245,0.7);">Priority</span>
                <div style="display: flex; align-items: center; gap: 2px;">${stars}</div>
              </div>
              ${origin}
            </div>
          `;
      })
      .join("");
  }

  function refTouchesSource(ref, sourceId) {
    if (!ref || !sourceId) return false;
    if (ref.sourceId === sourceId) return true;
    const qn = ref.quoteId ? state.quotes.find((q) => q.id === ref.quoteId) : null;
    return qn?.link?.sourceId === sourceId;
  }

  function analysisTouchesSource(node, sourceId) {
    if (!node || !sourceId) return false;
    if (node.subject !== state.selectedSubject) return false;
    if (node.link?.sourceId === sourceId) return true;
    for (const r of node.quoteRefs || []) {
      if (refTouchesSource(r, sourceId)) return true;
    }
    // Check manualLinks from mindmapTool.js
    if (node.meta?.manualLinks?.includes(sourceId)) return true;
    return false;
  }

  function resolveRefOffsetsInSource(ref, source, domText) {
    if (!ref || !source || domText == null) return null;
    if (ref.sourceId === source.id) {
      const refText = ref.quote || "";
      let start = Number(ref.start);
      let end = Number(ref.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        if (refText) {
          const loc = findQuoteInSource(refText, domText);
          if (loc) {
            start = loc.start;
            end = loc.end;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return { start, end };
      }
      return null;
    }
    const qn = ref.quoteId ? state.quotes.find((q) => q.id === ref.quoteId) : null;
    if (!qn || qn.link?.sourceId !== source.id) return null;
    let start = Number(qn.link?.start ?? 0);
    let end = Number(qn.link?.end ?? 0);
    const qt = qn.quote || "";
    if (!end && qt) {
      const loc = findQuoteInSource(qt, domText);
      if (loc) {
        start = loc.start;
        end = loc.end;
      }
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { start, end };
    }
    return null;
  }

  function getRefPrimarySource(ref) {
    if (!ref) return null;
    if (ref.sourceId) return getSourceById(ref.sourceId) || null;
    const qn = ref.quoteId ? state.quotes.find((q) => q.id === ref.quoteId) : null;
    if (!qn?.link?.sourceId) return null;
    return getSourceById(qn.link.sourceId) || null;
  }

  /** Resolve scroll/jump targets for a ref using that quote's own source document (any scene). */
  function resolveRefJumpForRef(ref) {
    const src = getRefPrimarySource(ref);
    if (!src) return null;
    const norm = normalizeSource(src);
    const domText = norm.contentText || "";
    const off = resolveRefOffsetsInSource(ref, src, domText);
    if (!off) return null;
    return { sourceId: src.id, start: off.start, end: off.end };
  }

  function resolveLegacyLinkedOffsets(node, source, domText) {
    if (!node || node.link?.sourceId !== source.id || domText == null) return null;
    const quoteText = node.quote || "";
    let start = Number(node?.link?.start ?? node?.meta?.sourceOrder ?? 0);
    let end = Number(node?.link?.end ?? 0);
    if (!end && quoteText) {
      const loc = findQuoteInSource(quoteText, domText);
      if (loc) {
        start = loc.start;
        end = loc.end;
      }
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { start, end };
    }
    return null;
  }

  function countQuoteRefsAcrossAnalyses() {
    return state.quotes.length;
  }

  function getSelectionFromReader() {
    const source = getSourceById(state.selectedSourceId);
    if (!source || !analysisReader) return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range || range.collapsed) return null;

    // Verify the selection intersects the reader area
    if (typeof range.intersectsNode === "function") {
      if (!range.intersectsNode(analysisReader)) return null;
    } else {
      if (!analysisReader.contains(range.startContainer) && !analysisReader.contains(range.endContainer)) return null;
    }

    // Clamp range boundaries so start and end are strictly inside analysisReader
    const clampedRange = range.cloneRange();
    if (!analysisReader.contains(clampedRange.startContainer)) {
      try { clampedRange.setStart(analysisReader, 0); } catch (e) {}
    }
    if (!analysisReader.contains(clampedRange.endContainer)) {
      try { clampedRange.setEnd(analysisReader, analysisReader.childNodes.length); } catch (e) {}
    }

    if (clampedRange.collapsed) return null;

    const pre = document.createRange();
    pre.selectNodeContents(analysisReader);
    try {
      pre.setEnd(clampedRange.startContainer, clampedRange.startOffset);
    } catch (e) {
      pre.setEnd(analysisReader, 0);
    }

    const rawStart = pre.toString().length;

    // Extract HTML content from the range to preserve formatting (bold, italics, etc.)
    const quoteContainer = document.createElement("div");
    try {
      quoteContainer.appendChild(clampedRange.cloneContents());
    } catch (e) {}
    const rawQuoteHtml = quoteContainer.innerHTML;
    const rawQuote = clampedRange.toString();
    if (!rawQuote.trim()) return null;

    const leading = rawQuote.length - rawQuote.trimStart().length;
    const start = rawStart + leading;
    const quote = rawQuote.trim();
    const end = start + quote.length;
    const sourceText = analysisReader.textContent || "";

    const prefix = sourceText.substring(Math.max(0, start - 20), start);
    const suffix = sourceText.substring(end, Math.min(sourceText.length, end + 20));

    return {
      start: Math.min(start, sourceText.length),
      end: Math.min(end, sourceText.length),
      quote,
      prefix,
      suffix,
      quoteHtml: rawQuoteHtml,
      sourceId: source.id,
      range: clampedRange
    };
  }

  function showAnalysisCard() {
    if (analysisFloatCard) {
      analysisFloatCard.style.display = "block";
      if (state.analysisEditMode) {
        analysisCardKicker.textContent = "Edit Analysis Node";
        analysisSubmitBtn.textContent = "Update Analysis Node";
      } else {
        analysisCardKicker.textContent = "Create Analysis Node";
        analysisSubmitBtn.textContent = "Save Analysis Node";
      }

      // Update quote references display when showing the card
      if (quoteRefsListContainer && state.selectedQuoteRef && state.selectedQuoteRef.length > 0) {
        quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
        attachQuoteRefEventListeners();
      } else if (quoteRefsListContainer) {
        quoteRefsListContainer.innerHTML = "";
      }
    }
  }

  function hideAnalysisCard() {
    if (analysisFloatCard) {
      analysisFloatCard.style.display = "none";
    }
  }

  /** Clear fields and quote refs; keeps the modal open so users can switch scenes and keep working. */
  function clearAnalysisDraft() {
    if (!analysisForm) return;
    analysisForm.reset();
    if (analysisNodeIdInput) analysisNodeIdInput.value = "";
    state.selectedRange = null;
    state.analysisEditMode = false;
    state.selectedQuoteRef = [];
    hideQuoteButton();
    const list = document.getElementById("quoteRefsList");
    if (list) list.innerHTML = "";
    resetAnalysisSessionCreatedQuotes();
  }

  /** Full close: clear draft and hide the panel (only explicit dismiss, e.g. ✕). */
  function dismissAnalysisModal() {
    hideCueCard();
    clearAnalysisDraft();
    hideAnalysisCard();
  }

  async function confirmDiscardAnalysisDraft() {
    const attachedQuoteIds = getSelectedQuoteRefs().map((ref) => ref.quoteId).filter(Boolean);
    if (!attachedQuoteIds.length) return "keep";

    const createdIds = new Set(getAnalysisSessionCreatedQuoteIds());
    const summary = getQuoteCleanupSummary(
      attachedQuoteIds.filter((quoteId) => createdIds.has(quoteId))
    );

    const choice = await showAnalysisCleanupDialog({
      title: "Discard this analysis draft?",
      message: "This draft already created quote nodes so you could attach cues immediately. Decide whether to keep those quotes or remove the private ones created for this unfinished analysis.",
      summary: `${attachedQuoteIds.length} linked quote node(s) are attached to this draft.<br>${summary.deletableQuoteIds.length} private quote node(s)${summary.deletableCueCount ? ` and ${summary.deletableCueCount} cue node(s)` : ""} would be removed by the danger action.`,
      keepLabel: "Discard draft, keep quotes",
      deleteLabel: "Discard draft and delete private quotes"
    });

    return choice;
  }

  async function maybeDismissAnalysisModal() {
    if (!isCreatingAnalysisDraft() || !getSelectedQuoteRefs().length) {
      dismissAnalysisModal();
      return true;
    }

    const choice = await confirmDiscardAnalysisDraft();
    if (!choice) return false;

    if (choice === "delete") {
      const createdIds = new Set(getAnalysisSessionCreatedQuoteIds());
      const selectedIds = getSelectedQuoteRefs()
        .map((ref) => ref.quoteId)
        .filter((quoteId) => createdIds.has(quoteId));
      const deletableQuoteIds = getQuoteCleanupSummary(selectedIds).deletableQuoteIds;
      for (const quoteId of deletableQuoteIds) {
        await removeQuoteAndLinkedCuesEverywhere(quoteId);
      }
      await refreshData();
    }

    dismissAnalysisModal();
    return true;
  }

  async function confirmDeleteAnalysisNode(node) {
    const attachedQuoteIds = (node?.quoteRefs || []).map((ref) => ref.quoteId).filter(Boolean);
    if (!attachedQuoteIds.length) return "keep";

    const summary = getQuoteCleanupSummary(attachedQuoteIds, [node.id]);
    return showAnalysisCleanupDialog({
      title: "Delete this analysis node?",
      message: "This analysis has linked quotes. You can delete the node and keep every quote, or remove the node together with quote nodes that are only used here.",
      summary: `${attachedQuoteIds.length} linked quote node(s) are attached to this analysis.<br>${summary.deletableQuoteIds.length} quote node(s)${summary.deletableCueCount ? ` and ${summary.deletableCueCount} cue node(s)` : ""} would also be removed by the danger action because nothing else references them.`,
      keepLabel: "Delete node, keep quotes",
      deleteLabel: "Delete node and private quotes"
    });
  }

  // ========== CUE NODE FUNCTIONS ==========

  function showCueCard() {
    const card = document.getElementById("cueFloatCard");
    const analysisCard = document.getElementById("analysisFloatCard");
    if (card) {
      // Position to the left of analysis card if it's open, otherwise use default position
      if (analysisCard && analysisCard.style.display !== "none") {
        card.style.right = "410px"; // 380px width + 30px gap
      } else {
        card.style.right = "14px"; // default position
      }
      card.style.display = "block";
    }
  }

  function hideCueCard() {
    const card = document.getElementById("cueFloatCard");
    if (card) card.style.display = "none";
    clearCueDraft();
  }

  function clearCueDraft() {
    state.cueEditMode = false;
    const cueForm = document.getElementById("cueForm");
    if (cueForm) cueForm.reset();
    const cueNodeId = document.getElementById("cueNodeId");
    const cueQuoteId = document.getElementById("cueQuoteId");
    const cueAnalysisId = document.getElementById("cueAnalysisId");
    const cueText = document.getElementById("cueText");
    const cueQuotePreview = document.getElementById("cueQuotePreview");
    const deleteCueBtn = document.getElementById("deleteCueBtn");
    const kicker = document.getElementById("cueCardKicker");
    if (cueNodeId) cueNodeId.value = "";
    if (cueQuoteId) cueQuoteId.value = "";
    if (cueAnalysisId) cueAnalysisId.value = "";
    if (cueText) cueText.value = "";
    if (cueQuotePreview) cueQuotePreview.innerHTML = "";
    if (deleteCueBtn) deleteCueBtn.style.display = "none";
    if (kicker) kicker.textContent = "Create Cue Node";
  }

  async function openCueModalForQuote(quoteId, analysisId = null) {
    clearCueDraft();

    const quote = state.quotes.find(q => q.id === quoteId) || await getQuote(quoteId);
    if (!quote) {
      console.error("Quote not found:", quoteId);
      return;
    }

    // Check if cue already exists
    const existingCues = await getCuesForQuote(quoteId);
    const existingCue = existingCues.length > 0 ? existingCues[0] : null;

    const cueNodeId = document.getElementById("cueNodeId");
    const cueQuoteId = document.getElementById("cueQuoteId");
    const cueAnalysisId = document.getElementById("cueAnalysisId");
    const cueText = document.getElementById("cueText");
    const cueQuotePreview = document.getElementById("cueQuotePreview");
    const deleteCueBtn = document.getElementById("deleteCueBtn");
    const kicker = document.getElementById("cueCardKicker");

    if (existingCue) {
      // Edit mode
      state.cueEditMode = true;
      state.editingCueCreatedAt = existingCue.createdAt; // Store for update
      if (cueNodeId) cueNodeId.value = existingCue.id;
      if (cueText) cueText.value = existingCue.cue || "";
      if (deleteCueBtn) deleteCueBtn.style.display = "inline-block";
      if (kicker) kicker.textContent = "Edit Cue Node";
    } else {
      // Create mode
      state.cueEditMode = false;
      if (deleteCueBtn) deleteCueBtn.style.display = "none";
      if (kicker) kicker.textContent = "Create Cue Node";
    }

    if (cueQuoteId) cueQuoteId.value = quoteId;
    if (cueAnalysisId) cueAnalysisId.value = analysisId || "";

    // Show quote preview
    const truncatedQuote = quote.quote ? (quote.quote.substring(0, 150) + (quote.quote.length > 150 ? "..." : "")) : "";
    if (cueQuotePreview) cueQuotePreview.innerHTML = `"${escapeHtml(truncatedQuote)}"`;

    showCueCard();
  }

  async function handleCueSubmit(e) {
    e.preventDefault();

    const cueNodeId = document.getElementById("cueNodeId");
    const cueQuoteId = document.getElementById("cueQuoteId");
    const cueAnalysisId = document.getElementById("cueAnalysisId");
    const cueText = document.getElementById("cueText");

    const quoteId = cueQuoteId?.value;
    const analysisId = cueAnalysisId?.value || null;
    const cueContent = cueText?.value?.trim();

    if (!quoteId) {
      dialog.alert("No quote selected for cue");
      return;
    }

    if (!cueContent) {
      dialog.alert("Please enter a cue");
      return;
    }

    const quote = state.quotes.find(q => q.id === quoteId);
    if (!quote) {
      dialog.alert("Quote not found");
      return;
    }

    const now = Date.now();
    const cueData = {
      id: cueNodeId?.value || crypto.randomUUID(),
      type: "cue",
      subject: quote.subject,
      quoteId: quoteId,
      analysisId: analysisId,
      cue: cueContent,
      meta: {
        tags: []
      },
      createdAt: state.cueEditMode ? (state.editingCueCreatedAt || now) : now,
      updatedAt: now
    };

    try {
      await addCue(cueData);

      // Refresh cues
      state.cues = await getAllCues();

      hideCueCard();

      // Refresh the analysis form if open
      if (state.analysisEditMode && state.selectedQuoteRef) {
        const quoteRefsListContainer = document.getElementById("quoteRefsList");
        if (quoteRefsListContainer) {
          quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
          attachQuoteRefEventListeners();
        }
      }
    } catch (error) {
      console.error("Failed to save cue:", error);
      dialog.alert("Failed to save cue: " + error.message);
    }
  }

  async function handleDeleteCue() {
    const cueNodeId = document.getElementById("cueNodeId");
    const cueId = cueNodeId?.value;

    if (!cueId) return;

    const confirmed = await dialog.confirm("Delete this cue? This action cannot be undone.", "Delete", "danger");
    if (!confirmed) return;

    try {
      const { deleteCue } = deps;
      if (deleteCue) {
        await deleteCue(cueId);

        // Refresh cues
        state.cues = await getAllCues();

        hideCueCard();

        // Refresh the analysis form if open
        if (state.analysisEditMode && state.selectedQuoteRef) {
          const quoteRefsListContainer = document.getElementById("quoteRefsList");
          if (quoteRefsListContainer) {
            quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
            attachQuoteRefEventListeners();
          }
        }
      }
    } catch (error) {
      console.error("Failed to delete cue:", error);
      dialog.alert("Failed to delete cue: " + error.message);
    }
  }

  function attachQuoteRefEventListeners() {
    // Attach click handlers for cue buttons in quote refs list
    document.querySelectorAll(".cue-btn").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const quoteId = btn.dataset.quoteId;
        if (quoteId) {
          await openCueModalForQuote(quoteId);
        }
      };
    });
  }

  // ========= TAG SELECTOR FOR ANALYSIS FORM =========
  let tagSelectorOpen = false;

  async function toggleTagSelector() {
    const container = document.getElementById("tagSelectorContainer");
    if (!container) return;

    if (tagSelectorOpen) {
      container.innerHTML = "";
      container.style.display = "none";
      tagSelectorOpen = false;
      return;
    }

    tagSelectorOpen = true;
    container.style.display = "block";

    try {
      const allTags = await getAllTags();
      const currentSubject = state.selectedSubject || "";
      const currentTags = (analysisTagsInput?.value || "").split(",").map(t => t.trim()).filter(Boolean);

      // Filter tags: show tags used in current subject, or all if none in subject
      let subjectTags = allTags.filter(tag => {
        // Check if any node in current subject uses this tag
        return state.nodes.some(n =>
          n.subject === currentSubject &&
          n.meta?.tags?.includes(tag.title)
        ) || state.quotes.some(q =>
          q.subject === currentSubject &&
          q.meta?.tags?.includes(tag.title)
        );
      });

      // If no tags in subject yet, show all existing tags
      if (subjectTags.length === 0) {
        subjectTags = allTags;
      }

      const existingTagTitles = new Set(subjectTags.map(t => t.title.toLowerCase()));

      container.innerHTML = `
        <div style="background: rgba(16,43,32,0.95); border: 1px solid rgba(44,255,179,0.3); border-radius: 6px; padding: 8px; margin-top: 4px; max-height: 150px; overflow-y: auto;">
          <div style="font-size: 0.75rem; color: rgba(230,255,245,0.7); margin-bottom: 6px;">Select existing tags or type new ones:</div>
          ${subjectTags.length > 0 ? `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
              ${subjectTags.map(tag => `
                <button type="button" class="tag-select-btn" data-tag="${escapeHtml(tag.title)}" style="
                  padding: 3px 8px;
                  border-radius: 4px;
                  font-size: 0.75rem;
                  cursor: pointer;
                  background: ${currentTags.includes(tag.title) ? 'rgba(44,255,179,0.3)' : 'rgba(44,255,179,0.1)'};
                  color: ${currentTags.includes(tag.title) ? '#e6fff5' : 'rgba(230,255,245,0.7)'};
                  border: 1px solid rgba(44,255,179,${currentTags.includes(tag.title) ? '0.5' : '0.2'});
                ">${escapeHtml(tag.title)}</button>
              `).join("")}
            </div>
          ` : '<div style="font-size: 0.75rem; color: rgba(230,255,245,0.5);">No existing tags yet. Type to create new ones.</div>'}
        </div>
      `;

      container.querySelectorAll(".tag-select-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const tagName = btn.dataset.tag;
          if (!tagName) return;

          const currentValue = analysisTagsInput?.value || "";
          const currentTags = currentValue.split(",").map(t => t.trim()).filter(Boolean);
          const tagIndex = currentTags.indexOf(tagName);

          if (tagIndex !== -1) {
            // Remove tag
            currentTags.splice(tagIndex, 1);
            btn.style.background = 'rgba(44,255,179,0.1)';
            btn.style.color = 'rgba(230,255,245,0.7)';
            btn.style.border = '1px solid rgba(44,255,179,0.2)';
          } else {
            // Add tag
            currentTags.push(tagName);
            btn.style.background = 'rgba(44,255,179,0.3)';
            btn.style.color = '#e6fff5';
            btn.style.border = '1px solid rgba(44,255,179,0.5)';
          }

          if (analysisTagsInput) {
            analysisTagsInput.value = currentTags.join(", ");
          }
        });
      });
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  }

  // Close tag selector when clicking outside
  document.addEventListener("click", (e) => {
    const container = document.getElementById("tagSelectorContainer");
    const toggleBtn = document.getElementById("tagSelectorToggle");
    if (container && !container.contains(e.target) && e.target !== toggleBtn && !toggleBtn?.contains(e.target)) {
      container.innerHTML = "";
      container.style.display = "none";
      tagSelectorOpen = false;
    }
  });

  // Right-click context menu for cues on quotes
  let cueContextMenu = null;

  function showCueContextMenu(e, quoteId) {
    e.preventDefault();
    hideCueContextMenu();

    cueContextMenu = document.createElement("div");
    cueContextMenu.id = "cueContextMenu";
    cueContextMenu.style.cssText = `
      position: fixed;
      left: ${e.clientX}px;
      top: ${e.clientY}px;
      background: rgba(16, 43, 32, 0.95);
      border: 1px solid rgba(44, 255, 179, 0.3);
      border-radius: 6px;
      padding: 4px 0;
      z-index: 10000;
      min-width: 150px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `;

    const hasCue = state.cues && state.cues.some(c => c.quoteId === quoteId);
    const menuText = hasCue ? "Edit Cue" : "Add Cue";

    cueContextMenu.innerHTML = `
      <button class="context-menu-item" style="
        display: block;
        width: 100%;
        padding: 8px 16px;
        background: none;
        border: none;
        color: #e6fff5;
        text-align: left;
        cursor: pointer;
        font-size: 0.85rem;
      " data-action="add-cue" data-quote-id="${quoteId}">${menuText}</button>
    `;

    cueContextMenu.querySelector("[data-action='add-cue']").onclick = async () => {
      await openCueModalForQuote(quoteId);
      hideCueContextMenu();
    };

    document.body.appendChild(cueContextMenu);

    // Close menu on click outside
    const closeMenuHandler = (evt) => {
      if (!cueContextMenu?.contains(evt.target)) {
        hideCueContextMenu();
        document.removeEventListener("click", closeMenuHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeMenuHandler), 0);
  }

  function hideCueContextMenu() {
    if (cueContextMenu) {
      cueContextMenu.remove();
      cueContextMenu = null;
    }
  }

  function resetAnalysisForm() {
    dismissAnalysisModal();
  }

  function hydrateSourceForm(source) {
    state.isCreatingSource = false;
    const path = source?.meta?.hierarchyPath || [source?.subject || "", ...(source?.section ? source.section.split(" > ") : [])];

    sourceIdInput.value = source?.id || "";
    sourceSubjectInput.value = source?.subject || state.selectedSubject;
    sourceTitleInput.value = source?.title || "";
    sourceLevel1Input.value = path[1] || "";
    sourceLevel2Input.value = path[2] || "";
    sourceLevel3Input.value = path[3] || "";
    // per-document line-break preference (falls back to the account default)
    mdEditor.setSoftBreaks(sourceSoftBreaks(source), { persist: false });
    mdEditor.setMarkdown(sourceMarkdown(source));
  }

  function resetSourceForm() {
    sourceForm.reset();
    sourceIdInput.value = state.isCreatingSource ? state.draftSourceId : "";
    sourceSubjectInput.value = state.selectedSubject;
    mdEditor.setSoftBreaks(getSoftBreaksDefault(), { persist: false });
    mdEditor.setMarkdown("");
  }

  // ========== NEW: QUOTE AND ANALYSIS LINKING FUNCTIONS ==========

  async function findExistingQuoteForSelection({ sourceId, start, end, quote }) {
    // First try exact position match using db.js function
    let existing = await findExistingQuote(sourceId, start, end);
    if (existing) return existing;

    // Fallback: try text match using db.js function
    if (quote) {
      existing = await findExistingQuoteByText(sourceId, quote);
      if (existing) return existing;
    }

    // Fallback to local state check
    return state.quotes.find((item) =>
      item.link?.sourceId === sourceId &&
      Number(item.link?.start) === Number(start) &&
      Number(item.link?.end) === Number(end)
    ) || null;
  }

  function getOtherAnalysisIdsForQuote(quoteId, excludedAnalysisIds = []) {
    const excluded = new Set((excludedAnalysisIds || []).filter(Boolean));
    const quoteNode = state.quotes.find((quote) => quote.id === quoteId);
    const fromMeta = Array.isArray(quoteNode?.meta?.analysisNodeIds)
      ? quoteNode.meta.analysisNodeIds.filter((id) => !excluded.has(id))
      : [];
    const fromNodes = getAnalysesForQuote(quoteId)
      .map((analysis) => analysis.id)
      .filter((id) => !excluded.has(id));
    return Array.from(new Set([...fromMeta, ...fromNodes]));
  }

  function canDeleteQuoteAsPrivateDependency(quoteId, excludedAnalysisIds = []) {
    if (!quoteId) return false;
    return getOtherAnalysisIdsForQuote(quoteId, excludedAnalysisIds).length === 0;
  }

  async function removeQuoteAndLinkedCuesEverywhere(quoteId) {
    if (!quoteId) return;
    const linkedCues = await getCuesForQuote(quoteId);
    for (const cue of linkedCues || []) {
      if (removeCueEverywhere) {
        await removeCueEverywhere(cue.id);
      } else if (deleteCue) {
        await deleteCue(cue.id);
      }
    }
    await removeQuoteEverywhere(quoteId);
  }

  function getQuoteCleanupSummary(quoteIds, excludedAnalysisIds = []) {
    const attachedQuoteIds = Array.from(new Set((quoteIds || []).filter(Boolean)));
    const deletableQuoteIds = attachedQuoteIds.filter((quoteId) =>
      canDeleteQuoteAsPrivateDependency(quoteId, excludedAnalysisIds)
    );
    const attachedCueCount = (state.cues || []).filter((cue) => attachedQuoteIds.includes(cue.quoteId)).length;
    const deletableCueCount = (state.cues || []).filter((cue) => deletableQuoteIds.includes(cue.quoteId)).length;
    return {
      attachedQuoteIds,
      deletableQuoteIds,
      attachedCueCount,
      deletableCueCount
    };
  }

  let resolveAnalysisCleanupChoice = null;

  function hideAnalysisCleanupDialog(choice = null) {
    if (analysisCleanupModal) {
      analysisCleanupModal.classList.remove("open");
      analysisCleanupModal.setAttribute("aria-hidden", "true");
    }
    if (resolveAnalysisCleanupChoice) {
      const resolve = resolveAnalysisCleanupChoice;
      resolveAnalysisCleanupChoice = null;
      resolve(choice);
    }
  }

  function showAnalysisCleanupDialog({
    title,
    message,
    summary,
    keepLabel,
    deleteLabel
  }) {
    if (!analysisCleanupModal || !analysisCleanupMessage || !analysisCleanupSummary || !analysisCleanupKeepBtn || !analysisCleanupDeleteBtn) {
      return Promise.resolve(null);
    }

    const titleEl = document.getElementById("analysisCleanupTitle");
    if (titleEl) titleEl.textContent = title || "Linked quotes need a decision";
    analysisCleanupMessage.textContent = message || "";
    analysisCleanupSummary.innerHTML = summary || "";
    analysisCleanupKeepBtn.textContent = keepLabel || "Keep quotes";
    analysisCleanupDeleteBtn.textContent = deleteLabel || "Delete private quotes";
    analysisCleanupModal.classList.add("open");
    analysisCleanupModal.setAttribute("aria-hidden", "false");

    return new Promise((resolve) => {
      resolveAnalysisCleanupChoice = resolve;
    });
  }

  // NEW: Parent choice modal for orphaned analyses
  let resolveParentChoice = null;

  function hideParentChoiceModal() {
    if (analysisParentModal) {
      analysisParentModal.classList.remove("open");
      analysisParentModal.setAttribute("aria-hidden", "true");
    }
    if (resolveParentChoice) {
      const resolve = resolveParentChoice;
      resolveParentChoice = null;
      resolve(null);
    }
  }

  function showParentChoiceModal(sourceTitle) {
    if (!analysisParentModal) return Promise.resolve(null);

    analysisParentMessage.textContent = `This analysis has no quote references. Choose how to parent it:`;
    analysisParentModal.classList.add("open");
    analysisParentModal.setAttribute("aria-hidden", "false");

    return new Promise((resolve) => {
      resolveParentChoice = resolve;
    });
  }

  /**
   * Create a new quote node from selected text
   * NEW: Path 1 - Create Quote Node from source
   */
  async function createQuoteNode(quoteText, sourceId, start, end, prefix = "", suffix = "") {
    if (!sourceId) {
      console.warn("Missing sourceId, skipping quote creation");
      return null;
    }
    let source = getSourceById(sourceId);
    if (!source) {
      source = await getNode(sourceId);
    }
    if (!source) throw new Error("Source not found");

    const now = Date.now();
    const path = source?.meta?.hierarchyPath || [source?.subject || "", ...(source?.section ? source.section.split(" > ") : [])];

     const quoteNode = {
       id: crypto.randomUUID(),
       type: "quote",
       subject: source.subject,
       section: source.section || buildSection(path),
       title: source.title,
      quote: quoteText,
      priority: 3,
      link: {
        sourceId: sourceId,
        start: start,
        end: end,
        prefix: prefix,
        suffix: suffix
      },
      meta: {
        hierarchyPath: path,
        sourceOrder: start,
        tags: [],
        analysisNodeIds: [] // Will be populated with linked analyses
      },
      createdAt: now,
      updatedAt: now
    };

    await addQuote(quoteNode);
    return quoteNode;
  }

  // Sync tags from a quote node to the tag store
  async function syncQuoteTagsToTagStore(quote) {
    if (!quote?.meta?.tags || !Array.isArray(quote.meta.tags) || quote.meta.tags.length === 0) return;
    await syncTagsToTagStore(quote.meta.tags, quote.subject || "");
  }

  // NOTE: linkAnalysisToQuote and unlinkAnalysisFromQuote should be imported from db.js
  // They are called with parameter order: (quoteId, analysisId)
  // This is handled via reconcileAnalysisQuoteLinks below

  async function ensureQuoteRecord(ref) {
    // Validate ref before processing
    if (!ref?.quote || ref.start == null || ref.end == null) {
      console.warn("Skipping invalid ref:", ref);
      return null;
    }
    if (!ref.sourceId) {
      console.warn("BROKEN REF:", ref, "falling back to selectedSourceId:", state.selectedSourceId);
      ref.sourceId = state.selectedSourceId;
    }
    const priority = clampPriority(ref.priority);

    // If quoteId is provided, use that reference
    if (ref.quoteId) {
      const existingQuote = state.quotes.find((quote) => quote.id === ref.quoteId) || await getQuote(ref.quoteId);
      if (existingQuote) {
        const updatedQuote = {
          ...existingQuote,
          quote: ref.quote || existingQuote.quote,
          section: ref.section || existingQuote.section,
          priority,
          link: {
            ...(existingQuote.link || {}),
            sourceId: ref.sourceId || existingQuote.link?.sourceId,
            start: Number.isFinite(Number(ref.start)) ? Number(ref.start) : existingQuote.link?.start,
            end: Number.isFinite(Number(ref.end)) ? Number(ref.end) : existingQuote.link?.end
          },
          updatedAt: Date.now()
        };
        await addQuote(updatedQuote);
        return updatedQuote;
      }
    }

    // NEW: Try to find existing quote by text before creating new one
    // This prevents duplicate quote nodes for the same text
    if (ref.quote && ref.sourceId) {
      const existingByText = await findExistingQuoteByText(ref.sourceId, ref.quote);
      if (existingByText) {
        // Found existing quote with same text - update priority if needed
        const updatedQuote = {
          ...existingByText,
          priority: Math.max(priority, existingByText.priority || 1),
          link: {
            ...(existingByText.link || {}),
            sourceId: ref.sourceId,
            start: Number.isFinite(Number(ref.start)) ? Number(ref.start) : existingByText.link?.start,
            end: Number.isFinite(Number(ref.end)) ? Number(ref.end) : existingByText.link?.end
          },
          updatedAt: Date.now()
        };
        await addQuote(updatedQuote);
        return updatedQuote;
      }
    }

    // Create new quote only if no existing one found
    const createdQuote = await createQuoteNode(ref.quote || "", ref.sourceId, ref.start, ref.end);
    const savedQuote = {
      ...createdQuote,
      priority,
      updatedAt: Date.now()
    };
    await addQuote(savedQuote);
    return savedQuote;
  }

  async function reconcileAnalysisQuoteLinks(analysisId, previousRefs, nextRefs) {
    const previousIds = new Set((previousRefs || []).map((ref) => ref.quoteId).filter(Boolean));
    const nextIds = new Set((nextRefs || []).map((ref) => ref.quoteId).filter(Boolean));

    for (const quoteId of previousIds) {
      if (nextIds.has(quoteId)) continue;
      // FIX: Use correct parameter order (quoteId, analysisId)
      await unlinkAnalysisFromQuote(quoteId, analysisId);
      if (canDeleteQuoteAsPrivateDependency(quoteId, [analysisId])) {
        await removeQuoteAndLinkedCuesEverywhere(quoteId);
      }
    }

    for (const ref of nextRefs || []) {
      if (!ref.quoteId) continue;
      // FIX: Use correct parameter order (quoteId, analysisId)
      await linkAnalysisToQuote(ref.quoteId, analysisId);
    }
  }

  // ========= TAG SYNC HELPER =========
  // When tags are used in nodes/quotes, ensure they exist in the 'tags' store
  async function syncTagsToTagStore(tags, subject) {
    if (!tags || !Array.isArray(tags) || tags.length === 0) return;
    try {
      const existingTags = await getAllTags();
      const existingTitles = new Set(existingTags.map(t => t.title.toLowerCase()));
      for (const tag of tags) {
        const normalized = String(tag).trim();
        if (!normalized) continue;
        if (existingTitles.has(normalized.toLowerCase())) continue;
        // Create tag node in the tags store
        await addTag({
          title: normalized,
          subject,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        existingTitles.add(normalized.toLowerCase());
      }
    } catch (error) {
      console.warn("Failed to sync tags to tag store:", error);
    }
  }

  // ========= MIGRATE EXISTING TAGS TO TAG STORE =========
  // On init, scan all nodes and quotes for tags in meta.tags and sync to the 'tags' store
  async function syncAllExistingTags() {
    try {
      const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
      const allTags = new Set();

      // Collect all tags from nodes
      for (const node of nodes) {
        if (node?.meta?.tags && Array.isArray(node.meta.tags)) {
          for (const tag of node.meta.tags) {
            const value = String(tag || "").trim();
            if (value) allTags.add(value);
          }
        }
      }

      // Collect all tags from quotes
      for (const quote of quotes) {
        if (quote?.meta?.tags && Array.isArray(quote.meta.tags)) {
          for (const tag of quote.meta.tags) {
            const value = String(tag || "").trim();
            if (value) allTags.add(value);
          }
        }
      }

      if (allTags.size > 0) {
        await syncTagsToTagStore(Array.from(allTags), "");
      }
    } catch (error) {
      console.warn("Failed to sync existing tags:", error);
    }
  }

  async function saveAnalysisNodeWithIntegrity({ analysisId, analysis, tags, parentToSource = false }) {
    const existing = state.analysisNodes.find((node) => node.id === analysisId) || null;
    const now = Date.now();
    const draftRefs = getSelectedQuoteRefs().map(cloneQuoteRef);
    const savedQuoteRefs = [];

    for (const ref of draftRefs) {
      const quoteNode = await ensureQuoteRecord(ref);
      if (!quoteNode) continue;
      const quoteRef = buildQuoteRefFromQuoteNode(quoteNode);
      if (!quoteRef) continue;
      savedQuoteRefs.push(quoteRef);
    }

    const analysisNode = {
      id: analysisId,
      type: "analysis",
      subject: state.selectedSubject,
      section: null,
      title: "",
      content: "",
      analysis,
      quoteRefs: savedQuoteRefs,
      link: parentToSource && state.selectedSourceId
        ? { sourceId: state.selectedSourceId }
        : (existing?.link || {}),
      meta: {
        ...(existing?.meta || {}),
        globalScope: true,
        tags,
        confidence: existing?.meta?.confidence ?? 0.7,
        nextReview: existing?.meta?.nextReview ?? null
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    await addNode(analysisNode);

    // Sync tags to the tag store so mindmap tool can see them
    if (tags && tags.length > 0) {
      await syncTagsToTagStore(tags, state.selectedSubject);
    }

    await refreshData();
    await reconcileAnalysisQuoteLinks(analysisId, existing?.quoteRefs || [], savedQuoteRefs);
    await refreshData();
  }

  async function deleteAnalysisNodeWithIntegrity(node, options = {}) {
    const removeDetachedQuotes = options.removeDetachedQuotes !== false;
    for (const ref of node?.quoteRefs || []) {
      if (!ref.quoteId) continue;
      // FIX: Use correct parameter order (quoteId, analysisId)
      await unlinkAnalysisFromQuote(ref.quoteId, node.id);
      if (removeDetachedQuotes && canDeleteQuoteAsPrivateDependency(ref.quoteId, [node.id])) {
        await removeQuoteAndLinkedCuesEverywhere(ref.quoteId);
      }
    }

    await removeNodeEverywhere(node.id);
  }

  /**
   * Get all quotes referenced by an analysis node
   */
  function getQuotesForAnalysis(analysisId) {
    const analysis = state.analysisNodes.find(n => n.id === analysisId);
    if (!analysis || !analysis.quoteRefs) return [];

    return analysis.quoteRefs.map(ref =>
      state.quotes.find(q => q.id === ref.quoteId)
    ).filter(Boolean);
  }

  /**
   * Get all analyses that reference a specific quote
   */
  function getAnalysesForQuote(quoteId) {
    return state.analysisNodes.filter(analysis =>
      analysis.quoteRefs && analysis.quoteRefs.some(ref => ref.quoteId === quoteId)
    );
  }

  // ========== END: QUOTE AND ANALYSIS LINKING ==========

  function renderStats() {
    const subjects = new Set([
      ...state.subjectNodes.map((node) => node.subject || node.title),
      ...state.sources.map((source) => source.subject),
      ...state.analysisNodes.map((node) => node.subject)
    ].filter(Boolean));

    analysisStats.innerHTML = `
      <div class="stats-row">
        <article class="stat-card"><strong>${subjects.size}</strong><span>Subjects</span></article>
        <article class="stat-card"><strong>${state.sources.length}</strong><span>Sources</span></article>
        <article class="stat-card"><strong>${state.analysisNodes.length}</strong><span>Analysis Nodes</span></article>
        <article class="stat-card"><strong>${countQuoteRefsAcrossAnalyses()}</strong><span>Quotes</span></article>
      </div>
    `;
  }

  function updateSubjectCreateState() {
    if (!newSubjectName || !addSubjectBtn) return;
    const subject = (newSubjectName.value || "").trim();
    const disabled = !subject || subjectExists(subject);
    addSubjectBtn.disabled = disabled;
    addSubjectBtn.setAttribute("aria-disabled", disabled ? "true" : "false");
  }

  function renderSubjects() {
    const subjects = Array.from(new Set([
      ...state.subjectNodes.map((node) => node.subject || node.title),
      ...state.sources.map((source) => source.subject)
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

    const subjectListEl = document.getElementById("sourceSubjectList");
    if (subjectListEl) {
      subjectListEl.innerHTML = subjects.map((s) => `<option value="${escapeHtml(s)}"></option>`).join("");
    }

    const unfiledSources = state.sources.filter((source) => !String(source.subject || "").trim());

    if (!subjects.length && !unfiledSources.length) {
      subjectList.innerHTML = `<div class="empty-note">No subjects yet. Add your first subject to begin.</div>`;
      return;
    }

    const cardSubject = (subject) => `
      <article class="subject-card" data-subject="${escapeHtml(subject)}">
        <span class="subject-name">${escapeHtml(subject)}</span>
        <div class="subject-actions" ${state.subjectEditMode ? "" : "hidden"}>
          <button class="btn" type="button" data-action="rename-subject" data-subject="${escapeHtml(subject)}">Rename</button>
          <button class="btn" type="button" data-action="delete-subject" data-subject="${escapeHtml(subject)}">Delete</button>
        </div>
      </article>
    `;

    const cards = subjects
      .map((subject) => cardSubject(subject))
      .concat(unfiledSources.length
        ? `<article class="subject-card unfiled-card" data-subject="">
            <span class="subject-name">Unfiled <span style="opacity:.55;font-size:.75rem">(${unfiledSources.length})</span></span>
            <div class="subject-actions" ${state.subjectEditMode ? "" : "hidden"}></div>
          </article>`
        : []);

    subjectList.innerHTML = cards.join("");

    // Make entire card clickable
    subjectList.querySelectorAll(".subject-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".subject-actions")) return;
        state.selectedSubject = card.dataset.subject || "";
        state.view = "study";
        state.selectedSourceId = "";
        state.isCreatingSource = false;
        // Entering from launchpad always starts in the WYSIWYG source editor.
        // This avoids restoring a stale reader/editor choice from a previous
        // subject while keeping the reader one click away.
        state.viewMode = "editor";
        resetSourceForm();
        resetAnalysisForm();
        renderState();
      });
    });
  }

  function renderSources() {
    const sources = getSourcesForSelectedSubject();

    if (state.isCreatingSource) {
      layer1Select.style.display = "none";
      layer2Select.style.display = "none";
      layer3Select.style.display = "none";
      // Keep existing files reachable while the new source is still a
      // transient buffer. The blank option keeps the current draft selected.
      const otherSources = state.sources
        .slice()
        .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || "")));
      sourceSelect.style.display = otherSources.length ? "inline-block" : "none";
      sourceSelect.innerHTML = [
        `<option value="">New source (unsaved)</option>`,
        ...otherSources.map((source) => {
          const subject = source.subject ? `${source.subject} — ` : "";
          return `<option value="${escapeHtml(source.id)}">${escapeHtml(subject + (source.title || "Untitled source"))}</option>`;
        })
      ].join("");
      sourceSelect.value = "";
      analysisReader.innerHTML = "";
      analysisNodeList.innerHTML = `<div class="empty-note">New source — save it to begin analysing.</div>`;
      deleteSourceBtn.disabled = true;
      return;
    }

    if (!sources.length) {
      layer1Select.innerHTML = `<option value="">No sources</option>`;
      layer2Select.style.display = "none";
      layer3Select.style.display = "none";
      sourceSelect.style.display = "none";
      analysisReader.innerHTML = "";
      analysisNodeList.innerHTML = `<div class="empty-note">No analysis nodes yet.</div>`;
      state.selectedSourceId = "";
      deleteSourceBtn.disabled = true;
      resetAnalysisForm();
      return;
    }

    const OTHER_KEY = "__other__";
    const DIRECT_KEY = "__direct__";

    const layerEntries = sources.map((source) => {
      const path = source?.meta?.hierarchyPath || [source.subject, ...(source.section ? source.section.split(" > ") : [])];
      const cleanPath = (path || []).map((s) => String(s || "").trim());
      const l1 = cleanPath[1] || OTHER_KEY;
      const l2 = cleanPath[2] || "";
      const l3 = cleanPath[3] || "";
      return { source, l1, l2, l3 };
    });

    state.layerEntries = layerEntries;

    const l1Options = Array.from(new Set(layerEntries.map((e) => e.l1))).sort((a, b) => {
      if (a === OTHER_KEY) return 1;
      if (b === OTHER_KEY) return -1;
      return a.localeCompare(b);
    });

    layer1Select.innerHTML = l1Options.map((k) => {
      const label = k === OTHER_KEY ? "(Other)" : k;
      return `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`;
    }).join("");

    const currentL1 = l1Options.includes(layer1Select.value) ? layer1Select.value : l1Options[0];
    layer1Select.value = currentL1;

const updateLayerSelection = () => {
      const selectedL1 = layer1Select.value || l1Options[0];
      const entriesL1 = layerEntries.filter((e) => e.l1 === selectedL1);

      const l2Keys = Array.from(new Set(entriesL1.map((e) => e.l2 || DIRECT_KEY))).sort((a, b) => {
        if (a === DIRECT_KEY) return -1;
        if (b === DIRECT_KEY) return 1;
        return a.localeCompare(b);
      });
      const hasNonDirectL2 = l2Keys.some((k) => k !== DIRECT_KEY);

      if (!hasNonDirectL2) {
        layer2Select.style.display = "none";
        layer2Select.value = "";
        layer3Select.style.display = "none";
        layer3Select.value = "";

        const sourcesForL1 = entriesL1.map((e) => e.source);
        renderSourceOptions(sourcesForL1);
        return;
      }

      layer2Select.style.display = "inline-block";

      const hasLayer1Changed = !state.lastLayer1Value || state.lastLayer1Value !== selectedL1;
      state.lastLayer1Value = selectedL1;

      if (hasLayer1Changed) {
        layer2Select.innerHTML = l2Keys.map((k) => {
          const label = k === DIRECT_KEY ? "(Direct)" : k;
          return `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`;
        }).join("");
        layer2Select.value = l2Keys[0];
      } else {
        const savedL2Value = layer2Select.value;
        layer2Select.innerHTML = l2Keys.map((k) => {
          const label = k === DIRECT_KEY ? "(Direct)" : k;
          return `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`;
        }).join("");
        if (l2Keys.includes(savedL2Value)) {
          layer2Select.value = savedL2Value;
        } else {
          layer2Select.value = l2Keys[0];
        }
      }

      const currentL2 = layer2Select.value;

      const entriesL2 = entriesL1.filter((e) => (e.l2 || DIRECT_KEY) === currentL2);

      const l3Keys = Array.from(new Set(entriesL2.map((e) => e.l3 || DIRECT_KEY))).sort((a, b) => {
        if (a === DIRECT_KEY) return -1;
        if (b === DIRECT_KEY) return 1;
        return a.localeCompare(b);
      });
      const hasNonDirectL3 = l3Keys.some((k) => k !== DIRECT_KEY);

      if (!hasNonDirectL3) {
        layer3Select.style.display = "none";
        layer3Select.value = "";
        renderSourceOptions(entriesL2.map((e) => e.source));
        return;
      }

      layer3Select.style.display = "inline-block";
      layer3Select.innerHTML = l3Keys.map((k) => {
        const label = k === DIRECT_KEY ? "(Direct)" : k;
        return `<option value="${escapeHtml(k)}">${escapeHtml(label)}</option>`;
      }).join("");

      const currentL3 = l3Keys.includes(layer3Select.value) ? layer3Select.value : l3Keys[0];
      layer3Select.value = currentL3;

      const entriesL3 = entriesL2.filter((e) => (e.l3 || DIRECT_KEY) === currentL3);
      renderSourceOptions(entriesL3.map((e) => e.source));
    };

    function renderSourceOptions(sourceList) {
      const list = (sourceList || []).slice().sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || "")));

      if (!list.length) {
        sourceSelect.innerHTML = `<option value="">No sources</option>`;
        state.selectedSourceId = "";
        deleteSourceBtn.disabled = true;
        sourceSelect.style.display = "none";
        return;
      }

      if (list.length === 1) {
        state.selectedSourceId = list[0].id;
        sourceSelect.style.display = "none";
        selectSource(state.selectedSourceId);
        deleteSourceBtn.disabled = !state.selectedSourceId;
        return;
      }

      sourceSelect.style.display = "inline-block";

      if (!list.some((s) => s?.id === state.selectedSourceId)) {
        state.selectedSourceId = list[0].id;
      }

      sourceSelect.innerHTML = list
        .map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedSourceId ? "selected" : ""}>${escapeHtml(s.title || "Untitled")}</option>`)
        .join("");

      selectSource(state.selectedSourceId);
      deleteSourceBtn.disabled = !state.selectedSourceId;
    }

    layer1Select.style.display = "inline-block";
    updateLayerSelection();

    state.updateLayerSelection = updateLayerSelection;
    updateSourceNavigatorTrigger();
  }

  if (layer1Select) {
    layer1Select.addEventListener("change", () => state.updateLayerSelection?.());
  }

  if (layer2Select) {
    layer2Select.addEventListener("change", () => state.updateLayerSelection?.());
  }

  if (layer3Select) {
    layer3Select.addEventListener("change", () => state.updateLayerSelection?.());
  }

  function renderReaderAndNodes() {
    const source = getSourceById(state.selectedSourceId);
    if (!source || source.subject !== state.selectedSubject) return;

    const normalized = normalizeSource(source);
    const path = source?.meta?.hierarchyPath || [source.subject, ...(source.section ? source.section.split(" > ") : [])].filter(Boolean);

    if (studySubjectTitle) {
      studySubjectTitle.textContent = source.title || source.subject || "Untitled Source";
    }
    if (currentHierarchy) {
      const bucket = source.subject || "Unfiled";
      const rest = source.subject
        ? path.slice(1).filter(Boolean).join(" > ")
        : path.filter(Boolean).join(" > ");
      currentHierarchy.textContent = rest ? `${bucket} · ${rest}` : bucket;
    }
    const contentMd = sourceMarkdown(source);
    analysisReader.innerHTML = (contentMd.trim() ? render(parse(contentMd), "html", { softBreaks: sourceSoftBreaks(source) }) : "") || (normalized.contentHtml || "<p><br></p>");
    renderMathWithKatex(analysisReader);   // typesets $…$ maths when KaTeX is loaded (no-op otherwise)
    analysisReader.style.userSelect = "text";
    analysisReader.style.webkitUserSelect = "text";
    analysisReader.style.MozUserSelect = "text";

    const domText = analysisReader.textContent;
    const highlightRanges = buildHighlightRangesForSource(source, domText);
    highlightQuotedRanges(analysisReader, highlightRanges);

    const analysesForSource = state.analysisNodes.filter(
      (node) => node.subject === state.selectedSubject && analysisTouchesSource(node, source.id)
    ).sort((a, b) => {
      const aParented = a.link?.sourceId === source.id || a.meta?.manualLinks?.includes(source.id);
      const bParented = b.link?.sourceId === source.id || b.meta?.manualLinks?.includes(source.id);

      // Parented nodes (directly linked to this source) come first
      if (aParented !== bParented) {
        return aParented ? -1 : 1;
      }

      // Helper to get the earliest quote position in this source for sorting
      const getFirstQuoteStart = (node) => {
        // For parented nodes, use their link's start position first
        if (node.link?.sourceId === source.id && Number.isFinite(node.link?.start)) {
          return Number(node.link.start);
        }
        // Check quoteRefs for positions in this source
        if (node.quoteRefs?.length) {
          for (const ref of node.quoteRefs) {
            if (ref.sourceId === source.id && Number.isFinite(ref.start)) {
              return Number(ref.start);
            }
            const quote = state.quotes.find((q) => q.id === ref.quoteId);
            if (quote?.link?.sourceId === source.id && Number.isFinite(quote?.link?.start)) {
              return Number(quote.link.start);
            }
          }
        }
        return Infinity;
      };

      return getFirstQuoteStart(a) - getFirstQuoteStart(b);
    });

    if (!analysesForSource.length) {
      analysisNodeList.innerHTML = `<div class="empty-note">No analysis nodes reference this source yet.</div>`;
      return;
    }

    // Parse focused node IDs into a Set for quick lookup
    const focusedIds = new Set((state.focusedNodeId || "").split(",").map(s => s.trim()).filter(Boolean));

    analysisNodeList.innerHTML = analysesForSource
      .map((node, index) => {
        const tags = node?.meta?.tags || [];
        const isActive = focusedIds.has(node.id);
        const quotesHtml = (() => {
          if (node.quoteRefs?.length) {
            return node.quoteRefs
              .map((ref, refIdx) => {
                // Get the text - either from ref directly or by looking up the quote in DB
                const text = ref.quote || state.quotes.find((q) => q.id === ref.quoteId)?.quote || "";
                if (!text) return "";
                // Check if this quote is the exactly selected one
                const refRangeKey = `${ref.start}-${ref.end}`;
                // Fix: check if node is in focused set AND rangeKey matches
                const isExactQuote = focusedIds.has(node.id) && state.focusedRangeKey === refRangeKey;
                const quoteClass = isExactQuote ? "analysis-quote-jump active-quote" : "analysis-quote-jump";
                const origin = quoteRefOriginLineHtml(ref);
                const priority = clampPriority(ref.priority);
                const priorityStars = `<div style="display:flex; gap:2px; margin: 0 0 6px 0;">${[1,2,3,4,5].map((value) => `<span style="color:${value <= priority ? getPriorityColor(value) : "rgba(230,255,245,0.16)"};">${value <= priority ? "★" : "☆"}</span>`).join("")}</div>`;
                const jump = resolveRefJumpForRef(ref);
                if (jump) {
                  return `<button type="button" class="${quoteClass}" data-analysis-id="${escapeHtml(node.id)}" data-jump-source="${escapeHtml(jump.sourceId)}" data-jump-start="${jump.start}" data-jump-end="${jump.end}" data-range-key="${refRangeKey}" title="Show this quote in the source">${priorityStars}<blockquote class="analysis-quote-preview">${formatQuoteForDisplay(ref, text)}</blockquote>${origin}</button>`;
                }
                return `<div class="analysis-quote-static${isExactQuote ? " active-quote" : ""}">${priorityStars}<blockquote class="analysis-quote-preview">${formatQuoteForDisplay(ref, text)}</blockquote>${origin}</div>`;
              })
              .filter(Boolean)
              .join("");
          }
          if (node.quote) {
            const legacySrc = node.link?.sourceId ? getSourceById(node.link.sourceId) : null;
            const legacyRef = { sourceId: node.link?.sourceId };
            const origin = quoteRefOriginLineHtml(legacyRef);
            if (legacySrc) {
              const norm = normalizeSource(legacySrc);
              const off = resolveLegacyLinkedOffsets(node, legacySrc, norm.contentText || "");
              if (off) {
                return `<button type="button" class="analysis-quote-jump" data-analysis-id="${escapeHtml(node.id)}" data-jump-source="${escapeHtml(legacySrc.id)}" data-jump-start="${off.start}" data-jump-end="${off.end}" title="Show this quote in the source"><blockquote class="analysis-quote-preview">${formatQuoteForDisplay(node.quote || "")}</blockquote>${origin}</button>`;
              }
            }
            return `<div class="analysis-quote-static"><blockquote class="analysis-quote-preview">${formatQuoteForDisplay(node.quote || "")}</blockquote>${origin}</div>`;
          }
          return "";
        })();
        return `
          <article class="item-card analysis-item ${isActive ? "active" : ""} ${node?.meta?.flagged ? "flagged" : ""}" data-node-id="${escapeHtml(node.id)}" data-quote-start="${Number(node?.link?.start ?? 0)}">
            <div class="card-header">
              <div class="location">#${index + 1}</div>
              <div class="card-actions">
                <button class="icon-btn flag-btn ${node?.meta?.flagged ? "flagged" : ""}" type="button" data-action="flag-node" data-id="${escapeHtml(node.id)}" title="Flag for review" aria-label="Flag for review">🚩</button>
                <button class="icon-btn copy-btn" type="button" data-action="copy-node" data-id="${escapeHtml(node.id)}" title="Copy referenced quotes" aria-label="Copy referenced quotes">📋</button>
                <button class="icon-btn edit-btn" type="button" data-action="edit-node" data-id="${escapeHtml(node.id)}" title="Edit" aria-label="Edit analysis">✎</button>
                <button class="icon-btn delete-btn" type="button" data-action="delete-node" data-id="${escapeHtml(node.id)}" title="Delete" aria-label="Delete analysis">🗑</button>
              </div>
            </div>
            ${quotesHtml}
            <p>${escapeHtml(node.analysis || "")}</p>
            ${tags.length ? `<div class="chips">${tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          </article>
        `;
      })
      .join("");
  }

  function renderState() {
    const inStudy = state.view === "study";
    const inLibrary = state.view === "library";
    launchpadView.hidden = inStudy || inLibrary;
    if (sourceLibraryView) sourceLibraryView.hidden = !inLibrary;
    studyView.hidden = !inStudy;
    studySubjectTitle.textContent = state.selectedSubject || "Unfiled";
    if (!getSourceById(state.selectedSourceId)) {
      if (currentHierarchy) currentHierarchy.textContent = "";
    }

    if (typeof window.__neuronetCanFocus !== "function") {
      window.__neuronetCanFocus = () => inStudy;
    }
    window.__neuronetCanFocus = () => inStudy;

    if (inLibrary) {
      renderSourceNavigator();
    } else if (inStudy) {
      setSourceViewMode(state.viewMode);
      renderSources();
      renderReaderAndNodes();
      setTimeout(enforceUserSelect, 10);
    } else {
      state.selectedRange = null;
      setSourceViewMode("reader");
    }

    renderStats();
    renderSubjects();
    state.wasInStudy = inStudy;
    enforceUserSelect();
  }

  async function refreshData() {
    const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
    state.nodes = nodes;
    state.quotes = quotes;
    state.cues = cues;
    state.subjectNodes = state.nodes.filter((node) => node?.type === "subject" || node?.meta?.kind === "subject");
    state.sources = state.nodes.filter((node) => isSourceNode(node) && node?.type === "source");
    state.analysisNodes = state.nodes.filter((node) => node?.type === "analysis");
    renderState();
    updateSubjectCreateState();
  }

  async function renameSubject(subjectName) {
    const updated = await dialog.prompt(`Rename subject "${subjectName}" to:`, subjectName);
    const next = (updated || "").trim();
    if (!next || next === subjectName) return;

    const related = state.nodes.filter((node) => {
      if (node?.type === "subject" || node?.meta?.kind === "subject") {
        return (node.subject || node.title) === subjectName;
      }
      return node.subject === subjectName;
    });

    const now = Date.now();
    for (const node of related) {
      const copy = { ...node };
      copy.subject = next;
      if (copy.type === "subject" || copy.meta?.kind === "subject") {
        copy.title = next;
      }
      if (Array.isArray(copy.meta?.hierarchyPath) && copy.meta.hierarchyPath.length) {
        copy.meta = { ...copy.meta, hierarchyPath: [next, ...copy.meta.hierarchyPath.slice(1)] };
      }
      copy.updatedAt = now;
      await addNode(copy);
    }

    const relatedQuotes = state.quotes.filter((quote) => quote.subject === subjectName);
    for (const quote of relatedQuotes) {
      const path = Array.isArray(quote.meta?.hierarchyPath) ? quote.meta.hierarchyPath : [];
      await addQuote({
        ...quote,
        subject: next,
        meta: {
          ...(quote.meta || {}),
          hierarchyPath: path.length ? [next, ...path.slice(1)] : path
        },
        updatedAt: now
      });
    }

    if (state.selectedSubject === subjectName) {
      state.selectedSubject = next;
    }

    await refreshData();
    await backupLocalNodesToCloud();
  }

  async function deleteSubject(subjectName) {
    const typed = await dialog.prompt(`Type "${subjectName}" to confirm deletion.`);
    if (typed !== subjectName) return;

    const related = state.nodes.filter((node) => {
      if (node?.type === "subject" || node?.meta?.kind === "subject") {
        return (node.subject || node.title) === subjectName;
      }
      return node.subject === subjectName;
    });

    for (const node of related) {
      if (node.type === "analysis") {
        await deleteAnalysisNodeWithIntegrity(node);
      } else {
        await removeNodeEverywhere(node.id);
      }
    }

    for (const quote of state.quotes.filter((item) => item.subject === subjectName)) {
      await removeQuoteAndLinkedCuesEverywhere(quote.id);
    }

    if (state.selectedSubject === subjectName) {
      state.selectedSubject = "";
      state.selectedSourceId = "";
      state.view = "launchpad";
    }

    await refreshData();
    await backupLocalNodesToCloud();
  }

  toggleSubjectEdit.addEventListener("click", () => {
    state.subjectEditMode = !state.subjectEditMode;
    toggleSubjectEdit.textContent = state.subjectEditMode ? "Done Editing Subjects" : "Edit Subjects";
    renderSubjects();
  });

  addSubjectBtn.addEventListener("click", async () => {
    const subject = (newSubjectName.value || "").trim();
    if (!subject || subjectExists(subject)) return;

    const now = Date.now();
    await addNode({
      id: crypto.randomUUID(),
      type: "subject",
      subject,
      title: subject,
      content: "",
      meta: { kind: "subject" },
      createdAt: now,
      updatedAt: now
    });

    newSubjectName.value = "";
    updateSubjectCreateState();
    await refreshData();
    await backupLocalNodesToCloud();
  });

  if (newSubjectName) {
    newSubjectName.addEventListener("input", updateSubjectCreateState);
  }

  subjectList.addEventListener("click", async (event) => {
    // Check if clicking on action buttons (Rename/Delete)
    const button = event.target.closest("button[data-action]");
    if (button) {
      const subject = button.dataset.subject;
      if (!subject) return;

      if (button.dataset.action === "rename-subject") {
        await renameSubject(subject);
        return;
      }

      if (button.dataset.action === "delete-subject") {
        await deleteSubject(subject);
      }
      return;
    }

    // Otherwise, clicking on card body opens subject
    const card = event.target.closest(".subject-card");
    if (card && !event.target.closest(".subject-actions")) {
      state.selectedSubject = card.dataset.subject || "";
      state.view = "study";
      state.selectedSourceId = "";
      state.isCreatingSource = false;
      state.viewMode = "editor";
      resetSourceForm();
      resetAnalysisForm();
      renderState();
    }
  });

  // Back to launchpad button handler - goes to analysis tool launchpad, not global
  if (backToLaunchpad) {
    backToLaunchpad.addEventListener("click", async () => {
      state.selectedSubject = "";
      state.selectedSourceId = "";
      state.isCreatingSource = false;
      state.viewMode = "reader";
      state.wasInStudy = false;
      state.view = "launchpad";
      resetSourceForm();
      resetAnalysisForm();
      // Hide study view, show analysis tool launchpad
      if (launchpadView && studyView) {
        launchpadView.hidden = false;
        studyView.hidden = true;
      }
      // Don't call global launchpad - stay in analysis tool
    });
  } else {
    // Fallback: use event delegation on document
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("#backToLaunchpad");
      if (btn) {
        state.selectedSubject = "";
        state.selectedSourceId = "";
        state.viewMode = "reader";
        state.wasInStudy = false;
        state.view = "launchpad";
        resetSourceForm();
        resetAnalysisForm();
        if (launchpadView && studyView) {
          launchpadView.hidden = false;
          studyView.hidden = true;
        }
      }
    }, { once: true });
  }

  if (sourceSelect) {
    sourceSelect.addEventListener("change", () => {
      const selectedId = sourceSelect.value;
      if (!selectedId) return;

      state.selectedSourceId = selectedId;
      state.isCreatingSource = false;
      const selectedSource = getSourceById(selectedId);
      if (selectedSource) state.selectedSubject = selectedSource.subject || "";
      rememberWorkspace();
      state.focusedNodeId = null;
      state.focusedRangeKey = null;

      if (state.viewMode === "editor") {
        if (selectedSource) {
          hydrateSourceForm(selectedSource);
        }
      } else {
        renderReaderAndNodes();
      }
    });
  }

  if (sourceNavigatorBtn) sourceNavigatorBtn.addEventListener("click", openSourceNavigator);
  if (sourceNavigatorSearch) sourceNavigatorSearch.addEventListener("input", renderSourceNavigator);
  sourceLibraryView?.addEventListener("click", async (event) => {
    const groupTitle = event.target.closest(".source-navigator-group-title");
    if (groupTitle) {
      event.preventDefault();
      const group = groupTitle.parentElement;
      const isOpen = group?.classList.toggle("is-open");
      groupTitle.setAttribute("aria-expanded", String(Boolean(isOpen)));
      return;
    }

    const recentRemove = event.target.closest("[data-recent-remove]");
    if (recentRemove) {
      event.preventDefault();
      removeRecentSource(recentRemove.dataset.recentRemove);
      renderSourceNavigator();
      return;
    }

    if (event.target.closest("[data-source-navigator-close]")) {
      closeSourceNavigator();
      return;
    }

    const actionButton = event.target.closest("[data-source-action]");
    const sourceButton = event.target.closest("[data-source-select]");
    const sourceId = actionButton?.dataset.sourceId || sourceButton?.dataset.sourceSelect;
    if (!sourceId) return;

    if (actionButton) {
      const source = getSourceById(sourceId);
      if (!source) return;
      if (source.id === state.selectedSourceId && !(await confirmSourceNavigation())) return;
      if (actionButton.dataset.sourceAction === "rename") {
        const title = await dialog.prompt("Rename source", source.title || "Untitled source");
        if (title === null || !title.trim() || title.trim() === source.title) return;
        await persistSourcePatch(source, { title: title.trim() });
        renderSourceNavigator();
      } else if (actionButton.dataset.sourceAction === "move") {
        const subject = await dialog.prompt("Move to subject (leave blank for Unfiled)", source.subject || "");
        if (subject === null) return;
        const currentPath = sourceHierarchy(source).slice(1).join(" > ");
        const section = await dialog.prompt("Move to folder path (optional, use > between levels)", currentPath);
        if (section === null) return;
        const path = normalizeHierarchyPath([subject.trim(), ...section.split(">")]);
        await persistSourcePatch(source, {
          subject: subject.trim(),
          section: buildSection(path),
          meta: { ...(source.meta || {}), hierarchyPath: path }
        });
        if (typeof toast === "function") toast("Source moved");
        renderSourceNavigator();
      } else if (actionButton.dataset.sourceAction === "duplicate") {
        const copy = {
          ...source,
          id: crypto.randomUUID(),
          title: `${source.title || "Untitled source"} (Copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: { ...(source.meta || {}) }
        };
        await addNode(copy);
        await refreshData();
        await backupLocalNodesToCloud();
        state.selectedSubject = copy.subject || "";
        state.selectedSourceId = copy.id;
        selectSource(copy.id);
        if (typeof toast === "function") toast("Source duplicated");
        closeSourceNavigator();
      } else if (actionButton.dataset.sourceAction === "delete") {
        await deleteSourceById(sourceId);
        renderSourceNavigator();
      }
      return;
    }

    if (!(await confirmSourceNavigation())) return;
    const source = getSourceById(sourceId);
    if (!source) return;
    state.selectedSubject = source.subject || "";
    state.selectedSourceId = source.id;
    state.isCreatingSource = false;
    rememberRecentSource(source.id);
    selectSource(source.id);
    state.view = "study";
    closeSourceNavigator();
    renderState();
  });

  if (sourceLibrarySubjects) {
    sourceLibrarySubjects.addEventListener("click", () => {
      state.view = "launchpad";
      renderState();
    });
  }

  if (sourceNavigatorNew) {
    sourceNavigatorNew.addEventListener("click", async () => {
      if (!(await confirmSourceNavigation())) return;
      closeSourceNavigator();
      newSourceBtn?.click();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.view === "library") closeSourceNavigator();
  });


  // Add click handler for the new "+ Add Analysis Node" button
  if (addAnalysisNodeBtn) {
    addAnalysisNodeBtn.addEventListener("click", () => {
      clearAnalysisDraft();
      showAnalysisCard();
      analysisNotesInput.focus();
    });
  }

  if (deleteSourceBtn) {
    deleteSourceBtn.addEventListener("click", async () => {
      const source = getSourceById(state.selectedSourceId);
      if (!source) return;

      const linked = state.analysisNodes.filter((node) => analysisTouchesSource(node, source.id));
      const approved = await dialog.confirm(`Delete "${source.title}" and ${linked.length} linked analysis node(s)?`, "Delete", "danger");
      if (!approved) return;

      for (const node of linked) {
        await deleteAnalysisNodeWithIntegrity(node);
      }
      for (const quote of state.quotes.filter((item) => item.link?.sourceId === source.id)) {
        await removeQuoteAndLinkedCuesEverywhere(quote.id);
      }
      await removeNodeEverywhere(source.id);

      state.selectedSourceId = "";
      resetSourceForm();
      resetAnalysisForm();
      setSourceViewMode("reader");
      await refreshData();
      await backupLocalNodesToCloud();
    });
  }

  let sourceSaveInProgress = false;
  if (sourceForm) {
    sourceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (sourceSaveInProgress) return;
      sourceSaveInProgress = true;
      if (saveSourceBtn) saveSourceBtn.disabled = true;
      let sourcePersisted = false;

      try {

      const enteredTitle = (sourceTitleInput.value || "").trim();
      const subject = (sourceSubjectInput.value || "").trim();

      const path = normalizeHierarchyPath([
        subject,
        sourceLevel1Input?.value || "",
        sourceLevel2Input?.value || "",
        sourceLevel3Input?.value || ""
      ]);

      if (typeof mdEditor.flush === "function") {
        mdEditor.flush();
      }
      const rawMd = mdEditor.getMarkdown() || "";
      const contentMarkdown = rawMd.trim()
        ? rawMd
        : (() => {
          // WYSIWYG edits are folded back into the source textarea on a short
          // debounce — if the user saved before that flushed, recover the typed
          // content from the rendered preview rather than saving a blank body.
          const root = mdEditor.preview && (mdEditor.preview.querySelector(".md") || mdEditor.preview);
          if (!root || !root.textContent || !root.textContent.trim()) return "";
          return domToMarkdown(root) || "";
        })();
      const hasOrganization = [subject, sourceLevel1Input?.value, sourceLevel2Input?.value, sourceLevel3Input?.value]
        .some((value) => String(value || "").trim());
      if (!enteredTitle && !contentMarkdown.trim() && !hasOrganization) {
        if (typeof toast === "function") toast("Nothing to save yet");
        return;
      }
      // Writing can start before naming or filing the source. Give a non-empty
      // source a stable fallback title, while keeping a completely untouched
      // draft out of storage.
      const title = enteredTitle || "Untitled source";
      if (!enteredTitle) sourceTitleInput.value = title;
      const contentAst = parse(contentMarkdown);
      // render with the same soft-break mode the user chose, so the saved
      // html and the reader match the editor.
      const contentHtml = render(contentAst, "html", { softBreaks: mdEditor.getSoftBreaks() }) || "<p><br></p>";
      // Plain text must match the READER's text (analysisReader.textContent of the
      // rendered html) so quote offsets, resolveQuoteInSource and saved contentText
      // all live in one coordinate space. render(ast, "text") adds blockquote
      // markers and doubled newlines, which shifts every offset after a block.
      const contentText = ((div) => { div.innerHTML = contentHtml; return div.textContent || ""; })(document.createElement("div"));

      const existing = getSourceById(sourceIdInput.value);
      const now = Date.now();
      const sourceId = sourceIdInput.value || crypto.randomUUID();

      await addNode({
        id: sourceId,
        type: "source",
        subject,
        section: buildSection(path),
        title,
        content: contentText,
        contentHtml: contentHtml,
        contentText: contentText,
        contentMarkdown,
        quote: "",
        analysis: "",
        link: {},
        meta: {
          ...(existing?.meta || {}),
          kind: "source",
          softBreaks: mdEditor.getSoftBreaks(),
          hierarchyPath: path,
          formatVersion: 2
        },
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
      sourcePersisted = true;
      if (typeof toast === "function") toast("Source saved");

      // Enter the saved source's subject workspace (or unfiled if subject is empty).
      state.selectedSubject = subject;

      state.selectedSourceId = sourceId;
      state.isCreatingSource = false;
      setSourceViewMode("reader");
      await refreshData();
      rememberWorkspace();
      resetSourceForm();
      await backupLocalNodesToCloud();
      } catch (error) {
        console.error("Failed to save source:", error);
        if (typeof toast === "function") toast(sourcePersisted ? "Source saved locally; refresh failed" : "Source could not be saved");
      } finally {
        sourceSaveInProgress = false;
        if (saveSourceBtn) saveSourceBtn.disabled = false;
      }
    });

    sourceTitleInput.addEventListener("input", () => {
      if (sourceTitleInput.value.trim()) {
        sourceTitleInput.classList.remove("input-invalid");
        sourceTitleInput.removeAttribute("aria-invalid");
        const err = sourceForm.querySelector(".title-error");
        if (err) err.remove();
      }
    });
  }

function selectSource(sourceId) {
  const sourceChanged = state.selectedSourceId !== sourceId;
  // Only reset focus if source is actually changing and not from a quote click
  if (sourceChanged) {
    state.focusedNodeId = null;
    state.focusedRangeKey = null;
  }
  state.selectedSourceId = sourceId;
  rememberWorkspace();
  rememberRecentSource(sourceId);
  updateSourceNavigatorTrigger();

  if (sourceSelect) sourceSelect.value = sourceId;

  if (state.viewMode === "editor") {
    const source = getSourceById(sourceId);
    if (source) {
      hydrateSourceForm(source);
    }
  } else {
    renderReaderAndNodes();
  }
}

if (saveSourceBtn) {
    saveSourceBtn.addEventListener("click", () => {
      sourceForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
  }

  if (newSourceBtn) {
    newSourceBtn.addEventListener("click", () => {
      state.isCreatingSource = true;
      state.selectedSourceId = "";
      state.draftSourceId = crypto.randomUUID();
      state.focusedNodeId = null;
      state.focusedRangeKey = null;
      resetSourceForm();
      setSourceViewMode("editor");
      renderState();
    });
  }

  if (cancelEditSourceBtn) {
    cancelEditSourceBtn.addEventListener("click", () => {
      state.isCreatingSource = false;
      state.draftSourceId = "";
      resetSourceForm();
      setSourceViewMode("reader");
    });
  }

  if (toggleSourceModeBtn) {
    toggleSourceModeBtn.addEventListener("click", () => {
      const enteringEditor = state.viewMode !== "editor";
      setSourceViewMode(enteringEditor ? "editor" : "reader");
      if (enteringEditor) {
        const source = getSourceById(state.selectedSourceId);
        if (source) {
          hydrateSourceForm(source);
        } else {
          resetSourceForm();
        }
      }
    });
  }

  function captureSelection(e) {
    if (state.viewMode !== "reader") {
      hideQuoteButton();
      return;
    }
    if (e && e.target && quoteSelectionBtn && (e.target === quoteSelectionBtn || quoteSelectionBtn.contains(e.target))) {
      return;
    }
    const selRange = getSelectionFromReader();
    if (selRange?.range) {
      state.selectedRange = selRange;
      showQuoteButton(selRange.range);
    } else {
      if (document.activeElement !== quoteSelectionBtn) {
        state.selectedRange = null;
        hideQuoteButton();
      }
    }
  }

  if (analysisReader) {
    analysisReader.addEventListener("mouseup", captureSelection);
    analysisReader.addEventListener("keyup", captureSelection);
  }

  document.addEventListener("selectionchange", () => {
    if (state.viewMode === "reader") {
      captureSelection();
    }
  });
  document.addEventListener("mouseup", captureSelection);
  document.addEventListener("pointerup", captureSelection);

  if (quoteSelectionBtn) {
    quoteSelectionBtn.addEventListener("click", async () => {
      if (!state.selectedRange?.quote) return;
      const selection = {
        sourceId: state.selectedSourceId,
        start: state.selectedRange.start,
        end: state.selectedRange.end,
        quote: state.selectedRange.quote,
        prefix: state.selectedRange.prefix || "",
        suffix: state.selectedRange.suffix || ""
      };
      if (!selection.sourceId) {
        console.warn("quoteSelectionBtn: missing sourceId, cannot create quote");
        hideQuoteButton();
        return;
      }

      const existingQuote = await findExistingQuoteForSelection(selection);
      const quoteNode = existingQuote || await createQuoteNode(
        selection.quote,
        selection.sourceId,
        selection.start,
        selection.end,
        selection.prefix,
        selection.suffix
      );

      if (!quoteNode) {
        console.warn("quoteSelectionBtn: quoteNode is null, cannot proceed");
        hideQuoteButton();
        return;
      }

      if (!existingQuote) {
        markQuoteCreatedForAnalysisSession(quoteNode.id);
        state.quotes = [...state.quotes.filter((quote) => quote.id !== quoteNode.id), quoteNode];
      }

      if (!state.selectedQuoteRef) {
        state.selectedQuoteRef = [];
      }

      const quoteRef = buildQuoteRefFromQuoteNode(quoteNode);
      if (!state.selectedQuoteRef.some((ref) => ref.quoteId === quoteRef.quoteId)) {
        state.selectedQuoteRef.push(quoteRef);
      }

      if (quoteRefsListContainer) {
        quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
        attachQuoteRefEventListeners();
      }

      showAnalysisCard();
      analysisNotesInput.focus();
      hideQuoteButton();
    });
  }

  if (analysisForm) {
    analysisForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const analysis = (analysisNotesInput?.value || "").trim();
      const tags = parseTags(analysisTagsInput?.value || "");

      if (!analysis) {
        dialog.alert("Please enter analysis commentary.");
        return;
      }

      const analysisId = analysisNodeIdInput?.value || crypto.randomUUID();
      const hasQuoteRefs = state.selectedQuoteRef && state.selectedQuoteRef.length > 0;

      // If no quotes selected and not editing, show parent choice modal
      if (!hasQuoteRefs && !state.analysisEditMode) {
        const source = getSourceById(state.selectedSourceId);
        const choice = await showParentChoiceModal(source?.title || "");

        if (!choice) return; // User dismissed

        await saveAnalysisNodeWithIntegrity({
          analysisId,
          analysis,
          tags,
          parentToSource: choice === "source"
        });
      } else {
        await saveAnalysisNodeWithIntegrity({ analysisId, analysis, tags });
      }

      dismissAnalysisModal();
      await backupLocalNodesToCloud();
    });
  }

  if (resetAnalysisFormBtn) {
    resetAnalysisFormBtn.addEventListener("click", async () => {
      await maybeDismissAnalysisModal();
    });
  }

  // Tag selector toggle button
  const tagSelectorToggle = document.getElementById("tagSelectorToggle");
  if (tagSelectorToggle) {
    tagSelectorToggle.addEventListener("click", (e) => {
      e.preventDefault();
      toggleTagSelector();
    });
  }

  if (closeAnalysisCardBtn) {
    closeAnalysisCardBtn.addEventListener("click", async () => {
      await maybeDismissAnalysisModal();
    });
  }

  if (analysisCleanupKeepBtn) {
    analysisCleanupKeepBtn.addEventListener("click", () => {
      hideAnalysisCleanupDialog("keep");
    });
  }

  if (analysisCleanupDeleteBtn) {
    analysisCleanupDeleteBtn.addEventListener("click", () => {
      hideAnalysisCleanupDialog("delete");
    });
  }

  if (analysisCleanupClose) {
    analysisCleanupClose.addEventListener("click", () => {
      hideAnalysisCleanupDialog(null);
    });
  }

  if (analysisCleanupModal) {
    analysisCleanupModal.addEventListener("click", (event) => {
      if (event.target === analysisCleanupModal) {
        hideAnalysisCleanupDialog(null);
      }
    });
  }

  // NEW: Parent choice modal event handlers
  if (analysisParentToSourceBtn) {
    analysisParentToSourceBtn.addEventListener("click", () => {
      if (resolveParentChoice) {
        const resolve = resolveParentChoice;
        resolveParentChoice = null;
        resolve("source");
      }
      if (analysisParentModal) {
        analysisParentModal.classList.remove("open");
        analysisParentModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (analysisParentToSubjectBtn) {
    analysisParentToSubjectBtn.addEventListener("click", () => {
      if (resolveParentChoice) {
        const resolve = resolveParentChoice;
        resolveParentChoice = null;
        resolve("subject");
      }
      if (analysisParentModal) {
        analysisParentModal.classList.remove("open");
        analysisParentModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  if (analysisParentClose) {
    analysisParentClose.addEventListener("click", () => {
      hideParentChoiceModal();
    });
  }

  if (analysisParentModal) {
    analysisParentModal.addEventListener("click", (event) => {
      if (event.target === analysisParentModal) {
        hideParentChoiceModal();
      }
    });
  }

  // Cue form event listeners
  const cueForm = document.getElementById("cueForm");
  const closeCueCardBtn = document.getElementById("closeCueCard");
  const resetCueFormBtn = document.getElementById("resetCueForm");
  const deleteCueBtn = document.getElementById("deleteCueBtn");

  if (cueForm) {
    cueForm.addEventListener("submit", handleCueSubmit);
  }

  if (closeCueCardBtn) {
    closeCueCardBtn.addEventListener("click", () => {
      hideCueCard();
    });
  }

  if (resetCueFormBtn) {
    resetCueFormBtn.addEventListener("click", () => {
      hideCueCard();
    });
  }

  if (deleteCueBtn) {
    deleteCueBtn.addEventListener("click", handleDeleteCue);
  }

  // NEW: Add click listener for "+ Add Quote Reference" button
  if (addQuoteRefBtn) {
    addQuoteRefBtn.addEventListener("click", (event) => {
      event.preventDefault();

      // Give feedback to user in a non-intrusive way
      const originalText = addQuoteRefBtn.textContent;
      addQuoteRefBtn.textContent = "👆 Select a quote...";
      addQuoteRefBtn.disabled = true;

      // Focus user back to the reader to select a quote
      if (analysisReader) {
        analysisReader.focus();
      }

      // Reset button after user makes selection (quote selection will close/refresh anyway)
      setTimeout(() => {
        addQuoteRefBtn.textContent = originalText;
        addQuoteRefBtn.disabled = false;
      }, 3000);
    });
  }

  // NEW: Function to add a quote reference to the current analysis form
  window.addQuoteRefToAnalysis = async function(quoteText, quoteId) {
    if (!state.selectedQuoteRef) {
      state.selectedQuoteRef = [];
    }

    const quoteNode = state.quotes.find((quote) => quote.id === quoteId) || await getQuote(quoteId);
    if (!quoteNode) return;

    // Add quote reference to state
    const quoteRef = buildQuoteRefFromQuoteNode(quoteNode);

    // Prevent duplicates
    if (!state.selectedQuoteRef.some(ref => ref.quoteId === quoteId)) {
      state.selectedQuoteRef.push(quoteRef);
    }

    // Render quote refs in form
    if (quoteRefsListContainer) {
      quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
      attachQuoteRefEventListeners();
    }
  };

  // NEW: Function to remove quote reference
  window.removeQuoteRefFromAnalysis = async function(idx) {
    if (state.selectedQuoteRef && state.selectedQuoteRef[idx]) {
      const [removedRef] = state.selectedQuoteRef.splice(idx, 1);
      const createdIds = new Set(getAnalysisSessionCreatedQuoteIds());
      if (createdIds.has(removedRef?.quoteId) && canDeleteQuoteAsPrivateDependency(removedRef.quoteId)) {
        await removeQuoteAndLinkedCuesEverywhere(removedRef.quoteId);
        state.analysisSessionCreatedQuoteIds = getAnalysisSessionCreatedQuoteIds().filter((id) => id !== removedRef.quoteId);
        await refreshData();
      }

      if (quoteRefsListContainer) {
        quoteRefsListContainer.innerHTML = state.selectedQuoteRef.length
          ? renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100)
          : "";
        attachQuoteRefEventListeners();
      }
    }
  };

  window.setQuotePriorityForAnalysis = function(idx, priority) {
    if (!state.selectedQuoteRef?.[idx]) return;
    state.selectedQuoteRef[idx].priority = clampPriority(priority);
    if (quoteRefsListContainer) {
      quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
      attachQuoteRefEventListeners();
    }
  };

  // Smart scroll sync: when reader scroll position changes, update focused node in analysis
  let readerScrollTimeout;
  analysisReader.addEventListener("scroll", () => {
    clearTimeout(readerScrollTimeout);
    readerScrollTimeout = setTimeout(() => {
      const readerRect = analysisReader.getBoundingClientRect();
      const centerY = readerRect.height / 2;

      let closestFocusId = null;
      let closestRangeKey = null;
      let closestDistance = Infinity;

      const highlights = analysisReader.querySelectorAll(".highlight-quote");
      highlights.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const elCenterY = (rect.top + rect.bottom) / 2 - readerRect.top;
        const distance = Math.abs(elCenterY - centerY);
        const fid = el.dataset.focusId;
        if (!fid) return;
        if (distance < closestDistance) {
          closestDistance = distance;
          closestFocusId = fid;
          closestRangeKey = el.dataset.rangeKey || null;
        }
      });

      const sidebarId = resolveAnalysisIdForSidebar(closestFocusId);
      if (
        sidebarId &&
        (state.focusedNodeId !== sidebarId || state.focusedRangeKey !== closestRangeKey)
      ) {
        state.focusedNodeId = sidebarId;
        state.focusedRangeKey = closestRangeKey;
        renderReaderAndNodes();
        const card = analysisNodeList.querySelector(`[data-node-id="${sidebarId}"]`);
        if (card && analysisNodeList) {
          const cardRect = card.getBoundingClientRect();
          const listRect = analysisNodeList.getBoundingClientRect();
          const offset = cardRect.top - listRect.top - (listRect.height / 2 - cardRect.height / 2);
          analysisNodeList.scrollBy({
            top: offset,
            behavior: "smooth"
          });
        }
      }
    }, 100);
  });

  analysisNodeList.addEventListener("click", async (event) => {
    const jump = event.target.closest(".analysis-quote-jump");
    if (jump) {
      event.preventDefault();
      event.stopPropagation();
      const sid = jump.dataset.jumpSource || "";
      const start = Number(jump.dataset.jumpStart);
      const end = Number(jump.dataset.jumpEnd);
      const aid = jump.dataset.analysisId;
      if (sid && getSourceById(sid) && state.selectedSourceId !== sid) {
        state.selectedSourceId = sid;
        if (sourceSelect) sourceSelect.value = sid;
      }
      state.focusedNodeId = aid || null;
      state.focusedRangeKey =
        Number.isFinite(start) && Number.isFinite(end) && end > start ? `${start}-${end}` : null;
      renderState();
      setTimeout(() => {
        const active = analysisReader?.querySelector(".highlight-quote.active");
        if (active && analysisReader) {
          const readerRect = analysisReader.getBoundingClientRect();
          const highlightRect = active.getBoundingClientRect();
          const offset = highlightRect.top - readerRect.top - readerRect.height / 2 + highlightRect.height / 2;
          analysisReader.scrollBy({ top: offset, behavior: "smooth" });
        }
      }, 50);
      return;
    }

    const card = event.target.closest(".analysis-item");
    if (!card) {
      return;
    }

    const nodeId = card.dataset.nodeId;
    const node = state.analysisNodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    const button = event.target.closest("button[data-action]");
    if (button) {
      const action = button.dataset.action;

      if (action === "edit-node") {
        event.stopPropagation();
        state.selectedSourceId =
          node?.link?.sourceId || node.quoteRefs?.find((r) => r.sourceId)?.sourceId || state.selectedSourceId;
        renderState();
        analysisNodeIdInput.value = node.id;
        analysisNotesInput.value = node.analysis || "";
        analysisTagsInput.value = (node?.meta?.tags || []).join(", ");
        state.selectedRange = {
          start: Number(node?.link?.start || 0),
          end: Number(node?.link?.end || 0),
          quote: node.quote || ""
        };

        state.selectedQuoteRef = (node.quoteRefs || [])
          .map((ref) => {
            const quoteNode = state.quotes.find((quote) => quote.id === ref.quoteId);
            // Skip refs with no usable data
            if (!ref.quote && !quoteNode?.quote) return null;
            return cloneQuoteRef({
              ...ref,
              quote: ref.quote || quoteNode?.quote || "",
              sourceId: ref.sourceId || quoteNode?.link?.sourceId || quoteNode?.sourceId,
              start: ref.start ?? quoteNode?.link?.start,
              end: ref.end ?? quoteNode?.link?.end,
              priority: quoteNode?.priority ?? ref.priority ?? 3
            });
          })
          .filter(Boolean);

        // Render the existing quote references in the form
        if (quoteRefsListContainer) {
          quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
          attachQuoteRefEventListeners();
        }

        state.analysisEditMode = true;
        resetAnalysisSessionCreatedQuotes();
        showAnalysisCard();
        analysisNotesInput.focus();

        if (analysisFloatCard) {
          setTimeout(() => {
            analysisFloatCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 100);
        }
        return;
      }

      if (action === "copy-node") {
        event.stopPropagation();
        const refTexts = (node.quoteRefs || [])
          .map((ref) => ref.quote || state.quotes.find((q) => q.id === ref.quoteId)?.quote || "")
          .filter(Boolean);
        const quoteText = refTexts.length ? refTexts.join("nn") : node.quote || "";
        navigator.clipboard.writeText(quoteText).then(() => {
          // Visual feedback - briefly change button appearance
          const button = event.target.closest("button[data-action='copy-node']");
          if (button) {
            const original = button.textContent;
            button.textContent = "✓";
            setTimeout(() => {
              button.textContent = original;
            }, 2000);
          }
        }).catch(() => {
          dialog.alert("Failed to copy quote to clipboard");
        });
        return;
      }

      if (action === "delete-node") {
        const choice = await confirmDeleteAnalysisNode(node);
        if (!choice) return;
        const wasEditingThis = analysisNodeIdInput?.value === node.id;
        await deleteAnalysisNodeWithIntegrity(node, {
          removeDetachedQuotes: choice === "delete"
        });
        state.focusedNodeId = null;
        state.focusedRangeKey = null;
        if (wasEditingThis) dismissAnalysisModal();
        await refreshData();
        await backupLocalNodesToCloud();
        return;
      }

      if (action === "flag-node") {
        const currentFlagged = node?.meta?.flagged || false;
        const updatedNode = {
          ...node,
          meta: {
            ...(node.meta || {}),
            flagged: !currentFlagged
          }
        };
        await addNode(updatedNode);
        await refreshData();
        await backupLocalNodesToCloud();
        return;
      }
    }
  });

    // Click on highlighted text in reader to jump to corresponding analysis node AND highlight EXACT quote
    analysisReader.addEventListener("click", (event) => {
      const highlight = event.target.closest(".highlight-quote");
      if (!highlight) {
        event.stopPropagation();
        return;
      }

      event.stopPropagation();
      const focusId = highlight.dataset.focusId;
      const rangeKey = highlight.dataset.rangeKey || null;
      if (!focusId) return;

      // Handle multiple analysis IDs (comma-separated from manual links)
      const analysisIds = focusId.split(",").map(s => s.trim()).filter(Boolean);

      // Store ALL analysis IDs that match this highlight
      const validAnalysisIds = analysisIds.filter(aid =>
        state.analysisNodes.some((n) => n.id === aid)
      );

      if (validAnalysisIds.length === 0) {
        // Fallback: if first ID is a quote, find its linked analysis
        if (analysisIds[0]) {
          const qNode = state.quotes.find((n) => n.id === analysisIds[0]);
          if (qNode?.meta?.analysisNodeIds?.length > 0) {
            validAnalysisIds.push(...qNode.meta.analysisNodeIds);
          }
        }
      }

      if (validAnalysisIds.length === 0) return;

      // Use the first valid node for range calculation
      const firstNodeId = validAnalysisIds[0];
      const analysisNode = state.analysisNodes.find((n) => n.id === firstNodeId);
      if (!analysisNode) return;

      // Find the exact quote ref that matches this highlight's position
      let exactStart = 0, exactEnd = 0, foundExact = false;
      if (rangeKey && analysisNode.quoteRefs) {
        for (const ref of analysisNode.quoteRefs) {
          const refKey = `${ref.start}-${ref.end}`;
          if (refKey === rangeKey) {
            exactStart = ref.start;
            exactEnd = ref.end;
            foundExact = true;
            break;
          }
        }
      }

      // Fallback to main link if exact not found
      if (!foundExact) {
        exactStart = Number(analysisNode?.link?.start || 0);
        exactEnd = Number(analysisNode?.link?.end || 0);
      }

      // Store ALL focused node IDs as comma-separated string
      state.focusedNodeId = validAnalysisIds.join(",");
      state.focusedRangeKey = rangeKey;
      state.selectedRange = {
        start: exactStart,
        end: exactEnd,
        quote: analysisNode.quote || ""
      };

      renderReaderAndNodes();

      // Scroll to first matched node in sidebar
      const card = analysisNodeList.querySelector(`[data-node-id="${firstNodeId}"]`);
      if (card && analysisNodeList) {
        const cardRect = card.getBoundingClientRect();
        const listRect = analysisNodeList.getBoundingClientRect();
        const offset = cardRect.top - listRect.top - (listRect.height / 2 - cardRect.height / 2);
        analysisNodeList.scrollBy({
          top: offset,
          behavior: "smooth"
        });
      }
    });

    // Hover on highlighted text - visual feedback only (no scrolling)
    // Scrolling is now handled by the smart scroll syncer only
    analysisReader.addEventListener("mouseover", (event) => {
      const highlight = event.target.closest(".highlight-quote");
      if (!highlight) return;

      const focusId = highlight.dataset.focusId;
      if (!focusId) return;

      // Handle multiple analysis IDs (comma-separated from manual links)
      const analysisIds = focusId.split(",").map(s => s.trim()).filter(Boolean);
      const validAnalysisIds = analysisIds.filter(aid =>
        state.analysisNodes.some((n) => n.id === aid)
      );

      // Fallback: if first ID is a quote, find its linked analysis
      if (validAnalysisIds.length === 0 && analysisIds[0]) {
        const qNode = state.quotes.find((n) => n.id === analysisIds[0].trim());
        if (qNode?.meta?.analysisNodeIds?.length > 0) {
          validAnalysisIds.push(...qNode.meta.analysisNodeIds);
        }
      }
      if (validAnalysisIds.length === 0) return;

      // Just add a temporary visual class to show which nodes are related
      // Clear previous hover states
      analysisNodeList.querySelectorAll(".hover-highlight").forEach(el => el.classList.remove("hover-highlight"));

      // Add hover highlight to matching cards
      validAnalysisIds.forEach(aid => {
        const card = analysisNodeList.querySelector(`[data-node-id="${aid}"]`);
        if (card) card.classList.add("hover-highlight");
      });
    });

    // Remove hover highlight on mouseout
    analysisReader.addEventListener("mouseout", (event) => {
      if (!event.target.closest(".highlight-quote")) return;
      analysisNodeList.querySelectorAll(".hover-highlight").forEach(el => el.classList.remove("hover-highlight"));
    });

  // Right-click context menu on quote highlights to add cue
  analysisReader.addEventListener("contextmenu", (event) => {
    const highlight = event.target.closest(".highlight-quote");
    if (!highlight) return;

    const focusId = highlight.dataset.focusId;
    if (!focusId) return;

    // Find the quote id - it could be the focusId directly, or we need to look it up
    let quoteId = null;

    // First check if focusId is directly a quote
    if (state.quotes.some(q => q.id === focusId)) {
      quoteId = focusId;
    } else {
      // Otherwise it might be an analysis node id - find linked quote
      const analysisNode = state.analysisNodes.find(n => n.id === focusId);
      if (analysisNode?.quoteRefs?.length > 0) {
        // Use the first quote ref's quoteId
        quoteId = analysisNode.quoteRefs[0].quoteId || analysisNode.quoteRefs[0].id;
      } else if (analysisNode?.link?.sourceId) {
        // Try to find a quote linked to this analysis via analysisNodeIds
        const linkedQuote = state.quotes.find(q =>
          q.meta?.analysisNodeIds?.includes(focusId)
        );
        if (linkedQuote) quoteId = linkedQuote.id;
      }
    }

    if (quoteId) {
      event.preventDefault();
      showCueContextMenu(event, quoteId);
    }
  });

  // Note: Quote validation moved to separate quote node workflow
  // Quotes are now created as independent nodes and linked to analysis

  const handleDBChange = async () => {
    await refreshData();
  };

  document.addEventListener("db-change", handleDBChange);
  window.__neuronetCanFocus = () => Boolean(state.selectedSubject);
  window.__neuronetAnalysisCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    window.__neuronetCanFocus = () => false;
  };

  // Register cleanup for returning to global launchpad
  window.__neuronetOnReturnToGlobal = () => {
    state.selectedSubject = "";
    state.selectedSourceId = "";
    state.viewMode = "reader";
    state.wasInStudy = false;
  };

  resetSourceForm();
  resetAnalysisForm();
  await refreshData();

  // Migrate any existing tags from node/quote metadata to the tags store
  await syncAllExistingTags();

  if (contextNodeId) {
    const targetNode = state.nodes.find(n => n.id === contextNodeId) || state.quotes.find(q => q.id === contextNodeId);
    if (targetNode) {
      const nodeSubject = targetNode.subject;
      if (nodeSubject && nodeSubject !== state.selectedSubject) {
        state.selectedSubject = nodeSubject;
        await refreshData();
      } else if (state.selectedSubject !== nodeSubject) {
        state.selectedSubject = nodeSubject || "";
        await refreshData();
      }
      state.view = "study";
      if (launchpadView) launchpadView.style.display = "none";
      if (studyView) studyView.style.display = "block";

      if (targetNode.type === "analysis" || targetNode.type === "source") {
        state.selectedSourceId = targetNode.id;
        if (typeof renderSourceSelect === "function") renderSourceSelect();
      }

      if (targetNode.type === "analysis" && analysisReader) {
        analysisReader.innerHTML = typeof formatAnalysisForDisplay === "function"
          ? formatAnalysisForDisplay(targetNode.analysis || "")
          : (targetNode.analysis || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        analysisReader.dataset.nodeId = targetNode.id;
      }
    }
  }
}
