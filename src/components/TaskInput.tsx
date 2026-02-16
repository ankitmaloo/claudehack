"use client";

import * as React from "react";
import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Paperclip, X, FileText, Image, File, ArrowRight, Zap, Map as MapIcon, Compass } from "lucide-react";
import type { AttachedFile, ExecutionMode } from "@/types";

export type Provider = 'gemini' | 'openai' | 'anthropic';

interface TaskInputProps {
  onSubmit: (task: string, files: AttachedFile[], mode: ExecutionMode, enableSearch: boolean, provider: Provider) => void;
  disabled?: boolean;
  placeholder?: string;
  initialTask?: string;
  initialMode?: ExecutionMode;
  availableProviders?: Provider[];
}

const ACCEPTED_FILE_TYPES = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.json";

function getFileTypeCategory(mimeType: string, fileName: string): 'pdf' | 'image' | 'text' | 'other' {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.startsWith("text/") ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".json") ||
    fileName.endsWith(".csv")
  )
    return "text";
  return "other";
}

function getFileIcon(mimeType: string, fileName: string) {
  const category = getFileTypeCategory(mimeType, fileName);
  switch (category) {
    case "pdf":
      return FileText;
    case "image":
      return Image;
    case "text":
      return FileText;
    default:
      return File;
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get just the base64 content
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

const MODE_OPTIONS: { value: ExecutionMode; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'standard', label: 'Standard', icon: Zap, desc: 'Auto brief + rubric' },
  { value: 'plan', label: 'Plan', icon: MapIcon, desc: 'Provide execution plan' },
  { value: 'explore', label: 'Explore', icon: Compass, desc: 'Multiple takes' },
];

const ALL_PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

export function TaskInput({
  onSubmit,
  disabled = false,
  placeholder = "What would you like to accomplish?",
  initialTask,
  initialMode,
  availableProviders,
}: TaskInputProps) {
  const [task, setTask] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [mode, setMode] = useState<ExecutionMode>('standard');
  const [provider, setProvider] = useState<Provider>(availableProviders?.[0] ?? 'gemini');
  const [enableSearch, setEnableSearch] = useState(false);

  // Filter providers to only those with keys configured (if provided)
  const displayProviders = availableProviders
    ? ALL_PROVIDERS.filter((p) => availableProviders.includes(p.value))
    : ALL_PROVIDERS;

  // Auto-select first available provider when availableProviders changes
  useEffect(() => {
    if (availableProviders && availableProviders.length > 0 && !availableProviders.includes(provider)) {
      setProvider(availableProviders[0]);
    }
  }, [availableProviders]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set task from external initialTask prop
  useEffect(() => {
    if (initialTask !== undefined && initialTask !== "") {
      setTask(initialTask);
      // Focus the textarea after setting
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [initialTask]);

  // Set mode from external initialMode prop
  useEffect(() => {
    if (initialMode !== undefined) {
      setMode(initialMode);
    }
  }, [initialMode]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 320);
      textarea.style.height = `${newHeight}px`;
    }
  }, [task]);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);

    const processedFiles = await Promise.all(
      filesArray.map(async (file): Promise<AttachedFile> => {
        const category = getFileTypeCategory(file.type, file.name);
        let content: string | undefined;
        let preview: string | undefined;

        if (category === "image") {
          content = await fileToBase64(file);
          preview = URL.createObjectURL(file);
        } else if (category === "text") {
          content = await fileToText(file);
        }

        return {
          id: generateId(),
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          content,
          preview,
        };
      })
    );

    setFiles((prev) => [...prev, ...processedFiles]);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
        // Reset input so same file can be selected again
        e.target.value = "";
      }
    },
    [processFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        e.preventDefault();
        processFiles(pastedFiles);
      }
    },
    [processFiles]
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedTask = task.trim();
    if (!trimmedTask && files.length === 0) return;
    if (disabled) return;

    onSubmit(trimmedTask, files, mode, enableSearch, provider);
    setTask("");
    setFiles([]);
  }, [task, files, mode, enableSearch, provider, disabled, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach((file) => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, []);

  const canSubmit = (task.trim().length > 0 || files.length > 0) && !disabled;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={cn(
          "workspace-btn relative rounded-xl",
          "shadow-sm transition-shadow duration-200",
          "focus-within:shadow-md",
          disabled && "opacity-60 cursor-not-allowed"
        )}
        style={{ '--workspace-bg': '#ffffff', '--workspace-bg-dark': '#0a0a0a' } as React.CSSProperties}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            "w-full resize-none bg-transparent",
            "px-5 pt-5 pb-3",
            "text-base leading-relaxed tracking-[-0.01em]",
            "text-neutral-900 dark:text-neutral-100",
            "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
            "focus:outline-none",
            "disabled:cursor-not-allowed",
            "min-h-[56px] max-h-80",
            // Editorial typography
            "font-[system-ui,-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,sans-serif]"
          )}
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />

        {/* Attached files */}
        {files.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {files.map((file) => {
              const Icon = getFileIcon(file.type, file.name);
              const isImage = file.type.startsWith("image/");
              return (
                <div
                  key={file.id}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg",
                    "bg-neutral-100 dark:bg-neutral-800",
                    "text-sm text-neutral-700 dark:text-neutral-300",
                    "border border-neutral-200 dark:border-neutral-700"
                  )}
                >
                  {isImage && file.preview ? (
                    <img
                      src={file.preview}
                      alt=""
                      className="w-4 h-4 rounded object-cover"
                    />
                  ) : (
                    <Icon className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
                  )}
                  <span className="truncate max-w-[140px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(file.id)}
                    className={cn(
                      "p-0.5 rounded-full",
                      "text-neutral-400 hover:text-neutral-600",
                      "dark:text-neutral-500 dark:hover:text-neutral-300",
                      "hover:bg-neutral-200 dark:hover:bg-neutral-700",
                      "transition-colors duration-150"
                    )}
                    disabled={disabled}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom toolbar */}
        <div
          className={cn(
            "flex items-center justify-between px-4 py-3",
            "border-t border-neutral-100 dark:border-neutral-800/50"
          )}
        >
          {/* Left side: Attach, Mode, Search */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openFilePicker}
              disabled={disabled}
              className={cn(
                "h-8 w-8 p-0",
                "text-neutral-500 hover:text-neutral-700",
                "dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
            >
              <Paperclip className="w-4 h-4" />
            </Button>

            {/* Mode indicator */}
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 capitalize">
              {mode}
            </span>

            <div className="flex items-center gap-2">
              <Switch
                id="enable-search"
                checked={enableSearch}
                onCheckedChange={setEnableSearch}
                disabled={disabled}
              />
              <label
                htmlFor="enable-search"
                className={cn(
                  "text-sm cursor-pointer select-none",
                  "text-neutral-500 dark:text-neutral-400",
                  enableSearch && "text-neutral-700 dark:text-neutral-200"
                )}
              >
                Search
              </label>
            </div>
          </div>

          {/* Right side: Provider + Submit */}
          <div className="flex items-center gap-3">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              disabled={disabled || displayProviders.length === 0}
              className={cn(
                "h-7 px-2 text-xs font-medium rounded-md",
                "bg-neutral-100 dark:bg-neutral-800 border-none",
                "text-neutral-700 dark:text-neutral-300",
                "focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:focus:ring-neutral-600",
                "cursor-pointer"
              )}
            >
              {displayProviders.length === 0 && (
                <option value="">No provider</option>
              )}
              {displayProviders.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                "h-8 px-2.5 gap-1.5",
                canSubmit
                  ? "text-neutral-900 hover:text-neutral-950 dark:text-neutral-100 dark:hover:text-white"
                  : "text-neutral-300 dark:text-neutral-600"
              )}
            >
              <span className="text-sm">Submit</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mode selector cards */}
      <div className="mt-3 flex gap-2">
        {MODE_OPTIONS.map(opt => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              disabled={disabled}
              className={cn(
                "flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-sm",
                mode === opt.value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <div>
                <div className="font-medium text-xs">{opt.label}</div>
                <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Helper text */}
      <div className="mt-2 text-center">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          Press Enter to submit, Shift+Enter for new line
        </span>
      </div>
    </div>
  );
}

export default TaskInput;
