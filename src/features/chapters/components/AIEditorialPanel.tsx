/**
 * AIEditorialPanel — the top-level "AI Editorial" sheet panel.
 * Provides two modes via tabs:
 *   Review — editorial feedback on the chapter (uses ChapterReviewPanel)
 *   Edit   — produces a fully rewritten chapter using the chapter_editor role
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCopy, FileEdit, FileSearch, Loader2, RotateCcw, SquareX } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChapterReviewPanel } from '@/features/chapters/components/ChapterReviewPanel';
import { useStoryContext } from '@/features/stories/context/StoryContext';
import { useChapterStore } from '@/features/chapters/stores/useChapterStore';
import { useLorebookStore } from '@/features/lorebook/stores/useLorebookStore';
import { useAgenticGeneration } from '@/features/agents/hooks/useAgenticGeneration';
import type { PipelinePreset } from '@/types/story';
import { toast } from 'react-toastify';

// ---------------------------------------------------------------------------
// Inner component: chapter edit mode
// ---------------------------------------------------------------------------
function ChapterEditContent() {
    const { currentChapterId } = useStoryContext();
    const { currentChapter, getChapterPlainText } = useChapterStore();
    const { entries: lorebookEntries } = useLorebookStore();

    const {
        isGenerating,
        currentAgentName,
        stepResults,
        generateWithPipeline,
        abortGeneration,
        getAvailablePipelines,
    } = useAgenticGeneration();

    const [pipelines, setPipelines] = useState<PipelinePreset[]>([]);
    const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
    const [editInstructions, setEditInstructions] = useState('');
    const [streamedOutput, setStreamedOutput] = useState('');
    const [finalOutput, setFinalOutput] = useState('');
    const [hasRun, setHasRun] = useState(false);
    const outputRef = useRef<HTMLDivElement>(null);

    // Load pipelines — prefer edit-oriented ones
    useEffect(() => {
        getAvailablePipelines().then((all) => {
            setPipelines(all);
            const editPipeline = all.find(
                (p) =>
                    p.name.toLowerCase() === 'chapter edit' ||
                    p.name.toLowerCase().includes('chapter edit')
            );
            if (editPipeline) {
                setSelectedPipelineId(editPipeline.id);
            } else if (all.length > 0) {
                setSelectedPipelineId(all[0].id);
            }
        });
    }, [getAvailablePipelines]);

    // Auto-scroll output as tokens arrive
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [streamedOutput]);

    const handleRun = useCallback(async () => {
        if (!currentChapterId || !selectedPipelineId) {
            toast.error('No chapter or pipeline selected');
            return;
        }

        let chapterText = '';
        try {
            chapterText = await getChapterPlainText(currentChapterId);
        } catch {
            toast.error('Failed to extract chapter text');
            return;
        }

        if (!chapterText.trim()) {
            toast.error('The chapter appears to be empty — nothing to edit');
            return;
        }

        setStreamedOutput('');
        setFinalOutput('');
        setHasRun(true);

        await generateWithPipeline(
            selectedPipelineId,
            {
                scenebeat: editInstructions,
                previousWords: chapterText,
                matchedEntries: lorebookEntries,
                allEntries: lorebookEntries,
                povType: currentChapter?.povType,
                povCharacter: currentChapter?.povCharacter,
                currentChapter: currentChapter ?? undefined,
            },
            {
                onToken: (token) => {
                    setStreamedOutput((prev) => prev + token);
                },
                onComplete: (r) => {
                    setFinalOutput(r.finalOutput);
                    setStreamedOutput('');
                },
                onError: (err) => {
                    toast.error(`Edit failed: ${err.message}`);
                },
            }
        );
    }, [
        currentChapterId,
        selectedPipelineId,
        editInstructions,
        getChapterPlainText,
        lorebookEntries,
        currentChapter,
        generateWithPipeline,
    ]);

    const handleCopy = async () => {
        const text = finalOutput || streamedOutput;
        try {
            await navigator.clipboard.writeText(text);
            toast.success('Edited chapter copied to clipboard');
        } catch {
            toast.error('Failed to copy');
        }
    };

    const handleReset = () => {
        setStreamedOutput('');
        setFinalOutput('');
        setHasRun(false);
    };

    const displayOutput = finalOutput || streamedOutput;

    return (
        <div className="flex flex-col gap-4 pt-2">
            {/* Pipeline selector */}
            <div className="space-y-1">
                <Label htmlFor="chapter-edit-pipeline">Pipeline</Label>
                <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId} disabled={isGenerating}>
                    <SelectTrigger id="chapter-edit-pipeline">
                        <SelectValue placeholder="Select a pipeline…" />
                    </SelectTrigger>
                    <SelectContent>
                        {pipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                {p.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {pipelines.find((p) => p.id === selectedPipelineId)?.description && (
                    <p className="text-xs text-muted-foreground">
                        {pipelines.find((p) => p.id === selectedPipelineId)!.description}
                    </p>
                )}
            </div>

            {/* Optional editing instructions */}
            <div className="space-y-1">
                <Label htmlFor="chapter-edit-instructions">Edit Instructions (optional)</Label>
                <Textarea
                    id="chapter-edit-instructions"
                    placeholder="e.g. Tighten the pacing in the middle section. Make the dialogue punchier. Fix the transition into the final scene…"
                    rows={3}
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    disabled={isGenerating}
                    className="resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground">
                    Leave blank for a general editorial pass.
                </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
                {!isGenerating ? (
                    <Button
                        onClick={handleRun}
                        disabled={!selectedPipelineId || !currentChapterId}
                        className="flex-1"
                    >
                        <FileEdit className="h-4 w-4 mr-2" />
                        {hasRun ? 'Edit Again' : 'Edit Chapter'}
                    </Button>
                ) : (
                    <Button variant="destructive" onClick={abortGeneration} className="flex-1">
                        <SquareX className="h-4 w-4 mr-2" />
                        Stop
                    </Button>
                )}
                {hasRun && !isGenerating && (
                    <Button variant="outline" size="icon" onClick={handleReset} title="Clear results">
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Progress indicator */}
            {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{currentAgentName ? `Running: ${currentAgentName}` : 'Starting…'}</span>
                </div>
            )}

            {/* Output */}
            {(displayOutput || isGenerating) && (
                <div className="space-y-2">
                    {/* Instruction notice */}
                    {(finalOutput || (!isGenerating && displayOutput)) && (
                        <Alert>
                            <AlertDescription className="text-xs">
                                This is the AI-edited chapter. Copy it and paste it into the editor to apply the changes.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Edited Chapter</span>
                        {displayOutput && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={handleCopy}
                            >
                                <ClipboardCopy className="h-3 w-3" />
                                Copy All
                            </Button>
                        )}
                    </div>

                    <div
                        ref={outputRef}
                        className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-[55vh] overflow-y-auto leading-relaxed"
                    >
                        {displayOutput || (
                            <span className="text-muted-foreground italic">Generating edited chapter…</span>
                        )}
                        {isGenerating && (
                            <span className="inline-block w-1 h-4 bg-primary ml-0.5 animate-pulse" />
                        )}
                    </div>

                    {!isGenerating && stepResults.length > 0 && (
                        <p className="text-xs text-muted-foreground text-center">
                            {stepResults.length} agent step{stepResults.length !== 1 ? 's' : ''} completed
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Public export: the outer tabbed panel
// ---------------------------------------------------------------------------
export function AIEditorialPanel() {
    return (
        <Tabs defaultValue="review" className="w-full">
            <TabsList className="w-full">
                <TabsTrigger value="review" className="flex-1 gap-1.5">
                    <FileSearch className="h-3.5 w-3.5" />
                    Review
                </TabsTrigger>
                <TabsTrigger value="edit" className="flex-1 gap-1.5">
                    <FileEdit className="h-3.5 w-3.5" />
                    Edit
                </TabsTrigger>
            </TabsList>

            <TabsContent value="review" className="mt-3">
                <ChapterReviewPanel />
            </TabsContent>

            <TabsContent value="edit" className="mt-3">
                <ChapterEditContent />
            </TabsContent>
        </Tabs>
    );
}
