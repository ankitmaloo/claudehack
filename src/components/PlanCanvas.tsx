"use client"

import * as React from "react"
import { MessageSquare, Play, RotateCcw, X, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Markdown } from "@/components/ui/markdown"

export interface PlanComment {
  id: string
  selectedText: string
  comment: string
}

// Plan data structure for canvas display
interface PlanData {
  task: string
  brief: string
  plan: string
  rubric: string
}

interface PlanCanvasProps {
  plan: PlanData
  onExecute: (plan: string) => void
  onRework: (plan: string, comments: PlanComment[]) => void
  onCancel: () => void
}

export function PlanCanvas({
  plan,
  onExecute,
  onRework,
  onCancel,
}: PlanCanvasProps) {
  const [comments, setComments] = React.useState<PlanComment[]>([])
  const [selection, setSelection] = React.useState<{ text: string; x: number; y: number } | null>(null)
  const [isAddingComment, setIsAddingComment] = React.useState(false)
  const [commentDraft, setCommentDraft] = React.useState("")

  const contentRef = React.useRef<HTMLDivElement>(null)
  const commentInputRef = React.useRef<HTMLTextAreaElement>(null)
  const floatingRef = React.useRef<HTMLDivElement>(null)
  const selectionRangeRef = React.useRef<Range | null>(null)

  const hasComments = comments.length > 0

  // Restore selection when selection state changes
  React.useEffect(() => {
    if (selection && selectionRangeRef.current) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(selectionRangeRef.current)
    }
  }, [selection])

  // Handle text selection on rendered markdown
  const handleMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    const selectedText = sel?.toString().trim()

    if (selectedText && selectedText.length > 0 && sel?.rangeCount) {
      selectionRangeRef.current = sel.getRangeAt(0).cloneRange()
      setSelection({
        text: selectedText,
        x: e.clientX,
        y: e.clientY,
      })
    } else {
      selectionRangeRef.current = null
      setSelection(null)
    }
  }

  // Start adding a comment for the selection
  const startComment = () => {
    if (!selection) return
    setIsAddingComment(true)
    setCommentDraft("")
    setTimeout(() => commentInputRef.current?.focus(), 0)
  }

  // Save the comment
  const saveComment = () => {
    if (!selection || !commentDraft.trim()) {
      cancelComment()
      return
    }

    const newComment: PlanComment = {
      id: `comment-${Date.now()}`,
      selectedText: selection.text,
      comment: commentDraft.trim(),
    }

    setComments(prev => [...prev, newComment])
    setSelection(null)
    setIsAddingComment(false)
    setCommentDraft("")
  }

  // Cancel adding comment
  const cancelComment = () => {
    setIsAddingComment(false)
    setCommentDraft("")
    setSelection(null)
  }

  // Remove a comment
  const removeComment = (id: string) => {
    setComments(prev => prev.filter(c => c.id !== id))
  }

  // Handle keyboard in comment input
  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveComment()
    } else if (e.key === 'Escape') {
      cancelComment()
    }
  }

  // Click outside to clear selection
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        floatingRef.current &&
        !floatingRef.current.contains(e.target as Node) &&
        contentRef.current &&
        !contentRef.current.contains(e.target as Node)
      ) {
        if (!isAddingComment) {
          setSelection(null)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAddingComment])

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b px-6 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-serif font-medium">Execution Plan</h2>
        </div>
        <div className="flex items-center gap-2">
          {hasComments && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setComments([])}
              className="text-muted-foreground"
            >
              Clear Comments
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {hasComments && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRework(plan.plan, comments)}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Rework
            </Button>
          )}
          <Button size="sm" onClick={() => onExecute(plan.plan)} className="gap-1.5">
            <Play className="size-3.5" />
            Execute
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Plan content - bounded width for readability */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-3xl mx-auto px-6 py-6">
              {/* Task */}
              <div className="mb-6 pb-4 border-b border-border/50">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Task:</span> {plan.task}
                </p>
              </div>

              {/* Plan */}
              <div
                ref={contentRef}
                className="select-text"
                onMouseUp={handleMouseUp}
              >
                <Markdown>{plan.plan}</Markdown>
              </div>
            </div>
          </ScrollArea>

          {/* Floating comment button */}
          {selection && !isAddingComment && (
            <div
              ref={floatingRef}
              className="fixed z-50 animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: selection.x,
                top: selection.y - 45,
                transform: 'translateX(-50%)',
              }}
            >
              <Button
                size="sm"
                onMouseDown={(e) => e.preventDefault()} // Keep text selection visible
                onClick={startComment}
                className="gap-1.5 shadow-lg"
              >
                <MessageSquare className="size-3.5" />
                Comment
              </Button>
            </div>
          )}

          {/* Comment input popover */}
          {isAddingComment && selection && (
            <div
              ref={floatingRef}
              className="fixed z-50 w-80 animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: Math.min(selection.x, window.innerWidth - 340),
                top: selection.y + 10,
              }}
            >
              <div className="bg-card border rounded-lg shadow-xl p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  Commenting on:
                </div>
                <div className="mb-3 text-sm bg-muted/50 rounded p-2 max-h-20 overflow-auto">
                  <span className="italic">"{selection.text.slice(0, 100)}{selection.text.length > 100 ? '...' : ''}"</span>
                </div>
                <Textarea
                  ref={commentInputRef}
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={handleCommentKeyDown}
                  placeholder="Add your feedback..."
                  className="min-h-[80px] text-sm resize-none"
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-muted-foreground">
                    ⌘+Enter to save
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={cancelComment}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7"
                      onClick={saveComment}
                      disabled={!commentDraft.trim()}
                    >
                      <Send className="size-3 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Comments sidebar */}
        {hasComments && (
          <div className="w-80 border-l bg-muted/20 flex flex-col">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-medium">
                Comments ({comments.length})
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                {comments.map((comment, index) => (
                  <div
                    key={comment.id}
                    className="bg-card rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-xs text-muted-foreground">
                        #{index + 1}
                      </span>
                      <button
                        onClick={() => removeComment(comment.id)}
                        className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                    <div className="mb-2 px-2 py-1 bg-primary/5 border-l-2 border-primary/40 rounded-r text-xs text-muted-foreground italic">
                      "{comment.selectedText.slice(0, 80)}{comment.selectedText.length > 80 ? '...' : ''}"
                    </div>
                    <p className="text-foreground leading-relaxed">
                      {comment.comment}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="shrink-0 border-t px-6 py-2 bg-muted/20">
        <p className="text-xs text-muted-foreground text-center">
          Select text to add comments • {hasComments ? "Click 'Rework' to regenerate with feedback" : "Add comments to enable 'Rework'"}
        </p>
      </div>
    </div>
  )
}
