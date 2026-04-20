# How to Migrate an n8n Agent to Direct AI

## 3 Files Per Agent

Every agent lives in `server/modules/moduleX/` and has exactly 3 files:

1. **`agent-name.md`** — The prompt. Edit anytime. No code changes needed.
2. **`agent-name.config.json`** — Model, temperature, topP, maxTokens. Edit anytime. Each agent can use a completely different model.
3. **`agent-name.ts`** — The logic. Builds the user message, calls `callAgent()`, returns result.

## Available Models (verified 2026-04-14 against the live `/v1beta/models` endpoint)

### Gemini — text generation (use these in `.config.json` `model` / `fallback`)
| Model | Best For |
|-------|----------|
| `gemini-3.1-pro-preview` | Latest flagship, best quality, complex reasoning, long drafts |
| `gemini-3.1-flash-lite-preview` | Latest cheap/fast, simple tasks |
| `gemini-3-flash-preview` | Current fast workhorse (used by most migrated modules today) |
| `gemini-2.5-pro` | Stable flagship — reasoning, long patent drafts, claims |
| `gemini-2.5-flash` | Stable fast general purpose, good balance |
| `gemini-2.5-flash-lite` | Stable cheapest/fastest, simple tasks |

### Gemini — specialty (do NOT use for text agents)
| Model | Purpose |
|-------|---------|
| `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`, `gemini-2.5-flash-image` | Image generation |
| `gemini-3.1-flash-live-preview`, `gemini-live-2.5-flash-native-audio` | Live / realtime streaming |
| `gemini-embedding-2-preview`, `gemini-embedding-001` | Embeddings (not `generateContent`) |
| `gemini-robotics-er-1.6-preview` | Robotics-specific |
| `veo-3.1-preview`, `veo-3.1-lite-generate-preview` | Video generation |
| `lyria-3-pro-preview`, `lyria-3-clip-preview` | Music generation |
| `gemma-4-26b-a4b-it`, `gemma-4-31b-it` | Gemma family (different API contract) |

To refresh this list, run:
```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | jq -r '.models[] | select(.supportedGenerationMethods[]? == "generateContent") | .name'
```

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

  module1/   → Brainstorm (Agent 1, 1a, 1b, 1c, Inspect & Refine)
    1a/                        → Round 1: Advocate vs Examiner debate  [MIGRATED]
      advocate.md
      advocate.config.json
      examiner.md
      examiner.config.json
      debate.ts
    1b/                        → Round 2: Value-preservation audit     [MIGRATED]
      advocate.md
      advocate.config.json
      examiner.md
      examiner.config.json
      reanalyze.ts
    1c/                        → Round 3: AI fixes for weak items      [MIGRATED]
      r3-fixes.md
      r3-fixes.config.json
      r3-fixes.ts
    1d/                        → List Creator (unify + filter ideas)   [MIGRATED]
      list-maker.md
      list-maker.config.json
      filter.md
      filter.config.json
      list-creator.ts
    1e/                        → AI Idea Modifier (per-item refine)    [MIGRATED]
      ai-modifier.md
      ai-modifier.config.json
      ai-modifier.ts
    1f/                        → Address Concerns (examiner review)    [BUILT — not yet wired to a route]
      examiner-review.md
      examiner-review.config.json
      address-concerns.ts
    mechanic/                  → Modify ideas (add/fix/delete/change)  [TODO — still n8n: N8N_MECHANIC_WEBHOOK]
      mechanic.md
      mechanic.config.json
      mechanic.ts

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

---

# Deployment: Vercel vs Local Dev

**Rule:** there is only one valid way to build — the way that works on the Vercel production deployment. A feature that works on `npm run dev` but breaks on Vercel is considered broken. Today's outage was caused by relying on `tsx` / Vite resolution behaviors that Node's native ESM loader rejects in `/var/task`.

## The build pipeline

Vercel runs `npm run build:vercel` (defined in `package.json`). That script does two things:

1. `vite build` — compiles the client into `dist/public/`.
2. `esbuild server-entry/vercel.ts --bundle --format=esm --outfile=api/index.js` — bundles the entire server into a **single** ESM file at `api/index.js`, with all relative imports resolved at build time, `@shared/*` path aliases resolved via `--alias:@shared=./shared`, and all `node_modules` kept external.

`vercel.json` just calls `npm run build:vercel`, declares `api/index.js` as the function (with `maxDuration: 300` and `includeFiles`), and maps `/api/*` → `/api`.

`api/index.js` is a **committed stub** that Vercel's schema validation finds before the build runs; the esbuild bundle overwrites it during deploy.

## Why the bundle is not optional

Vercel's `@vercel/node` compiles each `.ts` to a standalone `.js` without bundling. On Node's spec-strict ESM loader inside `/var/task`:

- Extensionless relative imports (`import x from "./routes"`) fail with `ERR_MODULE_NOT_FOUND`.
- `@shared/*` path aliases fail — Node doesn't read `tsconfig.json`.
- `.ts` extension imports fail.

