import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import {
  recordUsage,
  extractGeminiUsage,
  extractOpenAIUsage,
  type UsageStatus,
} from "./usage-log";
import { getUsageContext } from "./request-context";

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
// Optional secondary Gemini client backed by a key from a different GCP project
// so we get a separate quota bucket to fail over to when the primary throws.
const geminiSecondary = process.env.GEMINI_API_SECOND_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_SECOND_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export interface AgentConfig {
  model: string;
  fallback: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface AgentCallOptions {
  systemPrompt: string;
  userMessage: string;
  config: AgentConfig;
  jsonMode?: boolean;
  // Optional JSON Schema constraining the model output. When provided alongside
  // jsonMode, Gemini enforces structure at the API level (no markdown fences,
  // no trailing prose, properly escaped strings).
  responseSchema?: Record<string, any>;
  // Per-call timeout. Protects against the SDK hanging on a stalled stream and
  // burning the whole 300s function budget. Default 120s.
  timeoutMs?: number;
  // Usage-log context. Optional today (older call sites can omit it) but every
  // new wiring should pass it so the admin /admin/usage page can attribute the
  // call to a user, project, and agent stage. `agentCode` is a stable code
  // looked up against AGENT_LABELS in server/ai/usage-log.ts.
  usage?: {
    agentCode: string;
    userId?: string | null;
    userEmail?: string | null;
    projectId?: string | null;
    requestId?: string | null;
  };
}

const DEFAULT_CALL_TIMEOUT_MS = 150_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Detect provider from model name
function isGemini(model: string): boolean {
  return model.startsWith("gemini");
}

const GEMINI_SAFETY_OFF = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const EMPTY_RESPONSE_GUARD =
  "\n\nCRITICAL: You must never return an empty response. If you cannot process an item due to safety or content restrictions, you must output the exact string 'ITEM_FILTERED' instead of returning nothing.";

// Telltale phrases observed in degraded Gemini Pro responses where the model
// returned 200 OK but emitted meta-commentary placeholders instead of doing
// the actual work. When these appear, we treat the response as a failure and
// retry (with the secondary key if configured). Add new phrases here as we
// observe more degradation modes — keep them specific enough that they don't
// false-positive on legitimate output.
//
// Note: the older "Strategy synthesis disabled per instructions" / "N/A -
// Fact extraction only" phrases were removed because the rewritten 4a
// whitespace prompt no longer asks for strategic synthesis at all. Those
// phrases would now fire on by-design empty fields, not on actual model
// degradation.
const DEGRADED_OUTPUT_MARKERS: string[] = [];

/**
 * Scan a model response for known "the model gave up" placeholder phrases.
 * Returns the first matching phrase if found (so we can log it), otherwise null.
 */
function detectDegradedOutput(text: string): string | null {
  for (const marker of DEGRADED_OUTPUT_MARKERS) {
    if (text.includes(marker)) return marker;
  }
  return null;
}

interface ModelCallResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
}

