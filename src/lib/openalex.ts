/**
 * OpenAlex API Client & Discovery Service
 *
 * Implements typed discovery and retrieval of scientific literature,
 * inverted-index abstract reconstruction, citation counts, concept/topic clusters,
 * and direct workspace ingestion.
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { chunkPaper } from "@/lib/chunker";
import { embedTexts } from "@/lib/retriever";

export interface OpenAlexConcept {
  id: string;
  name: string;
  score: number;
  level: number;
}

export interface OpenAlexWork {
  id: string;
  openAlexId: string;
  doi: string | null;
  title: string;
  authors: string[];
  publicationYear: number | null;
  publicationDate: string | null;
  venue: string | null;
  citedByCount: number;
  isOa: boolean;
  oaUrl: string | null;
  pdfUrl: string | null;
  abstract: string;
  concepts: OpenAlexConcept[];
  landingPageUrl: string | null;
}

export interface OpenAlexSearchResponse {
  total: number;
  page: number;
  perPage: number;
  results: OpenAlexWork[];
}

const OPENALEX_BASE_URL = "https://api.openalex.org";
const USER_AGENT = "Veritas-Research-Assistant/1.0 (mailto:veritas-research@cbit.edu)";

/**
 * Reconstructs continuous text from OpenAlex's abstract_inverted_index.
 */
export function reconstructAbstract(invertedIndex?: Record<string, number[]> | null): string {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  const pairs: [number, string][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        pairs.push([pos, word]);
      }
    }
  }
  if (pairs.length === 0) return "";
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map((p) => p[1]).join(" ").replace(/\s+([.,;:?!])/g, "$1").trim();
}

/**
 * Normalizes raw OpenAlex work object into clean Veritas schema.
 */
