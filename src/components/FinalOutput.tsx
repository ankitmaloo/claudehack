"use client"

import {
  CheckCircle2,
  Bot,
  Brain,
  ChevronRight,
  RefreshCw,
  Edit3,
  Copy,
  X,
  Download,
  GitBranch,
  RotateCcw,
  Plus,
  Share2,
  Check,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { saveAs } from "file-saver"
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx"
import { Markdown } from "@/components/ui/markdown"
import type { TaskResult, SSEEvent, SubagentStartEvent, SubagentChunkEvent, SubagentEndEvent, VerificationEvent, AnswerEvent, BriefEvent, ExecutionMode, BranchRef, BranchMetadata } from "@/types"
import { useState, useMemo } from "react"

// Download utilities
function downloadAsMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  saveAs(blob, filename.endsWith(".md") ? filename : `${filename}.md`)
}

async function downloadAsDocx(content: string, filename: string) {
  const lines = content.split("\n")
  const children: Paragraph[] = []

  for (const line of lines) {
    const trimmed = line.trimStart()

    // Headings
    if (trimmed.startsWith("### ")) {
      children.push(new Paragraph({
        text: trimmed.slice(4),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 120 },
      }))
    } else if (trimmed.startsWith("## ")) {
      children.push(new Paragraph({
        text: trimmed.slice(3),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
      }))
    } else if (trimmed.startsWith("# ")) {
      children.push(new Paragraph({
        text: trimmed.slice(2),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 480, after: 200 },
      }))
    }
    // Unordered list items
    else if (/^[-*]\s/.test(trimmed)) {
      children.push(new Paragraph({
        children: parseInlineFormatting(trimmed.slice(2)),
        bullet: { level: 0 },
      }))
    }
    // Ordered list items
    else if (/^\d+\.\s/.test(trimmed)) {
      children.push(new Paragraph({
        children: parseInlineFormatting(trimmed.replace(/^\d+\.\s/, "")),
        numbering: { reference: "default-numbering", level: 0 },
      }))
    }
    // Empty lines
    else if (trimmed === "") {
      children.push(new Paragraph({ text: "" }))
    }
    // Regular paragraphs
    else {
      children.push(new Paragraph({
        children: parseInlineFormatting(trimmed),
        spacing: { after: 120 },
      }))
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{
          level: 0,
          format: "decimal" as const,
          text: "%1.",
          alignment: AlignmentType.START,
        }],
      }],
    },
    sections: [{ children }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, filename.endsWith(".docx") ? filename : `${filename}.docx`)
}

// Parse bold/italic markdown inline formatting into TextRun elements
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }))
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }))
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }))
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: "Courier New", size: 20 }))
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6] }))
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })]
}

