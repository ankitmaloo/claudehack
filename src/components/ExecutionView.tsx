"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import {
  Bot,
  CheckCircle,
  ChevronRight,
  Loader2,
  FileText,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { SSEEvent, TaskStatus, SubagentStartEvent, SubagentChunkEvent, SubagentEndEvent, VerificationEvent, AnswerEvent, BriefEvent } from "@/types";

interface ExecutionViewProps {
  events: SSEEvent[];
  status: TaskStatus;
}

// Step types based on new API event types
type StepType = "brief" | "subagent" | "verification" | "answer";

// Subagent pair: instruction + response
interface SubagentPair {
  subagentId: string;
  instruction: string;
  response?: string;
}

// Brief pair: instruction + content, keyed by brief_index
interface BriefPair {
  briefIndex: number;
  instruction: string;
  content?: string;
}

// Grouped step containing multiple events of the same type
interface GroupedStep {
  id: string;
  type: StepType;
  label: string;
  events: Array<{ content: string; subagentId?: string; attempt?: number; isError?: boolean }>;
  subagentPairs?: SubagentPair[];
  briefPairs?: BriefPair[];
}

// Get content from event based on type
function getEventContent(event: SSEEvent): string {
  switch (event.type) {
    case 'brief':
      return (event as BriefEvent).content;
    case 'subagent_start':
      return `**Instruction:** ${(event as SubagentStartEvent).instruction}`;
    case 'verification':
      const v = event as VerificationEvent;
      return `**Answer:** ${v.answer}\n\n**Result:** ${v.result}`;
    case 'answer':
      return (event as AnswerEvent).content;
    default:
      return '';
  }
}

// Map event to step type
function detectStepType(event: SSEEvent): StepType | null {
  switch (event.type) {
    case 'brief_start':
    case 'brief_chunk':
    case 'brief':
      return 'brief';
    case 'subagent_start':
    case 'subagent_chunk':
    case 'subagent_end':
      return 'subagent';
    case 'verification_chunk':
    case 'verification':
      return 'verification';
    case 'answer':
      return 'answer';
    default:
      return null;
  }
}

// Get label for step type
function getStepLabel(type: StepType, count: number): string {
  switch (type) {
    case "brief":
      return count > 1 ? `Briefs (${count})` : "Brief";
    case "subagent":
      return count > 1 ? `Research (${count})` : "Research";
    case "verification":
      return count > 1 ? `Verification (${count})` : "Verification";
    case "answer":
      return "Final Answer";
    default:
      return "Step";
  }
}

// Refined animated dot loader
function EditorialLoader() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Loading">
      <span className="animate-[pulse_1.4s_ease-in-out_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
      <span className="animate-[pulse_1.4s_ease-in-out_0.2s_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
      <span className="animate-[pulse_1.4s_ease-in-out_0.4s_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
    </span>
  );
}

// Get status message based on TaskStatus
function getStatusMessage(status: TaskStatus): string {
  switch (status) {
    case "planning":
      return "Planning your task";
    case "executing":
      return "Working on your task";
    case "completed":
      return "Task completed";
    case "error":
      return "An error occurred";
    default:
      return "Ready";
  }
}

// Step configuration with icons and colors
const stepConfig: Record<StepType, { icon: typeof Bot; color: string }> = {
  brief: { icon: FileText, color: "text-blue-500" },
  subagent: { icon: Bot, color: "text-violet-500" },
  verification: { icon: AlertCircle, color: "text-amber-500" },
  answer: { icon: CheckCircle, color: "text-emerald-500" },
};

