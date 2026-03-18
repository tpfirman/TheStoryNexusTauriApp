# CLAUDE.md — The Story Nexus (Fork)

## Project Overview

**The Story Nexus** is a local-first AI-assisted creative writing desktop application built with Tauri v2 + React + TypeScript. Users write stories with chapters, use a Lexical-based rich text editor, and generate prose via AI (local models via LMStudio, OpenAI, OpenRouter, NanoGPT, or any OpenAI-compatible endpoint).

**Upstream repo**: `vijayk1989/TheStoryNexusTauriApp` (AGPL-3.0)
**This fork**: Personal enhancements on top of upstream. Do not push changes back to the upstream origin without the owner's explicit permission.

**License**: GNU Affero General Public License v3.0 (AGPL-3.0). All modifications must remain under AGPL-3.0. See `LICENSE` for full text.

---

## Git / Push Policy

- **Only** commit and push to this fork: `https://github.com/tpfirman/TheStoryNexusTauriApp`
- **Never** push to upstream: `https://github.com/vijayk1989/TheStoryNexusTauriApp`
- All feature work happens on dedicated branches (e.g. `feat/*`, `fix/*`). No direct commits to `main`.

---

## Key Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server (web preview)
npm run tauri dev    # Full Tauri desktop app (development)
npm run build        # Build web assets
npm run tauri build  # Build desktop binary
npm run tauri build -- --debug  # Debug desktop binary
```


---

## Architecture

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Shadcn UI |
| State | Zustand (in-memory) |
| Routing | React Router v7 |
| Persistence | IndexedDB via DexieJS (local-first, no server) |
| Editor | Lexical (Meta's rich text framework) |
| Notifications | React Toastify |

### Directory Structure

```
src/
├── features/           # Feature modules (stories, chapters, agents, prompts, lorebook…)
│   ├── agents/         # Multi-agent pipeline system (AgentsManager, pipelines)
│   ├── ai/             # AI settings panel + store
│   ├── chapters/       # Chapter editor, StoryEditor, chapter store
│   ├── scenebeats/     # Scene beat nodes + generation hooks
│   ├── prompts/        # Prompt management + store
│   ├── lorebook/       # Character/location/item/event database
│   ├── stories/        # Story list, dashboard
│   ├── drafts/         # Draft saving per scene beat
│   └── brainstorm/     # AI brainstorm/chat feature
├── services/
│   ├── ai/
│   │   ├── AIService.ts          # Unified LLM provider (local/openai/openrouter/…)
│   │   └── AgentOrchestrator.ts  # Multi-step pipeline executor
│   └── database.ts               # Dexie schema (currently v15)
├── types/story.ts      # ALL shared TypeScript types
├── Lexical/            # Lexical editor playground + custom plugins
└── components/         # Shared UI components
```

### Data Persistence

All data lives in **IndexedDB** (via Dexie). Tables:

| Table | Contents |
|-------|---------|
| `stories` | Story metadata |
| `chapters` | Chapter content (Lexical JSON), outline, notes |
| `sceneBeats` | Scene beat commands + generated content |
| `drafts` | Saved generation outputs per scene beat |
| `aiSettings` | API keys, local URL, model list, favourites |
| `prompts` | User + system prompt templates |
| `lorebookEntries` | Characters, locations, items, events, notes |
| `agentPresets` | Agent configurations (role, model, system prompt) |
| `pipelinePresets` | Multi-step agent workflows |
| `pipelineExecutions` | Execution history |

**Chapter content** is auto-saved 1 second after the last keystroke via `SaveChapterContentPlugin`. There is currently no unsaved-indicator in the UI.

**Scene beat selection** (prompt, model, pipeline, agenticMode) is persisted to `localStorage` via `saveSBDefaults` / `loadSBDefaults` in `useSceneBeatInstanceStore`, and restored on next load via `hydrateFromDefaults`.

---

## AI / LLM Architecture

### Providers (AIService.ts)

- `local` → LMStudio at `http://localhost:1234/v1` (configurable URL)
- `openai` → OpenAI API (requires key)
- `openrouter` → OpenRouter (requires key)
- `nanogpt` → NanoGPT (requires key)
- `openai_compatible` → Custom endpoint (Ollama, vLLM, etc.)

