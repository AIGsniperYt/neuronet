export async function initMemoryTool(deps, context = {}) {
const {
  getAllNodes,
  getAllQuotes,
  getQuotesForSubject,
  getAnalysisNodesForSubject,
  getQuotesReferencedByAnalysis,
  getAnalysesReferencingQuote,
  getNode,
  getNodeTimestamp,
  escapeHtml
} = deps;

  const { subject: contextSubject } = context;

  if (typeof window.__neuronetMemoryCleanup === "function") {
    window.__neuronetMemoryCleanup();
  }

  const state = {
    currentSubject: contextSubject || "",
    currentMode: "quote-learning",
    flashcards: [],
    currentIndex: 0,
    isFlipped: false,
    showAnalysis: false,
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
      correctOption: null
    }
  };

  let memoryTool, modeSelect, newSessionBtn, statsBtn;
  let flashcardContainer, flashcard, flashcardContent, flashcardBackContent;
  let flipBtn, prevBtn, nextBtn, showAnalysisBtn;
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
    evidenceMatchingContainer = document.getElementById("evidenceMatchingContainer");
    evidencePrompt = document.getElementById("evidencePrompt");
    quoteOptions = document.getElementById("quoteOptions");
    evidenceFeedback = document.getElementById("evidenceFeedback");
    memoryStats = document.getElementById("memoryStats");
    statsContent = document.getElementById("statsContent");
    closeStatsBtn = document.getElementById("closeStatsBtn");
    
    console.log("DOM elements retrieved:", { 
      flashcard: !!flashcard, 
      flashcardContent: !!flashcardContent, 
      flashcardBackContent: !!flashcardBackContent,
      flashcardClassList: flashcard ? !!flashcard.classList : false
    });
  }

  async function initialize() {
    try {
      getDOMElements();
      await refreshSubjectList();
      await loadFlashcards();
      renderUI();
      document.addEventListener("db-change", handleDBChange);
    } catch (error) {
      console.error("Failed to initialize memory tool:", error);
      if (flashcardContent) {
        flashcardContent.textContent = `Error loading memory tool: ${error.message}`;
      }
    }
  }

  function handleDBChange(event) {
    loadFlashcards().then(renderUI);
  }

  async function refreshSubjectList() {
    const subjects = await getAllSubjects();
    if (subjects.length > 0 && !state.currentSubject) {
      state.currentSubject = subjects[0];
    }
  }

  async function getAllSubjects() {
    const nodes = await getAllNodes();
    const subjects = new Set();
    nodes.forEach(node => {
      if (node.subject) subjects.add(node.subject);
    });
    return Array.from(subjects);
  }

async function loadFlashcards() {
    state.flashcards = [];
    state.currentIndex = 0;
    state.isFlipped = false;

    if (state.currentMode === "quote-learning") {
        await loadQuoteLearningFlashcards();
    } else if (state.currentMode === "analysis-learning") {
        await loadAnalysisLearningFlashcards();
    } else if (state.currentMode === "evidence-matching") {
        await loadEvidenceMatchingFlashcards();
    }
    
    // Apply custom flashcard ordering algorithm
    state.flashcards = applyCustomFlashcardOrder(state.flashcards);
}

