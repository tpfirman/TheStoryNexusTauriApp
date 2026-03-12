# CLAUDE.md — The Story Nexus (Fork)

## Project Overview

**The Story Nexus** is a local-first AI-assisted creative writing desktop application built with Tauri v2 + React + TypeScript. Users write stories with chapters, use a Lexical-based rich text editor, and generate prose via AI (local models via LMStudio, OpenAI, OpenRouter, NanoGPT, or any OpenAI-compatible endpoint).

**Upstream repo**: `vijayk1989/TheStoryNexusTauriApp` (AGPL-3.0)
**This fork**: Personal enhancements on top of upstream. Do not push changes back to the upstream origin without the owner's explicit permission.

**License**: GNU Affero General Public License v3.0 (AGPL-3.0). All modifications must remain under AGPL-3.0. See `LICENSE` for full text.

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

Selected model/prompt/pipeline in the scene beat panel is **in-memory only** (Zustand, not persisted) — users must re-select on every reload. This is a known issue to fix.

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
1. Builds messages (`buildMessages`) — system + user, or multi-turn for revisions
2. Calls the appropriate LLM provider (`callModel`)
3. Streams (final prose steps) or collects (judge/checker steps)
4. Stores result; next step can reference previous results

**Revision loops**: A step with `isRevision: true` + `pushPrompt` builds a 4-message conversation: `[system, originalUser, assistantPreviousOutput, pushPromptUser]`.

**Known issue**: `generateWithLocalModel` currently hardcodes `model: 'local/llama-3.2-3b-instruct'` — the configured model ID is not passed through. This breaks agentic local model selection.

### Agent Roles

`prose_writer`, `lore_judge`, `continuity_checker`, `style_editor`, `dialogue_specialist`, `expander`, `summarizer`, `outline_generator`, `style_extractor`, `scenebeat_generator`, `refusal_checker`, `chapter_reviewer` (upstream), `chapter_editor` (upstream), `custom`

---

## Branching Policy

- **`main`** — stable, no direct commits. PRs only.
- Feature work lives in `feature/*` branches.
- All the improvements tracked in `IMPLEMENTATION_PLAN.md` are being implemented on `feature/improvements`.

---

## Known Issues (pre-fix)

See `IMPLEMENTATION_PLAN.md` for the full breakdown. TL;DR:

1. **Hardcoded local model** — `AIService.generateWithLocalModel` ignores the configured model ID.
2. **Scene beat settings not persisted** — selected model/prompt/pipeline resets on reload.
3. **Auto-save data loss edge case** — debounce is cancelled on unmount; rapid navigation may lose the last ~1s of edits.
4. **Revision loop uses stale result** — always picks the first `prose_writer` result rather than the most recent one.
5. **Upstream features missing** — `chapter_reviewer`/`chapter_editor` roles, `AIEditorialPanel`, bulk operations, and `resetSystemDefaults` are in upstream but not yet in this fork.

---

## Coding Conventions

- TypeScript strict mode; no `any` except in legacy AI request bodies.
- Zustand stores handle all state; components call store actions.
- Database writes always go through the store (never direct `db.*` calls from components).
- New agent roles require changes in: `types/story.ts` (role union + DEFAULT_CONTEXT_CONFIG), `AgentOrchestrator.ts` (buildXxxMessage), `agentSeeder.ts` (SYSTEM_AGENT_PRESETS), `useAgentsStore.ts` (role label map).
- Keep the Dexie schema version incremented when adding/changing tables or indexes.
