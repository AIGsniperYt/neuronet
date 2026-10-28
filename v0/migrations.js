/**
 * Migration utilities to convert from old combined quote+analysis structure
 * to new separated quote and analysis nodes with many-to-many linking.
 * 
 * OLD STRUCTURE:
 *   - Analysis nodes contained both quote text AND analysis commentary
 *   - 1-to-1 relationship between quote and analysis
 *   - Tied to specific source section (Act 1 > Scene 3)
 * 
 * NEW STRUCTURE:
 *   - Quote nodes are separate from analysis nodes
 *   - Analysis nodes are standalone and reference multiple quotes
 *   - Analysis nodes exist at global subject level, not scene-specific
 *   - Bidirectional linking via quoteRefs and analysisNodeIds
 */

/**
 * Migrate old analysis nodes to new structure
 * Call this once after updating to the new schema
 * @param {Array} allNodes - All existing nodes from database
 * @returns {Object} { quotes: Array, analyses: Array } - Migrated nodes
 */
export function migrateOldAnalysisNodes(allNodes) {
  const quotes = [];
  const analyses = [];
  const analysisNodesThatHadQuotes = allNodes.filter(n => n.type === "analysis" && n.quote);

  for (const oldNode of analysisNodesThatHadQuotes) {
    // 1. Create a quote node from the old analysis node
    const quoteNode = {
      id: `quote-${oldNode.id}`,
      type: "quote",
      subject: oldNode.subject,
      section: oldNode.section,
      title: oldNode.title,
      quote: oldNode.quote, // Extract quote from old node
      link: oldNode.link, // Keep source link info
      meta: {
        hierarchyPath: oldNode.meta?.hierarchyPath || [],
        sourceOrder: oldNode.meta?.sourceOrder,
        tags: oldNode.meta?.tags || [],
        analysisNodeIds: [oldNode.id], // Link to the analysis node
      },
      createdAt: oldNode.createdAt,
      updatedAt: oldNode.updatedAt,
    };

    // 2. Create an analysis node (without quote, now independent)
    const analysisNode = {
      id: oldNode.id,
      type: "analysis",
      subject: oldNode.subject,
      section: null, // NEW: No longer section-specific
      title: oldNode.title,
      content: "",
      analysis: oldNode.analysis, // The commentary
      quoteRefs: [
        {
          quoteId: quoteNode.id,
          section: oldNode.section,
          quote: oldNode.quote,
        }
      ],
      meta: {
        globalScope: true,
        tags: oldNode.meta?.tags || [],
        confidence: oldNode.meta?.confidence ?? 0.7,
        nextReview: oldNode.meta?.nextReview,
      },
      createdAt: oldNode.createdAt,
      updatedAt: oldNode.updatedAt,
    };

    quotes.push(quoteNode);
    analyses.push(analysisNode);
  }

  return { quotes, analyses };
}

/**
 * Apply migration to IndexedDB
 * This should be called after initDB() when user first opens the app
 * @param {Function} getAllNodes - db function to get all nodes
 * @param {Function} addNode - db function to add node
 * @param {Function} addQuote - db function to add quote (new)
 * @returns {Promise<void>}
 */
export async function performMigration(getAllNodes, addNode, addQuote) {
  const allNodes = await getAllNodes();
  
  // Check if migration is needed
  const hasOldAnalysisNodes = allNodes.some(n => n.type === "analysis" && n.quote && !n.quoteRefs);
  const hasNewQuoteNodes = allNodes.some(n => n.type === "quote");

  if (!hasOldAnalysisNodes || hasNewQuoteNodes) {
    // Migration not needed or already done
    return;
  }

  console.log("[MIGRATION] Starting migration of old analysis nodes...");

  try {
    const { quotes, analyses } = migrateOldAnalysisNodes(allNodes);

    // Add all quote nodes
    for (const quote of quotes) {
      await addQuote(quote);
    }

    // Update all analysis nodes to use new structure
    for (const analysis of analyses) {
      await addNode(analysis);
    }

    console.log(`[MIGRATION] Successfully migrated ${quotes.length} quotes and ${analyses.length} analyses`);
  } catch (error) {
    console.error("[MIGRATION] Error during migration:", error);
  }
}

/**
 * Utility: Find or create a quote node for a given text and source
 * Useful for creating quote nodes from existing selections
 * @param {string} quoteText - The quoted text
 * @param {string} sourceId - The source ID
 * @param {number} start - Start position in source
 * @param {number} end - End position in source  
 * @param {string} subject - Subject name
 * @param {string} section - Source section (e.g. "Act 1 > Scene 3")
 * @returns {Object} Quote node object
 */
export function createQuoteNode(quoteText, sourceId, start, end, subject, section = "") {
  return {
    id: crypto.randomUUID(),
    type: "quote",
    subject: subject,
    section: section,
    title: "",
    quote: quoteText,
    link: {
      sourceId: sourceId,
      start: start,
      end: end,
    },
    meta: {
      hierarchyPath: section ? section.split(" > ") : [subject],
      sourceOrder: start,
      tags: [],
      analysisNodeIds: [],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Utility: Create a new analysis node with optional quote references
 * @param {string} subject - Subject name
 * @param {string} title - Analysis title/topic
 * @param {string} analysis - Analysis commentary
 * @param {Array} quoteRefs - Array of quote references [{quoteId, section, quote}, ...]
 * @param {Array} tags - Tags for the analysis
 * @returns {Object} Analysis node object
 */
export function createAnalysisNode(subject, title, analysis, quoteRefs = [], tags = []) {
  return {
    id: crypto.randomUUID(),
    type: "analysis",
    subject: subject,
    section: null,
    title: title,
    content: "",
    analysis: analysis,
    quoteRefs: quoteRefs,
    meta: {
      globalScope: true,
      tags: tags,
      confidence: 0.5,
      nextReview: null,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
