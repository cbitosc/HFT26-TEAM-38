/**
 * Crossref API Client & Metadata Verification Service
 *
 * Handles official publication metadata ingestion, DOI resolution,
 * BibTeX citation generation, and cross-validation against uploaded documents.
 */

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  name: string;
  affiliation?: string[];
}

export interface CrossrefWork {
  doi: string;
  title: string;
  authors: CrossrefAuthor[];
  containerTitle: string | null;
  publisher: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  citationCount: number;
  abstract: string | null;
  type: string;
  issn: string[];
  isbn: string[];
  url: string;
  bibtex?: string;
}

export interface CrossrefSearchResponse {
  total: number;
  items: CrossrefWork[];
}

export interface CrossValidationResult {
  verified: boolean;
  confidence: number; // 0 to 1
  matchedWork: CrossrefWork | null;
  doi: string | null;
  venueMatch: boolean;
  officialTitle: string | null;
  authorMatchCount: number;
  discrepancies: string[];
}

const CROSSREF_BASE_URL = "https://api.crossref.org";
const USER_AGENT = "Veritas-Research-Assistant/1.0 (mailto:veritas-crossref@cbit.edu)";

/**
 * Strips HTML / JATS XML tags from Crossref abstracts.
 */
function cleanAbstract(raw?: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/<jats:[^>]+>/gi, "")
    .replace(/<\/jats:[^>]+>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synthesizes standard BibTeX format from publication metadata.
 */
export function generateBibtex(work: {
  doi: string;
  title: string;
  authors?: CrossrefAuthor[];
  containerTitle?: string | null;
  publisher?: string | null;
  publicationYear?: number | null;
}): string {
  const firstAuthorFamily = work.authors?.[0]?.family || "researcher";
  const citeKey = `${firstAuthorFamily.toLowerCase().replace(/[^a-z0-9]/g, "")}${work.publicationYear || "2026"}`;
  const authorStr = (work.authors || [])
    .map((a) => (a.family && a.given ? `${a.family}, ${a.given}` : a.name))
    .join(" and ");

  return `@article{${citeKey},
  title = {${work.title}},
  author = {${authorStr || "Unknown"}},
  journal = {${work.containerTitle || "Conference / Journal"}},
  year = {${work.publicationYear || new Date().getFullYear()}},
  doi = {${work.doi}},
  publisher = {${work.publisher || "Academic Publisher"}}
}`;
}

/**
 * Normalizes raw Crossref item into clean Veritas schema.
 */
export function normalizeCrossrefWork(raw: Record<string, unknown>): CrossrefWork {
  const doi = String(raw.DOI || "").trim();
  const titles = (raw.title as string[]) || [];
  const title = titles[0] || (raw["container-title"] as string[])?.[0] || "Untitled Work";

  const rawAuthors = (raw.author as Array<{ given?: string; family?: string; name?: string; affiliation?: Array<{ name?: string }> }>) || [];
  const authors: CrossrefAuthor[] = rawAuthors.map((a) => {
    const family = a.family || "";
    const given = a.given || "";
    const name = a.name || `${given} ${family}`.trim() || "Author";
    const affiliation = (a.affiliation || []).map((aff) => aff?.name || "").filter(Boolean);
    return { given, family, name, affiliation };
  });

  const containers = (raw["container-title"] as string[]) || [];
  const containerTitle = containers[0] || null;
  const publisher = (raw.publisher as string) || null;

  // Extract year
  let publicationYear: number | null = null;
  let publicationDate: string | null = null;
  const dateParts =
    (raw["published-print"] as { "date-parts"?: number[][] })?.["date-parts"]?.[0] ||
    (raw["published-online"] as { "date-parts"?: number[][] })?.["date-parts"]?.[0] ||
    (raw.created as { "date-parts"?: number[][] })?.["date-parts"]?.[0];

  if (Array.isArray(dateParts) && dateParts.length > 0) {
    publicationYear = Number(dateParts[0]) || null;
    publicationDate = dateParts.map(String).join("-");
  }

  const citationCount = typeof raw["is-referenced-by-count"] === "number" ? raw["is-referenced-by-count"] : 0;
  const abstract = cleanAbstract(raw.abstract as string | undefined);
  const type = String(raw.type || "journal-article");
  const issn = Array.isArray(raw.ISSN) ? (raw.ISSN as string[]) : [];
  const isbn = Array.isArray(raw.ISBN) ? (raw.ISBN as string[]) : [];
  const url = String(raw.URL || (doi ? `https://doi.org/${doi}` : ""));

  const work: CrossrefWork = {
    doi,
    title,
    authors,
    containerTitle,
    publisher,
    publicationYear,
    publicationDate,
    citationCount,
    abstract,
    type,
    issn,
    isbn,
    url,
  };

  work.bibtex = generateBibtex(work);
  return work;
}

/**
 * Searches Crossref metadata repository.
 */
export async function searchCrossrefWorks(params: {
  query?: string;
  title?: string;
  author?: string;
  rows?: number;
}): Promise<CrossrefSearchResponse> {
  const rows = Math.min(30, Math.max(1, params.rows || 10));
  const url = new URL(`${CROSSREF_BASE_URL}/works`);
  url.searchParams.set("rows", String(rows));

  if (params.query?.trim()) {
    url.searchParams.set("query", params.query.trim());
  }
  if (params.title?.trim()) {
    url.searchParams.set("query.title", params.title.trim());
  }
  if (params.author?.trim()) {
    url.searchParams.set("query.author", params.author.trim());
  }

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`Crossref API error (${res.status}): ${errorBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    message?: {
      "total-results"?: number;
      items?: Record<string, unknown>[];
    };
  };

  const total = data.message?.["total-results"] || 0;
  const items = (data.message?.items || []).map(normalizeCrossrefWork);

  return { total, items };
}

/**
 * Resolves verified Crossref metadata for a specific DOI.
 */
export async function getCrossrefWorkByDoi(doi: string): Promise<CrossrefWork | null> {
  const cleanDoi = doi.trim().replace(/^https?:\/\/doi\.org\//i, "");
  const url = `${CROSSREF_BASE_URL}/works/${encodeURIComponent(cleanDoi)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { message?: Record<string, unknown> };
  if (!data.message) return null;
  return normalizeCrossrefWork(data.message);
}

/**
 * Attempts to retrieve official BibTeX via content negotiation directly from doi.org.
 */
export async function fetchBibtexDirect(doi: string): Promise<string | null> {
  const cleanDoi = doi.trim().replace(/^https?:\/\/doi\.org\//i, "");
  try {
    const res = await fetch(`https://doi.org/${encodeURIComponent(cleanDoi)}`, {
      headers: {
        Accept: "application/x-bibtex",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith("@")) return text.trim();
    }
  } catch {
    /* fallback to local generation */
  }
  return null;
}

/**
 * Cross-validates an uploaded paper or draft against Crossref official records.
 */
export async function crossValidatePaper(paper: {
  title: string;
  doi?: string | null;
}): Promise<CrossValidationResult> {
  const discrepancies: string[] = [];

  // 1. Direct DOI Lookup
  if (paper.doi) {
    const directMatch = await getCrossrefWorkByDoi(paper.doi);
    if (directMatch) {
      const titleSim = jaccardTitleSimilarity(paper.title, directMatch.title);
      if (titleSim < 0.6) {
        discrepancies.push(`Registered DOI title ("${directMatch.title}") differs from local title.`);
      }
      return {
        verified: titleSim >= 0.6,
        confidence: Number(titleSim.toFixed(2)),
        matchedWork: directMatch,
        doi: directMatch.doi,
        venueMatch: Boolean(directMatch.containerTitle),
        officialTitle: directMatch.title,
        authorMatchCount: directMatch.authors.length,
        discrepancies,
      };
    }
  }

  // 2. Title Search
  const searchResults = await searchCrossrefWorks({ title: paper.title, rows: 3 });
  if (searchResults.items.length === 0) {
    return {
      verified: false,
      confidence: 0,
      matchedWork: null,
      doi: null,
      venueMatch: false,
      officialTitle: null,
      authorMatchCount: 0,
      discrepancies: ["No matching official publication record found in Crossref."],
    };
  }

  const best = searchResults.items[0];
  const sim = jaccardTitleSimilarity(paper.title, best.title);

  if (sim < 0.7) {
    discrepancies.push(`Closest record has only ${(sim * 100).toFixed(0)}% title similarity.`);
  }

  return {
    verified: sim >= 0.7,
    confidence: Number(sim.toFixed(2)),
    matchedWork: best,
    doi: best.doi,
    venueMatch: Boolean(best.containerTitle),
    officialTitle: best.title,
    authorMatchCount: best.authors.length,
    discrepancies,
  };
}

function jaccardTitleSimilarity(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const sA = tok(a);
  const sB = tok(b);
  if (sA.size === 0 || sB.size === 0) return 0;
  let inter = 0;
  for (const t of sA) {
    if (sB.has(t)) inter++;
  }
  const union = new Set([...sA, ...sB]).size;
  return union === 0 ? 0 : inter / union;
}

