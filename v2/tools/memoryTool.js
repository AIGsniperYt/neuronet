export async function initMemoryTool(deps, context = {}) {
const {
  getAllNodes,
  getAllQuotes,
  getAllCues,
  getQuotesForSubject,
  getAnalysisNodesForSubject,
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
      correctOption: null,
      answered: false,
      wasCorrect: null
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
        const modes = ["quote-learning", "analysis-learning", "evidence-matching"];
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

    if (closeStatsBtn) {
      closeStatsBtn.addEventListener("click", () => {
        if (memoryStats) memoryStats.style.display = "none";
      });
    }

    if (flashcard) {
      flashcard.addEventListener("click", (e) => {
        if (e.target.closest(".memory-btn")) return;
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
    state.isFlipped = !state.isFlipped;
    renderUI();
  }

  function navigatePrevious() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      state.isFlipped = false;
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

    if (state.currentIndex < state.flashcards.length - 1) {
      state.currentIndex++;
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

    if (state.currentMode === "quote-learning") {
        await loadQuoteLearningFlashcards();
    } else if (state.currentMode === "analysis-learning") {
        await loadAnalysisLearningFlashcards();
    } else if (state.currentMode === "evidence-matching") {
        await loadEvidenceMatchingFlashcards();
    }
    
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
    if (!state.currentSubject) {
      return;
    }
    const quotes = await getQuotesForSubject(state.currentSubject);
    state.flashcards = await Promise.all(quotes.map(async (quote) => {
      const analyses = await getAnalysesReferencingQuote(quote.id);
      const cues = await getCuesForQuote(quote.id);
      const cueNode = cues.length > 0 ? cues[0] : null;
      return {
        id: quote.id,
        type: "quote-learning",
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
        }
      };
    }));
  }

  function getCueForQuote(quote, cueNode = null) {
    if (cueNode?.cue) {
      return cueNode.cue;
    }
    const words = quote.quote.split(' ');
    if (words.length <= 4) return quote.quote;
    return `${words[0]} ... ${words[words.length - 1]}`;
  }

  async function loadAnalysisLearningFlashcards() {
    if (!state.currentSubject) {
      return;
    }
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    state.flashcards = await Promise.all(analyses.map(async (analysis) => {
      const quotes = await getQuotesReferencedByAnalysis(analysis.id);
      return {
        id: analysis.id,
        type: "analysis-learning",
        front: {
          content: analysis.title || "What is the analysis?",
          isQuestion: true,
          quotes: quotes
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