export function normalizeOpenAlexWork(raw: Record<string, unknown>): OpenAlexWork {
  const id = String(raw.id || "");
  const openAlexId = id.replace(/^https:\/\/openalex\.org\//i, "");
  const doiRaw = (raw.doi as string | null) || null;
  const doi = doiRaw ? doiRaw.replace(/^https?:\/\/doi\.org\//i, "") : null;
  const title = String(raw.title || raw.display_name || "Untitled Research Document");

  const authorships = (raw.authorships as Array<{ author?: { display_name?: string } }>) || [];
  const authors = authorships
    .map((a) => a?.author?.display_name || "")
    .filter((n): n is string => Boolean(n));

  const publicationYear = typeof raw.publication_year === "number" ? raw.publication_year : null;
  const publicationDate = typeof raw.publication_date === "string" ? raw.publication_date : null;

  const primaryLoc = (raw.primary_location as Record<string, unknown>) || {};
  const source = (primaryLoc.source as Record<string, unknown>) || {};
  const venue = (source.display_name as string) || (raw.host_venue as Record<string, unknown>)?.display_name as string || null;

  const openAccess = (raw.open_access as Record<string, unknown>) || {};
  const isOa = Boolean(openAccess.is_oa || primaryLoc.is_oa);
  const oaUrl = (openAccess.oa_url as string) || (primaryLoc.landing_page_url as string) || null;
  const pdfUrl = (primaryLoc.pdf_url as string) || (raw.best_oa_location as Record<string, unknown>)?.pdf_url as string || null;
  const landingPageUrl = (primaryLoc.landing_page_url as string) || null;

  const rawAbstractIndex = raw.abstract_inverted_index as Record<string, number[]> | undefined;
  const abstract = reconstructAbstract(rawAbstractIndex);

  const rawConcepts = (raw.concepts as Array<{ id?: string; display_name?: string; score?: number; level?: number }>) || [];
  const concepts: OpenAlexConcept[] = rawConcepts.slice(0, 8).map((c) => ({
    id: String(c.id || ""),
    name: String(c.display_name || ""),
    score: typeof c.score === "number" ? c.score : 0,
    level: typeof c.level === "number" ? c.level : 0,
  }));

  return {
    id,
    openAlexId,
    doi,
    title,
    authors,
    publicationYear,
    publicationDate,
    venue,
    citedByCount: typeof raw.cited_by_count === "number" ? raw.cited_by_count : 0,
    isOa,
    oaUrl,
    pdfUrl,
    abstract,
    concepts,
    landingPageUrl,
  };
}

/**
 * Searches scientific literature via OpenAlex API.
 */
export async function searchOpenAlexWorks(params: {
  query?: string;
  author?: string;
  concept?: string;
  page?: number;
  perPage?: number;
}): Promise<OpenAlexSearchResponse> {
  const page = Math.max(1, params.page || 1);
  const perPage = Math.min(50, Math.max(1, params.perPage || 10));

  const url = new URL(`${OPENALEX_BASE_URL}/works`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per-page", String(perPage));

  if (params.query?.trim()) {
    url.searchParams.set("search", params.query.trim());
  }

  const filters: string[] = [];
  if (params.author?.trim()) {
    filters.push(`raw_author_name.search:${params.author.trim()}`);
  }
  if (params.concept?.trim()) {
    filters.push(`concepts.id:${params.concept.trim().replace(/^https:\/\/openalex\.org\//i, "")}`);
  }
  if (filters.length > 0) {
    url.searchParams.set("filter", filters.join(","));
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
    throw new Error(`OpenAlex API error (${res.status}): ${errorBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    meta?: { count?: number };
    results?: Record<string, unknown>[];
  };

  const total = data.meta?.count || 0;
  const results = (data.results || []).map(normalizeOpenAlexWork);

  return { total, page, perPage, results };
}

/**
 * Retrieves a single work by OpenAlex ID or DOI.
 */
export async function getOpenAlexWork(idOrDoi: string): Promise<OpenAlexWork | null> {
  let cleanId = idOrDoi.trim();
  if (cleanId.startsWith("10.") || cleanId.includes("doi.org")) {
    cleanId = cleanId.replace(/^https?:\/\/doi\.org\//i, "");
    cleanId = `doi:${cleanId}`;
  } else {
    cleanId = cleanId.replace(/^https:\/\/openalex\.org\//i, "");
  }

  const url = `${OPENALEX_BASE_URL}/works/${encodeURIComponent(cleanId)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) return null;
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeOpenAlexWork(raw);
}

/**
 * Ingests an OpenAlex discovery work directly into the Veritas database.
 * Generates stable passage anchors ({hash8}::p{page}::c{idx}) and embeddings.
 */
export async function importOpenAlexWorkToWorkspace(work: OpenAlexWork) {
  // Construct comprehensive document text from metadata and reconstructed abstract
  const authorsText = work.authors.length > 0 ? `Authors: ${work.authors.join(", ")}` : "";
  const venueText = work.venue ? `Published in: ${work.venue} (${work.publicationYear || "n.d."})` : "";
  const doiText = work.doi ? `DOI: https://doi.org/${work.doi}` : "";
  const conceptsText = work.concepts.length > 0 ? `Topics: ${work.concepts.map((c) => c.name).join(", ")}` : "";

  const fullText = [
    `Title: ${work.title}`,
    authorsText,
    venueText,
    doiText,
    conceptsText,
    "",
    "Abstract",
    work.abstract || "No abstract available for this work.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const hash = createHash("sha1").update(Buffer.from(fullText)).digest("hex");

  // Check if already in workspace
  const existing = await db.paper.findUnique({ where: { hash } });
  if (existing) {
    return { paper: existing, created: false, message: "Document already indexed in workspace." };
  }

  // Chunk into verifiable citable passages
  const pages = [
    { page: 1, text: fullText },
  ];
  const chunks = chunkPaper(hash, pages);

  // Generate vector embeddings locally (BGE-small on CPU)
  const embeddings = await embedTexts(chunks.map((c) => c.text));

  const paper = await db.paper.create({
    data: {
      title: work.title.slice(0, 200),
      fileName: `${work.openAlexId || "openalex"}.txt`,
      hash,
      pages: 1,
      status: "READY",
      summary: work.abstract ? work.abstract.slice(0, 1000) : null,
      passages: {
        create: chunks.map((c, i) => ({
          ref: c.ref,
          page: c.page,
          ordinal: c.ordinal,
          section: c.section,
          text: c.text,
          embedding: embeddings && embeddings[i] ? JSON.stringify(embeddings[i]) : null,
        })),
      },
    },
    include: {
      _count: { select: { passages: true } },
    },
  });

  return { paper, created: true, message: `Successfully indexed "${work.title}" with ${chunks.length} citable passages.` };
}