All providers stream SSE and share `processStreamedResponse()` for token handling. `abortStream()` cancels the current in-flight request.

### Agentic Pipeline (AgentOrchestrator.ts)

Agents run sequentially. Each step:
1. Builds messages (`buildMessages`) — system + user, multi-turn for revisions, or multi-turn for rejection-feedback retries
2. Calls the appropriate LLM provider (`callModel`)
3. Streams (final prose steps) or collects (judge/checker steps)
4. **Strips `<think>...</think>` blocks** from the raw output via `splitThinkingContent` — `AgentResult.output` is always clean; thinking content is stored in `metadata.thinkingText` for diagnostics
5. Stores result; next step can reference previous results via `previousResults`

**Prose lookup**: Always use `getLastProseResult(results)` (reverse scan, all prose roles) — never `find()` forward on a specific role. Judge and revision steps use this helper to avoid operating on stale first-pass prose when revision loops have run.

**Judge output format**: Judge steps (`lore_judge`, `continuity_checker`) use sentinel tokens for machine-readable output:
- `CONSISTENT` — no issues, revision step skipped
- `##LORE_ISSUE##` / `##CONTINUITY_ISSUE##` — issues found, triggers revision
- Detection logic lives in `hasJudgeIssues(output)` (backward-compatible with legacy `ISSUE:` format)

**Revision loops**: A step with `isRevision: true` builds a revision message using only judge feedback that arrived *after* the most recent prose output (prevents stacking from previous iterations). A step with `pushPrompt` builds a 4-message conversation: `[system, originalUser, assistantPreviousOutput, pushPromptUser]`.

**Rejection feedback**: If `PipelineInput.rejectionFeedback` and `rejectedOutput` are set (from the user rejecting a previous generation), the first `prose_writer` step automatically builds a multi-turn correction conversation: `[system, originalUserMessage, assistantRejectedOutput, userFeedbackMessage]`. Both fields are cleared after the pipeline starts.

**Verification status**: `PipelineResult` carries `verificationStatus: 'passed' | 'failed' | 'skipped'` and `unresolvedIssues` populated from the last judge result in the pipeline. Used by the UI to show a warning toast when issues remain after revision.

**Known issue**: `generateWithLocalModel` currently hardcodes `model: 'local/llama-3.2-3b-instruct'` — the configured model ID is not passed through. This breaks agentic local model selection.

### Agent Roles

`prose_writer`, `lore_judge`, `continuity_checker`, `style_editor`, `dialogue_specialist`, `expander`, `summarizer`, `outline_generator`, `style_extractor`, `scenebeat_generator`, `refusal_checker`, `chapter_reviewer`, `chapter_editor`, `custom`

### Pipeline Presets (agentSeeder.ts)

| Preset | Steps | Notes |
|--------|-------|-------|
| Quality Prose with Lore Check | summarizer? → writer → judge | Judge output visible in Diagnostics |
| Quality Prose with Revision | summarizer? → writer → judge → writer? | Revision only if judge fires `##LORE_ISSUE##` |
| **Quality Prose with Verification** | summarizer? → writer → judge → writer (×2)? → judge | Second judge confirms revision resolved issues; `verificationStatus` in result |
| Full Quality Pipeline | summarizer? → writer → judge → continuity → writer? | Both judges checked |
| Polished Output | writer → style_editor | No validation |
| Quick Draft | writer | Fast, no checks |
| Dialogue Polish | writer → dialogue_specialist | |
| Push Prompt Self-Correction | summarizer? → writer → refusal_checker → writer? | Detects and re-prompts refusals |
| Chapter Review | chapter_reviewer | Whole-chapter editorial |
| Chapter Deep Review | chapter_reviewer → judge → continuity | |

### Scene Beat UI — Generation State

Per-instance store (`useSceneBeatInstanceStore`) tracks:
- `streaming` / `streamComplete` — generation lifecycle
- `rawStreamedText` / `streamedText` / `thinkingText` — think-block split output
- `showAgenticProgress` / `agenticStepResults` — agentic pipeline progress
- `agenticJudgeResults` / `latestJudgeFeedback` / `showJudgeFeedback` — inline judge feedback banner
- `rejectedOutput` / `rejectionFeedback` / `showRejectionInput` — reject-with-feedback flow

