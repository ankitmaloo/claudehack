"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Pencil, RotateCcw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/ui/markdown"

interface RubricPanelProps {
  rubric: string | null
  onRubricChange: (rubric: string) => void
  onRevalidate?: () => void
  isOpen: boolean
  onToggle: () => void
  isLoading?: boolean
  showRevalidate?: boolean
}

export function RubricPanel({
  rubric,
  onRubricChange,
  onRevalidate,
  isOpen,
  onToggle,
  isLoading = false,
  showRevalidate = false,
}: RubricPanelProps) {
  const [editModalOpen, setEditModalOpen] = React.useState(false)
  const [editValue, setEditValue] = React.useState("")
  const [originalRubric, setOriginalRubric] = React.useState<string | null>(null)

  // Track original rubric
  React.useEffect(() => {
    if (rubric !== null && originalRubric === null) {
      setOriginalRubric(rubric)
    }
  }, [rubric, originalRubric])

  const isEdited = rubric !== null && originalRubric !== null && rubric !== originalRubric

  const handleOpenEdit = () => {
    setEditValue(rubric || "")
    setEditModalOpen(true)
  }

  const handleSaveEdit = () => {
    onRubricChange(editValue)
    setEditModalOpen(false)
  }

  const handleReset = () => {
    if (originalRubric !== null) {
      onRubricChange(originalRubric)
    }
  }

  return (
    <>
      <div
        data-slot="rubric-panel"
        className={cn(
          "fixed right-0 top-0 h-full flex flex-col border-l bg-card transition-all duration-300 ease-in-out z-20",
          isOpen ? "w-80" : "w-0"
        )}
      >
        {/* Toggle button - always visible */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className={cn(
            "absolute top-4 z-10 size-8 rounded-full border bg-background shadow-sm transition-all duration-300",
            isOpen ? "-left-4" : "-left-4"
          )}
          aria-label={isOpen ? "Collapse panel" : "Expand panel"}
        >
          {isOpen ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>

        {/* Panel content */}
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden transition-opacity duration-300",
            isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-base font-medium tracking-tight">
                Acceptance Criteria
              </h2>
              {isEdited && (
                <span className="text-xs text-primary font-medium">
                  (edited)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isEdited && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="size-3" />
                </Button>
              )}
              {rubric && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenEdit}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Pencil className="size-3" />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {/* Re-validate button */}
          {showRevalidate && (
            <div className="shrink-0 border-b px-4 py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRevalidate}
                className="w-full text-xs"
                disabled={!isEdited}
              >
                Re-validate with updated criteria
              </Button>
            </div>
          )}

          {/* Content - read-only display with markdown */}
          <ScrollArea className="flex-1 overflow-hidden">
            <div className="p-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-10/12" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : rubric === null ? (
                <p className="text-sm text-muted-foreground italic">
                  Acceptance criteria will appear here...
                </p>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Markdown>{rubric}</Markdown>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Edit Modal - with proper scrolling and visible buttons */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-2xl flex flex-col max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-serif">Edit Acceptance Criteria</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 py-4 overflow-hidden flex flex-col">
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="Enter acceptance criteria in markdown format..."
              className="flex-1 min-h-[200px] max-h-[50vh] font-mono text-sm leading-relaxed resize-none"
            />
            <p className="text-xs text-muted-foreground mt-2 shrink-0">
              Use markdown format. Examples: numbered lists (1. 2. 3.), bullet points (- or *), **bold**, etc.
            </p>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="ghost" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
