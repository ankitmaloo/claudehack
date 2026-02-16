# UI Integration Guide for RL Harness API

## Base URL
```
http://localhost:8000
```

## Endpoints Overview

| Endpoint | Method | Streaming | Purpose |
|----------|--------|-----------|---------|
| `/run` | POST | Yes (SSE) | Run a task with any mode |
| `/iterate` | POST | Yes (SSE) | Refine answer based on feedback |
| `/rubric/edit` | POST | No | Store rubric for reuse |
| `/rubric/{plan_id}` | GET | No | Retrieve stored rubric |
| `/question/respond` | POST | No | Respond to user clarification question |
| `/tool/respond` | POST | No | Return sandbox tool execution result |
| `/tool/pending` | GET | No | Check pending tool requests (reconnect) |
| `/health` | GET | No | Health check |

---

## Execution Modes

| Mode | Use Case | Client Provides |
|------|----------|-----------------|
| `standard` | General tasks | Task only |
| `plan` | Structured execution | Task + plan (+ optional rubric) |
| `explore` | Creative/divergent tasks | Task + num_takes |
| `iterate` | Refine existing answer | Task + answer + rubric + feedback (via `/iterate`) |

---

## POST `/run`

Unified endpoint for all execution modes.

### Request Schema

```json
{
  "task": "string (required)",
  "attachments": "array (optional) - file attachments",
  "ground_truth": "string (optional, for eval)",
  "provider": "gemini | openai | anthropic (default: gemini)",
  "thinking_level": "low | medium | high (default: medium)",
  "enable_search": "boolean (default: false)",
  "enable_bash": "boolean (default: false) - filesystem navigation",
  "enable_code": "boolean (default: false) - Python code execution",
  "artifacts_dir": "string (default: ./artifacts) - directory for code output",
  "max_iterations": "number (default: 30)",
  "mode": "standard | plan | explore (default: standard)",
  "plan": "string (optional, for plan mode)",
  "rubric": "string (optional, for plan mode)",
  "num_takes": "number (optional, for explore mode)",
  "sandbox_mode": "boolean (default: false) - delegate code execution to frontend",
  "sandbox_session_id": "string (optional) - session ID for sandbox mode",
  "sandbox_config": "object (optional) - {type, packages?, constraints?} for sandbox runtime"
}
```

### Attachment Schema

```json
{
  "content": "string (required) - file path",
  "mime_type": "string (default: text/plain)",
  "name": "string (optional) - display name",
  "preview": "string (optional) - first N lines for context"
}
```

### Standard Mode (Default)

Auto-creates brief and rubric.

```json
{
  "task": "What is the capital of France?",
  "provider": "gemini",
  "enable_search": true
}
```

### Plan Mode

Client provides execution plan (and optionally rubric).

```json
{
  "task": "Write an article about the dinosaur extinction discovery.",
  "mode": "plan",
  "plan": "## Research Phase\n1. Research the iridium anomaly discovery\n2. Research Chicxulub crater confirmation\n\n## Writing Phase\n3. Draft introduction\n4. Structure narrative",
  "rubric": "## Accuracy (25 points)\n- [ ] Correctly identifies Walter Alvarez\n- [ ] Mentions iridium layer significance",
  "provider": "gemini",
  "enable_search": true
}
```

If `rubric` is omitted, one is auto-generated based on the plan.

### Explore Mode

Multiple distinct approaches for creative tasks.

```json
{
  "task": "Write a counter-speech from Sorrento's perspective.",
  "mode": "explore",
  "num_takes": 3,
  "provider": "gemini"
}
```

### With File Attachments

Pass files with preview for context.

```json
{
  "task": "Analyze the vendor quotes and recommend the best option.",
  "attachments": [
    {
      "content": "/path/to/quotes.txt",
      "mime_type": "text/plain",
      "name": "vendor_quotes.txt",
      "preview": "Vendor A: $100/unit\nVendor B: $95/unit\n..."
    }
  ],
  "provider": "openai",
  "enable_bash": true,
  "enable_code": true,
  "artifacts_dir": "./output"
}
```

### Explore Mode Output Format

Explore mode returns structured data with multiple takes, briefs, and set-level gaps analysis.

