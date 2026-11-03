import { dialog } from "./dialog.js";
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
    addCue,
    addSubject,
    getQuotesReferencedByAnalysis,
    getAnalysesReferencingQuote,
    getCuesForQuote,
    getCuesForSubject,
    deleteCue,
    deleteQuote,
    renameSubject,
    getNode,
    getNodeTimestamp,
    getCue,
    getQuote,
    getSubjects,
    getFormattedQuote,
    resolveQuoteInSource,
    escapeHtml,
    addCard,
    addCards,
    getAllCards,
    getCard,
    getCardsForDeck,
    getCardsForDeckId,
    getCardsForQuote,
    deleteCard,
    addDeck,
    getAllDecks,
    getDeck,
    getDecksForSubject,
    deleteDeckRecord,
    deleteDeck,
    sortDecksByCreated,
    buildDeckForest,
    flattenDeckTree,
    getDeckDescendantIds,
    groupDecksBySubject,
    getDeckPath,
    describeDeckDeletion,
    UNSORTED_DECK_NAME,
    addHeap,
    getAllHeaps,
    getHeap,
    deleteHeap
  } = deps;

  const { subject: contextSubject, cardId: contextCardId, heapId: contextHeapId, createDeck, quickAdd } = context;

  const SIDEBAR_MODES = {
    FOCUS: "focus",
    ROUTER: "router",
    INSPECT: "inspect"
  };

  const ROUTER_DEBUG_MAX_STEPS = 20;

  if (typeof window.__neuronetMemoryCleanup === "function") {
    window.__neuronetMemoryCleanup();
  }

  function getDefaultUserLearningProfile() {
    return {
      learningSpeedFactor: 1,
      retentionCurveSlope: 1,
      noiseTolerance: 0.65,
      stabilityGainRate: 1,
      forgettingResistance: 1,
      optimalRepetitionRange: [3, 5],
      expectedTrialsToMastery: 5,
      heapSensitivity: 1,
      baseRetentionStrength: 1,
      phaseThresholds: {
        warmingReviews: 2,
        stabilisingReviews: 5,
        stableUncertainty: 0.32,
        masteredStability: 8,
        masteredEasyStreak: 3
      },
      phaseDistributionHistory: {},
      updatedAt: Date.now()
    };
  }

  function loadUserLearningProfile() {
    const defaults = getDefaultUserLearningProfile();
    try {
      const raw = window.localStorage?.getItem("neuronet:userLearningProfile");
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return normalizeUserLearningProfile(parsed, defaults);
    } catch (error) {
      console.warn("Failed to load NeuroNet learning profile:", error);
      return defaults;
    }
  }

  function normalizeUserLearningProfile(profile = {}, defaults = getDefaultUserLearningProfile()) {
    const merged = {
      ...defaults,
      ...profile,
      phaseThresholds: {
        ...defaults.phaseThresholds,
        ...(profile.phaseThresholds || {})
      },
      phaseDistributionHistory: {
        ...defaults.phaseDistributionHistory,
        ...(profile.phaseDistributionHistory || {})
      }
    };
    merged.learningSpeedFactor = clampNumber(Number(merged.learningSpeedFactor), 0.45, 1.8);
    merged.retentionCurveSlope = clampNumber(Number(merged.retentionCurveSlope), 0.5, 1.8);
    merged.noiseTolerance = clampNumber(Number(merged.noiseTolerance), 0.25, 0.95);
    merged.stabilityGainRate = clampNumber(Number(merged.stabilityGainRate), 0.5, 1.8);
    merged.forgettingResistance = clampNumber(Number(merged.forgettingResistance), 0.5, 1.8);
    merged.expectedTrialsToMastery = clampNumber(Number(merged.expectedTrialsToMastery), 2, 12);
    merged.heapSensitivity = clampNumber(Number(merged.heapSensitivity), 0.45, 1.8);
    merged.baseRetentionStrength = clampNumber(Number(merged.baseRetentionStrength), 0.5, 2);
    if (!Array.isArray(merged.optimalRepetitionRange)) {
      merged.optimalRepetitionRange = defaults.optimalRepetitionRange;
    }
    merged.optimalRepetitionRange = [
      clampNumber(Number(merged.optimalRepetitionRange[0]), 2, 8),
      clampNumber(Number(merged.optimalRepetitionRange[1]), 3, 14)
    ];
    if (merged.optimalRepetitionRange[1] < merged.optimalRepetitionRange[0]) {
      merged.optimalRepetitionRange[1] = merged.optimalRepetitionRange[0] + 1;
    }
    return merged;
  }

  function saveUserLearningProfile(profile) {
    try {
      window.localStorage?.setItem("neuronet:userLearningProfile", JSON.stringify(profile));
    } catch (error) {
      console.warn("Failed to save NeuroNet learning profile:", error);
    }
  }

  const state = {
    view: contextSubject ? "study" : "launchpad",
    currentSubject: contextSubject || "",
    // A deck is a folder inside a subject. Empty means "whole subject", which
    // is how legacy subject-level study still behaves.
    currentDeckId: "",
    currentDeckName: "",
    directCardsOnly: false,
    deckSortDirection: "desc",
    deckSearch: "",
    currentMode: "card-learning",
    // Manual heaps are named, ordered card-ID lists. They are independent of
    // the SRS session heap in state.session.heap.
    manualHeaps: [],
    manualHeapId: String(contextHeapId || "").trim() || "",
    flashcards: [], // session history (cards shown)
    currentIndex: 0,
    isFlipped: false,
    showAnalysis: false,
    editMode: false,
    session: {
      heap: null,
      surprisePool: [],
      shownAt: null,
      revealedAt: null,
      suppressDBChange: 0,
      lastGradeReaction: null,
      weightCache: new Map(),
      learningMode: "global_srs",
      learningRoute: null,
      systemState: null,
      routeRerouteCounter: 0,
      focusedBlockKeys: new Set()
    },
    userProfile: loadUserLearningProfile(),
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
    },
    // Middle UI state
    sessionFilter: null,
    selectedPriorities: [],
    selectedTags: [],
    selectedLayers: [],
    filterMode: "AND", // "AND" | "OR"
    // Middle UI data cache
    middleUIData: {
      priorities: [],
      tags: [],
      layers: []
    },
    // Sidebar mode system
    sidebarMode: SIDEBAR_MODES.FOCUS,
    inspectedCardId: null,
    inspectContextToken: 0,
    routerDebug: {
      startType: null,
      heapSize: 0,
      earlyPhaseRatio: 0,
      selectedRoute: null,
      avgUncertainty: 0,
      modeSwitchFrequency: 0,
      reasoningSteps: [],
      explanation: ""
    }
  };

  // ========== DECK SCOPE HELPERS ==========
  //
  // Cards live in exactly one deck (`card.deckId`) and that deck belongs to one
  // subject (`card.deck`). Any surface that reads "the current study scope"
  // goes through `loadScopedCards`, so deck study, filters, and stats
  // cannot drift apart.

  async function loadScopedCards() {
    if (!state.currentDeckId) {
      return (await getCardsForDeck(state.currentSubject)) || [];
    }
    const [allCards, decks] = await Promise.all([getAllCards(), getAllDecks()]);
    const scopeIds = new Set(
      state.directCardsOnly
        ? [state.currentDeckId]
        : getDeckDescendantIds(decks, state.currentDeckId)
    );
    return (allCards || []).filter((card) => (
      scopeIds.has(String(card.deckId || ""))
      || (!card.deckId && card.deck === state.currentSubject)
    ));
  }

  function deckLabel(deck, decks = []) {
    if (!deck) return "";
    const path = getDeckPath(decks, deck.id);
    const subject = String(deck.subject || "").trim();
    const name = path.length ? path.join(" / ") : String(deck.name || "");
    return subject ? `${subject} / ${name}` : name;
  }

  function setDeckScope(deck) {
    if (!deck) {
      state.currentDeckId = "";
      state.currentDeckName = "";
      state.directCardsOnly = false;
      return;
    }
    state.currentSubject = String(deck.subject || "").trim();
    state.currentDeckId = String(deck.id || "");
    state.currentDeckName = String(deck.name || "");
    state.directCardsOnly = false;
  }

  function clearDeckScope() {
    state.currentDeckId = "";
    state.currentDeckName = "";
    state.directCardsOnly = false;
  }

  let memoryTool, newSessionBtn, statsBtn, backToDecksBtn, deckSearchInput, deckSortBtn;
  let memoryLaunchpad, deckList, memoryContent, editDecksBtn, manualHeapsBtn;
  let manualHeapPanel, manualHeapList, manualNewHeapBtn, manualOpenLibraryBtn, manualStudyHeapBtn;
  let flashcardContainer, flashcard, flashcardContent, flashcardBackContent;
  let gradingControls, gradeDidntKnowBtn, gradeKindaBtn, gradeEasyBtn, priorityControls, priorityToggle;
  let evidenceMatchingContainer, evidencePrompt, quoteOptions, evidenceFeedback;
  let memoryStats, statsContent, closeStatsBtn, roundProgress, resetMemoryBtn;
  let memoryBody;
  let systemThinkingText;
  // Deck builder elements
  let deckBuilderModal, deckNameInput, deckSubjectInput, deckSubjectOptions, deckParentHint, deckDescriptionInput, deckCardTags, createDeckBtn, closeDeckBuilderBtn;
  let deckDeleteModal, deckDeleteSummary, deckDeleteMoveHint, deckDeleteSubtreeHint;
  let closeDeckDeleteBtn, cancelDeckDeleteBtn, confirmDeckDeleteBtn;
  let deckDeleteTargetId = "";
  let step1DeckInfo, step2Flashcards, step3Success;
  let cueInput, quoteInput, priorityPills, saveCardBtn, cancelCardBtn, clearFormBtn, deleteCardBtn;
  let nextToDeckBtn, addNewCardBtn, backToDeckInfoBtn, finishDeckBtn;
  let studyNewDeckBtn, backToLaunchpadBtn, flashcardList;
  let deckNameDisplay, cardCountDisplay, builderTitle;
    // New: layer rows, import, export, mass edit
   let importToggleBtn, ankiImportInput, processImportBtn, cancelImportBtn, importFeedback;
   let exportBtn;
   let massEditBtn, massEditContainer, massEditCards, massEditCancelBtn, massEditSaveBtn;
  // Quick Add elements
  let quickAddModal, quickAddOverlay, closeQuickAddBtn, quickAddDeckInput, quickAddDeckOptions;
  let quickAddSingleView, quickAddBulkView, quickAddFront, quickAddBack, quickAddPriorityPills;
  let quickAddTags, quickAddStatus, quickAddSaveCloseBtn, quickAddSaveNextBtn;
  let quickAddBulkInput, quickAddBulkStatus, quickAddBulkImportBtn, quickAddBulkConfidence, quickAddLaunchBtn, quickAddHeaderBtn;
  // Temporary card peek
  let cardPeekModal, closeCardPeekBtn, cardPeekOverlay, cardPeekSubject, cardPeekFront, cardPeekBack, cardPeekBackSection;
  // Middle UI elements
  let middleUI, middleHeader, middleBackBtn, middleSubjectName, middleStudyBtn, deckScopeToggle;
  let middleModeSelector, andFilterBtn, orFilterBtn, filterModeHint;
  let prioritySection, priorityCheckboxes, tagsSection, tagsCheckboxes, layersSection, layersCheckboxes;
  let cardCount;

  // Deck builder state
  const deckBuilderState = {
    // The builder edits cards directly. `front`/`back` are the only content
    // fields; legacy quote/cue records are never created or rewritten here.
    cards: [], // Array of {cardId, front, back, priority, tags, isExisting}
    deckName: "",
    deckSubject: "",
    parentId: null,
    editingDeckId: null,
    deckDescription: "",
    currentCardIndex: -1,
    isEditingCard: false,
    deletedCardIds: [], // Track deleted card IDs for editing
    isMassEditMode: false, // Track if we're in mass edit mode
    massEditData: null // Deep copy of cards for mass edit
  };

  // Quick Add: card-first capture that persists each card immediately. It
  // writes only the card store, so it is usable for any subject.
  const quickAddState = {
    isOpen: false,
    saving: false,
    activeTab: "single",
    priority: 3,
    lastDeck: "",
    lastDeckId: "",
    deckTargets: new Map(),
    savedCount: 0,
    nextOrders: new Map()
  };

  function getDOMElements() {
    memoryTool = document.getElementById("memoryTool");
    newSessionBtn = document.getElementById("newSessionBtn");
    statsBtn = document.getElementById("statsBtn");
    backToDecksBtn = document.getElementById("backToDecksBtn");
    deckSearchInput = document.getElementById("deckSearchInput");
    deckSortBtn = document.getElementById("deckSortBtn");
    memoryLaunchpad = document.getElementById("memoryLaunchpad");
    deckList = document.getElementById("deckList");
    memoryContent = document.getElementById("memoryContent");
    flashcardContainer = document.getElementById("flashcardContainer");
    flashcard = document.getElementById("flashcard");
    flashcardContent = document.getElementById("flashcardContent");
    flashcardBackContent = document.getElementById("flashcardBackContent");

    gradingControls = document.getElementById("gradingControls");
    gradeDidntKnowBtn = document.getElementById("gradeDidntKnowBtn");
    gradeKindaBtn = document.getElementById("gradeKindaBtn");
    gradeEasyBtn = document.getElementById("gradeEasyBtn");
    priorityControls = document.getElementById("priorityControls");
    priorityToggle = document.getElementById("priorityToggle");
    evidenceMatchingContainer = document.getElementById("evidenceMatchingContainer");
    evidencePrompt = document.getElementById("evidencePrompt");
    quoteOptions = document.getElementById("quoteOptions");
    evidenceFeedback = document.getElementById("evidenceFeedback");
    memoryStats = document.getElementById("memoryStats");
    memoryBody = document.getElementById("memoryBody");
    statsContent = document.getElementById("statsContent");
    closeStatsBtn = document.getElementById("closeStatsBtn");
    roundProgress = document.getElementById("roundProgress");
    resetMemoryBtn = document.getElementById("resetMemoryBtn");
    systemThinkingText = document.getElementById("systemThinkingText");

    // Deck builder elements
    deckBuilderModal = document.getElementById("deckBuilderModal");
    deckNameInput = document.getElementById("deckNameInput");
    deckSubjectInput = document.getElementById("deckSubjectInput");
    deckSubjectOptions = document.getElementById("deckSubjectOptions");
    deckParentHint = document.getElementById("deckParentHint");
    deckDescriptionInput = document.getElementById("deckDescriptionInput");
    deckCardTags = document.getElementById("deckCardTags");
    createDeckBtn = document.getElementById("createDeckBtn");
    editDecksBtn = document.getElementById("editDecksBtn");
    manualHeapsBtn = document.getElementById("manualHeapsBtn");
    closeDeckBuilderBtn = document.getElementById("closeDeckBuilderBtn");
    step1DeckInfo = document.getElementById("step1-deckInfo");
    step2Flashcards = document.getElementById("step2-flashcards");
    step3Success = document.getElementById("step3-success");
    cueInput = document.getElementById("cueInput");
    quoteInput = document.getElementById("quoteInput");
    priorityPills = document.getElementById("priorityPills");
    saveCardBtn = document.getElementById("saveCardBtn");
    cancelCardBtn = document.getElementById("cancelCardBtn");
    clearFormBtn = document.getElementById("clearFormBtn");
    deleteCardBtn = document.getElementById("deleteCardBtn");
    nextToDeckBtn = document.getElementById("nextToDeckBtn");
    addNewCardBtn = document.getElementById("addNewCardBtn");
    backToDeckInfoBtn = document.getElementById("backToDeckInfoBtn");
    finishDeckBtn = document.getElementById("finishDeckBtn");
    studyNewDeckBtn = document.getElementById("studyNewDeckBtn");
    backToLaunchpadBtn = document.getElementById("backToLaunchpadBtn");
    flashcardList = document.getElementById("flashcardList");
    deckNameDisplay = document.getElementById("deckNameDisplay");
    cardCountDisplay = document.getElementById("cardCountDisplay");
    builderTitle = document.getElementById("builderTitle");
    // Deck delete modal
    deckDeleteModal = document.getElementById("deckDeleteModal");
    deckDeleteSummary = document.getElementById("deckDeleteSummary");
    deckDeleteMoveHint = document.getElementById("deckDeleteMoveHint");
    deckDeleteSubtreeHint = document.getElementById("deckDeleteSubtreeHint");
    closeDeckDeleteBtn = document.getElementById("closeDeckDeleteBtn");
    cancelDeckDeleteBtn = document.getElementById("cancelDeckDeleteBtn");
    confirmDeckDeleteBtn = document.getElementById("confirmDeckDeleteBtn");
    // Layer row elements (dynamically rendered, accessed via getElementById in render functions)
    // Import elements
    importToggleBtn = document.getElementById("importToggleBtn");
    ankiImportInput = document.getElementById("ankiImportInput");
    processImportBtn = document.getElementById("processImportBtn");
    cancelImportBtn = document.getElementById("cancelImportBtn");
    importFeedback = document.getElementById("importFeedback");

    // Export element
    exportBtn = document.getElementById("exportBtn");

    // Mass Edit elements
    massEditBtn = document.getElementById("massEditBtn");
    massEditContainer = document.getElementById("massEditContainer");
    massEditCards = document.getElementById("massEditCards");
    massEditCancelBtn = document.getElementById("massEditCancelBtn");
    massEditSaveBtn = document.getElementById("massEditSaveBtn");
    // Layer row elements
    // (dynamically rendered, accessed via getElementById in render functions)
    // Card count display
    cardCount = document.getElementById("cardCount");

    // Quick Add elements
    quickAddModal = document.getElementById("quickAddModal");
    quickAddOverlay = document.getElementById("quickAddOverlay");
    closeQuickAddBtn = document.getElementById("closeQuickAddBtn");
    quickAddDeckInput = document.getElementById("quickAddDeckInput");
    quickAddDeckOptions = document.getElementById("quickAddDeckOptions");
    quickAddSingleView = document.getElementById("quickAddSingleView");
    quickAddBulkView = document.getElementById("quickAddBulkView");
    quickAddFront = document.getElementById("quickAddFront");
    quickAddBack = document.getElementById("quickAddBack");
    quickAddPriorityPills = document.getElementById("quickAddPriorityPills");
    quickAddTags = document.getElementById("quickAddTags");
    quickAddStatus = document.getElementById("quickAddStatus");
    quickAddSaveCloseBtn = document.getElementById("quickAddSaveCloseBtn");
    quickAddSaveNextBtn = document.getElementById("quickAddSaveNextBtn");
    quickAddBulkInput = document.getElementById("quickAddBulkInput");
    quickAddBulkStatus = document.getElementById("quickAddBulkStatus");
    quickAddBulkImportBtn = document.getElementById("quickAddBulkImportBtn");
    quickAddBulkConfidence = document.getElementById("quickAddBulkConfidence");
    quickAddLaunchBtn = document.getElementById("quickAddLaunchBtn");
    quickAddHeaderBtn = document.getElementById("quickAddHeaderBtn");
    // Temporary card peek
    cardPeekModal = document.getElementById("cardPeekModal");
    cardPeekOverlay = document.getElementById("cardPeekOverlay");
    closeCardPeekBtn = document.getElementById("closeCardPeekBtn");
    cardPeekSubject = document.getElementById("cardPeekSubject");
    cardPeekFront = document.getElementById("cardPeekFront");
    cardPeekBack = document.getElementById("cardPeekBack");
    cardPeekBackSection = document.getElementById("cardPeekBackSection");

    // Middle UI elements
    middleUI = document.getElementById("middleUI");
    middleHeader = document.getElementById("middleHeader");
    middleBackBtn = document.getElementById("middleBackBtn");
    middleSubjectName = document.getElementById("middleSubjectName");
    middleStudyBtn = document.getElementById("middleStudyBtn");
    deckScopeToggle = document.getElementById("deckScopeToggle");
    middleModeSelector = document.getElementById("middleModeSelector");
    andFilterBtn = document.getElementById("andFilterBtn");
    orFilterBtn = document.getElementById("orFilterBtn");
    filterModeHint = document.getElementById("filterModeHint");
    prioritySection = document.getElementById("prioritySection");
    priorityCheckboxes = document.getElementById("priorityCheckboxes");
    tagsSection = document.getElementById("tagsSection");
    tagsCheckboxes = document.getElementById("tagsCheckboxes");
    layersSection = document.getElementById("layersSection");
    layersCheckboxes = document.getElementById("layersCheckboxes");
    manualHeapPanel = document.getElementById("manualHeapPanel");
    manualHeapList = document.getElementById("manualHeapList");
    manualNewHeapBtn = document.getElementById("manualNewHeapBtn");
    manualOpenLibraryBtn = document.getElementById("manualOpenLibraryBtn");
    manualStudyHeapBtn = document.getElementById("manualStudyHeapBtn");
  }

  let activeModal = null;
  let lastModalFocus = null;
  // Heap rows hold ids only. This cache keeps the exact card object from the
  // render the row came from, so a peek still works if the queue shifts.
  const peekCardCache = new Map();
  let peekTriggerEl = null;

  function setStatsOpen(open) {
    if (!memoryStats) return;
    memoryStats.classList.toggle("open", !!open);
    memoryStats.toggleAttribute("inert", !open);
    memoryStats.setAttribute("aria-hidden", String(!open));
  }

  function setBackgroundInert(isInert) {
    for (const id of ["mainContent", "sidebar"]) {
      const el = document.getElementById(id);
      if (el) el.toggleAttribute("inert", isInert);
    }
  }

  function showModal(modalEl) {
    if (!modalEl) return;
    if (!activeModal) lastModalFocus = document.activeElement;
    activeModal = modalEl;
    modalEl.style.display = "flex";
    modalEl.removeAttribute("inert");
    modalEl.setAttribute("aria-hidden", "false");
    setBackgroundInert(true);
  }

  function hideModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = "none";
    modalEl.setAttribute("aria-hidden", "true");
    if (activeModal !== modalEl) return;
    activeModal = null;
    setBackgroundInert(false);
    if (lastModalFocus && document.contains(lastModalFocus)) {
      lastModalFocus.focus({ preventScroll: true });
    }
    lastModalFocus = null;
  }

  function getPeekDisplayContent(card) {
    const record = getCardRecord(card) || {};
    return {
      front: String(
        card?.front?.content
        || record.front
        || record.title
        || record.cue
        || card?.cue?.cue
        || ""
      ).trim(),
      back: String(
        card?.back?.content
        || card?.back?.targetContent
        || record.back
        || record.analysis
        || ""
      ).trim()
    };
  }

  // A peek is deliberately read-only: no queue movement, no grading, no SRS.
  function openCardPeek(cardId, triggerEl = null) {
    if (!cardPeekModal || !cardId) return;
    const card = peekCardCache.get(cardId) || findCardById(cardId);
    if (!card) return;

    peekTriggerEl = triggerEl instanceof Element ? triggerEl : null;
    const { front, back } = getPeekDisplayContent(card);
    if (cardPeekSubject) {
      const parts = [getCardSubject(card), ...getCardLayers(card)].filter(Boolean);
      cardPeekSubject.textContent = parts.join(" \u203A ");
    }
    if (cardPeekFront) cardPeekFront.textContent = front;
    if (cardPeekBack) cardPeekBack.textContent = back;
    if (cardPeekBackSection) cardPeekBackSection.hidden = !back;

    showModal(cardPeekModal);
    closeCardPeekBtn?.focus({ preventScroll: true });
  }

  function closeCardPeek() {
    const trigger = peekTriggerEl;
    peekTriggerEl = null;
    hideModal(cardPeekModal);
    if (trigger && document.contains(trigger)) {
      trigger.focus({ preventScroll: true });
    }
  }

  function portalModals() {
    // #mainContent has a backdrop-filter, which makes position:fixed children
    // resolve against it instead of the viewport. Move the modals to <body> so
    // they actually cover the whole shell, and remove them on tool teardown.
    [deckBuilderModal, quickAddModal, deckDeleteModal, cardPeekModal].forEach((modalEl) => {
      if (modalEl && modalEl.parentNode !== document.body) {
        document.body.appendChild(modalEl);
      }
    });
  }

  function trapModalFocus(modalEl) {
    if (!modalEl || modalEl.dataset.focusTrap === "1") return;
    modalEl.dataset.focusTrap = "1";
    modalEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        if (modalEl === deckBuilderModal) closeDeckBuilder();
        else if (modalEl === quickAddModal) closeQuickAdd();
        else if (modalEl === deckDeleteModal) closeDeckDelete();
        else if (modalEl === cardPeekModal) closeCardPeek();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(modalEl.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  function isInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
      || Boolean(target.closest("button, a, [role='button'], [contenteditable='true']"));
  }

  async function initialize() {
    try {
      getDOMElements();
      portalModals();
      trapModalFocus(deckBuilderModal);
      trapModalFocus(quickAddModal);
      trapModalFocus(deckDeleteModal);
      trapModalFocus(cardPeekModal);
      await loadLaunchpad();
      await loadManualHeaps();
      if (contextHeapId) {
        const heap = state.manualHeaps.find((entry) => entry.id === contextHeapId);
        if (heap) {
          // Manual study is intentionally deck-independent: a heap may collect
          // cards from several decks.
          state.manualHeapId = heap.id;
          state.currentMode = "manual";
          state.currentSubject = "";
          clearDeckScope();
          state.view = "study";
          await loadFlashcards();
        }
      } else if (contextCardId) {
        const card = await getCard(contextCardId).catch(() => null);
        if (card) {
          // Opening a card from Mindmap should land on that card, not merely
          // on its deck. Keep the deck scope and force the card to the front
          // of the study queue.
          const deck = card.deckId ? await getDeck(card.deckId).catch(() => null) : null;
          if (deck) setDeckScope(deck);
          else {
            state.currentSubject = card.deck || contextSubject || "";
            clearDeckScope();
          }
          state.currentMode = "card-learning";
          state.view = "study";
          await loadFlashcards({ focusCardId: contextCardId });
        } else if (state.currentSubject) {
          await loadFlashcards();
        }
      } else if (state.currentSubject) {
        await loadFlashcards();
      }
      renderUI();
      attachEventListeners();
      attachKeyboardShortcuts();
      if (quickAdd) {
        await openQuickAdd();
      } else if (createDeck) {
        openDeckBuilder();
      }
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
        clearDeckScope();
        state.sessionFilter = null;
        await loadLaunchpad();
        renderUI();
      });
    }

    if (editDecksBtn) {
      editDecksBtn.addEventListener("click", async () => {
        state.editMode = !state.editMode;
        editDecksBtn.classList.toggle("active", state.editMode);
        await loadLaunchpad();
        renderUI();
      });
    }

    if (deckSearchInput) {
      deckSearchInput.addEventListener("input", () => {
        state.deckSearch = deckSearchInput.value || "";
        loadLaunchpad().then(renderUI).catch((error) => console.error("Deck search failed:", error));
      });
    }

    if (deckSortBtn) {
      deckSortBtn.addEventListener("click", async () => {
        state.deckSortDirection = state.deckSortDirection === "desc" ? "asc" : "desc";
        await loadLaunchpad();
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
        if (memoryStats && memoryStats.classList.contains("open")) {
          setStatsOpen(false);
        } else {
          renderSidebar();
          updateSystemThought();
          setStatsOpen(true);
        }
      });

      if (closeStatsBtn) {
        closeStatsBtn.addEventListener("click", () => setStatsOpen(false));
      }
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

    // Sidebar tab event binding
    const sidebarModeTabs = document.getElementById("sidebarModeTabs");
    if (sidebarModeTabs && !sidebarModeTabs.dataset.bound) {
      sidebarModeTabs.dataset.bound = "1";
      sidebarModeTabs.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-mode]");
        if (!btn) return;
        setSidebarMode(btn.dataset.mode);
      });
    }

    // Stats content event delegation (inspect, filter, page, study buttons)
    if (statsContent && !statsContent.dataset.sidebarBound) {
      statsContent.dataset.sidebarBound = "1";
      statsContent.addEventListener("click", async (event) => {
        const peekBtn = event.target.closest("[data-peek-card]");
        if (peekBtn) {
          openCardPeek(peekBtn.dataset.peekCard, peekBtn);
          return;
        }
        const inspectBtn = event.target.closest("[data-inspect-card]");
        if (inspectBtn) {
          inspectCard(inspectBtn.dataset.inspectCard);
          return;
        }
        const studyBtn = event.target.closest("[data-study-subject]");
        if (studyBtn) {
          const subject = studyBtn.dataset.studySubject || "";
          if (!subject) return;
          state.currentSubject = subject;
          clearDeckScope();
          state.currentMode = "card-learning";
          state.sessionFilter = null;
          state.view = "study";
          state.sidebarMode = SIDEBAR_MODES.FOCUS;
          await loadFlashcards();
          renderUI();
          renderSidebar();
        }
      });
      statsContent.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const peekBtn = event.target.closest("[data-peek-card]");
        if (!peekBtn) return;
        event.preventDefault();
        openCardPeek(peekBtn.dataset.peekCard, peekBtn);
      });
    }

    // Flashcard inspect button handler
    if (flashcard) {
      flashcard.addEventListener("click", (e) => {
        if (e.target.closest("[data-inspect-current]")) {
          const current = state.flashcards[state.currentIndex];
          inspectCard(getSidebarCardId(current));
          return;
        }
      });
    }

    if (resetMemoryBtn) {
      resetMemoryBtn.addEventListener("click", async () => {
        if (await dialog.confirm("Are you sure you want to reset ALL memory metadata for this subject? This cannot be undone.", "Reset", "danger")) {
          await resetSubjectMemoryMetadata();
          await loadFlashcards();
          renderUI();
        }
      });
    }

    // Priority toggle button (bottom-right)
    const priorityToggleBtn = document.getElementById("priorityToggle");
    if (priorityToggleBtn) {
      priorityToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const controls = document.getElementById("priorityControls");
        if (controls) {
          const isVisible = controls.style.display !== "none";
          if (!isVisible) {
            // Populate priority buttons when showing
            const currentCard = state.flashcards[state.currentIndex];
            if (currentCard?.record?.priority !== undefined) {
              controls.innerHTML = `
                <span class="priority-label">Priority:</span>
                ${[1,2,3,4,5].map(v => {
                  const active = v <= currentCard.record.priority;
                  const color = getPriorityColor(v);
                  return `<button type="button" class="priority-btn ${active ? 'active' : ''}"
                    style="color:${active ? color : 'rgba(230,255,245,0.3)'};"
                    data-value="${v}" title="Set priority to ${v}">${active ? '★' : '☆'}</button>`;
                }).join("")}
              `;
              controls.querySelectorAll(".priority-btn").forEach(btn => {
                btn.addEventListener("click", async (e) => {
                  const newPriority = parseInt(e.target.dataset.value);
                  const card = state.flashcards[state.currentIndex];
                  if (card?.record?.id) {
                    await updateQuotePriority(card.record.id, newPriority);
                  }
                });
              });
            }
          }
          controls.style.display = isVisible ? "none" : "flex";
        }
      });
    }

    if (closeStatsBtn && !closeStatsBtn.dataset.bound) {
      closeStatsBtn.dataset.bound = "1";
      closeStatsBtn.addEventListener("click", () => setStatsOpen(false));
    }

    if (flashcard) {
      flashcard.addEventListener("click", (e) => {
        if (e.target.closest(".memory-btn") || e.target.closest(".grade-btn")) return;
        flipCard();
      });
    }

    // Deck Builder Event Listeners
    if (createDeckBtn) {
      createDeckBtn.addEventListener("click", openDeckBuilder);
    }

    if (manualHeapsBtn) {
      manualHeapsBtn.addEventListener("click", async () => {
        state.currentMode = "manual";
        state.currentSubject = "";
        clearDeckScope();
        state.view = "middle-ui";
        await loadManualHeaps();
        await loadMiddleUIData();
        renderUI();
      });
    }

    if (closeDeckBuilderBtn) {
      closeDeckBuilderBtn.addEventListener("click", closeDeckBuilder);
    }

    if (deckBuilderModal) {
      deckBuilderModal.addEventListener("click", (e) => {
        if (e.target === deckBuilderModal) {
          closeDeckBuilder();
        }
      });
    }

    if (closeDeckDeleteBtn) closeDeckDeleteBtn.addEventListener("click", closeDeckDelete);
    if (cancelDeckDeleteBtn) cancelDeckDeleteBtn.addEventListener("click", closeDeckDelete);
    if (deckDeleteModal) {
      deckDeleteModal.addEventListener("click", (e) => {
        if (e.target === deckDeleteModal) closeDeckDelete();
      });
    }
    if (confirmDeckDeleteBtn) {
      confirmDeckDeleteBtn.addEventListener("click", performDeckDelete);
    }

    if (closeCardPeekBtn) closeCardPeekBtn.addEventListener("click", closeCardPeek);
    if (cardPeekModal) {
      cardPeekModal.addEventListener("click", (e) => {
        if (e.target === cardPeekModal || e.target === cardPeekOverlay) closeCardPeek();
      });
    }

    if (nextToDeckBtn) {
      nextToDeckBtn.addEventListener("click", () => {
        deckBuilderState.deckName = deckNameInput?.value?.trim() || "";
        deckBuilderState.deckSubject = deckSubjectInput?.value?.trim() || "";
        deckBuilderState.deckDescription = deckDescriptionInput?.value?.trim() || "";
        if (!deckBuilderState.deckSubject) {
          dialog.alert("Please enter a subject for this deck");
          deckSubjectInput?.focus();
          return;
        }
        if (!deckBuilderState.deckName) {
          dialog.alert("Please enter a deck name");
          deckNameInput?.focus();
          return;
        }
        showDeckBuilderStep(2);
      });
    }

    if (addNewCardBtn) {
      addNewCardBtn.addEventListener("click", () => {
        startEditingCard(-1);
      });
    }

    // Import toggle
    if (importToggleBtn) {
      importToggleBtn.addEventListener("click", () => {
        const importView = document.getElementById("importView");
        const cardEditForm = document.getElementById("cardEditForm");
        if (importView) {
          const isVisible = importView.style.display !== "none";
          importView.style.display = isVisible ? "none" : "block";
          if (cardEditForm) cardEditForm.style.display = isVisible ? "block" : "none";
        }
      });
    }

    // Export button
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        exportToAnki();
      });
    }

    // Mass Edit button
    if (massEditBtn) {
      massEditBtn.addEventListener("click", async () => {
        if (deckBuilderState.isMassEditMode) {
          exitMassEditMode();
        } else {
          if (await dialog.confirm("Switch to mass edit mode? This will change the layout to show all cards with individual forms.")) {
            enterMassEditMode();
          }
        }
      });
    }

    // Mass Edit Cancel button
    if (massEditCancelBtn) {
      massEditCancelBtn.addEventListener("click", async () => {
        if (await dialog.confirm("Discard all changes in mass edit mode?")) {
          exitMassEditMode();
        }
      });
    }

    // Mass Edit Save button
    if (massEditSaveBtn) {
      massEditSaveBtn.addEventListener("click", () => {
        saveAllMassEditChanges();
      });
    }

    if (processImportBtn) {
      processImportBtn.addEventListener("click", processAnkiImport);
    }

    if (cancelImportBtn) {
      cancelImportBtn.addEventListener("click", () => {
        const importView = document.getElementById("importView");
        const cardEditForm = document.getElementById("cardEditForm");
        if (importView) importView.style.display = "none";
        if (cardEditForm) cardEditForm.style.display = "block";
        if (ankiImportInput) ankiImportInput.value = "";
        if (importFeedback) importFeedback.textContent = "";
      });
    }

    if (saveCardBtn) {
      saveCardBtn.addEventListener("click", () => {
        const front = cueInput?.value?.trim() || "";
        const back = quoteInput?.value?.trim() || "";
        if (!front || !back) {
          dialog.alert("Please enter both front and back of the card");
          return;
        }
        // Get selected priority from pills
        const activePill = priorityPills?.querySelector(".priority-pill.active");
        const priority = activePill ? parseInt(activePill.dataset.priority) : 3;
        saveFlashcard(front, back, priority);
      });
    }

    if (clearFormBtn) {
      clearFormBtn.addEventListener("click", () => {
        finishEditingCard();
      });
    }

    if (deleteCardBtn) {
      deleteCardBtn.addEventListener("click", () => {
        if (deckBuilderState.currentCardIndex >= 0) {
          deleteFlashcard(deckBuilderState.currentCardIndex);
        }
      });
    }

    if (cancelCardBtn) {
      cancelCardBtn.addEventListener("click", () => {
        finishEditingCard();
      });
    }

    if (backToDeckInfoBtn) {
      backToDeckInfoBtn.addEventListener("click", () => {
        showDeckBuilderStep(1);
      });
    }

    if (finishDeckBtn) {
      finishDeckBtn.addEventListener("click", async () => {
        if (deckBuilderState.cards.length === 0) {
          dialog.alert("Please add at least one card to the deck");
          return;
        }
        await saveDeckToDB();
      });
    }

    if (studyNewDeckBtn) {
      studyNewDeckBtn.addEventListener("click", async () => {
        const deckId = deckBuilderState.editingDeckId;
        const subject = deckBuilderState.deckSubject;
        const deck = deckId ? await getDeck(deckId).catch(() => null) : null;
        if (deck) setDeckScope(deck);
        else {
          state.currentSubject = subject;
          clearDeckScope();
        }
        state.currentMode = "card-learning";
        state.view = "study";
        closeDeckBuilder();
        await loadFlashcards();
        renderUI();
      });
    }

    if (backToLaunchpadBtn) {
      backToLaunchpadBtn.addEventListener("click", async () => {
        await loadLaunchpad();
        renderUI();
        closeDeckBuilder();
      });
    }

    // Quick Add listeners
    if (quickAddLaunchBtn) {
      quickAddLaunchBtn.addEventListener("click", () => openQuickAdd());
    }
    if (quickAddHeaderBtn) {
      quickAddHeaderBtn.addEventListener("click", () => openQuickAdd());
    }
    if (closeQuickAddBtn) {
      closeQuickAddBtn.addEventListener("click", closeQuickAdd);
    }
    if (quickAddOverlay) {
      quickAddOverlay.addEventListener("click", closeQuickAdd);
    }
    if (quickAddModal) {
      quickAddModal.addEventListener("keydown", (e) => {
        // Keep study shortcuts (space/arrows) out of the modal.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          closeQuickAdd();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          if (quickAddState.activeTab === "single") {
            quickAddSaveCard();
          } else {
            quickAddBulkImport();
          }
        }
      });
    }
    if (quickAddSaveNextBtn) {
      quickAddSaveNextBtn.addEventListener("click", () => quickAddSaveCard());
    }
    if (quickAddSaveCloseBtn) {
      quickAddSaveCloseBtn.addEventListener("click", async () => {
        const saved = await quickAddSaveCard({ allowEmptyClose: true });
        if (saved) closeQuickAdd();
      });
    }
    if (quickAddBulkImportBtn) {
      quickAddBulkImportBtn.addEventListener("click", quickAddBulkImport);
    }
    document.querySelectorAll("[data-quick-add-tab]").forEach((tab) => {
      tab.addEventListener("click", () => setQuickAddTab(tab.dataset.quickAddTab));
    });

    // Middle UI event listeners
    if (middleBackBtn) {
      middleBackBtn.addEventListener("click", async () => {
        state.view = "launchpad";
        state.currentSubject = "";
        clearDeckScope();
        state.sessionFilter = null;
        await loadLaunchpad();
        renderUI();
      });
    }

    if (deckScopeToggle) {
      deckScopeToggle.addEventListener("click", async () => {
        state.directCardsOnly = !state.directCardsOnly;
        // Paint the toggle before the reload so the tap always feels instant.
        deckScopeToggle.textContent = state.directCardsOnly ? "Direct only" : "Include subdecks";
        deckScopeToggle.setAttribute("aria-pressed", state.directCardsOnly ? "true" : "false");
        deckScopeToggle.classList.toggle("active", state.directCardsOnly);
        await loadMiddleUIData();
        renderMiddleUI();
      });
    }

    if (middleStudyBtn) {
      middleStudyBtn.addEventListener("click", async () => {
        if (state.currentMode === "manual") {
          await studyManualHeap();
          return;
        }
        // Build session filter from selected options
        state.sessionFilter = {
          mode: state.currentMode,
          filterMode: state.filterMode,
          priorities: [...state.selectedPriorities],
          tags: [...state.selectedTags],
          layers: [...state.selectedLayers]
        };
        state.view = "study";
        await loadFlashcards();
        renderUI();
      });
    }

    if (manualNewHeapBtn) {
      manualNewHeapBtn.addEventListener("click", createManualHeap);
    }

    if (manualOpenLibraryBtn) {
      manualOpenLibraryBtn.addEventListener("click", openLibraryForActiveHeap);
    }

    if (manualStudyHeapBtn) {
      manualStudyHeapBtn.addEventListener("click", studyManualHeap);
    }

    if (manualHeapList) {
      manualHeapList.addEventListener("click", (event) => {
        const row = event.target instanceof Element ? event.target.closest("[data-manual-heap-id]") : null;
        if (!row) return;
        state.manualHeapId = row.dataset.manualHeapId || "";
        renderManualHeapPanel();
      });
    }

    // Mode selector pills
    if (middleModeSelector) {
      middleModeSelector.querySelectorAll(".mode-pill").forEach(btn => {
        btn.addEventListener("click", async () => {
          middleModeSelector.querySelectorAll(".mode-pill").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          state.currentMode = btn.dataset.mode;
          if (state.currentMode === "manual") {
            await loadManualHeaps();
          }
          renderMiddleUI();
        });
      });
    }

    // AND/OR filter toggle
    if (andFilterBtn) {
      andFilterBtn.addEventListener("click", () => {
        state.filterMode = "AND";
        andFilterBtn.classList.add("active");
        orFilterBtn.classList.remove("active");
      });
    }

    if (orFilterBtn) {
      orFilterBtn.addEventListener("click", () => {
        state.filterMode = "OR";
        orFilterBtn.classList.add("active");
        andFilterBtn.classList.remove("active");
      });
    }

    // Cue/quote input listeners for save button state
    if (cueInput && quoteInput && saveCardBtn) {
      const updateSaveButton = () => {
        const hasContent = cueInput.value.trim() && quoteInput.value.trim();
        saveCardBtn.disabled = !hasContent;
        saveCardBtn.style.opacity = hasContent ? "1" : "0.4";
        saveCardBtn.style.pointerEvents = hasContent ? "auto" : "none";
      };
      cueInput.addEventListener("input", updateSaveButton);
      quoteInput.addEventListener("input", updateSaveButton);
    }
  }

  function attachKeyboardShortcuts() {
    document.addEventListener("keydown", handleKeyDown);
  }

  async function handleKeyDown(e) {
    // Study shortcuts belong to the card surface. If a button, link, select,
    // editable field or open modal has focus, let the control handle the key.
    if (activeModal || isInteractiveTarget(e.target)) return;

    // Priority shortcut: Ctrl+1-5 to set quote priority
    if (e.ctrlKey && e.key >= "1" && e.key <= "5") {
      const currentCard = state.flashcards[state.currentIndex];
      if (currentCard?.record?.priority !== undefined) {
        e.preventDefault();
        await updateQuotePriority(currentCard.record.id, parseInt(e.key));
        return;
      }
    }

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
    if (typeof addQuote !== "function" || typeof addNode !== "function" || typeof addCard !== "function") {
      console.warn("Memory grading is unavailable: addQuote/addNode/addCard not provided to Memory Tool.");
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

    const heapSize = (state.session.heap?.size?.() || 0) + state.flashcards.length;
    const phase = getUserLearningPhase(currentCard, state.userProfile);
    const weights = getSessionWeightCache(currentCard, phase, heapSize);
    const previousMemoryState = { ...currentCard.memoryState };
    const updatedMemoryState = updateCardMemoryState(
      currentCard.memoryState,
      { grade, responseTimeMs, confidence: null, phase, weights },
      nowMs
    );
    state.userProfile = updateUserLearningModel(state.userProfile, {
      previousMemoryState,
      updatedMemoryState,
      grade,
      responseTimeMs,
      phase,
      heapSize
    });
    saveUserLearningProfile(state.userProfile);

    currentCard.review.graded = true;
    currentCard.review.grade = grade;
    currentCard.review.responseTimeMs = responseTimeMs;
    currentCard.memoryState = updatedMemoryState;

    if (persistKind === "card") {
      const updatedCard = {
        ...persistRecord,
        meta: mergeMemoryStateIntoMeta(persistRecord.meta || {}, updatedMemoryState),
        updatedAt: nowMs
      };
      state.session.suppressDBChange++;
      await addCard(updatedCard);
      if (isBlurt) {
        currentCard.targetRecord = updatedCard;
      } else {
        currentCard.record = updatedCard;
      }
    } else if (persistKind === "quote") {
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

    // Build recycled card for re-queueing
    const cardForHeap = {
      ...currentCard,
      review: { required: true, graded: false, grade: null, responseTimeMs: null },
      memoryState: updatedMemoryState
    };
    if (isBlurt) {
      cardForHeap.blurt = { submitted: false, text: "" };
    }
    if (state.session.heap && shouldReinsertReviewedCard(cardForHeap, grade, state.session.learningRoute)) {
      const nextPriority = computeModePriority(cardForHeap, state.session.learningRoute, state.userProfile, nowMs);
      state.session.heap.push({ priority: nextPriority, card: cardForHeap });
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
          dialog.alert("Completed all evidence matching for this round!");
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

    if ((!state.session.heap || state.session.heap.size() === 0) && state.session.surprisePool.length > 0) {
      rerouteRemainingLearningScope();
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
    if (quickAddState.isOpen) return;
    if (state.session.suppressDBChange > 0) {
      state.session.suppressDBChange--;
      return;
    }
    if (state.currentMode === "manual") {
      loadManualHeaps().then(() => {
        if (state.view === "middle-ui") renderMiddleUI();
      });
    }
    loadFlashcards().then(renderUI);
  }

  async function loadLaunchpad() {
    const [allDecks, allCards] = await Promise.all([getAllDecks(), getAllCards()]);
    if (!deckList) return;

    if (deckSortBtn) {
      deckSortBtn.textContent = state.deckSortDirection === "desc" ? "Newest" : "Oldest";
      deckSortBtn.setAttribute("aria-pressed", state.deckSortDirection === "desc" ? "true" : "false");
    }

    let decks = allDecks || [];
    const query = String(state.deckSearch || "").trim().toLowerCase();
    if (query && decks.length) {
      const byId = new Map(decks.map((deck) => [String(deck.id), deck]));
      const matched = new Set();
      for (const deck of decks) {
        if (`${deck.subject} ${deck.name}`.toLowerCase().includes(query)) {
          matched.add(String(deck.id));
        }
      }
      // Keep ancestors so a matching child still renders with its context.
      for (const id of [...matched]) {
        let current = byId.get(id);
        while (current?.parentId) {
          const parentId = String(current.parentId);
          if (matched.has(parentId)) break;
          matched.add(parentId);
          current = byId.get(parentId);
        }
      }
      decks = decks.filter((deck) => matched.has(String(deck.id)));
    }

    deckList.innerHTML = "";
    const cards = allCards || [];
    if (!decks || decks.length === 0) {
      deckList.innerHTML = query
        ? `<div style="color: var(--text-muted);">No decks match “${escapeHtml(state.deckSearch)}”.</div>`
        : `<div style="color: var(--text-muted);">No decks yet. Build a deck, or add a card to start one.</div>`;
      return;
    }

    const directCountByDeck = new Map();
    for (const card of cards) {
      const deckId = String(card?.deckId || "");
      if (!deckId) continue;
      directCountByDeck.set(deckId, (directCountByDeck.get(deckId) || 0) + 1);
    }

    const groups = groupDecksBySubject(decks, { direction: state.deckSortDirection });
    for (const group of groups) {
      const subjectDecks = flattenDeckTree(group.decks);
      const allIds = new Set(subjectDecks.map((deck) => String(deck.id)));
      const subjectCards = cards.filter((card) => allIds.has(String(card.deckId || "")));
      const analysisCount = (await getAnalysisNodesForSubject(group.subject))?.length || 0;

      const section = document.createElement("div");
      section.className = "card deck-subject";
      section.innerHTML = `
        <div class="deck-subject-header">
          <div class="card-title">${escapeHtml(group.subject || "Unsorted")}</div>
          <div class="card-meta deck-stats">${subjectCards.length} cards${analysisCount ? ` · ${analysisCount} analysis` : ""}</div>
        </div>
        <div class="deck-tree" role="tree" aria-label="${escapeHtml(group.subject || "Unsorted")} decks"></div>
      `;

      const tree = section.querySelector(".deck-tree");
      for (const deck of subjectDecks) {
        const descendantIds = new Set(getDeckDescendantIds(allDecks, deck.id));
        const totalCards = cards.filter((card) => descendantIds.has(String(card.deckId || ""))).length;
        const directCards = directCountByDeck.get(String(deck.id)) || 0;
        const meta = descendantIds.size > 1
          ? `${directCards} direct · ${totalCards} with subdecks`
          : `${directCards} card${directCards === 1 ? "" : "s"}`;

        const row = document.createElement("div");
        row.className = "deck-row";
        row.dataset.deckId = deck.id;
        row.style.setProperty("--deck-depth", String(deck.depth || 0));
        row.setAttribute("role", "treeitem");
        row.innerHTML = `
          <button type="button" class="deck-row-main" title="Study ${escapeHtml(deck.name)}" aria-label="Study ${escapeHtml(deck.name)}">
            <span class="deck-row-name">${escapeHtml(deck.name)}</span>
            <span class="deck-row-meta">${escapeHtml(meta)}</span>
          </button>
          <div class="deck-row-actions">
            <button type="button" class="card-btn deck-options-btn" data-deck-id="${escapeHtml(deck.id)}" title="Study options for ${escapeHtml(deck.name)}">Options</button>
            <button type="button" class="deck-add-btn" data-deck-id="${escapeHtml(deck.id)}" title="Add a card to ${escapeHtml(deck.name)}" aria-label="Add a card to ${escapeHtml(deck.name)}">+</button>
            ${state.editMode ? `
              ${deck.name === UNSORTED_DECK_NAME && !deck.parentId ? "" : `
                <button type="button" class="deck-edit-btn" data-deck-id="${escapeHtml(deck.id)}" title="Edit ${escapeHtml(deck.name)}" aria-label="Edit ${escapeHtml(deck.name)}">✎</button>
              `}
              <button type="button" class="deck-subdeck-btn" data-deck-id="${escapeHtml(deck.id)}" title="New subdeck" aria-label="New subdeck in ${escapeHtml(deck.name)}">+ Deck</button>
              ${deck.name === UNSORTED_DECK_NAME && !deck.parentId ? "" : `
                <button type="button" class="deck-delete-btn" data-deck-id="${escapeHtml(deck.id)}" title="Delete ${escapeHtml(deck.name)}" aria-label="Delete ${escapeHtml(deck.name)}">Delete</button>
              `}
            ` : ""}
          </div>
        `;

        row.querySelector(".deck-row-main").addEventListener("click", async () => {
          if (state.editMode) return;
          setDeckScope(deck);
          state.currentMode = "card-learning";
          state.sessionFilter = null;
          state.view = "study";
          await loadFlashcards();
          renderUI();
        });

        row.querySelector(".deck-options-btn").addEventListener("click", async (e) => {
          e.stopPropagation();
          setDeckScope(deck);
          state.currentMode = "card-learning";
          state.sessionFilter = null;
          state.view = "middle-ui";
          await loadMiddleUIData();
          renderUI();
        });

        row.querySelector(".deck-add-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openQuickAdd({ deckId: deck.id });
        });

        if (state.editMode) {
          row.querySelector(".deck-edit-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await openDeckEditor(deck.id);
          });
          row.querySelector(".deck-subdeck-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            openDeckBuilder({ subject: deck.subject, parentId: deck.id });
          });
          row.querySelector(".deck-delete-btn")?.addEventListener("click", async (e) => {
            e.stopPropagation();
            await confirmDeleteDeck(deck.id);
          });
        }

        tree.appendChild(row);
      }

      deckList.appendChild(section);
    }
  }

  async function loadManualHeaps() {
    if (typeof getAllHeaps !== "function") {
      state.manualHeaps = [];
      state.manualHeapId = "";
      return [];
    }
    try {
      state.manualHeaps = await getAllHeaps() || [];
    } catch (error) {
      console.warn("Could not load heaps:", error);
      state.manualHeaps = [];
    }

    if (state.manualHeapId && !state.manualHeaps.some((heap) => heap.id === state.manualHeapId)) {
      state.manualHeapId = "";
    }
    if (!state.manualHeapId && state.manualHeaps.length > 0 && state.currentMode === "manual") {
      state.manualHeapId = state.manualHeaps[0].id;
    }
    return state.manualHeaps;
  }

  function getActiveManualHeap() {
    if (!state.manualHeapId) return null;
    return (state.manualHeaps || []).find((heap) => heap.id === state.manualHeapId) || null;
  }

  function renderManualHeapPanel() {
    if (!manualHeapList) return;
    const activeHeap = getActiveManualHeap();

    if (!state.manualHeaps.length) {
      manualHeapList.innerHTML = `
        <div class="manual-heap-empty">
          No heaps yet. Create one, then collect cards in the Mindmap <strong>Library</strong>.
        </div>`;
    } else {
      manualHeapList.innerHTML = state.manualHeaps.map((heap) => {
        const count = (heap.cardIds || []).length;
        return `
          <button type="button" class="manual-heap-row${heap.id === activeHeap?.id ? " active" : ""}" data-manual-heap-id="${escapeHtml(heap.id)}">
            <span class="manual-heap-row-main">
              <span class="manual-heap-row-name">${escapeHtml(heap.name)}</span>
              <span class="manual-heap-row-meta">${count} card${count === 1 ? "" : "s"} · manual order</span>
            </span>
            <span class="manual-heap-row-count">${count}</span>
          </button>
        `;
      }).join("");
    }

    const canStudy = Boolean(activeHeap && (activeHeap.cardIds || []).length > 0);
    if (manualStudyHeapBtn) manualStudyHeapBtn.disabled = !canStudy;
    if (manualOpenLibraryBtn) manualOpenLibraryBtn.disabled = !activeHeap;
  }

  async function createManualHeap() {
    if (typeof addHeap !== "function") {
      dialog.alert("Heap creation is unavailable.");
      return;
    }
    const name = await dialog.prompt("Name this heap:");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      dialog.alert("Please enter a heap name.");
      return;
    }

    try {
      const heap = await addHeap({ name: trimmed, cardIds: [] });
      state.manualHeaps = [heap, ...state.manualHeaps.filter((entry) => entry.id !== heap.id)];
      state.manualHeapId = heap.id;
      renderManualHeapPanel();
      // Creating a heap should drop straight into the Library so the learner
      // can start collecting cards, as if picking books from shelves.
      openLibraryForActiveHeap();
    } catch (error) {
      console.error("Failed to create heap:", error);
      dialog.alert("Failed to create heap: " + error.message);
    }
  }

  function openLibraryForActiveHeap() {
    const heap = getActiveManualHeap();
    if (!heap) {
      dialog.alert("Create or select a heap first.");
      return;
    }
    window.dispatchEvent(new CustomEvent("neuronet-open-tool", {
      detail: { tool: "mindmap", heapId: heap.id, view: "grid" }
    }));
  }

  async function studyManualHeap() {
    const heap = getActiveManualHeap();
    if (!heap) {
      dialog.alert("Create or select a heap first.");
      return;
    }
    if ((heap.cardIds || []).length === 0) {
      dialog.alert("This heap is empty. Add cards in the Library first.");
      return;
    }
    state.currentMode = "manual";
    state.manualHeapId = heap.id;
    state.view = "study";
    await loadFlashcards();
    renderUI();
  }

  function createCardStudyItem(card) {
    return {
      id: card.id,
      memoryKind: "card",
      type: "card-learning",
      record: card,
      review: { required: true, graded: false, grade: null, responseTimeMs: null },
      front: {
        content: card.front,
        isCard: true,
        deck: card.deck,
        deckPath: card.deckPath || []
      },
      back: {
        content: card.back,
        isCard: true,
        deck: card.deck,
        deckPath: card.deckPath || [],
        tags: card.tags || []
      },
      memoryState: getMemoryStateFromMeta(card.meta || {}, "card")
    };
  }

  async function loadFlashcards({ focusCardId = null } = {}) {
    if (!state.currentSubject && state.currentMode !== "manual") {
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
    state.session.weightCache = new Map();
    state.session.learningMode = "global_srs";
    state.session.learningRoute = null;
    state.session.systemState = null;
    state.session.routeRerouteCounter = 0;
    state.session.focusedBlockKeys = new Set();

    if (state.currentMode === "manual") {
      await buildManualHeapQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "card-learning") {
      await buildCardLearningQueue(focusCardId);
      drawNextCardFromHeap();
    } else if (state.currentMode === "quote-learning") {
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
      this.indexByKey = new Map();
    }
    size() {
      return this.items.length;
    }
    push(value) {
      const key = getCardQueueKey(value?.card);
      if (key && this.indexByKey.has(key)) {
        const existingIndex = this.indexByKey.get(key);
        this.items[existingIndex] = { ...value, key };
        this.#bubbleUp(existingIndex);
        this.#bubbleDown(this.indexByKey.get(key));
        return;
      }
      if (key) {
        value = { ...value, key };
      }
      this.items.push(value);
      if (key) {
        this.indexByKey.set(key, this.items.length - 1);
      }
      this.#bubbleUp(this.items.length - 1);
    }
    pop() {
      if (this.items.length === 0) return null;
      const top = this.items[0];
      const last = this.items.pop();
      if (top?.key) {
        this.indexByKey.delete(top.key);
      }
      if (this.items.length > 0 && last) {
        this.items[0] = last;
        if (last?.key) {
          this.indexByKey.set(last.key, 0);
        }
        this.#bubbleDown(0);
      }
      return top;
    }
    hasCard(card) {
      const key = getCardQueueKey(card);
      return !!key && this.indexByKey.has(key);
    }
    #bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if ((this.items[parent]?.priority ?? 0) >= (this.items[index]?.priority ?? 0)) return;
        this.#swap(parent, index);
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
        this.#swap(index, largest);
        index = largest;
      }
    }
    #swap(a, b) {
      [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
      if (this.items[a]?.key) {
        this.indexByKey.set(this.items[a].key, a);
      }
      if (this.items[b]?.key) {
        this.indexByKey.set(this.items[b].key, b);
      }
    }
  }

  function getCardQueueKey(card) {
    if (!card) return null;
    if (card.type === "blurt") {
      const targetKind = card.targetKind || card.back?.targetKind || "unknown";
      const targetId = card.targetRecord?.id || card.back?.targetRecord?.id;
      return targetId ? `blurt:${targetKind}:${targetId}` : (card.id ? `blurt-cue:${card.id}` : null);
    }
    if (card.memoryKind === "card" || card.type === "card-learning") {
      const cardId = card.record?.id || card.id;
      return cardId ? `card:${cardId}` : null;
    }
    if (card.memoryKind === "quote" || card.type === "quote-learning") {
      const quoteId = card.record?.id || card.id;
      return quoteId ? `quote:${quoteId}` : null;
    }
    if (card.memoryKind === "analysis" || card.type === "analysis-learning") {
      const analysisId = card.record?.id || card.id;
      return analysisId ? `analysis:${analysisId}` : null;
    }
    return card.id ? `${card.type || card.memoryKind || "card"}:${card.id}` : null;
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function getPriorityColor(priority) {
    const p = clampNumber(Number(priority), 1, 5);
    switch (p) {
      case 1: return "#9aa4ad";
      case 2: return "#4ba3ff";
      case 3: return "#3fd07d";
      case 4: return "#ff9b39";
      case 5: return "#ff4d4d";
      default: return "#3fd07d";
    }
  }

  function getExpectedTimeMs(kind) {
    if (kind === "analysis") return 8000;
    if (kind === "blurt") return 15000;
    return 4000;
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
      L_phase: memoryState.L_phase,
      easyStreak: memoryState.easyStreak,
      recentGrades: memoryState.recentGrades,
      lastGrade: memoryState.lastGrade
    };
  }

  function getUserLearningPhase(cardOrMemoryState, userProfile = state.userProfile) {
    const ms = cardOrMemoryState?.memoryState || cardOrMemoryState || {};
    const reviewCount = Number(ms.reviewCount || 0);
    const recentGrades = Array.isArray(ms.recentGrades) ? ms.recentGrades : [];
    const easyCount = recentGrades.filter((g) => g === "easy").length;
    const gradeVariety = new Set(recentGrades).size;
    const easyStreak = Number(ms.easyStreak || 0);
    const thresholds = userProfile.phaseThresholds || getDefaultUserLearningProfile().phaseThresholds;

    if (reviewCount === 0) return "new";
    if (reviewCount <= thresholds.warmingReviews) return "warming";
    if (Number(ms.S || 0) >= thresholds.masteredStability && easyStreak >= thresholds.masteredEasyStreak && Number(ms.U ?? 1) < thresholds.stableUncertainty) {
      return "mastered";
    }
    if ((easyCount >= Math.max(2, recentGrades.length - 1) && Number(ms.U ?? 1) <= thresholds.stableUncertainty) || easyStreak >= thresholds.masteredEasyStreak) {
      return "stable";
    }
    if (reviewCount <= Math.max(thresholds.stabilisingReviews, Math.round(userProfile.expectedTrialsToMastery || 5)) || gradeVariety > 1) {
      return "stabilising";
    }
    return Number(ms.U ?? 1) <= thresholds.stableUncertainty ? "stable" : "stabilising";
  }

  function getPhaseMultiplier(phase) {
    switch (phase) {
      case "new": return 0.45;
      case "warming": return 0.85;
      case "stabilising": return 1.1;
      case "stable": return 1.35;
      case "mastered": return 0.9;
      default: return 1;
    }
  }

  function getAdaptiveWeights(userProfile, phase, heapSize = 0) {
    const heapFactor = Math.max(1, Math.log((heapSize || 0) + 1));
    const phaseMultiplier = getPhaseMultiplier(phase);
    const learningSpeed = clampNumber(Number(userProfile.learningSpeedFactor || 1), 0.45, 1.8);
    const stabilityGain = clampNumber(Number(userProfile.stabilityGainRate || 1), 0.5, 1.8);
    const forgettingResistance = clampNumber(Number(userProfile.forgettingResistance || 1), 0.5, 1.8);
    const heapSensitivity = clampNumber(Number(userProfile.heapSensitivity || 1), 0.45, 1.8);

    return {
      alphaEffective: 0.25 * learningSpeed * phaseMultiplier * stabilityGain,
      betaEffective: 0.2 * learningSpeed * phaseMultiplier,
      gammaEffective: 0.2 * phaseMultiplier / forgettingResistance,
      heapFactor,
      phaseMultiplier,
      intervalScale: 1 / Math.max(1, heapFactor * heapSensitivity)
    };
  }

  function getSessionWeightCache(card, phase, heapSize) {
    const key = `${getCardQueueKey(card) || "card"}:${phase}`;
    const cached = state.session.weightCache?.get(key);
    if (cached) return cached;
    const weights = getAdaptiveWeights(state.userProfile, phase, heapSize);
    state.session.weightCache?.set(key, weights);
    return weights;
  }

  function updateCardMemoryState(memoryState, { grade, responseTimeMs, confidence, phase = null, weights = null }, nowMs) {
    const gradeNorm = grade === "easy" ? 1 : grade === "kinda" ? 0 : -1;
    const gradeAbs = Math.abs(gradeNorm);
    const effectivePhase = phase || getUserLearningPhase(memoryState);
    const adaptiveWeights = weights || getAdaptiveWeights(state.userProfile, effectivePhase, state.session.heap?.size?.() || 0);

    const expectedSeconds = clampNumber(Number(memoryState.expectedTime ?? 4), 1, 120);
    const actualSeconds = clampNumber(Number(responseTimeMs ?? 4000) / 1000, 0.2, 240);

    const TF = actualSeconds / expectedSeconds;
    const T_effect = 1 / (1 + Math.exp(2 * (TF - 1)));

    let S = memoryState.S;
    S = S * (1 + adaptiveWeights.alphaEffective * gradeNorm * T_effect) - 0.15 * (1 - T_effect) * (gradeAbs + 0.2);
    S = clampNumber(S, 0.1, 1000);

    let D = memoryState.D;
    D = D * (1 - adaptiveWeights.betaEffective * gradeNorm * T_effect) + 0.1 * (1 - gradeAbs) * (1 - T_effect);
    D = clampNumber(D, 0.1, 1000);

    let consistency = clampNumber(memoryState.consistency ?? 0.7, 0, 1);
    consistency = clampNumber(consistency + 0.05 * gradeNorm * T_effect - 0.02 * (1 - T_effect), 0, 1);

    let U = memoryState.U;
    U = U + adaptiveWeights.gammaEffective * (1 - consistency) + 0.15 * (1 - T_effect);
    U = clampNumber(U, 0, 1);

    const I_base = S / (D + 0.5);
    const earlyLearningGate = Number(memoryState.reviewCount || 0) < 3;
    const earlyMultiplier = earlyLearningGate ? (gradeNorm < 0 ? 0.9 : 1.05) : (1 + 0.8 * gradeNorm * T_effect);
    let intervalDays = I_base * earlyMultiplier * adaptiveWeights.intervalScale;
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
    const recentGrades = [...(Array.isArray(memoryState.recentGrades) ? memoryState.recentGrades : []), grade].slice(-6);
    const easyStreak = grade === "easy" ? Number(memoryState.easyStreak || 0) + 1 : 0;
    const L_phase = getUserLearningPhase({ ...memoryState, S, U, reviewCount, recentGrades, easyStreak });

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
      L_phase,
      easyStreak,
      recentGrades,
      lastGrade: grade
    };
  }

  function updateUserLearningModel(userProfile, outcome) {
    const profile = normalizeUserLearningProfile(userProfile);
    const previous = outcome.previousMemoryState || {};
    const updated = outcome.updatedMemoryState || {};
    const gradeNorm = outcome.grade === "easy" ? 1 : outcome.grade === "kinda" ? 0 : -1;
    const expectedSeconds = clampNumber(Number(previous.expectedTime ?? 4), 1, 120);
    const actualSeconds = clampNumber(Number(outcome.responseTimeMs ?? 4000) / 1000, 0.2, 240);
    const timeEffect = 1 / (1 + Math.exp(2 * ((actualSeconds / expectedSeconds) - 1)));
    const stabilityDelta = Number(updated.S || 0) - Number(previous.S || 0);
    const alpha = 0.08;

    const speedTarget = gradeNorm > 0 && timeEffect > 0.5 ? 1.18 : gradeNorm < 0 && (previous.reviewCount || 0) >= 3 ? 0.9 : 1;
    profile.learningSpeedFactor = clampNumber(profile.learningSpeedFactor * (1 - alpha) + speedTarget * alpha, 0.45, 1.8);

    const stabilityTarget = stabilityDelta > 0 ? 1.12 : gradeNorm < 0 ? 0.92 : 1;
    profile.stabilityGainRate = clampNumber(profile.stabilityGainRate * 0.93 + stabilityTarget * 0.07, 0.5, 1.8);

    const forgettingTarget = gradeNorm < 0 && (previous.reviewCount || 0) >= 3 ? 0.9 : gradeNorm > 0 ? 1.08 : 1;
    profile.forgettingResistance = clampNumber(profile.forgettingResistance * 0.94 + forgettingTarget * 0.06, 0.5, 1.8);

    const noiseTarget = (previous.reviewCount || 0) < 3 ? 0.8 : outcome.grade === "kinda" ? 0.7 : 0.6;
    profile.noiseTolerance = clampNumber(profile.noiseTolerance * 0.94 + noiseTarget * 0.06, 0.25, 0.95);

    const mastered = updated.L_phase === "mastered" || updated.L_phase === "stable";
    const trialsTarget = mastered ? clampNumber(Number(updated.reviewCount || profile.expectedTrialsToMastery), 2, 12) : clampNumber(Number(updated.reviewCount || 1) + 2, 2, 12);
    profile.expectedTrialsToMastery = clampNumber(profile.expectedTrialsToMastery * 0.9 + trialsTarget * 0.1, 2, 12);
    profile.optimalRepetitionRange = [
      clampNumber(Math.round(profile.expectedTrialsToMastery - 1), 2, 8),
      clampNumber(Math.round(profile.expectedTrialsToMastery + 2), 3, 14)
    ];

    const heapTarget = outcome.heapSize > 100 ? 1.2 : outcome.heapSize < 20 ? 0.8 : 1;
    profile.heapSensitivity = clampNumber(profile.heapSensitivity * 0.95 + heapTarget * 0.05, 0.45, 1.8);

    const phase = updated.L_phase || outcome.phase || "new";
    profile.phaseDistributionHistory[phase] = (profile.phaseDistributionHistory[phase] || 0) + 1;
    profile.phaseThresholds = {
      ...profile.phaseThresholds,
      warmingReviews: clampNumber(Math.round(Math.min(3, Math.max(1, profile.expectedTrialsToMastery * 0.35))), 1, 3),
      stabilisingReviews: clampNumber(Math.round(profile.expectedTrialsToMastery), 3, 8),
      stableUncertainty: clampNumber(0.35 + (profile.noiseTolerance - 0.65) * 0.2, 0.25, 0.5),
      masteredStability: clampNumber(7 + (profile.expectedTrialsToMastery - 5) * 0.6, 5, 12),
      masteredEasyStreak: clampNumber(Math.round(profile.expectedTrialsToMastery / 2), 2, 5)
    };
    profile.updatedAt = Date.now();
    return normalizeUserLearningProfile(profile);
  }

  function computePriority(memoryState, nowMs, quotePriority = null, context = {}) {
    let overdueDays;
    if (Number.isFinite(Number(memoryState.nextReview)) && memoryState.nextReview > 0) {
      overdueDays = (nowMs - Number(memoryState.nextReview)) / 86400000;
    } else {
      // New card - give it priority comparable to exactly due cards
      overdueDays = 0;
    }
    const U = clampNumber(Number(memoryState.U ?? 0.5), 0, 1);
    const phase = context.phase || getUserLearningPhase(memoryState);
    const heapSize = Number(context.heapSize ?? state.session.heap?.size?.() ?? 0);
    const heapFactor = Math.max(1, Math.log(heapSize + 1));
    const phaseBoost = phase === "new" ? 0.6 : phase === "warming" ? 0.45 : phase === "stabilising" ? 0.3 : phase === "mastered" ? -0.4 : 0;
    let result = 1 + overdueDays + U * 0.8 + phaseBoost;

    // Factor in quote priority (1-5 scale, 5 = highest user priority)
    if (quotePriority !== null && quotePriority !== undefined) {
      const p = clampNumber(Number(quotePriority), 1, 5);
      result += (p - 1) * 2; // Priority 5 adds 8.0 boost, Priority 1 adds 0
    }

    return result / Math.sqrt(heapFactor);
  }

  function getCardRecord(card) {
    return card?.record || card?.targetRecord || card?.back?.targetRecord || null;
  }

  function getCardTags(card) {
    const record = getCardRecord(card);
    const tags = [
      ...(Array.isArray(record?.meta?.tags) ? record.meta.tags : []),
      ...(Array.isArray(record?.tags) ? record.tags : [])
    ];
    return [...new Set(tags.filter(Boolean))];
  }

  function getCardLayers(card) {
    const record = getCardRecord(card);
    const path = Array.isArray(record?.deckPath)
      ? record.deckPath
      : Array.isArray(record?.meta?.hierarchyPath)
        ? record.meta.hierarchyPath
        : [];
    return path.filter(Boolean).slice(1, 4);
  }

  function getCardSubject(card) {
    const record = getCardRecord(card);
    const path = Array.isArray(record?.deckPath)
      ? record.deckPath
      : Array.isArray(record?.meta?.hierarchyPath)
        ? record.meta.hierarchyPath
        : [];
    return record?.deck || record?.subject || path[0] || state.currentSubject || "";
  }

  function getQuotePriorityForCard(card) {
    return card?.memoryKind === "card"
      || card?.memoryKind === "quote"
      || card?.targetKind === "quote"
      || card?.targetKind === "card"
      ? (card?.record?.priority ?? card?.targetRecord?.priority ?? null)
      : null;
  }

  function getCardPriorityBand(card) {
    const p = getQuotePriorityForCard(card);
    if (p >= 4) return "high";
    if (p <= 2) return "low";
    return "medium";
  }

  function getCardClusterKey(card) {
    const layers = getCardLayers(card);
    if (layers[1]) return `layer:${layers[0]}/${layers[1]}`;
    if (layers[0]) return `layer:${layers[0]}`;
    const tags = getCardTags(card);
    if (tags[0]) return `tag:${tags[0]}`;
    const record = getCardRecord(card);
    if (card?.memoryKind === "analysis" && Array.isArray(record?.quoteRefs) && record.quoteRefs.length > 0) {
      return `analysis:${record.quoteRefs[0].quoteId || record.quoteRefs[0].id || record.id}`;
    }
    const difficulty = Math.round(Number(card?.memoryState?.D || 1));
    return `difficulty:${difficulty}`;
  }

  function getCardRouteFacts(card, userProfile = state.userProfile) {
    const ms = card?.memoryState || {};
    const phase = getUserLearningPhase(card, userProfile);
    return {
      phase,
      subject: getCardSubject(card),
      layers: getCardLayers(card),
      tags: getCardTags(card),
      cluster: getCardClusterKey(card),
      priorityBand: getCardPriorityBand(card),
      quotePriority: getQuotePriorityForCard(card),
      uncertainty: clampNumber(Number(ms.U ?? 0.5), 0, 1),
      stability: clampNumber(Number(ms.S ?? 1), 0.1, 1000),
      reviewCount: Number(ms.reviewCount || 0),
      lastReview: Number(ms.lastReview || 0),
      nextReview: Number(ms.nextReview || 0),
      recentFailure: Array.isArray(ms.recentGrades) && ms.recentGrades.slice(-3).includes("didnt_know"),
      hasAnalysisGraph: card?.memoryKind === "analysis" || (Array.isArray(card?.back?.analyses) && card.back.analyses.length > 0)
    };
  }

  function incrementMap(map, key, amount = 1) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + amount);
  }

  function mapToRankedArray(map, limit = 12) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  }

  function entropyFromMap(map, total) {
    if (!total) return 0;
    return [...map.values()].reduce((sum, count) => {
      const p = count / total;
      return p > 0 ? sum - p * Math.log2(p) : sum;
    }, 0);
  }

  function structuralIgnitionSample(cards, userProfile = state.userProfile) {
    const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
    const maxSample = clampNumber(Math.round(Math.sqrt(list.length) * 6), 16, 64);
    if (list.length <= maxSample) return [...list];

    const selected = [];
    const selectedKeys = new Set();
    const addCard = (card) => {
      const key = getCardQueueKey(card);
      if (!card || (key && selectedKeys.has(key)) || selected.length >= maxSample) return;
      selected.push(card);
      if (key) selectedKeys.add(key);
    };

    const byScore = [...list].sort((a, b) => {
      const af = getCardRouteFacts(a, userProfile);
      const bf = getCardRouteFacts(b, userProfile);
      const aScore = af.uncertainty * 2 + (af.reviewCount === 0 ? 1.4 : 0) + ((af.quotePriority || 3) - 3) * 0.5 + (af.recentFailure ? 1 : 0);
      const bScore = bf.uncertainty * 2 + (bf.reviewCount === 0 ? 1.4 : 0) + ((bf.quotePriority || 3) - 3) * 0.5 + (bf.recentFailure ? 1 : 0);
      return bScore - aScore;
    });
    byScore.slice(0, Math.ceil(maxSample * 0.4)).forEach(addCard);

    const seenBands = {
      cluster: new Set(),
      layer: new Set(),
      tag: new Set(),
      priority: new Set()
    };
    byScore.forEach((card) => {
      if (selected.length >= maxSample) return;
      const facts = getCardRouteFacts(card, userProfile);
      const layer = facts.layers[0] || "";
      const tag = facts.tags[0] || "";
      if (!seenBands.cluster.has(facts.cluster) || (layer && !seenBands.layer.has(layer)) || (tag && !seenBands.tag.has(tag)) || !seenBands.priority.has(facts.priorityBand)) {
        addCard(card);
        seenBands.cluster.add(facts.cluster);
        if (layer) seenBands.layer.add(layer);
        if (tag) seenBands.tag.add(tag);
        seenBands.priority.add(facts.priorityBand);
      }
    });

    byScore.forEach(addCard);
    return selected;
  }

  function deriveStartType(cards, sessionHistory = []) {
    const list = Array.isArray(cards) ? cards : [];
    if (list.length === 0) return "cold_start";
    const reviewed = list.filter((card) => Number(card?.memoryState?.reviewCount || 0) > 0).length;
    const stable = list.filter((card) => {
      const phase = getUserLearningPhase(card, state.userProfile);
      return phase === "stable" || phase === "mastered";
    }).length;
    const avgUncertainty = list.reduce((sum, card) => sum + Number(card?.memoryState?.U ?? 0.5), 0) / list.length;
    const hasRecentHistory = Array.isArray(sessionHistory) && sessionHistory.some((card) => Number(card?.memoryState?.reviewCount || 0) > 0);
    const reviewedRatio = reviewed / list.length;
    const stableRatio = stable / list.length;

    if (reviewedRatio < 0.25 && stableRatio < 0.2 && avgUncertainty >= 0.45 && !hasRecentHistory) return "cold_start";
    if (reviewedRatio < 0.15 && list.length >= 40) return "cold_start";
    return "warm_start";
  }

  function buildLearningSystemState(cards, userProfile = state.userProfile) {
    const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
    const sample = structuralIgnitionSample(list, userProfile);
    const phaseCounts = new Map();
    const clusterMap = new Map();
    const layerMap = new Map();
    const tagMap = new Map();
    const priorityDistribution = new Map();
    const uncertaintyMap = new Map();
    const difficultyDistribution = new Map();
    const subjectMap = new Map();
    const nowMs = Date.now();

    let newCount = 0;
    let masteredCount = 0;
    let totalUncertainty = 0;
    let instabilityTotal = 0;
    let recentFailureCount = 0;
    let decayingMasteredCount = 0;
    let analysisLinkedCount = 0;

    sample.forEach((card) => {
      const facts = getCardRouteFacts(card, userProfile);
      totalUncertainty += facts.uncertainty;
      if (facts.phase === "new") newCount++;
      if (facts.phase === "mastered" || facts.phase === "stable") masteredCount++;
      if (facts.recentFailure) recentFailureCount++;
      if (facts.hasAnalysisGraph) analysisLinkedCount++;
      if ((facts.phase === "mastered" || facts.phase === "stable") && facts.nextReview > 0 && facts.nextReview < nowMs && facts.uncertainty > 0.35) {
        decayingMasteredCount++;
      }
      instabilityTotal += facts.uncertainty + (facts.recentFailure ? 0.5 : 0) + (facts.stability < 1 ? 0.25 : 0);
      incrementMap(phaseCounts, facts.phase);
      incrementMap(clusterMap, facts.cluster);
      incrementMap(subjectMap, facts.subject);
      incrementMap(priorityDistribution, facts.priorityBand);
      facts.layers.forEach((layer, index) => incrementMap(layerMap, index === 0 ? layer : `${facts.layers[0]} > ${layer}`));
      facts.tags.forEach((tag) => incrementMap(tagMap, tag));
      incrementMap(uncertaintyMap, facts.cluster, facts.uncertainty);
      incrementMap(difficultyDistribution, Math.round(Number(card?.memoryState?.D || 1)));
    });

    const heapSize = list.length;
    const observedSize = sample.length || heapSize;
    return {
      heapSize,
      sampleSize: sample.length,
      structuralSampleKeys: sample.map(getCardQueueKey).filter(Boolean),
      clusterMap: mapToRankedArray(clusterMap, 16),
      difficultyDistribution: mapToRankedArray(difficultyDistribution, 8),
      uncertaintyMap: mapToRankedArray(uncertaintyMap, 16),
      layerMap: mapToRankedArray(layerMap, 16),
      tagMap: mapToRankedArray(tagMap, 16),
      phaseDistribution: Object.fromEntries(phaseCounts),
      priorityDistribution: Object.fromEntries(priorityDistribution),
      subjectDistribution: mapToRankedArray(subjectMap, 8),
      newCardRatio: observedSize ? newCount / observedSize : 0,
      masteryRatio: observedSize ? masteredCount / observedSize : 0,
      avgUncertainty: observedSize ? totalUncertainty / observedSize : 0,
      instabilityScore: observedSize ? instabilityTotal / observedSize : 0,
      recentFailureRate: observedSize ? recentFailureCount / observedSize : 0,
      decayingMasteredRatio: observedSize ? decayingMasteredCount / observedSize : 0,
      analysisGraphDensity: observedSize ? analysisLinkedCount / observedSize : 0,
      clusterEntropy: entropyFromMap(clusterMap, observedSize),
      layerDensity: observedSize ? layerMap.size / observedSize : 0,
      tagDensity: observedSize ? tagMap.size / observedSize : 0
    };
  }

  function buildRouteScope(route, metadata = {}) {
    const systemState = metadata.systemState || {};
    const topClusters = (systemState.clusterMap || []).slice(0, route.mode === "focused_block" ? 2 : 4).map((x) => x.name);
    const topLayers = (systemState.layerMap || []).slice(0, 4).map((x) => x.name.split(" > ")[0]);
    const topTags = (systemState.tagMap || []).slice(0, 5).map((x) => x.name);
    const subjects = (systemState.subjectDistribution || []).slice(0, 3).map((x) => x.name).filter(Boolean);

    if (route.mode === "rapid_sweep") {
      return {
        subjects,
        layers: topLayers,
        tags: topTags,
        clusters: (systemState.clusterMap || []).slice(0, 8).map((x) => x.name),
        priorityBands: ["high", "medium", "low"]
      };
    }
    if (route.mode === "repair_cycle") {
      return {
        subjects,
        layers: topLayers,
        tags: topTags,
        clusters: topClusters,
        priorityBands: ["high", "medium"]
      };
    }
    if (route.mode === "focused_block") {
      return {
        subjects,
        layers: topLayers.slice(0, 2),
        tags: topTags.slice(0, 3),
        clusters: topClusters,
        priorityBands: ["high", "medium"]
      };
    }
    return {
      subjects,
      layers: state.sessionFilter?.layers || [],
      tags: state.sessionFilter?.tags || [],
      clusters: [],
      priorityBands: ["high", "medium", "low"]
    };
  }

  function selectLearningRoute(routeState, userProfile = state.userProfile) {
    const cards = Array.isArray(routeState?.cards) ? routeState.cards : [];
    const systemState = routeState?.systemState || buildLearningSystemState(cards, userProfile);
    const startType = deriveStartType(cards, routeState?.sessionHistory || []);
    const heapSize = systemState.heapSize || cards.length;
    let mode = "global_srs";
    let heapConstruction = "global";
    let samplingStrategy = "mixed";
    let aggressiveness = 0.35;
    let interleaveRate = 0.08;

    if (heapSize < 20) {
      mode = "global_srs";
      heapConstruction = "global";
      samplingStrategy = "priority";
      aggressiveness = 0.25;
      interleaveRate = 0.05;
    } else if (startType === "cold_start" && heapSize >= 80 && systemState.clusterEntropy > 1) {
      mode = "rapid_sweep";
      heapConstruction = "sampled";
      samplingStrategy = "stratified";
      aggressiveness = 0.55;
      interleaveRate = 0.12;
    } else if (systemState.newCardRatio > 0.6 || (startType === "cold_start" && systemState.newCardRatio > 0.35)) {
      mode = "focused_block";
      heapConstruction = "local";
      samplingStrategy = "mixed";
      aggressiveness = 0.72;
      interleaveRate = 0.15;
    } else if (startType === "warm_start" && (systemState.decayingMasteredRatio > 0.08 || systemState.recentFailureRate > 0.18 || systemState.instabilityScore > 0.95)) {
      mode = "repair_cycle";
      heapConstruction = "clustered";
      samplingStrategy = "uncertainty";
      aggressiveness = 0.62;
      interleaveRate = 0.22;
    } else if (systemState.masteryRatio > 0.55 && systemState.avgUncertainty < 0.42) {
      mode = "global_srs";
      heapConstruction = "global";
      samplingStrategy = "priority";
      aggressiveness = 0.3;
      interleaveRate = 0.08;
    } else {
      mode = "focused_block";
      heapConstruction = "local";
      samplingStrategy = "mixed";
      aggressiveness = 0.58;
      interleaveRate = 0.16;
    }

    const route = {
      mode,
      startType,
      scope: {
        subjects: [],
        layers: [],
        tags: [],
        clusters: [],
        priorityBands: []
      },
      heapConstruction,
      samplingStrategy,
      aggressiveness,
      interleaveRate
    };
    route.scope = buildRouteScope(route, { systemState });
    return route;
  }

  function routeScopeMatches(card, route) {
    if (!route?.scope) return true;
    const facts = getCardRouteFacts(card, state.userProfile);
    const scope = route.scope;
    const subjectMatch = scope.subjects.length === 0 || scope.subjects.includes(facts.subject);
    const clusterMatch = scope.clusters.length === 0 || scope.clusters.includes(facts.cluster);
    const layerMatch = scope.layers.length === 0 || facts.layers.some((layer) => scope.layers.includes(layer));
    const tagMatch = scope.tags.length === 0 || facts.tags.some((tag) => scope.tags.includes(tag));
    const priorityMatch = scope.priorityBands.length === 0 || scope.priorityBands.includes(facts.priorityBand);
    return subjectMatch && priorityMatch && (clusterMatch || layerMatch || tagMatch || scope.clusters.length === 0);
  }

  function rankCardsForRoute(cards, route, userProfile = state.userProfile) {
    const nowMs = Date.now();
    return [...(cards || [])].sort((a, b) => {
      const aPriority = computeModePriority(a, route, userProfile, nowMs);
      const bPriority = computeModePriority(b, route, userProfile, nowMs);
      return bPriority - aPriority;
    });
  }

  function takeDiverseSample(cards, route, maxSize) {
    const sorted = rankCardsForRoute(cards, route, state.userProfile);
    const selected = [];
    const keys = new Set();
    const buckets = new Map();
    sorted.forEach((card) => {
      const facts = getCardRouteFacts(card, state.userProfile);
      const bucket = `${facts.priorityBand}:${facts.layers[0] || "none"}:${facts.tags[0] || "untagged"}:${facts.cluster}`;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(card);
    });
    const bucketLists = [...buckets.values()];
    while (selected.length < maxSize && bucketLists.some((bucket) => bucket.length > 0)) {
      for (const bucket of bucketLists) {
        const card = bucket.shift();
        const key = getCardQueueKey(card);
        if (card && (!key || !keys.has(key))) {
          selected.push(card);
          if (key) keys.add(key);
        }
        if (selected.length >= maxSize) break;
      }
    }
    return selected;
  }

  function buildActiveHeap(route, cards) {
    const allCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
    if (route?.mode === "global_srs") {
      return { activeCards: allCards, remainder: [] };
    }

    let scopedCards = allCards.filter((card) => routeScopeMatches(card, route));
    if (scopedCards.length === 0) scopedCards = allCards;

    if (route.mode === "rapid_sweep") {
      const maxSize = clampNumber(Math.round(24 + Math.sqrt(allCards.length) * 3), 24, 72);
      const activeCards = takeDiverseSample(scopedCards, route, Math.min(maxSize, scopedCards.length));
      const activeKeys = new Set(activeCards.map(getCardQueueKey).filter(Boolean));
      return { activeCards, remainder: allCards.filter((card) => !activeKeys.has(getCardQueueKey(card))) };
    }

    if (route.mode === "focused_block") {
      const speed = clampNumber(Number(state.userProfile.learningSpeedFactor || 1), 0.45, 1.8);
      const maxBlockSize = clampNumber(Math.round(10 * speed), 6, 18);
      const activeCards = rankCardsForRoute(scopedCards, route, state.userProfile).slice(0, maxBlockSize);
      const activeKeys = new Set(activeCards.map(getCardQueueKey).filter(Boolean));
      return { activeCards, remainder: allCards.filter((card) => !activeKeys.has(getCardQueueKey(card))) };
    }

    if (route.mode === "repair_cycle") {
      const maxSize = clampNumber(Math.round(28 + state.userProfile.expectedTrialsToMastery * 4), 28, 56);
      const activeCards = rankCardsForRoute(scopedCards, route, state.userProfile).slice(0, maxSize);
      const activeKeys = new Set(activeCards.map(getCardQueueKey).filter(Boolean));
      return { activeCards, remainder: allCards.filter((card) => !activeKeys.has(getCardQueueKey(card))) };
    }

    return { activeCards: scopedCards, remainder: allCards.filter((card) => !scopedCards.includes(card)) };
  }

  function computeModePriority(card, route, userProfile = state.userProfile, nowMs = Date.now()) {
    const phase = getUserLearningPhase(card, userProfile);
    const quotePriority = getQuotePriorityForCard(card);
    const base = computePriority(card.memoryState || {}, nowMs, quotePriority, {
      phase,
      heapSize: (state.session.heap?.size?.() || 0) + state.session.surprisePool.length
    });
    const facts = getCardRouteFacts(card, userProfile);
    let boost = 0;
    if (route?.mode === "focused_block") {
      boost += (phase === "new" || phase === "warming" || phase === "stabilising") ? 1.4 : -0.25;
      boost += routeScopeMatches(card, route) ? 0.7 : 0;
    } else if (route?.mode === "rapid_sweep") {
      boost += facts.reviewCount === 0 ? 0.9 : 0;
      boost += facts.priorityBand === "high" ? 0.7 : facts.priorityBand === "low" ? -0.15 : 0.25;
      boost += facts.uncertainty * 0.6;
    } else if (route?.mode === "repair_cycle") {
      boost += (phase === "stable" || phase === "mastered") ? 0.65 : 0;
      boost += facts.recentFailure ? 1.3 : 0;
      boost += facts.nextReview > 0 && facts.nextReview < nowMs ? 0.9 : 0;
      boost += facts.uncertainty * 1.2;
    }
    if (facts.hasAnalysisGraph && route?.startType === "warm_start") boost += 0.25;
    return base + boost * clampNumber(Number(route?.aggressiveness ?? 0.4), 0, 1);
  }

  function shouldInterleaveOldCard(route, sessionStats = state.stats) {
    const baseRate = clampNumber(Number(route?.interleaveRate ?? 0.08), 0, 0.6);
    const streakBoost = Number(sessionStats?.streak || 0) >= 4 ? 0.08 : 0;
    const completionBoost = isFocusedBlockComplete() ? 0.65 : 0;
    return Math.random() < clampNumber(baseRate + streakBoost + completionBoost, 0, 1);
  }

  function shouldReinsertReviewedCard(card, grade, route) {
    if (!card?.memoryState) return false;
    // Manual heaps are studied once, in the exact saved order.
    if (route?.mode === "manual_heap") return false;
    if (grade === "didnt_know") return true;
    if (route?.mode === "rapid_sweep") return grade !== "easy" || Number(card.memoryState.U ?? 1) > 0.65;
    if (route?.mode === "repair_cycle") return grade !== "easy" || Number(card.memoryState.U ?? 1) > 0.42;
    if (route?.mode === "focused_block") return grade !== "easy" || !isFocusedBlockComplete();
    return true;
  }

  function enqueueLearningCards(cards, nowMs, focusCardId = null) {
    const allCards = Array.isArray(cards) ? cards : [];
    state.session.surprisePool = [];
    state.session.focusedBlockKeys = new Set();
    state.session.systemState = buildLearningSystemState(allCards, state.userProfile);
    state.session.learningRoute = selectLearningRoute({
      cards: allCards,
      sessionHistory: state.flashcards,
      systemState: state.session.systemState
    }, state.userProfile);
    state.session.learningMode = state.session.learningRoute.mode;

    // Update router debug info
    updateRouterDebug(state.session.learningRoute, state.session.systemState, []);

    const { activeCards, remainder } = buildActiveHeap(state.session.learningRoute, allCards);
    // An explicit card target must survive route scoping. Pull it out of the
    // remainder if necessary and give it top priority so it is the first card
    // the learner sees, without changing the normal SRS path afterwards.
    const target = focusCardId
      ? allCards.find((card) => (card.record?.id || card.id) === focusCardId)
      : null;
    if (target && !activeCards.includes(target)) {
      const remainderIndex = remainder.indexOf(target);
      if (remainderIndex !== -1) remainder.splice(remainderIndex, 1);
      activeCards.unshift(target);
    }
    state.session.surprisePool = remainder;
    if (state.session.learningRoute.mode === "focused_block") {
      state.session.focusedBlockKeys = new Set(activeCards.map(getCardQueueKey).filter(Boolean));
    }

    activeCards.forEach((card) => {
      const phase = getUserLearningPhase(card, state.userProfile);
      card.memoryState.L_phase = phase;
      const isTarget = target === card;
      const priority = isTarget
        ? Number.POSITIVE_INFINITY
        : computeModePriority(card, state.session.learningRoute, state.userProfile, nowMs);
      state.session.heap.push({ priority, card });
    });
  }

  function rerouteRemainingLearningScope() {
    if (!Array.isArray(state.session.surprisePool) || state.session.surprisePool.length === 0 || !state.session.heap) return;
    const remaining = state.session.surprisePool;
    state.session.surprisePool = [];
    state.session.systemState = buildLearningSystemState(remaining, state.userProfile);
    state.session.learningRoute = selectLearningRoute({
      cards: remaining,
      sessionHistory: state.flashcards,
      systemState: state.session.systemState
    }, state.userProfile);
    state.session.learningMode = state.session.learningRoute.mode;
    state.session.routeRerouteCounter = Number(state.session.routeRerouteCounter || 0) + 1;

    // Update router debug info
    updateRouterDebug(state.session.learningRoute, state.session.systemState, []);

    const { activeCards, remainder } = buildActiveHeap(state.session.learningRoute, remaining);
    state.session.surprisePool = remainder;
    state.session.focusedBlockKeys = state.session.learningRoute.mode === "focused_block"
      ? new Set(activeCards.map(getCardQueueKey).filter(Boolean))
      : new Set();
    const nowMs = Date.now();
    activeCards.forEach((card) => {
      const phase = getUserLearningPhase(card, state.userProfile);
      card.memoryState.L_phase = phase;
      state.session.heap.push({
        priority: computeModePriority(card, state.session.learningRoute, state.userProfile, nowMs),
        card
      });
    });
  }

  function isFocusedBlockComplete() {
    if (state.session.learningMode !== "focused_block" || !state.session.focusedBlockKeys?.size) return false;
    const blockCards = [
      ...state.flashcards,
      ...(state.session.heap?.items || []).map((item) => item.card)
    ].filter((card) => state.session.focusedBlockKeys.has(getCardQueueKey(card)));
    if (blockCards.length === 0) return false;
    const avgEasyStreak = blockCards.reduce((sum, card) => sum + Number(card?.memoryState?.easyStreak || 0), 0) / blockCards.length;
    const avgUncertainty = blockCards.reduce((sum, card) => sum + Number(card?.memoryState?.U ?? 1), 0) / blockCards.length;
    const targetStreak = clampNumber(Math.round(state.userProfile.expectedTrialsToMastery / 2), 3, 5);
    const threshold = state.userProfile.phaseThresholds?.stableUncertainty ?? 0.32;
    return avgEasyStreak >= targetStreak && avgUncertainty < threshold;
  }

  async function maybeEnqueueSurpriseCard() {
    if (
      state.currentMode !== "card-learning"
      && state.currentMode !== "quote-learning"
      && state.currentMode !== "analysis-learning"
      && state.currentMode !== "blurt"
    ) return;
    if (!state.session.heap) return;
    if (!Array.isArray(state.session.surprisePool) || state.session.surprisePool.length === 0) return;
    if (!shouldInterleaveOldCard(state.session.learningRoute, state.stats)) return;

    const idx = Math.floor(Math.random() * state.session.surprisePool.length);
    const candidate = state.session.surprisePool.splice(idx, 1)[0];
    if (candidate?.review && candidate?.memoryState) {
      if (state.flashcards.some((c) => getCardQueueKey(c) === getCardQueueKey(candidate)) || state.session.heap.hasCard(candidate)) return;
      const phase = getUserLearningPhase(candidate, state.userProfile);
      const priority = computeModePriority(candidate, state.session.learningRoute, state.userProfile, Date.now()) + 0.7;
      state.session.heap.push({ priority, card: candidate });
      return;
    }
    if (!candidate?.record?.id) return;

    const alreadySeen = state.flashcards.some((c) => c?.record?.id === candidate.record.id || c?.id === candidate.record.id);
    if (alreadySeen) return;

    const nowMs = Date.now();
    let card = null;

    if (candidate.memoryKind === "card") {
      const cardRecord = candidate.record;
      card = {
        id: cardRecord.id,
        memoryKind: "card",
        type: "card-learning",
        record: cardRecord,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: cardRecord.front,
          isCard: true,
          deck: cardRecord.deck,
          deckPath: cardRecord.deckPath || []
        },
        back: {
          content: cardRecord.back,
          isCard: true,
          deck: cardRecord.deck,
          deckPath: cardRecord.deckPath || [],
          tags: cardRecord.tags || []
        },
        memoryState: candidate.memoryState
      };
    } else if (candidate.memoryKind === "quote") {
      const quote = candidate.record;
      const analyses = await getAnalysesReferencingQuote(quote.id);
      // Fetch source node to enable formatted quote rendering
      let sourceNode = null;
      if (quote.link?.sourceId) {
        sourceNode = await getNode(quote.link.sourceId);
      }

      card = {
        id: quote.id,
        memoryKind: "quote",
        type: "quote-learning",
        record: quote,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: quote.section ? `Recall the quote from: ${quote.section}` : "Recall this quote",
          isCue: true
        },
        back: {
          content: quote.quote,
          isQuote: true,
          quoteData: quote,
          sourceNode,
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
    const priority = computeModePriority(card, state.session.learningRoute, state.userProfile, nowMs) + 0.7;
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

  async function buildCardLearningQueue(focusCardId = null) {
    const nowMs = Date.now();
    const deckCards = await loadScopedCards();
    const ordered = [...(deckCards || [])].sort((a, b) => {
      const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderDiff !== 0) return orderDiff;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });

    state.session.surprisePool = [];

    const cards = ordered.map(createCardStudyItem);

    // Apply filters if set
    let filteredCards = cards;
    if (state.sessionFilter) {
      filteredCards = cards.filter(card => {
        return passesFilter(card, state.sessionFilter);
      });
    }

    enqueueLearningCards(filteredCards, nowMs, focusCardId);
  }

  // Manual study follows a saved heap exactly. It deliberately bypasses route
  // selection, interleaving, surprise cards, and re-insertion; grading still
  // writes the normal SRS memory state through gradeCurrentCard().
  async function buildManualHeapQueue() {
    const heap = typeof getHeap === "function"
      ? await getHeap(state.manualHeapId).catch(() => null)
      : getActiveManualHeap();

    state.session.surprisePool = [];
    state.session.focusedBlockKeys = new Set();
    state.session.learningRoute = {
      mode: "manual_heap",
      startType: "manual",
      scope: { subjects: [], layers: [], tags: [], clusters: [], priorityBands: [] },
      heapConstruction: "manual",
      samplingStrategy: "heap_order",
      aggressiveness: 0,
      interleaveRate: 0
    };
    state.session.learningMode = "manual_heap";

    if (!heap) {
      state.session.systemState = buildLearningSystemState([], state.userProfile);
      updateRouterDebug(state.session.learningRoute, state.session.systemState, []);
      return;
    }

    const allCards = await getAllCards();
    const cardsById = new Map((allCards || []).map((card) => [card.id, card]));
    const ordered = (heap.cardIds || []).map((id) => cardsById.get(id)).filter(Boolean);

    state.session.systemState = buildLearningSystemState(ordered, state.userProfile);
    updateRouterDebug(state.session.learningRoute, state.session.systemState, []);

    ordered.forEach((record, index) => {
      const card = createCardStudyItem(record);
      const phase = getUserLearningPhase(card, state.userProfile);
      card.memoryState.L_phase = phase;
      // Higher priority pops first; the saved heap order is the only order.
      state.session.heap.push({ priority: ordered.length - index, card });
    });
  }

  // Quotes are optional knowledge, not the study unit. This mode is a plain
  // recall pass over the deck's linked quotes; it never reads or writes the
  // legacy cue pair.
  async function buildQuoteLearningQueue() {
    const nowMs = Date.now();
    const [allQuotes, allSources] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAllNodes().then((nodes) => (nodes || []).filter((node) => node.type === "source"))
    ]);

    const sourcesById = new Map((allSources || []).map((source) => [source.id, source]));
    state.session.surprisePool = [];

    const cards = await Promise.all(
      (allQuotes || []).map(async (quote) => {
        const analyses = await getAnalysesReferencingQuote(quote.id);
        const sourceNode = sourcesById.get(quote.link?.sourceId) || null;
        return {
          id: quote.id,
          memoryKind: "quote",
          type: "quote-learning",
          record: quote,
          review: { required: true, graded: false, grade: null, responseTimeMs: null },
          front: {
            content: quote.section ? `Recall the quote from: ${quote.section}` : "Recall this quote",
            isCue: true
          },
          back: {
            content: quote.quote,
            isQuote: true,
            quoteData: quote,
            sourceNode,
            analyses
          },
          memoryState: getMemoryStateFromMeta(quote.meta || {}, "quote")
        };
      })
    );

    let filteredCards = cards;
    if (state.sessionFilter) {
      filteredCards = cards.filter((card) => passesFilter(card, state.sessionFilter));
    }

    enqueueLearningCards(filteredCards, nowMs);
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

    // Apply filters if set
    let filteredCards = cards;
    if (state.sessionFilter) {
      filteredCards = cards.filter(card => {
        return passesFilter(card, state.sessionFilter);
      });
    }

    enqueueLearningCards(filteredCards, nowMs);
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

    const cards = [];

    for (const cue of subjectCues) {
      let targetKind = null;
      let targetRecord = null;
      if (cue.quoteId && quotesById.has(cue.quoteId)) {
        targetKind = "quote";
        targetRecord = quotesById.get(cue.quoteId);
      } else if (cue.analysisId && analysesById.has(cue.analysisId)) {
        targetKind = "analysis";
        targetRecord = analysesById.get(cue.analysisId);
      } else {
        continue;
      }

      const memoryState = getMemoryStateFromMeta(targetRecord.meta || {}, targetKind);
      // Blurt is harder, so we expect more time
      memoryState.expectedTime = Math.max(memoryState.expectedTime, getExpectedTimeMs("blurt") / 1000);

      // Fetch source node for quote targets to enable formatted rendering
      let targetSourceNode = null;
      if (targetKind === "quote" && targetRecord.link?.sourceId) {
        targetSourceNode = await getNode(targetRecord.link.sourceId);
      }

      const card = {
        id: cue.id,
        memoryKind: "blurt",
        type: "blurt",
        cue,
        targetKind,
        targetRecord,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: { content: cue.cue, isCue: true },
        back: {
          isBlurtInput: true,
          targetContent: targetKind === "quote" ? targetRecord.quote : targetRecord.analysis,
          targetRecord,
          targetKind,
          sourceNode: targetSourceNode
        },
        blurt: { submitted: false, text: "" },
        memoryState
      };

      cards.push(card);
    }
    enqueueLearningCards(cards, nowMs);
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

    const [quotes, analyses, cards] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject),
      loadScopedCards()
    ]);

    const srsKeys = ["S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount", "expectedTime", "avgTime", "timeVariance", "consistency", "confidence", "lastGrade"];

    state.session.suppressDBChange = (quotes || []).length + (analyses || []).length + (cards || []).length;

    const promises = [];

    for (const card of (cards || [])) {
      if (card.meta) {
        srsKeys.forEach(key => delete card.meta[key]);
        promises.push(addCard(card));
      }
    }

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

  function linkedContextEmptyHtml(title, copy) {
    return `
      <div class="study-context-empty">
        <div class="study-context-empty-icon" aria-hidden="true">◇</div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(copy)}</span>
      </div>
    `;
  }

  // Linked knowledge lives in Inspect, never inside the card. Records use
  // different shapes across modes: cards have `links`, quotes have `link`,
  // analyses have `quoteRefs`, and blurt cards point at a target record.
  function contextQuoteSection(quote, label = "Linked quote") {
    const text = String(quote?.quote || quote?.content || "").trim();
    if (!text) return "";
    const section = String(quote?.section || "").trim();
    return `
      <section class="study-context-section" data-context-kind="quote">
        <div class="study-context-label">${escapeHtml(label)}</div>
        <blockquote class="study-context-quote">${escapeHtml(text)}</blockquote>
        ${section ? `<div class="study-context-meta">${escapeHtml(section)}</div>` : ""}
      </section>
    `;
  }

  function contextAnalysisSection(analysis, label = "Linked analysis") {
    const title = String(analysis?.title || "").trim();
    const text = String(analysis?.analysis || analysis?.content || "").trim();
    if (!title && !text) return "";
    return `
      <section class="study-context-section" data-context-kind="analysis">
        <div class="study-context-label">${escapeHtml(label)}</div>
        ${title ? `<div class="study-context-section-title">${escapeHtml(title)}</div>` : ""}
        ${text ? `<div class="study-context-analysis">${formatAnalysisForDisplay(text)}</div>` : ""}
      </section>
    `;
  }

  function contextSourceSection(source, label = "Source") {
    const title = String(source?.title || source?.name || "Untitled source").trim();
    const meta = [source?.subject, source?.section]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" · ");
    return `
      <section class="study-context-section" data-context-kind="source">
        <div class="study-context-label">${escapeHtml(label)}</div>
        <div class="study-context-section-title">${escapeHtml(title)}</div>
        ${meta ? `<div class="study-context-meta">${escapeHtml(meta)}</div>` : ""}
      </section>
    `;
  }

  async function getContextQuote(id) {
    if (!id || typeof getQuote !== "function") return null;
    return getQuote(id).catch(() => null);
  }

  async function getContextNode(id) {
    if (!id || typeof getNode !== "function") return null;
    return getNode(id).catch(() => null);
  }

  async function buildCardLinkedContext(record) {
    const links = record?.links && typeof record.links === "object" ? record.links : {};
    const quote = await getContextQuote(links.quoteId);
    const nodeIds = [...new Set([
      links.analysisId,
      links.nodeId,
      links.sourceId
    ].filter(Boolean))];
    const nodes = await Promise.all(nodeIds.map(getContextNode));
    const nodeMap = new Map(nodes.filter(Boolean).map((node) => [node.id, node]));

    const linkedNode = links.nodeId ? nodeMap.get(links.nodeId) : null;
    const analysisNode = (links.analysisId ? nodeMap.get(links.analysisId) : null)
      || (linkedNode?.type === "analysis" ? linkedNode : null);
    let sourceNode = (links.sourceId ? nodeMap.get(links.sourceId) : null)
      || (linkedNode?.type === "source" ? linkedNode : null);
    if (!sourceNode && quote?.link?.sourceId) {
      sourceNode = await getContextNode(quote.link.sourceId);
    }

    const sections = [];
    if (quote) sections.push(contextQuoteSection(quote, "Linked quote"));
    if (analysisNode) sections.push(contextAnalysisSection(analysisNode, "Linked analysis"));
    if (sourceNode) sections.push(contextSourceSection(sourceNode, "Source"));

    if (sections.length) return sections.join("");
    if (Object.values(links).some(Boolean)) {
      return linkedContextEmptyHtml(
        "Linked context is unavailable",
        "The linked record may have been deleted. This card still stands on its own."
      );
    }
    return linkedContextEmptyHtml(
      "No linked knowledge context",
      "This card stands on its own. Link a quote, analysis, or source when you want context recorded beside it."
    );
  }

  async function buildQuoteLinkedContext(quote) {
    const sections = [];
    const sourceNode = await getContextNode(quote?.link?.sourceId);
    if (sourceNode) sections.push(contextSourceSection(sourceNode, "Source"));

    const analyses = typeof getAnalysesReferencingQuote === "function"
      ? await getAnalysesReferencingQuote(quote.id).catch(() => [])
      : [];
    (analyses || []).filter(Boolean).forEach((analysis) => {
      const html = contextAnalysisSection(analysis, "Linked analysis");
      if (html) sections.push(html);
    });

    if (sections.length) return sections.join("");
    return linkedContextEmptyHtml(
      "No linked source or analyses",
      "This quote stands on its own. Link a source or analysis in Mindmap."
    );
  }

  async function buildAnalysisLinkedContext(analysis) {
    const refs = Array.isArray(analysis?.quoteRefs) ? analysis.quoteRefs : [];
    const quotes = typeof getQuotesReferencedByAnalysis === "function"
      ? await getQuotesReferencedByAnalysis(analysis.id).catch(() => [])
      : [];
    const quoteMap = new Map((quotes || []).filter(Boolean).map((quote) => [quote.id, quote]));

    const sections = [];
    const seenQuotes = new Set();
    const seenSources = new Set();
    const sourceIds = [];

    const addQuote = (quote, ref = null) => {
      const id = quote?.id || ref?.quoteId || "";
      if (id && seenQuotes.has(id)) return;
      if (id) seenQuotes.add(id);
      const html = contextQuoteSection(
        quote || { quote: ref?.quote, section: ref?.section },
        "Evidence quote"
      );
      if (!html) return;
      sections.push(html);

      const sourceId = quote?.link?.sourceId || ref?.sourceId;
      if (sourceId && !seenSources.has(sourceId)) {
        seenSources.add(sourceId);
        sourceIds.push(sourceId);
      }
    };

    refs.forEach((ref) => addQuote(quoteMap.get(ref.quoteId), ref));
    (quotes || []).filter(Boolean).forEach((quote) => addQuote(quote));

    const sources = await Promise.all(sourceIds.map(getContextNode));
    sources.filter(Boolean).forEach((source) => {
      sections.push(contextSourceSection(source, "Source"));
    });

    if (sections.length) return sections.join("");
    return linkedContextEmptyHtml(
      "No evidence quotes",
      "This analysis has no linked quotes yet. Link quotes in Analysis or Mindmap."
    );
  }

  async function buildLinkedContextHtml(record) {
    if (!record) return linkedContextEmptyHtml(
      "No card selected",
      "Open a card to see its linked quote, analysis, or source."
    );
    if (record.type === "quote") return buildQuoteLinkedContext(record);
    if (record.type === "analysis") return buildAnalysisLinkedContext(record);
    return buildCardLinkedContext(record);
  }

  async function renderInspectLinkedContext(card) {
    const host = document.getElementById("inspectLinkedContext");
    if (!host) return;
    const token = Number(state.inspectContextToken || 0) + 1;
    state.inspectContextToken = token;
    host.innerHTML = `<div class="study-context-loading">Loading linked context…</div>`;
    const html = await buildLinkedContextHtml(card);
    if (token !== state.inspectContextToken) return;
    host.innerHTML = html;
  }

  function renderUI() {
    if (!flashcardContainer || !flashcardContent || !flashcardBackContent) {
      getDOMElements();
    }

     if (state.view === "launchpad") {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "flex";
      if (memoryContent) memoryContent.style.display = "none";
      if (memoryBody) memoryBody.style.display = "none";
      if (middleUI) middleUI.style.display = "none";
      if (newSessionBtn) newSessionBtn.style.display = "none";
      if (statsBtn) statsBtn.style.display = "none";
      if (backToDecksBtn) backToDecksBtn.style.display = "none";
      if (memoryStats?.classList.contains("open")) setStatsOpen(false);
      return;
    } else if (state.view === "middle-ui") {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "none";
      if (memoryContent) memoryContent.style.display = "none";
      if (memoryBody) memoryBody.style.display = "none";
      if (middleUI) middleUI.style.display = "flex";
      if (newSessionBtn) newSessionBtn.style.display = "none";
      if (statsBtn) statsBtn.style.display = "none";
      if (backToDecksBtn) backToDecksBtn.style.display = "none";
      if (memoryStats?.classList.contains("open")) setStatsOpen(false);
      renderMiddleUI();
      return;
    } else {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "none";
      if (memoryContent) memoryContent.style.display = "flex";
      if (memoryBody) memoryBody.style.display = "flex";
      if (middleUI) middleUI.style.display = "none";
      if (newSessionBtn) newSessionBtn.style.display = "inline-block";
      if (statsBtn) statsBtn.style.display = "inline-block";
      if (backToDecksBtn) backToDecksBtn.style.display = "inline-block";
    }

    if (flashcardContainer) flashcardContainer.style.display =
      state.currentMode !== "evidence-matching" ? "flex" : "none";
    if (evidenceMatchingContainer) evidenceMatchingContainer.style.display =
      state.currentMode === "evidence-matching" ? "block" : "none";

    if (!state.currentSubject && state.currentMode !== "manual") {
      if (flashcardContent) flashcardContent.textContent = "Select a subject to start studying.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Use the sidebar to enter a subject.";
      return;
    }

    if (state.flashcards.length > 0 && state.currentIndex < state.flashcards.length) {
      const flashcardData = state.flashcards[state.currentIndex];
      updateFlashcardDisplay(flashcardData, flashcard);
    } else if (state.currentMode === "manual") {
      if (flashcardContent) flashcardContent.textContent = "This heap is empty or its cards were deleted.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Add cards in the Mindmap Library, then study the heap again.";
    } else {
      if (flashcardContent) flashcardContent.textContent = "No flashcards available.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Add cards with Quick Add.";
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
        requestAnimationFrame(() => {
          gradingControls.classList.add("visible");
        });
      } else {
        gradingControls.classList.remove("visible");
      }
    }

    // Show/hide priority toggle button (bottom-right)
    const priorityToggleBtn = document.getElementById("priorityToggle");
    const priorityCtrl = document.getElementById("priorityControls");
    if (priorityToggleBtn) {
      const isCard = currentCard?.memoryKind === "card"
        || currentCard?.memoryKind === "quote"
        || currentCard?.type === "card-learning"
        || currentCard?.type === "quote-learning";
      if (isCard && currentCard?.record?.priority !== undefined) {
        priorityToggleBtn.style.display = "block";
        priorityToggleBtn.textContent = `${"★".repeat(currentCard.record.priority)}${"☆".repeat(5 - currentCard.record.priority)}`;
      } else {
        priorityToggleBtn.style.display = "none";
        if (priorityCtrl) priorityCtrl.style.display = "none";
      }
    }

    if (state.currentMode === "evidence-matching") {
      renderEvidenceMatchingUI();
    }

    renderRoundProgress();

    // Stats used to poll every second, which rebuilt the panel and stole
    // focus. Refresh it only when the study state actually changes.
    if (memoryStats?.classList.contains("open")) renderSidebar();
  }

  function renderRoundProgress() {
    if (!roundProgress) return;
    roundProgress.innerHTML = "";

    const roundSize = 8;
    const isHeapMode = ["card-learning", "analysis-learning", "blurt", "manual"].includes(state.currentMode);

    // For heap-based modes, always show: already-seen history cards + upcoming from heap.
    // Card learning is heap-ranked too; the stable `order` only breaks ties and
    // determines the default browse order.
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
          const quoteData = flashcardData.back?.quoteData || flashcardData.front?.quoteData;
          const sourceNode = flashcardData.back?.sourceNode || null;
          // Use sourceNode for formatted quote; fall back to plain text
          const formatted = (sourceNode && quoteData)
            ? getFormattedQuote(quoteData, sourceNode)
            : escapeHtml(front.content || "");
          flashcardContent.innerHTML = `<div class="quote" id="front-quote-container">${formatted}</div>`;
        if (quoteData) {
          const section = quoteData.section || sourceNode?.section || "unknown source";
          flashcardContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(section)}</div>`;
        }
       // Show priority subtly in corner
       if (quoteData?.priority) {
         const stars = [1,2,3,4,5].map(v => v <= quoteData.priority ? "★" : "☆").join("");
         flashcardContent.innerHTML += `<div class="quote-priority-subtle">${stars}</div>`;
       }
    } else {
     flashcardContent.textContent = front.content || "";
     }

// Back content - Only populate if flipped to prevent spoiling the next card during transitions
    if (state.isFlipped) {
      if (back.isQuote) {
        const sourceNode = back.sourceNode || null;
        const formatted = (sourceNode && back.quoteData)
          ? getFormattedQuote(back.quoteData, sourceNode)
          : escapeHtml(back.content || "");
        flashcardBackContent.innerHTML = `<div class="quote" id="back-quote-container">${formatted}</div>`;
        if (back.quoteData) {
          const section = back.quoteData.section || sourceNode?.section || "unknown source";
          flashcardBackContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(section)}</div>`;
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
          // Use formatted quote if sourceNode is available
          const quoteMeta = `<div class="quote-meta">From: ${escapeHtml(back.targetRecord?.section || "unknown source")}</div>`;
          const formattedTarget = isQuoteTarget
            ? (back.sourceNode && back.targetRecord)
              ? `<div class="quote">${getFormattedQuote(back.targetRecord, back.sourceNode)}</div>${quoteMeta}`
              : `<div class="quote">${escapeHtml(targetText)}</div>${quoteMeta}`
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

  async function updateQuotePriority(recordId, newPriority) {
    if (!recordId) return;
    const currentCard = state.flashcards[state.currentIndex];
    const isCard = currentCard?.memoryKind === "card" && currentCard.record?.id === recordId;

    if (isCard) {
      if (typeof addCard !== "function") return;
      const priority = clampNumber(Number(newPriority), 1, 5);
      const updatedCard = {
        ...currentCard.record,
        priority,
        updatedAt: Date.now()
      };
      state.session.suppressDBChange++;
      await addCard(updatedCard);
      currentCard.record = updatedCard;

      const priorityToggleBtn = document.getElementById("priorityToggle");
      if (priorityToggleBtn) {
        priorityToggleBtn.textContent = `${"★".repeat(priority)}${"☆".repeat(5 - priority)}`;
      }
      renderUI();
      return;
    }

    if (!addQuote) return;
    const quote = await getQuote(recordId);
    if (!quote) return;

    quote.priority = clampNumber(Number(newPriority), 1, 5);
    quote.updatedAt = Date.now();

    state.session.suppressDBChange++;
    await addQuote(quote);

    // Update the current card if it's the same quote
    if (currentCard?.record?.id === recordId) {
      currentCard.record.priority = quote.priority;
    }

    // Update toggle button text
    const priorityToggleBtn = document.getElementById("priorityToggle");
    if (priorityToggleBtn && currentCard?.record?.id === recordId) {
      priorityToggleBtn.textContent = `Priority: ${"★".repeat(quote.priority)}${"☆".repeat(5 - quote.priority)}`;
    }

    renderUI();
    console.log(`Quote ${recordId} priority updated to ${newPriority}`);
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

  function renderStats() {
    if (!statsContent) return;

    const nowMs = Date.now();
    const heapItems = state.session.heap?.items
      ? [...state.session.heap.items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      : [];

    peekCardCache.clear();
    [...(state.flashcards || []), ...heapItems.map((item) => item.card)].forEach((card) => {
      const id = getSidebarCardId(card);
      if (id) peekCardCache.set(id, card);
    });

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
      // Get quote priority if available
      const quotePriority = card?.record?.priority ?? card?.targetRecord?.priority ?? null;
      const priorityStars = quotePriority ? [1,2,3,4,5].map(v => v <= quotePriority ? "★" : "☆").join("") : null;
      const peekId = getSidebarCardId(card);
      const peekAttrs = peekId
        ? ` data-peek-card="${escapeHtml(peekId)}" role="button" tabindex="0" title="Quick look at this card" aria-label="Quick look: ${escapeHtml(label)}"`
        : "";

      return `
        <div class="heap-item${isCurrent ? " heap-item-current" : ""}"${peekAttrs}>
          <div class="heap-item-rank">${isCurrent ? "▶" : `#${rank}`}</div>
          <div class="heap-item-body">
            <div class="heap-item-label">${escapeHtml(label)}${isCurrent ? " <span class=\"heap-current-tag\">on screen</span>" : ""}</div>
            <div class="heap-item-meta">
              <span title="Priority">⬆ ${fmtPriority(priority)}</span>
              ${priorityStars ? `<span title="Quote Priority" style="color:${getPriorityColor(quotePriority)};">${priorityStars}</span>` : ""}
              <span title="Next review">📅 ${due}</span>
              <span title="Interval">⏱ ${fmtInterval((ms.interval || 0) * 86400000)}</span>
              <span title="Last grade">${grade} ${ms.lastGrade || "new"}</span>
              <span title="Reviews">✓ ${ms.reviewCount || 0}x</span>
            </div>
          </div>
        </div>`;
    };

    const currentCard = state.flashcards[state.currentIndex];
    const currentQuotePriority = currentCard?.record?.priority ?? null;
    const currentPriority = currentCard ? computePriority(currentCard.memoryState || {}, nowMs, currentQuotePriority) : null;
    const currentCardHTML = currentCard
      ? renderCardRow(currentCard, currentPriority, 0, true)
      : "";

    // Priority distribution summary
    const allCards = [...state.flashcards, ...heapItems.map(i => i.card)];
    const priorityCounts = {1:0, 2:0, 3:0, 4:0, 5:0};
    let totalQuotes = 0;
    allCards.forEach(c => {
      const p = c?.record?.priority ?? c?.targetRecord?.priority ?? null;
      if (p !== null && p !== undefined) {
        priorityCounts[p] = (priorityCounts[p] || 0) + 1;
        totalQuotes++;
      }
    });

    const route = state.session.learningRoute;
    const routeSummary = route ? `
      <div class="heap-section" style="margin-bottom: 12px;">
        <div class="heap-section-title">Learning Router</div>
        <div class="heap-item-meta" style="padding:6px 0 0;">
          <span title="Mode">${escapeHtml(route.mode)}</span>
          <span title="Start type">${escapeHtml(route.startType)}</span>
          <span title="Heap construction">${escapeHtml(route.heapConstruction)}</span>
          <span title="Sampling">${escapeHtml(route.samplingStrategy)}</span>
          <span title="Sampled source">${state.session.systemState?.sampleSize || 0}/${state.session.systemState?.heapSize || 0} structural sample</span>
        </div>
      </div>
    ` : "";

    const prioritySummary = totalQuotes > 0 ? `
      <div class="heap-section" style="margin-bottom: 12px;">
        <div class="heap-section-title">Priority Distribution</div>
        <div class="priority-distribution" style="display:flex; gap:8px; flex-wrap:wrap;">
          ${[1,2,3,4,5].map(p => `
            <div style="flex:1; min-width:40px; text-align:center; padding:6px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:4px;">P${p}</div>
              <div style="font-size:1rem; font-weight:700; color:${getPriorityColor(p)};">${priorityCounts[p] || 0}</div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

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
      ${routeSummary}
      ${prioritySummary}
      <div class="heap-section">
        <div class="heap-section-title">Heap Queue (${heapItems.length} cards)</div>
        <div class="heap-list">${heapHTML}</div>
      </div>
    `;
  }

  // ─── Sidebar Mode System ───────────────────────────────────────────────

  function setSidebarMode(mode) {
    if (!Object.values(SIDEBAR_MODES).includes(mode)) return;
    if (state.sidebarMode === mode) {
      state.sidebarMode = SIDEBAR_MODES.FOCUS;
    } else {
      state.sidebarMode = mode;
    }

    // Update tab active states
    const tabBar = document.getElementById("sidebarModeTabs");
    if (tabBar) {
      tabBar.querySelectorAll(".sidebar-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === state.sidebarMode);
      });
    }
    // Update header title
    const headerTitle = document.getElementById("sidebarHeaderTitle");
    const modeLabels = { focus: "Focus", router: "Router", inspect: "Inspect" };
    if (headerTitle) headerTitle.textContent = modeLabels[state.sidebarMode] || "Focus";
    // System thinking only visible in focus mode
    const systemThinking = document.getElementById("systemThinking");
    if (systemThinking) {
      systemThinking.style.display = state.sidebarMode === SIDEBAR_MODES.FOCUS ? "" : "none";
    }
    renderSidebar();
  }

  function renderSidebar() {
    // Refresh the outer statsContent reference
    statsContent = document.getElementById("statsContent");
    if (!statsContent) return;

    switch (state.sidebarMode) {
      case SIDEBAR_MODES.FOCUS:
        renderFocusMode();
        break;
      case SIDEBAR_MODES.ROUTER:
        renderRouterMode();
        break;
      case SIDEBAR_MODES.INSPECT:
        renderInspectMode();
        break;
      default:
        renderFocusMode();
    }
  }

  function renderFocusMode() {
    if (!statsContent) return;
    const route = state.session.learningRoute;
    let routeStrip = "";
    if (route) {
      const startLabel = formatSidebarLabel(route.startType || "");
      const routeLabel = formatSidebarLabel(route.mode || "");
      const scopeLabel = getRouteScopeLabel(route);
      const heapSize = state.session.heap?.size?.() || 0;
      routeStrip = `
        <div class="focus-router-strip">
          <div class="focus-router-strip-row">
            <span class="focus-router-strip-label">Route</span>
            <span class="focus-router-strip-value">${escapeHtml(startLabel)} \u2192 ${escapeHtml(routeLabel)}</span>
          </div>
          <div class="focus-router-strip-row">
            <span class="focus-router-strip-label">Scope</span>
            <span class="focus-router-strip-value">${escapeHtml(scopeLabel)}</span>
          </div>
          <div class="focus-router-strip-row">
            <span class="focus-router-strip-label">Heap</span>
            <span class="focus-router-strip-value">${heapSize}</span>
          </div>
        </div>`;
    }
    // Delegate to existing stats renderer but inject the strip first
    renderStats();
    if (statsContent && routeStrip) {
      statsContent.insertAdjacentHTML("afterbegin", routeStrip);
    }
  }

  function renderRouterMode() {
    if (!statsContent) return;
    const rd = state.routerDebug;
    if (!rd || !rd.selectedRoute) {
      statsContent.innerHTML = `
        <div class="inspect-placeholder">
          <div class="inspect-placeholder-icon">\u2b21</div>
          <div>No route selected yet.<br>Start studying to see router reasoning.</div>
        </div>`;
      return;
    }
    const routeLabel = formatSidebarLabel(rd.selectedRoute);
    const startLabel = formatSidebarLabel(rd.startType || "");
    const stepsHTML = rd.reasoningSteps.length > 0
      ? rd.reasoningSteps.map(step => `
        <div class="router-step">
          <span class="step-label">${escapeHtml(String(step.label || ""))}</span>
          <span class="step-value">${escapeHtml(String(step.value ?? ""))}</span>
          <span class="step-effect">${escapeHtml(String(step.effect || ""))}</span>
        </div>`).join("")
      : `<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">No reasoning steps recorded.</div>`;
    const avgU = Number(rd.avgUncertainty || 0).toFixed(2);
    const earlyPct = Math.round((rd.earlyPhaseRatio || 0) * 100);
    statsContent.innerHTML = `
      <div class="router-route-banner">
        <div class="router-route-label">${escapeHtml(startLabel)}</div>
        <div class="router-route-name">${escapeHtml(routeLabel)}</div>
        <div class="router-route-explanation">${escapeHtml(rd.explanation || "")}</div>
      </div>
      <div class="sidebar-section-title">Live Metrics</div>
      <div class="router-live-metric">
        <span class="metric-label">Heap Size</span>
        <span class="metric-value">${rd.heapSize}</span>
      </div>
      <div class="router-live-metric">
        <span class="metric-label">Early Phase %</span>
        <span class="metric-value">${earlyPct}%</span>
      </div>
      <div class="router-live-metric">
        <span class="metric-label">Avg Uncertainty</span>
        <span class="metric-value">${avgU}</span>
      </div>
      <div class="router-live-metric">
        <span class="metric-label">Re-routes</span>
        <span class="metric-value">${state.session.routeRerouteCounter || 0}</span>
      </div>
      <div class="sidebar-section-title">Decision Trace</div>
      ${stepsHTML}
    `;
  }

  function getCardLabel(card) {
    if (!card) return "?";
    if (card.type === "blurt") return (card.cue?.cue || "Blurt").substring(0, 60);
    if (card.type === "analysis-learning") return ((card.record?.analysis || "").replace(/[#*`]/g,"").trim().substring(0, 60) + "...");
    return ((card?.record?.quote || card?.front?.content || "?").substring(0, 60) + "...");
  }

  function getSidebarCardId(card) {
    if (!card) return null;
    if (card.memoryKind === "card" || card.type === "card-learning") return card.record?.id || card.id || null;
    if (card.memoryKind === "quote" || card.type === "quote-learning") return card.record?.id || card.id || null;
    if (card.memoryKind === "analysis" || card.type === "analysis-learning") return card.record?.id || card.id || null;
    if (card.type === "blurt") return card.targetRecord?.id || card.id || null;
    return card.id || null;
  }

  function findCardById(id) {
    if (!id) return null;
    const pool = [
      ...(state.flashcards || []),
      ...(state.session?.heap?.items || []).map((item) => item.card),
      ...(Array.isArray(state.session?.surprisePool) ? state.session.surprisePool : [])
    ].filter(Boolean);
    return pool.find((card) => getSidebarCardId(card) === id) || null;
  }

  function renderInspectMode() {
    if (!statsContent) return;
    const cardId = state.inspectedCardId;
    let card = null;
    if (cardId) {
      card = findCardById(cardId);
      if (!card && state.session.heap) {
        const heapItem = state.session.heap.items.find(item => getSidebarCardId(item.card) === cardId);
        if (heapItem) card = heapItem.card;
      }
      if (!card && Array.isArray(state.session.surprisePool)) {
        card = state.session.surprisePool.find(c => getSidebarCardId(c) === cardId);
      }
    }
    if (!card) {
      card = state.flashcards[state.currentIndex];
    }
    if (!card) {
      statsContent.innerHTML = `
        <div class="inspect-placeholder">
          <div class="inspect-placeholder-icon">\uD83D\uDD0D</div>
          <div>No card selected.<br>Open a card to inspect its memory state and linked context.</div>
        </div>`;
      return;
    }
    const ms = card.memoryState || {};
    const phase = getUserLearningPhase(card, state.userProfile);
    const nowMs = Date.now();
    const quotePriority = getQuotePriorityForCard(card);
    const U = Number(ms.U ?? 0.5);
    const overdueVal = ms.nextReview > 0 ? Math.max(0, (nowMs - ms.nextReview) / 86400000) : 0;
    const layers = getCardLayers(card);
    const tags = getCardTags(card);
    const subject = getCardSubject(card);
    const phaseBoost = phase === "new" ? 0.6 : phase === "warming" ? 0.45 : phase === "stabilising" ? 0.3 : phase === "mastered" ? -0.4 : 0;
    const quotePriorityBoost = quotePriority ? (Number(quotePriority) - 1) * 2 : 0;
    const totalScore = (1 + overdueVal + U * 0.8 + phaseBoost + quotePriorityBoost).toFixed(2);
    const recentGrades = Array.isArray(ms.recentGrades) ? ms.recentGrades : [];
    const gradeIcon = g => g === "easy" ? "\uD83D\uDFE2" : g === "kinda" ? "\uD83D\uDFE1" : g === "didnt_know" ? "\uD83D\uDD34" : "\u26AA";
    const gradeLabel = g => g === "easy" ? "Easy" : g === "kinda" ? "Kinda" : g === "didnt_know" ? "Didn't Know" : g || "?";
    const timelineHTML = recentGrades.length > 0
      ? recentGrades.map((g, i) => `
        <div class="inspect-timeline-item">
          <div class="inspect-timeline-dot" style="background:${g === 'easy' ? '#3fd07d' : g === 'kinda' ? '#ffa500' : '#ff4d4d'};"></div>
          <span style="color:var(--text-muted);">Review ${i + 1}</span>
          <span style="margin-left:auto;color:var(--text-main);">${gradeIcon(g)} ${gradeLabel(g)}</span>
        </div>`).join("")
      : `<div style="color:var(--text-muted);font-size:0.78rem;padding:4px 0;">No review history yet.</div>`;
    const previewText = card.front?.content || card.record?.quote || card.record?.analysis || "?";
    const fmtDate = ts => ts ? new Date(ts).toLocaleDateString() : "never";
    statsContent.innerHTML = `
      <div class="inspect-card-header">
        <div class="inspect-card-label">${escapeHtml(subject)}${layers.length ? " \u203A " + layers.join(" \u203A ") : ""}</div>
        <div class="inspect-card-preview">${escapeHtml(String(previewText).substring(0, 120))}</div>
      </div>
      <div class="sidebar-section-title">Knowledge Context</div>
      <div id="inspectLinkedContext" class="inspect-linked-context"></div>
      <div class="sidebar-section-title">Memory State</div>
      <div class="inspect-metric-row">
        <div class="inspect-metric">
          <div class="inspect-metric-label">Stability (S)</div>
          <div class="inspect-metric-value">${Number(ms.S ?? 1).toFixed(2)}</div>
        </div>
        <div class="inspect-metric">
          <div class="inspect-metric-label">Difficulty (D)</div>
          <div class="inspect-metric-value">${Number(ms.D ?? 1).toFixed(2)}</div>
        </div>
      </div>
      <div class="inspect-metric-row">
        <div class="inspect-metric">
          <div class="inspect-metric-label">Uncertainty (U)</div>
          <div class="inspect-metric-value">${(U * 100).toFixed(0)}%</div>
          <div class="inspect-metric-bar">
            <div class="inspect-metric-bar-fill" style="width:${(U * 100).toFixed(0)}%;background:${U > 0.65 ? '#ff4d4d' : U > 0.4 ? '#ffa500' : '#3fd07d'};"></div>
          </div>
        </div>
        <div class="inspect-metric">
          <div class="inspect-metric-label">Phase</div>
          <div class="inspect-metric-value" style="font-size:0.85rem;">${escapeHtml(phase)}</div>
        </div>
      </div>
      <div class="inspect-metric-row">
        <div class="inspect-metric">
          <div class="inspect-metric-label">Reviews</div>
          <div class="inspect-metric-value">${ms.reviewCount || 0}</div>
        </div>
        <div class="inspect-metric">
          <div class="inspect-metric-label">Interval</div>
          <div class="inspect-metric-value">${Number(ms.interval || 0).toFixed(1)}d</div>
        </div>
      </div>
      <div class="inspect-metric-row">
        <div class="inspect-metric">
          <div class="inspect-metric-label">Next Review</div>
          <div class="inspect-metric-value" style="font-size:0.78rem;">${fmtDate(ms.nextReview)}</div>
        </div>
        <div class="inspect-metric">
          <div class="inspect-metric-label">Overdue</div>
          <div class="inspect-metric-value" style="color:${overdueVal > 1 ? '#ff4d4d' : 'var(--accent)'};">${overdueVal.toFixed(1)}d</div>
        </div>
      </div>
      <div class="sidebar-section-title">Priority Score</div>
      <div class="inspect-contrib-row"><span class="inspect-contrib-label">Base</span><span class="inspect-contrib-value">1.00</span></div>
      <div class="inspect-contrib-row"><span class="inspect-contrib-label">Overdue</span><span class="inspect-contrib-value">+${overdueVal.toFixed(2)}</span></div>
      <div class="inspect-contrib-row"><span class="inspect-contrib-label">Uncertainty</span><span class="inspect-contrib-value">+${(U * 0.8).toFixed(2)}</span></div>
      <div class="inspect-contrib-row"><span class="inspect-contrib-label">Phase boost</span><span class="inspect-contrib-value">${phaseBoost >= 0 ? '+' : ''}${phaseBoost.toFixed(2)}</span></div>
      ${quotePriorityBoost > 0 ? `<div class="inspect-contrib-row"><span class="inspect-contrib-label">Priority \u2605</span><span class="inspect-contrib-value">+${quotePriorityBoost.toFixed(2)}</span></div>` : ''}
      <div class="inspect-contrib-row" style="border-top:1px solid rgba(44,255,179,0.2);margin-top:4px;padding-top:6px;">
        <span class="inspect-contrib-label" style="font-weight:700;color:var(--text-main);">Total</span>
        <span class="inspect-contrib-value" style="color:var(--accent);">${totalScore}</span>
      </div>
      <div class="sidebar-section-title">Review Timeline</div>
      ${timelineHTML}
      ${tags.length > 0 ? `
        <div class="sidebar-section-title">Tags</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;padding-bottom:8px;">
          ${tags.map(t => `<span style="padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:0.72rem;color:var(--text-muted);">${escapeHtml(t)}</span>`).join("")}
        </div>` : ''}
    `;
    renderInspectLinkedContext(getCardRecord(card) || card);
  }

  function inspectCard(cardId) {
    if (!cardId) return;
    state.inspectedCardId = cardId;
    setSidebarMode(SIDEBAR_MODES.INSPECT);
    if (memoryStats && !memoryStats.classList.contains("open")) {
      setStatsOpen(true);
    }
  }

  function getCurrentPhase() {
    const card = state.flashcards[state.currentIndex];
    if (!card) return "new";
    const ms = card.memoryState || {};
    return ms.L_phase || getUserLearningPhase(card, state.userProfile) || "new";
  }

  function getMemoryStateFromMeta(meta = {}, kind = "quote") {
    return {
      S: Number(meta?.S || 1),
      D: Number(meta?.D || 1),
      U: Number(meta?.U ?? 0.5),
      nextReview: meta?.nextReview || null,
      interval: Number(meta?.interval || 0),
      reviewCount: Number(meta?.reviewCount || 0),
      recentGrades: Array.isArray(meta?.recentGrades) ? meta.recentGrades : []
    };
  }

  function formatSidebarLabel(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function getRouteScopeLabel(route) {
    if (route?.mode === "manual_heap") return "heap order";
    const scope = route?.scope || {};
    if (scope.layers?.length) return "layer cluster (" + scope.layers.slice(0, 2).join(", ") + ")";
    if (scope.clusters?.length) return "cluster (" + scope.clusters.slice(0, 2).join(", ") + ")";
    if (scope.tags?.length) return "tag set (" + scope.tags.slice(0, 2).join(", ") + ")";
    if (scope.subjects?.length) return "subject (" + scope.subjects.slice(0, 2).join(", ") + ")";
    return "global";
  }

  function generateRouteExplanation(route, context = {}) {
    if (!route) return "No route has been selected yet.";
    const heapSize = Number(context.heapSize || 0);
    const uncertainty = Number(context.avgUncertainty ?? 0);
    const earlyRatio = Number(context.earlyPhaseRatio ?? 0);
    const startLabel = formatSidebarLabel(route.startType);

    if (route.mode === "rapid_sweep") {
      return `${startLabel} with a large, varied heap -> running a rapid structural sweep before deeper review.`;
    }
    if (route.mode === "focused_block") {
      if (earlyRatio > 0.55) return `${startLabel} with many early-phase cards -> switching to focused reinforcement.`;
      return `${startLabel} with ${heapSize} queued cards -> focusing a related block for stronger consolidation.`;
    }
    if (route.mode === "repair_cycle") {
      return `${startLabel} with unstable or decaying cards -> pulling fragile memories back into review.`;
    }
    if (uncertainty < 0.42) {
      return `${startLabel} with low average uncertainty -> using the global SRS heap.`;
    }
    return `${startLabel} -> using global SRS priority while monitoring uncertainty.`;
  }

  function updateRouterDebug(route, systemState, reasoningSteps) {
    const steps = Array.isArray(reasoningSteps) ? reasoningSteps.slice(-ROUTER_DEBUG_MAX_STEPS) : [];
    const earlyPhaseRatio = clampNumber(
      Number((systemState?.newCardRatio || 0) + ((systemState?.phaseDistribution?.warming || 0) / Math.max(1, systemState?.sampleSize || systemState?.heapSize || 1))),
      0, 1
    );
    state.routerDebug = {
      startType: route?.startType || null,
      heapSize: Number(systemState?.heapSize || 0),
      earlyPhaseRatio,
      selectedRoute: route?.mode || null,
      avgUncertainty: Number(systemState?.avgUncertainty || 0),
      modeSwitchFrequency: Number(state.session.routeRerouteCounter || 0),
      reasoningSteps: steps,
      explanation: generateRouteExplanation(route, {
        heapSize: Number(systemState?.heapSize || 0),
        avgUncertainty: Number(systemState?.avgUncertainty || 0),
        earlyPhaseRatio
      })
    };
  }

  // ─── Helper functions for priority breakdown ───────────────────────────

  function computeBasePriority(card) {
    return (card.memoryState?.priority || 0);
  }

  function computeOverdueBoost(card) {
    const now = Date.now();
    const nextReview = card.memoryState?.nextReview || now;
    const overdueDays = (now - nextReview) / 86400000;
    return Math.max(0, overdueDays);
  }

  function computePhaseBoost(card) {
    const phase = card.meta?.L_phase || "new";
    const boosts = { new: 0.5, warming: 0.3, stabilising: 0.1, stable: 0, mastered: -0.3 };
    return boosts[phase] || 0;
  }

  // ─── System Thinking Panel ───────────────────────────────────────────────

  let _typewriterTimer = null;
  let _lastThoughtMsg = "";
  let _lastGradeTime = 0;


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
    const route = state.session.learningRoute;
    const learningMode = state.session.learningMode || "global_srs";
    const phase = ms.L_phase || getUserLearningPhase(card, state.userProfile);
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
    } else if (phase === "stabilising") {
      pool.push("Stabilising phase. Inconsistent early recall is treated as learning noise, not failure.");
    } else if (phase === "mastered") {
      pool.push("Mastered phase detected. Scheduling is now preserving retention rather than drilling.");
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
    if (route?.startType === "cold_start") {
      pool.push("Cold Start / Cold Import detected. Router is sampling structure before committing to deeper review.");
    } else if (route?.startType === "warm_start") {
      pool.push("Warm Start / Warm Knowledge detected. Router is looking for weak gaps and decaying stable cards.");
    }
    if (learningMode === "focused_block") {
      pool.push("Focused block mode active. Reinforcing a related subset while occasionally interleaving older cards.");
    } else if (learningMode === "rapid_sweep") {
      pool.push("Rapid sweep active. This is a bounded structural pass, not a full first sweep.");
    } else if (learningMode === "repair_cycle") {
      pool.push("Repair cycle active. Previously stable or fragile items are being pulled back into focus.");
    } else if (learningMode === "global_srs") {
      pool.push("Global SRS active. The deck is small or mature enough for normal heap scheduling.");
    }
    if (state.stats.streak >= 5) {
      pool.push(`${state.stats.streak}-card streak. Recall quality is strong this session.`);
    }
    if (reviewCount >= 3 && state.stats.totalStudied > 0 && state.stats.correctAnswers / state.stats.totalStudied < 0.4) {
      pool.push("Session accuracy is low. Consider shorter intervals or a review break.");
    }

    // --- Mode-specific ---
    if (mode === "blurt") {
      pool.push("Blurt mode active. Free recall is the strongest consolidation method.");
      pool.push("Active retrieval engaged — the effort itself strengthens the memory trace.");
    } else if (mode === "evidence-matching") {
      pool.push("Evidence matching active. Testing associative linkage between ideas.");
    } else if (mode === "analysis-learning") {
      pool.push("Analysis mode. Connecting ideas and building understanding.");
      pool.push("Analysis mode. Tracking conceptual memory separate from quote recall.");
    }

    // --- Sidebar mode context ---
    const sidebarMode = state.sidebarMode;
    const router = state.session.learningRoute;
    const currentPhase = phase;

    if (sidebarMode === SIDEBAR_MODES.ROUTER && router) {
      pool.push(`Routing: ${router.mode} via ${router.startType}. ${state.routerDebug.explanation || ''}`);
    }

    if (sidebarMode === SIDEBAR_MODES.FOCUS) {
      const heap = (state.flashcards || []).length;
      pool.push(`Focus mode: ${heap} cards queued. Current phase: ${currentPhase}.`);
    }

    pool.push(`System ready. Mode: ${sidebarMode}.`);

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

    // 1. Handle existing "current" thought
    const prevCurrent = systemThinkingText.querySelector(".thought-line.current");
    if (prevCurrent) {
      // Instantly finish previous typewriter
      prevCurrent.innerHTML = prevCurrent.dataset.fullText || "";
      prevCurrent.classList.remove("current");
      prevCurrent.classList.add("history");
    }

    // 2. Limit history (keep last 2 total)
    const lines = systemThinkingText.querySelectorAll(".thought-line");
    if (lines.length >= 2) {
      lines[0].remove();
    }

    // 3. Create new current line
    const newLine = document.createElement("div");
    newLine.className = "thought-line current";
    newLine.dataset.fullText = text;
    systemThinkingText.appendChild(newLine);

    let i = 0;
    const tick = () => {
      if (i >= text.length) {
        newLine.innerHTML = text;
        return;
      }
      const chunk = text.slice(0, i + 1);
      newLine.innerHTML = `${chunk}<span class="cursor"></span>`;
      i++;
      const delay = 5 + Math.random() * 8; // 5-13ms per character for typewriter effect
      _typewriterTimer = setTimeout(tick, delay);
    };
    tick();
  }

      function updateSystemThought(lastGrade = null) {
    const now = Date.now();
    // If it's an automatic update (null grade), check if we're in the 2.5s grade protection window
    if (lastGrade === null && now - _lastGradeTime < 2500) {
      return;
    }

    if (lastGrade !== null) {
      _lastGradeTime = now;
    }

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

  // ========== DECK BUILDER FUNCTIONS ==========

  function populateDeckSubjectOptions(selected = "") {
    if (!deckSubjectOptions) return;
    const names = new Set();
    getSubjects()
      .then((subjects) => {
        (subjects || []).forEach((name) => names.add(String(name || "").trim()));
      })
      .catch(() => {})
      .finally(() => {
        if (selected) names.add(selected);
        if (deckSubjectOptions) {
          deckSubjectOptions.innerHTML = [...names]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join("");
        }
      });
    if (selected) names.add(selected);
    deckSubjectOptions.innerHTML = [...names]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
  }

  function closeDeckDelete() {
    hideModal(deckDeleteModal);
    deckDeleteTargetId = "";
  }

  async function confirmDeleteDeck(deckId) {
    const [decks, cards] = await Promise.all([getAllDecks(), getAllCards()]);
    const plan = describeDeckDeletion(decks, cards, deckId);
    if (!plan) {
      dialog.alert("That deck no longer exists.");
      await loadLaunchpad();
      return;
    }

    deckDeleteTargetId = String(deckId);
    const { counts, deck, parent } = plan;
    const parentLabel = parent ? parent.name : UNSORTED_DECK_NAME;
    if (deckDeleteSummary) {
      deckDeleteSummary.textContent =
        `Delete “${deck.name}” from ${deck.subject}? ` +
        `It has ${counts.directCards} direct card${counts.directCards === 1 ? "" : "s"} ` +
        `and ${counts.childDecks} direct subdeck${counts.childDecks === 1 ? "" : "s"}.`;
    }
    if (deckDeleteMoveHint) {
      deckDeleteMoveHint.textContent = parent
        ? `${counts.directCards} card${counts.directCards === 1 ? "" : "s"} and ${counts.childDecks} subdeck${counts.childDecks === 1 ? "" : "s"} move to ${parentLabel}.`
        : `${counts.directCards} card${counts.directCards === 1 ? "" : "s"} move to ${UNSORTED_DECK_NAME}; ${counts.childDecks} subdeck${counts.childDecks === 1 ? "" : "s"} become top-level decks.`;
    }
    if (deckDeleteSubtreeHint) {
      deckDeleteSubtreeHint.textContent =
        `${counts.subtreeCards} card${counts.subtreeCards === 1 ? "" : "s"} and ` +
        `${counts.decks} deck${counts.decks === 1 ? "" : "s"} will be permanently deleted.`;
    }
    deckDeleteModal?.querySelectorAll('input[name="deckDeleteMode"]').forEach((input) => {
      input.checked = input.value === "move";
    });
    showModal(deckDeleteModal);
    requestAnimationFrame(() => confirmDeckDeleteBtn?.focus());
  }

  async function performDeckDelete() {
    if (!deckDeleteTargetId) return;
    const modeInput = deckDeleteModal?.querySelector('input[name="deckDeleteMode"]:checked');
    const mode = modeInput?.value === "delete" ? "delete" : "move";
    const deckId = deckDeleteTargetId;

    const [decks, cards] = await Promise.all([getAllDecks(), getAllCards()]);
    const plan = describeDeckDeletion(decks, cards, deckId);
    if (!plan) {
      closeDeckDelete();
      await loadLaunchpad();
      return;
    }

    // The shared dialog sits below the deck modal in the stacking order, so
    // step the choice modal aside while the second confirmation is open.
    hideModal(deckDeleteModal);
    const confirmed = await dialog.confirm(
      mode === "delete"
        ? `Permanently delete “${plan.deck.name}”, ${plan.counts.decks} deck${plan.counts.decks === 1 ? "" : "s"}, and ${plan.counts.subtreeCards} card${plan.counts.subtreeCards === 1 ? "" : "s"}? This cannot be undone.`
        : `Delete “${plan.deck.name}”? ${plan.counts.directCards} card${plan.counts.directCards === 1 ? "" : "s"} will move to ${plan.parent ? plan.parent.name : UNSORTED_DECK_NAME}.`,
      mode === "delete" ? "Delete forever" : "Delete deck",
      "danger"
    );
    if (!confirmed) {
      // Put the choice back in front of the user; the dialog is layered above
      // ordinary panels, so the deck modal must step aside while it is open.
      showModal(deckDeleteModal);
      return;
    }

    try {
      await deleteDeck(deckId, { mode });
      if (String(state.currentDeckId) === String(deckId)) {
        state.view = "launchpad";
        state.currentSubject = "";
        clearDeckScope();
      }
      closeDeckDelete();
      await loadLaunchpad();
      renderUI();
    } catch (error) {
      console.error("Could not delete deck:", error);
      dialog.alert("Could not delete deck: " + error.message);
    }
  }

  async function openDeckBuilder({ subject = "", parentId = null } = {}) {
    resetDeckBuilderState();
    deckBuilderState.deckSubject = String(subject || state.currentSubject || "").trim();
    deckBuilderState.parentId = parentId ? String(parentId) : null;
    if (builderTitle) {
      builderTitle.textContent = deckBuilderState.parentId ? "Create New Subdeck" : "Create New Deck";
    }
    populateDeckSubjectOptions(deckBuilderState.deckSubject);
    if (deckSubjectInput) {
      deckSubjectInput.disabled = false;
      deckSubjectInput.value = deckBuilderState.deckSubject;
    }
    if (deckParentHint) {
      if (deckBuilderState.parentId) {
        const parent = await getDeck(deckBuilderState.parentId).catch(() => null);
        deckParentHint.textContent = parent ? `Inside ${parent.name}` : "Inside a deck";
      } else {
        deckParentHint.textContent = "";
      }
    }
    showModal(deckBuilderModal);
    showDeckBuilderStep(1);
    // A quick-action launch should be ready to type immediately.
    requestAnimationFrame(() => {
      if (!deckBuilderState.deckSubject) deckSubjectInput?.focus();
      else deckNameInput?.focus();
    });
  }

  async function openDeckEditor(deckId) {
    const deck = await getDeck(deckId).catch(() => null);
    if (!deck) {
      dialog.alert("That deck no longer exists.");
      await loadLaunchpad();
      return;
    }
    resetDeckBuilderState();
    if (builderTitle) builderTitle.textContent = "Edit Deck";

    deckBuilderState.deckName = deck.name;
    deckBuilderState.deckSubject = deck.subject;
    deckBuilderState.parentId = deck.parentId || null;
    deckBuilderState.editingDeckId = deck.id;

    populateDeckSubjectOptions(deck.subject);
    if (deckSubjectInput) {
      deckSubjectInput.value = deck.subject;
      // Deck moves are within a subject in v1.
      deckSubjectInput.disabled = true;
    }
    if (deckNameInput) deckNameInput.value = deck.name;
    if (deckParentHint) {
      const parent = deck.parentId ? await getDeck(deck.parentId).catch(() => null) : null;
      deckParentHint.textContent = parent ? `Subdeck of ${parent.name}` : deck.parentId ? "Subdeck" : "";
    }

    const cards = await getCardsForDeckId(deck.id) || [];

    const orderedCards = [...cards].sort((a, b) => {
      const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderDiff !== 0) return orderDiff;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
    for (const card of orderedCards) {
      deckBuilderState.cards.push({
        cardId: card.id,
        front: card.front,
        back: card.back,
        priority: card.priority || 3,
        tags: [...(card.tags || [])],
        isExisting: true,
        meta: card.meta || {},
        createdAt: card.createdAt,
        origin: card.origin,
        links: card.links || {}
      });
    }

    renderFlashcardList();
    if (finishDeckBtn) finishDeckBtn.textContent = "Save Changes";
    showModal(deckBuilderModal);
    showDeckBuilderStep(2);
  }

  function closeDeckBuilder() {
    hideModal(deckBuilderModal);
    resetDeckBuilderState();
  }

  function resetDeckBuilderState() {
    deckBuilderState.cards = [];
    deckBuilderState.deckName = "";
    deckBuilderState.deckSubject = "";
    deckBuilderState.parentId = null;
    deckBuilderState.editingDeckId = null;
    deckBuilderState.deckDescription = "";
    deckBuilderState.currentCardIndex = -1;
    deckBuilderState.isEditingCard = false;
    deckBuilderState.deletedCardIds = [];
    if (deckNameInput) deckNameInput.value = "";
    if (deckSubjectInput) {
      deckSubjectInput.value = "";
      deckSubjectInput.disabled = false;
    }
    if (deckParentHint) deckParentHint.textContent = "";
    if (deckDescriptionInput) deckDescriptionInput.value = "";
    if (finishDeckBtn) finishDeckBtn.textContent = "Finish Deck";
    updateDeckBuilderFinishState();
  }

  function updateDeckBuilderFinishState() {
    if (!finishDeckBtn) return;
    const empty = deckBuilderState.cards.length === 0;
    finishDeckBtn.disabled = empty;
    finishDeckBtn.title = empty ? "Add at least one card first" : "";
    if (cardCountDisplay) cardCountDisplay.textContent = deckBuilderState.cards.length;
  }

  function showDeckBuilderStep(step) {
    if (step1DeckInfo) step1DeckInfo.style.display = step === 1 ? "block" : "none";
    if (step2Flashcards) {
      step2Flashcards.style.display = step === 2 ? "flex" : "none";
      if (step === 2) {
        step2Flashcards.style.flexDirection = "column";
        step2Flashcards.style.minHeight = "0";
        // Ensure deck-builder-body is row layout
        const body = step2Flashcards.querySelector(".deck-builder-body");
        if (body) body.style.flexDirection = "row";
      }
    }
    if (step3Success) step3Success.style.display = step === 3 ? "block" : "none";
    // Reset form on step 2
    if (step === 2) {
      renderPriorityPills();
      clearForm();
    }
    updateDeckBuilderFinishState();
  }

  function renderPriorityPills() {
    if (!priorityPills) return;
    const labels = ["Very Low", "Low", "Medium", "High", "Very High"];
    priorityPills.innerHTML = labels.map((label, i) => {
      const p = i + 1;
      const color = getPriorityColor(p);
      const isActive = p === 3; // Default to Medium
      return `<button type="button" class="priority-pill ${isActive ? 'active' : ''}"
        data-priority="${p}"
        style="color: ${isActive ? color : 'var(--text-muted)'}; border-color: ${isActive ? color : 'rgba(255,255,255,0.15)'};"
        title="Set priority to ${label}">${label}</button>`;
    }).join("");

    priorityPills.querySelectorAll(".priority-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        priorityPills.querySelectorAll(".priority-pill").forEach(b => {
          const p = parseInt(b.dataset.priority);
          b.classList.remove("active");
          b.style.color = "var(--text-muted)";
          b.style.borderColor = "rgba(255,255,255,0.15)";
        });
        btn.classList.add("active");
        const p = parseInt(btn.dataset.priority);
        btn.style.color = getPriorityColor(p);
        btn.style.borderColor = getPriorityColor(p);
      });
    });
  }

  function setPriorityPillSelection(priority = 3) {
    if (!priorityPills) return;
    priorityPills.querySelectorAll(".priority-pill").forEach((button) => {
      const value = parseInt(button.dataset.priority, 10);
      const isActive = value === priority;
      button.classList.toggle("active", isActive);
      button.style.color = isActive ? getPriorityColor(value) : "var(--text-muted)";
      button.style.borderColor = isActive ? getPriorityColor(value) : "rgba(255,255,255,0.15)";
    });
  }

  function startEditingCard(index) {
    deckBuilderState.currentCardIndex = index;
    deckBuilderState.isEditingCard = true;

    // Show form, hide import view
    const importView = document.getElementById("importView");
    const cardEditForm = document.getElementById("cardEditForm");
    if (importView) importView.style.display = "none";
    if (cardEditForm) cardEditForm.style.display = "block";

    if (index >= 0 && index < deckBuilderState.cards.length) {
      const card = deckBuilderState.cards[index];
      if (cueInput) cueInput.value = card.front || "";
      if (quoteInput) quoteInput.value = card.back || "";
      if (deckCardTags) deckCardTags.value = (card.tags || []).join(", ");
      setPriorityPillSelection(card.priority || 3);
      if (deleteCardBtn) deleteCardBtn.style.display = "inline-block";
      const formTitle = document.getElementById("formTitle");
      if (formTitle) formTitle.textContent = "Edit Card";
    } else {
      if (cueInput) cueInput.value = "";
      if (quoteInput) quoteInput.value = "";
      if (deckCardTags) deckCardTags.value = "";
      setPriorityPillSelection(3);
      if (deleteCardBtn) deleteCardBtn.style.display = "none";
      const formTitle = document.getElementById("formTitle");
      if (formTitle) formTitle.textContent = "Add New Card";
    }

    if (cueInput) cueInput.focus();

    if (saveCardBtn && cueInput && quoteInput) {
      const hasContent = cueInput.value.trim() && quoteInput.value.trim();
      saveCardBtn.disabled = !hasContent;
      saveCardBtn.style.opacity = hasContent ? "1" : "0.4";
      saveCardBtn.style.pointerEvents = hasContent ? "auto" : "none";
    }
  }

  function finishEditingCard() {
    deckBuilderState.isEditingCard = false;
    deckBuilderState.currentCardIndex = -1;
    clearForm();
    renderFlashcardList();
  }

  function clearForm() {
    if (cueInput) cueInput.value = "";
    if (quoteInput) quoteInput.value = "";
    if (deckCardTags) deckCardTags.value = "";
    setPriorityPillSelection(3);
    if (deleteCardBtn) deleteCardBtn.style.display = "none";
    const formTitle = document.getElementById("formTitle");
    if (formTitle) formTitle.textContent = "Add New Card";
    if (saveCardBtn) {
      saveCardBtn.disabled = true;
      saveCardBtn.style.opacity = "0.4";
      saveCardBtn.style.pointerEvents = "none";
    }
  }

  function saveFlashcard(front, back, priority) {
    const tags = parseQuickAddTags(deckCardTags?.value);
    const existing = deckBuilderState.currentCardIndex >= 0
      ? deckBuilderState.cards[deckBuilderState.currentCardIndex]
      : null;
    const card = {
      cardId: existing?.cardId || null,
      front,
      back,
      priority,
      tags,
      isExisting: !!existing?.isExisting,
      meta: existing?.meta,
      createdAt: existing?.createdAt,
      origin: existing?.origin,
      links: existing?.links,
      legacyQuoteId: existing?.legacyQuoteId || null,
      legacyCueId: existing?.legacyCueId || null
    };

    if (deckBuilderState.currentCardIndex >= 0) {
      deckBuilderState.cards[deckBuilderState.currentCardIndex] = {
        ...deckBuilderState.cards[deckBuilderState.currentCardIndex],
        ...card,
        isExisting: deckBuilderState.cards[deckBuilderState.currentCardIndex].isExisting
      };
    } else {
      deckBuilderState.cards.push(card);
    }

    finishEditingCard();
    if (cardCount) cardCount.textContent = deckBuilderState.cards.length;
    if (cueInput) cueInput.focus();
  }

  function deleteFlashcard(index) {
    if (index >= 0 && index < deckBuilderState.cards.length) {
      const card = deckBuilderState.cards[index];
      if (card.isExisting && card.cardId) {
        deckBuilderState.deletedCardIds.push({ cardId: card.cardId });
      }
      deckBuilderState.cards.splice(index, 1);
      renderFlashcardList();
    }
  }

  function renderFlashcardList() {
    if (!flashcardList) return;

    if (cardCount) cardCount.textContent = deckBuilderState.cards.length;
    updateDeckBuilderFinishState();
    flashcardList.innerHTML = "";

    deckBuilderState.cards.forEach((card, realIndex) => {
      const item = document.createElement("div");
      item.className = "flashcard-item";
      if (realIndex === deckBuilderState.currentCardIndex) {
        item.classList.add("active");
      }

      const title = document.createElement("div");
      title.className = "flashcard-item-title";
      title.textContent = `${realIndex + 1}. ${(card.front || "").substring(0, 50)}`;

      if (card.tags && card.tags.length > 0) {
        const tagsDiv = document.createElement("div");
        tagsDiv.className = "flashcard-item-layers";
        tagsDiv.textContent = card.tags.map((tag) => `#${tag}`).join(" ");
        title.appendChild(document.createElement("br"));
        title.appendChild(tagsDiv);
      }

      const actions = document.createElement("div");
      actions.className = "flashcard-item-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "flashcard-item-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditingCard(realIndex);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "flashcard-item-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFlashcard(realIndex);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(title);
      item.appendChild(actions);
      flashcardList.appendChild(item);
    });
  }

  async function ensureSubjectExists(subject) {
    const name = String(subject || "").trim();
    if (!name) throw new Error("Subject is required");
    const subjects = await getSubjects().catch(() => []);
    if (!(subjects || []).some((item) => String(item || "").trim() === name)) {
      await addSubject(name);
    }
    return name;
  }

  async function persistDeckCards() {
    const subjectName = await ensureSubjectExists(deckBuilderState.deckSubject);
    const deckName = String(deckBuilderState.deckName || "").trim();
    const isEditing = !!deckBuilderState.editingDeckId;

    let deckId = deckBuilderState.editingDeckId || "";
    if (isEditing) {
      const existingDeck = await getDeck(deckId);
      if (!existingDeck) throw new Error("Deck not found");
      await addDeck({
        ...existingDeck,
        name: deckName,
        subject: subjectName,
        parentId: existingDeck.parentId || null,
        updatedAt: Date.now()
      });
    } else {
      const created = await addDeck({
        name: deckName,
        subject: subjectName,
        parentId: deckBuilderState.parentId || null
      });
      deckId = created.id;
      deckBuilderState.editingDeckId = created.id;
    }

    // Delete only the card records removed from the builder. Linked quotes
    // and cues are knowledge context, not builder-owned content, so they are
    // left untouched.
    for (const deleted of deckBuilderState.deletedCardIds) {
      if (deleted.cardId) await deleteCard(deleted.cardId);
    }
    deckBuilderState.deletedCardIds = [];

    const allDecks = await getAllDecks().catch(() => []);
    const path = getDeckPath(allDecks, deckId);
    const deckPath = [subjectName, ...path.filter((part, index) => !(index === 0 && part === subjectName))];
    const deckCards = await getCardsForDeckId(deckId) || [];
    let nextOrder = deckCards.reduce(
      (max, existing) => Math.max(max, Number(existing.order) || 0),
      -1
    ) + 1;

    for (const card of deckBuilderState.cards) {
      const now = Date.now();
      const existingCard = card.cardId ? await getCard(card.cardId) : null;
      const order = Number.isFinite(Number(existingCard?.order))
        ? Number(existingCard.order)
        : nextOrder++;
      const links = { ...(existingCard?.links || card.links || {}) };
      if (!links.quoteId && card.legacyQuoteId) links.quoteId = card.legacyQuoteId;
      if (!links.cueId && card.legacyCueId) links.cueId = card.legacyCueId;
      const cardId = existingCard?.id || card.cardId || crypto.randomUUID();
      const origin = existingCard?.origin || card.origin || "manual";
      const tags = [...new Set(
        (Array.isArray(card.tags) ? card.tags : [])
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
      )];
      // Saving a legacy-backed card is an explicit user edit. Mark it newer
      // than the legacy pair so startup sync cannot overwrite the card.
      const legacyUpdatedAt = origin === "legacy"
        ? Math.max(Number(existingCard?.legacyUpdatedAt) || 0, now)
        : Number(existingCard?.legacyUpdatedAt) || undefined;

      const record = {
        id: cardId,
        front: card.front,
        back: card.back,
        deck: subjectName,
        deckId,
        deckPath,
        tags,
        priority: card.priority,
        order,
        meta: { ...(existingCard?.meta || card.meta || {}) },
        links,
        origin,
        createdAt: existingCard?.createdAt || card.createdAt || now,
        updatedAt: now
      };
      if (legacyUpdatedAt) record.legacyUpdatedAt = legacyUpdatedAt;
      await addCard(record);

      // Keep the in-memory builder in sync so a second save (e.g. mass edit
      // followed by Finish Deck) updates these cards instead of duplicating.
      card.cardId = cardId;
      card.isExisting = true;
      card.tags = tags;
    }

    return { subjectName, deckId, deckName, isEditing };
  }

  async function saveDeckToDB() {
    if (!deckBuilderState.deckSubject) {
      dialog.alert("Subject is required");
      return;
    }
    if (!deckBuilderState.deckName) {
      dialog.alert("Deck name is required");
      return;
    }

    if (deckBuilderState.cards.length === 0) {
      dialog.alert("Add at least one card to the deck");
      return;
    }

    try {
      const result = await persistDeckCards();
      const isEditing = result.isEditing;

      // Show success screen (or close modal if editing)
      if (isEditing) {
        closeDeckBuilder();
        state.editMode = false;
        if (editDecksBtn) editDecksBtn.classList.remove("active");
      } else {
        deckBuilderState.editingDeckId = result.deckId;
        if (deckNameDisplay) deckNameDisplay.textContent = deckBuilderState.deckName;
        if (cardCountDisplay) cardCountDisplay.textContent = deckBuilderState.cards.length;
        showDeckBuilderStep(3);
      }

      await loadLaunchpad();
      renderUI();
    } catch (error) {
      console.error("Error saving deck:", error);
      dialog.alert("Error saving deck: " + error.message);
    }
  }

  // ========== QUICK ADD ==========
  //
  // Quick Add is deliberately smaller than the deck builder: it captures one
  // card at a time and persists it immediately as a first-class card. No
  // source, quote, cue, or analysis is required. `order` preserves creation
  // order so the default browse order stays stable.

  function setQuickAddStatus(el, message, tone = "") {
    if (!el) return;
    el.textContent = message;
    el.classList.remove("success", "error");
    if (tone) el.classList.add(tone);
  }

  function parseQuickAddTags(value) {
    return [...new Set(
      String(value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )];
  }

  function addQuickAddDeckOption(deck) {
    if (!quickAddDeckOptions || !deck) return;
    const label = typeof deck === "string" ? deck : deck.label;
    if (!label) return;
    const exists = Array.from(quickAddDeckOptions.options || [])
      .some((option) => option.value === label);
    if (exists) return;
    const option = document.createElement("option");
    option.value = label;
    quickAddDeckOptions.appendChild(option);
  }

  async function populateQuickAddDeckOptions() {
    if (!quickAddDeckOptions) return;
    quickAddDeckOptions.innerHTML = "";
    quickAddState.deckTargets.clear();

    let decks = [];
    try {
      decks = await getAllDecks() || [];
    } catch (error) {
      console.warn("Could not load decks for Quick Add:", error);
    }

    for (const deck of sortDecksByCreated(decks, "asc")) {
      const label = deckLabel(deck, decks);
      const deckPath = [String(deck.subject || "").trim(), ...getDeckPath(decks, deck.id)]
        .filter(Boolean);
      quickAddState.deckTargets.set(label, { ...deck, label, deckPath });
      addQuickAddDeckOption(label);
    }

    if (quickAddState.lastDeck && !quickAddState.deckTargets.has(quickAddState.lastDeck)) {
      addQuickAddDeckOption(quickAddState.lastDeck);
    }
  }

  async function resolveQuickAddTarget(rawDeck) {
    const label = String(rawDeck || "").trim();
    if (!label) return null;

    if (quickAddState.deckTargets.has(label)) {
      return quickAddState.deckTargets.get(label);
    }

    const known = [...quickAddState.deckTargets.values()];
    const byId = known.find((deck) => String(deck.id) === label);
    if (byId) return byId;
    const byName = known.filter((deck) => String(deck.name || "") === label);
    if (byName.length === 1) return byName[0];

    // A typed name that is not in the tree becomes a new root deck inside the
    // current subject (or the Unsorted subject when there is no context).
    const subject = String(state.currentSubject || contextSubject || "").trim() || "Unsorted";
    const created = await addDeck({ name: label, subject, parentId: null });
    const decks = await getAllDecks().catch(() => []);
    const target = {
      ...created,
      label: deckLabel(created, decks),
      deckPath: [subject, ...getDeckPath(decks, created.id)].filter(Boolean)
    };
    quickAddState.deckTargets.set(target.label, target);
    addQuickAddDeckOption(target.label);
    return target;
  }

  function renderQuickAddPriorityPills() {
    if (!quickAddPriorityPills) return;
    const labels = ["Very Low", "Low", "Medium", "High", "Very High"];
    quickAddPriorityPills.innerHTML = labels.map((label, index) => {
      const priority = index + 1;
      const color = getPriorityColor(priority);
      const isActive = priority === quickAddState.priority;
      return `<button type="button" class="priority-pill ${isActive ? "active" : ""}"
        data-priority="${priority}"
        style="color: ${isActive ? color : "var(--text-muted)"}; border-color: ${isActive ? color : "rgba(255,255,255,0.15)"};"
        title="Set priority to ${label}">${label}</button>`;
    }).join("");

    quickAddPriorityPills.querySelectorAll(".priority-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        quickAddState.priority = parseInt(btn.dataset.priority) || 3;
        renderQuickAddPriorityPills();
      });
    });
  }

  function setQuickAddTab(tab, { focus = true } = {}) {
    quickAddState.activeTab = tab === "bulk" ? "bulk" : "single";
    document.querySelectorAll("[data-quick-add-tab]").forEach((btn) => {
      const isActive = btn.dataset.quickAddTab === quickAddState.activeTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (quickAddSingleView) {
      quickAddSingleView.style.display = quickAddState.activeTab === "single" ? "" : "none";
    }
    if (quickAddBulkView) {
      quickAddBulkView.style.display = quickAddState.activeTab === "bulk" ? "" : "none";
    }
    if (!focus) return;
    requestAnimationFrame(() => {
      if (quickAddState.activeTab === "single") {
        quickAddFront?.focus();
      } else {
        quickAddBulkInput?.focus();
      }
    });
  }

  function setQuickAddBusy(isBusy) {
    quickAddState.saving = isBusy;
    [quickAddSaveNextBtn, quickAddSaveCloseBtn, quickAddBulkImportBtn].forEach((btn) => {
      if (btn) btn.disabled = isBusy;
    });
  }

  async function openQuickAdd({ deck = "", deckId = "" } = {}) {
    if (!quickAddModal) getDOMElements();
    if (!quickAddModal) return;

    quickAddState.isOpen = true;
    quickAddState.saving = false;
    quickAddState.savedCount = 0;
    quickAddState.priority = 3;
    quickAddState.nextOrders.clear();

    showModal(quickAddModal);
    await populateQuickAddDeckOptions();

    const targets = [...quickAddState.deckTargets.values()];
    const requested = deckId
      ? targets.find((target) => String(target.id) === String(deckId))
      : deck
        ? targets.find((target) => (
          target.label === deck
          || String(target.id) === String(deck)
          || String(target.name || "") === String(deck)
        ))
        : null;
    const currentTarget = state.currentDeckId
      ? targets.find((target) => String(target.id) === String(state.currentDeckId))
      : null;
    const presetDeck = String(
      requested?.label
      || (deck && !requested ? deck : "")
      || currentTarget?.label
      || quickAddState.lastDeck
      || contextSubject
      || ""
    ).trim();
    if (quickAddDeckInput) quickAddDeckInput.value = presetDeck;
    if (quickAddFront) quickAddFront.value = "";
    if (quickAddBack) quickAddBack.value = "";
    if (quickAddTags) quickAddTags.value = "";
    if (quickAddBulkInput) quickAddBulkInput.value = "";
    setQuickAddStatus(quickAddStatus, "No cards added yet");
    setQuickAddStatus(quickAddBulkStatus, "Paste cards to import");
    setQuickAddBusy(false);
    renderQuickAddPriorityPills();
    setQuickAddTab("single", { focus: false });

    requestAnimationFrame(() => {
      // The deck is optional now: a blank deck saves to Unsorted, so the
      // fastest path is always to start typing the card.
      quickAddFront?.focus();
    });
  }

  function closeQuickAdd() {
    if (!quickAddState.isOpen) return;
    quickAddState.isOpen = false;
    setQuickAddBusy(false);
    hideModal(quickAddModal);

    // Deck counts and new decks only need to refresh once the modal closes;
    // per-card db-change events are suppressed while it is open.
    if (state.view === "launchpad") {
      loadLaunchpad()
        .then(() => renderUI())
        .catch((error) => console.error("Could not refresh decks:", error));
    }
  }

  async function getNextDeckOrder(target, fallbackDeck = "") {
    const key = target?.id || fallbackDeck;
    const cached = quickAddState.nextOrders.get(key);
    if (Number.isFinite(cached)) return cached;

    let cards = [];
    try {
      cards = target
        ? await getCardsForDeckId(target.id) || []
        : await getCardsForDeck(fallbackDeck) || [];
    } catch (error) {
      console.warn("Could not read deck order:", error);
    }

    let maxOrder = -1;
    cards.forEach((card) => {
      const order = Number(card?.order);
      if (Number.isFinite(order)) maxOrder = Math.max(maxOrder, order);
    });
    const nextOrder = maxOrder >= 0 ? maxOrder + 1 : cards.length;
    quickAddState.nextOrders.set(key, nextOrder);
    return nextOrder;
  }

  async function persistQuickAddCard({ deck, target = null, front, back, priority, tags, initialConfidence = 0.8 }) {
    // A card can always be saved. If the deck field is blank, it lands in the
    // current subject's Unsorted deck and can be organised later.
    const rawDeck = String(deck || "").trim();
    const subject = String(target?.subject || state.currentSubject || "").trim()
      || (rawDeck && rawDeck !== UNSORTED_DECK_NAME ? rawDeck : UNSORTED_DECK_NAME);
    const deckName = target?.name || rawDeck || UNSORTED_DECK_NAME;
    const now = Date.now();
    const deckOrder = await getNextDeckOrder(target, rawDeck || UNSORTED_DECK_NAME);
    const confidence = clampNumber(Number(initialConfidence ?? 0.8), 0, 1);

    const card = {
      id: crypto.randomUUID(),
      front,
      back,
      deck: subject,
      deckId: target?.id || null,
      deckPath: target?.deckPath || [subject, deckName].filter(Boolean),
      tags: [...new Set((tags || []).filter(Boolean))],
      priority,
      order: deckOrder,
      meta: {
        confidence,
        nextReview: now,
        interval: 1,
        ease: 2.5,
        repetitions: 0
      },
      links: {},
      origin: "quick-add",
      createdAt: now,
      updatedAt: now
    };

    await addCard(card);
    quickAddState.nextOrders.set(target?.id || rawDeck || UNSORTED_DECK_NAME, deckOrder + 1);
    return { card, deckOrder };
  }

  async function quickAddSaveCard({ allowEmptyClose = false } = {}) {
    if (quickAddState.saving) return false;

    const deck = quickAddDeckInput?.value?.trim() || "";
    const front = quickAddFront?.value?.trim() || "";
    const back = quickAddBack?.value?.trim() || "";

    if (!front && !back && allowEmptyClose) return true;

    if (!front || !back) {
      setQuickAddStatus(quickAddStatus, "Add both a front and a back", "error");
      (!front ? quickAddFront : quickAddBack)?.focus();
      return false;
    }

    setQuickAddBusy(true);
    try {
      const target = await resolveQuickAddTarget(deck);
      const label = target?.label || deck || UNSORTED_DECK_NAME;
      await persistQuickAddCard({
        deck,
        target,
        front,
        back,
        priority: quickAddState.priority || 3,
        tags: parseQuickAddTags(quickAddTags?.value)
      });

      quickAddState.lastDeck = label;
      quickAddState.lastDeckId = target?.id || "";
      quickAddState.savedCount += 1;
      if (quickAddFront) quickAddFront.value = "";
      if (quickAddBack) quickAddBack.value = "";
      addQuickAddDeckOption(label);
      if (quickAddDeckInput) quickAddDeckInput.value = label;
      const count = quickAddState.savedCount;
      setQuickAddStatus(
        quickAddStatus,
        `Saved ${count} card${count === 1 ? "" : "s"} to ${label}`,
        "success"
      );
      quickAddFront?.focus();
      return true;
    } catch (error) {
      console.error("Could not save Quick Add card:", error);
      setQuickAddStatus(quickAddStatus, `Could not save card: ${error.message}`, "error");
      return false;
    } finally {
      setQuickAddBusy(false);
    }
  }

  // Shared by the deck builder's Anki import and Quick Add's bulk paste.
  // Anki's clipboard format is tab-separated; `front | back` is accepted too
  // because it is easier to type by hand.
  function parseAnkiCards(text) {
    const cards = [];
    let skipped = 0;
    String(text || "").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const tabIndex = trimmed.indexOf("\t");
      const separatorIndex = tabIndex >= 0 ? tabIndex : trimmed.indexOf("|");
      if (separatorIndex < 0) {
        skipped += 1;
        return;
      }
      const front = trimmed.slice(0, separatorIndex).trim();
      const back = trimmed.slice(separatorIndex + 1).trim();
      if (!front || !back) {
        skipped += 1;
        return;
      }
      cards.push({ front, back });
    });
    return { cards, skipped };
  }

  async function quickAddBulkImport() {
    if (quickAddState.saving) return;

    const deck = quickAddDeckInput?.value?.trim() || "";

    const { cards, skipped } = parseAnkiCards(quickAddBulkInput?.value);
    if (!cards.length) {
      setQuickAddStatus(
        quickAddBulkStatus,
        "No valid rows. Use front<TAB>back or front | back.",
        "error"
      );
      return;
    }

    const tags = parseQuickAddTags(quickAddTags?.value);
    const priority = quickAddState.priority || 3;
    const initialConfidence = clampNumber(Number(quickAddBulkConfidence?.value ?? 0.5), 0, 1);
    let imported = 0;
    let failed = 0;

    setQuickAddBusy(true);
    let target = null;
    try {
      target = await resolveQuickAddTarget(deck);
    } catch (error) {
      console.error("Could not resolve Quick Add deck:", error);
    }
    const label = target?.label || deck || UNSORTED_DECK_NAME;
    for (const card of cards) {
      try {
        await persistQuickAddCard({ deck, target, ...card, priority, tags, initialConfidence });
        imported += 1;
      } catch (error) {
        failed += 1;
        console.error("Could not import Quick Add row:", card, error);
      }
    }
    setQuickAddBusy(false);

    quickAddState.savedCount += imported;
    if (imported > 0) {
      quickAddState.lastDeck = label;
      quickAddState.lastDeckId = target?.id || "";
      addQuickAddDeckOption(label);
      if (quickAddDeckInput) quickAddDeckInput.value = label;
      if (quickAddBulkInput) quickAddBulkInput.value = "";
    }
    const summary = `Imported ${imported} card${imported === 1 ? "" : "s"} to ${label}`;
    const skippedCount = skipped + failed;
    setQuickAddStatus(
      quickAddBulkStatus,
      skippedCount ? `${summary} (${skippedCount} skipped)` : summary,
      failed ? "error" : "success"
    );
  }

  // ========== ANKI IMPORT ==========

  async function exportToAnki() {
    if (!ankiImportInput || !importFeedback) return;

    // Get cards from current deck builder state
    const cards = deckBuilderState.cards;
    if (cards.length === 0) {
      importFeedback.textContent = "No cards to export. Add some cards first.";
      importFeedback.style.color = "#ff4d4d";
      return;
    }

    // Show import view and hide card edit form
    const importView = document.getElementById("importView");
    const cardEditForm = document.getElementById("cardEditForm");
    if (importView) importView.style.display = "block";
    if (cardEditForm) cardEditForm.style.display = "none";

    // Format cards as Anki tab-separated format
    const ankiText = cards.map(card => {
      const front = (card.front || "").replace(/\t/g, ' ').replace(/\n/g, ' ');
      const back = (card.back || "").replace(/\t/g, ' ').replace(/\n/g, ' ');
      return `${front}\t${back}`;
    }).join('\n');

    // Show in the import textarea
    ankiImportInput.value = ankiText;

    // Auto-copy to clipboard
    try {
      await navigator.clipboard.writeText(ankiText);
      importFeedback.textContent = `${cards.length} cards exported to Anki format and copied to clipboard!`;
      importFeedback.style.color = "#3fd07d";
    } catch (err) {
      importFeedback.textContent = `${cards.length} cards exported to Anki format (could not copy to clipboard)`;
      importFeedback.style.color = "#ffa500";
    }
  }

  // ========== MASS EDIT MODE ==========

  function enterMassEditMode() {
    deckBuilderState.isMassEditMode = true;
    deckBuilderState.massEditData = JSON.parse(JSON.stringify(deckBuilderState.cards)); // Deep copy

    // Toggle UI
    const deckBuilderBody = document.querySelector(".deck-builder-body");
    if (deckBuilderBody) {
      deckBuilderBody.classList.add("mass-edit-mode");
    }

    // Hide sidebar, hide main area's child elements (header, forms), show mass edit container
    const mainArea = document.querySelector(".deck-main-area");

    // Hide the header, import view, and card edit form (but NOT the main area itself)
    if (mainArea) {
      const header = mainArea.querySelector(".deck-main-header");
      const importView = mainArea.querySelector("#importView");
      const cardEditForm = mainArea.querySelector("#cardEditForm");
      if (header) header.style.display = "none";
      if (importView) importView.style.display = "none";
      if (cardEditForm) cardEditForm.style.display = "none";
    }

    if (massEditContainer) massEditContainer.style.display = "flex";

    // Update button text
    if (massEditBtn) {
      massEditBtn.textContent = "Normal Mode";
      massEditBtn.style.borderColor = "rgba(44,255,179,0.4)";
      massEditBtn.style.color = "var(--accent)";
    }

    renderMassEditCards();
  }

  function exitMassEditMode() {
    deckBuilderState.isMassEditMode = false;
    deckBuilderState.massEditData = null;

    // Toggle UI
    const deckBuilderBody = document.querySelector(".deck-builder-body");
    if (deckBuilderBody) {
      deckBuilderBody.classList.remove("mass-edit-mode");
    }

    // Show sidebar and restore main area's child elements, hide mass edit container
    const mainArea = document.querySelector(".deck-main-area");
    if (mainArea) {
      mainArea.style.display = "";
      const header = mainArea.querySelector(".deck-main-header");
      const cardEditForm = mainArea.querySelector("#cardEditForm");
      if (header) header.style.display = "";
      if (cardEditForm) cardEditForm.style.display = "";
    }
    if (massEditContainer) massEditContainer.style.display = "none";

    // Update button text
    if (massEditBtn) {
      massEditBtn.textContent = "Mass Edit";
      massEditBtn.style.borderColor = "rgba(255,77,77,0.4)";
      massEditBtn.style.color = "#ff4d4d";
    }

    renderFlashcardList();
  }

  function renderMassEditCards() {
    if (!massEditCards) return;

    massEditCards.innerHTML = "";
    const cards = deckBuilderState.massEditData || deckBuilderState.cards;

    cards.forEach((card, index) => {
      const cardDiv = document.createElement("div");
      cardDiv.className = "mass-edit-card";
      cardDiv.dataset.index = index;

      const priority = card.priority || 3;

      cardDiv.innerHTML = `
        <div class="mass-edit-card-header">
          <span class="mass-edit-card-title">Card ${index + 1}</span>
          <button class="delete-card-btn" data-index="${index}">Delete</button>
        </div>
        <div class="form-group">
          <label>Front</label>
          <textarea class="mass-edit-front" data-index="${index}" placeholder="Question, prompt, or term...">${escapeHtml(card.front || "")}</textarea>
        </div>
        <div class="form-group">
          <label>Back</label>
          <textarea class="mass-edit-back" data-index="${index}" placeholder="Answer, definition, or explanation...">${escapeHtml(card.back || "")}</textarea>
        </div>
        <div class="form-group">
          <label>Priority</label>
          <div class="priority-pills" data-index="${index}">
            ${[1,2,3,4,5].map(p => {
              const color = getPriorityColor(p);
              const isActive = p === priority;
              return `<button type="button" class="priority-pill ${isActive ? 'active' : ''}"
                data-priority="${p}" data-index="${index}"
                style="color: ${isActive ? color : 'var(--text-muted)'}; border-color: ${isActive ? color : 'rgba(255,255,255,0.15)'};"
                title="Set priority to ${['Very Low', 'Low', 'Medium', 'High', 'Very High'][p-1]}">${['Very Low', 'Low', 'Medium', 'High', 'Very High'][p-1]}</button>`;
            }).join("")}
          </div>
        </div>
        <div class="form-group">
          <label>Tags</label>
          <input class="builder-input mass-edit-tags" data-index="${index}" type="text" value="${escapeHtml((card.tags || []).join(', '))}" placeholder="comma, separated" />
        </div>
      `;

      massEditCards.appendChild(cardDiv);
    });

    // Attach event listeners
    attachMassEditEventListeners();
  }

  function attachMassEditEventListeners() {
    // Priority pill clicks
    massEditCards.querySelectorAll(".priority-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const index = parseInt(btn.dataset.index);
        const priority = parseInt(btn.dataset.priority);
        if (deckBuilderState.massEditData[index]) {
          deckBuilderState.massEditData[index].priority = priority;
        }

        // Update UI
        const cardDiv = massEditCards.querySelector(`[data-index="${index}"]`);
        if (cardDiv) {
          cardDiv.querySelectorAll(".priority-pill").forEach(p => {
            const pVal = parseInt(p.dataset.priority);
            const isActive = pVal === priority;
            p.classList.toggle("active", isActive);
            p.style.color = isActive ? getPriorityColor(pVal) : "var(--text-muted)";
            p.style.borderColor = isActive ? getPriorityColor(pVal) : "rgba(255,255,255,0.15)";
          });
        }
      });
    });

    // Content changes
    massEditCards.querySelectorAll(".mass-edit-front").forEach(textarea => {
      textarea.addEventListener("input", () => {
        const index = parseInt(textarea.dataset.index);
        if (deckBuilderState.massEditData[index]) {
          deckBuilderState.massEditData[index].front = textarea.value;
        }
      });
    });

    massEditCards.querySelectorAll(".mass-edit-back").forEach(textarea => {
      textarea.addEventListener("input", () => {
        const index = parseInt(textarea.dataset.index);
        if (deckBuilderState.massEditData[index]) {
          deckBuilderState.massEditData[index].back = textarea.value;
        }
      });
    });

    massEditCards.querySelectorAll(".mass-edit-tags").forEach(input => {
      input.addEventListener("input", () => {
        const index = parseInt(input.dataset.index);
        if (deckBuilderState.massEditData[index]) {
          deckBuilderState.massEditData[index].tags = parseQuickAddTags(input.value);
        }
      });
    });

    // Delete buttons
    massEditCards.querySelectorAll(".delete-card-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const index = parseInt(btn.dataset.index);
        if (await dialog.confirm("Delete this card?")) {
          if (deckBuilderState.massEditData[index]) {
            deckBuilderState.massEditData.splice(index, 1);
            renderMassEditCards();
          }
        }
      });
    });
  }

  async function saveAllMassEditChanges() {
    if (!deckBuilderState.massEditData) return;

    // Cards removed in mass edit are real deletions. Track them before the
    // builder state is replaced so persistDeckCards() can delete just those
    // records without touching any linked knowledge context.
    const remainingIds = new Set(
      deckBuilderState.massEditData.map((card) => card.cardId).filter(Boolean)
    );
    for (const card of deckBuilderState.cards) {
      if (card.cardId && card.isExisting && !remainingIds.has(card.cardId)) {
        deckBuilderState.deletedCardIds.push({ cardId: card.cardId });
      }
    }

    deckBuilderState.cards = deckBuilderState.massEditData.map((card) => ({ ...card }));
    await persistDeckCards();

    if (cardCount) cardCount.textContent = deckBuilderState.cards.length;

    exitMassEditMode();
    renderFlashcardList();

    dialog.alert(`Saved ${deckBuilderState.cards.length} cards.`);
  }

  function processAnkiImport() {
    if (!ankiImportInput || !importFeedback) return;

    const text = ankiImportInput.value.trim();
    if (!text) {
      importFeedback.textContent = "Please paste some cards first.";
      importFeedback.style.color = "#ff4d4d";
      return;
    }

    const { cards, skipped } = parseAnkiCards(text);

    cards.forEach(({ front, back }) => {
      deckBuilderState.cards.push({
        cardId: null,
        front,
        back,
        priority: 3,
        tags: [],
        isExisting: false
      });
    });

    // Clear import area
    ankiImportInput.value = "";

    // Switch back to card form
    const importView = document.getElementById("importView");
    const cardEditForm = document.getElementById("cardEditForm");
    if (importView) importView.style.display = "none";
    if (cardEditForm) cardEditForm.style.display = "block";

    // Update UI
    renderFlashcardList();
    clearForm();

    importFeedback.textContent = `${cards.length} cards imported${skipped > 0 ? `, ${skipped} lines skipped (no tab/pipe separator)` : ""}.`;
    importFeedback.style.color = "#3fd07d";
  }

  // ========== MIDDLE UI FUNCTIONS ==========

  function getGradeDistribution(cards) {
    const grades = {
      new: 0,
      didnt_know: 0,
      kinda: 0,
      easy: 0
    };

    if (!cards || cards.length === 0) return grades;

    cards.forEach(card => {
      const lastGrade = card.meta?.lastGrade;
      if (lastGrade === null || lastGrade === "new" || !lastGrade) {
        grades.new++;
      } else if (lastGrade === "didnt_know") {
        grades.didnt_know++;
      } else if (lastGrade === "kinda") {
        grades.kinda++;
      } else if (lastGrade === "easy") {
        grades.easy++;
      }
    });

    return grades;
  }

  function renderProgressBarInline(grades) {
    const total = (grades.new || 0) + (grades.didnt_know || 0) + (grades.kinda || 0) + (grades.easy || 0);
    const pct = (v) => total > 0 ? ((v || 0) / total * 100) : 0;
    const barId = `progress-bar-${Math.random().toString(36).substr(2, 9)}`;

    return `
      <div class="filter-progress-bar-wrapper">
        <div class="filter-progress-bar-inline" id="${barId}">
          <div class="progress-seg progress-ez" style="width:${pct(grades.easy)}%" data-label="Easy" data-count="${grades.easy}"></div>
          <div class="progress-seg progress-kn" style="width:${pct(grades.kinda)}%" data-label="Kinda" data-count="${grades.kinda}"></div>
          <div class="progress-seg progress-dk" style="width:${pct(grades.didnt_know)}%" data-label="Didn't Know" data-count="${grades.didnt_know}"></div>
          <div class="progress-seg progress-new" style="width:${pct(grades.new)}%" data-label="New" data-count="${grades.new}"></div>
        </div>
        <div class="progress-tooltip" style="display: none;">
          <div class="tooltip-inner">
            <div class="tooltip-label"></div>
            <div class="tooltip-count"></div>
          </div>
        </div>
      </div>
    `;
  }

  function setupProgressBarTooltips(container) {
    if (!container) return;
    const bars = container.querySelectorAll('.filter-progress-bar-inline');
    bars.forEach(bar => {
      const wrapper = bar.closest('.filter-progress-bar-wrapper');
      if (!wrapper) return;
      const tooltip = wrapper.querySelector('.progress-tooltip');
      const segments = bar.querySelectorAll('.progress-seg');

      segments.forEach(seg => {
        seg.addEventListener('mouseenter', () => {
          const label = seg.dataset.label;
          const count = seg.dataset.count;
          tooltip.querySelector('.tooltip-label').textContent = label;
          tooltip.querySelector('.tooltip-count').textContent = count;
          tooltip.style.display = 'block';

          // Position tooltip above the specific segment
          const segRect = seg.getBoundingClientRect();
          const barRect = bar.getBoundingClientRect();
          const segCenterRelative = (segRect.left - barRect.left) + (segRect.width / 2);
          const barWidth = barRect.width;
          const offsetPercent = (segCenterRelative / barWidth) * 100;
          tooltip.style.left = offsetPercent + '%';
        });
      });

      wrapper.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });
  }

  async function loadMiddleUIData() {
    if (state.currentMode === "manual") {
      await loadManualHeaps();
      state.middleUIData = { priorities: [], tags: [], layers: [] };
      return;
    }
    if (!state.currentSubject) return;

    // Get the cards in the current subject or deck, plus subject analyses.
    const [cards, analyses] = await Promise.all([
      loadScopedCards(),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);

    // Priority counts and grades
    const priorityCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const priorityCards = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    let totalWithPriority = 0;
    (cards || []).forEach(card => {
      if (card.priority !== undefined && card.priority !== null) {
        priorityCounts[card.priority] = (priorityCounts[card.priority] || 0) + 1;
        priorityCards[card.priority].push(card);
        totalWithPriority++;
      }
    });

    // Tags - collect from cards and analyses with grade distribution
    const tagSet = new Set();
    const tagCards = new Map();
    (cards || []).forEach(card => {
      (card.tags || []).forEach(tag => {
        tagSet.add(tag);
        if (!tagCards.has(tag)) {
          tagCards.set(tag, []);
        }
        tagCards.get(tag).push(card);
      });
    });
    (analyses || []).forEach(analysis => {
      (analysis.tags || []).forEach(tag => {
        tagSet.add(tag);
        if (!tagCards.has(tag)) {
          tagCards.set(tag, []);
        }
        tagCards.get(tag).push(analysis);
      });
    });
    const tags = Array.from(tagSet).sort().map(tag => {
      const taggedCards = tagCards.get(tag) || [];
      const cardCount = (cards || []).filter(card => (card.tags || []).includes(tag)).length;
      const analysisCount = (analyses || []).filter(analysis => (analysis.tags || []).includes(tag)).length;
      return {
        name: tag,
        count: cardCount + analysisCount,
        grades: getGradeDistribution(taggedCards)
      };
    });

    // Layers - collect from each card's deckPath with grade distribution.
    // Path[0] is the deck itself; path[1..3] are the hierarchy layers.
    const layerMap = new Map(); // layer1 -> { count, cards: [], children: Map(layer2 -> { count, cards: [], children: Map(layer3 -> { count, cards: [] }) }) }

    (cards || []).forEach(card => {
      const path = Array.isArray(card.deckPath) ? card.deckPath : [];
      const l1 = path[1] || "(None)";
      const l2 = path[2] || "";
      const l3 = path[3] || "";

      if (!layerMap.has(l1)) {
        layerMap.set(l1, { count: 0, cards: [], children: new Map() });
      }
      const l1Entry = layerMap.get(l1);
      l1Entry.count++;
      l1Entry.cards.push(card);

      if (l2) {
        if (!l1Entry.children.has(l2)) {
          l1Entry.children.set(l2, { count: 0, cards: [], children: new Map() });
        }
        const l2Entry = l1Entry.children.get(l2);
        l2Entry.count++;
        l2Entry.cards.push(card);

        if (l3) {
          if (!l2Entry.children.has(l3)) {
            l2Entry.children.set(l3, { count: 0, cards: [] });
          }
          const l3Entry = l2Entry.children.get(l3);
          l3Entry.count++;
          l3Entry.cards.push(card);
        }
      }
    });

    // Helper function to recursively build layer objects with grades
    const buildLayerTree = (layerMap) => {
      return Array.from(layerMap.entries()).map(([name, data]) => ({
        name,
        count: data.count,
        grades: getGradeDistribution(data.cards),
        children: data.children.size > 0 ? buildLayerTree(data.children) : []
      }));
    };

    state.middleUIData = {
      priorities: [1, 2, 3, 4, 5].map(p => ({
        value: p,
        count: priorityCounts[p],
        grades: getGradeDistribution(priorityCards[p])
      })),
      tags,
      layers: buildLayerTree(layerMap)
    };
  }

  function renderMiddleUI() {
    if (!middleSubjectName) return;

    const isManual = state.currentMode === "manual";
    middleSubjectName.textContent = isManual
      ? (state.currentSubject ? `Manual · ${state.currentSubject}` : "Manual Heaps")
      : (state.currentDeckName
        ? `${state.currentSubject} / ${state.currentDeckName}`
        : state.currentSubject);

    // Keep the mode pills in sync with the actual study mode. Opening a deck
    // resets to Cards, so a stale Quotes/Analysis pill must not stay active.
    if (middleModeSelector) {
      middleModeSelector.querySelectorAll(".mode-pill").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === state.currentMode);
      });
    }

    if (middleStudyBtn) {
      middleStudyBtn.textContent = isManual ? "Study Heap" : "Study";
    }
    if (deckScopeToggle) {
      const showScopeToggle = !!state.currentDeckId && !isManual;
      deckScopeToggle.style.display = showScopeToggle ? "" : "none";
      deckScopeToggle.textContent = state.directCardsOnly ? "Direct only" : "Include subdecks";
      deckScopeToggle.title = state.directCardsOnly
        ? "Only cards in this deck"
        : "Include cards from subdecks";
      deckScopeToggle.setAttribute("aria-pressed", state.directCardsOnly ? "true" : "false");
      deckScopeToggle.classList.toggle("active", state.directCardsOnly);
    }
    if (manualHeapPanel) manualHeapPanel.style.display = isManual ? "block" : "none";
    const filterModeToggle = document.getElementById("filterModeToggle");
    if (filterModeToggle) filterModeToggle.style.display = isManual ? "none" : "";
    const middleContent = document.getElementById("middleContent");
    if (middleContent) middleContent.style.display = isManual ? "none" : "";
    if (isManual) renderManualHeapPanel();

    // Render priority checkboxes
    if (priorityCheckboxes) {
      priorityCheckboxes.innerHTML = state.middleUIData.priorities.map(p => `
        <div class="filter-row ${state.selectedPriorities.includes(p.value) ? 'selected' : ''}" data-priority="${p.value}">
          <input type="checkbox" class="filter-row-checkbox" ${state.selectedPriorities.includes(p.value) ? 'checked' : ''}>
          <span class="filter-row-label" style="color: ${getPriorityColor(p.value)};">${['Very Low', 'Low', 'Medium', 'High', 'Very High'][p.value - 1]}</span>
          ${renderProgressBarInline(p.grades)}
          <span class="filter-row-count">${p.count}</span>
        </div>
      `).join("");

      priorityCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT") return;
          const priority = parseInt(row.dataset.priority);
          togglePriority(priority);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const priority = parseInt(row.dataset.priority);
            togglePriority(priority);
          });
        }
      });
    }

    // Render tag checkboxes
    if (tagsCheckboxes) {
      tagsCheckboxes.innerHTML = state.middleUIData.tags.length > 0
        ? state.middleUIData.tags.map(tag => `
          <div class="filter-row ${state.selectedTags.includes(tag.name) ? 'selected' : ''}" data-tag="${tag.name}">
            <input type="checkbox" class="filter-row-checkbox" ${state.selectedTags.includes(tag.name) ? 'checked' : ''}>
            <span class="filter-row-label">${escapeHtml(tag.name)}</span>
            ${renderProgressBarInline(tag.grades)}
            <span class="filter-row-count">${tag.count}</span>
            <button class="filter-row-study-btn" data-tag="${tag.name}">Study</button>
          </div>
        `).join("")
        : '<div style="color: var(--text-muted); font-size: 0.85rem;">No tags found in this subject.</div>';

      tagsCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT" || e.target.classList.contains("filter-row-study-btn")) return;
          const tag = row.dataset.tag;
          toggleTag(tag);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const tag = row.dataset.tag;
            toggleTag(tag);
          });
        }
        const studyBtn = row.querySelector(".filter-row-study-btn");
        if (studyBtn) {
          studyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tag = studyBtn.dataset.tag;
            state.sessionFilter = {
              mode: state.currentMode,
              filterMode: state.filterMode,
              priorities: [...state.selectedPriorities],
              tags: [tag],
              layers: [...state.selectedLayers]
            };
            state.view = "study";
            loadFlashcards().then(renderUI);
          });
        }
      });
    }

    // Render layer checkboxes (tree structure)
    if (layersCheckboxes) {
      layersCheckboxes.innerHTML = state.middleUIData.layers.length > 0
        ? state.middleUIData.layers.map(layer => renderLayerTree(layer, 0)).join("")
        : '<div style="color: var(--text-muted); font-size: 0.85rem;">No layers found in this subject.</div>';

      // Attach event listeners to all layer rows
      layersCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT" || e.target.classList.contains("filter-row-study-btn")) return;
          const layer = row.dataset.layer;
          if (layer) toggleLayer(layer);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const layer = row.dataset.layer;
            if (layer) toggleLayer(layer);
          });
        }
        const studyBtn = row.querySelector(".filter-row-study-btn");
        if (studyBtn) {
          studyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const layer = studyBtn.dataset.layer;
            state.sessionFilter = {
              mode: state.currentMode,
              filterMode: state.filterMode,
              priorities: [...state.selectedPriorities],
              tags: [...state.selectedTags],
              layers: layer ? [layer] : []
            };
            state.view = "study";
            loadFlashcards().then(renderUI);
          });
        }
      });
    }

    // Setup tooltips for progress bars
    const middleUI = document.getElementById('middleUI');
    if (middleUI) {
      setupProgressBarTooltips(middleUI);
    }
  }

  function renderLayerTree(layer, depth) {
    const isSelected = state.selectedLayers.includes(layer.name);
    let html = `
      <div class="filter-row ${isSelected ? 'selected' : ''}" data-layer="${layer.name}" style="margin-left: ${depth * 20}px;">
        <input type="checkbox" class="filter-row-checkbox" ${isSelected ? 'checked' : ''}>
        <span class="filter-row-label">${escapeHtml(layer.name)}</span>
        ${renderProgressBarInline(layer.grades)}
        <span class="filter-row-count">${layer.count}</span>
        <button class="filter-row-study-btn" data-layer="${layer.name}">Study</button>
      </div>
    `;

    if (layer.children && layer.children.length > 0) {
      html += '<div class="layer-tree">';
      layer.children.forEach(child => {
        html += renderLayerTree(child, depth + 1);
      });
      html += '</div>';
    }

    return html;
  }

  function togglePriority(priority) {
    const index = state.selectedPriorities.indexOf(priority);
    if (index === -1) {
      state.selectedPriorities.push(priority);
    } else {
      state.selectedPriorities.splice(index, 1);
    }
    renderMiddleUI();
  }

  function toggleTag(tag) {
    const index = state.selectedTags.indexOf(tag);
    if (index === -1) {
      state.selectedTags.push(tag);
    } else {
      state.selectedTags.splice(index, 1);
    }
    renderMiddleUI();
  }

  function toggleLayer(layer) {
    const index = state.selectedLayers.indexOf(layer);
    if (index === -1) {
      state.selectedLayers.push(layer);
    } else {
      state.selectedLayers.splice(index, 1);
    }
    renderMiddleUI();
  }

  function passesFilter(card, filter) {
    const isAND = filter.filterMode === "AND";

    // Priority check
    if (filter.priorities.length > 0) {
      const cardPriority = card.record?.priority ?? card.targetRecord?.priority;
      const priorityMatch = filter.priorities.includes(cardPriority);
      if (isAND && !priorityMatch) return false;
      if (!isAND && priorityMatch) return true;
      if (!isAND && !priorityMatch) { /* continue checking other filters */ }
    }

    // Tag check
    if (filter.tags.length > 0) {
      const cardTags = [
        ...(Array.isArray(card.record?.tags) ? card.record.tags : []),
        ...(Array.isArray(card.record?.meta?.tags) ? card.record.meta.tags : [])
      ];
      const hasTag = filter.tags.some(t => cardTags.includes(t));
      if (isAND && !hasTag) return false;
      if (!isAND && hasTag) return true;
    }

    // Layer check
    if (filter.layers.length > 0) {
      const path = Array.isArray(card.record?.deckPath)
        ? card.record.deckPath
        : Array.isArray(card.record?.meta?.hierarchyPath)
          ? card.record.meta.hierarchyPath
          : [];
      const inLayer = filter.layers.some(l => path.includes(l));
      if (isAND && !inLayer) return false;
      if (!isAND && inLayer) return true;
    }

    // For AND mode: if we got here, all selected filters passed
    // For OR mode: if we got here and no match found yet, return false
    // BUT if no filters are active, all cards should pass
    const hasAnyFilter = filter.priorities.length > 0 || filter.tags.length > 0 || filter.layers.length > 0;
    if (!hasAnyFilter) return true;

    if (isAND) {
      return true; // All active filters passed
    } else {
      return false; // No matching filter found in OR mode
    }
  }

  window.__neuronetMemoryCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleKeyDown);
    if (activeModal) {
      activeModal = null;
      setBackgroundInert(false);
    }
    // These were moved to <body> so they could cover the fixed shell.
    deckBuilderModal?.remove();
    quickAddModal?.remove();
    deckDeleteModal?.remove();
    cardPeekModal?.remove();
  };

  await initialize();
}
