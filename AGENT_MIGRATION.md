# How to Migrate an n8n Agent to Direct AI

## Folder convention (per substage)

Every agent lives in its own substage folder under the module: `server/modules/moduleX/<substage>/`. The substage name matches the route (e.g. route `/agent/2/draft` → `module2/2a/` because it produces the 2a concept-expansion snapshot; route `/agent/2/extract-ideas` → `module2/2b/`). Never drop agent files flat at the module root — even if a module has only one substage today, use the folder from day one so adding a second agent doesn't require a move + import-path rewrite + `loadAgentConfig` path update later.

Single-agent substages have one `.md` + one `.config.json` + one `.ts` runner. Multi-agent pipelines (like 2b's extractor → refiner) put each agent's `.md` + `.config.json` side-by-side, plus one runner `.ts` that orchestrates them.

## 3 Files Per Agent

Every agent inside a substage folder has exactly 3 files:

1. **`agent-name.md`** — The prompt. Edit anytime. No code changes needed.
2. **`agent-name.config.json`** — Model, temperature, topP, maxTokens. Edit anytime. Each agent can use a completely different model.
3. **`agent-name.ts`** — The logic. Builds the user message, calls `callAgent()`, returns result.

## Available Models (canonical for this project — 2026-04-22)

Do not use `-preview` Gemini models in production. We saw silent quality regressions (fewer/nonsensical items) when an agent relied on `gemini-3-flash-preview`; the three stable "-latest" aliases below are the only Gemini models to use in any agent config.

### Gemini — text generation
Use the short name (no `models/` prefix). `isGemini()` in [client.ts:26](server/ai/client.ts#L26) dispatches on `startsWith("gemini")`, so if you paste the name as it appears in n8n (`models/gemini-flash-latest`), it routes to OpenAI and fails. **Always strip `models/` when writing to `.config.json`.**

| Model | Role it fits |
|-------|--------------|
| `gemini-pro-latest` | Heavy reasoning and long-form output — debates, audits, list-making, idea refinement, provisional drafts, claims. Default for any agent that produces structured long text. |
| `gemini-flash-latest` | Interactive / balanced — Q&A assistants, mid-weight tasks where latency matters. |
| `gemini-flash-lite-latest` | Binary / trivial — per-item classifiers (e.g. KEEP/REMOVE filter), very short outputs. Fast and cheap. |

### Observed behavior when choosing between them (real data from this project)
The list-maker agent is the canonical example — same prompt, same input, different models:

| Model | Items produced | Why |
|-------|---------------|-----|
| `gemini-pro-latest` | ~13 | Consolidates/merges related ideas; denser output |
| `gemini-flash-latest` | ~6 | Flash is concise by default, drops nuance |
| `gemini-3-flash-preview` (DEPRECATED) | ~18 | Most literal, splits everything; unstable quality |

Takeaway: **pro-latest prefers quality over count, flash-latest prefers brevity, preview models are unreliable**. Pick by what the downstream consumer needs — if the route shows the output to the user, Pro. If the route only needs a decision, Lite.

### OpenAI (fallback only — use `OPENAI_API_KEY`)
Fallback kicks in if the primary Gemini call throws. Match weight to the primary.

| Model | Use as fallback for |
|-------|---------------------|
| `gpt-4o` | `gemini-pro-latest` agents |
| `gpt-4o-mini` | `gemini-flash-latest` and `gemini-flash-lite-latest` agents |

Provider auto-detect is by name prefix: `gemini-*` → Gemini API, everything else → OpenAI API.

### Verifying a model exists
If you must try a different name, verify it's live before wiring it in:
```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | jq -r '.models[] | select(.supportedGenerationMethods[]? == "generateContent") | .name'
```

### Models to avoid (seen breaking things in this codebase)
- Any `-preview` Gemini name — unstable output, silently changes between versions. Caused the "app brings fewer ideas than n8n" regression we debugged.
- Any Gemini name prefixed with `models/` — routes to the wrong provider because of `isGemini()` prefix check.
- Specialty Gemini (`*-image`, `*-live`, `*-embedding`, `veo-*`, `lyria-*`, `gemma-*`) — they use different API contracts and will fail inside `callAgent()`.

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
  "model": "gemini-pro-latest",
  "fallback": "gpt-4o",
  "temperature": 0.3,
  "topP": 0.9,
  "maxTokens": 16000
}
```
Every field is independent per agent. One agent can use `gemini-pro-latest` at temp 0.1, another can use `gemini-flash-lite-latest` at temp 0.9. Just edit the JSON. See the model table above for which model to pick per agent role.

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
| Switch provider entirely | Just change the model name (e.g. `"gemini-pro-latest"` → `"gpt-4o"`) |
| Trace which model actually served a call | Watch dev log for `[AI] -> <model>` / `[AI] <- <model> ok (Nms, N chars)` lines added in [client.ts](server/ai/client.ts). Fallback shows `[AI] -> fallback <name>`. |

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
    2a/                        → Draft provisional specification        [MIGRATED]
      draft.md
      draft.config.json
      draft.ts
    2b/                        → Extract + refine patentable concepts   [MIGRATED]
      extractor.md
      extractor.config.json
      refiner.md
      refiner.config.json
      extract-concepts.ts

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

`npm run dev` uses `tsx server/index.ts` **without `--watch`** — server edits do NOT auto-restart. After editing any server-side file (including an agent's `.md`, `.config.json`, or `.ts`), stop and rerun `npm run dev` to pick up the change. Client edits still hot-reload through Vite. If the dev server appears stuck on old behavior, restart is almost always the fix.

## Checklist for every new migration

- [ ] Create `.config.json`, `.md`, `.ts` under `server/modules/<moduleX>/<sub>/`.
- [ ] Use `loadAgentConfig` / `loadPrompt` — do NOT use `import` for JSON/MD (those files must stay readable at runtime so `includeFiles` can ship them).
- [ ] Return shape matches the `routes.ts` consumer (grep the route first).
- [ ] Route change swaps `callN8nWebhook(N8N_*_WEBHOOK, ...)` for `runYourAgent(...)`.
- [ ] Delete the `const N8N_*_WEBHOOK = process.env.N8N_*_WEBHOOK!` line at the top of `routes.ts`.
- [ ] Remove the env var from `.env` and from Vercel's project settings.
- [ ] Run `npm run build:vercel` locally and smoke-test the bundled `api/index.js`. If the build or import fails locally, it will fail on Vercel.
- [ ] Verify the feature in the UI both on `npm run dev` AND after a Vercel deploy.