// Download dropdown component
function DownloadDropdown({ content, task }: { content: string; task: string }) {
  const filename = task
    .slice(0, 50)
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "document"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
          <Download className="h-4 w-4" />
          <span className="text-xs">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadAsMarkdown(content, filename)}>
          Download as Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadAsDocx(content, filename)}>
          Download as Word (.docx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Share popover component
function SharePopover({ onShare }: { onShare: () => Promise<string | null> }) {
  const [open, setOpen] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle')
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const handleClick = async () => {
    if (shareState === 'sharing') return
    setOpen(true)
    setShareState('sharing')
    setShareUrl(null)
    try {
      const url = await onShare()
      if (url) {
        setShareUrl(url)
        await navigator.clipboard.writeText(url)
        setShareState('copied')
      } else {
        setShareState('error')
      }
    } catch {
      setShareState('error')
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setOpen(false)
      setTimeout(() => {
        setShareState('idle')
        setShareUrl(null)
      }, 200)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClick}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Share2 className="h-4 w-4" />
          <span className="text-xs">Share</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        {shareState === 'sharing' && (
          <div className="flex items-center gap-2.5">
            <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
            <span className="text-sm text-muted-foreground">Creating share link...</span>
          </div>
        )}
        {shareState === 'copied' && shareUrl && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Link copied!</span>
            </div>
            <div className="p-2 bg-muted/50 rounded-md text-xs font-mono text-muted-foreground truncate">
              {shareUrl}
            </div>
          </div>
        )}
        {shareState === 'error' && (
          <div className="flex items-center gap-2 text-destructive">
            <X className="h-4 w-4 shrink-0" />
            <span className="text-sm">Failed to create link</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface FinalOutputProps {
  result: TaskResult
  events?: SSEEvent[]
  mode?: ExecutionMode
  onRework?: (feedback: string) => void
  onShare?: () => Promise<string | null>
  onAnotherVersion?: () => void
  onIterate?: (feedback: string) => void
  onSelectTake?: (take: string, continueMode: 'standard' | 'plan') => void
  onMixTakes?: (takes: string[], instructions: string, continueMode: 'standard' | 'plan') => void
  onBranchFromCheckpoint?: (checkpoint: {
    action: 'redo' | 'branch' | 'context'
    stepType: string
    events: SSEEvent[]
    feedback: string
  }) => void
  linkedVersions?: string[]
  activeVersionId?: string | null
  onSwitchVersion?: (linkedRunId: string | null) => void
  // Branch-specific props
  branches?: BranchRef[]
  activeBranchId?: string | null
  onSwitchBranch?: (branchRunId: string | null) => void
  branchMetadata?: BranchMetadata
  inheritedEventCount?: number
  showActions?: boolean
}

// Parse explore mode output into multiple takes
function parseExploreTakes(answer: string): string[] {
  const takes = answer.split(/\n===\n|\n===|\===\n/).map(t => t.trim()).filter(Boolean)
  return takes.length > 1 ? takes : [answer]
}

// Step types based on new API event types
type StepType = "brief" | "subagent" | "verification" | "answer"

// Subagent pair: instruction + response
interface SubagentPair {
  subagentId: string
  instruction: string
  response?: string
}

// Brief pair: instruction + content, keyed by brief_index
interface BriefPair {
  briefIndex: number
  instruction: string
  content?: string
}

// Grouped step containing multiple events of the same type
interface GroupedStep {
  id: string
  type: StepType
  label: string
  events: Array<{ content: string; subagentId?: string; attempt?: number; isError?: boolean }>
  subagentPairs?: SubagentPair[]
  briefPairs?: BriefPair[]
}

// Get content from event based on type
function getEventContent(event: SSEEvent): string {
  switch (event.type) {
    case 'brief':
      return (event as BriefEvent).content
    case 'subagent_start':
      return `**Instruction:** ${(event as SubagentStartEvent).instruction}`
    case 'verification':
      const v = event as VerificationEvent
      return `**Answer:** ${v.answer}\n\n**Result:** ${v.result}`
    case 'answer':
      return (event as AnswerEvent).content
    default:
      return ''
  }
}

// Map event to step type
function detectStepType(event: SSEEvent): StepType | null {
  switch (event.type) {
    case 'brief_start':
    case 'brief_chunk':
    case 'brief':
      return 'brief'
    case 'subagent_start':
    case 'subagent_chunk':
    case 'subagent_end':
      return 'subagent'
    case 'verification_chunk':
    case 'verification':
      return 'verification'
    case 'answer':
      return 'answer'
    default:
      return null
  }
}

// Get label for step type
function getStepLabel(type: StepType, count: number): string {
  switch (type) {
    case "brief":
      return count > 1 ? `Briefs (${count})` : "Brief"
    case "subagent":
      return count > 1 ? `Research (${count})` : "Research"
    case "verification":
      return count > 1 ? `Verification (${count})` : "Verification"
    case "answer":
      return "Final Answer"
    default:
      return "Step"
  }
}

// Step configuration with icons and colors
const stepConfig: Record<StepType, { icon: typeof Bot; color: string }> = {
  brief: { icon: Bot, color: "text-blue-500" },
  subagent: { icon: Bot, color: "text-violet-500" },
  verification: { icon: CheckCircle2, color: "text-amber-500" },
  answer: { icon: CheckCircle2, color: "text-emerald-500" },
}

// Process events into grouped steps by type
function processEventsToGroupedSteps(events: SSEEvent[]): GroupedStep[] {
  const groups: Record<StepType, GroupedStep['events']> = {
    brief: [],
    subagent: [],
    verification: [],
    answer: [],
  }

  // Track subagent pairs by ID
  const subagentMap = new Map<string, SubagentPair>()

  // Track brief pairs by brief_index
  const briefMap = new Map<number, BriefPair>()

  // Track verification streaming
  let verificationChunkBuffer = ''
  let hasFinalVerification = false

  for (const event of events) {
    const stepType = detectStepType(event)
    if (!stepType) continue

    // brief_start: create pair with instruction
    if (event.type === 'brief_start') {
      const e = event as import('@/types').BriefStartEvent
      briefMap.set(e.brief_index, {
        briefIndex: e.brief_index,
        instruction: e.instruction || '',
      })
      continue
    }

    // brief_chunk: accumulate streaming content into pair
    if (event.type === 'brief_chunk') {
      const chunk = event as import('@/types').BriefChunkEvent
      const existing = briefMap.get(chunk.brief_index)
      if (existing) {
        existing.content = (existing.content || '') + chunk.content
      } else {
        briefMap.set(chunk.brief_index, {
          briefIndex: chunk.brief_index,
          instruction: '',
          content: chunk.content,
        })
      }
      continue
    }

    // brief (complete): set final content on pair
    if (event.type === 'brief') {
      const e = event as import('@/types').BriefEvent
      const idx = e.index ?? 1
      const existing = briefMap.get(idx)
      if (existing) {
        existing.content = e.content
      } else {
        briefMap.set(idx, {
          briefIndex: idx,
          instruction: '',
          content: e.content,
        })
      }
      continue
    }

    // Handle subagent events specially to create pairs
    if (event.type === 'subagent_start') {
      const startEvent = event as SubagentStartEvent
      const id = String(startEvent.subagent_id)
      subagentMap.set(id, {
        subagentId: id,
        instruction: startEvent.instruction,
      })
      continue
    }

    // Accumulate subagent_chunk content into the pair's response
    if (event.type === 'subagent_chunk') {
      const chunkEvent = event as SubagentChunkEvent
      const id = String(chunkEvent.subagent_id)
      const existing = subagentMap.get(id)
      if (existing) {
        existing.response = (existing.response || '') + chunkEvent.content
      } else {
        subagentMap.set(id, {
          subagentId: id,
          instruction: '',
          response: chunkEvent.content,
        })
      }
      continue
    }

    // subagent_end signals completion (no payload beyond subagent_id)
    if (event.type === 'subagent_end') {
      const endEvent = event as SubagentEndEvent
      const id = String(endEvent.subagent_id)
      if (!subagentMap.has(id)) {
        subagentMap.set(id, { subagentId: id, instruction: '' })
      }
      continue
    }

    // verification_chunk: accumulate streaming verifier output
    if (event.type === 'verification_chunk') {
      verificationChunkBuffer += (event as import('@/types').VerificationChunkEvent).content
      continue
    }

    // verification (complete): mark final arrived, reset chunk buffer for next attempt
    if (event.type === 'verification') {
      hasFinalVerification = true
      verificationChunkBuffer = ''
    }

    const content = getEventContent(event)
    if (!content) continue

    const eventData: GroupedStep['events'][0] = { content }

    if (event.type === 'verification') {
      eventData.attempt = (event as VerificationEvent).attempt
      eventData.isError = (event as VerificationEvent).is_error
    }

    groups[stepType].push(eventData)
  }

  // If verification still streaming, show accumulated chunks as in-progress
  if (!hasFinalVerification && verificationChunkBuffer) {
    groups.verification.push({ content: `**Verifying...**\n\n${verificationChunkBuffer}` })
  }

  const stepOrder: StepType[] = ["brief", "subagent", "verification", "answer"]
  const result: GroupedStep[] = []

  for (const type of stepOrder) {
    if (type === 'brief' && briefMap.size > 0) {
      const briefPairs = Array.from(briefMap.values()).sort((a, b) => a.briefIndex - b.briefIndex)
      result.push({
        id: type,
        type,
        label: getStepLabel(type, briefPairs.length),
        events: [],
        briefPairs,
      })
    } else if (type === 'subagent' && subagentMap.size > 0) {
      const subagentPairs = Array.from(subagentMap.values()).sort((a, b) => String(a.subagentId).localeCompare(String(b.subagentId)))
      result.push({
        id: type,
        type,
        label: getStepLabel(type, subagentPairs.length),
        events: [],
        subagentPairs,
      })
    } else if (groups[type].length > 0) {
      result.push({
        id: type,
        type,
        label: getStepLabel(type, groups[type].length),
        events: groups[type],
      })
    }
  }

  return result
}

// Individual subagent item with instruction visible and output collapsible
function SubagentHistoryItem({ pair, isOutputOpen, onToggleOutput }: {
  pair: SubagentPair
  isOutputOpen: boolean
  onToggleOutput: () => void
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
    </div>
  )
}

// Individual brief history item with instruction visible and content collapsible
function BriefHistoryItem({ pair, isContentOpen, onToggleContent }: {
  pair: BriefPair
  isContentOpen: boolean
  onToggleContent: () => void
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
    </div>
  )
}

function HistoryStep({ step, isOpen, onToggle }: {
  step: GroupedStep
  isOpen: boolean
  onToggle: () => void
}) {
  const config = stepConfig[step.type]
  const Icon = config.icon
  const hasMultiple = step.events.length > 1
  const isSubagentStep = step.type === 'subagent' && step.subagentPairs && step.subagentPairs.length > 0
  const isBriefStep = step.type === 'brief' && step.briefPairs && step.briefPairs.length > 0

  // Track which outputs are expanded
  const [expandedOutputs, setExpandedOutputs] = useState<Set<string>>(new Set())

  const toggleOutput = (id: string) => {
    setExpandedOutputs(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const previewContent = isSubagentStep
    ? step.subagentPairs![0]?.instruction || ""
    : isBriefStep
    ? step.briefPairs![0]?.instruction || step.briefPairs![0]?.content || ""
    : step.events[0]?.content || ""
  const truncatedPreview = previewContent.length > 200
    ? previewContent.slice(0, 200) + '...'
    : previewContent
  const itemCount = isBriefStep ? step.briefPairs!.length : isSubagentStep ? step.subagentPairs!.length : step.events.length

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className={cn(
        "border-b border-border/40 last:border-b-0",
        isOpen && "bg-muted/20"
      )}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "cursor-pointer select-none p-3",
              "hover:bg-muted/30 transition-colors duration-150",
              "flex items-start gap-3"
            )}
          >
            <div className={cn("mt-0.5 shrink-0", config.color)}>
              <Icon className="h-4 w-4" />
            </div>

            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm text-foreground">
                {step.label}
              </span>
              {!isOpen && (
                <div className="mt-1 prose prose-sm dark:prose-invert max-w-none text-muted-foreground line-clamp-3">
                  <Markdown>{truncatedPreview}</Markdown>
                  {itemCount > 1 && (
                    <p className="text-xs text-muted-foreground/60 mt-2 italic">
                      + {itemCount - 1} more...
                    </p>
                  )}
                </div>
              )}
            </div>

            <ChevronRight
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 mt-0.5",
                isOpen && "rotate-90"
              )}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pb-4 px-3">
            <div className="pl-7 border-l-2 border-border/40 ml-2">
              {isBriefStep ? (
                <div className="space-y-3">
                  {step.briefPairs!.map((pair) => (
                    <BriefHistoryItem
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
                    <SubagentHistoryItem
                      key={pair.subagentId}
                      pair={pair}
                      isOutputOpen={expandedOutputs.has(pair.subagentId)}
                      onToggleOutput={() => toggleOutput(pair.subagentId)}
                    />
                  ))}
                </div>
              ) : hasMultiple ? (
                <div className="space-y-3">
                  {step.events.map((event, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/50 bg-muted/20 p-4"
                    >
                      {/* Header with attempt number */}
                      <div className="flex items-center gap-2 mb-3">
                        {event.attempt !== undefined && (
                          <>
                            <span className={cn(
                              "inline-flex items-center justify-center h-5 w-5 rounded-full text-xs font-medium",
                              event.isError
                                ? "bg-destructive/20 text-destructive"
                                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                            )}>
                              {event.attempt}
                            </span>
                            <span className={cn(
                              "text-sm font-medium",
                              event.isError ? "text-destructive" : "text-foreground/80"
                            )}>
                              Attempt #{event.attempt} {event.isError && "(Failed)"}
                            </span>
                          </>
                        )}
                      </div>
                      {/* Content */}
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Markdown>{event.content}</Markdown>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{previewContent}</Markdown>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// Branch navigator - shows branch pills with labels
function BranchNavigator({ branches, activeBranchId, onSwitchBranch, linkedVersions, activeVersionId, onSwitchVersion }: {
  branches?: BranchRef[]
  activeBranchId?: string | null
  onSwitchBranch?: (branchRunId: string | null) => void
  linkedVersions?: string[]
  activeVersionId?: string | null
  onSwitchVersion?: (linkedRunId: string | null) => void
}) {
  // Use branches if available, fall back to linkedVersions for pre-migration runs
  const hasBranches = branches && branches.length > 0
  const hasLinkedVersions = linkedVersions && linkedVersions.length > 0

  if (!hasBranches && !hasLinkedVersions) return null

  const switchHandler = onSwitchBranch || onSwitchVersion
  if (!switchHandler) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => switchHandler(null)}
        className={cn(
          "px-2.5 py-1 text-xs rounded-md transition-colors font-medium inline-flex items-center gap-1.5",
          !activeBranchId && !activeVersionId
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground hover:text-foreground"
        )}
      >
        Original
      </button>
      {hasBranches ? (
        branches!.map((branch) => {
          const isActive = activeBranchId === branch.runId || activeVersionId === branch.runId
          const truncatedLabel = branch.label
            ? branch.label.length > 30 ? branch.label.slice(0, 30) + '...' : branch.label
            : branch.branchType === 'fresh_take' ? 'Fresh Take' : 'Branch'
          return (
            <Tooltip key={branch.runId}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => switchHandler(branch.runId)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-md transition-colors font-medium inline-flex items-center gap-1.5",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <GitBranch className="h-3 w-3" />
                  {truncatedLabel}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  {branch.label && <p className="text-xs font-medium">{branch.label}</p>}
                  <p className="text-xs text-muted-foreground">
                    {branch.branchType === 'fresh_take' ? 'Fresh take' : `Branched from ${branch.checkpoint || 'checkpoint'}`}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })
      ) : (
        // Fallback to linkedVersions for pre-migration runs
        linkedVersions!.map((linkedRunId, idx) => (
          <button
            key={linkedRunId}
            onClick={() => switchHandler(linkedRunId)}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md transition-colors font-medium",
              activeVersionId === linkedRunId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            v{idx + 1}
          </button>
        ))
      )}
    </div>
  )
}

// Branch point separator in execution history
function BranchPointSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex-1 border-t border-dashed border-primary/40" />
      <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
        <GitBranch className="h-3 w-3" />
        <span>Branched: &ldquo;{label}&rdquo;</span>
      </div>
      <div className="flex-1 border-t border-dashed border-primary/40" />
    </div>
  )
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

function OrchestratorReasoning({ events }: { events: SSEEvent[] }) {
  const orchestratorOutput = useMemo(() => extractOrchestratorOutput(events), [events])
  const [open, setOpen] = useState(false)

  if (!orchestratorOutput) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/60 bg-card/50">
        <CollapsibleTrigger asChild>
          <div className={cn(
            "cursor-pointer select-none p-4",
            "hover:bg-muted/20 transition-colors duration-150",
            "flex items-center gap-3"
          )}>
            <Brain className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="font-medium text-sm text-foreground">
              Orchestrator Reasoning
            </span>
            <ChevronRight className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 ml-auto",
              open && "rotate-90"
            )} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4">
            <div className="pl-7 border-l-2 border-border/40 ml-2">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80">
                <Markdown>{orchestratorOutput}</Markdown>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

function ExecutionHistory({ events, onPickCheckpoint, branchMetadata, inheritedEventCount }: {
  events: SSEEvent[]
  onPickCheckpoint?: () => void
  branchMetadata?: BranchMetadata
  inheritedEventCount?: number
}) {
  const groupedSteps = useMemo(() => processEventsToGroupedSteps(events), [events])
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  if (groupedSteps.length === 0) return null

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) {
        next.delete(stepId)
      } else {
        next.add(stepId)
      }
      return next
    })
  }

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg font-medium tracking-tight">
            Execution Steps
          </h3>
          <div className="flex items-center gap-3">
            {onPickCheckpoint && (
              <button
                onClick={onPickCheckpoint}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <GitBranch className="h-3 w-3" />
                Run from checkpoint
              </button>
            )}
            <span className="text-sm text-muted-foreground">
              {groupedSteps.length} steps
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-0">
        <div className="max-h-[500px] overflow-y-auto">
          {/* Compute which steps are inherited vs new for branch display */}
          {(() => {
            // Track cumulative event count per step to find the branch point
            let cumulativeEvents = 0
            const stepEventCounts: number[] = []
            for (const step of groupedSteps) {
              const count = step.subagentPairs?.length || step.events.length || 1
              stepEventCounts.push(count)
            }

            let branchInserted = false
            const hasBranchPoint = branchMetadata && inheritedEventCount && inheritedEventCount > 0

            return groupedSteps.map((step, idx) => {
              const stepCount = stepEventCounts[idx]
              const prevCumulative = cumulativeEvents
              cumulativeEvents += stepCount

              // Determine if we need to insert a branch separator before this step
              const showSeparator = hasBranchPoint && !branchInserted && prevCumulative >= (inheritedEventCount || 0)
              if (showSeparator) branchInserted = true

              // Is this step inherited (before branch point)?
              const isInherited = hasBranchPoint && !branchInserted && cumulativeEvents <= (inheritedEventCount || 0)

              return (
                <div key={step.id} className={isInherited ? "opacity-50" : ""}>
                  {showSeparator && (
                    <BranchPointSeparator
                      label={branchMetadata?.feedback || branchMetadata?.action || 'new direction'}
                    />
                  )}
                  <HistoryStep
                    step={step}
                    isOpen={expandedSteps.has(step.id)}
                    onToggle={() => toggleStep(step.id)}
                  />
                </div>
              )
            })
          })()}
        </div>
      </CardContent>
    </Card>
  )
}

