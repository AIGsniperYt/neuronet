export async function initAnalysisToolV2(deps) {
  const {
    getAllNodes,
    getAllQuotes,
    addNode,
    addQuote,
    getQuote,
    deleteQuote,
    backupLocalNodesToCloud,
    removeNodeEverywhere,
    removeQuoteEverywhere,
    normalizeHierarchyPath,
    buildSection,
    parseTags,
    escapeHtml,
    getNodeTimestamp,
    isSourceNode,
    setAnalysisFocus
  } = deps;

  if (typeof window.__neuronetAnalysisCleanup === "function") {
    window.__neuronetAnalysisCleanup();
  }

  const launchpadView = document.getElementById("launchpadView");
  const studyView = document.getElementById("studyView");
  const analysisStats = document.getElementById("analysisStats");
  const subjectList = document.getElementById("subjectList");
  const newSubjectName = document.getElementById("newSubjectName");
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  const toggleSubjectEdit = document.getElementById("toggleSubjectEdit");
  const backToLaunchpad = document.getElementById("backToLaunchpad");
  const studySubjectTitle = document.getElementById("studySubjectTitle");
  const sourceSelect = document.getElementById("sourceSelect");
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
  const newSourceBtn = document.getElementById("newSourceBtn");
  const analysisReader = document.getElementById("analysisReader");
  const analysisForm = document.getElementById("analysisForm");
  const analysisFloatCard = document.getElementById("analysisFloatCard");
  const analysisNodeIdInput = document.getElementById("analysisNodeId");
  const analysisNotesInput = document.getElementById("analysisNotes");
  const analysisTagsInput = document.getElementById("analysisTags");
  const resetAnalysisFormBtn = document.getElementById("resetAnalysisForm");
  const analysisNodeList = document.getElementById("analysisNodeList");
  const analysisCardKicker = document.getElementById("analysisCardKicker");
  const closeAnalysisCardBtn = document.getElementById("closeAnalysisCard");
  const analysisSubmitBtn = document.getElementById("analysisSubmitBtn");
  const readerWrapper = document.getElementById("readerWrapper");
  const editorWrapper = document.getElementById("editorWrapper");
  const toggleSourceModeBtn = document.getElementById("toggleSourceModeBtn");
  const cancelEditSourceBtn = document.getElementById("cancelEditSourceBtn");
  const quoteSelectionBtn = document.getElementById("quoteSelectionBtn");
  const currentHierarchy = document.getElementById("currentHierarchy");

  // SAFETY CHECK: Verify critical elements exist
  if (!launchpadView || !studyView || !analysisForm || !analysisReader) {
    console.error("[ANALYSIS] Critical DOM elements missing. Analysis tool cannot initialize.", {
      launchpadView: !!launchpadView,
      studyView: !!studyView,
      analysisForm: !!analysisForm,
      analysisReader: !!analysisReader
    });
    return;
  }

const allowedTags = new Set(["P","DIV","BR","STRONG","B","EM","I","U","UL","OL","LI","BLOCKQUOTE","H1","H2","H3","A"]);
  const state = {
    nodes: [],
    quotes: [],           // NEW: separate quote nodes
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
    selectedQuoteRef: null // NEW: for quote picker in analysis form
  };

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
        // If we had empty lines, add one newline to represent the gap
        if (emptyCount > 0) {
          result.push("<br>");
          emptyCount = 0;
        }
        result.push(`${escapeHtml(line)}`);
      }
    }

    // Handle trailing empty lines - add one gap
    if (emptyCount > 0) {
      result.push("<br>");
    }

    return result.join("");
  }

  function formatQuoteForDisplay(quoteText) {
    // Convert the plain text quote to HTML with proper line break formatting
    // Split on common whitespace patterns that indicate line breaks in source
    const lines = (quoteText || "").split(/\n+/).map(line => line.trim()).filter(line => line);
    
    if (lines.length <= 1) {
      // Single line or minimal whitespace - just escape and return
      return escapeHtml(quoteText || "");
    }
    
    // Multi-line quote - join with <br> tags for proper formatting
    return lines.map(line => escapeHtml(line)).join("<br>");
  }

  function sanitizeRichHtml(input, isPlainText = false) {
    const parser = new DOMParser();
    const raw = isPlainText ? plainTextToHtml(input) : String(input || "");
    const doc = parser.parseFromString(`<div>${raw}</div>`, "text/html");
    const container = doc.body.firstElementChild;
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
        const wrapper = outDoc.createElement("div"); // preserve block spacing
        Array.from(node.childNodes).forEach((child) => sanitizeNode(child, wrapper));
        targetParent.appendChild(wrapper);
        return;
      }

      // Skip <a> tags entirely - just process their children
      // (they're navigation anchors and create unwanted spacing)
      if (tag === "A") {
        Array.from(node.childNodes).forEach((child) => sanitizeNode(child, targetParent));
        return;
      }

      // Unwrap <p> tags that contain ONLY inline formatting (no direct text, no block elements)
      // This handles contentEditable wrapping <strong>Name</strong> in <p>
      if (tag === "P") {
        const hasDirectText = Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && (child.nodeValue || "").trim()
        );
        const hasBlockChildren = Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.ELEMENT_NODE && blockTags.has(child.tagName.toUpperCase())
        );
        
        // If only contains inline elements with no direct text, unwrap the <p>
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
    console.log("Sanitized HTML:", { input, html });
    console.log("Sanitized Text:", { input, text: htmlToPlainText(html) });
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
    // Find all highlight spans and unwrap them by moving children back to parent
    const highlights = root.querySelectorAll(".highlight-quote");
    for (const span of highlights) {
      while (span.firstChild) {
        span.parentNode.insertBefore(span.firstChild, span);
      }
      span.parentNode.removeChild(span);
    }
    // Normalize text nodes (merge adjacent text nodes)
    root.normalize();
  }

  function wrapTextRange(root, start, end, className, dataFocusId, dataRangeKey) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    let index = 0;
    for (const node of textNodes) {
      const nodeText = node.nodeValue || "";
      const nodeEnd = index + nodeText.length;
      if (nodeEnd <= start) {
        index = nodeEnd;
        continue;
      }
      if (index >= end) break;

      const localStart = Math.max(0, start - index);
      const localEnd = Math.min(nodeText.length, end - index);
      let target = node;

      if (localEnd < nodeText.length) {
        node.splitText(localEnd);
        // Do NOT reassign target - it still points to the original node which now contains [0, localEnd)
      }
      if (localStart > 0) {
        target = node.splitText(localStart);
        // Now target points to the split-off part [localStart, localEnd)
      }

      const highlight = document.createElement("span");
      highlight.className = className;
      if (dataFocusId) {
        highlight.dataset.focusId = dataFocusId;
      }
      if (dataRangeKey) {
        highlight.dataset.rangeKey = dataRangeKey;
      }
      target.parentNode.replaceChild(highlight, target);
      highlight.appendChild(target);
      index = nodeEnd;
    }
  }

  function highlightQuotedRanges(root, ranges) {
    if (!root || !ranges?.length) return;
    // Clear existing highlights first to reset text node structure
    clearAllHighlights(root);
    
    // Sort by start position (ascending) to process left-to-right
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    for (const range of sorted) {
      if (Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
        const focusId = range.focusId ?? range.nodeId;
        const rangeKey = `${range.start}-${range.end}`;
        const isActive =
          focusId === state.focusedNodeId &&
          (!state.focusedRangeKey || state.focusedRangeKey === rangeKey);
        const className = isActive ? "highlight-quote active" : "highlight-quote";
        wrapTextRange(root, range.start, range.end, className, focusId, rangeKey);
      }
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
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const key = `${start}-${end}`;
      byPosition.set(key, {
        start,
        end,
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

      const quoteText = q.quote || "";
      let start = Number(q.link?.start ?? 0);
      let end = Number(q.link?.end ?? 0);
      if (!end && quoteText) {
        const pos = resolvePositions(quoteText, start, start + quoteText.length);
        start = pos.start;
        end = pos.end;
      } else if ((!Number.isFinite(end) || end <= start) && quoteText) {
        const pos = resolvePositions(quoteText, start, start + quoteText.length);
        start = pos.start;
        end = pos.end;
      }

      const analysisIds = q.meta?.analysisNodeIds || [];
      const focusId = analysisIds[0] || q.id;
      mergeRange(start, end, focusId);
    }

    for (const node of state.analysisNodes) {
      if (node.subject !== state.selectedSubject) continue;
      if (node.link?.sourceId !== source.id) continue;

      const quoteText = node.quote || "";
      let start = Number(node?.link?.start ?? node?.meta?.sourceOrder ?? 0);
      let end = Number(node?.link?.end ?? 0);
      if (!quoteText && (!end || end <= start)) continue;
      if (!end || end <= start) {
        const pos = resolvePositions(quoteText, start, start + quoteText.length);
        start = pos.start;
        end = pos.end;
      }
      mergeRange(start, end, node.id);
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
        const q = ref.quote || "";
        const truncated = `${escapeHtml(q.substring(0, previewLen))}${q.length > previewLen ? "..." : ""}`;
        const origin = quoteRefOriginLineHtml(ref);
        const priority = clampPriority(ref.priority);
        const stars = [1, 2, 3, 4, 5]
          .map((value) => {
            const active = value <= priority;
            const color = active ? getPriorityColor(value) : "rgba(230,255,245,0.2)";
            return `<button type="button" class="icon-btn" title="Set priority ${value}" aria-label="Set priority ${value}" onclick="setQuotePriorityForAnalysis(${idx}, ${value})" style="margin: 0; color: ${color};">${active ? "★" : "☆"}</button>`;
          })
          .join("");
        return `
            <div class="quote-ref-form-row" style="background: rgba(44, 255, 179, 0.08); padding: 8px; border-radius: 6px; font-size: 0.85rem;">
              <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
                <span style="flex: 1; line-height: 1.3; font-style: italic;">"${truncated}"</span>
                <button type="button" data-idx="${idx}" class="btn" style="padding: 4px 8px; font-size: 0.75rem;" onclick="removeQuoteRefFromAnalysis(${idx})">Remove</button>
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
      if (quoteRefsList && state.selectedQuoteRef && state.selectedQuoteRef.length > 0) {
        quoteRefsList.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
      } else if (quoteRefsList) {
        quoteRefsList.innerHTML = "";
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
  }

  /** Full close: clear draft and hide the panel (only explicit dismiss, e.g. ✕). */
  function dismissAnalysisModal() {
    clearAnalysisDraft();
    hideAnalysisCard();
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
      const quoteNode = state.quotes.find((quote) => quote.id === quoteId) || await getQuote(quoteId);
      const remainingAnalysisIds = (quoteNode?.meta?.analysisNodeIds || []).filter((id) => id !== analysisId);
      if (!quoteNode) continue;
      if (!remainingAnalysisIds.length) {
        await removeQuoteEverywhere(quoteId);
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

  async function deleteAnalysisNodeWithIntegrity(node) {
    for (const ref of node?.quoteRefs || []) {
      if (!ref.quoteId) continue;
      await unlinkAnalysisFromQuote(node.id, ref.quoteId);
      const quoteNode = state.quotes.find((quote) => quote.id === ref.quoteId) || await getQuote(ref.quoteId);
      if (!quoteNode) continue;
      const remainingAnalysisIds = quoteNode.meta?.analysisNodeIds || [];
      if (!remainingAnalysisIds.length) {
        await removeQuoteEverywhere(ref.quoteId);
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
        <article class="subject-card">
          <button class="btn subject-open" type="button" data-action="open-subject" data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>
          <div class="subject-actions" ${state.subjectEditMode ? "" : "hidden"}>
            <button class="btn" type="button" data-action="rename-subject" data-subject="${escapeHtml(subject)}">Rename</button>
            <button class="btn" type="button" data-action="delete-subject" data-subject="${escapeHtml(subject)}">Delete</button>
          </div>
        </article>
      `)
      .join("");
  }

  function renderSources() {
    const sources = getSourcesForSelectedSubject();

    if (!sources.length) {
      sourceSelect.innerHTML = `<option value="">No sources yet</option>`;
      analysisReader.innerHTML = "";
      analysisNodeList.innerHTML = `<div class="empty-note">No analysis nodes yet.</div>`;
      state.selectedSourceId = "";
      deleteSourceBtn.disabled = true;
      resetAnalysisForm();
      return;
    }

    if (!getSourceById(state.selectedSourceId) || getSourceById(state.selectedSourceId)?.subject !== state.selectedSubject) {
      state.selectedSourceId = sources[0].id;
    }

    sourceSelect.innerHTML = sources
      .map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === state.selectedSourceId ? "selected" : ""}>${escapeHtml(source.title || "Untitled source")}</option>`)
      .join("");

    deleteSourceBtn.disabled = !state.selectedSourceId;
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

    const domText = analysisReader.textContent;
    const highlightRanges = buildHighlightRangesForSource(source, domText);
    highlightQuotedRanges(analysisReader, highlightRanges);

    const analysesForSource = state.analysisNodes.filter(
      (node) => node.subject === state.selectedSubject && analysisTouchesSource(node, source.id)
    );

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
              .map((ref) => {
                const text = ref.quote || state.quotes.find((q) => q.id === ref.quoteId)?.quote || "";
                if (!text) return "";
                const origin = quoteRefOriginLineHtml(ref);
                const priority = clampPriority(ref.priority);
                const priorityStars = `<div style="display:flex; gap:2px; margin: 0 0 6px 0;">${[1,2,3,4,5].map((value) => `<span style="color:${value <= priority ? getPriorityColor(value) : "rgba(230,255,245,0.16)"};">${value <= priority ? "★" : "☆"}</span>`).join("")}</div>`;
                const jump = resolveRefJumpForRef(ref);
                if (jump) {
                  return `<button type="button" class="analysis-quote-jump" data-analysis-id="${escapeHtml(node.id)}" data-jump-source="${escapeHtml(jump.sourceId)}" data-jump-start="${jump.start}" data-jump-end="${jump.end}" title="Show this quote in the source">${priorityStars}<blockquote class="analysis-quote-preview">${formatQuoteForDisplay(text)}</blockquote>${origin}</button>`;
                }
                return `<div class="analysis-quote-static">${priorityStars}<blockquote class="analysis-quote-preview">${formatQuoteForDisplay(text)}</blockquote>${origin}</div>`;
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
                return `<button type="button" class="analysis-quote-jump" data-analysis-id="${escapeHtml(node.id)}" data-jump-source="${escapeHtml(legacySrc.id)}" data-jump-start="${off.start}" data-jump-end="${off.end}" title="Show this quote in the source"><blockquote class="analysis-quote-preview">${formatQuoteForDisplay(node.quote)}</blockquote>${origin}</button>`;
              }
            }
            return `<div class="analysis-quote-static"><blockquote class="analysis-quote-preview">${formatQuoteForDisplay(node.quote)}</blockquote>${origin}</div>`;
          }
          return "";
        })();
        return `
          <article class="item-card analysis-item ${isActive ? "active" : ""}" data-node-id="${escapeHtml(node.id)}" data-quote-start="${Number(node?.link?.start ?? 0)}">
            <div class="card-header">
              <div class="location">#${index + 1}</div>
              <div class="card-actions">
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
      setAnalysisFocus(document.body.classList.contains("analysis-focus-mode"));
      setSourceViewMode(state.viewMode);
      renderSources();
      renderReaderAndNodes();
    } else {
      state.selectedRange = null;
      setAnalysisFocus(false);
      setSourceViewMode("reader");
    }

    renderStats();
    renderSubjects();
    state.wasInStudy = inStudy;
  }

  async function refreshData() {
    const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    state.nodes = nodes;
    state.quotes = quotes;
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
      await removeQuoteEverywhere(quote.id);
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
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const subject = button.dataset.subject;
    if (!subject) return;

    if (button.dataset.action === "open-subject") {
      state.selectedSubject = subject;
      state.selectedSourceId = "";
      resetSourceForm();
      resetAnalysisForm();
      renderState();
      return;
    }

    if (button.dataset.action === "rename-subject") {
      await renameSubject(subject);
      return;
    }

    if (button.dataset.action === "delete-subject") {
      await deleteSubject(subject);
    }
  });

  backToLaunchpad.addEventListener("click", () => {
    state.selectedSubject = "";
    state.selectedSourceId = "";
    resetSourceForm();
    resetAnalysisForm();
    renderState();
  });

  if (sourceSelect) {
    sourceSelect.addEventListener("change", () => {
      const selectedId = sourceSelect.value;
      if (!selectedId) return;
      
      state.selectedSourceId = selectedId;
      state.focusedNodeId = null;
      state.focusedRangeKey = null;

      // If in editor mode, load the source for editing
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
  const addAnalysisNodeBtn = document.getElementById("addAnalysisNodeBtn");
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
        await removeQuoteEverywhere(quote.id);
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
      event.preventDefault();
      const html = event.clipboardData?.getData("text/html");
      const text = event.clipboardData?.getData("text/plain") || "";
      const clean = sanitizeRichHtml(html || text, !html);
      document.execCommand("insertHTML", false, clean.contentHtml);
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
      const clean = sanitizeRichHtml(sourceEditor.innerHTML || "<p><br></p>");
      const existing = getSourceById(sourceIdInput.value);
      const now = Date.now();
      const sourceId = sourceIdInput.value || crypto.randomUUID();

      await addNode({
        id: sourceId,
        type: "source",
        subject: state.selectedSubject,
        section: buildSection(path),
        title,
        content: clean.contentText,
        contentHtml: clean.contentHtml,
        contentText: clean.contentText,
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

  if (newSourceBtn) {
    newSourceBtn.addEventListener("click", () => {
      resetSourceForm();
      setSourceViewMode("editor");
    });
  }

  if (saveSourceBtn) {
    saveSourceBtn.addEventListener("click", () => {
      sourceForm.dispatchEvent(new Event("submit"));
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
    quoteSelectionBtn.addEventListener("click", () => {
      if (state.selectedRange?.quote) {
        const quoteText = state.selectedRange.quote;
        if (!state.selectedQuoteRef) {
          state.selectedQuoteRef = [];
        }

        const quoteRef = {
          quoteId: crypto.randomUUID(),
          section: getSourceById(state.selectedSourceId)?.section || "",
          quote: quoteText,
          sourceId: state.selectedSourceId,
          start: state.selectedRange.start,
          end: state.selectedRange.end,
          priority: 3
        };

        if (!state.selectedQuoteRef.some(ref =>
          ref.quote === quoteText &&
          ref.sourceId === quoteRef.sourceId &&
          Number(ref.start) === Number(quoteRef.start) &&
          Number(ref.end) === Number(quoteRef.end)
        )) {
          state.selectedQuoteRef.push(quoteRef);
        }

        if (quoteRefsList) {
          quoteRefsList.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
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
    resetAnalysisFormBtn.addEventListener("click", () => {
      clearAnalysisDraft();
      showAnalysisCard();
    });
  }

  if (closeAnalysisCardBtn) {
    closeAnalysisCardBtn.addEventListener("click", () => {
      dismissAnalysisModal();
    });
  }

  // NEW: Add click listener for "+ Add Quote Reference" button
  const addQuoteRefBtn = document.getElementById("addQuoteRefBtn");
  const quoteRefsList = document.getElementById("quoteRefsList");

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
    if (quoteRefsList) {
      quoteRefsList.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
    }
  };

  // NEW: Function to remove quote reference
  window.removeQuoteRefFromAnalysis = function(idx) {
    if (state.selectedQuoteRef && state.selectedQuoteRef[idx]) {
      state.selectedQuoteRef.splice(idx, 1);
      
      if (quoteRefsList) {
        quoteRefsList.innerHTML = state.selectedQuoteRef.length
          ? renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100)
          : "";
      }
    }
  };

  window.setQuotePriorityForAnalysis = function(idx, priority) {
    if (!state.selectedQuoteRef?.[idx]) return;
    state.selectedQuoteRef[idx].priority = clampPriority(priority);
    if (quoteRefsList) {
      quoteRefsList.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
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
        if (quoteRefsList) {
          quoteRefsList.innerHTML = renderModalQuoteRefsListHtml(state.selectedQuoteRef, 100);
        }
        
        state.analysisEditMode = true;
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
        const confirmed = window.confirm("Delete this analysis node?");
        if (!confirmed) return;
        const wasEditingThis = analysisNodeIdInput?.value === node.id;
        await deleteAnalysisNodeWithIntegrity(node);
        state.focusedNodeId = null;
        state.focusedRangeKey = null;
        if (wasEditingThis) dismissAnalysisModal();
        await refreshData();
        await backupLocalNodesToCloud();
        return;
      }
    }
  });

  // Click on highlighted text in reader to jump to corresponding analysis node
  analysisReader.addEventListener("click", (event) => {
    const highlight = event.target.closest(".highlight-quote");
    if (!highlight) {
      event.stopPropagation();
      return;
    }

    event.stopPropagation();
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

    state.focusedNodeId = analysisNode.id;
    state.focusedRangeKey = highlight.dataset.rangeKey || null;
    state.selectedRange = {
      start: Number(analysisNode?.link?.start || 0),
      end: Number(analysisNode?.link?.end || 0),
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
    setAnalysisFocus(false);
  };

  resetSourceForm();
  resetAnalysisForm();
  await refreshData();
}
