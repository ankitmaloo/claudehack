// Task execution types based on UI_GUIDE.md

// Execution modes supported by the API
export type ExecutionMode = 'standard' | 'plan' | 'explore';

export interface Attachment {
  content: string;  // File path
  mime_type?: string;  // default: text/plain
  name?: string;  // Display name
  preview?: string;  // First N lines for context
}

export interface TaskRequest {
  task: string;
  attachments?: Attachment[];
  ground_truth?: string;
  provider?: 'gemini' | 'openai' | 'anthropic';
  thinking_level?: 'low' | 'medium' | 'high';
  enable_search?: boolean;
  enable_bash?: boolean;
  enable_code?: boolean;
  artifacts_dir?: string;
  max_iterations?: number;
  mode?: ExecutionMode;
  plan?: string;
  rubric?: string;
  num_takes?: number;
  // Sandbox mode
  sandbox_mode?: boolean;
  sandbox_session_id?: string;
  sandbox_config?: {
    type: string;
    version?: string;
    capabilities?: string[];
    constraints?: string;
  };
}

export interface IterateRequest {
  task: string;  // Original task for context
  answer: string;  // Current answer to iterate on
  rubric: string;  // Current rubric
  feedback?: string;  // User feedback on the answer
  rubric_update?: string;  // Rubric changes to merge
  provider?: 'gemini' | 'openai' | 'anthropic';
  thinking_level?: 'low' | 'medium' | 'high';
  enable_search?: boolean;
  enable_bash?: boolean;
  enable_code?: boolean;
  artifacts_dir?: string;
  max_iterations?: number;
}

export interface ResumeRequest {
  session_id: string;
  checkpoint_id: string;
  feedback: string;
  provider?: 'gemini' | 'openai' | 'anthropic';
  thinking_level?: 'low' | 'medium' | 'high';
  enable_search?: boolean;
  enable_bash?: boolean;
  enable_code?: boolean;
  max_iterations?: number;
}

export interface IterateResult {
  answer: string;
  rubric: string;
  run_id: string;
}

// SSE Event types from API (matches SSE_EVENTS.md)
//
// Streaming events (append content to buffer, render incrementally):
//   model_chunk, thinking_chunk, subagent_chunk, brief_chunk, verification_chunk
// Complete events (single event with full payload):
//   everything else
export type SSEEventType =
  | 'run_start'
  | 'iterate_start'
  | 'resume_start'
  | 'brief_start'
  | 'brief_chunk'
  | 'brief'
  | 'rubric'
  | 'subagent_start'
  | 'subagent_chunk'
  | 'subagent_end'
  | 'thinking_chunk'
  | 'model_chunk'
  | 'user_question'
  | 'verification_chunk'
  | 'verification'
  | 'answer'
  | 'result'
  | 'iterate_result'
  | 'checkpoints'
  | 'tool_request'
  | 'error';

// Individual SSE event payloads
export interface RunStartEvent {
  type: 'run_start';
  run_id: string;
  session_id: string;
  task: string;
  mode?: ExecutionMode;
  sandbox?: Record<string, unknown>;
}

export interface BriefStartEvent {
  type: 'brief_start';
  brief_index: number;  // 1-indexed. Standard/plan = 1, explore increments per take.
  instruction: string;  // The task/angle sent to the brief creator.
}

export interface BriefChunkEvent {
  type: 'brief_chunk';
  brief_index: number;  // 1-indexed. Use to distinguish chunks from different briefs in explore mode.
  content: string;      // Text chunk. Append to buffer keyed by brief_index.
}

export interface BriefEvent {
  type: 'brief';
  content: string;
  index?: number;  // 1-indexed brief number. Standard/plan = 1, explore increments per take.
  total?: number;  // Running count of briefs so far.
  angle?: string;  // Explore mode only — extracted angle text.
}

export interface RubricEvent {
  type: 'rubric';
  run_id: string;
  content: string;
}

// Orchestrator's internal reasoning/chain-of-thought. Separate from model_chunk output.
export interface ThinkingChunkEvent {
  type: 'thinking_chunk';
  content: string;
}

export interface ModelChunkEvent {
  type: 'model_chunk';
  content: string;
}

