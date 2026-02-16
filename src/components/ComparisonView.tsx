"use client"

import { CheckCircle2, Loader2, X, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Markdown } from "@/components/ui/markdown"
import { ExecutionView } from "@/components/ExecutionView"
import type { TaskResult, SSEEvent, TaskStatus } from "@/types"

interface ComparisonViewProps {
  // Primary (original or currently preferred) version
  primaryResult: TaskResult | null
  primaryEvents: SSEEvent[]
  primaryTask: string

  // New version being compared
  versionResult: TaskResult | null
  versionEvents: SSEEvent[]
  versionStatus: TaskStatus
  versionId: string | null

  // Actions
  onPreferPrimary: () => void
  onPreferVersion: () => void
  onClose: () => void
}

function VersionPanel({
  title,
  label,
  result,
  events,
  status,
  isPreferred,
  onPrefer,
  showPreferButton,
}: {
  title: string
  label: string
  result: TaskResult | null
  events: SSEEvent[]
  status: TaskStatus
  isPreferred?: boolean
  onPrefer?: () => void
  showPreferButton?: boolean
}) {
  const isCompleted = status === 'completed' && result
  const isExecuting = status === 'executing'

  return (
    <div className="flex flex-col h-full">
      {/* Panel Header */}
      <div className={cn(
        "flex items-center justify-between px-4 py-3 border-b",
        isPreferred
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50"
          : "bg-muted/30 border-border/50"
      )}>
        <div className="flex items-center gap-2">
          <span className="font-serif text-sm font-medium">{title}</span>
          <span className={cn(
            "px-2 py-0.5 text-xs rounded-full",
            isPreferred
              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}>
            {label}
          </span>
          {isPreferred && (
            <Star className="h-3.5 w-3.5 text-emerald-500 fill-emerald-500" />
          )}
        </div>

        {showPreferButton && isCompleted && onPrefer && (
          <Button
            variant={isPreferred ? "default" : "outline"}
            size="sm"
            onClick={onPrefer}
            className={cn(
              "text-xs",
              isPreferred && "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {isPreferred ? "Preferred" : "I prefer this"}
          </Button>
        )}
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto">
        {isExecuting && (
          <div className="p-4 space-y-4">
            {/* Progress indicator card */}
            {events.length === 0 && (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-4 px-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div>
                      <p className="text-sm font-medium">Generating new version</p>
                      <p className="text-xs text-muted-foreground">Please wait while we create an alternative...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <ExecutionView events={events} status={status} />
          </div>
        )}

        {isCompleted && (
          <div className="p-4 space-y-4">
            {/* Result Card */}
            <Card className="border-border/40 bg-card shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <CheckCircle2 className="size-4 text-accent" />
                <span className="text-sm font-medium text-accent">Completed</span>
              </div>

              <CardContent className="pt-2 pb-6 px-4">
                <Markdown className="text-sm leading-relaxed">
                  {result.answer}
                </Markdown>
              </CardContent>

              <Separator className="mx-4" />
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Task:</span>{" "}
                  <span className="italic line-clamp-2">{result.task}</span>
                </p>
              </div>
            </Card>

            {/* Show execution steps after completion */}
            {events.length > 0 && (
              <div className="border border-border/40 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-muted/30 border-b border-border/40">
                  <span className="text-xs font-medium text-muted-foreground">
                    Execution Steps ({events.length})
                  </span>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  <ExecutionView events={events} status="completed" />
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'idle' && !result && (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground italic">
              Waiting for content...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="p-4">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-sm text-destructive">
                An error occurred while generating this version.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ComparisonView({
  primaryResult,
  primaryEvents,
  primaryTask: _primaryTask,
  versionResult,
  versionEvents,
  versionStatus,
  versionId,
  onPreferPrimary,
  onPreferVersion,
  onClose,
}: ComparisonViewProps) {
  // Primary is considered "completed" if we have a result
  const primaryStatus: TaskStatus = primaryResult ? 'completed' : 'idle'

  return (
    <div className="h-full flex flex-col">
      {/* Comparison Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-muted/20 border-b border-border/50">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-lg font-medium">Comparing Versions</h2>
          {versionStatus === 'executing' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Generating new version...</span>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-2"
        >
          <X className="h-4 w-4" />
          Close Comparison
        </Button>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Primary Version */}
        <div className="flex-1 border-r border-border/50 overflow-hidden">
          <VersionPanel
            title="Current Version"
            label="Primary"
            result={primaryResult}
            events={primaryEvents}
            status={primaryStatus}
            isPreferred={true}
            onPrefer={onPreferPrimary}
            showPreferButton={versionStatus === 'completed'}
          />
        </div>

        {/* Right Panel - New Version */}
        <div className="flex-1 overflow-hidden">
          <VersionPanel
            title="New Version"
            label={versionId || "Version"}
            result={versionResult}
            events={versionEvents}
            status={versionStatus}
            isPreferred={false}
            onPrefer={onPreferVersion}
            showPreferButton={versionStatus === 'completed'}
          />
        </div>
      </div>

      {/* Footer with instructions */}
      {versionStatus === 'completed' && (
        <div className="px-6 py-3 bg-muted/20 border-t border-border/50">
          <p className="text-sm text-center text-muted-foreground">
            Click "I prefer this" on the version you want to keep as primary.
            You can request more versions from the primary.
          </p>
        </div>
      )}
    </div>
  )
}

export default ComparisonView