#### Result Event for Explore Mode

```json
{
  "event": "result",
  "data": {
    "task": "Write opening paragraph for climate change essay",
    "answer": "Take 1: ...\n===\nTake 2: ...",
    "rubric": "Exploration complete checklist",
    "run_id": "abc123",
    "mode": "explore",
    "takes": [
      "Take 1: The Urgent Warning\n\nThe clock is ticking...",
      "Take 2: The Human Story\n\nMaria remembers...",
      "Take 3: The Opportunity Lens\n\nWhat if the greatest challenge...",
      "Take 4: The Scientific Narrative\n\nIn 1896, Swedish scientist..."
    ],
    "set_level_gaps": "**Missing Perspectives:**\n- Economic inequality lens...\n\n**Shared Assumptions:**\n- Western framing...",
    "briefs": [
      "**Angle:** Urgent warning\n**Core assumption:** Reader needs urgency...",
      "**Angle:** Human story\n**Core assumption:** Stories connect..."
    ]
  }
}
```

#### Brief Events (Multiple)

Explore mode emits multiple brief events with index tracking:

```json
{
  "event": "brief",
  "data": {
    "index": 1,
    "total": 4,
    "content": "**Angle:** Urgent warning...",
    "angle": "Urgent warning / crisis framing"
  }
}
```

#### Subagent Purpose Tags

In explore mode, subagent events include a `purpose` field:

```json
{
  "event": "subagent_start",
  "data": {
    "subagent_id": 1,
    "instruction": "Draft Take 1...",
    "purpose": "take"  // "take" | "counterfactual" | "set_level_gaps"
  }
}
```

#### UI Workflow for Explore Mode

1. **Show takes as selectable cards** - User can view/expand each take
2. **Allow selection** - Checkbox or multi-select for takes
3. **Actions per take**:
   - "Use This" → Continue with selected take in standard mode
   - "+ Plan" → Continue with selected take in plan mode
4. **Mix multiple takes**:
   - Select 2+ takes
   - Optional: Add instructions for how to combine
   - "Mix & Continue" or "Mix & Plan"
5. **Set-level gaps** - Show as a separate section highlighting what's missing
6. **Briefs** - Collapsible section showing the exploration angles used

---

## POST `/iterate`

Refine an answer based on user feedback. Use this **after a run is completed** to improve the output.

### Request Schema

```json
{
  "task": "string (required) - original task for context",
  "answer": "string (required) - current answer to iterate on",
  "rubric": "string (required) - current rubric",
  "feedback": "string (optional) - user feedback on the answer",
  "rubric_update": "string (optional) - rubric changes to merge",
  "provider": "gemini | openai | anthropic (default: gemini)",
  "thinking_level": "low | medium | high (default: medium)",
  "enable_search": "boolean (default: false)",
  "enable_bash": "boolean (default: false)",
  "enable_code": "boolean (default: false)",
  "artifacts_dir": "string (default: ./artifacts)",
  "max_iterations": "number (default: 30)"
}
```

### Example: Iterate with Feedback

```json
{
  "task": "Write a product launch announcement",
  "answer": "We are excited to announce...",
  "rubric": "1. Must mention key features\n2. Must include pricing",
  "feedback": "Make the tone more professional and add a call-to-action",
  "provider": "gemini"
}
```

### Example: Iterate with Rubric Update

```json
{
  "task": "Write a product launch announcement",
  "answer": "We are excited to announce...",
  "rubric": "1. Must mention key features\n2. Must include pricing",
  "rubric_update": "Add: 3. Must include launch date\n4. Must have social media links",
  "provider": "gemini"
}
```

### SSE Events for /iterate

| Event | When | Payload |
|-------|------|---------|
| `iterate_start` | Iteration begins | `{run_id, session_id, task}` |
| `model_chunk` | Orchestrator streaming | `{content}` |
| `subagent_start` | Subagent spawned | `{subagent_id, instruction}` |
| `subagent_chunk` | Subagent streaming | `{subagent_id, content}` |
| `subagent_end` | Subagent complete | `{subagent_id, response}` |
| `subagent_response` | Subagent tool response | `{subagent_id, response}` |
| `user_question` | AI needs clarification | `{question_id, questions, context, content}` |
| `verification` | Answer verified | `{attempt, answer, result, is_error}` |
| `iterate_result` | Iteration complete | `{answer, rubric, run_id}` |

