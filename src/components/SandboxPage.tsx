"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useFileSystem } from '@/hooks/useFileSystem';
import { useSandboxExecution, type ActivityItem } from '@/hooks/useSandboxExecution';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Trash2,
  Folder,
  File,
  ArrowLeft,
  AlertTriangle,
  X,
  FolderTree,
  RefreshCw,
  Loader2,
  Play,
  FileCode,
  Eye,
  MessageSquare,
  ListTree,
  Send,
  Bot,
  BrainCircuit,
  Save,
  Plus,
  Download,
  FileArchive,
  ClipboardCopy,
  GitBranch,
  Compass,
  Map as MapIcon,
  Zap,
} from 'lucide-react';
import type { ExecutionMode, IterateRequest } from '@/types';
import { useAppSelector } from '@/store';
import { selectAvailableProviders, selectHasAnyApiKey } from '@/store/slices/apiKeysSlice';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}


const DEMO_ACTIVITY: ActivityItem[] = [
  { id: '1', type: 'tool_call', tool: 'read_file', args: { path: 'src/config.ts' }, timestamp: new Date(), status: 'success' },
  { id: '2', type: 'tool_call', tool: 'read_file', args: { path: 'src/utils/auth.ts' }, timestamp: new Date(), status: 'success' },
  { id: '3', type: 'tool_call', tool: 'execute_code', args: { code: 'analyze...' }, timestamp: new Date(), status: 'success' },
  { id: '4', type: 'tool_call', tool: 'write_file', args: { path: 'SECURITY_REPORT.md' }, timestamp: new Date(), status: 'success' },
];

const DEMO_STAGED_FILES = ['SECURITY_REPORT.md', 'src/utils/auth.ts'];

const DEMO_RESULT = `## Security Analysis Report

### Summary
Analyzed 2 files for potential security vulnerabilities.

### Findings

**1. Authentication Flow (src/utils/auth.ts)**
- JWT tokens are properly validated
- Session timeout is configured correctly
- Recommendation: Add rate limiting to login endpoint

**2. Configuration (src/config.ts)**
- API keys are loaded from environment variables ✓
- No hardcoded secrets detected ✓
- CORS settings are appropriately restrictive

### Risk Level: Low
The codebase follows security best practices. Minor improvements suggested above.`;

const DEMO_QUESTION = {
  question_id: 'demo_q1',
  questions: [
    {
      question: 'Which security standard should I use for the analysis?',
      options: ['OWASP Top 10', 'CWE/SANS Top 25', 'Custom criteria'],
    },
  ],
  context: 'I found multiple security frameworks that could apply to this codebase.',
  content: 'Which security standard should I use?',
};

const DEMO_FILES: FileEntry[] = [
  { name: 'src', path: 'src', isDirectory: true },
  { name: 'package.json', path: 'package.json', isDirectory: false },
  { name: 'tsconfig.json', path: 'tsconfig.json', isDirectory: false },
];

const DEMO_DIR_CONTENTS: Record<string, FileEntry[]> = {
  'src': [
    { name: 'config.ts', path: 'src/config.ts', isDirectory: false },
    { name: 'utils', path: 'src/utils', isDirectory: true },
  ],
  'src/utils': [
    { name: 'auth.ts', path: 'src/utils/auth.ts', isDirectory: false },
    { name: 'helpers.ts', path: 'src/utils/helpers.ts', isDirectory: false },
  ],
};

const MODE_OPTIONS: { value: ExecutionMode; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'standard', label: 'Standard', icon: Zap, desc: 'Auto brief + rubric' },
  { value: 'plan', label: 'Plan', icon: MapIcon, desc: 'Provide execution plan' },
  { value: 'explore', label: 'Explore', icon: Compass, desc: 'Multiple takes' },
];

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
] as const;

type Provider = typeof PROVIDER_OPTIONS[number]['value'];

