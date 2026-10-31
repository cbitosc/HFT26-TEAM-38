"use client";

import { useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Globe,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { OpenAlexWork } from "@/lib/openalex";
import type { CrossrefWork } from "@/lib/crossref";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPaperImported: () => void;
}

export function LiteratureDiscoveryModal({ isOpen, onClose, onPaperImported }: Props) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"openalex" | "crossref">("openalex");
  const [searchQuery, setSearchQuery] = useState("");
  const [authorQuery, setAuthorQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Results
  const [openAlexResults, setOpenAlexResults] = useState<OpenAlexWork[]>([]);
  const [crossrefResults, setCrossrefResults] = useState<CrossrefWork[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [copiedDoi, setCopiedDoi] = useState<string | null>(null);
  const [expandedAbstractId, setExpandedAbstractId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() && !authorQuery.trim()) return;

    setLoading(true);
    try {
      if (activeTab === "openalex") {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (authorQuery.trim()) params.set("author", authorQuery.trim());
        params.set("perPage", "12");

        const res = await fetch(`/api/discovery/openalex?${params.toString()}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setOpenAlexResults(data.results || []);
      } else {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (authorQuery.trim()) params.set("author", authorQuery.trim());
        params.set("rows", "12");

        const res = await fetch(`/api/metadata/crossref?${params.toString()}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCrossrefResults(data.items || []);
      }
    } catch (err) {
      toast({
        title: "Literature search failed",
        description: err instanceof Error ? err.message : "Unable to reach scientific literature APIs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleImportWork = async (work: OpenAlexWork) => {
    setImportingId(work.id);
    try {
      const res = await fetch("/api/discovery/openalex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast({
        title: "✓ Literature Indexed",
        description: data.message || `Indexed "${work.title.slice(0, 50)}..." with citable evidence anchors.`,
      });
      onPaperImported();
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Failed to import work into workspace",
        variant: "destructive",
      });
    } finally {
      setImportingId(null);
    }
  };

  const copyBibtex = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedDoi(id);
    toast({ title: "BibTeX copied to clipboard" });
    setTimeout(() => setCopiedDoi(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-4xl h-[90vh] max-h-[820px] rounded-2xl border border-slate-800 bg-[#030712] shadow-2xl overflow-hidden relative">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">Scientific Literature Discovery</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-mono text-emerald-400 border border-emerald-500/30">
                  OpenAlex & Crossref
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Search global research archives, inspect verified DOIs, reconstruct abstracts, and import with citable anchors.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Provider Tabs Bar */}
        <div className="px-5 py-3 border-b border-slate-800/80 bg-slate-900/40">
          {/* Provider Tabs */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => {
                setActiveTab("openalex");
                if (openAlexResults.length === 0 && searchQuery) void handleSearch();
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "openalex"
                  ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              OpenAlex Literature Discovery
            </button>
            <button
              onClick={() => {
                setActiveTab("crossref");
                if (crossrefResults.length === 0 && searchQuery) void handleSearch();
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "crossref"
                  ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Crossref Verified Metadata & DOIs
            </button>
          </div>

          {/* Search Inputs Form */}
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-center gap-2">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder={
                  activeTab === "openalex"
                    ? "Search title, concepts, abstract, keywords (e.g. transformer pruning)..."
                    : "Search Crossref by title, DOI, or publication topic..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="relative w-full sm:w-56">
              <Users className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Author (optional)..."
                value={authorQuery}
                onChange={(e) => setAuthorQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={loading || (!searchQuery.trim() && !authorQuery.trim())}
              className="w-full sm:w-auto h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-medium cursor-pointer"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Search className="h-3.5 w-3.5 mr-1.5" />}
              Discover Literature
            </Button>
          </form>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar]:w-1.5">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
              <p className="text-sm font-medium text-slate-300">Searching scientific literature archives...</p>
              <p className="text-xs text-slate-500">Querying {activeTab === "openalex" ? "OpenAlex global catalogue" : "Crossref DOI registry"}</p>
            </div>
          ) : activeTab === "openalex" ? (
            openAlexResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 p-6">
                <BookOpen className="h-10 w-10 text-slate-600 mb-2" />
                <h3 className="text-sm font-semibold text-slate-200">Discover Open Access Research</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Enter a topic like &quot;transformer structured pruning&quot;, &quot;knowledge distillation&quot;, or an author name to retrieve peer-reviewed papers.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {["transformer pruning", "knowledge distillation", "two-factor authentication", "neural architecture search"].map((chip) => (
                    <button
                      key={chip}
                      onClick={() => {
                        setSearchQuery(chip);
                      }}
                      className="rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {openAlexResults.map((work) => {
                  const isExpanded = expandedAbstractId === work.id;
                  const isImporting = importingId === work.id;

                  return (
                    <div
                      key={work.id}
                      className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-4 transition-all hover:border-slate-700 shadow-sm"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Title & Venue */}
                          <h3 className="text-sm font-semibold text-slate-100 leading-snug">
                            {work.title}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                            {work.publicationYear && (
                              <span className="font-mono text-emerald-400 font-semibold">{work.publicationYear}</span>
                            )}
                            {work.venue && <span className="text-slate-300">· {work.venue}</span>}
                            {work.citedByCount > 0 && (
                              <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-300 font-mono">
                                📈 {work.citedByCount} citations
                              </span>
                            )}
                            {work.isOa && (
                              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] text-emerald-300 font-medium">
                                Open Access
                              </span>
                            )}
                          </div>

                          {/* Authors */}
                          {work.authors.length > 0 && (
                            <p className="mt-1 text-xs text-slate-400 truncate">
                              👤 {work.authors.slice(0, 5).join(", ")}
                              {work.authors.length > 5 ? ` +${work.authors.length - 5} more` : ""}
                            </p>
                          )}

                          {/* Concepts / Topics */}
                          {work.concepts.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {work.concepts.slice(0, 5).map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-flex items-center gap-1 rounded bg-slate-900 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                                >
                                  <Tag className="h-2.5 w-2.5 text-slate-500" />
                                  {c.name}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Reconstructed Abstract */}
                          {work.abstract && (
                            <div className="mt-2 text-xs leading-relaxed text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/80">
                              <p className={isExpanded ? "" : "line-clamp-2"}>
                                {work.abstract}
                              </p>
                              {work.abstract.length > 180 && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedAbstractId(isExpanded ? null : work.id)}
                                  className="mt-1 text-[11px] text-emerald-400 hover:underline font-medium cursor-pointer"
                                >
                                  {isExpanded ? "Show less" : "Read full abstract →"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions Right */}
                        <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => void handleImportWork(work)}
                            disabled={isImporting}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5 cursor-pointer shadow-sm"
                          >
                            {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Import to Workspace
                          </Button>

                          {work.pdfUrl && (
                            <a
                              href={work.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline font-medium"
                            >
                              <ExternalLink className="h-3 w-3" /> OA PDF
                            </a>
                          )}

                          {work.doi && (
                            <a
                              href={`https://doi.org/${work.doi}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 truncate max-w-[140px]"
                            >
                              doi:{work.doi}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            crossrefResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 p-6">
                <ShieldCheck className="h-10 w-10 text-slate-600 mb-2" />
                <h3 className="text-sm font-semibold text-slate-200">Crossref Metadata Verification</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md">
                  Search the official registry of peer-reviewed literature, cross-validate DOIs, and export verified BibTeX citations.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {crossrefResults.map((work) => (
                  <div
                    key={work.doi}
                    className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-4 transition-all hover:border-slate-700 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-100 leading-snug">
                          {work.title}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          {work.publicationYear && (
                            <span className="font-mono text-emerald-400 font-semibold">{work.publicationYear}</span>
                          )}
                          {work.containerTitle && <span className="text-slate-300">· {work.containerTitle}</span>}
                          {work.publisher && <span className="text-slate-400">({work.publisher})</span>}
                          {work.citationCount > 0 && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-300 font-mono">
                              {work.citationCount} citations
                            </span>
                          )}
                        </div>

                        {work.authors.length > 0 && (
                          <p className="mt-1 text-xs text-slate-400 truncate">
                            👤 {work.authors.slice(0, 5).map((a) => a.name).join(", ")}
                          </p>
                        )}

                        {work.abstract && (
                          <p className="mt-2 text-xs leading-relaxed text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/80 line-clamp-3">
                            {work.abstract}
                          </p>
                        )}
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                        {work.bibtex && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyBibtex(work.bibtex!, work.doi)}
                            className="text-xs border-slate-700 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 gap-1.5 cursor-pointer"
                          >
                            {copiedDoi === work.doi ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedDoi === work.doi ? "Copied" : "Copy BibTeX"}
                          </Button>
                        )}

                        <a
                          href={`https://doi.org/${work.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline font-mono"
                        >
                          <ExternalLink className="h-3 w-3" /> https://doi.org/{work.doi}
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-500">
          <span>Official Discovery & Metadata Integrations · All imported items get permanent evidence anchors</span>
          <Button size="sm" variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-200 cursor-pointer">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

