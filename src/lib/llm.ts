/**
 * LLM provider layer — Local & Cloud (Ollama & Featherless AI).
 *
 * Supports Featherless AI (cloud OpenAI-compatible inference) and local Ollama.
 * If neither is configured/reachable, the effective provider falls back to a
 * deterministic local "mock" engine so the full pipeline (retrieval, gates,
 * UI) can still be exercised.
 */

export type LlmProvider = "featherless" | "ollama" | "mock";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  requested: "auto" | "featherless" | "ollama" | "mock";
  featherlessApiKey: string;
  featherlessBaseUrl: string;
  featherlessModel: string;
}

export function getLlmConfig(): LlmConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "qwen3:14b",
    requested: (process.env.LLM_PROVIDER as "auto" | "featherless" | "ollama" | "mock") || "auto",
    featherlessApiKey: (process.env.FEATHERLESS_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
    featherlessBaseUrl: (process.env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1").trim(),
    featherlessModel: (process.env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-14B-Instruct").trim(),
  };
}

let cachedPing: { at: number; reachable: boolean; models: string[] } | null = null;

export async function pingOllama(force = false): Promise<{ reachable: boolean; models: string[] }> {
  if (!force && cachedPing && Date.now() - cachedPing.at < 8000) {
    return { reachable: cachedPing.reachable, models: cachedPing.models };
  }
  const { baseUrl } = getLlmConfig();
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      headers: {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Veritas-Client/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { models?: { name?: string }[] };
    const models = (data.models || []).map((m) => m.name || "").filter(Boolean);
    cachedPing = { at: Date.now(), reachable: true, models };
    return { reachable: true, models };
  } catch {
    cachedPing = { at: Date.now(), reachable: false, models: [] };
    return { reachable: false, models: [] };
  }
}

export async function pingFeatherless(): Promise<{ reachable: boolean; models: string[] }> {
  const cfg = getLlmConfig();
  if (!cfg.featherlessApiKey) {
    return { reachable: false, models: [] };
  }
  return { reachable: true, models: [cfg.featherlessModel] };
}

export async function getEffectiveProvider(): Promise<LlmProvider> {
  const cfg = getLlmConfig();
  if (cfg.requested === "mock") return "mock";
  if (cfg.requested === "featherless") {
    return cfg.featherlessApiKey ? "featherless" : "mock";
  }
  if (cfg.requested === "ollama") return "ollama";

  // Auto mode: prioritize Featherless if API key configured
  if (cfg.featherlessApiKey) {
    return "featherless";
  }

  // Otherwise check local Ollama
  const { reachable, models } = await pingOllama();
  if (!reachable) return "mock";
  const base = cfg.model.split(":")[0].toLowerCase();
  const found = models.some((m) => m.toLowerCase() === cfg.model.toLowerCase() || m.toLowerCase().startsWith(base));
  return found ? "ollama" : "mock";
}

/** Strip Qwen3 <think>…</think> blocks and code fences, then pull out the JSON object. */
export function extractJson(raw: string): unknown {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) {
    return { answer: text, citations: [] };
  }
  // walk to the matching closing brace
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return { answer: text, citations: [] };
        }
      }
    }
  }
  return { answer: text, citations: [] };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}

export interface ChatResult<T> {
  data: T;
  provider: LlmProvider;
  model: string;
  raw?: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Executes a strict-JSON chat request against either Featherless AI or Ollama.
 */
export async function chatJson<T>(
  system: string,
  user: string,
  opts: ChatOptions = {},
  history: ChatHistoryMessage[] = []
): Promise<ChatResult<T> | null> {
  const provider = await getEffectiveProvider();
  const cfg = getLlmConfig();

  const historyMessages = (history || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, 1500),
    }));

  // 1. FEATHERLESS AI (Cloud OpenAI-compatible inference)
  if (provider === "featherless") {
    const endpoint = `${cfg.featherlessBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const messages = [
      { role: "system", content: `${system}\n\nAnswer with a single valid JSON object and nothing else.` },
      ...historyMessages,
      { role: "user", content: user },
    ];

    const body: Record<string, unknown> = {
      model: cfg.featherlessModel,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1000,
      response_format: { type: "json_object" },
    };

    let res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.featherlessApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    // Fallback if specific model rejects response_format
    if (!res.ok && res.status === 400) {
      delete body.response_format;
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.featherlessApiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`featherless ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(raw) as T;
    return { data: parsed, provider: "featherless", model: cfg.featherlessModel, raw };
  }

  // 2. OLLAMA (Local Inference)
  if (provider === "ollama") {
    const messages = [
      { role: "system", content: `${system}\n\nAnswer with a single valid JSON object and nothing else. /no_think` },
      ...historyMessages,
      { role: "user", content: user },
    ];

    const body = {
      model: cfg.model,
      messages,
      stream: false,
      format: "json",
      think: false,
      options: {
        temperature: opts.temperature ?? 0.3,
        num_ctx: opts.contextWindow ?? 8192,
        num_predict: opts.maxTokens ?? 350,
      },
    };
    const res = await fetch(`${cfg.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Veritas-Client/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data.message?.content || "";
    const parsed = extractJson(raw) as T;
    return { data: parsed, provider: "ollama", model: cfg.model, raw };
  }

  // 3. MOCK / FALLBACK
  return null;
}
