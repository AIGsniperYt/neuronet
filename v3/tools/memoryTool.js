export async function initMemoryTool(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    getAllCues,
    getQuotesForSubject,
    getAnalysisNodesForSubject,
    getDueQuotesForSubject,
    getDueAnalysisNodesForSubject,
    addQuote,
    addNode,
    getQuotesReferencedByAnalysis,
    getAnalysesReferencingQuote,
    getCuesForQuote,
    getNode,
    getNodeTimestamp,
    getSubjects,
    escapeHtml
  } = deps;

  const { subject: contextSubject } = context;

  if (typeof window.__neuronetMemoryCleanup === "function") {
    window.__neuronetMemoryCleanup();
  }

  const state = {
    currentSubject: contextSubject || "",
    currentMode: "quote-learning",
    flashcards: [], // session history (cards shown)
    currentIndex: 0,
    isFlipped: false,
    showAnalysis: false,
    session: {
      heap: null,
      surprisePool: [],
      shownAt: null,
      revealedAt: null,
      suppressDBChange: false
    },
    stats: {
      totalStudied: 0,
      correctAnswers: 0,
      streak: 0,
      bestStreak: 0
    },
    evidenceMatching: {
      currentAnalysis: null,
      quoteOptions: [],
      selectedOption: null,
      correctOption: null,
      answered: false,
      wasCorrect: null
    }
  };

  let memoryTool, modeSelect, newSessionBtn, statsBtn;
  let flashcardContainer, flashcard, flashcardContent, flashcardBackContent;
  let flipBtn, prevBtn, nextBtn, showAnalysisBtn;
  let gradingControls, gradeDidntKnowBtn, gradeKindaBtn, gradeEasyBtn;
  let evidenceMatchingContainer, evidencePrompt, quoteOptions, evidenceFeedback;
  let memoryStats, statsContent, closeStatsBtn;
  
  function getDOMElements() {
    memoryTool = document.getElementById("memoryTool");
    modeSelect = document.getElementById("modeSelect");
    newSessionBtn = document.getElementById("newSessionBtn");
    statsBtn = document.getElementById("statsBtn");
    flashcardContainer = document.getElementById("flashcardContainer");
    flashcard = document.getElementById("flashcard");
    flashcardContent = document.getElementById("flashcardContent");
    flashcardBackContent = document.getElementById("flashcardBackContent");
    flipBtn = document.getElementById("flipBtn");
    prevBtn = document.getElementById("prevBtn");
    nextBtn = document.getElementById("nextBtn");
    showAnalysisBtn = document.getElementById("showAnalysisBtn");
    gradingControls = document.getElementById("gradingControls");
    gradeDidntKnowBtn = document.getElementById("gradeDidntKnowBtn");
    gradeKindaBtn = document.getElementById("gradeKindaBtn");
    gradeEasyBtn = document.getElementById("gradeEasyBtn");
    evidenceMatchingContainer = document.getElementById("evidenceMatchingContainer");
    evidencePrompt = document.getElementById("evidencePrompt");
    quoteOptions = document.getElementById("quoteOptions");
    evidenceFeedback = document.getElementById("evidenceFeedback");
    memoryStats = document.getElementById("memoryStats");
    statsContent = document.getElementById("statsContent");
    closeStatsBtn = document.getElementById("closeStatsBtn");
  }

  async function initialize() {
    try {
      getDOMElements();
      await refreshSubjectList();
      await loadFlashcards();
      renderUI();
      attachEventListeners();
      attachKeyboardShortcuts();
      document.addEventListener("db-change", handleDBChange);
    } catch (error) {
      console.error("Failed to initialize memory tool:", error);
      if (flashcardContent) {
        flashcardContent.textContent = `Error loading memory tool: ${error.message}`;
      }
    }
  }

  function attachEventListeners() {
    if (modeSelect) {
      modeSelect.addEventListener("click", async () => {
        const modes = ["quote-learning", "analysis-learning", "evidence-matching", "blurt"];
        const currentIndex = modes.indexOf(state.currentMode);
        state.currentMode = modes[(currentIndex + 1) % modes.length];
        await loadFlashcards();
        renderUI();
      });
    }

    if (newSessionBtn) {
      newSessionBtn.addEventListener("click", async () => {
        state.currentIndex = 0;
        state.isFlipped = false;
        state.showAnalysis = false;
        await loadFlashcards();
        renderUI();
      });
    }

    if (statsBtn) {
      statsBtn.addEventListener("click", () => {
        renderStats();
        if (memoryStats) memoryStats.style.display = "block";
      });
    }

    if (flipBtn) {
      flipBtn.addEventListener("click", () => flipCard());
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", () => navigatePrevious());
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => navigateNext());
    }

    if (showAnalysisBtn) {
      showAnalysisBtn.addEventListener("click", () => {
        state.showAnalysis = !state.showAnalysis;
        renderUI();
      });
    }

    if (gradeDidntKnowBtn) {
      gradeDidntKnowBtn.addEventListener("click", async () => {
        await gradeCurrentCard("didnt_know");
      });
    }
    if (gradeKindaBtn) {
      gradeKindaBtn.addEventListener("click", async () => {
        await gradeCurrentCard("kinda");
      });
    }
    if (gradeEasyBtn) {
      gradeEasyBtn.addEventListener("click", async () => {
        await gradeCurrentCard("easy");
      });
    }

    if (closeStatsBtn) {
      closeStatsBtn.addEventListener("click", () => {
        if (memoryStats) memoryStats.style.display = "none";
      });
    }

    if (flashcard) {
      flashcard.addEventListener("click", (e) => {
        if (e.target.closest(".memory-btn") || e.target.closest(".grade-btn")) return;
        flipCard();
      });
    }
  }

  function attachKeyboardShortcuts() {
    document.addEventListener("keydown", handleKeyDown);
  }

  function handleKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    
    if (state.currentMode === "evidence-matching") {
      if (!state.evidenceMatching.answered) {
        if (e.key >= "1" && e.key <= "4") {
          e.preventDefault();
          const index = parseInt(e.key) - 1;
          if (index < state.evidenceMatching.quoteOptions.length) {
            selectQuoteOption(index);
          }
          return;
        }
      }
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        navigateNext();
        return;
      }
    }
    
    switch (e.key) {
      case " ":
        e.preventDefault();
        flipCard();
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        navigatePrevious();
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        navigateNext();
        break;
    }
  }

  function flipCard() {
    const wasFlipped = state.isFlipped;
    state.isFlipped = !state.isFlipped;
    if (!wasFlipped && state.isFlipped) {
      const currentCard = state.flashcards[state.currentIndex];
      if (currentCard?.type !== "blurt") {
        state.session.revealedAt = Date.now();
      }
    }
    renderUI();
  }

  async function gradeCurrentCard(grade) {
    const currentCard = state.flashcards[state.currentIndex];
    if (!currentCard?.review?.required || currentCard.review.graded) return;
    if (!state.isFlipped) return;
    if (typeof addQuote !== "function" || typeof addNode !== "function") {
      console.warn("Memory grading is unavailable: addQuote/addNode not provided to Memory Tool.");
      return;
    }

    const nowMs = Date.now();
    const shownAt = state.session.shownAt ?? nowMs;
    const revealedAt = state.session.revealedAt ?? nowMs;
    const responseTimeMs = clampNumber(revealedAt - shownAt, 200, 240000) * 1;

    const isBlurt = currentCard.type === "blurt";
    const persistKind = isBlurt ? currentCard.targetKind : currentCard.memoryKind;
    const persistRecord = isBlurt ? currentCard.targetRecord : currentCard.record;
    if (!persistKind || !persistRecord) return;

    const updatedMemoryState = updateCardMemoryState(
      currentCard.memoryState,
      { grade, responseTimeMs, confidence: null },
      nowMs
    );

    currentCard.review.graded = true;
    currentCard.review.grade = grade;
    currentCard.review.responseTimeMs = responseTimeMs;
    currentCard.memoryState = updatedMemoryState;

    if (persistKind === "quote") {
      const updatedQuote = {
        ...persistRecord,
        meta: mergeMemoryStateIntoMeta(persistRecord.meta || {}, updatedMemoryState),
        updatedAt: nowMs
      };
      state.session.suppressDBChange = true;
      await addQuote(updatedQuote);
      if (isBlurt) {
        currentCard.targetRecord = updatedQuote;
      } else {
        currentCard.record = updatedQuote;
      }
    } else if (persistKind === "analysis") {
      const updatedNode = {
        ...persistRecord,
        meta: mergeMemoryStateIntoMeta(persistRecord.meta || {}, updatedMemoryState),
        updatedAt: nowMs
      };
      state.session.suppressDBChange = true;
      await addNode(updatedNode);
      if (isBlurt) {
        currentCard.targetRecord = updatedNode;
      } else {
        currentCard.record = updatedNode;
      }
    }

    state.stats.totalStudied++;
    if (grade === "easy") {
      state.stats.correctAnswers++;
      state.stats.streak++;
      if (state.stats.streak > state.stats.bestStreak) {
        state.stats.bestStreak = state.stats.streak;
      }
    } else {
      state.stats.streak = 0;
    }

    await maybeEnqueueSurpriseCard();
    renderUI();
  }

  function navigatePrevious() {
    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
      state.session.shownAt = Date.now();
      state.session.revealedAt = null;
      renderUI();
    }
  }

  function navigateNext() {
    if (state.currentMode === "evidence-matching") {
      if (state.evidenceMatching.selectedOption !== null && !state.evidenceMatching.answered) {
        checkEvidenceMatchingAnswer();
        renderUI();
        return;
      }
      if (state.evidenceMatching.answered) {
        moveToNextEvidenceQuestion();
        return;
      }
    }

    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }

    if (state.currentIndex < state.flashcards.length - 1) {
      state.currentIndex++;
      state.isFlipped = false;
      state.session.shownAt = Date.now();
      state.session.revealedAt = null;
      renderUI();
      return;
    }

    if (state.session.heap && state.session.heap.size() > 0) {
      drawNextCardFromHeap();
      renderUI();
    }
  }

  async function moveToNextEvidenceQuestion() {
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (!analyses || analyses.length === 0) return;
    const currentIdx = analyses.findIndex(a => a.id === state.evidenceMatching.currentAnalysis?.id);
    const nextIdx = (currentIdx + 1) % analyses.length;
    await loadEvidenceMatchingForAnalysis(analyses[nextIdx].id);
    renderUI();
  }

  function handleDBChange(event) {
    if (state.session.suppressDBChange) {
      state.session.suppressDBChange = false;
      return;
    }
    loadFlashcards().then(renderUI);
  }