// Placeholder function for custom flashcard algorithm (e.g., spaced-repetition, custom ordering)
// Replace this function with your own implementation to customize flashcard order
function applyCustomFlashcardOrder(flashcards) {
    // Default implementation returns flashcards in original order
    // To implement your own algorithm:
    // 1. Replace this function body with your sorting/prioritization logic
    // 2. Return the reordered flashcards array
    // 
    // Example for simple shuffle:
    // return shuffleArray([...flashcards]);
    //
    // Example for priority-based ordering (if you add priority to flashcards):
    // return [...flashcards].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return flashcards;
}

  async function loadQuoteLearningFlashcards() {
    const quotes = await getQuotesForSubject(state.currentSubject);
    state.flashcards = await Promise.all(quotes.map(async (quote) => {
      // Get analyses that reference this quote
      const analyses = await getAnalysesReferencingQuote(quote.id);
      return {
        id: quote.id,
        type: "quote-learning",
        front: {
          content: getCueForQuote(quote) || `Recall the quote from "${quote.section || "this source"}"`,
          isCue: true
        },
        back: {
          content: quote.quote,
          isQuote: true,
          quoteData: quote,
          analyses: analyses // Store linked analyses for display
        }
      };
    }));
  }

  function getCueForQuote(quote) {
    const words = quote.quote.split(' ');
    if (words.length <= 4) return quote.quote;
    return `${words[0]} ... ${words[words.length - 1]}`;
  }

  async function loadAnalysisLearningFlashcards() {
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    state.flashcards = await Promise.all(analyses.map(async (analysis) => {
      // Get quotes referenced by this analysis
      const quotes = await getQuotesReferencedByAnalysis(analysis.id);
      return {
        id: analysis.id,
        type: "analysis-learning",
        front: {
          content: analysis.title || "What is the analysis?",
          isQuestion: true,
          quotes: quotes // Store linked quotes for display
        },
        back: {
          content: analysis.analysis,
          isAnalysis: true,
          analysisData: analysis
        }
      };
    }));
  }

  async function loadEvidenceMatchingFlashcards() {
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (analyses.length === 0) {
      state.flashcards = [];
      return;
    }
    await loadEvidenceMatchingForAnalysis(analyses[0].id);
  }

  async function loadEvidenceMatchingForAnalysis(analysisId) {
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
      correctOption: referencedQuotes.map(q => q.id)
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
        "Evidence Matching";
    }

    if (flashcardContainer) flashcardContainer.style.display = 
      state.currentMode !== "evidence-matching" ? "flex" : "none";
    if (evidenceMatchingContainer) evidenceMatchingContainer.style.display = 
      state.currentMode === "evidence-matching" ? "block" : "none";
    if (memoryStats) memoryStats.style.display = "none";

    if (state.flashcards.length > 0 && state.currentIndex < state.flashcards.length) {
      const flashcardData = state.flashcards[state.currentIndex];
      updateFlashcardDisplay(flashcardData, flashcard);
    } else {
      if (flashcardContent) flashcardContent.textContent = "No flashcards available for this subject.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Add some content first in the Analysis tool.";
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
     } else if (front.isAnalysis) {
       flashcardContent.innerHTML = `<div class="analysis-preview">${formatAnalysisForDisplay(front.content || "")}</div>`;
     } else if (front.isQuote) {
       flashcardContent.innerHTML = `<div class="quote">${escapeHtml(front.content || "")}</div>`;
       // Show quote source if available
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
    if (prevBtn) prevBtn.disabled = state.currentIndex === 0;
    if (nextBtn) nextBtn.disabled = state.currentIndex >= state.flashcards.length - 1;
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

    evidencePrompt.innerHTML = `<div class="analysis">${formatAnalysisForDisplay(state.evidenceMatching.currentAnalysis.analysis)}</div>`;

    quoteOptions.innerHTML = "";
    state.evidenceMatching.quoteOptions.forEach((quote, index) => {
      const isSelected = state.evidenceMatching.selectedOption === index;
      const optionDiv = document.createElement("div");
      optionDiv.className = `quote-option ${isSelected ? "selected" : ""}`;
      optionDiv.innerHTML = `
        <div class="quote-text">${escapeHtml(quote.quote)}</div>
        ${quote.section ? `<div class="quote-source">${escapeHtml(quote.section)}</div>` : ""}
      `;
      optionDiv.onclick = () => selectQuoteOption(index);
      quoteOptions.appendChild(optionDiv);
    });

    evidenceFeedback.textContent = "";
    evidenceFeedback.className = "";
  }

  function selectQuoteOption(index) {
    state.evidenceMatching.selectedOption = index;
    renderEvidenceMatchingUI();
  }

  function checkEvidenceMatchingAnswer() {
    if (state.evidenceMatching.selectedOption === null) return false;

    const selectedQuoteId = state.evidenceMatching.quoteOptions[state.evidenceMatching.selectedOption].id;
    const isCorrect = state.evidenceMatching.correctOption?.includes(selectedQuoteId) || false;

    evidenceFeedback.textContent = isCorrect ? "Correct!" : "Incorrect. Try again.";
    evidenceFeedback.className = isCorrect ? "feedback-correct" : "feedback-incorrect";

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

  // Event listeners
  if (modeSelect) {
    modeSelect.addEventListener("click", () => {
      const modes = ["quote-learning", "analysis-learning", "evidence-matching"];
      const currentIndex = modes.indexOf(state.currentMode);
      state.currentMode = modes[(currentIndex + 1) % modes.length];
      loadFlashcards();
    });
  }

  if (newSessionBtn) {
    newSessionBtn.addEventListener("click", () => {
      state.currentIndex = 0;
      state.isFlipped = false;
      state.showAnalysis = false;
      loadFlashcards();
    });
  }

  if (statsBtn) {
    statsBtn.addEventListener("click", () => {
      renderStats();
      memoryStats.style.display = "block";
    });
  }

  if (flipBtn) {
    flipBtn.addEventListener("click", () => {
      state.isFlipped = !state.isFlipped;
      renderUI();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.currentIndex > 0) {
        state.currentIndex--;
        state.isFlipped = false;
        renderUI();
      }
    });
  }

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        // Handle evidence matching mode: next button checks answer
        if (state.currentMode === "evidence-matching" && state.evidenceMatching.selectedOption !== null) {
          const wasCorrect = checkEvidenceMatchingAnswer();
          renderUI(); // Show feedback immediately
          return;
        }

        // For all other modes, or if no option selected in evidence matching, move to next flashcard
        if (state.currentIndex < state.flashcards.length - 1) {
          state.currentIndex++;
          state.isFlipped = false;
          renderUI();
        }
      });
    }

  if (showAnalysisBtn) {
    showAnalysisBtn.addEventListener("click", () => {
      state.showAnalysis = !state.showAnalysis;
      renderUI();
    });
  }

  if (closeStatsBtn) {
    closeStatsBtn.addEventListener("click", () => {
      memoryStats.style.display = "none";
    });
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
  };

  await initialize();
}