---

## SSE Events

The `/run` endpoint streams Server-Sent Events.

### Event Types

| Event | When | Payload |
|-------|------|---------|
| `run_start` | Run begins | `{run_id, session_id, task, mode}` |
| `brief` | Brief created | `{content}` |
| `rubric` | Rubric created/provided | `{run_id, content}` |
| `model_chunk` | Orchestrator streaming | `{content}` |
| `subagent_start` | Subagent spawned | `{subagent_id, instruction}` |
| `subagent_chunk` | Subagent streaming | `{subagent_id, content}` |
| `subagent_end` | Subagent complete | `{subagent_id, response}` |
| `subagent_response` | Subagent tool response | `{subagent_id, response}` |
| `user_question` | AI needs clarification | `{question_id, questions, context, content}` |
| `tool_request` | Sandbox: code execution needed | `{request_id, session_id, tool, args, timeout_ms}` |
| `verification` | Answer verified | `{attempt, answer, result, is_error}` |
| `answer` | Final answer submitted | `{content}` |
| `result` | Run complete | `{task, answer, rubric, run_id}` |

### Event Payload Examples

**run_start:**
```json
{"run_id": "abc12345", "session_id": "abc12345", "task": "What is the capital of France?", "mode": "standard"}
```
*Note: `session_id` is always present and needed for `/question/respond`*

**brief:**
```json
{"content": "Task: Identify the capital city of France..."}
```

**rubric:**
```json
{"run_id": "abc12345", "content": "1. Answer must be 'Paris'\n2. Must be a single word..."}
```

**model_chunk:**
```json
{"content": "Based on my research, "}
```

**subagent_start:**
```json
{"subagent_id": 1, "instruction": "Search for France capital city"}
```

**subagent_chunk:**
```json
{"subagent_id": 1, "content": "Paris is the capital"}
```

**subagent_end:**
```json
{"subagent_id": 1, "response": "Paris is the capital of France. It has been..."}
```

**subagent_response:**
```json
{"subagent_id": 1, "response": "Paris is the capital of France..."}
```

**user_question:**
```json
{
  "question_id": "q_1706886400000",
  "questions": [
    {"question": "What is the target audience for this content?", "options": ["General public", "Technical experts", "Business executives"]},
    {"question": "What tone should the writing have?"}
  ],
  "context": "I'm drafting the introduction and need to calibrate the complexity level.",
  "content": "1. What is the target audience for this content? (options: General public, Technical experts, Business executives)\n2. What tone should the writing have?"
}
```

**tool_request (sandbox mode only):**
```json
{
  "request_id": "uuid-456",
  "session_id": "abc12345",
  "tool": "execute_code",
  "args": {"code": "print(1 + 1)"},
  "timeout_ms": 30000
}
```

**verification:**
```json
{"attempt": 1, "answer": "Paris", "result": "PASS: Correct answer", "is_error": false}
```

**answer:**
```json
{"content": "Paris"}
```

**result:**
```json
{"task": "What is the capital of France?", "answer": "Paris", "rubric": "...", "run_id": "abc12345"}
```

---

## Rubric Storage (Optional)

### POST `/rubric/edit`

Store a rubric for later retrieval.

```json
{
  "rubric": "1. Criterion one\n2. Criterion two",
  "plan_id": "my-session-123"
}
```

**Response:**
```json
{"ok": true, "plan_id": "my-session-123"}
```

### GET `/rubric/{plan_id}`

Retrieve a stored rubric.

**Response:**
```json
{"rubric": "1. Criterion one\n2. Criterion two"}
```

---

## JavaScript SSE Example

