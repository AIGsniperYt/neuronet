export async function initAnalysisToolV2(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    getAllCues,
    addNode,
    addQuote,
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
    removeCueEverywhere
  } = deps;

  const { subject: contextSubject, nodeId: contextNodeId } = context;

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
  const editorToolbar = document.getElementById("editorToolbar");
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
  const quoteRefsListContainerContainer = document.getElementById("quoteRefsListContainer");
  const addQuoteRefBtn = document.getElementById("addQuoteRefBtn");
  const currentHierarchy = document.getElementById("currentHierarchy");
  const addAnalysisNodeBtn = document.getElementById("addAnalysisNodeBtn");
  const analysisCardKicker = document.getElementById("analysisCardKicker");
  const analysisSubmitBtn = document.getElementById("analysisSubmitBtn");

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
    selectedSourceId: "",
    selectedRange: null,
    subjectEditMode: false,
    analysisEditMode: false,
    quoteEditMode: false, // NEW: for editing quotes
    wasInStudy: false,
    viewMode: "reader",
    focusedNodeId: null,
    /** When set, only this "start-end" highlight is active for the focused analysis (multi-quote UX). */
    focusedRangeKey: null,
    selectedQuoteRef: null, // NEW: for quote picker in analysis form
    cueEditMode: false,     // NEW: for editing cue nodes
    analysisSessionCreatedQuoteIds: [],
    lastLayer1Value: null
  };

  // Handle context subject from global launchpad
  if (contextSubject) {
    state.selectedSubject = contextSubject;
  }

  function convertGoogleDocsHtml(html) {
    let result = html;
    result = result.replace(/<span[^>]*class="[^"]*Apple-style-span[^"]*"[^>]*>(.*?)<\/span>/gi, "$1");
    result = result.replace(/<span[^>]*style="[^"]*font-family:[^;]*;?[^"]*">(.*?)<\/span>/gi, "$1");
    result = result.replace(/<span[^>]*>(.*?)<\/span>/gi, "$1");
    result = result.replace(/<font[^>]*>(.*?)<\/font>/gi, "$1");
    result = result.replace(/<o:p>(.*?)<\/o:p>/gi, "$1");
    result = result.replace(/<bdo[^>]*>(.*?)<\/bdo>/gi, "$1");
    result = result.replace(/<span[^>]+>/gi, "");
    return result;
  }

  function convertWordHtml(html) {
    let result = html;
    result = result.replace(/<xml[^>]*>.*?<\/xml>/gi, "");
    result = result.replace(/<w:[^>]+>.*?<\/w:[^>]+>/gi, "");
    result = result.replace(/<o:[^>]+>.*?<\/o:[^>]+>/gi, "");
    result = result.replace(/<v:[^>]+>.*?<\/v:[^>]+>/gi, "");
    result = result.replace(/<st1:[^>]+>.*?<\/st1:[^>]+>/gi, "");
    result = result.replace(/class="Mso[^"]*"/gi, "");
    result = result.replace(/style="[^"]*mso-[^"]*"/gi, "");
    result = result.replace(/<!--\[if[^>]*>-->/gi, "");
    result = result.replace(/<!--<!\[endif\]-->/gi, "");
    return result;
  }

  function convertMarkdown(text) {
    let result = escapeHtml(text);
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    result = result.replace(/_([^_]+)_/g, "<em>$1</em>");
    result = result.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    result = result.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    result = result.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    result = result.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
    result = result.replace(/^- (.+)$/gm, "<li>$1</li>");
    result = result.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    result = result.replace(/\n/g, "<br>");
    return result;
  }

  // ========== MARKDOWN & FORMATTING SUPPORT ==========
  // Supported inline markdown patterns (auto-converts as you type):
  //   - *text* → italic (<em>)
  //   - **text** → bold (<strong>)
  //   - ***text*** → bold italic (<strong><em>)
  //   - _text_ → italic (<em>)
  //   - __text__ → bold (<strong>)
  //   - ___text___ → bold italic (<strong><em>)
  //   - ~~text~~ → strikethrough (<del>)
  //   - `text` → inline code (<code>)
  //
  // Keyboard shortcuts:
  //   - Ctrl/Cmd+B → bold
  //   - Ctrl/Cmd+I → italic
  //   - Ctrl/Cmd+U → underline
  //   - Ctrl/Cmd+Shift+X → strikethrough
  //   - Ctrl/Cmd+` → code block
  //   - #, ##, ### at start of line + Enter → heading (H1, H2, H3)
  //   - > at start of line + Enter → blockquote
  //
  // Block markdown patterns (on Enter):
  //   - # Text → H1 heading
  //   - ## Text → H2 heading
  //   - ### Text → H3 heading
  //   - > Text → blockquote
  // ================================================

  function saveCursorPosition() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    if (!sourceEditor.contains(selection.anchorNode)) return null;
    
    try {
      const range = selection.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(sourceEditor);
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    } catch (e) {
      return null;
    }
  }

  function restoreCursorPosition(offset) {
    if (offset === null || offset < 0) return;
    if (!sourceEditor) return;
    
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      let charCount = 0;
      let nodeStack = [sourceEditor];
      let node, foundStart = false;

      while (!foundStart && (node = nodeStack.pop())) {
        if (node.nodeType === Node.TEXT_NODE) {
          const nextCharCount = charCount + node.length;
          if (offset <= nextCharCount) {
            range.setStart(node, Math.max(0, offset - charCount));
            foundStart = true;
          }
          charCount = nextCharCount;
        } else {
          let i = node.childNodes.length;
          while (i--) {
            nodeStack.push(node.childNodes[i]);
          }
        }
      }

      if (foundStart) {
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (e) {
      // Silently fail if cursor restoration fails
    }
  }

  function convertInlineMarkdownInPlace() {
    try {
      const selection = window.getSelection();
      const shouldRestoreCursor = selection.rangeCount > 0 && sourceEditor && sourceEditor.contains(selection.anchorNode);
      const cursorPos = shouldRestoreCursor ? saveCursorPosition() : null;

      const textNodes = [];
      const walker = document.createTreeWalker(sourceEditor, NodeFilter.SHOW_TEXT);
      let node;
      
      while (node = walker.nextNode()) {
        const text = node.textContent;
        // Only process text nodes with potential markdown
        if (text.includes("*") || text.includes("_") || text.includes("`") || text.includes("~")) {
          // Skip if already inside a formatting tag
          let parent = node.parentNode;
          if (parent && !["STRONG", "EM", "CODE", "DEL", "B", "I"].includes(parent.tagName)) {
            textNodes.push(node);
          }
        }
      }

      let changed = false;

      textNodes.forEach(textNode => {
        try {
          let text = textNode.textContent;
          const originalText = text;

          // Convert markdown patterns (order matters - do longest patterns first)
          // ***bold italic*** or ___bold italic___
          text = text.replace(/\*\*\*(\S+(?:\s+\S+)*)\*\*\*/g, "<strong><em>$1</em></strong>");
          text = text.replace(/___(\S+(?:\s+\S+)*)___/g, "<strong><em>$1</em></strong>");
          // **bold** or __bold__
          text = text.replace(/\*\*(\S+(?:\s+\S+)*)\*\*/g, "<strong>$1</strong>");
          text = text.replace(/__(\S+(?:\s+\S+)*)__/g, "<strong>$1</strong>");
          // *italic* or _italic_ (only matches if surrounded by non-whitespace)
          text = text.replace(/\*(\S+(?:\s+\S+)*)\*/g, "<em>$1</em>");
          text = text.replace(/_(\S+(?:\s+\S+)*)_/g, "<em>$1</em>");
          // ~~strikethrough~~
          text = text.replace(/~~(\S+(?:\s+\S+)*)~~/g, "<del>$1</del>");
          // `code`
          text = text.replace(/`(\S+(?:\s+\S+)*)`/g, "<code>$1</code>");

          if (text !== originalText) {
            const parent = textNode.parentNode;
            if (!parent || !parent.parentNode) return; // Safety check
            
            const temp = document.createElement("span");
            temp.innerHTML = text;
            
            // Replace the text node with temp contents
            while (temp.firstChild) {
              parent.insertBefore(temp.firstChild, textNode);
            }
            parent.removeChild(textNode);
            changed = true;
          }
        } catch (e) {
          // Skip this node if there's an error
        }
      });

      // Restore cursor position ONLY if we made changes AND had a valid selection
      if (changed && shouldRestoreCursor && cursorPos !== null) {
        requestAnimationFrame(() => restoreCursorPosition(cursorPos));
      }
    } catch (e) {
      // Fail silently
    }
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
    return {
      quoteId: quoteNode.id,
      section: quoteNode.section || "",
      quote: quoteNode.quote || "",
      sourceId: quoteNode.link?.sourceId,
      start: Number.isFinite(Number(quoteNode.link?.start)) ? Number(quoteNode.link.start) : undefined,
      end: Number.isFinite(Number(quoteNode.link?.end)) ? Number(quoteNode.link.end) : undefined,
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
    let sourceId = null;
    let startPos = null;
    let endPos = null;
    let plainQuoteText = "";
    
    if (typeof textOrRef === "object" && textOrRef !== null) {
      sourceId = textOrRef.sourceId || null;
      startPos = Number(textOrRef.start);
      endPos = Number(textOrRef.end);
      plainQuoteText = textOrRef.quote || "";
    } else {
      plainQuoteText = textOrRef || fallbackText || "";
    }
    
    // Try source extraction
    if (sourceId && !isNaN(startPos) && !isNaN(endPos)) {
      const source = getSourceById(sourceId);
      if (source && source.contentHtml) {
        const formatted = getFormattedFromSource(source, startPos, endPos);
        if (formatted) return formatted;
      }
    }
    
    return plainTextToHtml(plainQuoteText);
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
      toggleSourceModeBtn.textContent = isEditor ? "View Source" : "Edit Source";
    }

    if (studyGrid) {
      studyGrid.classList.toggle("editor-expanded", isEditor);
    }

    // Show/hide save and cancel buttons based on edit mode
function selectSource(sourceId) {
    state.selectedSourceId = sourceId;
    state.focusedNodeId = null;
    state.focusedRangeKey = null;

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
      saveSourceBtn.classList.toggle("visible", isEditor);
    }
    if (cancelEditSourceBtn) {
      cancelEditSourceBtn.classList.toggle("visible", isEditor);
    }

    if (!isEditor) {
      hideQuoteButton();
    }
  }

  function showQuoteButton(range) {
    if (!quoteSelectionBtn || !range || !readerWrapper) return;
    const rect = range.getBoundingClientRect();
    const wrapperRect = readerWrapper.getBoundingClientRect();

    const top = rect.top - wrapperRect.top - 42;
    const left = rect.left - wrapperRect.left;

    quoteSelectionBtn.style.top = `${Math.max(10, top)}px`;
    quoteSelectionBtn.style.left = `${Math.max(10, Math.min(left, wrapperRect.width - 140))}px`;
    quoteSelectionBtn.style.display = "block";
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
      
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];

      // FIXED traversal (prevents infinite loop / array explosion)
      let currentNode;
      while ((currentNode = walker.nextNode())) {
        textNodes.push(currentNode);
      }

      const rangesToWrap = [];
      let index = 0;

      for (const node of textNodes) {
        const nodeText = node.nodeValue || "";
        const originalLength = nodeText.length;
        const nodeEnd = index + nodeText.length;

        if (nodeEnd <= start) {
          index = nodeEnd;
          continue;
        }
        if (index >= end) break;

        const localStart = Math.max(0, start - index);
        const localEnd = Math.min(nodeText.length, end - index);

        // Validate local range
        if (localStart >= 0 && localEnd > localStart && localEnd <= nodeText.length) {
          rangesToWrap.push({ node, localStart, localEnd, originalLength });
        }
        index = nodeEnd;
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

    const sorted = [...ranges].sort((a, b) => a.start - b.start);

    // Merge overlaps (CRITICAL)
    const merged = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) {
        last.end = Math.max(last.end, r.end);
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

      const isActive =
        focusId === state.focusedNodeId &&
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
    if (state.analysisNodes.some((n) => n.id === focusId)) return focusId;
    const qNode = state.quotes.find((n) => n.id === focusId);
    const aid = qNode?.meta?.analysisNodeIds?.[0];
    return aid || null;
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
      byPosition.set(key, {
        start: safStart,
        end: safEnd,
        focusId,
        nodeId: focusId
      });
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
        }

        const analysisIds = q.meta?.analysisNodeIds || [];
        const focusId = analysisIds[0] || q.id;
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
    if (!source) return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    if (!analysisReader.contains(range.commonAncestorContainer)) return null;

    const pre = document.createRange();
    pre.selectNodeContents(analysisReader);
    pre.setEnd(range.startContainer, range.startOffset);

    const rawStart = pre.toString().length;
    
    // Extract HTML content from the range to preserve formatting (bold, italics, etc.)
    const quoteContainer = document.createElement("div");
    quoteContainer.appendChild(range.cloneContents());
    const rawQuoteHtml = quoteContainer.innerHTML;
    const rawQuote = range.toString();
    if (!rawQuote.trim()) return null;

    const leading = rawQuote.length - rawQuote.trimStart().length;
    const start = rawStart + leading;
    const quote = rawQuote.trim();
    const end = start + quote.length;
    const sourceText = normalizeSource(source).contentText;

    return {
      start: Math.min(start, sourceText.length),
      end: Math.min(end, sourceText.length),
      quote,
      quoteHtml: rawQuoteHtml,
      range
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
    const list = document.getElementById("quoteRefsListContainer");
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
      alert("No quote selected for cue");
      return;
    }

    if (!cueContent) {
      alert("Please enter a cue");
      return;
    }

    const quote = state.quotes.find(q => q.id === quoteId);
    if (!quote) {
      alert("Quote not found");
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
        const quoteRefsListContainer = document.getElementById("quoteRefsListContainer");
        if (quoteRefsListContainer) {
          quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
          attachQuoteRefEventListeners();
        }
      }
    } catch (error) {
      console.error("Failed to save cue:", error);
      alert("Failed to save cue: " + error.message);
    }
  }

  async function handleDeleteCue() {
    const cueNodeId = document.getElementById("cueNodeId");
    const cueId = cueNodeId?.value;

    if (!cueId) return;

    const confirmed = window.confirm("Delete this cue? This action cannot be undone.");
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
          const quoteRefsListContainer = document.getElementById("quoteRefsListContainer");
          if (quoteRefsListContainer) {
            quoteRefsListContainer.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
            attachQuoteRefEventListeners();
          }
        }
      }
    } catch (error) {
      console.error("Failed to delete cue:", error);
      alert("Failed to delete cue: " + error.message);
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
    const path = source?.meta?.hierarchyPath || [source?.subject || "", ...(source?.section ? source.section.split(" > ") : [])];
    const normalized = normalizeSource(source);

    sourceIdInput.value = source?.id || "";
    sourceSubjectInput.value = source?.subject || state.selectedSubject;
    sourceTitleInput.value = source?.title || "";
    sourceLevel1Input.value = path[1] || "";
    sourceLevel2Input.value = path[2] || "";
    sourceLevel3Input.value = path[3] || "";
    sourceEditor.innerHTML = normalized.contentHtml || "<p><br></p>";
  }

  function resetSourceForm() {
    sourceForm.reset();
    sourceIdInput.value = "";
    sourceSubjectInput.value = state.selectedSubject;
    sourceEditor.innerHTML = "<p><br></p>";
  }

  // ========== NEW: QUOTE AND ANALYSIS LINKING FUNCTIONS ==========

  function findExistingQuoteForSelection({ sourceId, start, end, quote }) {
    return state.quotes.find((item) =>
      item.link?.sourceId === sourceId &&
      Number(item.link?.start) === Number(start) &&
      Number(item.link?.end) === Number(end) &&
      item.quote === quote
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

  /**
   * Create a new quote node from selected text
   * NEW: Path 1 - Create Quote Node from source
   */
  async function createQuoteNode(quoteText, sourceId, start, end) {
    const source = getSourceById(sourceId);
    if (!source) throw new Error("Source not found");

    const now = Date.now();
    const path = source?.meta?.hierarchyPath || [source?.subject || "", ...(source?.section ? source.section.split(" > ") : [])];

    const quoteNode = {
      id: crypto.randomUUID(),
      type: "quote",
      subject: source.subject,
      section: source.section,
      title: source.title,
      quote: quoteText,
      priority: 3,
      link: {
        sourceId: sourceId,
        start: start,
        end: end
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

  /**
   * Link an analysis node to a quote (create bidirectional reference)
   * NEW: Updates both quote and analysis nodes
   */
  async function linkAnalysisToQuote(analysisId, quoteId) {
    // Get the quote node
    const quoteNode = state.quotes.find(q => q.id === quoteId);
    if (!quoteNode) throw new Error("Quote not found");

    // Get the analysis node
    const analysisNode = state.analysisNodes.find(n => n.id === analysisId);
    if (!analysisNode) throw new Error("Analysis not found");

    // 1. Add analysisId to quote's analysisNodeIds
    if (!quoteNode.meta) quoteNode.meta = {};
    if (!quoteNode.meta.analysisNodeIds) quoteNode.meta.analysisNodeIds = [];
    if (!quoteNode.meta.analysisNodeIds.includes(analysisId)) {
      quoteNode.meta.analysisNodeIds.push(analysisId);
      quoteNode.updatedAt = Date.now();
      await addQuote(quoteNode);
    }

    // 2. Add quoteRef to analysis's quoteRefs array
    if (!analysisNode.quoteRefs) analysisNode.quoteRefs = [];
    if (!analysisNode.quoteRefs.some(ref => ref.quoteId === quoteId)) {
      analysisNode.quoteRefs.push({
        quoteId: quoteId,
        section: quoteNode.section,
        quote: quoteNode.quote
      });
      analysisNode.updatedAt = Date.now();
      await addNode(analysisNode);
    }
  }

  /**
   * Unlink an analysis node from a quote
   * NEW: Remove bidirectional reference
   */
  async function unlinkAnalysisFromQuote(analysisId, quoteId) {
    const quoteNode = state.quotes.find(q => q.id === quoteId);
    if (!quoteNode) return;

    // 1. Remove analysisId from quote
    if (quoteNode.meta?.analysisNodeIds) {
      quoteNode.meta.analysisNodeIds = quoteNode.meta.analysisNodeIds.filter(id => id !== analysisId);
      quoteNode.updatedAt = Date.now();
      await addQuote(quoteNode);
    }
  }

  async function ensureQuoteRecord(ref) {
    const priority = clampPriority(ref.priority);
    const existingQuote = ref.quoteId ? (state.quotes.find((quote) => quote.id === ref.quoteId) || await getQuote(ref.quoteId)) : null;

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
      await unlinkAnalysisFromQuote(analysisId, quoteId);
      if (canDeleteQuoteAsPrivateDependency(quoteId, [analysisId])) {
        await removeQuoteAndLinkedCuesEverywhere(quoteId);
      }
    }

    for (const ref of nextRefs || []) {
      if (!ref.quoteId) continue;
      await linkAnalysisToQuote(analysisId, ref.quoteId);
    }
  }

  async function saveAnalysisNodeWithIntegrity({ analysisId, analysis, tags }) {
    const existing = state.analysisNodes.find((node) => node.id === analysisId) || null;
    const now = Date.now();
    const draftRefs = getSelectedQuoteRefs().map(cloneQuoteRef);
    const savedQuoteRefs = [];

    for (const ref of draftRefs) {
      const quoteNode = await ensureQuoteRecord(ref);
      savedQuoteRefs.push(buildQuoteRefFromQuoteNode(quoteNode));
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
    await refreshData();
    await reconcileAnalysisQuoteLinks(analysisId, existing?.quoteRefs || [], savedQuoteRefs);
    await refreshData();
  }

  async function deleteAnalysisNodeWithIntegrity(node, options = {}) {
    const removeDetachedQuotes = options.removeDetachedQuotes !== false;
    for (const ref of node?.quoteRefs || []) {
      if (!ref.quoteId) continue;
      await unlinkAnalysisFromQuote(node.id, ref.quoteId);
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

    if (!subjects.length) {
      subjectList.innerHTML = `<div class="empty-note">No subjects yet. Add your first subject to begin.</div>`;
      return;
    }

    subjectList.innerHTML = subjects
      .map((subject) => `
        <article class="subject-card" data-subject="${escapeHtml(subject)}">
          <span class="subject-name">${escapeHtml(subject)}</span>
          <div class="subject-actions" ${state.subjectEditMode ? "" : "hidden"}>
            <button class="btn" type="button" data-action="rename-subject" data-subject="${escapeHtml(subject)}">Rename</button>
            <button class="btn" type="button" data-action="delete-subject" data-subject="${escapeHtml(subject)}">Delete</button>
          </div>
        </article>
      `)
      .join("");

    // Make entire card clickable
    subjectList.querySelectorAll(".subject-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".subject-actions")) return;
        const subject = card.dataset.subject;
        if (subject) {
          state.selectedSubject = subject;
          state.selectedSourceId = "";
          resetSourceForm();
          resetAnalysisForm();
          renderState();
        }
      });
    });
  }

  function renderSources() {
    const sources = getSourcesForSelectedSubject();

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

    const hierarchyLabel = path.length > 1 ? path.join(" > ") : path.join("");
    if (currentHierarchy) {
      currentHierarchy.textContent = hierarchyLabel || source.title || source.subject || "No hierarchy";
    }
    analysisReader.innerHTML = normalized.contentHtml || "<p><br></p>";
    analysisReader.style.userSelect = "text";
    analysisReader.style.webkitUserSelect = "text";
    analysisReader.style.MozUserSelect = "text";

    const domText = analysisReader.textContent;
    const highlightRanges = buildHighlightRangesForSource(source, domText);
    highlightQuotedRanges(analysisReader, highlightRanges);

    const analysesForSource = state.analysisNodes.filter(
      (node) => node.subject === state.selectedSubject && analysisTouchesSource(node, source.id)
    ).sort((a, b) => {
      // Sort by the position of the first quote in the source
      const getFirstQuoteStart = (node) => {
        if (!node.quoteRefs?.length) return Infinity;
        for (const ref of node.quoteRefs) {
          if (ref.sourceId === source.id && ref.start != null) {
            return Number(ref.start);
          }
          const quote = state.quotes.find((q) => q.id === ref.quoteId);
          if (quote?.link?.sourceId === source.id && quote?.link?.start != null) {
            return Number(quote.link.start);
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

    analysisNodeList.innerHTML = analysesForSource
      .map((node, index) => {
        const tags = node?.meta?.tags || [];
        const isActive = state.focusedNodeId === node.id;
        const quotesHtml = (() => {
          if (node.quoteRefs?.length) {
            return node.quoteRefs
              .map((ref, refIdx) => {
                // Get the text - either from ref directly or by looking up the quote in DB
                const text = ref.quote || state.quotes.find((q) => q.id === ref.quoteId)?.quote || "";
                if (!text) return "";
                // Check if this quote is the exactly selected one
                const refRangeKey = `${ref.start}-${ref.end}`;
                const isExactQuote = state.focusedNodeId === node.id && state.focusedRangeKey === refRangeKey;
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
    const inStudy = Boolean(state.selectedSubject);
    launchpadView.hidden = inStudy;
    studyView.hidden = !inStudy;
    studySubjectTitle.textContent = state.selectedSubject || "Subject";

    if (typeof window.__neuronetCanFocus !== "function") {
      window.__neuronetCanFocus = () => Boolean(state.selectedSubject);
    }
    window.__neuronetCanFocus = () => Boolean(state.selectedSubject);

    if (inStudy) {
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
    const updated = window.prompt(`Rename subject "${subjectName}" to:`, subjectName);
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
    const typed = window.prompt(`Type "${subjectName}" to confirm deletion.`);
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
      const subject = card.dataset.subject;
      if (subject) {
        state.selectedSubject = subject;
        state.selectedSourceId = "";
        resetSourceForm();
        resetAnalysisForm();
        renderState();
      }
    }
  });

  // Back to launchpad button handler - goes to analysis tool launchpad, not global
  if (backToLaunchpad) {
    backToLaunchpad.addEventListener("click", async () => {
      state.selectedSubject = "";
      state.selectedSourceId = "";
      state.viewMode = "reader";
      state.wasInStudy = false;
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
      state.focusedNodeId = null;
      state.focusedRangeKey = null;

      if (state.viewMode === "editor") {
        const source = getSourceById(selectedId);
        if (source) {
          hydrateSourceForm(source);
        }
      } else {
        renderReaderAndNodes();
      }
    });
  }


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
      const approved = window.confirm(`Delete "${source.title}" and ${linked.length} linked analysis node(s)?`);
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

  if (sourceEditor) {
    sourceEditor.addEventListener("paste", (event) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      
      event.preventDefault();
      event.stopPropagation();
      
      const text = clipboardData.getData("text/plain") || "";
      let html = clipboardData.getData("text/html");
      let cleanHtml = null;
      
      if (html && html.trim()) {
        const startFrag = html.indexOf("<!--StartFragment-->");
        const endFrag = html.indexOf("<!--EndFragment-->");
        if (startFrag !== -1 && endFrag !== -1 && endFrag > startFrag) {
          cleanHtml = html.substring(startFrag + 20, endFrag);
        } else if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
          cleanHtml = html;
        }
        
        if (cleanHtml && cleanHtml.trim()) {
          cleanHtml = convertGoogleDocsHtml(cleanHtml);
          cleanHtml = convertWordHtml(cleanHtml);
        } else {
          cleanHtml = null;
        }
      }
      
      let useMarkdown = !cleanHtml || !cleanHtml.trim();
      let content = useMarkdown ? convertMarkdown(text) : cleanHtml;
      
      if (content && content.trim()) {
        document.execCommand("insertHTML", false, content);
        setTimeout(() => {
          const walk = document.createTreeWalker(sourceEditor, NodeFilter.SHOW_ELEMENT);
          let node;
          while (node = walk.nextNode()) {
            node.style.fontSize = "";
            if (node.hasAttribute("size")) node.removeAttribute("size");
          }
          // Let the input event handle markdown conversion to avoid duplicate processing
        }, 0);
      } else if (text) {
        document.execCommand("insertText", false, text);
      }
    });
    
    // Remove inline styles, clean garbage after paste, and convert inline markdown
    let markdownConversionTimeout;
    sourceEditor.addEventListener("input", () => {
      // Clean up styles and elements immediately
      const walk = document.createTreeWalker(sourceEditor, NodeFilter.SHOW_ELEMENT);
      const toRemove = [];
      let node;
      while (node = walk.nextNode()) {
        // Remove all inline styles
        node.style.color = "";
        node.style.fontFamily = "";
        node.style.fontSize = "";
        node.style.whiteSpace = "";
        node.style.backgroundColor = "";
        
        // Remove empty spans
        if (node.tagName === "SPAN" && !node.textContent.trim() && !node.querySelector("*")) {
          toRemove.push(node);
        }
        // Remove anchor tags (name attributes)
        if (node.tagName === "A" && node.hasAttribute("name")) {
          while (node.firstChild) {
            node.parentNode.insertBefore(node.firstChild, node);
          }
          toRemove.push(node);
        }
      }
      toRemove.forEach(n => n.remove());
      
      // Replace <i> with <em>, <b> with <strong>
      sourceEditor.querySelectorAll("i").forEach(n => {
        const em = document.createElement("em");
        while (n.firstChild) em.appendChild(n.firstChild);
        n.parentNode.replaceChild(em, n);
      });
      sourceEditor.querySelectorAll("b").forEach(n => {
        const strong = document.createElement("strong");
        while (n.firstChild) strong.appendChild(n.firstChild);
        n.parentNode.replaceChild(strong, n);
      });
      
      // Unwrap P tags that only contain inline elements (no direct text, no block elements)
      const ps = sourceEditor.querySelectorAll("p");
      ps.forEach(p => {
        const hasDirectText = Array.from(p.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.nodeValue || "").trim()
        );
        const blockTagsArr = ["P", "DIV", "BLOCKQUOTE", "H1", "H2", "H3", "UL", "OL", "LI"];
        const hasBlockChildren = Array.from(p.childNodes).some(
          (child) => child.nodeType === Node.ELEMENT_NODE && blockTagsArr.includes(child.tagName.toUpperCase())
        );
        
        if (!hasDirectText && !hasBlockChildren) {
          while (p.firstChild) {
            p.parentNode.insertBefore(p.firstChild, p);
          }
          p.remove();
        }
      });
      
      // Clean up empty P tags
      const emptyPs = sourceEditor.querySelectorAll("p");
      emptyPs.forEach(p => {
        if (!p.textContent.trim() && !p.querySelector("img, br, blockquote")) {
          p.remove();
        }
      });

      // Debounce markdown conversion for performance (only convert when user pauses)
      clearTimeout(markdownConversionTimeout);
      markdownConversionTimeout = setTimeout(() => {
        convertInlineMarkdownInPlace();
      }, 300);
    });
  }

  if (sourceForm) {
    sourceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.selectedSubject) return;

      const title = (sourceTitleInput.value || "").trim();
      if (!title) return;

      const path = normalizeHierarchyPath([
        state.selectedSubject,
        sourceLevel1Input?.value || "",
        sourceLevel2Input?.value || "",
        sourceLevel3Input?.value || ""
      ]);
      
      const contentHtml = sourceEditor.innerHTML || "<p><br></p>";
      const contentText = sourceEditor.innerText || "";
      
      const existing = getSourceById(sourceIdInput.value);
      const now = Date.now();
      const sourceId = sourceIdInput.value || crypto.randomUUID();

      await addNode({
        id: sourceId,
        type: "source",
        subject: state.selectedSubject,
        section: buildSection(path),
        title,
        content: contentText,
        contentHtml: contentHtml,
        contentText: contentText,
        quote: "",
        analysis: "",
        link: {},
        meta: {
          ...(existing?.meta || {}),
          kind: "source",
          hierarchyPath: path,
          formatVersion: 2
        },
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });

      state.selectedSourceId = sourceId;
      resetSourceForm();
      setSourceViewMode("reader");
      await refreshData();
      await backupLocalNodesToCloud();
    });
  }

function selectSource(sourceId) {
    state.selectedSourceId = sourceId;
    state.focusedNodeId = null;
    state.focusedRangeKey = null;

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
      sourceForm.dispatchEvent(new Event("submit"));
    });
  }

  if (newSourceBtn) {
    newSourceBtn.addEventListener("click", () => {
      resetSourceForm();
      setSourceViewMode("editor");
    });
  }

  if (cancelEditSourceBtn) {
    cancelEditSourceBtn.addEventListener("click", () => {
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

  if (sourceEditor && editorToolbar) {
    const allBtns = document.querySelectorAll('#editorToolbar .toolbar-btn');
    const domChanging = ['h1', 'h2', 'h3', 'removeFormat', 'formatBlock'];
    
    allBtns.forEach(btn => {
      btn.addEventListener("mousedown", (e) => { 
        e.preventDefault(); 
        const sel = window.getSelection();
        if (sel?.rangeCount > 0) {
          window.__savedSelection = sel.getRangeAt(0).cloneRange();
        }
      });
      
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const command = btn.dataset.command;
        const value = btn.dataset.value;
        
        // Always restore for inline commands before executing
        if (!domChanging.includes(command)) {
          const sel = window.getSelection();
          // Even if there's selection, try restoring saved to get full range
          if (window.__savedSelection && sel?.rangeCount > 0) {
            // Check if saved end != current end (indicates truncation)
            const current = sel.getRangeAt(0);
            const saved = window.__savedSelection;
            const needsRestore = current.startContainer !== saved.startContainer || 
                            current.startOffset !== saved.startOffset ||
                            current.endContainer !== saved.endContainer ||
                            current.endOffset !== saved.endOffset;
            if (needsRestore) {
              console.log('RESTORE full');
              sel.removeAllRanges();
              sel.addRange(saved);
            }
          } else if (window.__savedSelection) {
            console.log('RESTORE new');
            sel.removeAllRanges();
            sel.addRange(window.__savedSelection);
          }
        }
        
        execFormat(command, value);
        
        sourceEditor.focus();
      });
    });

    function execFormat(command, value) {
      if (command === "removeFormat") {
        // Use native removeFormat first
        document.execCommand("removeFormat", false, null);
        
        // Then clean up any remaining formatting elements that native removeFormat misses
        const tagsToRemove = ["STRONG", "B", "EM", "I", "U", "S", "STRIKE", "CODE", "SPAN"];
        const tagsToConvert = {
          "H1": "p",
          "H2": "p", 
          "H3": "p",
          "BLOCKQUOTE": "p",
          "UL": "p",
          "OL": "p"
        };
        
        const walker = document.createTreeWalker(sourceEditor, NodeFilter.SHOW_ELEMENT, null, false);
        const elements = [];
        let node;
        while (node = walker.nextNode()) {
          elements.push(node);
        }
        
        for (const el of elements) {
          const tag = el.tagName.toUpperCase();
          
          // Convert block elements to paragraphs
          if (tagsToConvert[tag]) {
            const newTag = document.createElement(tagsToConvert[tag]);
            while (el.firstChild) newTag.appendChild(el.firstChild);
            el.parentNode.replaceChild(newTag, el);
            continue;
          }
          
          // Remove inline formatting wrappers
          if (tagsToRemove.includes(tag)) {
            const parent = el.parentNode;
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
          }
        }
        
        // Clear any remaining inline styles
        const styleWalker = document.createTreeWalker(sourceEditor, NodeFilter.SHOW_ELEMENT, null, false);
        let styleNode;
        while (styleNode = styleWalker.nextNode()) {
          if (styleNode.style) {
            styleNode.style.textDecoration = "";
            styleNode.style.fontWeight = "";
            styleNode.style.fontStyle = "";
          }
        }
        
        return;
      }
      if (command === "h1" || command === "h2" || command === "h3") {
        return document.execCommand("formatBlock", false, "<" + command + ">");
      }
      if (command === "formatBlock" && value) {
        return document.execCommand("formatBlock", false, value);
      }
      if (value) {
        return document.execCommand(command, false, value);
      }
return document.execCommand(command, false, null);
    }

    // REMOVED DUPLICATE HANDLER - keeping only the one above with selection saving
    
    const dragHandle = editorToolbar.querySelector(".drag-handle");
    let isDragging = false;
    let toolbarInOriginalPos = true;
    let snapSlot = null;
    let editorWrapper = null;
    
    if (dragHandle) {
      editorWrapper = document.getElementById("editorWrapper");
      if (editorWrapper) {
        snapSlot = document.createElement("div");
        snapSlot.className = "toolbar-snap-slot";
        snapSlot.style.cssText = `
          display: none; height: 44px; border: 2px dashed rgba(44,255,179,0.4);
          border-radius: 8px; margin-bottom: 10px; align-items: center;
          justify-content: center; color: rgba(44,255,179,0.6); font-size: 0.8rem;
          transition: all 0.15s ease;
        `;
        snapSlot.textContent = "Drop to slot back";
        editorWrapper.insertBefore(snapSlot, editorWrapper.firstChild);
      }
      
      dragHandle.addEventListener("mousedown", (e) => {
        isDragging = true;
        snapSlot = document.querySelector(".toolbar-snap-slot");
        document.body.appendChild(editorToolbar);
        editorToolbar.style.position = "fixed";
        editorToolbar.style.zIndex = "9999";
        e.preventDefault();
        e.stopPropagation();
      });
      
      window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        editorToolbar.style.left = e.clientX + "px";
        editorToolbar.style.top = e.clientY + "px";
        editorToolbar.style.transform = "none";
        
        // Check if near the drop zone
        if (editorWrapper && snapSlot) {
          const wrapperRect = editorWrapper.getBoundingClientRect();
          const toolbarRect = editorToolbar.getBoundingClientRect();
          
          // Check if toolbar center is near editorWrapper top
          const toolbarCenterY = toolbarRect.top + toolbarRect.height / 2;
          const isNearWrapper = (
            e.clientX >= wrapperRect.left - 50 &&
            e.clientX <= wrapperRect.right + 50 &&
            toolbarCenterY <= wrapperRect.top + 100
          );
          
          if (isNearWrapper) {
            snapSlot.style.display = "flex";
            snapSlot.style.borderColor = "rgba(44,255,179,0.8)";
            snapSlot.style.backgroundColor = "rgba(44,255,179,0.1)";
          } else {
            snapSlot.style.display = "none";
          }
        }
      });
      
      window.addEventListener("mouseup", (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        if (editorWrapper && snapSlot && snapSlot.style.display === "flex") {
          // Snap back to original position
          editorWrapper.insertBefore(editorToolbar, editorWrapper.firstChild);
          editorToolbar.style.position = "";
          editorToolbar.style.zIndex = "100";
          editorToolbar.style.left = "";
          editorToolbar.style.top = "";
          editorToolbar.style.transform = "";
          toolbarInOriginalPos = true;
          snapSlot.style.display = "none";
        } else {
          // Stay where dropped, but ensure it's visible (not behind other elements)
          editorToolbar.style.position = "fixed";
          editorToolbar.style.zIndex = "9999";
        }
      });
    }

    sourceEditor.addEventListener("keydown", (e) => {
      // Keyboard shortcuts for formatting (Ctrl/Cmd + modifier)
      if (e.ctrlKey || e.metaKey) {
        switch(e.key.toLowerCase()) {
          case "b": 
            e.preventDefault(); 
            document.execCommand("bold", false, null); 
            break;
          case "i": 
            e.preventDefault(); 
            document.execCommand("italic", false, null); 
            break;
          case "u": 
            e.preventDefault(); 
            document.execCommand("underline", false, null); 
            break;
          case "`":
            // Ctrl+` wraps selection or word in backticks/code
            e.preventDefault();
            const sel = window.getSelection();
            if (sel.toString()) {
              document.execCommand("formatBlock", false, "code");
            }
            break;
        }
      }
      // Strikethrough shortcut: Ctrl+Shift+X (or Alt+Shift+~)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        document.execCommand("strikethrough", false, null);
      }
      if (e.key === "Enter") {
        setTimeout(convertMdOnEnter, 50);
      }
    });
    
    function convertMdOnEnter() {
      try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        let container = range.startContainer;
        
        // Find the paragraph element
        if (container.nodeType === Node.TEXT_NODE) {
          container = container.parentNode;
        }
        
        let p = null;
        if (container && container.tagName === "P") {
          p = container;
        } else if (container && container.closest) {
          p = container.closest("p");
        }
        
        if (!p || p.tagName.toUpperCase() !== "P") return;
        
        const text = (p.textContent || "").trim();
        let newTag = null;
        let prefixLen = 0;
        
        if (text.startsWith("### ")) {
          newTag = "h3";
          prefixLen = 4;
        } else if (text.startsWith("## ")) {
          newTag = "h2";
          prefixLen = 3;
        } else if (text.startsWith("# ")) {
          newTag = "h1";
          prefixLen = 2;
        } else if (text.startsWith("> ")) {
          newTag = "blockquote";
          prefixLen = 2;
        }
        
        if (newTag && prefixLen > 0) {
          const el = document.createElement(newTag);
          const content = text.substring(prefixLen);
          
          // Copy child nodes while removing the markdown marker
          while (p.firstChild) {
            el.appendChild(p.firstChild);
          }
          
          // Update text content to remove the markdown prefix
          if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
            el.firstChild.textContent = content;
          } else if (el.textContent) {
            el.textContent = content;
          }
          
          p.parentNode.replaceChild(el, p);
        }
      } catch (e) {
        // Silently fail if conversion fails
      }
    }

    function updateToolbarVisibility() {
      if (editorToolbar) {
        editorToolbar.classList.toggle("visible", state.viewMode === "editor");
        editorToolbar.style.display = state.viewMode === "editor" ? "flex" : "none";
        if (state.viewMode === "editor" && !toolbarInOriginalPos) {
          const editorWrapper = document.getElementById("editorWrapper");
          if (editorWrapper) {
            editorWrapper.insertBefore(editorToolbar, editorWrapper.firstChild);
          }
          editorToolbar.style.position = "";
          toolbarInOriginalPos = true;
        }
      }
    }
    
    updateToolbarVisibility();
    
    const originalSetSourceViewMode = setSourceViewMode;
    setSourceViewMode = function(mode) {
      originalSetSourceViewMode(mode);
      updateToolbarVisibility();
    };
  }

  function captureSelection() {
    state.selectedRange = getSelectionFromReader();
    if (state.selectedRange?.range && state.viewMode === "reader") {
      showQuoteButton(state.selectedRange.range);
    } else {
      hideQuoteButton();
    }
  }

  if (analysisReader) {
    analysisReader.addEventListener("mouseup", captureSelection);
    analysisReader.addEventListener("keyup", captureSelection);
  }

  if (quoteSelectionBtn) {
    quoteSelectionBtn.addEventListener("click", async () => {
      if (state.selectedRange?.quote) {
        const selection = {
          sourceId: state.selectedSourceId,
          start: state.selectedRange.start,
          end: state.selectedRange.end,
          quote: state.selectedRange.quote
        };
        const existingQuote = findExistingQuoteForSelection(selection);
        const quoteNode = existingQuote || await createQuoteNode(
          selection.quote,
          selection.sourceId,
          selection.start,
          selection.end
        );

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
      }
      hideQuoteButton();
    });
  }

  if (analysisForm) {
    analysisForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      // NEW: Changed analysis workflow - now analysis nodes are standalone and reference quotes
      const analysis = (analysisNotesInput?.value || "").trim();
      const tags = parseTags(analysisTagsInput?.value || "");
      
      if (!analysis) {
        alert("Please enter analysis commentary.");
        return;
      }

      const analysisId = analysisNodeIdInput?.value || crypto.randomUUID();
      await saveAnalysisNodeWithIntegrity({ analysisId, analysis, tags });
      dismissAnalysisModal();
      await backupLocalNodesToCloud();
    });
  }

  if (resetAnalysisFormBtn) {
    resetAnalysisFormBtn.addEventListener("click", async () => {
      await maybeDismissAnalysisModal();
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
        
        state.selectedQuoteRef = (node.quoteRefs || []).map((ref) => {
          const quoteNode = state.quotes.find((quote) => quote.id === ref.quoteId);
          return cloneQuoteRef({
            ...ref,
            priority: quoteNode?.priority ?? ref.priority ?? 3
          });
        });
        
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
        const quoteText = refTexts.length ? refTexts.join("\n\n") : node.quote || "";
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
          alert("Failed to copy quote to clipboard");
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

    let analysisNode = state.analysisNodes.find((n) => n.id === focusId);
    if (!analysisNode) {
      const qNode = state.quotes.find((n) => n.id === focusId);
      const aid = qNode?.meta?.analysisNodeIds?.[0];
      if (aid) {
        analysisNode = state.analysisNodes.find((n) => n.id === aid);
      }
    }
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

    state.focusedNodeId = analysisNode.id;
    state.focusedRangeKey = rangeKey;
    state.selectedRange = {
      start: exactStart,
      end: exactEnd,
      quote: analysisNode.quote || ""
    };

    renderReaderAndNodes();

    const card = analysisNodeList.querySelector(`[data-node-id="${analysisNode.id}"]`);
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

  // Hover on highlighted text to show corresponding analysis node
  analysisReader.addEventListener("mouseover", (event) => {
    const highlight = event.target.closest(".highlight-quote");
    if (!highlight) return;

    const focusId = highlight.dataset.focusId;
    if (!focusId) return;

    let analysisNode = state.analysisNodes.find((n) => n.id === focusId);
    if (!analysisNode) {
      const qNode = state.quotes.find((n) => n.id === focusId);
      const aid = qNode?.meta?.analysisNodeIds?.[0];
      if (aid) {
        analysisNode = state.analysisNodes.find((n) => n.id === aid);
      }
    }
    if (!analysisNode) return;

    const card = analysisNodeList.querySelector(`[data-node-id="${analysisNode.id}"]`);
    if (card && analysisNodeList) {
      // Check if card is in view
      const cardRect = card.getBoundingClientRect();
      const listRect = analysisNodeList.getBoundingClientRect();
      
      if (cardRect.bottom > listRect.bottom || cardRect.top < listRect.top) {
        // Card is out of view, scroll it into view
        const offset = cardRect.top - listRect.top - (listRect.height / 4);
        analysisNodeList.scrollBy({
          top: offset,
          behavior: "smooth"
        });
      }
    }
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

  if (contextNodeId) {
    const targetNode = state.nodes.find(n => n.id === contextNodeId) || state.quotes.find(q => q.id === contextNodeId);
    if (targetNode) {
      const nodeSubject = targetNode.subject;
      if (nodeSubject && nodeSubject !== state.selectedSubject) {
        state.selectedSubject = nodeSubject;
        await refreshData();
      }
      if (launchpadView) launchpadView.style.display = "none";
      if (studyView) studyView.style.display = "block";
      
      if (targetNode.type === "analysis" || targetNode.type === "source") {
        state.selectedSourceId = targetNode.id;
        renderSourceSelect();
      }
      
      if (targetNode.type === "analysis" && analysisReader) {
        analysisReader.innerHTML = formatAnalysisForDisplay(targetNode.analysis || "");
        analysisReader.dataset.nodeId = targetNode.id;
      }
    }
  }
}