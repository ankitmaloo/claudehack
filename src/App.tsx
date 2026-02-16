import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { TaskInput } from '@/components/TaskInput';
import { RubricPanel } from '@/components/RubricPanel';
import { ExecutionView } from '@/components/ExecutionView';
import { FinalOutput } from '@/components/FinalOutput';
import { PlanCanvas } from '@/components/PlanCanvas';
import { ComparisonView } from '@/components/ComparisonView';
import { SandboxPage } from '@/components/SandboxPage';
import { SharedRunView } from '@/components/SharedRunView';
import { UserQuestionDialog } from '@/components/UserQuestionDialog';
import { AuthPage } from '@/components/AuthPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DashboardPage } from '@/components/DashboardPage';
import { useTaskExecution } from '@/hooks/useTaskExecution';
import { useAuth } from '@/context/AuthContext';
import { useAppSelector, useAppDispatch } from '@/store';
import {
  createRun,
  updateRun,
  setCurrentRun,
  setPrimaryVersion,
  addLinkedVersion,
  addBranch,
  setRunFromFirestore,
} from '@/store/slices/runsSlice';
import type { RunData } from '@/store/slices/runsSlice';
import { fetchRunWithEvents, createSharedDoc, markRunAsVersionChild, saveBranchMetadata } from '@/lib/firestore';
import { getCachedRun, setCachedRun } from '@/lib/cache';
import {
  mockTask,
  mockPlan,
  mockRubric,
  mockEvents,
  mockResult,
  mockExploreTask,
  mockExploreResult,
  mockExploreEvents,
  mockIterateResult,
  createMockStream,
} from '@/lib/mockData';
import type { Attachment, AttachedFile, ExecutionMode, SSEEvent, TaskResult, TaskStatus, Checkpoint, BranchRef } from '@/types';
import type { Provider } from '@/components/TaskInput';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// Demo state type
type DemoState = 'idle' | 'input' | 'planning' | 'executing' | 'completed';

// --- SSE streaming helper ---
interface SSECallbacks {
  onEvent: (event: SSEEvent) => void;
  onResult: (result: TaskResult, serverRunId: string) => void;
  onCheckpoints?: (sessionId: string, checkpointIds: string[]) => void;
}

async function streamSSE(response: Response, callbacks: SSECallbacks): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = '';
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
        if (dataBuffer && currentEventType) {
          try {
            const data = JSON.parse(dataBuffer);
            processSSEEvent(currentEventType, data, callbacks);
          } catch {
            // JSON parse failed
          }
          dataBuffer = '';
        }
        currentEventType = '';
      } else if (trimmedLine.startsWith('event:')) {
        currentEventType = trimmedLine.slice(6).trim();
      } else if (trimmedLine.startsWith('data:')) {
        const dataContent = trimmedLine.slice(5).trim();
        dataBuffer += dataBuffer ? '\n' + dataContent : dataContent;

        if (currentEventType) {
          try {
            const data = JSON.parse(dataBuffer);
            processSSEEvent(currentEventType, data, callbacks);
            dataBuffer = '';
          } catch {
            // JSON incomplete, wait for more data
          }
        }
      }
    }
  }
}

function processSSEEvent(eventType: string, data: Record<string, unknown>, callbacks: SSECallbacks) {
  const eventMap: Record<string, () => SSEEvent | null> = {
    thinking_chunk: () => ({ type: 'thinking_chunk', content: data.content as string }),
    model_chunk: () => ({ type: 'model_chunk', content: data.content as string }),
    subagent_start: () => ({ type: 'subagent_start', subagent_id: String(data.subagent_id), instruction: data.instruction as string }),
    subagent_chunk: () => ({ type: 'subagent_chunk', subagent_id: String(data.subagent_id), content: data.content as string }),
    subagent_end: () => ({ type: 'subagent_end', subagent_id: String(data.subagent_id) }),
    brief_start: () => ({ type: 'brief_start', brief_index: data.brief_index as number, instruction: data.instruction as string }),
    brief_chunk: () => ({ type: 'brief_chunk', brief_index: data.brief_index as number, content: data.content as string }),
    brief: () => ({ type: 'brief', content: data.content as string }),
    verification_chunk: () => ({ type: 'verification_chunk', content: data.content as string }),
    verification: () => ({ type: 'verification', attempt: data.attempt as number, answer: data.answer as string, result: data.result as string, is_error: data.is_error as boolean }),
    answer: () => ({ type: 'answer', content: data.content as string }),
  };

  if (eventType === 'result' || eventType === 'iterate_result') {
    const serverRunId = data.run_id as string;
    const result: TaskResult = {
      task: data.task as string,
      answer: data.answer as string,
      rubric: data.rubric as string,
      run_id: serverRunId,
    };
    callbacks.onResult(result, serverRunId);
    return;
  }

  if (eventType === 'checkpoints') {
    callbacks.onCheckpoints?.(data.session_id as string, data.checkpoint_ids as string[]);
    return;
  }

  const factory = eventMap[eventType];
  if (factory) {
    const event = factory();
    if (event) callbacks.onEvent(event);
  }
}

// --- Timeline reconstruction ---
function detectStepType(event: SSEEvent): string | null {
  switch (event.type) {
    case 'brief_start':
    case 'brief_chunk':
    case 'brief': return 'brief';
    case 'subagent_start':
    case 'subagent_chunk':
    case 'subagent_end': return 'subagent';
    case 'verification_chunk':
    case 'verification': return 'verification';
    case 'answer': return 'answer';
    default: return null;
  }
}