async function refreshSubjectList() {
    const subjects = await getSubjects();
    if (subjects.length > 0 && !state.currentSubject) {
      state.currentSubject = subjects[0];
    }
    if (!state.currentSubject) {
      return;
    }
  }

  async function loadFlashcards() {
    if (!state.currentSubject) {
      state.flashcards = [];
      return;
    }
    
    state.flashcards = [];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.showAnalysis = false;
    state.session.heap = new MaxHeap();
    state.session.surprisePool = [];
    state.session.shownAt = null;
    state.session.revealedAt = null;

    if (state.currentMode === "quote-learning") {
      await buildQuoteLearningQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "analysis-learning") {
      await buildAnalysisLearningQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "blurt") {
      await buildBlurtQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "evidence-matching") {
      await loadEvidenceMatchingFlashcards();
    }
  }

  class MaxHeap {
    constructor() {
      this.items = [];
    }
    size() {
      return this.items.length;
    }
    push(value) {
      this.items.push(value);
      this.#bubbleUp(this.items.length - 1);
    }
    pop() {
      if (this.items.length === 0) return null;
      const top = this.items[0];
      const last = this.items.pop();
      if (this.items.length > 0 && last) {
        this.items[0] = last;
        this.#bubbleDown(0);
      }
      return top;
    }
    #bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if ((this.items[parent]?.priority ?? 0) >= (this.items[index]?.priority ?? 0)) return;
        [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
        index = parent;
      }
    }
    #bubbleDown(index) {
      const length = this.items.length;
      while (true) {
        let largest = index;
        const left = 2 * index + 1;
        const right = 2 * index + 2;
        if (left < length && (this.items[left]?.priority ?? 0) > (this.items[largest]?.priority ?? 0)) largest = left;
        if (right < length && (this.items[right]?.priority ?? 0) > (this.items[largest]?.priority ?? 0)) largest = right;
        if (largest === index) return;
        [this.items[index], this.items[largest]] = [this.items[largest], this.items[index]];
        index = largest;
      }
    }
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function getExpectedTimeMs(kind) {
    if (kind === "analysis") return 8000;
    if (kind === "blurt") return 15000;
    return 4000;
  }

  function getMemoryStateFromMeta(meta = {}, kind) {
    return {
      S: clampNumber(Number(meta.S ?? 1.0), 0.1, 1000),
      D: clampNumber(Number(meta.D ?? 1.0), 0.1, 1000),
      U: clampNumber(Number(meta.U ?? 0.5), 0, 1),
      interval: clampNumber(Number(meta.interval ?? 0.1), 0.1, 365),
      nextReview: Number.isFinite(Number(meta.nextReview)) ? Number(meta.nextReview) : 0,
      lastReview: Number.isFinite(Number(meta.lastReview)) ? Number(meta.lastReview) : null,
      reviewCount: Number.isFinite(Number(meta.reviewCount)) ? Number(meta.reviewCount) : 0,
      expectedTime: clampNumber(Number(meta.expectedTime ?? (getExpectedTimeMs(kind) / 1000)), 1, 120),
      avgTime: clampNumber(Number(meta.avgTime ?? (getExpectedTimeMs(kind) / 1000)), 0.2, 240),
      timeVariance: clampNumber(Number(meta.timeVariance ?? 0.7), 0, 1000),
      consistency: clampNumber(Number(meta.consistency ?? 0.7), 0, 1),
      confidence: clampNumber(Number(meta.confidence ?? 0.7), 0, 1)
    };
  }

  function mergeMemoryStateIntoMeta(existingMeta = {}, memoryState) {
    return {
      ...existingMeta,
      S: memoryState.S,
      D: memoryState.D,
      U: memoryState.U,
      interval: memoryState.interval,
      nextReview: memoryState.nextReview,
      lastReview: memoryState.lastReview,
      reviewCount: memoryState.reviewCount,
      expectedTime: memoryState.expectedTime,
      avgTime: memoryState.avgTime,
      timeVariance: memoryState.timeVariance,
      consistency: memoryState.consistency,
      confidence: memoryState.confidence
    };
  }

  function updateCardMemoryState(memoryState, { grade, responseTimeMs, confidence }, nowMs) {
    const gradeNorm = grade === "easy" ? 1 : grade === "kinda" ? 0 : -1;
    const gradeAbs = Math.abs(gradeNorm);

    const expectedSeconds = clampNumber(Number(memoryState.expectedTime ?? 4), 1, 120);
    const actualSeconds = clampNumber(Number(responseTimeMs ?? 4000) / 1000, 0.2, 240);

    const TF = actualSeconds / expectedSeconds;
    const T_effect = 1 / (1 + Math.exp(2 * (TF - 1)));

    let S = memoryState.S;
    S = S * (1 + 0.25 * gradeNorm * T_effect) - 0.15 * (1 - T_effect) * (gradeAbs + 0.2);
    S = clampNumber(S, 0.1, 1000);

    let D = memoryState.D;
    D = D * (1 - 0.2 * gradeNorm * T_effect) + 0.1 * (1 - gradeAbs) * (1 - T_effect);
    D = clampNumber(D, 0.1, 1000);

    let consistency = clampNumber(memoryState.consistency ?? 0.7, 0, 1);
    consistency = clampNumber(consistency + 0.05 * gradeNorm * T_effect - 0.02 * (1 - T_effect), 0, 1);

    let U = memoryState.U;
    U = U + 0.2 * (1 - consistency) + 0.15 * (1 - T_effect);
    U = clampNumber(U, 0, 1);

    const I_base = S / (D + 0.5);
    let intervalDays = I_base * (1 + 0.8 * gradeNorm * T_effect);
    intervalDays = clampNumber(intervalDays, 0.1, 365);

    const intervalMs = intervalDays * 86400000;
    const uncertaintyFactor = 1 - 0.2 * U;
    const nextReview = nowMs + intervalMs * uncertaintyFactor;

    const avgTimePrev = clampNumber(Number(memoryState.avgTime ?? expectedSeconds), 0.2, 240);
    const avgTime = clampNumber(avgTimePrev * 0.8 + actualSeconds * 0.2, 0.2, 240);
    const timeVariancePrev = clampNumber(Number(memoryState.timeVariance ?? 0.7), 0, 1000);
    const timeVariance = clampNumber(timeVariancePrev * 0.8 + Math.pow(actualSeconds - avgTime, 2) * 0.2, 0, 1000);

    const reviewCount = (memoryState.reviewCount ?? 0) + 1;
    const confidenceBase = confidence ?? memoryState.confidence ?? 0.7;
    const confidenceOut = clampNumber(confidenceBase + 0.06 * gradeNorm - 0.03 * (1 - T_effect), 0, 1);

    return {
      ...memoryState,
      S,
      D,
      U,
      interval: intervalDays,
      nextReview,
      lastReview: nowMs,
      reviewCount,
      avgTime,
      timeVariance,
      consistency,
      confidence: confidenceOut
    };
  }

  function computePriority(memoryState, nowMs) {
    const nextReview = Number.isFinite(Number(memoryState.nextReview)) ? Number(memoryState.nextReview) : 0;
    const overdueDays = Math.max(0, nowMs - nextReview) / 86400000;
    const U = clampNumber(Number(memoryState.U ?? 0.5), 0, 1);
    return 1 + overdueDays + U * 0.8;
  }

  async function maybeEnqueueSurpriseCard() {
    if (state.currentMode !== "quote-learning" && state.currentMode !== "analysis-learning") return;
    if (!state.session.heap) return;
    if (!Array.isArray(state.session.surprisePool) || state.session.surprisePool.length === 0) return;
    if (Math.random() > 0.08) return;

    const idx = Math.floor(Math.random() * state.session.surprisePool.length);
    const candidate = state.session.surprisePool.splice(idx, 1)[0];
    if (!candidate?.record?.id) return;

    const alreadySeen = state.flashcards.some((c) => c?.record?.id === candidate.record.id || c?.id === candidate.record.id);
    if (alreadySeen) return;

    const nowMs = Date.now();
    let card = null;

    if (candidate.memoryKind === "quote") {
      const quote = candidate.record;
      const analyses = await getAnalysesReferencingQuote(quote.id);
      const cueNode = candidate.cueNode || null;
      card = {
        id: quote.id,
        memoryKind: "quote",
        type: "quote-learning",
        record: quote,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: getCueForQuote(quote, cueNode),
          isCue: true,
          cueNode
        },
        back: {
          content: quote.quote,
          isQuote: true,
          quoteData: quote,
          analyses: analyses
        },
        memoryState: candidate.memoryState
      };
    } else if (candidate.memoryKind === "analysis") {
      const analysis = candidate.record;
      const quotes = await getQuotesReferencedByAnalysis(analysis.id);
      card = {
        id: analysis.id,
        memoryKind: "analysis",
        type: "analysis-learning",
        record: analysis,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: analysis.title || "What is the analysis?",
          isQuestion: true,
          quotes: quotes
        },
        back: {
          content: analysis.analysis,
          isAnalysis: true,
          analysisData: analysis
        },
        memoryState: candidate.memoryState
      };
    }

    if (!card) return;
    const priority = computePriority(card.memoryState, nowMs) + 0.7;
    state.session.heap.push({ priority, card });
  }

  function drawNextCardFromHeap() {
    const next = state.session.heap?.pop();
    if (!next?.card) return;

    state.flashcards.push(next.card);
    state.currentIndex = state.flashcards.length - 1;
    state.isFlipped = false;
    state.showAnalysis = false;
    state.session.shownAt = Date.now();
    state.session.revealedAt = null;
  }

  async function buildQuoteLearningQueue() {
    const nowMs = Date.now();
    const [dueQuotes, allQuotes, allCues] = await Promise.all([
      typeof getDueQuotesForSubject === "function"
        ? getDueQuotesForSubject(state.currentSubject, { now: nowMs, limit: 400 })
        : Promise.resolve([]),
      getQuotesForSubject(state.currentSubject),
      getAllCues()
    ]);

    const cuesByQuoteId = new Map();
    (allCues || [])
      .filter((c) => c?.subject === state.currentSubject && c?.quoteId)
      .forEach((cue) => {
        if (!cuesByQuoteId.has(cue.quoteId)) cuesByQuoteId.set(cue.quoteId, cue);
      });

    const quoteMap = new Map();
    (dueQuotes || []).forEach((q) => quoteMap.set(q.id, q));
    (allQuotes || [])
      .filter((q) => !Number.isFinite(Number(q?.meta?.nextReview)))
      .forEach((q) => quoteMap.set(q.id, q));

    state.session.surprisePool = (allQuotes || [])
      .filter((q) => !quoteMap.has(q.id))
      .filter((q) => Number.isFinite(Number(q?.meta?.nextReview)) && Number(q.meta.nextReview) > nowMs)
      .map((q) => {
        const memoryState = getMemoryStateFromMeta(q.meta || {}, "quote");
        return {
          memoryKind: "quote",
          record: q,
          cueNode: cuesByQuoteId.get(q.id) || null,
          memoryState
        };
      })
      .filter((c) => (c?.memoryState?.U ?? 0) >= 0.6)
      .sort((a, b) => (b.memoryState.U ?? 0) - (a.memoryState.U ?? 0))
      .slice(0, 80);

    const cards = await Promise.all(
      Array.from(quoteMap.values()).map(async (quote) => {
        const analyses = await getAnalysesReferencingQuote(quote.id);
        const cueNode = cuesByQuoteId.get(quote.id) || null;
        const memoryState = getMemoryStateFromMeta(quote.meta || {}, "quote");
        return {
          id: quote.id,
          memoryKind: "quote",
          type: "quote-learning",
          record: quote,
          review: { required: true, graded: false, grade: null, responseTimeMs: null },
          front: {
            content: getCueForQuote(quote, cueNode),
            isCue: true,
            cueNode
          },
          back: {
            content: quote.quote,
            isQuote: true,
            quoteData: quote,
            analyses: analyses
          },
          memoryState
        };
      })
    );

    cards.forEach((card) => {
      const priority = computePriority(card.memoryState, nowMs);
      state.session.heap.push({ priority, card });
    });
  }

  function getCueForQuote(quote, cueNode = null) {
    if (cueNode?.cue) {
      return cueNode.cue;
    }
    const words = quote.quote.split(' ');
    if (words.length <= 4) return quote.quote;
    return `${words[0]} ... ${words[words.length - 1]}`;
  }

  async function buildAnalysisLearningQueue() {
    const nowMs = Date.now();
    const [dueAnalyses, allAnalyses] = await Promise.all([
      typeof getDueAnalysisNodesForSubject === "function"
        ? getDueAnalysisNodesForSubject(state.currentSubject, { now: nowMs, limit: 400 })
        : Promise.resolve([]),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);

    const analysisMap = new Map();
    (dueAnalyses || []).forEach((a) => analysisMap.set(a.id, a));
    (allAnalyses || [])
      .filter((a) => !Number.isFinite(Number(a?.meta?.nextReview)))
      .forEach((a) => analysisMap.set(a.id, a));

    state.session.surprisePool = (allAnalyses || [])
      .filter((a) => !analysisMap.has(a.id))
      .filter((a) => Number.isFinite(Number(a?.meta?.nextReview)) && Number(a.meta.nextReview) > nowMs)
      .map((a) => {
        const memoryState = getMemoryStateFromMeta(a.meta || {}, "analysis");
        return {
          memoryKind: "analysis",
          record: a,
          memoryState
        };
      })
      .filter((c) => (c?.memoryState?.U ?? 0) >= 0.6)
      .sort((a, b) => (b.memoryState.U ?? 0) - (a.memoryState.U ?? 0))
      .slice(0, 80);

    const cards = await Promise.all(
      Array.from(analysisMap.values()).map(async (analysis) => {
        const quotes = await getQuotesReferencedByAnalysis(analysis.id);
        const memoryState = getMemoryStateFromMeta(analysis.meta || {}, "analysis");
        return {
          id: analysis.id,
          memoryKind: "analysis",
          type: "analysis-learning",
          record: analysis,
          review: { required: true, graded: false, grade: null, responseTimeMs: null },
          front: {
            content: analysis.title || "What is the analysis?",
            isQuestion: true,
            quotes: quotes
          },
          back: {
            content: analysis.analysis,
            isAnalysis: true,
            analysisData: analysis
          },
          memoryState
        };
      })
    );

    cards.forEach((card) => {
      const priority = computePriority(card.memoryState, nowMs);
      state.session.heap.push({ priority, card });
    });
  }

  async function buildBlurtQueue() {
    const nowMs = Date.now();
    const [allCues, quotes, analyses] = await Promise.all([
      getAllCues(),
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);

    const quotesById = new Map((quotes || []).map((q) => [q.id, q]));
    const analysesById = new Map((analyses || []).map((a) => [a.id, a]));

    const subjectCues = (allCues || []).filter((c) => c?.subject === state.currentSubject && c?.cue);

    subjectCues.forEach((cue) => {
      let targetKind = null;
      let targetRecord = null;
      if (cue.quoteId && quotesById.has(cue.quoteId)) {
        targetKind = "quote";
        targetRecord = quotesById.get(cue.quoteId);
      } else if (cue.analysisId && analysesById.has(cue.analysisId)) {
        targetKind = "analysis";
        targetRecord = analysesById.get(cue.analysisId);
      } else {
        return;
      }

      const memoryState = getMemoryStateFromMeta(targetRecord.meta || {}, targetKind);
      memoryState.expectedTime = Math.max(memoryState.expectedTime, getExpectedTimeMs("blurt") / 1000);

      const card = {
        id: cue.id,
        memoryKind: "blurt",
        type: "blurt",
        cue,
        targetKind,
        targetRecord,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: { content: cue.cue, isCue: true, cueNode: cue },
        back: { isBlurtInput: true },
        blurt: { submitted: false, text: "" },
        memoryState
      };

      const priority = computePriority(memoryState, nowMs);
      state.session.heap.push({ priority, card });
    });
  }

  async function loadEvidenceMatchingFlashcards() {
    if (!state.currentSubject) {
      state.flashcards = [];
      return;
    }
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (analyses.length === 0) {
      state.flashcards = [];
      return;
    }
    await loadEvidenceMatchingForAnalysis(analyses[0].id);
  }

  async function loadEvidenceMatchingForAnalysis(analysisId) {
    if (!state.currentSubject || !analysisId) {
      return;
    }
    const analysis = await getNode(analysisId);
    if (!analysis) return;

    const referencedQuotes = await getQuotesReferencedByAnalysis(analysisId);
    const allQuotes = await getQuotesForSubject(state.currentSubject);
    const distractorQuotes = allQuotes
      .filter(q => !referencedQuotes.some(rq => rq.id === q.id))
      .slice(0, Math.min(3, allQuotes.length));

    const allOptions = [...referencedQuotes, ...distractorQuotes];
    shuffleArray(allOptions);

    state.evidenceMatching = {
      currentAnalysis: analysis,
      quoteOptions: allOptions,
      selectedOption: null,
      correctOption: referencedQuotes.map(q => q.id),
      answered: false,
      wasCorrect: null
    };

    state.flashcards = [{
      id: analysisId,
      type: "evidence-matching",
      front: {
        content: analysis.analysis,
        isAnalysis: true
      },
      back: {
        content: "Select the quotes that support this analysis",
        isInstruction: true
      }
    }];
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function renderUI() {
    if (!flashcardContainer || !flashcardContent || !flashcardBackContent) {
      getDOMElements();
    }
    
    if (modeSelect) {
      modeSelect.textContent = 
        state.currentMode === "quote-learning" ? "Quote Learning" :
        state.currentMode === "analysis-learning" ? "Analysis Learning" :
        state.currentMode === "blurt" ? "Blurt" :
        "Evidence Matching";
    }

    if (flashcardContainer) flashcardContainer.style.display = 
      state.currentMode !== "evidence-matching" ? "flex" : "none";
    if (evidenceMatchingContainer) evidenceMatchingContainer.style.display = 
      state.currentMode === "evidence-matching" ? "block" : "none";
    if (memoryStats) memoryStats.style.display = "none";

    if (!state.currentSubject) {
      if (flashcardContent) flashcardContent.textContent = "Select a subject to start studying.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Use the sidebar to enter a subject.";
      return;
    }

    if (state.flashcards.length > 0 && state.currentIndex < state.flashcards.length) {
      const flashcardData = state.flashcards[state.currentIndex];
      updateFlashcardDisplay(flashcardData, flashcard);
    } else {
      if (flashcardContent) flashcardContent.textContent = "No flashcards available.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Add content in the Analysis tool.";
    }

    const currentCard = state.flashcards[state.currentIndex];
    if (gradingControls) {
      const shouldShowGrading =
        state.currentMode !== "evidence-matching" &&
        !!currentCard?.review?.required &&
        state.isFlipped &&
        !currentCard.review.graded &&
        (currentCard.type !== "blurt" || !!currentCard.blurt?.submitted);
      gradingControls.style.display = shouldShowGrading ? "flex" : "none";
    }

    if (state.currentMode === "evidence-matching") {
      renderEvidenceMatchingUI();
    }
  }

  function updateFlashcardDisplay(flashcardData, flashcardElement) {
    if (!flashcardContent || !flashcardBackContent || !flashcardData) return;

    const front = flashcardData.front || {};
    const back = flashcardData.back || {};

// Front content
     if (front.isCue) {
       flashcardContent.innerHTML = `<div class="cue">${escapeHtml(front.content || "")}</div>`;
     } else if (front.isQuestion) {
       flashcardContent.innerHTML = `<div class="question">${escapeHtml(front.content || "")}</div>`;
       if (front.quotes && front.quotes.length > 0) {
         flashcardContent.innerHTML += `<div class="linked-quotes">`;
         flashcardContent.innerHTML += `<div class="linked-quotes-title">Which quote relates to this?</div>`;
         front.quotes.forEach(quote => {
           flashcardContent.innerHTML += `<div class="linked-quote-item">${escapeHtml(quote.quote)}</div>`;
           if (quote.section) {
             flashcardContent.innerHTML += `<div class="linked-quote-source">${escapeHtml(quote.section)}</div>`;
           }
         });
         flashcardContent.innerHTML += `</div>`;
       }
     } else if (front.isAnalysis) {
       flashcardContent.innerHTML = `<div class="analysis-preview">${formatAnalysisForDisplay(front.content || "")}</div>`;
     } else if (front.isQuote) {
       flashcardContent.innerHTML = `<div class="quote">${escapeHtml(front.content || "")}</div>`;
       if (flashcardData.front?.quoteData) {
         flashcardContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(flashcardData.front.quoteData.section || "unknown source")}</div>`;
       }
     } else {
       flashcardContent.textContent = front.content || "";
     }

// Back content
     if (back.isQuote) {
       flashcardBackContent.innerHTML = `<div class="quote">${escapeHtml(back.content || "")}</div>`;
       if (back.quoteData) {
         flashcardBackContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(back.quoteData.section || "unknown source")}</div>`;
       }
       // Show linked analyses if available
       if (back.analyses && back.analyses.length > 0) {
         flashcardBackContent.innerHTML += `<div class="linked-analyses">`;
         flashcardBackContent.innerHTML += `<div class="linked-analyses-title">Linked Analyses:</div>`;
         back.analyses.forEach(analysis => {
           flashcardBackContent.innerHTML += `<div class="linked-analysis-item">${formatAnalysisForDisplay(analysis.analysis || '')}</div>`;
         });
         flashcardBackContent.innerHTML += `</div>`;
       }
     } else if (back.isAnalysis) {
       flashcardBackContent.innerHTML = `<div class="analysis">${formatAnalysisForDisplay(back.content || "")}</div>`;
       // Show linked quotes if available
       if (back.quotes && back.quotes.length > 0) {
         flashcardBackContent.innerHTML += `<div class="linked-quotes">`;
         flashcardBackContent.innerHTML += `<div class="linked-quotes-title">Linked Quotes:</div>`;
         back.quotes.forEach(quote => {
           flashcardBackContent.innerHTML += `<div class="linked-quote-item">${escapeHtml(quote.quote)}</div>`;
           if (quote.section) {
             flashcardBackContent.innerHTML += `<div class="linked-quote-source">${escapeHtml(quote.section)}</div>`;
           }
         });
         flashcardBackContent.innerHTML += `</div>`;
       }
     } else if (back.isBlurtInput) {
       const existingText = flashcardData?.blurt?.text || "";
       flashcardBackContent.innerHTML = `
         <div class="instruction">Type your recall. When finished, submit to grade.</div>
         <textarea id="blurtInput" class="blurt-input" rows="6" placeholder="Write what you remember...">${escapeHtml(existingText)}</textarea>
         <button id="blurtSubmitBtn" class="memory-btn">Submit Recall</button>
       `;

       const input = flashcardBackContent.querySelector("#blurtInput");
       const submitBtn = flashcardBackContent.querySelector("#blurtSubmitBtn");
       if (input) {
         input.addEventListener("input", () => {
           flashcardData.blurt = flashcardData.blurt || { submitted: false, text: "" };
           flashcardData.blurt.text = input.value;
         });
       }
       if (submitBtn) {
         submitBtn.addEventListener("click", () => {
           flashcardData.blurt = flashcardData.blurt || { submitted: false, text: "" };
           flashcardData.blurt.submitted = true;
           state.session.revealedAt = Date.now();
           renderUI();
         });
       }
     } else if (back.isInstruction) {
       flashcardBackContent.innerHTML = `<div class="instruction">${escapeHtml(back.content || "")}</div>`;
     } else {
       flashcardBackContent.textContent = back.content || "";
     }

    // Update flip state
    if (flashcardElement && flashcardElement.classList) {
      flashcardElement.classList.toggle("flipped", state.isFlipped);
    }

    // Update navigation buttons
    const requiresGrade = !!flashcardData?.review?.required && !flashcardData.review.graded;
    const hasNextInHistory = state.currentIndex < state.flashcards.length - 1;
    const hasNextInHeap = !!state.session.heap && state.session.heap.size() > 0;

    if (prevBtn) prevBtn.disabled = state.currentIndex === 0 || requiresGrade;
    if (nextBtn) nextBtn.disabled = requiresGrade || (!hasNextInHistory && !hasNextInHeap);
    if (showAnalysisBtn) {
      showAnalysisBtn.style.display = 
        state.currentMode === "quote-learning" && flashcardData.back?.quoteData 
          ? "inline-block" : "none";
    }
  }

  function formatAnalysisForDisplay(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function renderEvidenceMatchingUI() {
    if (!evidencePrompt || !quoteOptions || !evidenceFeedback) return;
    if (!state.evidenceMatching.currentAnalysis) return;

    evidencePrompt.innerHTML = `<div class="analysis">${formatAnalysisForDisplay(state.evidenceMatching.currentAnalysis.analysis)}</div>`;

    quoteOptions.innerHTML = "";
    state.evidenceMatching.quoteOptions.forEach((quote, index) => {
      const isSelected = state.evidenceMatching.selectedOption === index;
      const isAnswered = state.evidenceMatching.answered;
      const isCorrect = state.evidenceMatching.correctOption?.includes(quote.id);
      
      let className = "quote-option";
      if (isSelected) className += " selected";
      if (isAnswered && isCorrect) className += " correct";
      if (isAnswered && isSelected && !isCorrect) className += " incorrect";
      
      const optionDiv = document.createElement("div");
      optionDiv.className = className;
      optionDiv.innerHTML = `
        <div class="quote-text">${escapeHtml(quote.quote)}</div>
        ${quote.section ? `<div class="quote-source">${escapeHtml(quote.section)}</div>` : ""}
      `;
      optionDiv.onclick = () => selectQuoteOption(index);
      quoteOptions.appendChild(optionDiv);
    });

    if (!state.evidenceMatching.answered) {
      evidenceFeedback.textContent = "";
      evidenceFeedback.className = "";
    }
  }

  function selectQuoteOption(index) {
    if (state.evidenceMatching.answered) return;
    state.evidenceMatching.selectedOption = index;
    renderEvidenceMatchingUI();
  }

  function checkEvidenceMatchingAnswer() {
    if (state.evidenceMatching.selectedOption === null || state.evidenceMatching.answered) return false;

    const selectedQuoteId = state.evidenceMatching.quoteOptions[state.evidenceMatching.selectedOption].id;
    const isCorrect = state.evidenceMatching.correctOption?.includes(selectedQuoteId) || false;
    state.evidenceMatching.answered = true;
    state.evidenceMatching.wasCorrect = isCorrect;

    if (evidenceFeedback) {
      if (isCorrect) {
        evidenceFeedback.textContent = "Correct! Press Next for another.";
        evidenceFeedback.className = "feedback-correct";
      } else {
        const correctQuote = state.evidenceMatching.quoteOptions.find(
          q => state.evidenceMatching.correctOption.includes(q.id)
        );
        evidenceFeedback.innerHTML = `Incorrect. The correct answer was:<br>"${escapeHtml(correctQuote?.quote || "")}"<br><br>Press Next for another.`;
        evidenceFeedback.className = "feedback-incorrect";
      }
    }

    state.stats.totalStudied++;
    if (isCorrect) {
      state.stats.correctAnswers++;
      state.stats.streak++;
      if (state.stats.streak > state.stats.bestStreak) {
        state.stats.bestStreak = state.stats.streak;
      }
    } else {
      state.stats.streak = 0;
    }

    return isCorrect;
  }

  async function moveToNextEvidenceQuestion() {
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (!analyses || analyses.length === 0) return;
    
    const currentIdx = analyses.findIndex(a => a.id === state.evidenceMatching.currentAnalysis?.id);
    const nextIdx = (currentIdx + 1) % analyses.length;
    await loadEvidenceMatchingForAnalysis(analyses[nextIdx].id);
    renderUI();
  }

  function renderStats() {
    if (!statsContent) return;
    
    statsContent.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Total Studied:</span>
        <span class="stat-value">${state.stats.totalStudied}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Correct Answers:</span>
        <span class="stat-value">${state.stats.correctAnswers}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Current Streak:</span>
        <span class="stat-value">${state.stats.streak}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Best Streak:</span>
        <span class="stat-value">${state.stats.bestStreak}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Success Rate:</span>
        <span class="stat-value">${state.stats.totalStudied > 0 ? 
          Math.round((state.stats.correctAnswers / state.stats.totalStudied) * 100) : 0}%</span>
      </div>
    `;
  }

  window.__neuronetMemoryCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleKeyDown);
  };

  await initialize();
}