async function callGemini(
  opts: AgentCallOptions,
  model: string,
  client: GoogleGenAI = gemini,
): Promise<ModelCallResult> {
  const systemInstruction = (opts.systemPrompt || "") + EMPTY_RESPONSE_GUARD;
  const maxOutputTokens = Math.max(opts.config.maxTokens || 0, 2048);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  const response = await withTimeout(
    client.models.generateContent({
      model,
      contents: opts.userMessage,
      config: {
        systemInstruction,
        maxOutputTokens,
        temperature: opts.config.temperature,
        topP: opts.config.topP,
        responseMimeType: opts.jsonMode ? "application/json" : "text/plain",
        // When a schema is provided in jsonMode, Gemini constrains output to it
        // (eliminates markdown fences, trailing prose, and unescaped strings).
        ...(opts.jsonMode && opts.responseSchema
          ? { responseSchema: opts.responseSchema as any }
          : {}),
        safetySettings: GEMINI_SAFETY_OFF,
      },
    }),
    timeoutMs,
    `Gemini ${model}`,
  );
  const text = response.text;
  if (!text) {
    const finishReason = response.candidates?.[0]?.finishReason;
    const blockReason = (response as any).promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned empty response (finishReason=${finishReason ?? "n/a"}, blockReason=${blockReason ?? "n/a"})`
    );
  }
  return { text, ...extractGeminiUsage(response) };
}

// gpt-4o caps completion tokens at 16384; clamp to avoid 400s on Gemini fallback
const GPT_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "gpt-4o": 16384,
};

async function callGPT(opts: AgentCallOptions, model: string): Promise<ModelCallResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const cap = GPT_MAX_OUTPUT_TOKENS[model];
  const maxTokens = cap ? Math.min(opts.config.maxTokens, cap) : opts.config.maxTokens;
  const response = await withTimeout(
    openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userMessage },
      ],
      max_tokens: maxTokens,
      temperature: opts.config.temperature,
      top_p: opts.config.topP,
      ...(opts.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    }),
    timeoutMs,
    `GPT ${model}`,
  );
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("GPT returned empty response");
  return { text, ...extractOpenAIUsage(response) };
}

async function callModel(opts: AgentCallOptions, model: string): Promise<ModelCallResult> {
  if (isGemini(model)) {
    return await callGemini(opts, model);
  } else {
    return await callGPT(opts, model);
  }
}

// Light wrapper that fires a usage-log row without ever throwing. Each branch
// of callAgent calls this once it knows how the attempt ended.
// When opts.usage isn't set the row is still written — just without user /
// project / agent attribution. That gives us cost-per-model coverage from
// day one even before every route is wired through.
function logUsage(
  opts: AgentCallOptions,
  args: {
    model: string;
    status: UsageStatus;
    result?: ModelCallResult;
    durationMs: number;
    fallbackFrom?: string;
    usedSecondaryKey?: boolean;
    errorMessage?: string;
  },
): void {
  // Pull user/project/requestId from the AsyncLocalStorage request context
  // when the call site hasn't passed them explicitly. Lets module agents
  // record attribution without threading user identity through every
  // function signature — only the `agentCode` needs to come from the caller.
  const ctx = getUsageContext();
  void recordUsage({
    userId: opts.usage?.userId ?? ctx?.userId ?? null,
    userEmail: opts.usage?.userEmail ?? ctx?.userEmail ?? null,
    projectId: opts.usage?.projectId ?? ctx?.projectId ?? null,
    agentCode: opts.usage?.agentCode ?? "unknown",
    requestId: opts.usage?.requestId ?? ctx?.requestId ?? null,
    model: args.model,
    inputTokens: args.result?.inputTokens ?? null,
    outputTokens: args.result?.outputTokens ?? null,
    cachedTokens: args.result?.cachedTokens ?? null,
    totalTokens: args.result?.totalTokens ?? null,
    durationMs: args.durationMs,
    status: args.status,
    fallbackFrom: args.fallbackFrom ?? null,
    usedSecondaryKey: args.usedSecondaryKey ?? false,
    errorMessage: args.errorMessage ?? null,
  });
}

export async function callAgent(opts: AgentCallOptions): Promise<string> {
  const { model, fallback } = opts.config;

  const started = Date.now();
  console.log(`[AI] -> ${model} (maxTokens=${opts.config.maxTokens}, temp=${opts.config.temperature})`);

  try {
    const result = await callModel(opts, model);
    // Sanity-check the output before returning. Gemini Pro occasionally
    // returns 200 OK with placeholder meta-text instead of real analysis
    // (observed on Whitespace 4a). Throwing here re-enters the retry path
    // below, which will use the secondary key when available.
    const degraded = detectDegradedOutput(result.text);
    if (degraded) {
      throw new Error(`degraded output detected: "${degraded}"`);
    }
    const duration = Date.now() - started;
    console.log(`[AI] <- ${model} ok (${duration}ms, ${result.text.length} chars)`);
    logUsage(opts, { model, status: "ok", result, durationMs: duration });
    return result.text;
  } catch (error: any) {
    const firstDuration = Date.now() - started;
    console.error(`[AI] ${model} failed after ${firstDuration}ms:`, error.message);

    // Retry Gemini once before falling back — most failures are tail-latency
    // timeouts, transient throttling, or degraded-output snapshots. If a
    // secondary API key is configured, the retry uses it so we get a fresh
    // quota bucket and (often) a different model snapshot.
    if (isGemini(model)) {
      const retryStarted = Date.now();
      const useSecondary = geminiSecondary !== null;
      console.log(`[AI] -> retry ${model}${useSecondary ? " (secondary key)" : ""}`);
      try {
        const result = useSecondary
          ? await callGemini(opts, model, geminiSecondary!)
          : await callModel(opts, model);
        const degradedRetry = detectDegradedOutput(result.text);
        if (degradedRetry) {
          throw new Error(`degraded output on retry: "${degradedRetry}"`);
        }
        const duration = Date.now() - retryStarted;
        console.log(`[AI] <- ${model} ok on retry (${duration}ms, ${result.text.length} chars)`);
        logUsage(opts, {
          model,
          status: "retry",
          result,
          durationMs: duration,
          usedSecondaryKey: useSecondary,
        });
        return result.text;
      } catch (retryError: any) {
        const retryDuration = Date.now() - retryStarted;
        console.error(`[AI] ${model} retry also failed after ${retryDuration}ms:`, retryError.message);
        logUsage(opts, {
          model,
          status: "error",
          durationMs: retryDuration,
          usedSecondaryKey: useSecondary,
          errorMessage: retryError?.message ?? String(retryError),
        });
      }
    } else {
      // Non-Gemini primary that failed without a retry attempt — still log it.
      logUsage(opts, {
        model,
        status: "error",
        durationMs: firstDuration,
        errorMessage: error?.message ?? String(error),
      });
    }

    if (!fallback) throw error;

    console.log(`[AI] -> fallback ${fallback}`);
    const fbStarted = Date.now();
    try {
      const result = await callModel(opts, fallback);
      const fbDuration = Date.now() - fbStarted;
      console.log(`[AI] <- ${fallback} ok (${fbDuration}ms, ${result.text.length} chars)`);
      logUsage(opts, {
        model: fallback,
        status: "fallback",
        result,
        durationMs: fbDuration,
        fallbackFrom: model,
      });
      return result.text;
    } catch (fallbackError: any) {
      const fbDuration = Date.now() - fbStarted;
      console.error(`[AI] Fallback ${fallback} also failed after ${fbDuration}ms:`, fallbackError.message);
      logUsage(opts, {
        model: fallback,
        status: "error",
        durationMs: fbDuration,
        fallbackFrom: model,
        errorMessage: fallbackError?.message ?? String(fallbackError),
      });
      throw fallbackError;
    }
  }
}

// Strip markdown fences and extract a complete JSON object from the response.
// Walks the string from the first `{` tracking brace depth (and respecting
// string literals + escapes) to find the matching close brace, ignoring any
// trailing garbage. Gemini Flash in particular often appends `}\n}` or other
// junk after a valid JSON object — the old "first { to last }" slice would
// include that garbage and trigger a parse error.
function extractJsonPayload(raw: string): string {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` wrappers.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) s = fenced[1].trim();

  const first = s.indexOf("{");
  if (first === -1) return s;

  // Walk forward tracking brace depth. Skip over string contents (and their
  // escape sequences) so braces inside a string literal don't confuse the count.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(first, i + 1);
      }
    }
  }
  // Unbalanced — fall back to first..last so the caller still gets a chance.
  const last = s.lastIndexOf("}");
  return last > first ? s.slice(first, last + 1) : s;
}

