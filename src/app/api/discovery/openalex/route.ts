/**
 * OpenAlex Discovery API Route
 *
 * GET  /api/discovery/openalex?q=...&author=...&concept=...&page=1
 * POST /api/discovery/openalex (Import work to workspace)
 */

import { NextResponse } from "next/server";
import {
  getOpenAlexWork,
  importOpenAlexWorkToWorkspace,
  searchOpenAlexWorks,
  type OpenAlexWork,
} from "@/lib/openalex";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || searchParams.get("query") || undefined;
    const author = searchParams.get("author") || undefined;
    const concept = searchParams.get("concept") || undefined;
    const id = searchParams.get("id") || searchParams.get("doi") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const perPage = parseInt(searchParams.get("perPage") || searchParams.get("limit") || "10", 10);

    // If ID or DOI provided, retrieve single work
    if (id) {
      const work = await getOpenAlexWork(id);
      if (!work) {
        return NextResponse.json({ error: "Work not found in OpenAlex" }, { status: 404 });
      }
      return NextResponse.json({ work });
    }

    if (!query && !author && !concept) {
      return NextResponse.json(
        { error: "Provide a search parameter ('q', 'author', 'concept', or 'id')" },
        { status: 400 }
      );
    }

    const data = await searchOpenAlexWorks({ query, author, concept, page, perPage });
    return NextResponse.json(data);
  } catch (error) {
    console.error("OpenAlex GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to query OpenAlex" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { workId?: string; work?: OpenAlexWork };

    let workToImport: OpenAlexWork | null = null;
    if (body.work && body.work.title) {
      workToImport = body.work;
    } else if (body.workId) {
      workToImport = await getOpenAlexWork(body.workId);
    }

    if (!workToImport) {
      return NextResponse.json({ error: "Valid OpenAlex work or workId is required" }, { status: 400 });
    }

    const result = await importOpenAlexWorkToWorkspace(workToImport);
    return NextResponse.json(result);
  } catch (error) {
    console.error("OpenAlex POST import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import work into workspace" },
      { status: 500 }
    );
  }
}