export interface SubagentStartEvent {
  type: 'subagent_start';
  subagent_id: string;
  instruction: string;
  purpose?: 'take' | 'counterfactual' | 'set_level_gaps' | null;  // For explore mode
}

export interface SubagentChunkEvent {
  type: 'subagent_chunk';
  subagent_id: string;
  content: string;
}

export interface SubagentEndEvent {
  type: 'subagent_end';
  subagent_id: string;
}

// User question for clarification
export interface UserQuestionOption {
  question: string;
  options?: string[];  // Optional predefined choices
}

export interface UserQuestionEvent {
  type: 'user_question';
  question_id: string;
  questions: UserQuestionOption[];
  context: string;  // Why the AI is asking
  content: string;  // Formatted text version
}

// Streaming verifier output. Same accumulation pattern as model_chunk.
export interface VerificationChunkEvent {
  type: 'verification_chunk';
  content: string;
}

export interface VerificationEvent {
  type: 'verification';
  attempt: number;
  answer: string;
  result: string;  // Full verifier output. Same as accumulated verification_chunk text.
  is_error: boolean;
}

export interface AnswerEvent {
  type: 'answer';
  content: string;
}

export interface ResultEvent {
  type: 'result';
  task: string;
  answer: string;
  rubric: string;
  run_id: string;
  mode?: ExecutionMode;
  // Explore mode structured output
  takes?: string[];
  set_level_gaps?: string | null;
  briefs?: string[];
}

export interface IterateStartEvent {
  type: 'iterate_start';
  run_id: string;
  session_id: string;
  task: string;
}

export interface ResumeStartEvent {
  type: 'resume_start';
  run_id: string;
  session_id: string;
  checkpoint_id: string;
  feedback?: string;
}

export interface IterateResultEvent {
  type: 'iterate_result';
  answer: string;
  rubric: string;
  run_id: string;
}

export interface CheckpointsEvent {
  type: 'checkpoints';
  session_id: string;
  checkpoint_ids: string[];
}

// Sandbox tool events
export interface ToolRequestEvent {
  type: 'tool_request';
  request_id: string;
  session_id: string;
  tool: string;
  args: Record<string, unknown>;
  timeout_ms: number;
  sandbox?: Record<string, unknown>;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

// Union type for all SSE events
export type SSEEvent =
  | RunStartEvent
  | BriefStartEvent
  | BriefChunkEvent
  | BriefEvent
  | RubricEvent
  | ThinkingChunkEvent
  | ModelChunkEvent
  | SubagentStartEvent
  | SubagentChunkEvent
  | SubagentEndEvent
  | UserQuestionEvent
  | VerificationChunkEvent
  | VerificationEvent
  | AnswerEvent
  | ResultEvent
  | IterateStartEvent
  | IterateResultEvent
  | ResumeStartEvent
  | CheckpointsEvent
  | ToolRequestEvent
  | ErrorEvent;

// Legacy SSEEvent format for mock data compatibility
export interface LegacySSEEvent {
  timestamp: string;
  entry_type: 'system' | 'user' | 'thinking' | 'model' | 'tool_call' | 'tool_response' | 'tool_error';
  content: string;
  metadata: Record<string, unknown>;
}

// Task result from the 'result' SSE event
export interface TaskResult {
  task: string;
  answer: string;
  rubric: string;
  run_id: string;
  mode?: ExecutionMode;
  // Explore mode structured output
  takes?: string[];
  set_level_gaps?: string | null;
  briefs?: string[];
}

export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string; // base64 for images, text for text files
  preview?: string; // URL for image preview
}

export type TaskStatus = 'idle' | 'planning' | 'executing' | 'completed' | 'error';

// Branching / checkpointing types
export type Checkpoint = 'brief' | 'subagent' | 'verification';
export type BranchType = 'checkpoint' | 'fresh_take';

export interface BranchMetadata {
  parentRunId: string;
  rootRunId: string;
  branchType: BranchType;
  checkpoint?: Checkpoint;
  action?: 'redo' | 'branch' | 'context';
  feedback?: string;
  createdAt: string;
}

export interface BranchRef {
  runId: string;
  branchType: BranchType;
  checkpoint?: Checkpoint;
  label?: string;
  createdAt: string;
}

export interface RubricItem {
  id: string;
  criterion: string;
  passed?: boolean;
  evidence?: string;
}
