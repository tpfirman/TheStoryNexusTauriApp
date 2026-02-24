/**
 * ChapterReviewPanel — runs an AI agent pipeline against the full text of the current chapter
 * to produce editorial feedback. Uses the existing agentic generation infrastructure.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Copy, FileSearch, Loader2, RotateCcw, SquareX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useStoryContext } from '@/features/stories/context/StoryContext';
import { useChapterStore } from '@/features/chapters/stores/useChapterStore';
import { useLorebookStore } from '@/features/lorebook/stores/useLorebookStore';
import { useAgenticGeneration } from '@/features/agents/hooks/useAgenticGeneration';
import type { PipelinePreset } from '@/types/story';
import { toast } from 'react-toastify';

export function ChapterReviewPanel() {
    const { currentChapterId, currentStoryId } = useStoryContext();
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
    const [reviewFocus, setReviewFocus] = useState('');
    const [streamedOutput, setStreamedOutput] = useState('');
    const [finalOutput, setFinalOutput] = useState('');
    const [hasRun, setHasRun] = useState(false);
    const [additionalResults, setAdditionalResults] = useState<{ agentName: string; output: string }[]>([]);
    const outputRef = useRef<HTMLDivElement>(null);

    // Load pipelines on mount
    useEffect(() => {
        getAvailablePipelines().then((all) => {
            setPipelines(all);
            // Default to "Chapter Review" pipeline if available, otherwise first pipeline
            const reviewPipeline = all.find(
                (p) => p.name.toLowerCase().includes('chapter review') || p.name.toLowerCase().includes('chapter deep review')
            );
            if (reviewPipeline) {
                setSelectedPipelineId(reviewPipeline.id);
            } else if (all.length > 0) {
                setSelectedPipelineId(all[0].id);
            }
        });
    }, [getAvailablePipelines]);

    // Scroll output to bottom when streaming
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

        // Grab full plain text of the chapter
        let chapterText = '';
        try {
            chapterText = await getChapterPlainText(currentChapterId);
        } catch {
            toast.error('Failed to extract chapter text');
            return;
        }

        if (!chapterText.trim()) {
            toast.error('The chapter appears to be empty — nothing to review');
            return;
        }

        setStreamedOutput('');
        setFinalOutput('');
        setAdditionalResults([]);
        setHasRun(true);

        const result = await generateWithPipeline(
            selectedPipelineId,
            {
                scenebeat: reviewFocus,
                // Full chapter text is the primary input for the reviewer
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
                onStepComplete: (stepResult) => {
                    // Capture non-streaming step outputs (e.g. lore_judge, continuity_checker)
                    if (stepResult.role !== 'chapter_reviewer') {
                        setAdditionalResults((prev) => [
                            ...prev,
                            { agentName: stepResult.agentName, output: stepResult.output },
                        ]);
                    }
                },
                onComplete: (r) => {
                    setFinalOutput(r.finalOutput);
                    setStreamedOutput('');
                },
                onError: (err) => {
                    toast.error(`Review failed: ${err.message}`);
                },
            }
        );

        if (!result) return;
    }, [
        currentChapterId,
        selectedPipelineId,
        reviewFocus,
        getChapterPlainText,
        lorebookEntries,
        currentChapter,
        generateWithPipeline,
    ]);

    const handleCopy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success('Copied to clipboard');
        } catch {
            toast.error('Failed to copy');
        }
    };

    const handleReset = () => {
        setStreamedOutput('');
        setFinalOutput('');
        setAdditionalResults([]);
        setHasRun(false);
    };

    const displayOutput = finalOutput || streamedOutput;

    return (
        <div className="flex flex-col gap-4 pt-2">
            {/* Pipeline selector */}
            <div className="space-y-1">
                <Label htmlFor="chapter-review-pipeline">Pipeline</Label>
                <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId} disabled={isGenerating}>
                    <SelectTrigger id="chapter-review-pipeline">
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

            {/* Optional focus instructions */}
            <div className="space-y-1">
                <Label htmlFor="chapter-review-focus">Review Focus (optional)</Label>
                <Textarea
                    id="chapter-review-focus"
                    placeholder="e.g. Focus on dialogue consistency and pacing in the second half…"
                    rows={3}
                    value={reviewFocus}
                    onChange={(e) => setReviewFocus(e.target.value)}
                    disabled={isGenerating}
                    className="resize-none text-sm"
                />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
                {!isGenerating ? (
                    <Button
                        onClick={handleRun}
                        disabled={!selectedPipelineId || !currentChapterId}
                        className="flex-1"
                    >
                        <FileSearch className="h-4 w-4 mr-2" />
                        {hasRun ? 'Run Again' : 'Review Chapter'}
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
                    <span>
                        {currentAgentName ? `Running: ${currentAgentName}` : 'Starting…'}
                    </span>
                </div>
            )}

            {/* Streaming / final review output */}
            {(displayOutput || isGenerating) && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-sm font-medium">
                            <Bot className="h-4 w-4" />
                            Review
                        </div>
                        {displayOutput && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleCopy(displayOutput)}
                                title="Copy review"
                            >
                                <Copy className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                    <div
                        ref={outputRef}
                        className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-[50vh] overflow-y-auto leading-relaxed"
                    >
                        {displayOutput || (
                            <span className="text-muted-foreground italic">Generating review…</span>
                        )}
                        {isGenerating && (
                            <span className="inline-block w-1 h-4 bg-primary ml-0.5 animate-pulse" />
                        )}
                    </div>
                </div>
            )}

            {/* Additional agent outputs (lore judge, continuity checker, etc.) */}
            {additionalResults.length > 0 && (
                <div className="space-y-3">
                    {additionalResults.map((r, idx) => (
                        <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between">
                                <Badge variant="outline" className="text-xs">
                                    {r.agentName}
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => handleCopy(r.output)}
                                    title={`Copy ${r.agentName} output`}
                                >
                                    <Copy className="h-3 w-3" />
                                </Button>
                            </div>
                            <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap max-h-[30vh] overflow-y-auto leading-relaxed">
                                {r.output}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Completed step summary */}
            {!isGenerating && stepResults.length > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                    {stepResults.length} agent step{stepResults.length !== 1 ? 's' : ''} completed
                </p>
            )}
        </div>
    );
}
