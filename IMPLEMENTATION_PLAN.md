# Implementation Plan — Story Nexus Fork Improvements

**Branch**: `feature/improvements`
**Status**: In planning
**Last updated**: 2026-03-12

---

## Step 0 — Create Feature Branch ⚠️ DO THIS FIRST

```bash
git checkout -b feature/improvements
```

All work in this plan goes on `feature/improvements`. Nothing is committed directly to `main`.

---

## Background

This fork is based on `vijayk1989/TheStoryNexusTauriApp` (AGPL-3.0). The upstream repo has moved 2 commits ahead since the fork point (`3f927bf`), adding chapter editorial features. Additionally, this fork has a number of bugs and UX issues that need addressing.

### What the upstream added (commits `261b550` + `97ad554`):
- `chapter_reviewer` and `chapter_editor` agent roles
- `AIEditorialPanel.tsx` + `ChapterReviewPanel.tsx` components
- `BulkUpdatePanel.tsx` shared component
- Bulk operations on agents, pipelines, and prompts
- `resetSystemDefaults()` to force-reseed system agents
- Force mode in `agentSeeder` (wipe + recreate system agents)
- Updated `StoryEditor.tsx` with AI Editorial side panel

---

## Step 1 — Bring Upstream Changes into Fork

Bring the 2 upstream commits' changes (files differing between orig and fork) into the feature branch.

### Files to copy/update from orig → fork

**New files (create):**
- [ ] `src/components/BulkUpdatePanel.tsx`
- [ ] `src/features/chapters/components/AIEditorialPanel.tsx`
- [ ] `src/features/chapters/components/ChapterReviewPanel.tsx`

**Modified files (patch):**
- [ ] `src/types/story.ts`
  - Add `isValid?: boolean` to Draft interface
  - Add `"chapter_reviewer"` and `"chapter_editor"` to AgentRole union type
  - Add context config entries for `chapter_reviewer` and `chapter_editor` in DEFAULT_CONTEXT_CONFIG

- [ ] `src/services/ai/AgentOrchestrator.ts`
  - Add `case 'chapter_reviewer':` and `case 'chapter_editor':` to role dispatch
  - Add `buildChapterReviewerMessage()` private method
  - Add `buildChapterEditorMessage()` private method

- [ ] `src/features/agents/services/agentSeeder.ts`
  - Add `chapter_reviewer` and `chapter_editor` to CONTEXT_CONFIGS map
  - Add System Chapter Reviewer agent preset
  - Add System Chapter Editor agent preset
  - Add 4 new pipeline presets: Chapter Review, Chapter Deep Review, Chapter Edit, Chapter Review then Edit
  - Add force mode: when `force=true`, delete existing system agents/pipelines before reseeding

- [ ] `src/features/agents/stores/useAgentsStore.ts`
  - Add `chapter_reviewer` and `chapter_editor` to role label map
  - Add `bulkUpdateAgentPresets(ids, data)` action
  - Add `bulkUpdateAgentModel(ids, model)` action
  - Add `bulkUpdatePipelinePresets(ids, data)` action
  - Add `resetSystemDefaults(storyId?)` action

- [ ] `src/features/prompts/store/promptStore.ts`
  - Add `bulkUpdatePrompts(ids, data)` action

- [ ] `src/features/chapters/components/StoryEditor.tsx`
  - Add `AIEditorialPanel` import
  - Add `"chapterReview"` to `DrawerType` union
  - Add AI Editorial button to toolbar
  - Add AI Editorial sheet with drag-to-resize handle
  - Wire `editorialWidth` state + `startEditorialDrag` handler

- [ ] `src/features/agents/components/AgentPresetForm.tsx` — sync with upstream
- [ ] `src/features/agents/components/AgentPresetList.tsx` — sync with upstream
- [ ] `src/features/agents/components/AgentsManager.tsx` — sync with upstream
- [ ] `src/features/agents/components/PipelinePresetForm.tsx` — sync with upstream
- [ ] `src/features/agents/components/PipelinePresetList.tsx` — sync with upstream
- [ ] `src/features/prompts/components/PromptList.tsx` — sync with upstream
- [ ] `src/features/prompts/components/PromptsManager.tsx` — sync with upstream