```javascript
let currentSessionId = null;

async function runTask(task, mode = 'standard', plan = null, rubric = null) {
  const response = await fetch('http://localhost:8000/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      mode,
      plan,
      rubric,
      provider: 'gemini',
      enable_search: true
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    let eventType = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        await handleEvent(eventType, data);
      }
    }
  }
}

async function handleEvent(type, data) {
  switch (type) {
    case 'run_start':
      currentSessionId = data.session_id;
      setRunId(data.run_id);
      showTask(data.task);
      break;
    case 'brief':
      showBrief(data.content);
      break;
    case 'rubric':
      showRubric(data.run_id, data.content);
      break;
    case 'model_chunk':
      appendToOutput(data.content);
      break;
    case 'subagent_start':
      addSubagentPanel(data.subagent_id, data.instruction);
      break;
    case 'subagent_chunk':
      appendToSubagent(data.subagent_id, data.content);
      break;
    case 'subagent_end':
      finalizeSubagent(data.subagent_id, data.response);
      break;
    case 'subagent_response':
      updateSubagentPanel(data.subagent_id, data.response);
      break;
    case 'user_question':
      // Show questions to user and wait for answers
      const answers = await showQuestionDialog(data.questions, data.context);
      await fetch('/question/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: data.question_id,
          session_id: currentSessionId,
          answers
        })
      });
      break;
    case 'verification':
      showVerification(data.attempt, data.answer, data.result, data.is_error);
      break;
    case 'answer':
      showFinalAnswer(data.content);
      break;
    case 'result':
      showResult(data);
      break;
  }
}
```

---

## UI Components Suggested

1. **Task Input** - Text area for task entry
2. **Mode Selector** - Toggle between standard/plan/explore
3. **Plan Editor** - Text area for plan (shown in plan mode)
4. **Rubric Editor** - Text area for rubric (shown in plan mode, optional)
5. **Config Panel** - Provider selector, enable_search toggle
6. **Brief Panel** - Shows formalized task brief
7. **Subagent Panels** - Collapsible panels per subagent
8. **Verification Panel** - Shows verify attempts with pass/fail status
9. **Final Answer Panel** - Shows submitted answer

---

## Error Handling

- Check `response.ok` before reading stream
- Check `is_error` in verification events
- The `result` event always comes last

---

## CORS

CORS is enabled for all origins. No special headers needed.

---

## User Questions (Interactive Clarification)

The AI can ask clarifying questions during execution using the `ask_user` tool. The execution pauses until the user responds.

### Flow

```
Frontend                          Backend
   │                                 │
   ├─POST /run────────────────────►│
   │                                 │
   │◄────SSE: run_start──────────────┤ includes session_id
   │                                 │
   │    (AI needs clarification)     │
   │◄────SSE: user_question──────────┤ execution blocks (5 min timeout)
   │     {question_id, questions}    │
   │                                 │
   │  [Frontend shows questions]     │
   │  [User provides answers]        │
   │                                 │
   │─POST /question/respond─────────►│ unblocks execution
   │   {question_id, answers}        │
   │                                 │
   │◄────SSE: events continue────────┤
   │◄────SSE: result─────────────────┤
```

### SSE Event: `user_question`

Emitted when the AI needs user input to proceed.

```json
{
  "event": "user_question",
  "data": {
    "question_id": "q_1706886400000",
    "questions": [
      {"question": "What is the target audience?", "options": ["General public", "Experts"]},
      {"question": "Preferred length in words?"}
    ],
    "context": "Drafting the introduction section.",
    "content": "1. What is the target audience? (options: General public, Experts)\n2. Preferred length in words?"
  }
}
```