export function SandboxPage() {
  // Demo mode toggle - default to live mode
  const [demoMode, setDemoMode] = useState(false);
  const [demoState, setDemoState] = useState<'idle' | 'executing' | 'question' | 'completed'>('idle');

  // File system hook
  const fs = useFileSystem();

  // Sandbox execution hook
  const {
    status: realStatus,
    activity: realActivity,
    result: realResult,
    error: realError,
    sessionId: realSessionId,
    modelOutput: realModelOutput,
    pendingTool: realPendingTool,
    pendingQuestion: realPendingQuestion,
    runTask,
    iterate,
    reset,
    respondToQuestion: realRespondToQuestion,
  } = useSandboxExecution(fs);

  // Use demo or real values - memoized to prevent infinite loops
  const status = useMemo(() =>
    demoMode ? (demoState === 'idle' ? 'idle' : demoState === 'executing' ? 'executing' : 'completed') : realStatus,
    [demoMode, demoState, realStatus]
  );
  const activity: ActivityItem[] = useMemo(() => demoMode ? DEMO_ACTIVITY : realActivity, [demoMode, realActivity]);
  const result = useMemo(() =>
    demoMode && demoState === 'completed' ? { task: 'Security analysis', answer: DEMO_RESULT, rubric: '', run_id: 'demo' } : realResult,
    [demoMode, demoState, realResult]
  );
  const error = demoMode ? null : realError;
  const sessionId = demoMode ? 'demo_session' : realSessionId;
  const pendingTool = useMemo(() =>
    demoMode && demoState === 'executing' ? { request: { tool: 'execute_code', args: {}, request_id: 'demo', session_id: 'demo', timeout_ms: 30000 }, startedAt: Date.now() } : realPendingTool,
    [demoMode, demoState, realPendingTool]
  );
  const pendingQuestion = useMemo(() =>
    demoMode && demoState === 'question' ? DEMO_QUESTION : realPendingQuestion,
    [demoMode, demoState, realPendingQuestion]
  );
  const respondToQuestion = useCallback(
    (questionId: string, answers: Record<string, string>) => {
      if (demoMode) {
        setDemoState('completed');
      } else {
        realRespondToQuestion(questionId, answers);
      }
    },
    [demoMode, realRespondToQuestion]
  );
  const modelOutput = demoMode ? '' : realModelOutput;

  // Local state
  const [files, setFiles] = useState<FileEntry[]>(() => DEMO_FILES);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['src']));
  const [dirContents, setDirContents] = useState<Map<string, FileEntry[]>>(
    () => new Map(Object.entries(DEMO_DIR_CONTENTS))
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [taskInput, setTaskInput] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [centerTab, setCenterTab] = useState<'activity' | 'files'>('activity');

  // API key state
  const availableProviders = useAppSelector(selectAvailableProviders);
  const hasAnyApiKey = useAppSelector(selectHasAnyApiKey);
  const displayProviders = availableProviders.length > 0
    ? PROVIDER_OPTIONS.filter((p) => availableProviders.includes(p.value))
    : PROVIDER_OPTIONS;

  // New: mode, provider, plan/explore settings
  const [mode, setMode] = useState<ExecutionMode>('standard');
  const [provider, setProvider] = useState<Provider>(availableProviders[0] as Provider ?? 'gemini');
  const [planText, setPlanText] = useState('');
  const [numTakes, setNumTakes] = useState(3);

  // Auto-select first available provider when keys change
  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.includes(provider)) {
      setProvider(availableProviders[0] as Provider);
    }
  }, [availableProviders]);

  // Save-as dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFileName, setSaveFileName] = useState('output.md');

  // Branch / checkpoint dialog state
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchFromIndex, setBranchFromIndex] = useState<number>(-1);
  const [branchFeedback, setBranchFeedback] = useState('');
  const [checkpointPickerOpen, setCheckpointPickerOpen] = useState(false);

  // Collapsed outputs in activity
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Track the original task text for display in the task bar
  const [currentTask, setCurrentTask] = useState('');

  const activityEndRef = useRef<HTMLDivElement>(null);
  const artifactEndRef = useRef<HTMLDivElement>(null);
  const taskInputRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when switching between demo and real mode
  useEffect(() => {
    if (demoMode) {
      setFiles(DEMO_FILES);
      setExpandedDirs(new Set(['src']));
      setDirContents(new Map(Object.entries(DEMO_DIR_CONTENTS)));
    } else {
      setFiles([]);
      setExpandedDirs(new Set());
      setDirContents(new Map());
    }
  }, [demoMode]);

  // Load root files when project opens or staged files change (real mode only)
  useEffect(() => {
    if (!demoMode && fs.hasProject) {
      fs.listFiles().then(setFiles);
      for (const dir of expandedDirs) {
        fs.listFiles(dir).then(contents => {
          setDirContents(prev => new Map(prev).set(dir, contents));
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs.hasProject, demoMode, fs.stagedFiles]);

  const loadRootFiles = async () => {
    if (demoMode) { setFiles(DEMO_FILES); return; }
    const rootFiles = await fs.listFiles();
    setFiles(rootFiles);
  };

  const handleOpenProject = async () => { await fs.openProject(); };

  const handleToggleDir = async (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      if (!dirContents.has(path)) {
        if (demoMode && DEMO_DIR_CONTENTS[path]) {
          setDirContents(prev => new Map(prev).set(path, DEMO_DIR_CONTENTS[path]));
        } else if (!demoMode) {
          const contents = await fs.listFiles(path);
          setDirContents(prev => new Map(prev).set(path, contents));
        }
      }
    }
    setExpandedDirs(newExpanded);
  };

  const handleSelectFile = async (path: string) => {
    setSelectedFile(path);
    setCenterTab('files');
    const content = await fs.readFile(path);
    if (content !== null) setFileContent(content);
  };

  const handleCommitFile = async (path: string) => {
    await fs.commitFile(path);
    await loadRootFiles();
  };

  const handleDiscardStaged = async (path: string) => {
    await fs.discardStagedFile(path);
  };

  const handleSubmit = useCallback(async () => {
    if (!taskInput.trim() || !fs.hasProject) return;

    // If task is completed and user sends another message, iterate
    if (status === 'completed' && result) {
      const iterateRequest: IterateRequest = {
        task: result.task,
        answer: result.answer,
        rubric: result.rubric,
        feedback: taskInput,
        provider,
        enable_bash: false,
        enable_code: true,
        enable_search: true,
      };
      setTaskInput('');
      await iterate(iterateRequest);
    } else {
      const task = taskInput;
      setCurrentTask(task);
      setTaskInput('');
      reset();
      setCenterTab('activity');
      await runTask({
        task,
        mode,
        enable_search: true,
        enable_bash: false,
        enable_code: true,
        provider,
        ...(mode === 'plan' && planText ? { plan: planText } : {}),
        ...(mode === 'explore' ? { num_takes: numTakes } : {}),
      });
    }
  }, [taskInput, fs.hasProject, status, result, runTask, iterate, reset, mode, provider, planText, numTakes]);

  const handleNewTask = useCallback(() => {
    reset();
    setTaskInput('');
    setCurrentTask('');
    setCenterTab('activity');
  }, [reset]);

  const handleCopyCommandLog = useCallback(() => {
    const toolCalls = activity.filter(a => a.type === 'tool_call');
    const log = toolCalls.map((tc, i) => ({
      index: i, tool: tc.tool, args: tc.args, status: tc.status,
      stdout: tc.stdout || null, stderr: tc.stderr || null,
    }));
    navigator.clipboard.writeText(JSON.stringify(log, null, 2));
  }, [activity]);

  const handleSaveOutputOpen = useCallback(() => {
    if (!result?.answer) return;
    setSaveFileName('output.md');
    setSaveDialogOpen(true);
  }, [result]);

  const handleSaveOutputConfirm = useCallback(async () => {
    if (!result?.answer || !saveFileName.trim()) return;
    const name = saveFileName.trim();
    await fs.stageFile(name, result.answer, name);
    setSaveDialogOpen(false);
    setCenterTab('files');
    setSelectedFile(name);
    const content = await fs.readFile(name);
    if (content) setFileContent(content);
  }, [result, fs, saveFileName]);

  // Binary file detection
  const BINARY_EXTENSIONS = new Set(['.xlsx', '.xls', '.docx', '.doc', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz', '.bmp', '.webp', '.pptx', '.odt']);
  const isBinaryFile = (path: string) => {
    const ext = '.' + path.split('.').pop()?.toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  };

  const handleDownloadFile = useCallback(async (path: string) => {
    const blob = await fs.readStagedFileAsBlob(path);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [fs]);

  // Toggle expanded/collapsed for an activity item
  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Checkpoint / branch
  const handleOpenBranch = useCallback((activityIndex: number) => {
    setBranchFromIndex(activityIndex);
    setBranchFeedback('');
    setCheckpointPickerOpen(false);
    setBranchDialogOpen(true);
  }, []);

  const handleBranch = useCallback(async () => {
    if (!branchFeedback.trim() || branchFromIndex < 0) return;

    // Collect accumulated model output up to this checkpoint
    const upTo = activity.slice(0, branchFromIndex + 1);
    const accumulatedOutput = upTo
      .map(item => {
        if (item.type === 'model_output') return item.content;
        if (item.type === 'tool_call' && item.stdout) return `[${item.tool}] ${item.stdout}`;
        if (item.type === 'answer') return item.content;
        return null;
      })
      .filter(Boolean)
      .join('\n');

    const task = currentTask || result?.task || '';
    const answer = accumulatedOutput || result?.answer || modelOutput || '';
    const rubric = result?.rubric || '';

    setBranchDialogOpen(false);

    const iterateRequest: IterateRequest = {
      task,
      answer,
      rubric,
      feedback: branchFeedback,
      provider,
      enable_bash: false,
      enable_code: true,
      enable_search: true,
    };

    setCurrentTask(task);
    await iterate(iterateRequest);
  }, [branchFromIndex, branchFeedback, activity, currentTask, result, modelOutput, provider, iterate]);

  const handleQuestionAnswer = (questionIdx: number, answer: string) => {
    setQuestionAnswers(prev => ({ ...prev, [String(questionIdx)]: answer }));
  };

  const handleSubmitAnswers = () => {
    if (pendingQuestion) {
      respondToQuestion(pendingQuestion.question_id, questionAnswers);
      setQuestionAnswers({});
    }
  };

  // Helpers
  const isIdle = status === 'idle' && !result;

  // Render file tree
  const renderFileTree = (items: FileEntry[], depth = 0) => {
    return items.map(item => {
      const isStaged = fs.stagedFiles.has(item.path);
      const isSelected = selectedFile === item.path;
      return (
        <div key={item.path}>
          <button
            onClick={() => item.isDirectory ? handleToggleDir(item.path) : handleSelectFile(item.path)}
            className={cn(
              'w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs rounded transition-colors',
              'hover:bg-muted/50',
              isSelected && 'bg-muted text-foreground',
              isStaged && 'text-amber-600 dark:text-amber-400',
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {item.isDirectory ? (
              expandedDirs.has(item.path) ?
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> :
                <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            ) : <span className="w-3 flex-shrink-0" />}
            {item.isDirectory ?
              <Folder className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /> :
              <File className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            }
            <span className="truncate flex-1">{item.name}</span>
            {isStaged && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
          </button>
          {item.isDirectory && expandedDirs.has(item.path) && dirContents.has(item.path) && (
            renderFileTree(dirContents.get(item.path)!, depth + 1)
          )}
        </div>
      );
    });
  };

  const getToolDisplay = (tool: string, args: Record<string, unknown>) => {
    switch (tool) {
      case 'read_file': return { icon: Eye, label: 'Reading', detail: args.path as string };
      case 'write_file': return { icon: FileCode, label: 'Writing', detail: args.path as string };
      case 'list_files': return { icon: FolderTree, label: 'Listing', detail: (args.path as string) || '/' };
      case 'execute_code': return { icon: Play, label: 'Executing', detail: 'JavaScript' };
      case 'search_files': return { icon: FileText, label: 'Searching', detail: args.query as string };
      case 'bash': case 'shell': case 'run_command':
        return { icon: Play, label: 'Shell', detail: (args.command as string || args.cmd as string || '').slice(0, 60) };
      default: return { icon: FileText, label: tool, detail: '' };
    }
  };

  // ─── Render activity item (outputs collapsed by default) ───
  const renderActivityItem = (item: ActivityItem, _index: number) => {
    const isExpanded = expandedItems.has(item.id);
    const hasOutput = !!(item.stdout || item.stderr || item.content || item.response || item.verificationResult);

    // Tool call
    if (item.type === 'tool_call') {
      const { icon: Icon, label, detail } = getToolDisplay(item.tool!, item.args || {});
      const isComplete = item.status === 'success';
      const isError = item.status === 'error';
      const hasToolOutput = !!(item.stdout || item.stderr ||
        ((item.tool === 'execute_code' || item.tool === 'bash' || item.tool === 'shell' || item.tool === 'run_command') && item.content));

      return (
        <div key={item.id} className="space-y-0">
          <button
            onClick={() => hasToolOutput ? toggleExpanded(item.id) : undefined}
            className={cn(
              "w-full flex items-center gap-3 p-2.5 rounded-lg border bg-card text-left",
              hasToolOutput && "cursor-pointer hover:bg-muted/30",
              isComplete ? "border-muted" : isError ? "border-destructive/30" : "border-primary/30 bg-primary/5"
            )}
          >
            <div className={cn(
              "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
              isComplete ? "bg-muted" : isError ? "bg-destructive/10" : "bg-primary/10"
            )}>
              {item.status === 'pending' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : isError ? (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
              ) : (
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium">{label}</div>
              <div className="text-[11px] text-muted-foreground truncate font-mono">{detail}</div>
            </div>
            {isComplete && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
            {hasToolOutput && (
              <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-90")} />
            )}
          </button>
          {isExpanded && (
            <>
              {(item.tool === 'execute_code' || item.tool === 'bash' || item.tool === 'shell' || item.tool === 'run_command') && item.content && (
                <pre className="mx-2 p-2 bg-muted/50 border border-t-0 border-muted text-[11px] font-mono overflow-x-auto max-h-40 overflow-y-auto">
                  {item.content}
                </pre>
              )}
              {(item.stdout || item.stderr) && (
                <div className={cn(
                  "mx-2 p-2 border border-t-0 border-muted rounded-b-lg text-[11px] font-mono overflow-x-auto max-h-48 overflow-y-auto",
                  item.stderr && !item.stdout ? "bg-red-500/5" : "bg-muted/30"
                )}>
                  {item.stdout && <pre className="whitespace-pre-wrap text-muted-foreground">{item.stdout}</pre>}
                  {item.stderr && <pre className="whitespace-pre-wrap text-destructive mt-1">{item.stderr}</pre>}
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    // Brief / thinking
    if (item.type === 'thinking') {
      return (
        <div key={item.id} className="p-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5">
          <button onClick={() => toggleExpanded(item.id)} className="w-full flex items-center gap-2 text-left">
            <BrainCircuit className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400 flex-1">Brief</span>
            <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
          </button>
          {isExpanded && <div className="text-xs text-muted-foreground mt-1.5">{item.content}</div>}
        </div>
      );
    }

    // Subagent
    if (item.type === 'subagent') {
      return (
        <div key={item.id} className="rounded-lg border border-violet-200/50 dark:border-violet-800/30 overflow-hidden">
          <button
            onClick={() => toggleExpanded(item.id)}
            className="w-full flex items-center gap-2 px-2.5 py-2 bg-violet-100/50 dark:bg-violet-900/30 text-left"
          >
            {item.status === 'pending' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500 flex-shrink-0" />
            ) : (
              <Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
            )}
            <span className="text-xs font-medium text-violet-700 dark:text-violet-300 flex-1 truncate">
              Subagent {item.subagentId != null ? `#${item.subagentId}` : ''}
            </span>
            {item.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
            <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-90")} />
          </button>
          {isExpanded && (
            <>
              <div className="px-2.5 py-2 border-t border-violet-200/30 dark:border-violet-800/20">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Instruction</p>
                <div className="text-xs text-muted-foreground">{item.content}</div>
              </div>
              {item.response ? (
                <div className="px-2.5 py-2 bg-violet-50/30 dark:bg-violet-950/20 max-h-60 overflow-y-auto border-t border-violet-200/30 dark:border-violet-800/20">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Output</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                    <Markdown>{item.response}</Markdown>
                  </div>
                </div>
              ) : item.status === 'pending' ? (
                <div className="px-2.5 py-2 flex items-center gap-2 text-muted-foreground text-xs border-t border-violet-200/30 dark:border-violet-800/20">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Working...</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      );
    }

    // Verification
    if (item.type === 'verification') {
      return (
        <div key={item.id} className={cn(
          "p-2.5 rounded-lg border",
          item.isError ? "border-destructive/30 bg-destructive/5" : "border-amber-500/20 bg-amber-500/5"
        )}>
          <button onClick={() => hasOutput ? toggleExpanded(item.id) : undefined} className={cn("w-full flex items-center gap-2 text-left", hasOutput && "cursor-pointer")}>
            <AlertTriangle className={cn("w-3.5 h-3.5 flex-shrink-0", item.isError ? "text-destructive" : "text-amber-500")} />
            <span className={cn("text-xs font-medium flex-1", item.isError ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
              Verification {item.attempt != null ? `#${item.attempt}` : ''} {item.isError ? '(Error)' : ''}
            </span>
            {hasOutput && <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />}
          </button>
          {isExpanded && item.verificationResult && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs mt-1.5">
              <Markdown>{item.verificationResult}</Markdown>
            </div>
          )}
        </div>
      );
    }

    // Model output
    if (item.type === 'model_output') {
      return (
        <div key={item.id} className="p-2.5 rounded-lg border border-muted bg-muted/20">
          <button onClick={() => toggleExpanded(item.id)} className="w-full flex items-center gap-2 text-left">
            <BrainCircuit className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium text-muted-foreground flex-1">Model</span>
            <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
          </button>
          {isExpanded && <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto mt-1.5">{item.content}</div>}
        </div>
      );
    }

    // Answer
    if (item.type === 'answer') {
      return (
        <div key={item.id} className="p-2.5 rounded-lg border border-green-500/20 bg-green-500/5">
          <button onClick={() => toggleExpanded(item.id)} className="w-full flex items-center gap-2 text-left">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            <span className="text-xs font-medium text-green-700 dark:text-green-400 flex-1">Answer</span>
            <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
          </button>
          {isExpanded && (
            <div className="text-xs text-muted-foreground mt-1.5">
              <Markdown className="text-xs">{item.content || ''}</Markdown>
            </div>
          )}
        </div>
      );
    }

    // Plan (auto-generated brief + plan in plan mode)
    if (item.type === 'plan') {
      return (
        <div key={item.id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
          <button
            onClick={() => toggleExpanded(item.id)}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
          >
            <MapIcon className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex-1">Auto-generated Plan</span>
            <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-90")} />
          </button>
          {isExpanded && (
            <div className="border-t border-emerald-500/10">
              {item.content && (
                <div className="px-2.5 py-2 border-b border-emerald-500/10">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Brief</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                    <Markdown>{item.content}</Markdown>
                  </div>
                </div>
              )}
              {item.response && (
                <div className="px-2.5 py-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Plan</p>
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                    <Markdown>{item.response}</Markdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Question
    if (item.type === 'question') {
      return (
        <div key={item.id} className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Question</span>
          </div>
          <div className="text-xs text-muted-foreground">{item.content}</div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-12 border-b flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <span className="font-medium text-sm">Sandbox</span>
          {(fs.hasProject || demoMode) && (
            <>
              <Separator orientation="vertical" className="h-5" />
              <span className="text-sm text-muted-foreground">
                {demoMode ? 'my-project' : fs.projectName}
              </span>
            </>
          )}
          {demoMode && <Badge variant="secondary" className="text-[10px]">Demo</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {demoMode && (
            <div className="flex items-center gap-1 mr-2">
              {(['idle', 'executing', 'question', 'completed'] as const).map((state) => (
                <Button key={state} variant={demoState === state ? 'default' : 'ghost'} size="sm" className="h-6 text-[10px] px-2" onClick={() => setDemoState(state)}>
                  {state}
                </Button>
              ))}
            </div>
          )}
          {!demoMode && status === 'completed' && (
            <>
              <Button onClick={handleCopyCommandLog} variant="outline" size="sm" className="h-7 text-xs gap-1">
                <ClipboardCopy className="w-3 h-3" />
                Copy Log
              </Button>
              <Button onClick={handleNewTask} variant="outline" size="sm" className="h-7 text-xs gap-1">
                <Plus className="w-3 h-3" />
                New Task
              </Button>
            </>
          )}
          <Badge variant="outline" className="font-mono text-[10px]">
            {sessionId.slice(0, 8)}
          </Badge>
          {demoMode ? (
            <Button onClick={() => setDemoMode(false)} variant="ghost" size="sm" className="h-7 text-xs">Exit Demo</Button>
          ) : fs.hasProject ? (
            <Button onClick={() => fs.closeProject()} variant="ghost" size="sm" className="h-7 text-xs">Close</Button>
          ) : (
            <Button onClick={handleOpenProject} size="sm" className="h-7 text-xs">
              <FolderOpen className="w-3 h-3 mr-1.5" />
              Open Folder
            </Button>
          )}
        </div>
      </header>

      {/* Main three-panel layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Files */}
        <aside className="w-56 border-r flex flex-col flex-shrink-0 bg-muted/30">
          <div className="h-9 px-3 flex items-center justify-between border-b bg-background/50">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Files</span>
            {(fs.hasProject || demoMode) && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadRootFiles}>
                <RefreshCw className="w-3 h-3" />
              </Button>
            )}
          </div>
          {!fs.hasProject && !demoMode ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <FolderTree className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground mb-3">No folder open</p>
                <Button onClick={handleOpenProject} variant="outline" size="sm" className="h-7 text-xs">
                  <FolderOpen className="w-3 h-3 mr-1.5" />
                  Open
                </Button>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-1">
                {files.length > 0 ? renderFileTree(files) : (
                  <div className="p-4 text-center text-muted-foreground text-xs">Empty</div>
                )}
              </div>
            </ScrollArea>
          )}
          {(fs.hasStagedFiles || (demoMode && demoState === 'completed')) && (
            <div className="border-t p-2 bg-amber-500/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {demoMode ? DEMO_STAGED_FILES.length : fs.stagedFiles.size} staged
                </span>
                <Button onClick={() => !demoMode && fs.commitAllFiles()} variant="ghost" size="sm" className="h-6 text-[10px] text-amber-600 hover:text-amber-700">
                  Commit All
                </Button>
              </div>
            </div>
          )}
        </aside>

        {/* ═══════════ Center Panel ═══════════ */}
        <main className="flex-1 flex flex-col min-w-0 border-r">

          {/* ── IDLE: Hero task form ── */}
          {isIdle ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-lg space-y-5">
                {/* Title */}
                <div className="text-center">
                  <h2 className="text-lg font-semibold mb-1">
                    {fs.hasProject || demoMode ? 'New task' : 'Open a project to start'}
                  </h2>
                  {(fs.hasProject || demoMode) && (
                    <p className="text-sm text-muted-foreground">Describe what you want to do with your files.</p>
                  )}
                </div>

                {!hasAnyApiKey && (
                  <div className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs">
                    <span>No API key configured</span>
                    <Link
                      to="/profile"
                      className="font-medium underline hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
                    >
                      Add API Key
                    </Link>
                  </div>
                )}

                {(fs.hasProject || demoMode) && (
                  <>
                    {/* Task input with model dropdown */}
                    <div className="relative">
                      <Textarea
                        ref={taskInputRef}
                        value={taskInput}
                        onChange={(e) => setTaskInput(e.target.value)}
                        placeholder="What would you like to do?"
                        className="min-h-[100px] text-sm resize-none pb-10"
                        disabled={demoMode}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !demoMode) {
                            e.preventDefault();
                            handleSubmit();
                          }
                        }}
                      />
                      <div className="absolute bottom-2 right-2">
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value as Provider)}
                          disabled={displayProviders.length === 0}
                          className="h-7 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground hover:bg-muted/50 cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          {displayProviders.length === 0 && (
                            <option value="">No provider</option>
                          )}
                          {displayProviders.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Mode selector */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mode</label>
                      <div className="flex gap-2">
                        {MODE_OPTIONS.map(opt => {
                          const Icon = opt.icon;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setMode(opt.value)}
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
                    </div>

                    {/* Plan textarea (plan mode) */}
                    {mode === 'plan' && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan</label>
                        <Textarea
                          value={planText}
                          onChange={(e) => setPlanText(e.target.value)}
                          placeholder="## Steps\n1. Research...\n2. Draft...\n3. Refine..."
                          className="min-h-[80px] text-xs font-mono resize-none"
                        />
                      </div>
                    )}

                    {/* Num takes (explore mode) */}
                    {mode === 'explore' && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of takes</label>
                        <div className="flex gap-2">
                          {[2, 3, 4, 5].map(n => (
                            <button
                              key={n}
                              onClick={() => setNumTakes(n)}
                              className={cn(
                                "w-10 h-8 rounded-md border text-sm font-medium transition-colors",
                                numTakes === n
                                  ? "border-primary bg-primary/5 text-foreground"
                                  : "border-input text-muted-foreground hover:bg-muted/50"
                              )}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Submit */}
                    <Button
                      onClick={demoMode ? () => setDemoState('executing') : handleSubmit}
                      disabled={!demoMode && !taskInput.trim()}
                      className="w-full"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Run Task
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* ── ACTIVE: Task bar + tabs + content + iterate input ── */
            <>
              {/* Task bar */}
              <div className="h-10 px-4 flex items-center gap-3 border-b bg-muted/10 flex-shrink-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {status === 'executing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />
                  ) : status === 'completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  ) : status === 'error' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
                  ) : null}
                  <span className="text-sm truncate text-muted-foreground">
                    {currentTask || result?.task || 'Running...'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Badge variant="outline" className="text-[10px] h-5">{mode}</Badge>
                  <Badge variant="outline" className="text-[10px] h-5">{provider}</Badge>
                  {pendingTool && (
                    <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      {pendingTool.request.tool}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Tab header */}
              <div className="h-9 px-2 flex items-center border-b bg-muted/20 flex-shrink-0">
                <button
                  onClick={() => setCenterTab('activity')}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2 transition-colors",
                    centerTab === 'activity' ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  Activity
                </button>
                <button
                  onClick={() => setCenterTab('files')}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2 transition-colors",
                    centerTab === 'files' ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FileText className="w-3 h-3" />
                  Files
                  {selectedFile && (
                    <span className="text-[10px] font-mono text-muted-foreground ml-1">{selectedFile.split('/').pop()}</span>
                  )}
                </button>
                <div className="flex-1" />
                {status === 'completed' && activity.length > 0 && (
                  <Button
                    onClick={() => setCheckpointPickerOpen(true)}
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <GitBranch className="w-3 h-3" />
                    Run from checkpoint
                  </Button>
                )}
              </div>

              {/* Tab content */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Activity tab */}
                {centerTab === 'activity' && (
                  <>
                    {/* Final result - top 2/3, only when complete */}
                    {result && (
                      <div className="h-2/3 border-b overflow-auto">
                        <div className="px-4 pt-2 pb-1 flex items-center justify-end gap-1 flex-shrink-0">
                          <Button onClick={handleSaveOutputOpen} variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground">
                            <Save className="w-3 h-3" />
                            Save as file
                          </Button>
                        </div>
                        <div className="px-4 pb-4">
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Markdown>{result.answer}</Markdown>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Activity stream */}
                    <div className={cn("overflow-auto", result ? "h-1/3" : "flex-1")}>
                      <div className="p-4 space-y-3">
                        {error && (
                          <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
                            <div className="flex items-center gap-2 text-destructive">
                              <AlertTriangle className="w-4 h-4" />
                              <span className="text-sm font-medium">Error</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{error}</p>
                          </div>
                        )}

                        {activity.map((item, index) => renderActivityItem(item, index))}

                        {/* Staged files */}
                        {(demoMode ? demoState === 'completed' : fs.hasStagedFiles && status !== 'idle') && (
                          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <div className="flex items-center gap-2 mb-2">
                              <FileCode className="w-4 h-4 text-amber-600" />
                              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Modified Files</span>
                            </div>
                            <div className="space-y-1">
                              {(demoMode ? DEMO_STAGED_FILES : Array.from(fs.stagedFiles.keys())).map(path => (
                                <div key={path} className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-muted-foreground truncate">{path}</span>
                                  <div className="flex items-center gap-1">
                                    <Button onClick={() => !demoMode && handleSelectFile(path)} variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]">View</Button>
                                    <Button onClick={() => !demoMode && handleCommitFile(path)} variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-green-600">
                                      <CheckCircle2 className="w-3 h-3" />
                                    </Button>
                                    <Button onClick={() => !demoMode && handleDiscardStaged(path)} variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive">
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div ref={artifactEndRef} />
                      </div>
                    </div>
                  </>
                )}

                {/* Files tab */}
                {centerTab === 'files' && (
                  <div className="flex-1 flex flex-col min-h-0">
                    {selectedFile ? (
                      <>
                        <div className="h-9 px-4 flex items-center justify-between border-b bg-muted/10 flex-shrink-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileCode className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-xs font-mono truncate">{selectedFile}</span>
                            {fs.stagedFiles.has(selectedFile) && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-600 border-amber-500/30">staged</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {fs.stagedFiles.has(selectedFile) && (
                              <>
                                <Button onClick={() => handleCommitFile(selectedFile)} variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-green-600 hover:text-green-700">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />Commit
                                </Button>
                                <Button onClick={() => handleDiscardStaged(selectedFile)} variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive">
                                  <Trash2 className="w-3 h-3 mr-1" />Discard
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedFile(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto min-h-0">
                          {isBinaryFile(selectedFile) ? (
                            <div className="flex-1 flex items-center justify-center p-8">
                              <div className="text-center">
                                <FileArchive className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                                <p className="text-sm font-medium mb-1">{selectedFile.split('/').pop()}</p>
                                <p className="text-xs text-muted-foreground mb-4">Binary file ({fs.stagedFiles.get(selectedFile) ? 'staged' : 'local'})</p>
                                <Button onClick={() => handleDownloadFile(selectedFile)} variant="outline" size="sm" className="gap-1.5">
                                  <Download className="w-3.5 h-3.5" />Download
                                </Button>
                              </div>
                            </div>
                          ) : selectedFile.endsWith('.md') ? (
                            <div className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-wrap-anywhere">
                              <Markdown>{fileContent}</Markdown>
                            </div>
                          ) : (
                            <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">{fileContent}</pre>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-8">
                        <div className="text-center">
                          <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">Select a file from the sidebar to view</p>
                          {fs.hasStagedFiles && (
                            <div className="mt-4 space-y-1">
                              <p className="text-xs text-muted-foreground mb-2">Staged files:</p>
                              {Array.from(fs.stagedFiles.keys()).map(path => (
                                <button key={path} onClick={() => handleSelectFile(path)} className="block w-full text-left px-3 py-1.5 text-xs font-mono rounded hover:bg-muted/50 text-amber-600 dark:text-amber-400">
                                  {path}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Iterate input - only when completed */}
              {status === 'completed' && (
                <div className="border-t p-3 bg-background">
                  <div className="flex gap-2">
                    <Textarea
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      placeholder="Send feedback to iterate on this task..."
                      disabled={demoMode}
                      className="min-h-[40px] max-h-[120px] text-sm resize-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !demoMode) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                    />
                    <Button
                      onClick={handleSubmit}
                      disabled={!taskInput.trim()}
                      size="sm"
                      className="h-10 px-3"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* Right Panel - Activity Log */}
        <aside className="w-72 flex flex-col flex-shrink-0 bg-muted/20">
          <div className="h-9 px-3 flex items-center border-b bg-background/50">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground mr-2" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Activity</span>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {pendingQuestion && (
                <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium">AI needs input</span>
                  </div>
                  {pendingQuestion.context && (
                    <p className="text-xs text-muted-foreground mb-3">{pendingQuestion.context}</p>
                  )}
                  {pendingQuestion.questions.map((q, idx) => (
                    <div key={idx} className="mb-3">
                      <label className="text-xs font-medium block mb-1.5">{q.question}</label>
                      {q.options && q.options.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {q.options.map((opt, optIdx) => (
                            <button
                              key={optIdx}
                              onClick={() => handleQuestionAnswer(idx, opt)}
                              className={cn(
                                "px-2 py-1 text-xs rounded-md border transition-colors",
                                questionAnswers[String(idx)] === opt
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-background hover:bg-muted border-input"
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <input
                        type="text"
                        placeholder="Type answer..."
                        value={questionAnswers[String(idx)] || ''}
                        onChange={(e) => handleQuestionAnswer(idx, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs rounded-md border bg-background"
                      />
                    </div>
                  ))}
                  <Button onClick={handleSubmitAnswers} size="sm" className="w-full h-7 text-xs" disabled={pendingQuestion.questions.some((_, idx) => !questionAnswers[String(idx)])}>
                    Submit
                  </Button>
                </div>
              )}

              {activity.length === 0 && !pendingQuestion && status !== 'executing' && (
                <div className="text-center py-8 text-muted-foreground">
                  <ListTree className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Activity will appear here</p>
                </div>
              )}

              {activity.length === 0 && status === 'executing' && !pendingQuestion && (
                <div className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-primary" />
                  <p className="text-xs">Connecting...</p>
                </div>
              )}

              {activity.map((item) => (
                <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    item.status === 'pending' ? "bg-primary animate-pulse" :
                    item.status === 'error' ? "bg-destructive" :
                    item.status === 'success' ? "bg-green-500" :
                    item.type === 'thinking' ? "bg-blue-500" :
                    item.type === 'subagent' ? "bg-violet-500" :
                    item.type === 'verification' ? "bg-amber-500" :
                    item.type === 'model_output' ? "bg-muted-foreground" :
                    item.type === 'answer' ? "bg-green-500" :
                    item.type === 'plan' ? "bg-emerald-500" :
                    "bg-muted-foreground"
                  )} />
                  <span className="text-muted-foreground truncate">
                    {item.type === 'tool_call' && `${item.tool} ${(item.args?.path as string) || ''}`}
                    {item.type === 'thinking' && 'Brief'}
                    {item.type === 'subagent' && `Subagent #${item.subagentId ?? ''}`}
                    {item.type === 'model_output' && 'Model output'}
                    {item.type === 'verification' && `Verification #${item.attempt ?? ''}`}
                    {item.type === 'answer' && 'Answer'}
                    {item.type === 'plan' && 'Auto-generated Plan'}
                    {item.type === 'question' && 'Question'}
                  </span>
                </div>
              ))}

              <div ref={activityEndRef} />
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* ═══ Branch Dialog ═══ */}
      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4" />
              Branch from checkpoint
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a new iteration starting from this point in the execution.
            </DialogDescription>
          </DialogHeader>

          {branchFromIndex >= 0 && activity[branchFromIndex] && (
            <div className="space-y-3">
              {/* Checkpoint summary */}
              <div className="p-2 rounded-md bg-muted/50 border text-xs">
                <span className="text-muted-foreground">Step {branchFromIndex + 1}: </span>
                <span className="font-medium">
                  {activity[branchFromIndex].type === 'tool_call'
                    ? `${activity[branchFromIndex].tool} ${(activity[branchFromIndex].args?.path as string) || ''}`
                    : activity[branchFromIndex].type === 'answer'
                    ? 'Answer'
                    : activity[branchFromIndex].type === 'verification'
                    ? `Verification #${activity[branchFromIndex].attempt}`
                    : activity[branchFromIndex].type}
                </span>
              </div>

              {/* Feedback */}
              <Textarea
                value={branchFeedback}
                onChange={(e) => setBranchFeedback(e.target.value)}
                placeholder="What should change from this point forward?"
                className="min-h-[80px] text-sm resize-none"
                autoFocus
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBranchDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleBranch} disabled={!branchFeedback.trim()} className="gap-1.5">
              <GitBranch className="w-3 h-3" />
              Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save-as-file dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Save className="w-4 h-4" />
              Save as file
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose a file name for the output.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={saveFileName}
            onChange={(e) => setSaveFileName(e.target.value)}
            placeholder="output.md"
            className="text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveOutputConfirm();
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveOutputConfirm} disabled={!saveFileName.trim()} className="gap-1.5">
              <Save className="w-3 h-3" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkpoint picker dialog */}
      <Dialog open={checkpointPickerOpen} onOpenChange={setCheckpointPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4" />
              Run from checkpoint
            </DialogTitle>
            <DialogDescription className="text-xs">
              Pick a step to branch from. The iteration will start from that point.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-1 pr-3">
              {activity.map((item, index) => {
                const isBranchable = item.status === 'success' || item.type === 'answer' || (item.type === 'verification' && !item.isError);
                if (!isBranchable) return null;
                const label =
                  item.type === 'tool_call' ? `${getToolDisplay(item.tool!, item.args || {}).label} — ${(item.args?.path as string) || (item.tool === 'execute_code' ? 'JS' : '')}` :
                  item.type === 'answer' ? 'Answer' :
                  item.type === 'subagent' ? `Subagent #${item.subagentId ?? ''}` :
                  item.type === 'verification' ? `Verification #${item.attempt ?? ''}` :
                  item.type;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleOpenBranch(index)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs hover:bg-muted/60 transition-colors"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground w-5 text-right flex-shrink-0">{index + 1}</span>
                    {item.type === 'tool_call' && <Play className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                    {item.type === 'answer' && <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />}
                    {item.type === 'subagent' && <Bot className="w-3 h-3 text-violet-500 flex-shrink-0" />}
                    {item.type === 'verification' && <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    <span className="truncate text-muted-foreground">{label}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SandboxPage;