---

## Step 2 — Critical Bug Fixes

### Bug 2A — Hardcoded Local Model in AIService (**HIGH PRIORITY**)

**File**: `src/services/ai/AIService.ts` line 365
**Problem**: `generateWithLocalModel()` always sends `model: 'local/llama-3.2-3b-instruct'` regardless of which local model is configured on an agent or prompt. This means every local model call uses the same hardcoded model.

**Fix**:
- Add `modelId?: string` parameter to `generateWithLocalModel()`
- Use `modelId` in the request body; fall back to the first available local model from `this.settings.availableModels` if not provided
- Strip the `local/` prefix from model IDs when sending to the LMStudio API (LMStudio uses bare IDs like `llama-3.2-3b-instruct`, not `local/llama-3.2-3b-instruct`)

**Cascading fix in AgentOrchestrator.ts**:
- In `callModel()`, pass `model.id` (or the bare ID without `local/`) to `generateWithLocalModel()`
- Also update `useAIStore.ts` and `useSceneBeatInstanceStore.ts` calls to pass the model ID

### Bug 2B — Revision Loop Uses Stale Prose Result (**HIGH PRIORITY**)

**File**: `src/services/ai/AgentOrchestrator.ts` line 302
**Problem**: `buildMessages()` for revision mode calls `previousResults.find(r => r.role === 'prose_writer')` which returns the FIRST prose_writer result. In a multi-iteration revision loop, this means the AI is always shown its original (pre-revision) output as the "previous output", not the most recent revised version.

**Fix**: Replace `.find()` with a reverse search to get the most recent prose_writer result:
```typescript
// Instead of:
const proseResult = previousResults.find(r => r.role === 'prose_writer');
// Use:
const proseResult = [...previousResults].reverse().find(r => r.role === 'prose_writer');
```

### Bug 2C — AbortController Shared Between Pipeline Steps (**MEDIUM**)