| Field | Description |
|-------|-------------|
| `question_id` | Unique ID to include in response |
| `questions` | Array of question objects with optional `options` |
| `context` | Why the AI is asking (what it's working on) |
| `content` | Formatted text version for simple display |

### POST `/question/respond`

Send user's answers back to the waiting AI.

**Request:**
```json
{
  "question_id": "q_1706886400000",
  "session_id": "abc12345",
  "answers": {
    "0": "General public",
    "1": "500"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `question_id` | string | From the `user_question` event |
| `session_id` | string | From `run_start` or `iterate_start` event |
| `answers` | object | Map of question index (as string) to answer text |

**Response:**
```json
{"acknowledged": true, "question_id": "q_1706886400000"}
```

**Error (session expired/not found):**
```json
{"acknowledged": false, "error": "Session not found"}
```

### JavaScript Client Example

```javascript
function handleEvent(type, data, sessionId) {
  if (type === 'user_question') {
    // Show questions to user
    const answers = await showQuestionDialog(data.questions, data.context);

    // Send answers back
    await fetch('/question/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: data.question_id,
        session_id: sessionId,
        answers: answers  // e.g., {"0": "General public", "1": "500"}
      })
    });
  }
  // ... handle other events
}
```

### UI Recommendations

1. **Modal dialog** - Show questions in a modal that blocks interaction
2. **Options as buttons/chips** - If `options` provided, show as selectable choices
3. **Free text fallback** - Always allow typing custom answer
4. **Context display** - Show the `context` field so user understands why AI is asking
5. **Timeout indicator** - Show countdown (5 minute default timeout)

---

## Sandbox Mode (Browser Code Execution)

When `sandbox_mode: true`, the backend delegates code execution to the frontend instead of running it server-side. This enables browser-based sandboxes (e.g., Pyodide, WebContainers).

### Flow

```
Frontend                          Backend
   │                                 │
   ├─POST /run {sandbox_mode:true}──►│
   │                                 │ creates RemoteExecutor
   │◄────SSE: run_start──────────────┤ includes session_id
   │                                 │
   │    (AI calls execute_code)      │
   │◄────SSE: tool_request───────────┤ executor blocks waiting
   │     {request_id, code}          │
   │                                 │
   │  [Frontend executes code]       │
   │                                 │
   │─POST /tool/respond─────────────►│ unblocks executor
   │   {request_id, result}          │
   │                                 │
   │◄────SSE: events continue────────┤
   │◄────SSE: result─────────────────┤
```

### Request Example

```json
{
  "task": "Calculate the 10th Fibonacci number",
  "enable_code": true,
  "sandbox_mode": true,
  "sandbox_session_id": "my-session-123",
  "sandbox_config": {
    "type": "pyodide",
    "packages": ["numpy", "pandas"],
    "constraints": "No filesystem access, no subprocess"
  },
  "provider": "gemini"
}
```

### Sandbox Config Schema

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Sandbox type (e.g., `"pyodide"`, `"webcontainers"`, `"e2b"`) |
| `packages` | string[] | Available packages/libraries |
| `constraints` | string | Limitations (e.g., no file I/O, no network) |

The config is passed to the AI model so it generates compatible code.

### SSE Event: `tool_request`

Emitted when the AI wants to execute code.

```json
{
  "event": "tool_request",
  "data": {
    "request_id": "uuid-456",
    "session_id": "my-session-123",
    "tool": "execute_code",
    "args": {
      "code": "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\nprint(fib(10))"
    },
    "timeout_ms": 30000,
    "sandbox": {
      "type": "pyodide",
      "packages": ["numpy", "pandas"],
      "constraints": "No filesystem access, no subprocess"
    }
  }
}
```

### POST `/tool/respond`

Frontend posts execution result back.

**Request:**
```json
{
  "request_id": "uuid-456",
  "session_id": "my-session-123",
  "result": {
    "success": true,
    "data": {
      "stdout": "55\n",
      "stderr": ""
    }
  }
}
```

**Error result:**
```json
{
  "request_id": "uuid-456",
  "session_id": "my-session-123",
  "result": {
    "success": false,
    "error": "SyntaxError: invalid syntax"
  }
}
```

**Response:**
```json
{"acknowledged": true}
```

### GET `/tool/pending?session_id=xxx`

Check for pending tool requests (useful after SSE reconnect).

**Response:**
```json
{
  "pending": [
    {"request_id": "uuid-456", "tool": "execute_code"}
  ]
}
```

### JavaScript Client Example

```javascript
async function runSandboxTask(task, sandboxConfig) {
  const sessionId = crypto.randomUUID();

  const response = await fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      enable_code: true,
      sandbox_mode: true,
      sandbox_session_id: sessionId,
      sandbox_config: sandboxConfig,
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    let eventType = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (eventType === 'tool_request') {
          // Execute in browser sandbox and respond
          const result = await executeInSandbox(data.args.code, data.sandbox);
          await fetch('/tool/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              request_id: data.request_id,
              session_id: data.session_id,
              result: { success: true, data: result }
            })
          });
        } else {
          handleEvent(eventType, data);
        }
      }
    }
  }
}
```
