# SSE Events Reference

All endpoints (`/run`, `/iterate`, `/resume`) return `text/event-stream`. Each SSE message has the format:

```
event: <event_name>
data: <json_payload>

```

### Delivery modes

Events come in two flavors:

| Mode | Events | How to handle |
|------|--------|---------------|
| **Streaming** | `model_chunk`, `thinking_chunk`, `subagent_chunk`, `brief_chunk`, `verification_chunk` | Token-by-token. Append `content` to a buffer. Render incrementally. |
| **Complete** | Everything else | Single event with full payload. Render/process on arrival. |

---

## Event Timeline

### `/run` endpoint

```
run_start
├── rubric?                  ← only if client sent rubric in request
├── plan_created?            ← plan mode only: auto-generated brief + plan (when no plan provided)
├── brief_start              ← instruction sent to brief creator (all providers)
│   ├── brief_chunk*         ← streaming brief text (Gemini only)
│   └── brief                ← complete brief payload
├── rubric                   ← from create_rubric tool (if not client-provided)
├── subagent_start           ← 0..N per subagent/search
│   ├── subagent_chunk*      ← streaming text from subagent
│   └── subagent_end
├── thinking_chunk*           ← orchestrator's internal reasoning
├── model_chunk*             ← streaming text from orchestrator
├── user_question?           ← if ask_user enabled, blocks until /question/respond
├── verification_chunk*       ← streaming verifier output
├── verification             ← from verify_answer (1..N attempts)
├── answer                   ← from submit_answer (after PASS)
├── tool_request*            ← sandbox mode only, blocks until /tool/respond
├── checkpoints?             ← if checkpoint=true
└── result                   ← final payload, always last
```

### `/iterate` endpoint

```
iterate_start
├── subagent_start/chunk/end
├── model_chunk*
├── verification
├── answer
├── checkpoints?
└── iterate_result           ← final payload
```

### `/resume` endpoint

```
resume_start
├── (same mid-stream events as /run)
├── checkpoints              ← always emitted (resume keeps checkpointing)
└── result
```

On any unrecoverable error, a single `error` event is emitted instead of the final result.

---

## Event Payloads

### 1. `run_start`

First event. Emitted once.

```json
{
  "run_id": "a1b2c3d4",
  "session_id": "a1b2c3d4",
  "task": "Original task text",
  "mode": "standard",
  "sandbox": {}
}
```

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | `string` | 8-char UUID prefix. Use as primary key for this run. |
| `session_id` | `string` | Equals `run_id` unless `sandbox_session_id` was sent in request. |
| `task` | `string` | Echo of the task. |
| `mode` | `string` | `"standard"` \| `"plan"` \| `"explore"` |
| `sandbox` | `object?` | Only present when `sandbox_mode=true`. Echoes `sandbox_config`. |

---

### 1b. `plan_created`

Emitted in plan mode when no `plan` was provided in the request. The server auto-generates a brief and plan before execution begins. Fires once, right after `run_start`.