// Process events into grouped steps by type
function processEventsToGroupedSteps(events: SSEEvent[]): GroupedStep[] {
  const groups: Record<StepType, GroupedStep['events']> = {
    brief: [],
    subagent: [],
    verification: [],
    answer: [],
  };

  // Track subagent pairs by ID
  const subagentMap = new Map<string, SubagentPair>();

  // Track brief pairs by brief_index
  const briefMap = new Map<number, BriefPair>();

  // Track verification streaming: accumulate verification_chunk content
  let verificationChunkBuffer = '';
  let hasFinalVerification = false;

  // Group events by type
  for (const event of events) {
    const stepType = detectStepType(event);
    if (!stepType) continue;

    // brief_start: create pair with instruction
    if (event.type === 'brief_start') {
      const e = event as import('@/types').BriefStartEvent;
      briefMap.set(e.brief_index, {
        briefIndex: e.brief_index,
        instruction: e.instruction || '',
      });
      continue;
    }

    // brief_chunk: accumulate streaming content into pair
    if (event.type === 'brief_chunk') {
      const chunk = event as import('@/types').BriefChunkEvent;
      const existing = briefMap.get(chunk.brief_index);
      if (existing) {
        existing.content = (existing.content || '') + chunk.content;
      } else {
        briefMap.set(chunk.brief_index, {
          briefIndex: chunk.brief_index,
          instruction: '',
          content: chunk.content,
        });
      }
      continue;
    }

    // brief (complete): set final content on pair
    if (event.type === 'brief') {
      const e = event as import('@/types').BriefEvent;
      const idx = e.index ?? 1;
      const existing = briefMap.get(idx);
      if (existing) {
        existing.content = e.content;
      } else {
        briefMap.set(idx, {
          briefIndex: idx,
          instruction: '',
          content: e.content,
        });
      }
      continue;
    }

    // Handle subagent events specially to create pairs
    if (event.type === 'subagent_start') {
      const startEvent = event as SubagentStartEvent;
      const id = String(startEvent.subagent_id);
      subagentMap.set(id, {
        subagentId: id,
        instruction: startEvent.instruction,
      });
      continue;
    }

    // Accumulate subagent_chunk content into the pair's response
    if (event.type === 'subagent_chunk') {
      const chunkEvent = event as SubagentChunkEvent;
      const id = String(chunkEvent.subagent_id);
      const existing = subagentMap.get(id);
      if (existing) {
        existing.response = (existing.response || '') + chunkEvent.content;
      } else {
        subagentMap.set(id, {
          subagentId: id,
          instruction: '',
          response: chunkEvent.content,
        });
      }
      continue;
    }

    // subagent_end signals completion (no payload beyond subagent_id)
    if (event.type === 'subagent_end') {
      const endEvent = event as SubagentEndEvent;
      const id = String(endEvent.subagent_id);
      if (!subagentMap.has(id)) {
        subagentMap.set(id, { subagentId: id, instruction: '' });
      }
      continue;
    }

    // verification_chunk: accumulate streaming verifier output
    if (event.type === 'verification_chunk') {
      verificationChunkBuffer += (event as import('@/types').VerificationChunkEvent).content;
      continue;
    }

    // verification (complete): mark final arrived, reset chunk buffer for next attempt
    if (event.type === 'verification') {
      hasFinalVerification = true;
      verificationChunkBuffer = '';
    }

    const content = getEventContent(event);
    if (!content) continue;

    const eventData: GroupedStep['events'][0] = { content };

    if (event.type === 'verification') {
      eventData.attempt = (event as VerificationEvent).attempt;
      eventData.isError = (event as VerificationEvent).is_error;
    }

    groups[stepType].push(eventData);
  }

  // If verification is still streaming, show accumulated chunks as in-progress
  if (!hasFinalVerification && verificationChunkBuffer) {
    groups.verification.push({ content: `**Verifying...**\n\n${verificationChunkBuffer}` });
  }

  // Convert to ordered array
  const stepOrder: StepType[] = ["brief", "subagent", "verification", "answer"];
  const result: GroupedStep[] = [];

  for (const type of stepOrder) {
    if (type === 'brief' && briefMap.size > 0) {
      const briefPairs = Array.from(briefMap.values()).sort((a, b) => a.briefIndex - b.briefIndex);
      result.push({
        id: type,
        type,
        label: getStepLabel(type, briefPairs.length),
        events: [],
        briefPairs,
      });
    } else if (type === 'subagent' && subagentMap.size > 0) {
      const subagentPairs = Array.from(subagentMap.values()).sort((a, b) => String(a.subagentId).localeCompare(String(b.subagentId)));
      result.push({
        id: type,
        type,
        label: getStepLabel(type, subagentPairs.length),
        events: [],
        subagentPairs,
      });
    } else if (groups[type].length > 0) {
      result.push({
        id: type,
        type,
        label: getStepLabel(type, groups[type].length),
        events: groups[type],
      });
    }
  }

  return result;
}

interface GroupedStepItemProps {
  step: GroupedStep;
  isOpen: boolean;
  onToggle: () => void;
}

