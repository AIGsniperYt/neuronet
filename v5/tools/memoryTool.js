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
    view: contextSubject ? "study" : "launchpad",
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
      suppressDBChange: 0,
      lastGradeReaction: null
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

  let memoryTool, modeSelect, newSessionBtn, statsBtn, backToDecksBtn;
  let memoryLaunchpad, deckList, keyboardHint, memoryContent;
  let flashcardContainer, flashcard, flashcardContent, flashcardBackContent;
  let gradingControls, gradeDidntKnowBtn, gradeKindaBtn, gradeEasyBtn;
  let evidenceMatchingContainer, evidencePrompt, quoteOptions, evidenceFeedback;
  let memoryStats, statsContent, closeStatsBtn, roundProgress, resetMemoryBtn;
  let systemThinkingText;
  
  function getDOMElements() {
    memoryTool = document.getElementById("memoryTool");
    modeSelect = document.getElementById("modeSelect");
    newSessionBtn = document.getElementById("newSessionBtn");
    statsBtn = document.getElementById("statsBtn");
    backToDecksBtn = document.getElementById("backToDecksBtn");
    memoryLaunchpad = document.getElementById("memoryLaunchpad");
    deckList = document.getElementById("deckList");
    keyboardHint = document.getElementById("keyboardHint");
    memoryContent = document.getElementById("memoryContent");
    flashcardContainer = document.getElementById("flashcardContainer");
    flashcard = document.getElementById("flashcard");
    flashcardContent = document.getElementById("flashcardContent");
    flashcardBackContent = document.getElementById("flashcardBackContent");


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
    roundProgress = document.getElementById("roundProgress");
    resetMemoryBtn = document.getElementById("resetMemoryBtn");
    systemThinkingText = document.getElementById("systemThinkingText");
  }

  async function initialize() {
    try {
      getDOMElements();
      await loadLaunchpad();
      if (state.currentSubject) {
        await loadFlashcards();
      }
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
    if (backToDecksBtn) {
      backToDecksBtn.addEventListener("click", async () => {
        state.view = "launchpad";
        state.currentSubject = "";
        await loadLaunchpad();
        renderUI();
      });
    }

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
      let statsInterval = null;

      const openStats = () => {
        renderStats();
        updateSystemThought();
        if (memoryStats) memoryStats.classList.add("open");
        if (!statsInterval) {
          statsInterval = setInterval(() => {
            if (memoryStats && memoryStats.classList.contains("open")) {
              renderStats();
            } else {
              clearInterval(statsInterval);
              statsInterval = null;
            }
          }, 1000);
        }
      };

      const closeStats = () => {
        if (memoryStats) memoryStats.classList.remove("open");
        clearInterval(statsInterval);
        statsInterval = null;
      };

      statsBtn.addEventListener("click", () => {
        if (memoryStats && memoryStats.classList.contains("open")) {
          closeStats();
        } else {
          openStats();
        }
      });

      if (closeStatsBtn) {
        closeStatsBtn.addEventListener("click", closeStats);
      }

      window.__neuronetStatsCleanup = () => {
        clearInterval(statsInterval);
        statsInterval = null;
      };
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

    if (resetMemoryBtn) {
      resetMemoryBtn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to reset ALL memory metadata for this subject? This cannot be undone.")) {
          await resetSubjectMemoryMetadata();
          await loadFlashcards();
          renderUI();
        }
      });
    }

    if (closeStatsBtn && !closeStatsBtn.dataset.bound) {
      // closeStats is wired up inside the statsBtn block above when statsBtn exists
      // Fallback binding if statsBtn is absent
      closeStatsBtn.dataset.bound = "1";
      closeStatsBtn.addEventListener("click", () => {
        if (memoryStats) memoryStats.classList.remove("open");
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

  async function handleKeyDown(e) {
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
        await navigateNext();
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
        await navigatePrevious();
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        await navigateNext();
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
      state.session.suppressDBChange++;
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
      state.session.suppressDBChange++;
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
    
    // Re-enqueue the card into the continuous heap with its newly calculated priority
    const nextPriority = computePriority(updatedMemoryState, nowMs);
    const recycledCard = {
      ...currentCard,
      review: { required: true, graded: false, grade: null, responseTimeMs: null },
      memoryState: updatedMemoryState
    };
    if (isBlurt) {
      recycledCard.blurt = { submitted: false, text: "" };
    }
    if (state.session.heap) {
      state.session.heap.push({ priority: nextPriority, card: recycledCard });
    }

    renderUI();
    state.session.lastGradeReaction = grade;
    // Always trigger reactive thought/impulse on grade
    updateSystemThought(grade);
    await navigateNext();
  }

  async function navigatePrevious() {
    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }
    if (state.currentIndex > 0) {
      await navigateTo(state.currentIndex - 1);
    }
  }

  async function navigateNext() {
    if (state.currentMode === "evidence-matching") {
      if (state.evidenceMatching.selectedOption !== null && !state.evidenceMatching.answered) {
        checkEvidenceMatchingAnswer();
        renderUI();
        return;
      }
      if (state.evidenceMatching.answered) {
        if (state.currentIndex < state.flashcards.length - 1) {
          await navigateTo(state.currentIndex + 1);
        } else {
          // If at end, maybe reload or show finished
          alert("Completed all evidence matching for this round!");
        }
        return;
      }
    }

    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }

    if (state.currentIndex < state.flashcards.length - 1) {
      await navigateTo(state.currentIndex + 1);
      return;
    }

    if (state.session.heap && state.session.heap.size() > 0) {
      if (flashcard) {
        flashcard.classList.add("slide-away");
        setTimeout(() => {
          drawNextCardFromHeap();
          renderUI();
          flashcard.classList.remove("slide-away");
          flashcard.classList.add("slide-in");
          setTimeout(() => {
            flashcard.classList.remove("slide-in");
          }, 250);
        }, 350);
      } else {
        drawNextCardFromHeap();
        renderUI();
      }
    }
  }

  async function navigateTo(index) {
    if (index === state.currentIndex || index < 0 || index >= state.flashcards.length) return;
    
    updateSystemThought();
    
    const direction = index > state.currentIndex ? "forward" : "back";
    
    if (flashcard) {
      const exitClass = direction === "forward" ? "slide-away" : "slide-away-back";
      const enterClass = direction === "forward" ? "slide-in" : "slide-in-back";
      
      flashcard.classList.add(exitClass);
      setTimeout(async () => {
        state.currentIndex = index;
        state.isFlipped = false;
        state.session.shownAt = Date.now();
        state.session.revealedAt = null;

        if (state.currentMode === "evidence-matching") {
          await loadEvidenceMatchingForAnalysis(state.flashcards[index].id);
        }
        
        renderUI();
        
        flashcard.classList.remove(exitClass);
        flashcard.classList.add(enterClass);
        setTimeout(() => {
          flashcard.classList.remove(enterClass);
        }, 250);
      }, 350);
    } else {
      state.currentIndex = index;
      state.isFlipped = false;
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
    if (state.session.suppressDBChange > 0) {
      state.session.suppressDBChange--;
      return;
    }
    loadFlashcards().then(renderUI);
  }

async function loadLaunchpad() {
    const subjects = await getSubjects();
    if (!deckList) return;
    
    deckList.innerHTML = "";
    if (subjects.length === 0) {
      deckList.innerHTML = `<div style="color: var(--text-muted);">No decks found. Add quotes or analyses in the Analysis Tool.</div>`;
      return;
    }
    
    for (const subject of subjects) {
      const quotes = await getQuotesForSubject(subject) || [];
      const analyses = await getAnalysisNodesForSubject(subject) || [];
      const total = quotes.length + analyses.length;
      
      const card = document.createElement("div");
      card.className = "deck-card";
      card.innerHTML = `
        <div class="deck-title">${escapeHtml(subject)}</div>
        <div class="deck-stats">${total} items</div>
      `;
      card.addEventListener("click", async () => {
        state.currentSubject = subject;
        state.view = "study";
        await loadFlashcards();
        renderUI();
      });
      deckList.appendChild(card);
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
    state.session.suppressDBChange = 0;

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
      confidence: clampNumber(Number(meta.confidence ?? 0.7), 0, 1),
      lastGrade: meta.lastGrade || null
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
      confidence: memoryState.confidence,
      lastGrade: memoryState.lastGrade
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
      confidence: confidenceOut,
      lastGrade: grade
    };
  }

  function computePriority(memoryState, nowMs) {
    let overdueDays;
    if (Number.isFinite(Number(memoryState.nextReview)) && memoryState.nextReview > 0) {
      overdueDays = (nowMs - Number(memoryState.nextReview)) / 86400000;
    } else {
      // New card - give it priority comparable to exactly due cards
      overdueDays = 0;
    }
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
    updateSystemThought();
  }

  async function buildQuoteLearningQueue() {
    const nowMs = Date.now();
    const [allQuotes, allCues] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAllCues()
    ]);

    const cuesByQuoteId = new Map();
    (allCues || [])
      .filter((c) => c?.subject === state.currentSubject && c?.quoteId)
      .forEach((cue) => {
        if (!cuesByQuoteId.has(cue.quoteId)) cuesByQuoteId.set(cue.quoteId, cue);
      });

    state.session.surprisePool = [];

    const cards = await Promise.all(
      (allQuotes || []).map(async (quote) => {
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
    const allAnalyses = await getAnalysisNodesForSubject(state.currentSubject);

    state.session.surprisePool = [];

    const cards = await Promise.all(
      (allAnalyses || []).map(async (analysis) => {
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

    let subjectCues = (allCues || []).filter((c) => c?.subject === state.currentSubject && c?.cue);

    // FALLBACK: If no explicit cues exist for this subject, generate virtual cues from quotes and analyses
    if (subjectCues.length === 0) {
      // Build a map of quoteId -> [analyses] to find cross-references
      const quoteToAnalyses = new Map();
      (analyses || []).forEach(a => {
        if (a.quoteRefs) {
          a.quoteRefs.forEach(ref => {
            if (!quoteToAnalyses.has(ref.quoteId)) quoteToAnalyses.set(ref.quoteId, []);
            quoteToAnalyses.get(ref.quoteId).push(a);
          });
        }
      });

      (quotes || []).forEach(q => {
        // For a quote, if it has a referencing analysis, use that as a hint
        const linkedAnalyses = quoteToAnalyses.get(q.id) || [];
        let cueText = q.section ? `Recall quote from: ${q.section}` : "Recall this quote";
        
        if (linkedAnalyses.length > 0) {
          const a = linkedAnalyses[0];
          const cleanA = (a.analysis || "").replace(/[#*`]/g, "").trim();
          const aSnippet = cleanA.substring(0, 80) + (cleanA.length > 80 ? "..." : "");
          cueText = `Recall quote related to analysis: "${aSnippet}"`;
        }

        subjectCues.push({
          id: `v-cue-q-${q.id}`,
          subject: state.currentSubject,
          quoteId: q.id,
          cue: cueText,
          isVirtual: true
        });
      });

      (analyses || []).forEach(a => {
        let cueText = "";
        
        // For an analysis, if it has linked quotes, use the first quote as the prompt
        if (a.quoteRefs && a.quoteRefs.length > 0) {
          const firstQuote = quotesById.get(a.quoteRefs[0].quoteId);
          if (firstQuote) {
            cueText = `Recall analysis for quote: "${firstQuote.quote.substring(0, 100)}${firstQuote.quote.length > 100 ? "..." : ""}"`;
          }
        }

        // Fallback to snippet if no linked quotes or quote not found
        if (!cueText) {
          const clean = (a.analysis || "").replace(/[#*`]/g, "").trim();
          const displayTitle = a.title || (clean.substring(0, 50) + (clean.length > 50 ? "..." : ""));
          cueText = displayTitle ? `Recall analysis: ${displayTitle}` : "Recall this analysis";
        }

        subjectCues.push({
          id: `v-cue-a-${a.id}`,
          subject: state.currentSubject,
          analysisId: a.id,
          cue: cueText,
          isVirtual: true
        });
      });
    }

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
      // Blurt is harder, so we expect more time
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
        back: { 
          isBlurtInput: true,
          targetContent: targetKind === "quote" ? targetRecord.quote : targetRecord.analysis,
          targetRecord,
          targetKind
        },
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
    
    // Create placeholders for all analyses to show in the dots
    state.flashcards = analyses.map(analysis => ({
      id: analysis.id,
      type: "evidence-matching",
      record: analysis,
      memoryState: getMemoryStateFromMeta(analysis.meta || {}, "analysis"),
      review: { required: false, graded: false }, // Evidence matching doesn't strictly grade in SRS yet
      front: { content: analysis.analysis, isAnalysis: true },
      back: { content: "Select supporting quotes", isInstruction: true }
    }));
    
    state.currentIndex = 0;
    await loadEvidenceMatchingForAnalysis(state.flashcards[0].id);
  }

  async function resetSubjectMemoryMetadata() {
    if (!state.currentSubject) return;
    
    const [quotes, analyses] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);
    
    const srsKeys = ["S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount", "expectedTime", "avgTime", "timeVariance", "consistency", "confidence", "lastGrade"];
    
    state.session.suppressDBChange = (quotes || []).length + (analyses || []).length;
    
    const promises = [];
    
    for (const quote of (quotes || [])) {
      if (quote.meta) {
        srsKeys.forEach(key => delete quote.meta[key]);
        promises.push(addQuote(quote));
      }
    }
    
    for (const analysis of (analyses || [])) {
      if (analysis.meta) {
        srsKeys.forEach(key => delete analysis.meta[key]);
        promises.push(addNode(analysis));
      }
    }
    
    await Promise.all(promises);
    console.log("Memory metadata reset successfully for subject:", state.currentSubject);
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

    const cardIndex = state.flashcards.findIndex(f => f.id === analysisId);
    const existingCard = cardIndex !== -1 ? state.flashcards[cardIndex] : null;

    const card = {
      ...(existingCard || {}),
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
    };

    if (cardIndex !== -1) {
      state.flashcards[cardIndex] = card;
    } else {
      state.flashcards.push(card);
    }
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
    
    if (state.view === "launchpad") {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "flex";
      if (memoryContent) memoryContent.style.display = "none";
      if (modeSelect) modeSelect.style.display = "none";
      if (newSessionBtn) newSessionBtn.style.display = "none";
      if (statsBtn) statsBtn.style.display = "none";
      if (backToDecksBtn) backToDecksBtn.style.display = "none";
      if (keyboardHint) keyboardHint.style.display = "none";
      return;
    } else {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "none";
      if (memoryContent) memoryContent.style.display = "flex";
      if (modeSelect) modeSelect.style.display = "inline-block";
      if (newSessionBtn) newSessionBtn.style.display = "inline-block";
      if (statsBtn) statsBtn.style.display = "inline-block";
      if (backToDecksBtn) backToDecksBtn.style.display = "inline-block";
      if (keyboardHint) keyboardHint.style.display = "block";
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
    // Don't hide stats here - it's a sidebar now

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
      
      if (shouldShowGrading) {
        gradingControls.style.display = "flex";
        // Small timeout to allow display: flex to apply before adding visible class for transition
        requestAnimationFrame(() => {
          gradingControls.classList.add("visible");
        });
      } else {
        gradingControls.classList.remove("visible");
        // Hide after transition
        setTimeout(() => {
          if (!gradingControls.classList.contains("visible")) {
            gradingControls.style.display = "none";
          }
        }, 400);
      }
    }

    if (state.currentMode === "evidence-matching") {
      renderEvidenceMatchingUI();
    }

    renderRoundProgress();
  }

  function renderRoundProgress() {
    if (!roundProgress) return;
    roundProgress.innerHTML = "";

    const roundSize = 8;
    const isHeapMode = ["analysis-learning", "blurt"].includes(state.currentMode);

    // For heap-based modes, always show: already-seen history cards + upcoming from heap
    // For quote-learning (linear), use the standard paged window
    const roundStart = isHeapMode ? 0 : Math.floor(state.currentIndex / roundSize) * roundSize;

    const upcoming = (state.session.heap && state.session.heap.items.length > 0)
      ? [...state.session.heap.items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      : [];

    // For heap modes, show the last [roundSize] cards seen + preview upcoming
    let slotCards = [];
    if (isHeapMode) {
      // Show current window: up to 8 slots, starting from max(0, currentIndex - roundSize + 1)
      const windowStart = Math.max(0, state.currentIndex - roundSize + 1);
      for (let i = windowStart; i < windowStart + roundSize; i++) {
        if (i < state.flashcards.length) {
          slotCards.push({ card: state.flashcards[i], index: i });
        } else {
          const upcomingIdx = i - state.flashcards.length;
          slotCards.push({ card: upcoming[upcomingIdx]?.card || null, index: i });
        }
      }
    } else {
      for (let i = roundStart; i < roundStart + roundSize; i++) {
        if (i < state.flashcards.length) {
          slotCards.push({ card: state.flashcards[i], index: i });
        } else {
          const upcomingIdx = i - state.flashcards.length;
          slotCards.push({ card: upcoming[upcomingIdx]?.card || null, index: i });
        }
      }
    }

    slotCards.forEach(({ card, index }) => {
      const dot = document.createElement("div");
      dot.className = "progress-dot";
      if (index === state.currentIndex) dot.classList.add("active");

      if (card && card.review) {
        let displayGrade = null;
        if (card.review.graded) {
          displayGrade = card.review.grade;
        } else if (card.memoryState && card.memoryState.lastGrade) {
          displayGrade = card.memoryState.lastGrade;
          dot.style.opacity = "0.4";
        }
        if (displayGrade === "didnt_know") dot.classList.add("grade-dk");
        else if (displayGrade === "kinda") dot.classList.add("grade-kinda");
        else if (displayGrade === "easy") dot.classList.add("grade-easy");
      }

      dot.title = card ? `Card ${index + 1}` : "Upcoming from heap";

      dot.addEventListener("click", () => {
        if (index < state.flashcards.length) navigateTo(index);
      });

      roundProgress.appendChild(dot);
    });
  }

  function updateFlashcardDisplay(flashcardData, flashcardElement) {
    if (!flashcardContent || !flashcardBackContent || !flashcardData) return;

    const front = flashcardData.front || {};
    const back = flashcardData.back || {};

// Front content
     if (front.isCue) {
       // For blurt cards pointing at a quote, render the cue more prominently
       const isBlurtQuoteCard = flashcardData.type === "blurt" && flashcardData.targetKind === "quote";
       const isBlurtAnalysisCard = flashcardData.type === "blurt" && flashcardData.targetKind === "analysis";
       if (isBlurtQuoteCard) {
         flashcardContent.innerHTML = `
           <div class="blurt-prompt-label">Recall the quote:</div>
           <div class="cue">${escapeHtml(front.content || "")}</div>
         `;
       } else if (isBlurtAnalysisCard) {
         flashcardContent.innerHTML = `
           <div class="blurt-prompt-label">Recall the analysis:</div>
           <div class="cue">${escapeHtml(front.content || "")}</div>
         `;
       } else {
         flashcardContent.innerHTML = `<div class="cue">${escapeHtml(front.content || "")}</div>`;
       }
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

// Back content - Only populate if flipped to prevent spoiling the next card during transitions
    if (state.isFlipped) {
      if (back.isQuote) {
        flashcardBackContent.innerHTML = `<div class="quote">${escapeHtml(back.content || "")}</div>`;
        if (back.quoteData) {
          flashcardBackContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(back.quoteData.section || "unknown source")}</div>`;
        }
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
        if (!flashcardData.blurt?.submitted) {
          const existingText = flashcardData?.blurt?.text || "";
          flashcardBackContent.innerHTML = `
            <div class="instruction">Type your recall. When finished, submit to grade.</div>
            <textarea id="blurtInput" class="blurt-input" rows="6" placeholder="Write what you remember...">${escapeHtml(existingText)}</textarea>
            <button id="blurtSubmitBtn" class="memory-btn">Submit Recall</button>
          `;

          const input = flashcardBackContent.querySelector("#blurtInput");
          const submitBtn = flashcardBackContent.querySelector("#blurtSubmitBtn");
          if (input) {
            input.focus();
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
        } else {
          // Show comparison
          const userText = flashcardData.blurt?.text || "";
          const targetText = back.targetContent || "";
          const isQuoteTarget = back.targetKind === "quote";
          const formattedTarget = isQuoteTarget
            ? `<div class="quote">${escapeHtml(targetText)}</div>${back.targetRecord?.section ? `<div class="quote-meta">From: ${escapeHtml(back.targetRecord.section)}</div>` : ""}`
            : `<div class="analysis">${formatAnalysisForDisplay(targetText)}</div>`;
          flashcardBackContent.innerHTML = `
            <div class="blurt-comparison">
              <div class="blurt-user-section">
                <div class="blurt-label">Your Recall:</div>
                <div class="blurt-text">${escapeHtml(userText) || '<i style="color:var(--text-muted)">Nothing entered</i>'}</div>
              </div>
              <div class="blurt-target-section">
                <div class="blurt-label">${isQuoteTarget ? "The Quote:" : "The Analysis:"}</div>
                <div class="blurt-text">${formattedTarget}</div>
              </div>
            </div>
            <div class="instruction">Grade your recall based on accuracy.</div>
          `;
        }
      } else if (back.isInstruction) {
        flashcardBackContent.innerHTML = `<div class="instruction">${escapeHtml(back.content || "")}</div>`;
      } else {
        flashcardBackContent.textContent = back.content || "";
      }
    } else {
      // Clear back content when not flipped to ensure no spoilers during animations
      flashcardBackContent.innerHTML = "";
    }

    // Update flip state
    if (flashcardElement && flashcardElement.classList) {
      flashcardElement.classList.toggle("flipped", state.isFlipped);
    }

    // Update navigation buttons
    const requiresGrade = !!flashcardData?.review?.required && !flashcardData.review.graded;
    const hasNextInHistory = state.currentIndex < state.flashcards.length - 1;
    const hasNextInHeap = !!state.session.heap && state.session.heap.size() > 0;


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

    const nowMs = Date.now();
    const heapItems = state.session.heap?.items
      ? [...state.session.heap.items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      : [];

    const gradeIcon = g => g === "easy" ? "🟢" : g === "kinda" ? "🟡" : g === "didnt_know" ? "🔴" : "⚪";
    const fmtInterval = ms => {
      if (!ms) return "–";
      const days = Math.round(ms / 86400000);
      return days < 1 ? "<1d" : `${days}d`;
    };
    const fmtDate = ms => ms ? new Date(ms).toLocaleDateString() : "never";
    const fmtPriority = p => typeof p === "number" ? p.toFixed(2) : "–";

    const cardLabel = (card) => {
      if (!card) return "?";
      if (card.type === "blurt") return (card.cue?.cue || "Blurt").substring(0, 60);
      if (card.type === "analysis-learning") return ((card.record?.analysis || "").replace(/[#*`]/g,"").trim().substring(0, 60) + "...");
      return ((card?.record?.quote || card?.front?.content || "?").substring(0, 60) + "...");
    };

    const renderCardRow = (card, priority, rank, isCurrent = false) => {
      const ms = card?.memoryState || {};
      const label = cardLabel(card);
      const due = ms.nextReview ? fmtDate(ms.nextReview) : "new";
      const grade = gradeIcon(ms.lastGrade);
      return `
        <div class="heap-item${isCurrent ? " heap-item-current" : ""}">
          <div class="heap-item-rank">${isCurrent ? "▶" : `#${rank}`}</div>
          <div class="heap-item-body">
            <div class="heap-item-label">${escapeHtml(label)}${isCurrent ? " <span class=\"heap-current-tag\">on screen</span>" : ""}</div>
            <div class="heap-item-meta">
              <span title="Priority">⬆ ${fmtPriority(priority)}</span>
              <span title="Next review">📅 ${due}</span>
              <span title="Interval">⏱ ${fmtInterval((ms.interval || 0) * 86400000)}</span>
              <span title="Last grade">${grade} ${ms.lastGrade || "new"}</span>
              <span title="Reviews">✓ ${ms.reviewCount || 0}x</span>
            </div>
          </div>
        </div>`;
    };

    const currentCard = state.flashcards[state.currentIndex];
    const currentPriority = currentCard ? computePriority(currentCard.memoryState || {}, nowMs) : null;
    const currentCardHTML = currentCard
      ? renderCardRow(currentCard, currentPriority, 0, true)
      : "";

    const heapHTML = heapItems.length === 0 && !currentCard
      ? `<div style="color:var(--text-muted);padding:12px 0;">Heap is empty — all cards are in history.</div>`
      : currentCardHTML + heapItems.map((item, i) => renderCardRow(item.card, item.priority, i + 1, false)).join("");

    statsContent.innerHTML = `
      <div class="stats-grid">
        <div class="stat-item"><span class="stat-label">Studied</span><span class="stat-value">${state.stats.totalStudied}</span></div>
        <div class="stat-item"><span class="stat-label">Correct</span><span class="stat-value">${state.stats.correctAnswers}</span></div>
        <div class="stat-item"><span class="stat-label">Streak</span><span class="stat-value">${state.stats.streak}</span></div>
        <div class="stat-item"><span class="stat-label">Best</span><span class="stat-value">${state.stats.bestStreak}</span></div>
        <div class="stat-item"><span class="stat-label">Accuracy</span><span class="stat-value">${state.stats.totalStudied > 0 ? Math.round((state.stats.correctAnswers / state.stats.totalStudied) * 100) : 0}%</span></div>
      </div>
      <div class="heap-section">
        <div class="heap-section-title">Heap Queue (${heapItems.length} cards)</div>
        <div class="heap-list">${heapHTML}</div>
      </div>
    `;
  }

  // ─── System Thinking Panel ───────────────────────────────────────────────

  let _typewriterTimer = null;
  let _lastThoughtMsg = "";

  function generateSystemThought(manualGrade = null) {
    const lastGrade = manualGrade || state.session.lastGradeReaction;
    // Consume the grade reaction so it doesn't repeat on unrelated refreshes
    state.session.lastGradeReaction = null;

    const card = state.flashcards[state.currentIndex];
    const ms = card?.memoryState || {};
    const heapSize = (state.session.heap?.items?.length || 0);
    const reviewCount = ms.reviewCount || 0;
    const U = ms.U ?? 0.5;
    const S = ms.S ?? 1;
    const D = ms.D ?? 1;
    const interval = ms.interval || 0;
    const mode = state.currentMode;
    const isNew = reviewCount === 0;

    // Build a pool of contextual messages based on state
    const pool = [];

    // --- Post-grade reactions ---
    if (lastGrade === "easy") {
      pool.push("Strong recall. Stability increased — scheduling this further out.");
      pool.push("Memory trace consolidated. Interval extended based on response time.");
      pool.push(`Confidence rising. Next review in ~${Math.round(interval)} day${interval !== 1 ? "s" : ""}.`);
      if (U < 0.3) pool.push("Low uncertainty detected. This item is well anchored.");
    } else if (lastGrade === "kinda") {
      pool.push("Partial recall. Interval kept short to reinforce the trace.");
      pool.push("Uncertainty remains. This card will resurface sooner than average.");
      pool.push("Consolidation incomplete — scheduling a prompt review.");
    } else if (lastGrade === "didnt_know") {
      pool.push("Recall failed. Difficulty increased, stability reset. Prioritising this card.");
      pool.push("Memory gap detected. This item returns to the top of the queue.");
      pool.push("High uncertainty. Spaced repetition will retry this shortly.");
    }

    // --- Card state observations ---
    if (isNew) {
      pool.push("First encounter. Baseline memory state initialised.");
      pool.push("New item. No prior review data — using default SRS parameters.");
    } else if (reviewCount === 1) {
      pool.push("Second review. Building early stability from the first pass.");
    } else if (reviewCount >= 10) {
      pool.push(`Mature memory. ${reviewCount} reviews logged — long-term retention forming.`);
    } else if (reviewCount >= 5) {
      pool.push(`${reviewCount} reviews in. Stability trend is ${S > 2 ? "positive" : "developing"}.`);
    }

    // --- Uncertainty / difficulty insights ---
    if (U > 0.75) {
      pool.push("Uncertainty is high — this card has inconsistent recall patterns.");
    } else if (U < 0.2 && reviewCount > 3) {
      pool.push("Uncertainty is very low. This item is well-established in long-term memory.");
    }
    if (D > 3) {
      pool.push("Difficulty signal is elevated. This may need more frequent reinforcement.");
    } else if (D < 0.5 && reviewCount > 2) {
      pool.push("Low difficulty score. The algorithm is easing the schedule for this item.");
    }

    // --- Heap / session observations ---
    if (heapSize === 0 && state.flashcards.length > 0) {
      pool.push("Heap is empty — all items are in session history.");
    } else if (heapSize > 10) {
      pool.push(`${heapSize} items queued. Prioritising highest-urgency cards first.`);
    }
    if (state.stats.streak >= 5) {
      pool.push(`${state.stats.streak}-card streak. Recall quality is strong this session.`);
    }
    if (state.stats.totalStudied > 0 && state.stats.correctAnswers / state.stats.totalStudied < 0.4) {
      pool.push("Session accuracy is low. Consider shorter intervals or a review break.");
    }

    // --- Mode-specific ---
    if (mode === "blurt") {
      pool.push("Blurt mode active. Free recall is the strongest consolidation method.");
      pool.push("Active retrieval engaged — the effort itself strengthens the memory trace.");
    } else if (mode === "evidence-matching") {
      pool.push("Evidence matching active. Testing associative linkage between ideas.");
    } else if (mode === "analysis-learning") {
      pool.push("Analysis mode. Tracking conceptual memory separate from quote recall.");
    }

    // --- Fallback ---
    if (pool.length === 0) {
      pool.push("Monitoring memory state. Heap sorted by urgency score.");
      pool.push("SRS algorithm running. Cards scheduled by stability and difficulty.");
    }

    // Pick randomly, avoid repeating the last message
    let candidates = pool.filter(m => m !== _lastThoughtMsg);
    if (candidates.length === 0) candidates = pool;
    let msg = candidates[Math.floor(Math.random() * candidates.length)];
    
    // If we had a grade reaction, potentially combine it with an observation for a 'smart' synthesis
    if (lastGrade && pool.length > 1) {
      const observation = pool.filter(m => !m.includes("recall") && !m.includes("Grade") && !m.includes("Trace") && !m.includes("Stability"))[0];
      if (observation && Math.random() > 0.5) {
        msg = `${msg} ${observation}`;
      }
    }

    _lastThoughtMsg = msg;
    return msg;
  }

  function typewriteThought(text) {
    if (!systemThinkingText) return;
    clearTimeout(_typewriterTimer);
    systemThinkingText.innerHTML = '<span class="cursor"></span>';
    let i = 0;
    const cursor = systemThinkingText.querySelector(".cursor");

    const tick = () => {
      if (i >= text.length) {
        if (cursor) cursor.remove();
        systemThinkingText.innerHTML = text;
        return;
      }
      const chunk = text.slice(0, i + 1);
      systemThinkingText.innerHTML = `${chunk}<span class="cursor"></span>`;
      i++;
      // Faster, 'alien' speed
      const delay = 5 + Math.random() * 8;
      _typewriterTimer = setTimeout(tick, delay);
    };
    tick();
  }

  function updateSystemThought(lastGrade = null) {
    const thought = generateSystemThought(lastGrade);
    typewriteThought(thought);

    // Trigger reactive background canvas impulses
    if (window.__neuronetCanvas) {
      // Update background "buzz" based on streak - brain on fire!
      const baseBuzz = 0.004;
      const streakIntensity = (state.stats.streak || 0) * 0.0015;
      window.__neuronetCanvas.setBuzz(Math.min(baseBuzz + streakIntensity, 0.04));

      if (lastGrade === "easy") {
        const streakBonus = Math.min((state.stats.streak || 0) * 0.2, 2.0);
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        
        // Choose ONE prominent impulse type appropriately
        if (state.stats.streak > 0 && state.stats.streak % 5 === 0) {
          // Milestone reward
          window.__neuronetCanvas.triggerVerticalWave(1.8 + streakBonus);
        } else if (Math.random() > 0.5) {
          window.__neuronetCanvas.triggerRadialPulse(cx, cy, 2.2 + streakBonus);
        } else {
          window.__neuronetCanvas.triggerSweep(1.4 + streakBonus);
        }
      } else if (lastGrade === "didnt_know") {
        // Failed recall - "confused" random node firings
        window.__neuronetCanvas.triggerRandomNodes(15, 0.7);
        // Reset buzz on mistake
        window.__neuronetCanvas.setBuzz(baseBuzz);
      } else if (lastGrade === "kinda") {
        // In-between - radial pulse from center
        window.__neuronetCanvas.triggerRadialPulse(window.innerWidth / 2, window.innerHeight / 2, 1.3);
      } else if (lastGrade === null) {
        // General observation / new card - subtle random nodes
        window.__neuronetCanvas.triggerRandomNodes(3, 0.4);
      }
    }
  }

  window.__neuronetMemoryCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleKeyDown);
    if (window.__neuronetStatsCleanup) window.__neuronetStatsCleanup();
  };

  await initialize();
}