```json
{
  "brief": "# Brief\n\n## Objective\n...",
  "plan": "# Execution Plan\n\n## Approach\n..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `brief` | `string` | Full brief markdown generated from the task via `BRIEF_CREATOR`. |
| `plan` | `string` | Full execution plan markdown generated from the brief via `PLAN_CREATOR`. |

> The generated plan is then passed to the orchestrator for execution. If the client provides a `plan` in the request, this event is skipped entirely.

---

### 2. `iterate_start`

First event for `/iterate`.

```json
{
  "run_id": "a1b2c3d4",
  "session_id": "a1b2c3d4",
  "task": "Original task text"
}
```

---

### 3. `resume_start`

First event for `/resume`.

```json
{
  "run_id": "e5f6g7h8",
  "session_id": "original_run_id",
  "checkpoint_id": "abc123:step:5",
  "feedback": "Add more detail on X"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | `string` | New run ID for the resumed trajectory. |
| `session_id` | `string` | Original session ID from the first run. |
| `checkpoint_id` | `string` | Which checkpoint was resumed. |
| `feedback` | `string?` | User feedback injected, if any. |

---

### 4. `brief_start`

Emitted when the orchestrator calls `create_brief`, before generation begins. All providers.

```json
{
  "brief_index": 1,
  "instruction": "Analyze the competitive landscape for..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `brief_index` | `int` | 1-indexed. In standard/plan mode always 1. In explore mode increments per take. |
| `instruction` | `string` | The task/angle the orchestrator sent to the brief creator. |

---

### 5. `brief_chunk` *(streaming)*

Streaming text from brief generation.

```json
{
  "brief_index": 1,
  "content": "## Objective\n..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `brief_index` | `int` | 1-indexed. Use to distinguish chunks from different briefs in explore mode (multiple briefs). |
| `content` | `string` | Text chunk. Append to buffer keyed by `brief_index`. |


---

### 6. `brief` *(complete)*

Emitted when `create_brief` finishes. Contains the full brief plus metadata.

```json
{
  "index": 1,
  "total": 1,
  "content": "# Brief\n\n## Objective\n...",
  "angle": null
}
```

| Field | Type | Notes |
|-------|------|-------|
| `index` | `int` | 1-indexed brief number. In standard/plan mode, always 1. In explore mode, increments per take. |
| `total` | `int` | Running count of briefs so far (same as index). |
| `content` | `string` | Full brief markdown. |
| `angle` | `string?` | Explore mode only — extracted angle text after `"ANGLE:"`, else `null`. |

---

### 7. `rubric`

Emitted in two scenarios:
1. **Client-provided**: Immediately after `run_start` if `rubric` was in the request.
2. **Generated**: When orchestrator calls `create_rubric`.

```json
{
  "run_id": "a1b2c3d4",
  "content": "# Rubric\n\n## Criteria\n..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | `string` | The run this rubric belongs to. |
| `content` | `string` | Full rubric markdown. |

---

### 8. `subagent_start`

Emitted when a subagent (via `spawn_subagent` or `search_web`) begins execution.

```json
{
  "subagent_id": "sa_001",
  "instruction": "Search for recent market data on...",
  "purpose": "take"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `subagent_id` | `string` | Unique per-run ID (`sa_001`, `sa_002`, ...). Use to correlate with `subagent_chunk` and `subagent_end`. |
| `instruction` | `string` | The prompt/query given to the subagent. |
| `purpose` | `string?` | Explore mode only. Inferred: `"take"` \| `"counterfactual"` \| `"set_level_gaps"`. `null` in other modes. |

---

### 9. `subagent_chunk` *(streaming)*

Streaming text from a running subagent. Many per subagent.

```json
{
  "subagent_id": "sa_001",
  "content": "Based on the latest data..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `subagent_id` | `string` | Matches the `subagent_start` ID. |
| `content` | `string` | Text chunk (append to buffer). |

---

### 10. `subagent_end`

Subagent finished.

```json
{
  "subagent_id": "sa_001"
}
```

> **No separate `subagent_result` event exists.** The `spawn_subagent` and `search_web` tool responses are intentionally suppressed. The subagent's full output is the concatenation of all `subagent_chunk` payloads between `subagent_start` and `subagent_end`. Frontend must accumulate chunks per `subagent_id`.

---

### 11. `thinking_chunk` *(streaming)*

**Main orchestrator only** — internal reasoning/chain-of-thought. Emitted by all providers that support thinking (Gemini thinking, OpenAI reasoning, Anthropic extended thinking). Thinking from subagents, brief generation, and verification is intentionally filtered out. Frontend can show collapsed or in a debug panel.

```json
{
  "content": "I need to check whether..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `content` | `string` | Thinking text chunk. Append to buffer. Separate from `model_chunk` output. |

---

### 12. `model_chunk` *(streaming)*

Streaming text from the main orchestrator model. Many per turn.

```json
{
  "content": "Let me analyze..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `content` | `string` | Text chunk from orchestrator's reasoning/output. Append to buffer, render incrementally. |

---

### 13. `verification_chunk` *(streaming)*

Streaming text from the verifier as it evaluates the answer. Same accumulation pattern as `model_chunk`.

```json
{
  "content": "Checking criterion 1..."
}
```

| Field | Type | Notes |
|-------|------|-------|
| `content` | `string` | Text chunk from verifier. Append to buffer. |


---

### 14. `verification` *(complete)*

Emitted after verification finishes (after all `verification_chunk` events, if any). Contains structured metadata.

```json
{
  "attempt": 1,
  "answer": "The full answer text...",
  "result": "FAIL: Missing analysis of...",
  "is_error": false
}
```

| Field | Type | Notes |
|-------|------|-------|
| `attempt` | `int` | 1-indexed attempt counter. Increments across the run. |
| `answer` | `string` | The answer that was verified. |
| `result` | `string` | Full verifier output. Starts with `PASS` or `FAIL`. Same as accumulated `verification_chunk` text. |
| `is_error` | `bool` | `true` if the tool itself errored (not a content failure). |

---

### 15. `answer` *(complete)*

Emitted when orchestrator calls `submit_answer` (only after verification passes). Single event with the full final answer.

```json
{
  "content": "The final submitted answer..."
}
```

---

### 16. `user_question`

Emitted when orchestrator calls `ask_user`. **Blocks execution** until frontend responds via `POST /question/respond`.

```json
{
  "question_id": "q_1708012345678",
  "questions": [
    {
      "question": "Which framework should I use?",
      "options": ["React", "Vue", "Svelte"]
    }
  ],
  "context": "I need to choose a framework for the UI component.",
  "content": "1. Which framework should I use? (options: React, Vue, Svelte)"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `question_id` | `string` | Use this when responding via `POST /question/respond`. |
| `questions` | `array` | Structured questions with optional `options` arrays. |
| `context` | `string` | Why the agent is asking. |
| `content` | `string` | Human-readable formatted text of all questions. |

**Response**: `POST /question/respond`
```json
{
  "question_id": "q_1708012345678",
  "session_id": "a1b2c3d4",
  "answers": {"0": "React"}
}
```

---

### 17. `tool_request` (sandbox mode only)

Emitted when sandbox mode is enabled and the orchestrator needs to execute a tool on the frontend. **Blocks execution** until frontend responds via `POST /tool/respond`.

Both the request and the response are persisted to Firestore as a `tool_requests` subcollection doc (see [Firestore Persistence](#firestore-persistence)).

```json
{
  "request_id": "uuid-string",
  "session_id": "a1b2c3d4",
  "tool": "execute_code",
  "args": {"code": "print('hello')"},
  "timeout_ms": 30000,
  "sandbox": {"type": "Python", "capabilities": ["execute_code"]}
}
```

| Field | Type | Notes |
|-------|------|-------|
| `request_id` | `string` | Use this when responding via `POST /tool/respond`. |
| `session_id` | `string` | The sandbox session. |
| `tool` | `string` | Tool name: `"execute_code"` \| `"bash"` \| `"read_file"` \| `"search_files"`. |
| `args` | `object` | Tool arguments (same shape as tool definitions). |
| `timeout_ms` | `int` | How long backend will wait before timing out. |
| `sandbox` | `object?` | Echo of sandbox config, if set. |

**Response**: `POST /tool/respond`
```json
{
  "request_id": "uuid-string",
  "session_id": "a1b2c3d4",
  "result": {
    "success": true,
    "data": {"stdout": "hello\n", "stderr": "", "artifacts": []}
  }
}
```

**Persisted format** (Firestore `tool_requests` doc):
```json
{
  "items": [
    {
      "request_id": "uuid-string",
      "tool": "execute_code",
      "args": {"code": "print('hello')"},
      "created_at": 1708012345.678,
      "output": {"success": true, "data": {"stdout": "hello\n", "stderr": "", "artifacts": []}}
    }
  ]
}
```

> `output` is `null` if the frontend never responded (timeout) or the run ended before response arrived.

---

### 18. `checkpoints`

Emitted when `checkpoint=true` and the run completed successfully.

```json
{
  "session_id": "a1b2c3d4",
  "checkpoint_ids": [
    "abc123def456:step:0",
    "abc123def456:step:1",
    "abc123def456:step:2"
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `session_id` | `string` | Use as `session_id` in `POST /resume`. |
| `checkpoint_ids` | `string[]` | Available checkpoints. Pass one as `checkpoint_id` to `/resume`. |

---

### 19. `result`

Final event for `/run` and `/resume`. Always last.

```json
{
  "task": "Original task text",
  "answer": "The final answer...",
  "rubric": "# Rubric\n...",
  "mode": "standard",
  "run_id": "a1b2c3d4"
}
```

For **explore mode**, additional fields:

```json
{
  "task": "...",
  "answer": "raw === separated text",
  "rubric": "...",
  "mode": "explore",
  "run_id": "a1b2c3d4",
  "takes": ["Take 1 content...", "Take 2 content..."],
  "set_level_gaps": "Gap analysis content...",
  "briefs": ["Brief 1...", "Brief 2..."]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `task` | `string` | Echo of original task. |
| `answer` | `string` | Final answer. Raw text. |
| `rubric` | `string` | Final rubric used. |
| `mode` | `string` | Mode that was used. |
| `run_id` | `string` | Run identifier. |
| `takes` | `string[]?` | Explore mode only. Parsed individual takes. |
| `set_level_gaps` | `string?` | Explore mode only. Cross-take gap analysis. |
| `briefs` | `string[]?` | Explore mode only. All briefs generated. |

---

### 20. `iterate_result`

Final event for `/iterate`. Always last.

```json
{
  "answer": "The refined answer...",
  "rubric": "# Updated Rubric\n...",
  "run_id": "a1b2c3d4"
}
```

---

### 21. `error`

Emitted on unrecoverable failure. Replaces the final `result`/`iterate_result`.

```json
{
  "message": "Error description..."
}
```

---

## ID Summary

| ID | Format | Scope | How to get |
|----|--------|-------|------------|
| `run_id` | 8-char UUID prefix | Per request | From `run_start` / `iterate_start` / `resume_start` |
| `session_id` | Same as `run_id` (or client-provided `sandbox_session_id`) | Per request | From `run_start` |
| `subagent_id` | `sa_001`, `sa_002`, ... | Per run, sequential | From `subagent_start` |
| `question_id` | `q_<timestamp_ms>` | Per question | From `user_question` |
| `request_id` | Full UUID | Per tool request | From `tool_request` |
| `checkpoint_id` | `<hex>:step:<N>` | Per run | From `checkpoints` |

---

## Typical Standard Mode Flow

```
EventSource("/run")

1. run_start          → store run_id, show loading
2. brief              → display brief card
3. rubric             → display rubric card
4. subagent_start     → show subagent spinner with instruction
5. subagent_chunk*    → stream subagent text
6. subagent_end       → collapse/finalize subagent
7. model_chunk*       → stream orchestrator reasoning
8. verification       → show attempt result (PASS/FAIL)
   (repeat 4-8 if FAIL)
9. answer             → submitted answer
10. result            → final payload, close stream
```

## Typical Plan Mode Flow

```
EventSource("/run") with mode="plan"

1. run_start          → store run_id, show loading
2. plan_created?      → display brief + plan (only if no plan in request)
3. brief              → display brief card
4. rubric             → display rubric card
5. subagent_start     → show subagent spinner with instruction
6. subagent_chunk*    → stream subagent text
7. subagent_end       → collapse/finalize subagent
8. model_chunk*       → stream orchestrator reasoning
9. verification       → show attempt result (PASS/FAIL)
   (repeat 5-9 if FAIL)
10. answer            → submitted answer
11. result            → final payload, close stream
```

## Blocking Events

Two event types **block backend execution** and require frontend HTTP response:

| Event | Response Endpoint | Required Fields |
|-------|-------------------|-----------------|
| `user_question` | `POST /question/respond` | `question_id`, `session_id`, `answers` |
| `tool_request` | `POST /tool/respond` | `request_id`, `session_id`, `result` |

If not responded to within timeout (~300s for questions, ~30s for tools), backend returns a timeout error to the orchestrator.

---

## Firestore Persistence

At the end of each run, accumulated events are saved to Firestore as category-based subcollection docs under the run document. Written via `save_event_categories(run_id, docs)`.

| Doc key | Contents | When present |
|---------|----------|--------------|
| `briefs` | `{"items": [{index, instruction, content, angle}]}` | Always (orchestrator creates at least one brief) |
| `subagents` | `{"items": [{id, instruction, content, purpose}]}` | When subagents were spawned |
| `verification` | `{"items": [{attempt, answer, result, is_error}]}` | When verification ran |
| `tool_requests` | `{"items": [{request_id, tool, args, created_at, output}]}` | Sandbox mode — each request + response pair |
| `thinking` | `{"content": "..."}` | When orchestrator emitted thinking |
| `plan` | `{"brief": "...", "plan": "..."}` | Plan mode without client-provided plan |
| `answer` | `{"content": "..."}` | When answer was submitted. Explore mode: `content` is an array of takes, plus `set_level_gaps`. |