// Individual subagent item with instruction visible and output collapsible
function SubagentItem({ pair, isOutputOpen, onToggleOutput }: {
  pair: SubagentPair;
  isOutputOpen: boolean;
  onToggleOutput: () => void;
}) {
  return (
    <div className="rounded-lg border border-violet-200/50 dark:border-violet-800/30 bg-violet-50/30 dark:bg-violet-950/20 overflow-hidden">
      {/* Header with subagent ID */}
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-100/50 dark:bg-violet-900/30 border-b border-violet-200/50 dark:border-violet-800/30">
        <span className="text-sm font-medium font-mono text-violet-700 dark:text-violet-300">
          {pair.subagentId}
        </span>
      </div>

      {/* Instruction - always visible */}
      <div className="px-3 py-3 border-b border-violet-200/30 dark:border-violet-800/20">
        <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Instruction</p>
        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
          <Markdown>{pair.instruction}</Markdown>
        </div>
      </div>

      {/* Output - collapsible */}
      {pair.response && (
        <Collapsible open={isOutputOpen} onOpenChange={onToggleOutput}>
          <CollapsibleTrigger asChild>
            <div className={cn(
              "flex items-center justify-between px-3 py-2 cursor-pointer select-none",
              "hover:bg-violet-100/30 dark:hover:bg-violet-900/20 transition-colors",
              isOutputOpen && "bg-violet-100/20 dark:bg-violet-900/10"
            )}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Output</p>
              <ChevronRight className={cn(
                "h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
                isOutputOpen && "rotate-90"
              )} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 bg-white/50 dark:bg-black/20 rounded-md p-3">
                <Markdown>{pair.response}</Markdown>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Loading state if no response yet */}
      {!pair.response && (
        <div className="px-3 py-2 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-xs">Waiting for output...</span>
        </div>
      )}
    </div>
  );
}

// Individual brief item with instruction visible and content collapsible
function BriefItem({ pair, isContentOpen, onToggleContent }: {
  pair: BriefPair;
  isContentOpen: boolean;
  onToggleContent: () => void;
}) {
  return (
    <div className="rounded-lg border border-blue-200/50 dark:border-blue-800/30 bg-blue-50/30 dark:bg-blue-950/20 overflow-hidden">
      {/* Header with brief index */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-100/50 dark:bg-blue-900/30 border-b border-blue-200/50 dark:border-blue-800/30">
        <span className="text-sm font-medium font-mono text-blue-700 dark:text-blue-300">
          Brief {pair.briefIndex}
        </span>
      </div>

      {/* Instruction - always visible */}
      {pair.instruction && (
        <div className="px-3 py-3 border-b border-blue-200/30 dark:border-blue-800/20">
          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Instruction</p>
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
            <Markdown>{pair.instruction}</Markdown>
          </div>
        </div>
      )}

      {/* Content - collapsible */}
      {pair.content && (
        <Collapsible open={isContentOpen} onOpenChange={onToggleContent}>
          <CollapsibleTrigger asChild>
            <div className={cn(
              "flex items-center justify-between px-3 py-2 cursor-pointer select-none",
              "hover:bg-blue-100/30 dark:hover:bg-blue-900/20 transition-colors",
              isContentOpen && "bg-blue-100/20 dark:bg-blue-900/10"
            )}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Brief</p>
              <ChevronRight className={cn(
                "h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
                isContentOpen && "rotate-90"
              )} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 bg-white/50 dark:bg-black/20 rounded-md p-3">
                <Markdown>{pair.content}</Markdown>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Loading state if no content yet */}
      {!pair.content && (
        <div className="px-3 py-2 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-xs">Writing brief...</span>
        </div>
      )}
    </div>
  );
}

function GroupedStepItem({ step, isOpen, onToggle }: GroupedStepItemProps) {
  const config = stepConfig[step.type];
  const Icon = config.icon;
  const hasMultiple = step.events.length > 1;
  const isSubagentStep = step.type === 'subagent' && step.subagentPairs && step.subagentPairs.length > 0;
  const isBriefStep = step.type === 'brief' && step.briefPairs && step.briefPairs.length > 0;

  // Track which subagent outputs are expanded
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set());

  const toggleOutput = (subagentId: string) => {
    setExpandedOutputs(prev => {
      const next = new Set(prev);
      if (next.has(subagentId)) {
        next.delete(subagentId);
      } else {
        next.add(subagentId);
      }
      return next;
    });
  };

  // Preview shows first item's content, truncated
  const previewContent = isSubagentStep
    ? step.subagentPairs![0]?.instruction || ""
    : isBriefStep
    ? step.briefPairs![0]?.instruction || step.briefPairs![0]?.content || ""
    : step.events[0]?.content || "";
  const truncatedPreview = previewContent.length > 200
    ? previewContent.slice(0, 200) + '...'
    : previewContent;
  const itemCount = isBriefStep ? step.briefPairs!.length : isSubagentStep ? step.subagentPairs!.length : step.events.length;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <Card
        className={cn(
          "border-border/50 shadow-sm transition-all duration-200",
          "bg-card/60 backdrop-blur-sm",
          isOpen && "shadow-md border-border/70"
        )}
      >
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "cursor-pointer select-none p-3",
              "hover:bg-muted/20 transition-colors duration-150",
              "flex items-start gap-3"
            )}
          >
            {/* Icon */}
            <div className={cn("mt-0.5 shrink-0", config.color)}>
              <Icon className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm text-foreground">
                  {step.label}
                </span>
              </div>
              {!isOpen && (
                <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground line-clamp-3">
                  <Markdown>{truncatedPreview}</Markdown>
                  {itemCount > 1 && (
                    <p className="text-xs text-muted-foreground/60 mt-2 italic">
                      + {itemCount - 1} more...
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Expand indicator */}
            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 mt-0.5",
                isOpen && "rotate-90"
              )}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent
          className={cn(
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "duration-200"
          )}
        >
          <CardContent className="pt-0 pb-4 px-3">
            <div className="pl-7 border-l-2 border-border/40 ml-2">
              {isBriefStep ? (
                <div className="space-y-3">
                  {step.briefPairs!.map((pair) => (
                    <BriefItem
                      key={pair.briefIndex}
                      pair={pair}
                      isContentOpen={expandedOutputs.has(String(pair.briefIndex))}
                      onToggleContent={() => toggleOutput(String(pair.briefIndex))}
                    />
                  ))}
                </div>
              ) : isSubagentStep ? (
                <div className="space-y-3">
                  {step.subagentPairs!.map((pair) => (
                    <SubagentItem
                      key={pair.subagentId}
                      pair={pair}
                      isOutputOpen={expandedOutputs.has(pair.subagentId)}
                      onToggleOutput={() => toggleOutput(pair.subagentId)}
                    />
                  ))}
                </div>
              ) : hasMultiple ? (
                <div className="space-y-4">
                  {step.events.map((event, idx) => (
                    <div key={idx}>
                      {event.attempt !== undefined && (
                        <p className={cn(
                          "text-xs mb-1",
                          event.isError ? "text-destructive" : "text-muted-foreground"
                        )}>
                          Attempt #{event.attempt} {event.isError && "(Error)"}
                        </p>
                      )}
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Markdown>{event.content}</Markdown>
                      </div>
                      {idx < step.events.length - 1 && (
                        <hr className="my-4 border-border/40" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{previewContent}</Markdown>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Extract combined thinking + model output from events
function extractOrchestratorOutput(events: SSEEvent[]): string {
  let output = '';
  for (const event of events) {
    if (event.type === 'thinking_chunk' || event.type === 'model_chunk') {
      output += (event as { content: string }).content;
    }
  }
  return output;
}

export function ExecutionView({ events, status }: ExecutionViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Process events into grouped steps by type
  const groupedSteps = useMemo(() => processEventsToGroupedSteps(events), [events]);

  // Combined orchestrator reasoning (thinking + model output)
  const orchestratorOutput = useMemo(() => extractOrchestratorOutput(events), [events]);

  // Track which steps are expanded
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Auto-scroll container when new events arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events.length]);

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const isActive = status === "planning" || status === "executing";
  const hasSteps = groupedSteps.length > 0;

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 p-4"
      data-slot="execution-view"
    >
      {/* Status Line + Orchestrator Thinking */}
      <div
        className={cn(
          "rounded-lg",
          "bg-muted/40 border border-border/40",
          "transition-all duration-300"
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {isActive ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
          ) : status === "completed" ? (
            <div className="h-4 w-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          ) : status === "error" ? (
            <div className="h-4 w-4 rounded-full bg-destructive/20 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-destructive" />
            </div>
          ) : (
            <div className="h-4 w-4 rounded-full bg-muted-foreground/20 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
            </div>
          )}

          <span className="font-serif text-sm font-medium tracking-tight text-foreground/90">
            {getStatusMessage(status)}
          </span>

          {isActive && (
            <span className="ml-auto text-muted-foreground/60">
              <EditorialLoader />
            </span>
          )}
        </div>

        {/* Streaming orchestrator thinking */}
        {orchestratorOutput && isActive && (
          <div className="px-4 pb-3 pt-0">
            <div className="text-sm text-foreground/70 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">
              {orchestratorOutput}
            </div>
          </div>
        )}
      </div>

      {/* Grouped Steps List */}
      {hasSteps && (
        <div className="flex flex-col gap-2">
          {groupedSteps.map((step) => (
            <GroupedStepItem
              key={step.id}
              step={step}
              isOpen={expandedSteps.has(step.id)}
              onToggle={() => toggleStep(step.id)}
            />
          ))}
        </div>
      )}

      {/* Empty State - Idle */}
      {!hasSteps && status === "idle" && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="font-serif text-sm text-muted-foreground/60 italic">
            Execution steps will appear here...
          </p>
        </div>
      )}

      {/* Empty State - Executing (waiting for first event) */}
      {!hasSteps && isActive && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="font-serif text-sm italic">
              Preparing execution steps...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ExecutionView;
