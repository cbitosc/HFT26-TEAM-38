/**
 * Crossref Metadata & Verification API Route
 *
 * GET  /api/metadata/crossref?q=...&doi=...&format=json|bibtex
 * POST /api/metadata/crossref (Cross-validate paper metadata against official records)
 */

import { NextResponse } from "next/server";
import {
  crossValidatePaper,
  fetchBibtexDirect,
  getCrossrefWorkByDoi,
  searchCrossrefWorks,
} from "@/lib/crossref";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || searchParams.get("query") || undefined;
    const title = searchParams.get("title") || undefined;
    const author = searchParams.get("author") || undefined;
    const doi = searchParams.get("doi") || undefined;
    const format = searchParams.get("format") || "json";
    const rows = parseInt(searchParams.get("rows") || "10", 10);

    // 1. Direct DOI resolution
    if (doi) {
      if (format === "bibtex") {
        const bibtex = await fetchBibtexDirect(doi);
        if (bibtex) {
          return new Response(bibtex, {
            headers: { "Content-Type": "application/x-bibtex; charset=utf-8" },
          });
        }
      }
      const work = await getCrossrefWorkByDoi(doi);
      if (!work) {
        return NextResponse.json({ error: "DOI not found in Crossref registry" }, { status: 404 });
      }
      return NextResponse.json({ work });
    }

    // 2. Query search
    if (!query && !title && !author) {
      return NextResponse.json(
        { error: "Provide a search parameter ('q', 'title', 'author', or 'doi')" },
        { status: 400 }
      );
    }

    const data = await searchCrossrefWorks({ query, title, author, rows });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Crossref GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to query Crossref" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { title?: string; doi?: string };
    if (!body.title?.trim() && !body.doi?.trim()) {
      return NextResponse.json({ error: "Paper 'title' or 'doi' is required for validation" }, { status: 400 });
    }

    const result = await crossValidatePaper({
      title: (body.title || "").trim(),
      doi: (body.doi || "").trim() || null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Crossref POST validation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cross-validate paper metadata" },
      { status: 500 }
    );
  }
}

