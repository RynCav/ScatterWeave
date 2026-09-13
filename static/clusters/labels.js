export const STOPWORDS = new Set([
    "the", "and", "for", "that", "this", "with", "from", "your", "have",
    "more", "will", "about", "what", "when", "where", "which", "there", "has", "sed", "said", "cap",
    "their", "they", "would", "could", "should", "into", "over", "under",
    "some", "such", "than", "then", "just", "also", "very", "can", "has",
    "not", "are", "was", "were", "been", "being", "out", "all", "any",   "using", "based", "results", "paper", "model", "models", "approach", "method", "methods",
        "data", "dataset", "datasets", "learning", "research", "study", "studies", "new", "proposed",
        "show", "use", "used", "et", "al", "etc", "analysis", "performance", "system", "systems",
        "evaluation", "framework", "process", "development", "application", "applications",
        "novel", "efficient", "effective", "experimental", "compared", "state", "art", "work",
        "problem", "problems", "solution", "solutions", "task", "tasks", "technique", "techniques",


        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "first", "second", "third", "fourth", "fifth", "single", "double", "multiple",
        "zero", "hundred", "thousand", "million", "total", "average", "mean", "median",


        "year", "years", "month", "months", "time", "date", "dates", "period", "history",
        "current", "future", "past", "recent", "recently", "age", "ages", "daily", "weekly",
        "annual", "century", "decades", "decade", "day", "days", "hour", "hours", "time-series",

  
        "figure", "table", "page", "pages", "vol", "volume", "issue", "section", "abstract",
        "introduction", "conclusion", "references", "chapter", "appendix", "text", "graph", "chart", "effort",
        
      
        "doi", "url", "http", "https", "www", "com", "org", "net", "pdf", "html",
        "proceedings", "conference", "journal", "published", "publisher", "copyright", "university",
        "press", "editor", "editors", "editorial", "isbn", "issn", "author", "authors", "wiley", "these", "terms", "hill", "fig", "res", "tec", "values", "high", "may", "between", 
        "scale", "low", "vertical", "during"
]);


/**
 * Safely extracts raw text payload from various data structures.
 * @param {string|Object|HTMLElement} target
 * @returns {string}
 */
export function extractTextPayload(target) {
    if (!target) return "";
    if (typeof target === "string") return target;

    // Handle standard object properties
    if (typeof target === "object") {
        return target.text ||
               target.content ||
               target.body ||
               target.description ||
               target.title ||
               target.label ||
               (target.innerText ? target.innerText : JSON.stringify(target));
    }

    return String(target);
}

/**
 * Extracts top keywords from a text string based on word frequency.
 * @param {string} text - Raw input text
 * @param {number} topK - Number of keywords to return
 * @returns {Array<{word: string, count: number}>}
 */
export function extractKeywords(text, topK = 5) {
    const rawText = extractTextPayload(text).toLowerCase();

    // Match words with 3 or more characters
    const words = rawText.match(/\b[a-z]{3,}\b/g) || [];
    const frequencies = {};

    for (const word of words) {
        if (!STOPWORDS.has(word)) {
            frequencies[word] = (frequencies[word] || 0) + 1;
        }
    }

    // Sort by frequency descending and return top K
    return Object.entries(frequencies)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([word, count]) => ({ word, count }));
}


/**
 * Builds a network graph dataset (nodes and links) from target texts based on keyword co-occurrence.
 * @param {Array<any>} targets - List of documents, data points, or text strings
 * @returns {{ nodes: Array, links: Array }}
 */
export function buildKeywordNetwork(targets = []) {
    const nodesMap = new Map();
    const linksMap = new Map();

    targets.forEach((target, index) => {
        const targetId = target.id || `target-${index}`;
        const text = extractTextPayload(target);
        const keywords = extractKeywords(text, 5);

        // Add target document as a node
        if (!nodesMap.has(targetId)) {
            nodesMap.set(targetId, {
                id: targetId,
                label: target.title || `Doc ${index + 1}`,
                type: "document",
                weight: 1
            });
        }

        // Add keywords as nodes and link them to the document
        keywords.forEach(({ word, count }) => {
            const keywordId = `kw-${word}`;

            if (!nodesMap.has(keywordId)) {
                nodesMap.set(keywordId, {
                    id: keywordId,
                    label: word,
                    type: "keyword",
                    weight: count
                });
            } else {
                nodesMap.get(keywordId).weight += count;
            }

            // Create or increment link between document and keyword
            const linkId = `${targetId}->${keywordId}`;
            if (!linksMap.has(linkId)) {
                linksMap.set(linkId, {
                    source: targetId,
                    target: keywordId,
                    weight: count
                });
            } else {
                linksMap.get(linkId).weight += count;
            }
        });
    });

    return {
        nodes: Array.from(nodesMap.values()),
        links: Array.from(linksMap.values())
    };
}




