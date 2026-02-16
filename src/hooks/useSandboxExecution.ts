/**
 * Sandbox Execution Hook
 *
 * Based on useTaskExecution but adds sandbox tool handling.
 * Listens for tool_request events and executes them locally.
 * Builds activity items directly in processEvent (no useEffect).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  TaskRequest,
  IterateRequest,
  SSEEventType,
  TaskResult,
  TaskStatus,
  UserQuestionEvent,
} from '@/types';
import {
  SandboxToolExecutor,
  generateSessionId,
  type ToolRequest,
  type FileSystemInterface,
} from '@/lib/sandboxExecutor';
import { saveSandboxRun } from '@/lib/firestore';
import { store } from '@/store';

const API_BASE = 'http://localhost:8000';

const SANDBOX_CONFIG = {
  type: 'javascript',
  version: 'ES2022',
  capabilities: ['execute_code', 'read_file', 'write_file', 'list_files', 'search_files', 'delete_file'],
  constraints: [
    'JavaScript executed in isolated browser sandbox',
    'PREFER read_file tool directly to read files — it is the simplest and most reliable way. Do NOT use execute_code just to read a file',
    'search_files does literal text/filename grep — do NOT pass natural language queries to it',
    'Files written via write_file are staged safely and immediately readable by subsequent read_file calls',
    'File paths are relative to the project root (e.g. "readme.md", "src/index.ts"). Do NOT use ".", "/", or absolute paths',
    'execute_code runs JavaScript with these async globals: readFile(path), writeFile(path, content), writeBinaryFile(path, ArrayBuffer|Blob), listFiles(path?), fileExists(path), bash(command)',
    'execute_code also has these library globals: XLSX (SheetJS for Excel), createDocx ({Document,Paragraph,TextRun,HeadingLevel,AlignmentType,Packer} from docx), Uint8Array, ArrayBuffer, Blob, atob, btoa',
    'For binary files: use writeBinaryFile(path, data) inside execute_code, or write_file with encoding="base64"',
    'All file reads check staged (uncommitted) files first, then fall back to project files on disk',
    'To save results: use write_file or writeFile() inside execute_code — do NOT rely on console.log for large outputs',
    'No DOM, no fetch, no network, no Node.js APIs inside execute_code',
    'All file operations are async: use await at top level inside execute_code',
    'There is NO bash/shell tool — do not attempt shell commands. Use the dedicated file tools (read_file, write_file, list_files, search_files) or execute_code instead',
  ].join('. '),
};

interface PendingTool {
  request: ToolRequest;
  startedAt: number;
}

export interface ActivityItem {
  id: string;
  type: 'tool_call' | 'thinking' | 'message' | 'question' | 'answer' | 'subagent' | 'model_output' | 'verification';
  tool?: string;
  args?: Record<string, unknown>;
  content?: string;
  timestamp: Date;
  status?: 'pending' | 'success' | 'error';
  requestId?: string;
  subagentId?: string;
  stdout?: string;
  stderr?: string;
  response?: string;        // subagent response
  attempt?: number;         // verification attempt number
  isError?: boolean;        // verification error flag
  verificationResult?: string;  // verification result text
}

let activityCounter = 0;

export function useSandboxExecution(fs: FileSystemInterface) {
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId] = useState<string>(() => generateSessionId());
  const [brief, setBrief] = useState<string | null>(null);
  const [rubric, setRubric] = useState<string | null>(null);
  const [modelOutput, setModelOutput] = useState<string>('');
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<UserQuestionEvent | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const executorRef = useRef<SandboxToolExecutor | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChunksRef = useRef<Map<string, string>>(new Map()); // key -> accumulated text

  // Initialize executor once
  useEffect(() => {
    executorRef.current = new SandboxToolExecutor(fs, sessionId, {
      apiBase: API_BASE,
      onToolStart: (request) => setPendingTool({ request, startedAt: Date.now() }),
      onToolComplete: (request, result) => {
        setPendingTool(null);
        const resultData = result.data as Record<string, unknown> | undefined;

        // Build a displayable output based on tool type
        let stdout = '';
        let stderr = result.error || '';

        switch (request.tool) {
          case 'execute_code':
            stdout = (resultData?.stdout as string) || '';
            stderr = (resultData?.stderr as string) || stderr;
            break;
          case 'read_file': {
            const content = (resultData?.content as string) || '';
            const size = resultData?.size as number;
            stdout = size != null ? `${size} bytes` : '';
            if (content) {
              const lines = content.split('\n');
              const preview = lines.slice(0, 10).join('\n');
              stdout += (stdout ? '\n' : '') + preview;
              if (lines.length > 10) stdout += `\n... (${lines.length} lines total)`;
            }
            break;
          }
          case 'write_file':
            stdout = `Written ${resultData?.size ?? ''} bytes → ${resultData?.path ?? ''}${resultData?.staged ? ' (staged)' : ''}`;
            break;
          case 'list_files': {
            const entries = (resultData?.entries as Array<{ name: string; is_directory?: boolean }>) || [];
            stdout = entries.map(e => `${e.is_directory ? '📁' : '  '} ${e.name}`).join('\n');
            if (entries.length === 0) stdout = '(empty)';
            break;
          }
          case 'search_files': {
            const matches = (resultData?.matches as Array<{ path: string; line?: number }>) || [];
            stdout = matches.length > 0
              ? matches.slice(0, 20).map(m => `${m.path}${m.line ? `:${m.line}` : ''}`).join('\n')
                + (matches.length > 20 ? `\n... (${matches.length} total)` : '')
              : 'No matches';
            break;
          }
          case 'delete_file':
            stdout = `Deleted ${resultData?.path ?? ''} (staged)`;
            break;
        }

        setActivity(prev => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].type === 'tool_call' && prev[i].status === 'pending') { idx = i; break; }
          }
          if (idx < 0) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: result.success ? 'success' : 'error',
            stdout: stdout || undefined,
            stderr: stderr || undefined,
          };
          return updated;
        });
      },
    });
  }, [fs, sessionId]);

  const reset = useCallback(() => {
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    pendingChunksRef.current.clear();
    setStatus('idle');
    setActivity([]);
    setResult(null);
    setError(null);
    setRunId(null);
    setBrief(null);
    setRubric(null);
    setModelOutput('');
    setPendingTool(null);
    setPendingQuestion(null);
  }, []);

  const addActivity = (item: Omit<ActivityItem, 'id' | 'timestamp'>) => {
    setActivity(prev => [...prev, {
      ...item,
      id: `act-${++activityCounter}`,
      timestamp: new Date(),
    }]);
  };

  // Shared event processing logic used by both runTask and iterate
  const processSharedEvent = useCallback((eventType: SSEEventType | 'tool_request' | 'message', data: unknown) => {
    const typedData = data as Record<string, unknown>;

    // Handle sandbox tool requests
    if (eventType === 'tool_request') {
      const toolRequest = typedData as unknown as ToolRequest;

      const toolContent =
        toolRequest.tool === 'execute_code' ? (toolRequest.args.code as string) :
        (toolRequest.tool === 'bash' || toolRequest.tool === 'shell' || toolRequest.tool === 'run_command')
          ? (toolRequest.args.command as string || toolRequest.args.cmd as string)
          : undefined;

      addActivity({
        type: 'tool_call',
        tool: toolRequest.tool,
        args: toolRequest.args,
        content: toolContent,
        status: 'pending',
        requestId: toolRequest.request_id,
      });

      // Execute in background - don't block
      executorRef.current?.handleToolRequest(toolRequest).catch(console.error);
      return true; // Handled
    }

    switch (eventType) {
      case 'thinking_chunk': {
        const chunk = typedData.content as string;
        const cur = pendingChunksRef.current.get('thinking') || '';
        pendingChunksRef.current.set('thinking', cur + chunk);
        scheduleFlush();
        return true;
      }

      case 'model_chunk': {
        const chunk = typedData.content as string;
        setModelOutput(prev => prev + chunk);
        // Accumulate in ref, flush on timer
        const cur = pendingChunksRef.current.get('model') || '';
        pendingChunksRef.current.set('model', cur + chunk);
        scheduleFlush();
        return true;
      }

      case 'subagent_start': {
        const sid = String(typedData.subagent_id);
        // Deduplicate — only add if this subagent_id isn't already in activity
        setActivity(prev => {
          const exists = prev.some(a => a.type === 'subagent' && a.subagentId === sid);
          if (exists) return prev;
          return [...prev, {
            id: `act-${++activityCounter}`,
            type: 'subagent' as const,
            content: typedData.instruction as string,
            subagentId: sid,
            status: 'pending' as const,
            response: '',
            timestamp: new Date(),
          }];
        });
        return true;
      }

      case 'subagent_chunk': {
        // Accumulate in ref, flush on timer
        const sid = String(typedData.subagent_id);
        const key = `subagent_${sid}`;
        const prev = pendingChunksRef.current.get(key) || '';
        pendingChunksRef.current.set(key, prev + (typedData.content as string));
        scheduleFlush();
        return true;
      }

      case 'subagent_end': {
        // subagent_end signals completion — response was already accumulated from subagent_chunk
        const sid = String(typedData.subagent_id);
        setActivity(prev => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].type === 'subagent' && prev[i].subagentId === sid) { idx = i; break; }
          }
          if (idx < 0) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: 'success',
          };
          return updated;
        });
        return true;
      }

      case 'verification_chunk': {
        // Streaming verifier output (Gemini only) — accumulate like model_chunk
        const chunk = typedData.content as string;
        const cur = pendingChunksRef.current.get('verification') || '';
        pendingChunksRef.current.set('verification', cur + chunk);
        scheduleFlush();
        return true;
      }

      case 'verification':
        addActivity({
          type: 'verification',
          content: typedData.answer as string,
          attempt: typedData.attempt as number,
          isError: typedData.is_error as boolean,
          verificationResult: typedData.result as string,
        });
        return true;

      case 'answer':
        addActivity({
          type: 'answer',
          content: typedData.content as string,
        });
        return true;

      default:
        return false; // Not handled
    }
  }, []);

  // Flush accumulated chunks to activity state every 150ms
  const scheduleFlush = () => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const chunks = pendingChunksRef.current;
      if (chunks.size === 0) return;

      const thinkingChunk = chunks.get('thinking');
      const modelChunk = chunks.get('model');
      const subagentChunks: Array<[string | number, string]> = [];
      for (const [key, val] of chunks) {
        if (key.startsWith('subagent_')) {
          subagentChunks.push([key.slice(9), val]);
        }
      }
      chunks.clear();

      setActivity(prev => {
        const updated = [...prev];

        // Flush thinking chunks
        if (thinkingChunk) {
          let idx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === 'thinking') { idx = i; break; }
          }
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], content: (updated[idx].content || '') + thinkingChunk };
          } else {
            updated.push({
              id: `act-${++activityCounter}`,
              type: 'thinking',
              content: thinkingChunk,
              timestamp: new Date(),
            });
          }
        }

        // Flush model chunks
        if (modelChunk) {
          let idx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === 'model_output') { idx = i; break; }
          }
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], content: (updated[idx].content || '') + modelChunk };
          } else {
            updated.push({
              id: `act-${++activityCounter}`,
              type: 'model_output',
              content: modelChunk,
              timestamp: new Date(),
            });
          }
        }

        // Flush subagent chunks
        for (const [sid, text] of subagentChunks) {
          let idx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === 'subagent' && String(updated[i].subagentId) === String(sid)) { idx = i; break; }
          }
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              response: (updated[idx].response || '') + text,
            };
          }
        }

        return updated;
      });
    }, 150);
  };

  const runTask = useCallback(async (request: TaskRequest) => {
    setStatus('executing');
    setActivity([]);
    setResult(null);
    setError(null);
    setRunId(null);
    setBrief(null);
    setRubric(null);
    setModelOutput('');
    setPendingTool(null);
    setPendingQuestion(null);

    abortControllerRef.current = new AbortController();

    const userId = store.getState().auth.user?.uid;
    if (!userId) {
      setError('User not authenticated');
      setStatus('error');
      return;
    }

    const sandboxRequest = {
      ...request,
      user_id: userId,
      sandbox_mode: true,
      sandbox_session_id: sessionId,
      sandbox_config: SANDBOX_CONFIG,
    };

    try {
      const response = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sandboxRequest),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType: SSEEventType | 'tool_request' | 'message' = 'message';
      let dataBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine === '') {
            if (dataBuffer) {
              try {
                const data = JSON.parse(dataBuffer);
                processEvent(currentEventType, data);
              } catch {
                // JSON incomplete
              }
              dataBuffer = '';
            }
            currentEventType = 'message';
          } else if (trimmedLine.startsWith('event:')) {
            currentEventType = trimmedLine.slice(6).trim() as SSEEventType | 'tool_request';
          } else if (trimmedLine.startsWith('data:')) {
            const dataContent = trimmedLine.slice(5).trim();
            dataBuffer += dataBuffer ? '\n' + dataContent : dataContent;
          }
        }
      }

      if (dataBuffer) {
        try {
          const data = JSON.parse(dataBuffer);
          processEvent(currentEventType, data);
        } catch {
          // Incomplete
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Execution failed';
      setError(message);
      setStatus('error');

      // Persist error run to Firestore
      const uid = store.getState().auth.user?.uid;
      const rid = `sandbox_err_${Date.now()}`;
      if (uid) {
        setActivity(prev => {
          saveSandboxRun(rid, uid, request.task, prev, null, {
            status: 'error',
            error: message,
            mode: request.mode,
            provider: request.provider,
          }).catch((e) => console.error('Failed to save sandbox error run:', e));
          return prev;
        });
      }
    }

    function processEvent(eventType: SSEEventType | 'tool_request' | 'message', data: unknown) {
      const typedData = data as Record<string, unknown>;

      // Try shared event processing first
      if (processSharedEvent(eventType, data)) {
        return; // Handled by shared processor
      }

      // Handle run-specific events
      switch (eventType) {
        case 'run_start':
          setRunId(typedData.run_id as string);
          break;

        case 'brief_start':
          // Brief generation beginning — no activity item yet
          break;

        case 'brief_chunk':
          // Stream brief content incrementally
          setBrief(prev => (prev || '') + (typedData.content as string));
          break;

        case 'brief':
          // Complete brief — overwrite any accumulated chunks
          setBrief(typedData.content as string);
          addActivity({
            type: 'thinking',
            content: typedData.content as string,
          });
          break;

        case 'rubric':
          setRubric(typedData.content as string);
          setRunId(typedData.run_id as string);
          break;

        case 'user_question':
          setPendingQuestion({
            type: 'user_question',
            question_id: typedData.question_id as string,
            questions: typedData.questions as UserQuestionEvent['questions'],
            context: typedData.context as string,
            content: typedData.content as string,
          });
          addActivity({
            type: 'question',
            content: typedData.content as string,
          });
          break;

        case 'result': {
          const taskResult = { task: typedData.task, answer: typedData.answer, rubric: typedData.rubric, run_id: typedData.run_id } as TaskResult;
          setResult(taskResult);
          setStatus('completed');
          // Staged files stay in OPFS — user decides to commit or discard

          // Dump full command log to console for review
          setActivity(prev => {
            const toolCalls = prev.filter(a => a.type === 'tool_call');
            const log = toolCalls.map((tc, i) => ({
              index: i,
              tool: tc.tool,
              args: tc.args,
              status: tc.status,
              stdout: tc.stdout || null,
              stderr: tc.stderr || null,
            }));
            console.group(`[sandbox] Command log — ${toolCalls.length} tool calls`);
            console.table(log.map(l => ({ '#': l.index, tool: l.tool, args: JSON.stringify(l.args).slice(0, 80), status: l.status })));
            console.log('Full log:', JSON.stringify(log, null, 2));
            console.groupEnd();

            // Persist to Firestore
            const uid = store.getState().auth.user?.uid;
            if (uid && taskResult.run_id) {
              saveSandboxRun(
                taskResult.run_id,
                uid,
                taskResult.task,
                prev,
                taskResult,
                { mode: request.mode, provider: request.provider }
              ).catch((err) => console.error('Failed to save sandbox run:', err));
            }

            return prev;
          });
          break;
        }
      }
    }
  }, [sessionId, fs]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setStatus('idle');
    setPendingTool(null);
  }, []);

  const iterate = useCallback(async (request: IterateRequest) => {
    setStatus('executing');
    setError(null);
    setPendingTool(null);
    setPendingQuestion(null);

    // Add a visual separator in activity
    addActivity({
      type: 'thinking',
      content: `Iterating: ${request.feedback || 'continuing task...'}`,
    });

    abortControllerRef.current = new AbortController();

    const userId = store.getState().auth.user?.uid;
    if (!userId) {
      setError('User not authenticated');
      setStatus('error');
      return;
    }

    const iterateRequest = {
      ...request,
      user_id: userId,
      sandbox_mode: true,
      sandbox_session_id: sessionId,
      sandbox_config: SANDBOX_CONFIG,
    };

    try {
      const response = await fetch(`${API_BASE}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(iterateRequest),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType: SSEEventType | 'tool_request' | 'message' = 'message';
      let dataBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine === '') {
            if (dataBuffer) {
              try {
                const data = JSON.parse(dataBuffer);
                processIterateEvent(currentEventType, data);
              } catch {
                // JSON incomplete
              }
              dataBuffer = '';
            }
            currentEventType = 'message';
          } else if (trimmedLine.startsWith('event:')) {
            currentEventType = trimmedLine.slice(6).trim() as SSEEventType | 'tool_request';
          } else if (trimmedLine.startsWith('data:')) {
            const dataContent = trimmedLine.slice(5).trim();
            dataBuffer += dataBuffer ? '\n' + dataContent : dataContent;
          }
        }
      }

      if (dataBuffer) {
        try {
          const data = JSON.parse(dataBuffer);
          processIterateEvent(currentEventType, data);
        } catch {
          // Incomplete
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Iteration failed';
      setError(message);
      setStatus('error');
    }

    function processIterateEvent(eventType: SSEEventType | 'tool_request' | 'message', data: unknown) {
      const typedData = data as Record<string, unknown>;

      // Try shared event processing first
      if (processSharedEvent(eventType, data)) {
        return; // Handled by shared processor
      }

      // Handle iterate-specific events
      switch (eventType) {
        case 'iterate_start':
          setRunId(typedData.run_id as string);
          break;

        case 'iterate_result':
        case 'result': {
          const iterResult: TaskResult = {
            task: request.task || '',
            answer: (typedData.answer as string) || '',
            rubric: (typedData.rubric as string) || request.rubric || '',
            run_id: (typedData.run_id as string) || '',
          };
          setResult(prev => ({
            task: prev?.task || iterResult.task,
            answer: iterResult.answer || prev?.answer || '',
            rubric: iterResult.rubric || prev?.rubric || '',
            run_id: iterResult.run_id || prev?.run_id || '',
          }));
          setRubric((typedData.rubric as string) || null);
          setStatus('completed');

          // Persist iterate result to Firestore
          const uid = store.getState().auth.user?.uid;
          if (uid && iterResult.run_id) {
            setActivity(prev => {
              saveSandboxRun(
                iterResult.run_id,
                uid,
                iterResult.task,
                prev,
                iterResult,
                { provider: request.provider }
              ).catch((err) => console.error('Failed to save sandbox iterate run:', err));
              return prev;
            });
          }
          break;
        }
      }
    }
  }, [sessionId, fs]);

  const respondToQuestion = useCallback(async (questionId: string, answers: Record<string, string>) => {
    try {
      const response = await fetch(`${API_BASE}/question/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, session_id: sessionId, answers }),
      });
      const data = await response.json();
      if (data.acknowledged) setPendingQuestion(null);
    } catch (err) {
      console.error('Failed to respond to question:', err);
    }
  }, [sessionId]);

  return {
    status,
    activity,
    result,
    error,
    runId,
    sessionId,
    brief,
    rubric,
    modelOutput,
    pendingTool,
    pendingQuestion,
    runTask,
    iterate,
    cancel,
    reset,
    respondToQuestion,
  };
}
