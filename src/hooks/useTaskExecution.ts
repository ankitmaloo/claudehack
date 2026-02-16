import { useState, useCallback, useRef } from 'react';
import { store } from '@/store';
import { addEvents, setResult as setReduxResult, updateRunStatus } from '@/store/slices/runsSlice';
import type {
  TaskRequest,
  IterateRequest,
  ResumeRequest,
  IterateResult,
  SSEEvent,
  SSEEventType,
  TaskResult,
  TaskStatus,
  UserQuestionEvent,
} from '@/types';

const API_BASE = 'http://localhost:8000';

export function useTaskExecution() {
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [iterateResult, setIterateResult] = useState<IterateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [rubric, setRubric] = useState<string | null>(null);
  const [modelOutput, setModelOutput] = useState<string>('');
  const [pendingQuestion, setPendingQuestion] = useState<UserQuestionEvent | null>(null);
  const [checkpointIds, setCheckpointIds] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track current runId for dispatching to Redux within the streaming closure
  const currentRunIdRef = useRef<string | null>(null);
  // Buffer events for batched Redux dispatch
  const eventBufferRef = useRef<SSEEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushEventBuffer = useCallback(() => {
    const rid = currentRunIdRef.current;
    if (rid && eventBufferRef.current.length > 0) {
      const batch = [...eventBufferRef.current];
      eventBufferRef.current = [];
      store.dispatch(addEvents({ runId: rid, events: batch }));
    }
    flushTimerRef.current = null;
  }, []);

  const bufferEvent = useCallback((event: SSEEvent) => {
    eventBufferRef.current.push(event);
    // Flush every 500ms or when buffer hits 20 events
    if (eventBufferRef.current.length >= 20) {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushEventBuffer();
    } else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushEventBuffer, 500);
    }
  }, [flushEventBuffer]);

  const reset = useCallback(() => {
    setStatus('idle');
    setEvents([]);
    setResult(null);
    setIterateResult(null);
    setError(null);
    setRunId(null);
    setSessionId(null);
    setBrief(null);
    setRubric(null);
    setModelOutput('');
    setPendingQuestion(null);
    setCheckpointIds([]);
    currentRunIdRef.current = null;
    eventBufferRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const executeWithSSE = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>
  ) => {
    setStatus('executing');
    setEvents([]);
    setError(null);
    setRunId(null);
    setSessionId(null);
    setBrief(null);
    setRubric(null);
    setModelOutput('');
    setPendingQuestion(null);
    currentRunIdRef.current = null;
    eventBufferRef.current = [];

    abortControllerRef.current = new AbortController();

    const userId = store.getState().auth.user?.uid;
    if (!userId) {
      setError('User not authenticated');
      setStatus('error');
      return;
    }

    // Add user_id to the request body
    const requestBody = {
      ...body,
      user_id: userId,
    };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType: SSEEventType | 'message' = 'message';
      let dataBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (separated by double newlines)
        // But also handle line-by-line for simpler cases
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine === '') {
            // Empty line signals end of an event - try to parse accumulated data
            if (dataBuffer) {
              try {
                const data = JSON.parse(dataBuffer);
                processEvent(currentEventType, data);
              } catch {
                // JSON parse failed - data might still be incomplete
              }
              dataBuffer = '';
            }
            currentEventType = 'message';
          } else if (trimmedLine.startsWith('event:')) {
            currentEventType = trimmedLine.slice(6).trim() as SSEEventType;
          } else if (trimmedLine.startsWith('data:')) {
            const dataContent = trimmedLine.slice(5).trim();
            dataBuffer += dataBuffer ? '\n' + dataContent : dataContent;

            // Try to parse immediately for single-line data
            try {
              const data = JSON.parse(dataBuffer);
              processEvent(currentEventType, data);
              dataBuffer = '';
            } catch {
              // JSON incomplete, wait for more data
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (dataBuffer) {
        try {
          const data = JSON.parse(dataBuffer);
          processEvent(currentEventType, data);
        } catch {
          // Incomplete data at end of stream
        }
      }

      // Flush any remaining buffered events
      flushEventBuffer();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'Execution failed';
      setError(message);
      setStatus('error');

      // Flush remaining events and update status in Redux
      flushEventBuffer();
      const rid = currentRunIdRef.current;
      if (rid) {
        store.dispatch(updateRunStatus({ runId: rid, status: 'error', error: message }));
      }
    }

    function processEvent(eventType: SSEEventType | 'message', data: unknown) {
      const typedData = data as Record<string, unknown>;

      switch (eventType) {
        case 'run_start': {
          const rid = typedData.run_id as string;
          const sid = typedData.session_id as string || rid;
          setRunId(rid);
          setSessionId(sid);
          currentRunIdRef.current = rid;
          const event = { type: 'run_start', run_id: rid, session_id: sid, task: typedData.task as string } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'brief_start': {
          const event = { type: 'brief_start', brief_index: typedData.brief_index, instruction: typedData.instruction } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'brief_chunk': {
          // Stream brief content incrementally before the complete brief event
          setBrief(prev => (prev || '') + (typedData.content as string));
          const event = { type: 'brief_chunk', brief_index: typedData.brief_index, content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'brief': {
          // Complete brief — overwrite any accumulated chunks with the final content
          setBrief(typedData.content as string);
          const event = { type: 'brief', content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'rubric': {
          setRubric(typedData.content as string);
          setRunId(typedData.run_id as string);
          const event = { type: 'rubric', run_id: typedData.run_id, content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'thinking_chunk': {
          const event = { type: 'thinking_chunk', content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'model_chunk': {
          setModelOutput(prev => prev + (typedData.content as string));
          const event = { type: 'model_chunk', content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'subagent_start': {
          const event = { type: 'subagent_start', subagent_id: String(typedData.subagent_id), instruction: typedData.instruction } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'subagent_chunk': {
          const event = { type: 'subagent_chunk', subagent_id: String(typedData.subagent_id), content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'subagent_end': {
          const event = { type: 'subagent_end', subagent_id: String(typedData.subagent_id) } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'user_question': {
          // AI is asking for clarification - show dialog to user
          setPendingQuestion({
            type: 'user_question',
            question_id: typedData.question_id as string,
            questions: typedData.questions as UserQuestionEvent['questions'],
            context: typedData.context as string,
            content: typedData.content as string,
          });
          const event = {
            type: 'user_question',
            question_id: typedData.question_id,
            questions: typedData.questions,
            context: typedData.context,
            content: typedData.content,
          } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'verification_chunk': {
          // Streaming verifier output (Gemini only) — accumulate like model_chunk
          const event = { type: 'verification_chunk', content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'verification': {
          const event = { type: 'verification', attempt: typedData.attempt, answer: typedData.answer, result: typedData.result, is_error: typedData.is_error } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'answer': {
          const event = { type: 'answer', content: typedData.content } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'result': {
          const taskResult: TaskResult = {
            task: typedData.task as string,
            answer: typedData.answer as string,
            rubric: typedData.rubric as string,
            run_id: typedData.run_id as string,
            takes: typedData.takes as string[] | undefined,
            set_level_gaps: typedData.set_level_gaps as string | null | undefined,
            briefs: typedData.briefs as string[] | undefined,
          };
          setResult(taskResult);
          setStatus('completed');

          // Flush buffered events then dispatch result to Redux (triggers Firestore save)
          flushEventBuffer();
          const rid = currentRunIdRef.current;
          if (rid) {
            store.dispatch(setReduxResult({ runId: rid, result: taskResult }));
          }
          break;
        }

        case 'iterate_start': {
          setRunId(typedData.run_id as string);
          const event = { type: 'iterate_start', run_id: typedData.run_id, task: typedData.task } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'iterate_result': {
          setIterateResult({ answer: typedData.answer, rubric: typedData.rubric, run_id: typedData.run_id } as IterateResult);
          setRubric(typedData.rubric as string);
          setStatus('completed');
          break;
        }

        case 'checkpoints': {
          // Store session_id and checkpoint_ids for future /resume calls
          setSessionId(typedData.session_id as string);
          setCheckpointIds(typedData.checkpoint_ids as string[]);
          const event = {
            type: 'checkpoints',
            session_id: typedData.session_id,
            checkpoint_ids: typedData.checkpoint_ids,
          } as SSEEvent;
          setEvents(prev => [...prev, event]);
          bufferEvent(event);
          break;
        }

        case 'resume_start': {
          const rid = typedData.run_id as string;
          setRunId(rid);
          setSessionId(typedData.session_id as string || rid);
          currentRunIdRef.current = rid;
          break;
        }

        case 'error': {
          const message = typedData.message as string || 'Unknown error';
          setError(message);
          setStatus('error');
          flushEventBuffer();
          const rid = currentRunIdRef.current;
          if (rid) {
            store.dispatch(updateRunStatus({ runId: rid, status: 'error', error: message }));
          }
          break;
        }

        default:
          // Unknown event type - skip adding to events
          console.warn('Unknown SSE event type:', eventType);
      }
    }
  }, [bufferEvent, flushEventBuffer]);

  const runTask = useCallback(async (request: TaskRequest) => {
    await executeWithSSE('/run', { ...request, checkpoint: true } as unknown as Record<string, unknown>);
  }, [executeWithSSE]);

  const executePlan = useCallback(async (
    task: string,
    planText: string,
    rubricText?: string,
    options?: Partial<TaskRequest>
  ) => {
    await executeWithSSE('/run', {
      task,
      mode: 'plan',
      plan: planText,
      rubric: rubricText,
      provider: options?.provider || 'gemini',
      thinking_level: options?.thinking_level || 'medium',
      enable_search: options?.enable_search ?? false,
      enable_bash: options?.enable_bash ?? false,
      enable_code: options?.enable_code ?? false,
      artifacts_dir: options?.artifacts_dir,
      max_iterations: options?.max_iterations ?? 30,
    });
  }, [executeWithSSE]);

  const iterate = useCallback(async (request: IterateRequest) => {
    setIterateResult(null);
    await executeWithSSE('/iterate', request as unknown as Record<string, unknown>);
  }, [executeWithSSE]);

  const resume = useCallback(async (request: ResumeRequest) => {
    setIterateResult(null);
    await executeWithSSE('/resume', request as unknown as Record<string, unknown>);
  }, [executeWithSSE]);

  const respondToQuestion = useCallback(async (questionId: string, answers: Record<string, string>) => {
    if (!sessionId) {
      console.error('No session ID available for question response');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/question/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          session_id: sessionId,
          answers,
        }),
      });

      const data = await response.json();
      if (data.acknowledged) {
        setPendingQuestion(null);
      } else {
        console.error('Question response not acknowledged:', data.error);
      }
    } catch (err) {
      console.error('Failed to respond to question:', err);
    }
  }, [sessionId]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setStatus('idle');
  }, []);

  return {
    status,
    events,
    result,
    iterateResult,
    error,
    runId,
    sessionId,
    checkpointIds,
    brief,
    rubric,
    modelOutput,
    pendingQuestion,
    runTask,
    executePlan,
    iterate,
    resume,
    respondToQuestion,
    cancel,
    reset,
  };
}