function computeCheckpointIndex(events: SSEEvent[], checkpoint?: Checkpoint): number {
  if (!checkpoint) return events.length;
  for (let i = 0; i < events.length; i++) {
    const stepType = detectStepType(events[i]);
    if (stepType === checkpoint) return i; // Cut BEFORE this step
  }
  return events.length;
}

function reconstructBranchTimeline(
  branchRun: RunData,
  allRuns: Record<string, RunData>
): SSEEvent[] {
  if (!branchRun.branchMetadata) return branchRun.events;

  const { parentRunId, checkpoint } = branchRun.branchMetadata;
  const parentRun = allRuns[parentRunId];
  if (!parentRun) return branchRun.events;

  // Recursive (handles branch-from-branch)
  const parentTimeline = reconstructBranchTimeline(parentRun, allRuns);

  const cutoff = computeCheckpointIndex(parentTimeline, checkpoint);
  const inherited = cutoff >= 0 ? parentTimeline.slice(0, cutoff) : parentTimeline;

  return [...inherited, ...branchRun.events];
}

// Main app content component
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { runId: urlRunId, versionId: urlVersionId } = useParams<{ runId?: string; versionId?: string }>();

  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const runs = useAppSelector((s) => s.runs.runs);

  const {
    status: realStatus,
    events: realEvents,
    result: realResult,
    iterateResult,
    error,
    runId: streamRunId,
    sessionId: streamSessionId,
    checkpointIds,
    rubric: realRubricFromStream,
    modelOutput: _modelOutput,
    pendingQuestion,
    runTask,
    executePlan,
    iterate,
    resume,
    respondToQuestion,
    reset: realReset,
  } = useTaskExecution();

  // Demo mode state - set to false to use real API
  const [demoMode, setDemoMode] = useState(false);
  const [demoState, setDemoState] = useState<DemoState>('idle');
  const [demoEvents, setDemoEvents] = useState<SSEEvent[]>([]);
  const [demoResult, setDemoResult] = useState<TaskResult | null>(null);
  const [demoExecutionMode, setDemoExecutionMode] = useState<ExecutionMode>('standard');

  const [rubricPanelOpen, setRubricPanelOpen] = useState(false);
  const [editedRubric, setEditedRubric] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<string>('');
  const [suggestedTask, setSuggestedTask] = useState<string>('');
  const [suggestedMode, setSuggestedMode] = useState<'standard' | 'plan' | 'explore' | undefined>(undefined);
  const [currentMode, setCurrentMode] = useState<ExecutionMode>('standard');
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<Provider>('gemini');

  // Version comparison state
  const [comparingVersionId, setComparingVersionId] = useState<string | null>(null);
  const [versionEvents, setVersionEvents] = useState<SSEEvent[]>([]);
  const [versionResult, setVersionResult] = useState<TaskResult | null>(null);
  const [versionStatus, setVersionStatus] = useState<TaskStatus>('idle');

  // Firestore loading state
  const [firestoreLoading, setFirestoreLoading] = useState(false);

  // Ref to track version events for use in closures (avoids stale closure issue)
  const versionEventsRef = useRef<SSEEvent[]>([]);

  // Sync URL runId with Redux
  useEffect(() => {
    if (urlRunId) {
      dispatch(setCurrentRun({ runId: urlRunId, versionId: urlVersionId || null }));
    }
  }, [urlRunId, urlVersionId, dispatch]);

  // Load run from cache then Firestore if not in memory
  useEffect(() => {
    if (!urlRunId || runs[urlRunId] || firestoreLoading || !user) return;

    // Try localStorage cache first for instant display
    const cached = getCachedRun(urlRunId);
    if (cached) {
      dispatch(setRunFromFirestore(cached));
    }

    // Always fetch from Firestore to get fresh data
    setFirestoreLoading(!cached); // only show loader if no cache
    fetchRunWithEvents(urlRunId)
      .then(async (runData) => {
        if (runData) {
          dispatch(setRunFromFirestore(runData));
          setCachedRun(runData);

          // Fetch linked version runs and branch runs so we can display them
          const idsToFetch = new Set<string>();
          if (runData.linkedVersions?.length) {
            runData.linkedVersions.forEach(id => idsToFetch.add(id));
          }
          if (runData.branches?.length) {
            runData.branches.forEach((b: { runId: string }) => idsToFetch.add(b.runId));
          }
          for (const id of idsToFetch) {
            if (!runs[id]) {
              try {
                const linkedRun = await fetchRunWithEvents(id);
                if (linkedRun) {
                  dispatch(setRunFromFirestore(linkedRun));
                }
              } catch (err) {
                console.error('Failed to load linked/branch run:', err);
              }
            }
          }
        }
      })
      .catch((err) => console.error('Failed to load run from Firestore:', err))
      .finally(() => setFirestoreLoading(false));
  }, [urlRunId, runs, firestoreLoading, user, dispatch]);

  // Navigate to run URL when we get a runId from the stream
  useEffect(() => {
    if (streamRunId && realStatus === 'executing' && !demoMode) {
      // Create run in Redux if it doesn't exist
      if (!runs[streamRunId]) {
        dispatch(createRun({
          runId: streamRunId,
          task: currentTask,
          mode: currentMode,
          provider: currentProvider,
          userId: user?.uid,
        }));
      }
      // Navigate to the run URL
      if (location.pathname !== `/run/${streamRunId}`) {
        navigate(`/run/${streamRunId}`, { replace: true });
      }
    }
  }, [streamRunId, realStatus, demoMode, currentTask, currentMode, currentProvider, user, runs, dispatch, navigate, location.pathname]);

  // Update run in Redux when events/result change
  useEffect(() => {
    if (streamRunId && !demoMode) {
      dispatch(updateRun({
        runId: streamRunId,
        updates: {
          events: realEvents,
          result: realResult,
          status: realStatus,
          error: error || undefined,
          rubric: realRubricFromStream || undefined,
        },
      }));
    }
  }, [streamRunId, realEvents, realResult, realStatus, error, realRubricFromStream, demoMode, dispatch]);

  // Use demo or real data based on mode
  const status: TaskStatus = demoMode
    ? (demoState === 'idle' || demoState === 'input' ? 'idle' : demoState as TaskStatus)
    : realStatus;
  const events = demoMode ? demoEvents : realEvents;
  const result = demoMode ? demoResult : realResult;
  const plan = demoMode && (demoState === 'planning') ? mockPlan : null;

  // Get the rubric to display
  const streamedRubric = demoMode ? null : realRubricFromStream;
  const displayRubric = editedRubric ?? result?.rubric ?? streamedRubric ?? plan?.rubric ?? (demoMode && demoState === 'completed' ? mockRubric : null);

  // Check if we're viewing a stored run from URL
  const storedRun = urlRunId && !demoMode ? runs[urlRunId] : null;
  const viewingStoredRun = !!storedRun;

  // Demo: Show different states with mode support
  const showDemoState = useCallback((state: DemoState, execMode?: ExecutionMode) => {
    setDemoEvents([]);
    setDemoResult(null);
    setEditedRubric(null);

    const mode = execMode ?? demoExecutionMode;

    switch (state) {
      case 'idle':
        setRubricPanelOpen(false);
        navigate('/');
        break;
      case 'input':
        setRubricPanelOpen(false);
        break;
      case 'planning':
        setCurrentTask(mockTask);
        setCurrentMode('plan');
        setDemoExecutionMode('plan');
        setRubricPanelOpen(true);
        break;
      case 'executing':
        // Use explore mode data if in explore mode
        if (mode === 'explore') {
          setCurrentTask(mockExploreTask);
          setCurrentMode('explore');
          setDemoExecutionMode('explore');
          setRubricPanelOpen(true);
          // Simulate explore streaming
          let eventIndex = 0;
          const streamExplore = () => {
            if (eventIndex < mockExploreEvents.length) {
              setDemoEvents(prev => [...prev, mockExploreEvents[eventIndex]]);
              eventIndex++;
              setTimeout(streamExplore, 400 + Math.random() * 300);
            } else {
              setTimeout(() => {
                setDemoResult(mockExploreResult);
                setDemoState('completed');
              }, 500);
            }
          };
          setTimeout(streamExplore, 300);
        } else {
          setCurrentTask(mockTask);
          setCurrentMode(mode);
          setDemoExecutionMode(mode);
          setRubricPanelOpen(true);
          const stream = createMockStream(
            (event) => setDemoEvents(prev => [...prev, event]),
            (result) => {
              setDemoResult(result);
              setDemoState('completed');
            },
            2
          );
          stream.start();
        }
        break;
      case 'completed':
        // Show appropriate result based on mode
        if (mode === 'explore') {
          setCurrentTask(mockExploreTask);
          setCurrentMode('explore');
          setDemoExecutionMode('explore');
          setDemoResult(mockExploreResult);
          setDemoEvents(mockExploreEvents);
        } else {
          setCurrentTask(mockTask);
          setCurrentMode(mode);
          setDemoExecutionMode(mode);
          setDemoResult(mockResult);
          setDemoEvents(mockEvents);
        }
        setRubricPanelOpen(true);
        break;
    }

    setDemoState(state);
  }, [navigate, demoExecutionMode]);

  // Initialize demo on mount
  useEffect(() => {
    if (demoMode) {
      showDemoState('completed');
    }
  }, []);

  const handleSubmit = useCallback(async (
    task: string,
    files: AttachedFile[],
    mode: ExecutionMode,
    enableSearch: boolean,
    provider: Provider = 'gemini'
  ) => {
    if (demoMode) {
      setCurrentTask(task || (mode === 'explore' ? mockExploreTask : mockTask));
      setDemoExecutionMode(mode);
      if (mode === 'plan') {
        showDemoState('planning', mode);
      } else {
        showDemoState('executing', mode);
      }
      return;
    }

    setCurrentTask(task);
    setCurrentMode(mode);
    setCurrentProvider(provider);
    setEditedRubric(null);
    setSearchEnabled(enableSearch);
    setComparingVersionId(null);

    // Convert AttachedFile[] to Attachment[] for the backend
    const attachments: Attachment[] | undefined = files.length > 0
      ? files.map((f) => {
          const isText = f.type.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(f.type);
          const preview = isText && f.content
            ? f.content.split('\n').slice(0, 100).join('\n')
            : undefined;
          return {
            content: f.content || '',
            mime_type: f.type,
            name: f.name,
            preview,
          };
        })
      : undefined;

    await runTask({
      task,
      provider,
      mode,
      enable_search: enableSearch,
      ...(attachments ? { attachments } : {}),
    });
    setRubricPanelOpen(true);
  }, [demoMode, showDemoState, runTask]);

  const handleExecutePlan = useCallback(async (planText: string) => {
    if (demoMode) {
      showDemoState('executing');
      return;
    }

    if (!plan) return;
    await executePlan(
      currentTask,
      planText,
      editedRubric ?? plan.rubric,
      { enable_search: searchEnabled },
    );
    setRubricPanelOpen(true);
  }, [demoMode, showDemoState, plan, currentTask, editedRubric, executePlan, searchEnabled]);

  const handleReworkPlan = useCallback((planText: string, comments: Array<{ id: string; selectedText: string; comment: string }>) => {
    console.log('Rework plan with comments:', { planText, comments });
  }, []);

  const handleRubricChange = useCallback((newRubric: string) => {
    setEditedRubric(newRubric);
  }, []);

  const handleRevalidate = useCallback(() => {
    console.log('Re-validating with rubric:', editedRubric);
  }, [editedRubric]);

  const handleNewTask = useCallback(() => {
    if (demoMode) {
      showDemoState('idle');
      return;
    }

    realReset();
    setEditedRubric(null);
    setCurrentTask('');
    setRubricPanelOpen(false);
    setComparingVersionId(null);
    setVersionEvents([]);
    setVersionResult(null);
    setVersionStatus('idle');
    navigate('/');
  }, [demoMode, showDemoState, realReset, navigate]);

  // Rework handler - redo the work completely, optionally with feedback
  const handleRework = useCallback(async (feedback: string) => {
    if (!currentTask) return;

    if (demoMode) {
      // In demo mode, re-run the executing state to show the flow
      showDemoState('executing', demoExecutionMode);
      return;
    }

    const feedbackSection = feedback
      ? `[USER FEEDBACK: ${feedback}]`
      : '[USER FEEDBACK: The previous output was not satisfactory. Please redo this task with a different, better approach.]';

    const reworkPrompt = `${currentTask}\n\n${feedbackSection}`;

    await runTask({
      task: reworkPrompt,
      provider: currentProvider,
      mode: 'standard',
      enable_search: searchEnabled,
    });
  }, [currentTask, demoMode, demoExecutionMode, showDemoState, runTask, searchEnabled, currentProvider]);

  // Iterate handler - refine answer based on feedback
  const handleIterate = useCallback(async (feedback: string) => {
    if (!currentTask || !result) return;

    if (demoMode) {
      // In demo mode, simulate iterate with improved result
      setDemoEvents([]);
      setDemoState('executing');

      // Simulate streaming
      const simulatedEvents: SSEEvent[] = [
        { type: 'subagent_start', subagent_id: 'sa_001', instruction: `Improving answer based on feedback: "${feedback}"` },
        { type: 'subagent_chunk', subagent_id: 'sa_001', content: 'Analyzed feedback and identified areas for improvement.' },
        { type: 'subagent_end', subagent_id: 'sa_001' },
        { type: 'verification', attempt: 1, answer: 'Improved answer', result: 'PASS: Feedback incorporated', is_error: false },
      ];

      let i = 0;
      const streamEvent = () => {
        if (i < simulatedEvents.length) {
          setDemoEvents(prev => [...prev, simulatedEvents[i]]);
          i++;
          setTimeout(streamEvent, 500);
        } else {
          setTimeout(() => {
            setDemoResult(mockIterateResult);
            setDemoState('completed');
          }, 500);
        }
      };
      setTimeout(streamEvent, 300);
      return;
    }

    // Use /resume if we have checkpoint data, otherwise fall back to /iterate
    if (streamSessionId && checkpointIds.length > 0) {
      await resume({
        session_id: streamSessionId,
        checkpoint_id: checkpointIds[checkpointIds.length - 1],
        feedback,
        provider: currentProvider,
        enable_search: searchEnabled,
      });
    } else {
      await iterate({
        task: currentTask,
        answer: result.answer,
        rubric: result.rubric,
        feedback,
        provider: currentProvider,
        enable_search: searchEnabled,
      });
    }
  }, [currentTask, result, demoMode, iterate, resume, streamSessionId, checkpointIds, searchEnabled, currentProvider]);

  // Select a single take from explore mode and continue
  const handleSelectTake = useCallback(async (take: string, continueMode: 'standard' | 'plan') => {
    if (demoMode) {
      // In demo mode, switch to standard/plan with the selected take as base
      setCurrentMode(continueMode);
      setDemoExecutionMode(continueMode);
      showDemoState('executing', continueMode);
      return;
    }

    const prompt = `Continue developing this content:\n\n${take}\n\n[Instructions: Expand and refine this take into a complete, polished output.]`;

    await runTask({
      task: prompt,
      provider: currentProvider,
      mode: continueMode,
      enable_search: searchEnabled,
    });
  }, [demoMode, showDemoState, runTask, searchEnabled, currentProvider]);

  // Mix multiple takes from explore mode
  const handleMixTakes = useCallback(async (takes: string[], instructions: string, continueMode: 'standard' | 'plan') => {
    if (demoMode) {
      // In demo mode, switch to standard/plan
      setCurrentMode(continueMode);
      setDemoExecutionMode(continueMode);
      showDemoState('executing', continueMode);
      return;
    }

    const takesFormatted = takes.map((t, i) => `=== Take ${i + 1} ===\n${t}`).join('\n\n');
    const mixPrompt = instructions
      ? `Combine these takes according to the following instructions:\n\n**Instructions:** ${instructions}\n\n${takesFormatted}`
      : `Synthesize these takes into a single cohesive output, taking the best elements from each:\n\n${takesFormatted}`;

    await runTask({
      task: mixPrompt,
      provider: currentProvider,
      mode: continueMode,
      enable_search: searchEnabled,
    });
  }, [demoMode, showDemoState, runTask, searchEnabled, currentProvider]);

  // Branch from checkpoint handler — creates a separate branch run via /resume (or /iterate fallback)
  const handleBranchFromCheckpoint = useCallback(async (checkpoint: {
    action: 'redo' | 'branch' | 'context'
    stepType: string
    events: SSEEvent[]
    feedback: string
  }) => {
    if (!currentTask || !result) return;

    if (demoMode) {
      showDemoState('executing', demoExecutionMode);
      return;
    }

    const parentRunId = streamRunId;
    if (!parentRunId) return;

    const userId = user?.uid;
    if (!userId) return;

    // Set up comparison UI with local streaming state
    setComparingVersionId('pending');
    setVersionStatus('executing');
    setVersionEvents([]);
    setVersionResult(null);
    versionEventsRef.current = [];

    // Build feedback based on action type
    let feedbackText: string;
    switch (checkpoint.action) {
      case 'redo':
        feedbackText = `Redo the task from the ${checkpoint.stepType} step. Discard everything after that point and try a different approach.`;
        break;
      case 'branch':
        feedbackText = `From the ${checkpoint.stepType} step, take a new direction: ${checkpoint.feedback}`;
        break;
      case 'context':
        feedbackText = `Additional context to consider at the ${checkpoint.stepType} step: ${checkpoint.feedback}. Continue and improve the output with this in mind.`;
        break;
    }

    try {
      let response: Response;

      // Use /resume if we have checkpoint data, otherwise fall back to /iterate
      if (streamSessionId && checkpointIds.length > 0) {
        // Pick the checkpoint_id that corresponds to the user's selected checkpoint step
        // checkpoint_ids are ordered: use the last one by default, but for specific steps
        // the backend will handle routing based on the feedback
        const checkpointId = checkpointIds[checkpointIds.length - 1];

        response = await fetch('http://localhost:8000/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: streamSessionId,
            checkpoint_id: checkpointId,
            feedback: feedbackText,
            user_id: userId,
            provider: currentProvider,
            enable_search: searchEnabled,
          }),
        });
      } else {
        // Fallback to /iterate for runs without checkpoint data
        const accumulatedOutput = checkpoint.events
          .filter(e => e.type === 'brief' || e.type === 'subagent_chunk' || e.type === 'verification' || e.type === 'answer')
          .map(e => {
            if (e.type === 'brief') return `[Brief]: ${(e as { content: string }).content}`;
            if (e.type === 'subagent_chunk') return `[Research]: ${(e as { content: string }).content}`;
            if (e.type === 'verification') return `[Verification]: ${(e as { result: string }).result}`;
            if (e.type === 'answer') return `[Answer]: ${(e as { content: string }).content}`;
            return '';
          })
          .filter(Boolean)
          .join('\n\n');

        response = await fetch('http://localhost:8000/iterate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task: currentTask,
            answer: accumulatedOutput || result.answer,
            rubric: result.rubric,
            feedback: feedbackText,
            user_id: userId,
            provider: currentProvider,
            enable_search: searchEnabled,
          }),
        });
      }

      if (!response.ok) throw new Error(`Request failed: ${response.statusText}`);

      await streamSSE(response, {
        onEvent: (event) => {
          setVersionEvents(prev => [...prev, event]);
          versionEventsRef.current = [...versionEventsRef.current, event];
        },
        onResult: (vResult, serverRunId) => {
          setVersionResult(vResult);
          setVersionStatus('completed');
          setComparingVersionId(serverRunId);

          if (serverRunId && serverRunId !== parentRunId) {
            // Determine the root run ID (walk up the chain)
            const parentRun = runs[parentRunId];
            const rootRunId = parentRun?.branchMetadata?.rootRunId ?? parentRunId;

            // Save branch metadata on the new run
            saveBranchMetadata(serverRunId, {
              parentRunId,
              rootRunId,
              branchType: 'checkpoint',
              checkpoint: checkpoint.stepType as Checkpoint,
              action: checkpoint.action,
              feedback: checkpoint.feedback || undefined,
              createdAt: new Date().toISOString(),
            }).catch(err => console.error('Failed to save branch metadata:', err));

            // Mark as version child (hides from dashboard)
            markRunAsVersionChild(serverRunId, parentRunId).catch(err =>
              console.error('Failed to mark run as version child:', err)
            );

            // Add branch ref to parent
            const branchRef: BranchRef = {
              runId: serverRunId,
              branchType: 'checkpoint',
              checkpoint: checkpoint.stepType as Checkpoint,
              label: checkpoint.feedback || `${checkpoint.action} from ${checkpoint.stepType}`,
              createdAt: new Date().toISOString(),
            };
            dispatch(addBranch({ runId: parentRunId, branch: branchRef }));

            // Also keep backward compat with linked versions
            dispatch(addLinkedVersion({ runId: parentRunId, linkedRunId: serverRunId }));
            dispatch(setPrimaryVersion({ runId: parentRunId, versionId: serverRunId }));
          }
        },
        onCheckpoints: (newSessionId, newCheckpointIds) => {
          // Store new checkpoints from the resume response for subsequent resumes
          console.log('Branch received new checkpoints:', newSessionId, newCheckpointIds);
        },
      });
    } catch (err) {
      console.error('Branch from checkpoint failed:', err);
      setVersionStatus('error');
    }
  }, [currentTask, result, demoMode, demoExecutionMode, showDemoState, streamRunId, streamSessionId, checkpointIds, searchEnabled, currentProvider, dispatch, user, runs]);

  // Get display data - respect primaryVersionId when a version is selected
  // Preferred version: a linked run ID (or null for original)
  const preferredRunId = storedRun?.primaryVersionId ?? null;
  // Look up the preferred linked run in Redux (loaded via fetchRunWithEvents)
  const preferredRun = preferredRunId ? runs[preferredRunId] : null;

  // Use timeline reconstruction for branch runs
  const displayEvents = preferredRun
    ? reconstructBranchTimeline(preferredRun, runs)
    : storedRun?.events ?? events;
  const baseResult = preferredRun?.result ?? storedRun?.result ?? result;
  // Use iterate result if available (merging with base result for task/run_id)
  const displayResult = iterateResult && baseResult
    ? { ...baseResult, answer: iterateResult.answer, rubric: iterateResult.rubric }
    : baseResult;
  const displayTask = storedRun?.task ?? currentTask;

  // Share handler - create a shared doc and return the public URL
  const handleShare = useCallback(async (): Promise<string | null> => {
    if (!displayResult || !displayTask) return null;
    try {
      const shareId = await createSharedDoc(
        streamRunId || 'unknown',
        displayTask,
        displayEvents,
        displayResult,
        { mode: currentMode, provider: currentProvider }
      );
      const url = `${window.location.origin}/share/${shareId}`;
      return url;
    } catch (err) {
      console.error('Failed to create shared doc:', err);
      return null;
    }
  }, [displayResult, displayTask, displayEvents, streamRunId, currentMode, currentProvider]);

  // Another version handler - creates a new run and links it to the current one
  const handleAnotherVersion = useCallback(async () => {
    if (!currentTask) return;

    if (demoMode) {
      showDemoState('executing', demoExecutionMode);
      return;
    }

    if (!streamRunId) return;
    const parentRunId = streamRunId;

    const userId = user?.uid;
    if (!userId) {
      console.error('User not authenticated for version request');
      return;
    }

    // Set up comparison UI with local streaming state
    setComparingVersionId('pending');
    setVersionStatus('executing');
    setVersionEvents([]);
    setVersionResult(null);
    versionEventsRef.current = [];

    const versionPrompt = `${currentTask}\n\n[USER REQUEST: Please provide another version of this task. Be creative and try a different approach while still fulfilling the original requirements.]`;

    try {
      const response = await fetch('http://localhost:8000/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: versionPrompt,
          user_id: userId,
          provider: currentProvider,
          mode: 'standard',
          enable_search: searchEnabled,
          checkpoint: true,
        }),
      });

      if (!response.ok) throw new Error(`Request failed: ${response.statusText}`);

      await streamSSE(response, {
        onEvent: (event) => {
          setVersionEvents(prev => [...prev, event]);
          versionEventsRef.current = [...versionEventsRef.current, event];
        },
        onResult: (vResult, serverRunId) => {
          setVersionResult(vResult);
          setVersionStatus('completed');
          setComparingVersionId(serverRunId);

          if (serverRunId && serverRunId !== parentRunId) {
            // Determine root run ID
            const parentRun = runs[parentRunId];
            const rootRunId = parentRun?.branchMetadata?.rootRunId ?? parentRunId;

            // Save branch metadata for fresh take
            saveBranchMetadata(serverRunId, {
              parentRunId,
              rootRunId,
              branchType: 'fresh_take',
              createdAt: new Date().toISOString(),
            }).catch(err => console.error('Failed to save branch metadata:', err));

            // Mark as version child
            markRunAsVersionChild(serverRunId, parentRunId).catch(err =>
              console.error('Failed to mark run as version child:', err)
            );

            // Add branch ref to parent
            const branchRef: BranchRef = {
              runId: serverRunId,
              branchType: 'fresh_take',
              label: 'Fresh Take',
              createdAt: new Date().toISOString(),
            };
            dispatch(addBranch({ runId: parentRunId, branch: branchRef }));

            // Keep backward compat with linked versions
            dispatch(addLinkedVersion({ runId: parentRunId, linkedRunId: serverRunId }));
            dispatch(setPrimaryVersion({ runId: parentRunId, versionId: serverRunId }));
          }
        },
      });
    } catch (err) {
      console.error('Version request failed:', err);
      setVersionStatus('error');
    }
  }, [currentTask, streamRunId, demoMode, demoExecutionMode, showDemoState, searchEnabled, currentProvider, dispatch, user, runs]);

  // Prefer this version handler - sets which linked run is the preferred view
  const handlePreferVersion = useCallback((preferredRunId: string | null) => {
    if (!streamRunId) return;

    dispatch(setPrimaryVersion({ runId: streamRunId, versionId: preferredRunId }));

    // Navigate back to main run URL
    navigate(`/run/${streamRunId}`);
    setComparingVersionId(null);
  }, [streamRunId, dispatch, navigate]);

  // Switch between versions/branches from the version tabs
  const handleSwitchVersion = useCallback(async (linkedRunId: string | null) => {
    const runId = streamRunId || urlRunId;
    if (!runId) return;
    // Fetch the linked run if not already in Redux
    if (linkedRunId && !runs[linkedRunId]) {
      try {
        const linkedRun = await fetchRunWithEvents(linkedRunId);
        if (linkedRun) {
          dispatch(setRunFromFirestore(linkedRun));
          // Also fetch ancestor chain for timeline reconstruction
          if (linkedRun.branchMetadata?.parentRunId && !runs[linkedRun.branchMetadata.parentRunId]) {
            const parentRun = await fetchRunWithEvents(linkedRun.branchMetadata.parentRunId);
            if (parentRun) dispatch(setRunFromFirestore(parentRun));
          }
        }
      } catch (err) {
        console.error('Failed to fetch linked run:', err);
      }
    }
    dispatch(setPrimaryVersion({ runId, versionId: linkedRunId }));
  }, [streamRunId, urlRunId, runs, dispatch]);

  const isIdle = status === 'idle' && !viewingStoredRun;
  const isExecuting = status === 'executing';
  const isCompleted = status === 'completed' || !!(viewingStoredRun && storedRun?.status === 'completed');
  const isPlanLoading = status === 'planning' && plan === null;
  const isPlanReady = status === 'planning' && plan !== null;

  // Determine if we're in comparison mode
  const isComparing = comparingVersionId !== null;

  // Determine layout
  const showRubricPanel = (isPlanReady || isExecuting || isCompleted) && !isComparing;

  return (
    <div className="min-h-screen bg-background paper-texture">
      <div className="flex h-screen">
        {/* Main content area */}
        <main className={cn(
          "flex-1 flex flex-col transition-all duration-300",
          showRubricPanel && rubricPanelOpen ? "mr-80" : "mr-0"
        )}>
          {/* Header */}
          <header className="border-b border-border/50 px-8 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h1
                  className="text-xl font-serif tracking-tight text-foreground cursor-pointer hover:text-foreground/80"
                  onClick={handleNewTask}
                >
                  Knowledge Work
                </h1>
                {/* Mode Toggle */}
                <button
                  onClick={() => {
                    setDemoMode(!demoMode);
                    if (!demoMode) {
                      showDemoState('completed');
                    } else {
                      realReset();
                      setEditedRubric(null);
                      setCurrentTask('');
                      setRubricPanelOpen(false);
                      navigate('/');
                    }
                  }}
                  className={cn(
                    "px-2 py-0.5 text-xs rounded-md transition-colors",
                    demoMode
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {demoMode ? 'Demo' : 'Live'}
                </button>

                {/* Dashboard link */}
                <button
                  onClick={() => navigate('/dashboard')}
                  className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dashboard
                </button>

                {/* Workspace link */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate('/sandbox')}
                      className="workspace-btn px-2.5 py-0.5 text-xs rounded-md bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900 cursor-pointer transition-colors inline-flex items-center gap-1.5"
                    >
                      <span className="font-medium">Workspace</span>
                      <span className="text-amber-500 dark:text-amber-400 text-[10px] leading-none">Work with your files</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Open your files and let AI edit, create, and run code in the browser
                  </TooltipContent>
                </Tooltip>

                {/* Show current URL for debugging */}
                {urlRunId && (
                  <span className="text-xs text-muted-foreground font-mono">
                    /run/{urlRunId}{urlVersionId ? `/v/${urlVersionId}` : ''}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {/* Demo State Controls */}
                {demoMode && (
                  <div className="flex items-center gap-4">
                    {/* Mode selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Mode:</span>
                      <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50">
                        {(['standard', 'explore'] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => {
                              setDemoExecutionMode(mode);
                              if (demoState === 'completed' || demoState === 'executing') {
                                showDemoState(demoState, mode);
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 text-xs rounded transition-colors capitalize",
                              demoExecutionMode === mode
                                ? "bg-white dark:bg-neutral-700 text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* State selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">State:</span>
                      {(['idle', 'planning', 'executing', 'completed'] as const).map((state) => (
                        <button
                          key={state}
                          onClick={() => showDemoState(state, demoExecutionMode)}
                          className={cn(
                            "px-2.5 py-1 text-xs rounded-md transition-colors",
                            demoState === state
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          )}
                        >
                          {state}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Auth UI */}
                {user && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {user.displayName || user.email}
                    </span>
                    <button
                      onClick={() => signOut(auth)}
                      className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {/* Firestore loading */}
            {firestoreLoading && (
              <div className="h-full flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}

            {/* Task Input - shown when idle */}
            {!firestoreLoading && isIdle && (
              <div className="h-full flex items-center justify-center">
                <div className="w-full max-w-2xl px-8">
                  <TaskInput
                    onSubmit={(task, files, mode, enableSearch, provider) => {
                      handleSubmit(task, files, mode, enableSearch, provider);
                      setSuggestedTask('');
                      setSuggestedMode(undefined);
                    }}
                    placeholder="What would you like to accomplish?"
                    initialTask={suggestedTask}
                    initialMode={suggestedMode}
                  />
                  {demoMode && (
                    <p className="text-center text-xs text-muted-foreground mt-4">
                      Try submitting a task, or use the demo buttons above to preview each state
                    </p>
                  )}

                  {/* Example questions */}
                  <div className="mt-8 flex flex-wrap justify-center gap-2">
                    {[
                      "Users keep requesting an API but we're a no-code product. What happens if we build one?",
                      "Calendly is a feature, not a product — but it's worth $3B. Why hasn't anyone killed it?",
                      "Superhuman charges $30/mo for email and it works. Could that model work for other productivity tools?",
                      "How do you sell AI to a cost center head when any efficiency gains mean their budget shrinks?",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => { setSuggestedTask(q); setSuggestedMode('explore'); }}
                        className="px-3 py-1.5 text-xs text-left text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-border/60 rounded-lg transition-colors leading-snug max-w-[17rem] cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Plan Loading */}
            {isPlanLoading && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto px-8 py-8">
                  <div className="flex flex-col gap-3 p-4">
                    <div className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg",
                      "bg-muted/40 border border-border/40"
                    )}>
                      <div className="h-4 w-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="font-serif text-sm font-medium tracking-tight text-foreground/90">
                        Creating execution plan
                      </span>
                      <span className="ml-auto text-muted-foreground/60">
                        <span className="inline-flex items-center gap-1">
                          <span className="animate-[pulse_1.4s_ease-in-out_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
                          <span className="animate-[pulse_1.4s_ease-in-out_0.2s_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
                          <span className="animate-[pulse_1.4s_ease-in-out_0.4s_infinite] w-1 h-1 rounded-full bg-current opacity-60" />
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Plan Canvas */}
            {isPlanReady && plan && (
              <PlanCanvas
                plan={plan}
                onExecute={handleExecutePlan}
                onRework={handleReworkPlan}
                onCancel={handleNewTask}
              />
            )}

            {/* Execution View */}
            {isExecuting && !isComparing && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto px-8 py-8">
                  <ExecutionView events={displayEvents} status={status} />
                </div>
              </div>
            )}

            {/* Comparison View - Split screen for versions */}
            {isComparing && (
              <ComparisonView
                primaryResult={displayResult}
                primaryEvents={displayEvents}
                primaryTask={displayTask}
                versionResult={versionResult}
                versionEvents={versionEvents}
                versionStatus={versionStatus}
                versionId={comparingVersionId}
                onPreferPrimary={() => handlePreferVersion(null)}
                onPreferVersion={() => handlePreferVersion(comparingVersionId)}
                onClose={() => {
                  setComparingVersionId(null);
                  if (streamRunId) {
                    navigate(`/run/${streamRunId}`);
                  }
                }}
              />
            )}

            {/* Final Output */}
            {isCompleted && displayResult && !isComparing && (
              <div className="h-full overflow-y-auto">
                <FinalOutput
                  result={displayResult}
                  events={displayEvents}
                  mode={currentMode}
                  onRework={handleRework}
                  onShare={handleShare}
                  onAnotherVersion={handleAnotherVersion}
                  onIterate={handleIterate}
                  onSelectTake={handleSelectTake}
                  onMixTakes={handleMixTakes}
                  onBranchFromCheckpoint={handleBranchFromCheckpoint}
                  linkedVersions={storedRun?.linkedVersions}
                  activeVersionId={preferredRunId}
                  onSwitchVersion={handleSwitchVersion}
                  branches={storedRun?.branches ?? runs[streamRunId || '']?.branches}
                  activeBranchId={preferredRunId}
                  onSwitchBranch={handleSwitchVersion}
                  branchMetadata={preferredRun?.branchMetadata}
                  inheritedEventCount={
                    preferredRun?.branchMetadata
                      ? computeCheckpointIndex(
                          runs[preferredRun.branchMetadata.parentRunId]?.events ?? [],
                          preferredRun.branchMetadata.checkpoint
                        )
                      : 0
                  }
                  showActions={true}
                />

                <div className="flex justify-center py-8">
                  <button
                    onClick={handleNewTask}
                    className="px-6 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground border border-border/50 rounded-lg hover:border-border transition-colors"
                  >
                    Start New Task
                  </button>
                </div>
              </div>
            )}

            {/* Error State */}
            {status === 'error' && error && (
              <div className="h-full flex items-center justify-center">
                <div className="max-w-md px-8">
                  <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6">
                    <h2 className="text-lg font-serif text-destructive mb-2">Something went wrong</h2>
                    <p className="text-sm text-destructive/80">{error}</p>
                    <button
                      onClick={handleNewTask}
                      className="mt-4 px-4 py-2 text-sm font-medium text-destructive hover:text-destructive/80 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Rubric Panel */}
        {showRubricPanel && (
          <RubricPanel
            rubric={displayRubric}
            onRubricChange={handleRubricChange}
            onRevalidate={handleRevalidate}
            isOpen={rubricPanelOpen}
            onToggle={() => setRubricPanelOpen(!rubricPanelOpen)}
            isLoading={false}
            showRevalidate={isCompleted}
          />
        )}

        {/* User Question Dialog - shown when AI needs clarification */}
        <UserQuestionDialog
          question={pendingQuestion}
          onRespond={respondToQuestion}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/share/:shareId" element={<SharedRunView />} />
      <Route path="/sandbox" element={
        <ProtectedRoute>
          <SandboxPage />
        </ProtectedRoute>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardPage />
        </ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute>
          <AppContent />
        </ProtectedRoute>
      } />
      <Route path="/run/:runId" element={
        <ProtectedRoute>
          <AppContent />
        </ProtectedRoute>
      } />
      <Route path="/run/:runId/v/:versionId" element={
        <ProtectedRoute>
          <AppContent />
        </ProtectedRoute>
      } />
    </Routes>
  );
}

export default App;
