import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
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

async function callGemini(opts: AgentCallOptions, model: string): Promise<string> {
  const systemInstruction = (opts.systemPrompt || "") + EMPTY_RESPONSE_GUARD;
  const maxOutputTokens = Math.max(opts.config.maxTokens || 0, 2048);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  const response = await withTimeout(
    gemini.models.generateContent({
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
  return text;
}

// gpt-4o caps completion tokens at 16384; clamp to avoid 400s on Gemini fallback
const GPT_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "gpt-4o": 16384,
};

async function callGPT(opts: AgentCallOptions, model: string): Promise<string> {
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
  return text;
}

async function callModel(opts: AgentCallOptions, model: string): Promise<string> {
  if (isGemini(model)) {
    return await callGemini(opts, model);
  } else {
    return await callGPT(opts, model);
  }
}

export async function callAgent(opts: AgentCallOptions): Promise<string> {
  const { model, fallback } = opts.config;

  const started = Date.now();
  console.log(`[AI] -> ${model} (maxTokens=${opts.config.maxTokens}, temp=${opts.config.temperature})`);

  try {
    const result = await callModel(opts, model);
    console.log(`[AI] <- ${model} ok (${Date.now() - started}ms, ${result.length} chars)`);
    return result;
  } catch (error: any) {
    console.error(`[AI] ${model} failed after ${Date.now() - started}ms:`, error.message);

    // Retry Gemini once before falling back — most failures are tail-latency
    // timeouts or transient throttling that resolve on a second attempt.
    if (isGemini(model)) {
      const retryStarted = Date.now();
      console.log(`[AI] -> retry ${model}`);
      try {
        const result = await callModel(opts, model);
        console.log(`[AI] <- ${model} ok on retry (${Date.now() - retryStarted}ms, ${result.length} chars)`);
        return result;
      } catch (retryError: any) {
        console.error(`[AI] ${model} retry also failed after ${Date.now() - retryStarted}ms:`, retryError.message);
      }
    }

    if (!fallback) throw error;

    console.log(`[AI] -> fallback ${fallback}`);
    const fbStarted = Date.now();
    try {
      const result = await callModel(opts, fallback);
      console.log(`[AI] <- ${fallback} ok (${Date.now() - fbStarted}ms, ${result.length} chars)`);
      return result;
    } catch (fallbackError: any) {
      console.error(`[AI] Fallback ${fallback} also failed after ${Date.now() - fbStarted}ms:`, fallbackError.message);
      throw fallbackError;
    }
  }
}

// Strip markdown fences and trim to the first `{` through the last `}`.
// Defense-in-depth for the rare case Gemini emits prose despite jsonMode.
function extractJsonPayload(raw: string): string {
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` wrappers.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) s = fenced[1].trim();
  // Trim any leading/trailing prose by slicing to the outermost braces.
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

export async function callAgentJSON<T = any>(opts: AgentCallOptions): Promise<T> {
  const raw = await callAgent({ ...opts, jsonMode: true });
  try {
    return JSON.parse(raw) as T;
  } catch (firstErr: any) {
    try {
      return JSON.parse(extractJsonPayload(raw)) as T;
    } catch (secondErr: any) {
      // Log the FULL raw payload as a single line so Vercel doesn't truncate at
      // the first newline. This is what the next person debugging will need.
      const oneLine = raw.replace(/\r?\n/g, "\\n");
      console.error(
        `[AI] JSON parse failed (len=${raw.length}, model=${opts.config.model}): ` +
          `${secondErr?.message || firstErr?.message}. RAW: ${oneLine}`,
      );
      throw new Error(
        `AI returned malformed JSON (${secondErr?.message || firstErr?.message}). ` +
          `Length=${raw.length}. Head: ${raw.substring(0, 120)} | Tail: ${raw.slice(-120)}`,
      );
    }
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