**File**: `src/services/ai/AIService.ts`
**Problem**: Every call to `generateWithLocalModel()` (and other generate methods) creates a new `AbortController` and stores it as `this.abortController`. Since the `AIService` is a singleton, this shared mutable state means:
1. If two pipeline steps run in rapid succession (shouldn't normally happen, but possible), one step could abort the other.
2. The `AgentOrchestrator` has its own `abortController` but doesn't share it with `AIService` — abort signals come from two places.

**Fix**: Pass an optional `AbortSignal` parameter down through `callModel()` and into each `generateWith*()` method instead of creating a new controller internally. The orchestrator passes its own signal; standalone generation creates its own.

---

## Step 3 — Settings & State Persistence

### Issue 3A — Scene Beat Model/Prompt/Pipeline Not Persisted (**HIGH PRIORITY**)

**File**: `src/features/scenebeats/stores/useSceneBeatInstanceStore.ts`
**Problem**: `selectedModel`, `selectedPrompt`, `selectedPipeline`, and `agenticMode` are Zustand state only. On app reload, these all reset to `undefined`/`false`. Users must re-select their entire scene beat configuration on every session.

**Fix**:
- Persist `selectedPromptId`, `selectedModelId`, `selectedPipelineId`, and `agenticMode` to `localStorage` (simple key-value, these are cheap to store)
- On store initialisation, restore these values from localStorage
- After restoring IDs, hydrate the full objects from the prompt/model stores
- Update `handlePromptSelect` and related actions to also write to localStorage

**Implementation approach** — add an `initFromStorage()` action called from App startup:
```typescript
// Keys to persist
const STORAGE_KEYS = {
  promptId: 'scenebeat-selected-prompt-id',
  modelId: 'scenebeat-selected-model-id',
  pipelineId: 'scenebeat-selected-pipeline-id',
  agenticMode: 'scenebeat-agentic-mode',
};
```

### Issue 3B — AI Settings Panel Re-initialization (**MEDIUM**)

**File**: `src/features/ai/stores/useAIStore.ts`
**Problem**: API keys and URLs ARE saved to IndexedDB and DO persist across reloads. However, the `isInitialized` flag is in-memory, so `initialize()` runs on every app start. If `initialize()` is called multiple times (e.g., multiple components calling `getAvailableModels` before the first call resolves), there's no deduplication guard.

**Fix**: Add an `_initPromise` singleton guard so concurrent `initialize()` calls share one promise:
```typescript
private _initPromise: Promise<void> | null = null;
initialize: async () => {
  if (get().isInitialized) return;
  if (_initPromise) return _initPromise;
  _initPromise = /* actual init */;
  await _initPromise;
  _initPromise = null;
}
```

---

## Step 4 — Story / Data Safety

### Issue 4A — Debounce Cancelled on Fast Navigation (**MEDIUM**)

**File**: `src/Lexical/lexical-playground/src/plugins/SaveChapterContent/index.tsx`
**Problem**: The `SaveChapterContentPlugin` debounces writes by 1 second. When the `useEffect` cleanup runs (on chapter switch or component unmount), `saveContent.cancel()` is called — discarding any pending save. If a user types and immediately navigates away, up to 1 second of edits can be lost silently.

**Fix**: On cleanup, call `saveContent.flush()` instead of (or in addition to) `saveContent.cancel()` — this forces any pending debounced write to fire synchronously:
```typescript
return () => {
  removeUpdateListener();
  saveContent.flush(); // persist pending edits before unmounting
};
```

### Issue 4B — No Unsaved Indicator (**LOW/UX**)

**Problem**: Users have no visual feedback that their edits are being saved. The auto-save is silent.

**Fix**: Add a small "Saving…" / "Saved" status indicator in the `StoryEditor` toolbar. The `SaveChapterContentPlugin` can emit save state via a Zustand flag (`isSaving: boolean` in `useChapterStore` or a dedicated editor state).

### Issue 4C — Agent Pipeline Execution Not Linked to Draft (**LOW**)

**Problem**: When an agentic pipeline produces prose, there's no automatic "save draft" step. If the app reloads before the user explicitly saves, the output is lost.

**Fix**: After a successful pipeline execution, automatically save the result as a `Draft` record in IndexedDB (same as what `saveDraft()` does for standard generation). Mark it as auto-saved so users can distinguish it from intentional drafts.

---

## Step 5 — Agentic Workflow Improvements

### Issue 5A — Agentic Pipeline Context for Revision Steps (**MEDIUM**)

**Problem**: In `buildMessages()` for revision mode, the "original user message" is always rebuilt from scratch using `buildProseWriterMessage(agent, input, [], false)` — ignoring any previous step outputs. This means the revision prompt sees the raw scene beat context but not any intermediate judge feedback that might have been incorporated into the original user message.

**Fix**: Store the original user message in the `AgentResult` metadata when the prose writer step first runs, so revision steps can replay the exact original conversation.

### Issue 5B — Agentic Mode: Non-streaming Steps Use Wrong Model Config (**HIGH**)
*See also Bug 2A* — same root cause. All local model calls use the hardcoded model.

### Issue 5C — Pipeline Progress Feedback (**LOW/UX**)

**Problem**: The agentic progress UI shows step names but doesn't show token counts, elapsed time per step, or which model is running.

**Fix**: Emit richer progress events from `AgentOrchestrator` callbacks: add `tokensGenerated` to `onStepComplete`, add `modelName` to `onStepStart`.

### Issue 5D — Model ID Stripping for LMStudio (**HIGH**)

**Problem**: Local models in the app are stored with IDs prefixed `local/` (e.g., `local/llama-3.2-3b-instruct`). LMStudio's API expects the bare model ID without the prefix. Currently this is only handled implicitly by the hardcoded model string. Once we fix Bug 2A and pass real model IDs, we must also strip the `local/` prefix before sending to LMStudio.

**Fix**: In `generateWithLocalModel()`, strip the `local/` prefix:
```typescript
const bareModelId = modelId.replace(/^local\//, '');
```

---

## Step 6 — Code Quality & Stability

### Issue 6A — Debug Console Logs in promptParser.ts (**LOW**)

**File**: `src/features/prompts/services/promptParser.ts`
**Problem**: Extensive `console.log` DEBUG statements left in production code (lines ~501–618). These spam the console and may expose user content in logs.

**Fix**: Remove or gate behind a `DEBUG` flag.

### Issue 6B — `any` Type in AI Request Bodies (**LOW**)

**Files**: `AIService.ts` — `requestBody: any`
**Fix**: Create a typed `LMStudioChatRequest` interface.

### Issue 6C — Error Handling in Standard Generation (**MEDIUM**)

**Problem**: If standard (non-agentic) generation fails, the error is shown as a toast but the streaming state may be left in `streaming: true`. This can lock the UI until reload.

**Fix**: Ensure the `finally` block in `useSceneBeatGeneration.ts` always resets `streaming: false`.

---

## Step 7 — Testing & Validation

- [ ] Manually test: create a story → chapter → type content → switch chapter → return → verify content intact (tests Issue 4A fix)
- [ ] Manually test: set LMStudio URL + select local model → reload app → verify URL persists AND model selection is restored (tests Issues 3A, 3B)
- [ ] Manually test: run an agentic pipeline with a local model → verify the agent's configured model is actually used (tests Bug 2A)
- [ ] Manually test: run a pipeline with a revision step → verify the push prompt shows the MOST RECENT prose output (tests Bug 2B)
- [ ] Manually test: abort mid-pipeline → verify no hung state
- [ ] Manually test: AI Editorial panel opens and runs chapter review

---

## Priority Order Summary

| Priority | Step | Description |
|----------|------|-------------|
| 🔴 P0 | 0 | Create feature branch |
| 🔴 P1 | 1 | Bring upstream changes (chapter reviewer/editor, bulk ops) |
| 🔴 P1 | 2A | Fix hardcoded local model (breaks all agentic local generation) |
| 🔴 P1 | 2D | Fix `local/` prefix stripping for LMStudio |
| 🟠 P2 | 2B | Fix revision loop stale result |
| 🟠 P2 | 3A | Persist scene beat model/prompt/pipeline selection |
| 🟠 P2 | 4A | Fix debounce flush on unmount (data loss) |
| 🟡 P3 | 3B | Fix duplicate initialize() calls |
| 🟡 P3 | 2C | AbortController refactor |
| 🟡 P3 | 6C | Fix streaming state left dirty on error |
| 🟢 P4 | 4B | Unsaved indicator in toolbar |
| 🟢 P4 | 4C | Auto-save pipeline output as draft |
| 🟢 P4 | 5A | Store original user message in AgentResult metadata |
| 🟢 P4 | 5C | Richer pipeline progress events |
| 🟢 P5 | 6A | Remove debug logs |
| 🟢 P5 | 6B | Type AI request bodies |

---

## Progress Tracker

- [x] Step 0 — Feature branch created (`feature/improvements`)
- [x] Step 1 — Upstream changes synced (cherry-picked commits 261b550 + 97ad554)
- [x] Step 2A — Hardcoded model fix (`AIService.generateWithLocalModel` now accepts `modelId`)
- [x] Step 2B — Revision loop fix (now uses most recent prose result, not first)
- [ ] Step 2C — AbortController refactor *(deferred — lower priority)*
- [x] Step 2D — `local/` prefix stripped before sending to LMStudio
- [x] Step 3A — Scene beat persistence (`localStorage` via `saveSBDefaults` + `hydrateFromDefaults`)
- [x] Step 3B — Init dedup (`_initPromise` singleton guard in `useAIStore`)
- [x] Step 4A — Debounce flush on unmount (`saveContent.flush()` instead of cancel)
- [x] Step 4B — Save indicator in StoryEditor sidebar (`saving…` / `Saved ✓`)
- [ ] Step 4C — Auto-save pipeline output as draft *(deferred)*
- [ ] Step 5A — Store original message in AgentResult metadata *(deferred)*
- [ ] Step 5C — Pipeline progress enrichment *(deferred)*
- [x] Step 6A — Debug logs removed from `promptParser.ts`
- [ ] Step 6B — Type request bodies *(deferred)*
- [x] Step 6C — Streaming state always reset on agentic error/complete
- [ ] Step 7 — Manual testing complete *(pending)*