export function FinalOutput({
  result,
  events = [],
  mode = 'standard',
  onRework,
  onShare,
  onAnotherVersion,
  onIterate,
  onSelectTake,
  onMixTakes,
  onBranchFromCheckpoint,
  linkedVersions,
  activeVersionId,
  onSwitchVersion,
  branches,
  activeBranchId,
  onSwitchBranch,
  branchMetadata,
  inheritedEventCount,
  showActions = true,
}: FinalOutputProps) {
  const [showIterateInput, setShowIterateInput] = useState(false)
  const [iterateFeedback, setIterateFeedback] = useState("")
  const [showRedoInput, setShowRedoInput] = useState(false)
  const [redoFeedback, setRedoFeedback] = useState("")
  // Checkpoint dialog state
  const [checkpointPickerOpen, setCheckpointPickerOpen] = useState(false)
  const [checkpointActionOpen, setCheckpointActionOpen] = useState(false)
  const [selectedStepType, setSelectedStepType] = useState<StepType | null>(null)
  const [checkpointAction, setCheckpointAction] = useState<'redo' | 'branch' | 'context'>('branch')
  const [checkpointFeedback, setCheckpointFeedback] = useState("")

  const groupedSteps = useMemo(() => processEventsToGroupedSteps(events), [events])

  // Compute events up to each step type
  const eventsUpToStep = useMemo(() => {
    const stepOrder: StepType[] = ["brief", "subagent", "verification", "answer"]
    const map: Record<string, SSEEvent[]> = {}
    for (const type of stepOrder) {
      let lastIdx = -1
      for (let i = events.length - 1; i >= 0; i--) {
        if (detectStepType(events[i]) === type) { lastIdx = i; break }
      }
      if (lastIdx >= 0) {
        map[type] = events.slice(0, lastIdx + 1)
      }
    }
    return map
  }, [events])

  const handlePickStep = (stepType: StepType) => {
    setSelectedStepType(stepType)
    setCheckpointPickerOpen(false)
    setCheckpointAction('branch')
    setCheckpointFeedback("")
    setCheckpointActionOpen(true)
  }

  const handleCheckpointSubmit = () => {
    if (!onBranchFromCheckpoint || !selectedStepType) return
    if (checkpointAction !== 'redo' && !checkpointFeedback.trim()) return

    onBranchFromCheckpoint({
      action: checkpointAction,
      stepType: selectedStepType,
      events: eventsUpToStep[selectedStepType] || events,
      feedback: checkpointAction === 'redo' ? '' : checkpointFeedback.trim(),
    })
    setCheckpointActionOpen(false)
    setSelectedStepType(null)
    setCheckpointFeedback("")
  }
  
  // Explore mode selection state
  const [selectedTakes, setSelectedTakes] = useState<Set<number>>(new Set())
  const [showMixInput, setShowMixInput] = useState(false)
  const [mixInstructions, setMixInstructions] = useState("")
  const [expandedTakes, setExpandedTakes] = useState<Set<number>>(new Set([0]))

  // Parse takes for explore mode - prefer structured data from result
  const takes = useMemo(() => {
    if (result.takes && result.takes.length > 0) {
      return result.takes
    }
    return parseExploreTakes(result.answer)
  }, [result.answer, result.takes])
  
  const setLevelGaps = result.set_level_gaps || null
  const briefs = useMemo(() => {
    if (result.briefs && result.briefs.length > 0) return result.briefs
    // Fallback: collect from streamed brief events
    if (events && events.length > 0) {
      const fromEvents = events
        .filter(e => e.type === 'brief')
        .map(e => (e as { content: string }).content)
      if (fromEvents.length > 0) return fromEvents
    }
    return []
  }, [result.briefs, events])
  const isExploreMode = mode === 'explore' && takes.length > 1
  
  const toggleTakeSelection = (idx: number) => {
    setSelectedTakes(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }
  
  const toggleTakeExpanded = (idx: number) => {
    setExpandedTakes(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }
  
  const handleUseTake = (idx: number, continueMode: 'standard' | 'plan') => {
    if (onSelectTake) {
      onSelectTake(takes[idx], continueMode)
    }
  }
  
  const handleMixTakes = (continueMode: 'standard' | 'plan') => {
    if (onMixTakes && selectedTakes.size > 0) {
      const selectedContent = Array.from(selectedTakes).sort().map(i => takes[i])
      onMixTakes(selectedContent, mixInstructions, continueMode)
      setShowMixInput(false)
      setMixInstructions("")
    }
  }

  const handleSubmitIterate = () => {
    if (iterateFeedback.trim() && onIterate) {
      onIterate(iterateFeedback.trim())
      setIterateFeedback("")
      setShowIterateInput(false)
    }
  }

  const handleSubmitRedo = () => {
    if (onRework) {
      onRework(redoFeedback.trim())
      setRedoFeedback("")
      setShowRedoInput(false)
    }
  }

  // Checkpoint dialogs (shared between explore and standard modes)
  const checkpointDialogs = (
    <>
      {/* Simplified 3-option checkpoint picker */}
      <Dialog open={checkpointPickerOpen} onOpenChange={setCheckpointPickerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4" />
              Branch from checkpoint
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose where to branch from. Your new direction will start from that point.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {([
              { checkpoint: 'brief' as const, label: 'Redo research', desc: 'Start fresh research from a different angle', icon: RotateCcw, color: 'text-blue-500' },
              { checkpoint: 'subagent' as const, label: 'Try different approach', desc: 'Keep research, try different analysis', icon: GitBranch, color: 'text-violet-500' },
              { checkpoint: 'verification' as const, label: 'Re-verify', desc: 'Keep analysis, verify with different criteria', icon: CheckCircle2, color: 'text-amber-500' },
            ]).map((opt) => {
              const OptIcon = opt.icon
              // Only show options for steps that actually exist
              const hasStep = groupedSteps.some(s => s.type === opt.checkpoint)
              if (!hasStep) return null
              return (
                <button
                  key={opt.checkpoint}
                  onClick={() => handlePickStep(opt.checkpoint)}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left hover:bg-muted/60 transition-colors border border-border/40 hover:border-border"
                >
                  <OptIcon className={cn("w-4 h-4 shrink-0 mt-0.5", opt.color)} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-foreground">{opt.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Checkpoint Action Dialog */}
      <Dialog open={checkpointActionOpen} onOpenChange={setCheckpointActionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4" />
              {selectedStepType && (
                <span className="capitalize">{getStepLabel(selectedStepType, 1)}</span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              The execution will replay up to this point, then apply your changes before continuing.
            </DialogDescription>
          </DialogHeader>

          {/* Action selector */}
          <div className="flex gap-1.5 p-1 rounded-lg bg-muted/50">
            {([
              { value: 'redo' as const, label: 'Redo', icon: RotateCcw, desc: 'Rerun from this step' },
              { value: 'branch' as const, label: 'Branch', icon: GitBranch, desc: 'New direction with feedback' },
              { value: 'context' as const, label: 'Add context', icon: Plus, desc: 'Inject info and continue' },
            ]).map((opt) => {
              const OptIcon = opt.icon
              return (
                <button
                  key={opt.value}
                  onClick={() => setCheckpointAction(opt.value)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-md text-xs transition-colors",
                    checkpointAction === opt.value
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <OptIcon className="w-3.5 h-3.5" />
                  <span className="font-medium">{opt.label}</span>
                </button>
              )
            })}
          </div>

          {/* Feedback textarea (not shown for redo) */}
          {checkpointAction !== 'redo' && (
            <textarea
              value={checkpointFeedback}
              onChange={(e) => setCheckpointFeedback(e.target.value)}
              placeholder={
                checkpointAction === 'branch'
                  ? "What should change from this point forward?"
                  : "What additional context should be considered?"
              }
              className={cn(
                "w-full min-h-[80px] p-3 rounded-lg text-sm",
                "bg-muted/50 border border-border/50",
                "placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-primary/20",
                "resize-none"
              )}
              autoFocus
            />
          )}

          {/* Redo confirmation */}
          {checkpointAction === 'redo' && (
            <div className="p-3 rounded-lg bg-muted/30 border border-border/40">
              <p className="text-sm text-muted-foreground">
                This will discard everything after the <span className="font-medium text-foreground">{selectedStepType && getStepLabel(selectedStepType, 1)}</span> step and rerun from that point.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCheckpointActionOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCheckpointSubmit}
              disabled={checkpointAction !== 'redo' && !checkpointFeedback.trim()}
              className="gap-1.5"
            >
              {checkpointAction === 'redo' && <><RotateCcw className="w-3 h-3" /> Redo</>}
              {checkpointAction === 'branch' && <><GitBranch className="w-3 h-3" /> Branch</>}
              {checkpointAction === 'context' && <><Plus className="w-3 h-3" /> Add & Continue</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  // Explore mode has a completely different layout
  if (isExploreMode) {
    return (
      <div className="w-full max-w-5xl mx-auto space-y-6 py-8 px-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-accent" />
            <h2 className="text-xl font-serif font-medium">Exploration Complete</h2>
            <span className="text-sm px-2.5 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
              {takes.length} Takes Generated
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selectedTakes.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedTakes.size} selected
              </span>
            )}
            <div className="flex items-center gap-1">
              {onShare && <SharePopover onShare={onShare} />}
              <DownloadDropdown content={result.answer} task={result.task} />
            </div>
          </div>
        </div>

        {/* Task reference */}
        <div className="bg-muted/30 rounded-lg px-4 py-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Task:</span>{" "}
            <span className="italic">{result.task}</span>
          </p>
        </div>

        {/* Takes Grid */}
        <div className="space-y-4">
          {takes.map((take, idx) => {
            const isSelected = selectedTakes.has(idx)
            const isExpanded = expandedTakes.has(idx)
            // Extract first line as title if it looks like a title
            const lines = take.split('\n').filter(l => l.trim())
            const firstLine = lines[0] || ''
            const hasTitle = firstLine.startsWith('Take') || firstLine.startsWith('#') || firstLine.length < 80
            const title = hasTitle ? firstLine.replace(/^#+\s*/, '').replace(/^Take \d+:\s*/i, '') : `Take ${idx + 1}`
            const preview = hasTitle ? lines.slice(1).join('\n').slice(0, 200) : take.slice(0, 200)
            
            return (
              <Card
                key={idx}
                className={cn(
                  "border-2 transition-all",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border/50 hover:border-border"
                )}
              >
                <div className="flex items-start gap-4 p-4">
                  {/* Selection checkbox */}
                  <button
                    onClick={() => toggleTakeSelection(idx)}
                    className={cn(
                      "mt-1 shrink-0 h-5 w-5 rounded border-2 transition-colors flex items-center justify-center",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-primary"
                    )}
                  >
                    {isSelected && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                        Take {idx + 1}
                      </span>
                      <h3 className="font-medium text-foreground truncate">{title}</h3>
                    </div>
                    
                    {/* Preview or full content */}
                    <Collapsible open={isExpanded} onOpenChange={() => toggleTakeExpanded(idx)}>
                      {!isExpanded && (
                        <p className="text-sm text-muted-foreground line-clamp-3">
                          {preview}...
                        </p>
                      )}
                      <CollapsibleContent>
                        <div className="prose prose-sm dark:prose-invert max-w-none mt-2">
                          <Markdown>{take}</Markdown>
                        </div>
                      </CollapsibleContent>
                      <CollapsibleTrigger asChild>
                        <button className="mt-2 text-xs text-primary hover:underline">
                          {isExpanded ? 'Show less' : 'Read more'}
                        </button>
                      </CollapsibleTrigger>
                    </Collapsible>
                  </div>
                  
                  {/* Quick actions for this take */}
                  {showActions && onSelectTake && (
                    <div className="shrink-0 flex flex-col gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUseTake(idx, 'standard')}
                        className="text-xs h-7"
                      >
                        Use This
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUseTake(idx, 'plan')}
                        className="text-xs h-7 text-muted-foreground"
                      >
                        + Plan
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>

        {/* Mix Selected Takes Panel */}
        {showActions && selectedTakes.size > 1 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="font-medium text-foreground">
                  Mix {selectedTakes.size} Selected Takes
                </span>
              </div>
              
              {showMixInput ? (
                <div className="space-y-3">
                  <textarea
                    value={mixInstructions}
                    onChange={(e) => setMixInstructions(e.target.value)}
                    placeholder="Optional: Describe how to combine these takes (e.g., 'Use the opening from Take 1, the data from Take 2, and the conclusion from Take 4')"
                    className={cn(
                      "w-full min-h-[80px] p-3 rounded-lg text-sm",
                      "bg-background border border-border/50",
                      "placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-primary/20",
                      "resize-none"
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => handleMixTakes('standard')}>
                      Mix & Continue
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleMixTakes('plan')}>
                      Mix & Plan
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowMixInput(false)
                        setMixInstructions("")
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setShowMixInput(true)}>
                    Combine Selected
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Takes: {Array.from(selectedTakes).sort().map(i => i + 1).join(', ')}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Set-Level Gaps - What's missing across all takes */}
        {setLevelGaps && (
          <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-900/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  Set-Level Gaps
                </span>
                <span className="text-sm font-medium text-foreground">
                  What's Missing Across All Takes
                </span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{setLevelGaps}</Markdown>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Briefs Summary - Collapsible */}
        {briefs.length > 0 && (
          <Collapsible>
            <Card className="border-border/40">
              <CollapsibleTrigger className="w-full">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {briefs.length} Briefs
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Exploration angles used
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform ui-expanded:rotate-90" />
                </CardContent>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3">
                  {briefs.map((brief, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-muted/30 text-sm">
                      <div className="font-medium text-xs text-muted-foreground mb-1">
                        Brief {idx + 1}
                      </div>
                      <Markdown className="prose prose-sm dark:prose-invert">{brief}</Markdown>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {/* Execution History */}
        {events.length > 0 && (
          <ExecutionHistory
            events={events}
            onPickCheckpoint={onBranchFromCheckpoint ? () => setCheckpointPickerOpen(true) : undefined}
            branchMetadata={branchMetadata}
            inheritedEventCount={inheritedEventCount}
          />
        )}

        {/* Orchestrator Reasoning */}
        <OrchestratorReasoning events={events} />

        {checkpointDialogs}
      </div>
    )
  }

  // Standard/Plan mode layout
  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 py-8 px-4">
      {/* Document View - The main answer */}
      <article className="paper-texture">
        <Card className="border-border/40 bg-card shadow-sm overflow-hidden">
          {/* Completed indicator + version tabs + share/download */}
          <div className="flex items-center justify-between px-6 pt-6 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-accent" />
                <span className="text-sm font-medium text-accent">Completed</span>
              </div>
              <BranchNavigator
                branches={branches}
                activeBranchId={activeBranchId}
                onSwitchBranch={onSwitchBranch}
                linkedVersions={linkedVersions}
                activeVersionId={activeVersionId}
                onSwitchVersion={onSwitchVersion}
              />
            </div>
            <div className="flex items-center gap-1">
              {onShare && <SharePopover onShare={onShare} />}
              <DownloadDropdown content={result.answer} task={result.task} />
            </div>
          </div>

          {/* The beautiful document content with markdown */}
          <CardContent className="pt-4 pb-10 px-6 md:px-10">
            <Markdown className="text-base md:text-lg leading-relaxed">
              {result.answer}
            </Markdown>
          </CardContent>

          {/* Task reference at bottom */}
          <Separator className="mx-6 md:mx-10" />
          <div className="px-6 md:px-10 py-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">Task:</span>{" "}
              <span className="italic">{result.task}</span>
            </p>
          </div>

          {/* Action Buttons */}
          {showActions && (
            <>
              <Separator className="mx-6 md:mx-10" />
              <div className="px-6 md:px-10 py-4">
                {/* Refine Input */}
                {showIterateInput && (
                  <div className="mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">
                        What should be improved?
                      </label>
                      <button
                        onClick={() => {
                          setShowIterateInput(false)
                          setIterateFeedback("")
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      value={iterateFeedback}
                      onChange={(e) => setIterateFeedback(e.target.value)}
                      placeholder="e.g., Make it more concise, add a section about risks, change the tone to be more formal..."
                      className={cn(
                        "w-full min-h-[100px] p-3 rounded-lg",
                        "bg-muted/50 border border-border/50",
                        "text-sm text-foreground placeholder:text-muted-foreground",
                        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50",
                        "resize-none"
                      )}
                    />
                    <div className="flex justify-end">
                      <Button
                        onClick={handleSubmitIterate}
                        disabled={!iterateFeedback.trim()}
                        size="sm"
                      >
                        Refine
                      </Button>
                    </div>
                  </div>
                )}

                {/* Redo Input */}
                {showRedoInput && !showIterateInput && (
                  <div className="mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-foreground">
                        Any feedback for the redo? (optional)
                      </label>
                      <button
                        onClick={() => {
                          setShowRedoInput(false)
                          setRedoFeedback("")
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      value={redoFeedback}
                      onChange={(e) => setRedoFeedback(e.target.value)}
                      placeholder="e.g., Try a completely different structure, focus more on the data, use a more conversational tone..."
                      className={cn(
                        "w-full min-h-[100px] p-3 rounded-lg",
                        "bg-muted/50 border border-border/50",
                        "text-sm text-foreground placeholder:text-muted-foreground",
                        "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50",
                        "resize-none"
                      )}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={handleSubmitRedo}
                        size="sm"
                      >
                        Redo without feedback
                      </Button>
                      <Button
                        onClick={handleSubmitRedo}
                        disabled={!redoFeedback.trim()}
                        size="sm"
                      >
                        Redo with feedback
                      </Button>
                    </div>
                  </div>
                )}

                {/* Action Buttons Row */}
                {!showIterateInput && !showRedoInput && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted-foreground mr-2">
                      Not satisfied?
                    </span>

                    {onIterate && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowIterateInput(true)}
                            className="gap-2"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Refine
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Give feedback to improve this output — reverifies against the rubric
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {onRework && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowRedoInput(true)}
                            className="gap-2"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Redo
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Discard and start over — runs the full task again from scratch
                        </TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onAnotherVersion}
                          className="gap-2"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Fresh Take
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        Run a new creative attempt — compare it with this one side by side
                      </TooltipContent>
                    </Tooltip>

                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </article>

      {/* Execution History */}
      {events.length > 0 && (
        <ExecutionHistory
          events={events}
          onPickCheckpoint={onBranchFromCheckpoint ? () => setCheckpointPickerOpen(true) : undefined}
          branchMetadata={branchMetadata}
          inheritedEventCount={inheritedEventCount}
        />
      )}

      {/* Orchestrator Reasoning */}
      <OrchestratorReasoning events={events} />

      {checkpointDialogs}
    </div>
  )
}