export async function callAgentJSON<T = any>(opts: AgentCallOptions): Promise<T> {
  const attempt = async (label: string): Promise<T> => {
    const raw = await callAgent({ ...opts, jsonMode: true });
    try {
      return JSON.parse(raw) as T;
    } catch (firstErr: any) {
      try {
        return JSON.parse(extractJsonPayload(raw)) as T;
      } catch (secondErr: any) {
        const oneLine = raw.replace(/\r?\n/g, "\\n");
        console.error(
          `[AI] JSON parse failed (${label}, len=${raw.length}, model=${opts.config.model}): ` +
            `${secondErr?.message || firstErr?.message}. RAW: ${oneLine}`,
        );
        const err: any = new Error(
          `AI returned malformed JSON (${secondErr?.message || firstErr?.message}). ` +
            `Length=${raw.length}. Head: ${raw.substring(0, 120)} | Tail: ${raw.slice(-120)}`,
        );
        err.isJsonParseFailure = true;
        throw err;
      }
    }
  };

  try {
    return await attempt("first");
  } catch (e: any) {
    // Retry once on JSON parse failure — this is exactly the failure mode that
    // killed 5 of 8 broadenings on the demo run (Flash returning valid JSON +
    // trailing garbage that randomly varied call-to-call). A second call almost
    // always returns clean JSON, and the call is cheap relative to the cost of
    // a half-populated workflow.
    if (e?.isJsonParseFailure) {
      console.warn(`[AI] retrying JSON call after parse failure (model=${opts.config.model})`);
      return await attempt("retry");
    }
    throw e;
  }
}

// Load agent config and prompt from a module folder
const configCache = new Map<string, AgentConfig>();
const promptCache = new Map<string, string>();

export function loadAgentConfig(modulePath: string): AgentConfig {
  let config = configCache.get(modulePath);
  if (!config || process.env.NODE_ENV !== "production") {
    const fullPath = path.resolve(process.cwd(), "server", "modules", modulePath);
    config = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    configCache.set(modulePath, config!);
  }
  return config!;
}

export function loadPrompt(modulePath: string, vars: Record<string, string> = {}): string {
  let template = promptCache.get(modulePath);
  if (!template || process.env.NODE_ENV !== "production") {
    const fullPath = path.resolve(process.cwd(), "server", "modules", modulePath);
    template = fs.readFileSync(fullPath, "utf-8");
    promptCache.set(modulePath, template);
  }

  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
