# How to Migrate an n8n Agent to Direct AI

## 3 Files Per Agent

Every agent lives in `server/modules/moduleX/` and has exactly 3 files:

1. **`agent-name.md`** — The prompt. Edit anytime. No code changes needed.
2. **`agent-name.config.json`** — Model, temperature, topP, maxTokens. Edit anytime. Each agent can use a completely different model.
3. **`agent-name.ts`** — The logic. Builds the user message, calls `callAgent()`, returns result.

## Available Models (as of April 2026)

### Gemini (primary — use `GEMINI_API_KEY`)
| Model | Best For |
|-------|----------|
| `gemini-2.5-pro` | Complex reasoning, long patent drafts, claims |
| `gemini-2.5-flash` | Fast general purpose, good balance |
| `gemini-2.5-flash-lite` | Cheapest/fastest, simple tasks |
| `gemini-3.1-pro-preview` | Latest flagship, best quality |
| `gemini-3-flash-preview` | Latest fast model |

### OpenAI (fallback — use `OPENAI_API_KEY`)
| Model | Best For |
|-------|----------|
| `gpt-4o` | Best quality, complex tasks |
| `gpt-4o-mini` | Fast/cheap fallback |
| `gpt-4.1` | Latest flagship |
| `gpt-4.1-mini` | Latest fast model |
| `gpt-4.1-nano` | Cheapest, simple tasks |

Any model from either provider works in the config. The system auto-detects provider by name prefix (`gemini-*` → Gemini API, everything else → OpenAI API).

## Steps

### 1. Get the n8n workflow JSON
- Export from n8n
- Find the system prompt (usually in the agent node's `systemMessage`)
- Find the model + settings (temperature, maxTokens)
- Find how input is built (usually a Code node before the agent)

### 2. Create the 3 files

**`server/modules/moduleX/agent-name.config.json`**
```json
{
  "model": "gemini-2.5-flash",
  "fallback": "gpt-4o-mini",
  "temperature": 0.3,
  "topP": 0.9,
  "maxTokens": 16000
}
```
Every field is independent per agent. One agent can use `gemini-2.5-pro` at temp 0.1, another can use `gpt-4o` at temp 0.9. Just edit the JSON.

**`server/modules/moduleX/agent-name.md`**
- Paste the system prompt from n8n
- Add `{{variable}}` placeholders for dynamic data that gets filled at runtime

**`server/modules/moduleX/agent-name.ts`**
```ts
import { callAgent, loadAgentConfig, loadPrompt } from "../../ai/client";
// or for JSON responses:
// import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../ai/client";

export async function runAgentName(payload: YourPayloadType): Promise<string> {
  const config = loadAgentConfig("moduleX/agent-name.config.json");
  const systemPrompt = loadPrompt("moduleX/agent-name.md", {
    // fill in {{variables}} from the prompt
    variable1: payload.whatever,
  });

  const userMessage = "build this from what n8n sends to the agent";

  return await callAgent({ systemPrompt, userMessage, config, jsonMode: false });
  // or for JSON: return await callAgentJSON({ systemPrompt, userMessage, config });
}
```

### 3. Wire it into routes.ts

**Top of file — add import:**
```ts
import { runAgentName } from "./modules/moduleX/agent-name";
```

**Replace the webhook call:**
```ts
// BEFORE:
const webhookResponse = await sendWebhook(N8N_WHATEVER_WEBHOOK, payload);

// AFTER:
const webhookResponse = await runAgentName(payload);
```

### 4. Remove the old env var
- Delete the `N8N_WHATEVER_WEBHOOK` line from the top of routes.ts
- Remove from `.env` and Vercel

### 5. Test
- Rebuild: `npm run build && npm start`
- Test the feature in the browser
- Check terminal for `[AI]` logs

## Parallel Agents

To run multiple agents at the same time (like n8n parallel branches):

```ts
const [result1, result2, result3] = await Promise.all([
  runAgent1(payload),
  runAgent2(payload),
  runAgent3(payload),
]);
```

## Quick Reference

| Need | Use |
|------|-----|
| Text response | `callAgent()` with `jsonMode: false` |
| JSON response | `callAgentJSON<T>()` (automatically sets `jsonMode: true`) |
| Change model | Edit `.config.json` → `"model"` field |
| Change fallback model | Edit `.config.json` → `"fallback"` field |
| Change prompt | Edit `.md` file |
| Change temperature/topP/maxTokens | Edit `.config.json` |
| Switch provider entirely | Just change the model name (e.g. `"gemini-2.5-flash"` → `"gpt-4o"`) |

## Module Folder Structure

```
server/modules/
  module0/   → General / Standalone
    qa-assistant.md
    qa-assistant.config.json
    qa-assistant.ts

  module1/   → Brainstorm (Agent 1, 1a, 1b, Inspect & Refine)
    debate.md                  → Advocate vs Examiner debate
    debate.config.json
    debate.ts
    reanalyze.md               → Re-run debate (Round 2+)
    reanalyze.config.json
    reanalyze.ts
    mechanic.md                → Modify ideas (add/fix/delete/change)
    mechanic.config.json
    mechanic.ts
    list-creator.md            → Extract ideas from debate
    list-creator.config.json
    list-creator.ts
    ai-modifier.md             → AI suggestions for individual ideas
    ai-modifier.config.json
    ai-modifier.ts
    r3-fixes.md                → Round 3 AI fixes for weak items
    r3-fixes.config.json
    r3-fixes.ts

  module2/   → Concept Expansion (Agent 2, 2a, 2b, 2c)
    draft.md                   → Draft provisional specification
    draft.config.json
    draft.ts

  module3/   → Prior Art (Agent 3)
    quick-search.md            → Single concept prior art search
    quick-search.config.json
    quick-search.ts
    multi-search.md            → Multi-concept prior art search
    multi-search.config.json
    multi-search.ts

  module4/   → White Space & Claims (Agent 4, 4b, 4c)
    whitespace.md              → White space / gap analysis
    whitespace.config.json
    whitespace.ts
    claims.md                  → Generate claim variations
    claims.config.json
    claims.ts
    provisional.md             → Full provisional patent spec
    provisional.config.json
    provisional.ts
    broader-claims.md          → Broader claim scope
    broader-claims.config.json
    broader-claims.ts

  module5/   → Showcase & Finalize (Agent 5)
    diagrams.md                → Generate flowcharts/diagrams
    diagrams.config.json
    diagrams.ts
    practitioner.md            → Match patent practitioners
    practitioner.config.json
    practitioner.ts

  pannu/     → Inventorship Validation (Pannu Test)
    questions.md               → Generate Pannu test questions
    questions.config.json
    questions.ts
    validate.md                → Validate inventorship answers
    validate.config.json
    validate.ts
    suggestion.md              → AI suggestion for answers
    suggestion.config.json
    suggestion.ts
```

## AI Client Location
`server/ai/client.ts` — The shared AI wrapper. Handles Gemini + OpenAI, fallback logic, JSON parsing. You should never need to edit this file when migrating agents.

## Environment Variables Needed
```
GEMINI_API_KEY=your-key
OPENAI_API_KEY=your-key
```