**Completion toasts** fire via `react-toastify` in `useSceneBeatGeneration.ts` on both standard and agentic completion. Agentic toasts include pipeline name, step count, and a warning variant when `verificationStatus === 'failed'`. Lorebook workshop also toasts on generation completion.

---

## Branching Policy

- **`main`** — stable, no direct commits. PRs only.
- Feature work lives in `feature/*` branches.
- All the improvements tracked in `IMPLEMENTATION_PLAN.md` are being implemented on `feature/improvements`.

---

## Known Issues

1. **Hardcoded local model** — `AIService.generateWithLocalModel` ignores the configured model ID; breaks agentic local model selection.
2. **Auto-save data loss edge case** — debounce is cancelled on unmount; rapid navigation may lose the last ~1s of edits.
3. **Upstream features missing** — `AIEditorialPanel`, bulk operations, and `resetSystemDefaults` are in upstream but not yet in this fork.

### Recently Fixed
- ~~**Revision loop uses stale result**~~ — Fixed: `getLastProseResult()` reverse-scans all prose roles; judge and revision message builders all updated.
- ~~**Scene beat settings not persisted**~~ — Fixed: prompt/model/pipeline/agenticMode persisted to `localStorage` via `saveSBDefaults` / `loadSBDefaults` in `useSceneBeatInstanceStore`.
- ~~**`<think>` tags in judge output contaminating next step**~~ — Fixed: `splitThinkingContent` applied to all step outputs in `executePipeline`; `AgentResult.output` is always clean.
- ~~**Fragile judge ISSUE keyword matching**~~ — Fixed: sentinel tokens `##LORE_ISSUE##` / `##CONTINUITY_ISSUE##` with backward-compat `hasJudgeIssues()` helper.
- ~~**No post-revision verification**~~ — Fixed: "Quality Prose with Verification" preset; `PipelineResult.verificationStatus`.
- ~~**Judge feedback invisible to user**~~ — Fixed: `JudgeFeedbackBanner` shown inline during pipeline execution.
- ~~**No feedback path on rejection**~~ — Fixed: "Reject with Feedback" button + multi-turn correction on next generation run.

---

## Coding Conventions

- TypeScript strict mode; no `any` except in legacy AI request bodies.
- Zustand stores handle all state; components call store actions.
- Database writes always go through the store (never direct `db.*` calls from components).
- New agent roles require changes in: `types/story.ts` (role union + DEFAULT_CONTEXT_CONFIG), `AgentOrchestrator.ts` (buildXxxMessage), `agentSeeder.ts` (SYSTEM_AGENT_PRESETS), `useAgentsStore.ts` (role label map).
- Keep the Dexie schema version incremented when adding/changing tables or indexes.

### Pipeline / Agent Conventions

- **Prose lookup in pipeline steps**: always use `getLastProseResult(results)` (or `getLastProseOutput`). Never use `results.find(r => r.role === 'prose_writer')` — this is a forward scan that returns stale first-pass output after revision loops.
- **Judge output detection**: use `hasJudgeIssues(output)` in `AgentOrchestrator`. In UI code replicate the same sentinel + legacy logic (see `judgeHasIssues` in `PipelineDiagnosticsDialog.tsx`). Do not add new bare-keyword checks.
- **Judge system prompts**: must instruct the model to output `CONSISTENT` (nothing else) when clean, and use `##LORE_ISSUE##` / `##CONTINUITY_ISSUE##` sentinel blocks when issues are found. The system prompt owns the format; do not add duplicate format instructions in the user message.
- **Think tags**: `AgentResult.output` is always stripped of `<think>` blocks by `executePipeline`. Thinking content is in `metadata.thinkingText`. Never read `output` and expect it to contain think tags — use `metadata.thinkingText` for that.
- **Feedback collection in revisions**: filter judge results to only those that arrived *after* the last prose result index. See `buildRevisionMessage` for the reference pattern.
- **Completion toasts**: standard generation and agentic pipelines both fire `toast.success/warn` on completion in `useSceneBeatGeneration.ts`. New generation surfaces (e.g. a new dialog that runs a pipeline) should follow the same pattern.
