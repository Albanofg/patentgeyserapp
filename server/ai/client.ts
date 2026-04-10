import { GoogleGenAI } from "@google/genai";
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
}

// Detect provider from model name
function isGemini(model: string): boolean {
  return model.startsWith("gemini");
}

async function callGemini(opts: AgentCallOptions, model: string): Promise<string> {
  const response = await gemini.models.generateContent({
    model,
    contents: opts.userMessage,
    config: {
      systemInstruction: opts.systemPrompt,
      maxOutputTokens: opts.config.maxTokens,
      temperature: opts.config.temperature,
      topP: opts.config.topP,
      responseMimeType: opts.jsonMode ? "application/json" : "text/plain",
    },
  });
  const text = response.text;
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

async function callGPT(opts: AgentCallOptions, model: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage },
    ],
    max_tokens: opts.config.maxTokens,
    temperature: opts.config.temperature,
    top_p: opts.config.topP,
    ...(opts.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
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

  try {
    return await callModel(opts, model);
  } catch (error: any) {
    console.error(`[AI] ${model} failed:`, error.message);
    if (!fallback) throw error;

    console.log(`[AI] Falling back to ${fallback}`);
    try {
      return await callModel(opts, fallback);
    } catch (fallbackError: any) {
      console.error(`[AI] Fallback ${fallback} also failed:`, fallbackError.message);
      throw fallbackError;
    }
  }
}

export async function callAgentJSON<T = any>(opts: AgentCallOptions): Promise<T> {
  const raw = await callAgent({ ...opts, jsonMode: true });
  try {
    return JSON.parse(raw) as T;
  } catch {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }
    throw new Error(`Failed to parse AI response as JSON: ${raw.substring(0, 200)}`);
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