`tsx` / Vite tolerate all three in dev, which is why dev passes and prod crashes. The esbuild pre-bundle eliminates every one of these resolvers at build time.

## Runtime-read assets (`.json`, `.md`)

esbuild only ships **imported JS/TS**. Anything read at runtime via `fs.readFileSync` (agent prompt `.md` files, `.config.json` files, templates, etc.) is NOT in the bundle and will throw `ENOENT` on Vercel.

The fix is `includeFiles` in `vercel.json`:

```json
"functions": {
  "api/index.js": {
    "maxDuration": 300,
    "includeFiles": "server/modules/**"
  }
}
```

This copies the glob into the function's filesystem at the same relative path. `loadAgentConfig()` / `loadPrompt()` use `path.resolve(process.cwd(), "server", "modules", ...)`, which resolves to `/var/task/server/modules/...` in production.

**When adding a new module**: if it reads any `.md`, `.json`, `.txt`, etc. at runtime, it must sit under a path already covered by the `includeFiles` glob. Today the glob is `server/modules/**`, which covers every submodule we will ever add under that tree.

## Session store (postgres) on Vercel

`connect-pg-simple` will silently fail on Vercel if you let it open its own raw TCP connection — Neon does not accept TCP from Vercel's serverless environment reliably. Symptom: login "hangs forever", `session.save()` never resolves, `pending2FAUserId` never persists across requests, and "Resend Code" silently sends nothing.

Fix: reuse the existing Neon WebSocket pool from `server/db.ts`.

```ts
// server/routes.ts
import { pool } from "./db";

const sessionStore = new pgStore({
  pool: pool as any,          // Neon WS Pool is node-postgres-compatible
  createTableIfMissing: true,
  ttl: sessionTtl,
});
```

Never pass `conString` to `connect-pg-simple` in a serverless deploy.

## Response-shape contracts between agents and routes

When migrating an n8n webhook to a direct AI call, the **return shape must match what the consumer in `routes.ts` expects**. The n8n webhook path typically wraps payloads as `{ success, data: {...} }`. If the consumer reads `response.data.fullDebate` and your migrated agent returns `{ success, fullDebate }` flat, the route silently falls through with `fullDebate = []` and the UI renders empty.

Before finalizing a migration, grep the consumer in `routes.ts` and confirm the exact keys it reads (`.data`, `.auditResults`, `.data.fixes`, etc.). Either wrap your return to match the consumer, or update the consumer — just don't ship a silent mismatch.

## Round-shape parity across routes

All routes that write to `agent1.data.rounds[]` must emit the same round shape. The canonical shape from `POST /api/projects/:id/agent/1/rounds`:

```ts
{
  id: string,                    // `round-${Date.now()}-${random}`
  userMessage: string,           // the user's input that produced this round
  agentsDebate: Array<{ speaker: string; message: string }>,
  transcript: string,
  roundType: "brainstorm" | "mechanic",
  createdAt: string,             // ISO timestamp
  command?: string,
  qualityScore?: number | null,
}
```

Downstream code (backfill-snapshots, `originalIdea` in the UI, `webhookLog` entries) reads `userMessage` and `createdAt` by name. `/reanalyze` used to emit `roundNumber` and `timestamp` instead — fixed. Any new route that pushes rounds must use the canonical shape.

## Request logging

`server/app.ts` logs each `/api/*` response as `METHOD PATH STATUS in Nms :: <body>`. Truncation is at 2000 chars (was 80, which hid empty-array bugs). When debugging, "200 in 1200ms" alone is not enough — the truncated body tells you whether `agentsDebate` was populated or empty.

## Local dev behavior

`npm run dev` uses `tsx server/index.ts` and watches for file changes — server edits trigger an automatic restart; client edits hot-reload through Vite. If changes are not picked up, tsx likely crashed on a previous error; kill and re-run.

## Checklist for every new migration

- [ ] Create `.config.json`, `.md`, `.ts` under `server/modules/<moduleX>/<sub>/`.
- [ ] Use `loadAgentConfig` / `loadPrompt` — do NOT use `import` for JSON/MD (those files must stay readable at runtime so `includeFiles` can ship them).
- [ ] Return shape matches the `routes.ts` consumer (grep the route first).
- [ ] Route change swaps `callN8nWebhook(N8N_*_WEBHOOK, ...)` for `runYourAgent(...)`.
- [ ] Delete the `const N8N_*_WEBHOOK = process.env.N8N_*_WEBHOOK!` line at the top of `routes.ts`.
- [ ] Remove the env var from `.env` and from Vercel's project settings.
- [ ] Run `npm run build:vercel` locally and smoke-test the bundled `api/index.js`. If the build or import fails locally, it will fail on Vercel.
- [ ] Verify the feature in the UI both on `npm run dev` AND after a Vercel deploy.
