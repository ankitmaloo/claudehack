# Browser Sandbox Tool Execution Protocol

## Overview

This document specifies the protocol for executing AI tool calls in a browser-based sandbox environment. The browser sandbox uses the File System Access API to provide isolated file system access, with the backend delegating tool execution to the frontend.

## Problem Statement

The current architecture executes all tools server-side. For the browser sandbox:
- Files exist only in the user's browser (via File System Access API)
- The backend cannot directly access these files
- We need a callback mechanism where the backend requests tool execution and the frontend responds

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                           Frontend                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  Sandbox    │───►│   Tool      │───►│  File System API    │  │
│  │  Page       │    │   Executor  │    │  (Browser)          │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                  │                                      │
│         │ SSE              │ POST                                 │
│         ▼                  ▼                                      │
├──────────────────────────────────────────────────────────────────┤
│                           Backend                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  /run       │───►│  RLHarness  │───►│  RemoteExecutor     │  │
│  │  endpoint   │    │             │    │  (waits for callback)│  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Protocol Specification

### 1. Initiating a Sandbox Run

**Request:** `POST /run`

```json
{
  "task": "Add error handling to the login function",
  "mode": "standard",
  "sandbox_mode": true,
  "sandbox_session_id": "sess_abc123"
}
```

New fields:
- `sandbox_mode: boolean` - Enable remote tool execution
- `sandbox_session_id: string` - Unique session ID for correlating tool requests/responses

### 2. Tool Request Event (Backend → Frontend)

When the AI invokes a tool, the backend emits an SSE event and **pauses execution** until it receives a response.

**SSE Event:**
```
event: tool_request
data: {
  "request_id": "req_xyz789",
  "session_id": "sess_abc123",
  "tool": "read_file",
  "args": {
    "path": "src/components/Login.tsx"
  },
  "timeout_ms": 30000
}
```

Fields:
- `request_id: string` - Unique ID for this tool invocation
- `session_id: string` - The sandbox session ID
- `tool: string` - Tool name (see Tool Definitions below)
- `args: object` - Tool-specific arguments
- `timeout_ms: number` - How long backend will wait before timing out

### 3. Tool Response (Frontend → Backend)

Frontend executes the tool and posts the result.

**Request:** `POST /tool/respond`

```json
{
  "request_id": "req_xyz789",
  "session_id": "sess_abc123",
  "result": {
    "success": true,
    "data": {
      "content": "import React from 'react';\n\nexport function Login() {\n  ...",
      "size": 1523,
      "last_modified": 1706745600000
    }
  }
}
```

**Error Response:**
```json
{
  "request_id": "req_xyz789",
  "session_id": "sess_abc123",
  "result": {
    "success": false,
    "error": "File not found: src/components/Login.tsx"
  }
}
```

**Response:** `200 OK`
```json
{
  "acknowledged": true
}
```

### 4. Tool Execution Confirmed (Backend → Frontend)

After receiving the tool response, backend continues and emits confirmation:

**SSE Event:**
```
event: tool_response
data: {
  "request_id": "req_xyz789",
  "tool": "read_file",
  "result": "... (content shown to AI)"
}
```

This mirrors the existing `tool_response` event format for consistency.

---

## Tool Definitions

### `read_file`

Read a file's contents.

**Arguments:**
```json
{
  "path": "string (required) - relative path from project root"
}
```

**Success Response:**
```json
{
  "content": "string - file contents",
  "size": "number - file size in bytes",
  "last_modified": "number - unix timestamp ms"
}
```

**Errors:**
- `File not found: {path}`
- `Permission denied: {path}`
- `File too large: {path} ({size} bytes)`

---

### `write_file`

Write content to a file. In sandbox mode, this stages to OPFS (not directly to disk).

**Arguments:**
```json
{
  "path": "string (required) - relative path from project root",
  "content": "string (required) - file contents to write"
}
```

**Success Response:**
```json
{
  "written": true,
  "path": "string - the path written",
  "size": "number - bytes written",
  "staged": "boolean - true if written to OPFS staging area"
}
```

**Errors:**
- `Permission denied: {path}`
- `Invalid path: {path}`

---

### `list_files`

List files and directories at a path.

**Arguments:**
```json
{
  "path": "string (optional) - relative path, defaults to root",
  "recursive": "boolean (optional) - include subdirectories, default false",
  "pattern": "string (optional) - glob pattern filter, e.g. '*.tsx'"
}
```

**Success Response:**
```json
{
  "entries": [
    {
      "name": "App.tsx",
      "path": "src/App.tsx",
      "is_directory": false,
      "size": 2048,
      "last_modified": 1706745600000
    },
    {
      "name": "components",
      "path": "src/components",
      "is_directory": true
    }
  ]
}
```

**Errors:**
- `Directory not found: {path}`
- `Permission denied: {path}`

---

### `delete_file`

Delete a file. In sandbox mode, this stages a deletion (marks for removal on commit).

**Arguments:**
```json
{
  "path": "string (required) - relative path from project root"
}
```

**Success Response:**
```json
{
  "deleted": true,
  "path": "string - the path deleted",
  "staged": "boolean - true if staged for deletion"
}
```

**Errors:**
- `File not found: {path}`
- `Permission denied: {path}`
- `Cannot delete directory: {path}`

---

### `search_files`

Search for files by name or content.

**Arguments:**
```json
{
  "query": "string (required) - search term",
  "search_content": "boolean (optional) - search file contents, default false",
  "path": "string (optional) - limit search to path",
  "pattern": "string (optional) - file pattern filter, e.g. '*.ts'"
}
```

**Success Response:**
```json
{
  "matches": [
    {
      "path": "src/utils/auth.ts",
      "line": 42,
      "content": "export function validateToken(token: string) {",
      "context": {
        "before": "// Token validation",
        "after": "  if (!token) return false;"
      }
    }
  ],
  "total_matches": 3,
  "truncated": false
}
```

---

## Timeout and Error Handling

### Timeout Behavior

1. Backend sets `timeout_ms` in tool_request (default: 30000)
2. If no response received within timeout:
   - Backend emits `tool_error` event
   - Execution continues with error message to AI
   - AI can retry or handle gracefully

**SSE Event (timeout):**
```
event: tool_error
data: {
  "request_id": "req_xyz789",
  "tool": "read_file",
  "error": "Tool execution timed out after 30000ms"
}
```

### Connection Loss

If SSE connection drops during pending tool request:
1. Frontend should reconnect and check for pending requests
2. Backend holds pending requests for `session_timeout` (default: 60s)
3. After session timeout, run is marked as failed

**Request:** `GET /tool/pending?session_id=sess_abc123`

**Response:**
```json
{
  "pending": [
    {
      "request_id": "req_xyz789",
      "tool": "read_file",
      "args": {"path": "src/App.tsx"},
      "requested_at": 1706745600000
    }
  ]
}
```

---

## Frontend Implementation Requirements

### Tool Executor Class

```typescript
interface ToolRequest {
  request_id: string;
  session_id: string;
  tool: string;
  args: Record<string, unknown>;
  timeout_ms: number;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

class SandboxToolExecutor {
  constructor(
    private fs: FileSystemHook,
    private sessionId: string,
    private apiBase: string
  ) {}

  async handleToolRequest(request: ToolRequest): Promise<void> {
    const result = await this.executeLocal(request.tool, request.args);
    await this.sendResponse(request.request_id, result);
  }

  private async executeLocal(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (tool) {
      case 'read_file':
        return this.readFile(args.path as string);
      case 'write_file':
        return this.writeFile(args.path as string, args.content as string);
      case 'list_files':
        return this.listFiles(args.path as string, args);
      case 'delete_file':
        return this.deleteFile(args.path as string);
      case 'search_files':
        return this.searchFiles(args);
      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }
  }

  private async sendResponse(requestId: string, result: ToolResult): Promise<void> {
    await fetch(`${this.apiBase}/tool/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: requestId,
        session_id: this.sessionId,
        result
      })
    });
  }
}
```

### SSE Event Handling

```typescript
// In useTaskExecution or similar hook
function processEvent(eventType: string, data: unknown) {
  switch (eventType) {
    case 'tool_request':
      // Execute tool and respond
      toolExecutor.handleToolRequest(data as ToolRequest);
      break;
    // ... existing event handling
  }
}
```

---

## Backend Implementation Requirements

### RemoteExecutor Class

```python
class RemoteExecutor:
    """Executor that delegates to frontend via SSE/HTTP callback."""

    def __init__(self, session_id: str, emit_event: Callable, timeout: int = 30):
        self.session_id = session_id
        self.emit_event = emit_event
        self.timeout = timeout
        self.pending_requests: dict[str, asyncio.Event] = {}
        self.results: dict[str, dict] = {}

    async def execute_tool(self, tool: str, args: dict) -> dict:
        request_id = str(uuid.uuid4())
        event = asyncio.Event()
        self.pending_requests[request_id] = event

        # Emit tool request via SSE
        self.emit_event("tool_request", {
            "request_id": request_id,
            "session_id": self.session_id,
            "tool": tool,
            "args": args,
            "timeout_ms": self.timeout * 1000
        })

        # Wait for response
        try:
            await asyncio.wait_for(event.wait(), timeout=self.timeout)
            return self.results.pop(request_id)
        except asyncio.TimeoutError:
            self.pending_requests.pop(request_id, None)
            raise ToolTimeoutError(f"Tool {tool} timed out after {self.timeout}s")

    def receive_response(self, request_id: str, result: dict):
        """Called by /tool/respond endpoint."""
        if request_id in self.pending_requests:
            self.results[request_id] = result
            self.pending_requests[request_id].set()
```

### New Endpoints

```python
@app.post("/tool/respond")
async def tool_respond(body: ToolResponseBody):
    executor = get_executor_for_session(body.session_id)
    if executor:
        executor.receive_response(body.request_id, body.result)
        return {"acknowledged": True}
    return {"acknowledged": False, "error": "Session not found"}

@app.get("/tool/pending")
async def get_pending_tools(session_id: str):
    executor = get_executor_for_session(session_id)
    if executor:
        return {"pending": executor.get_pending_requests()}
    return {"pending": []}
```

---

## Security Considerations

1. **Session Validation**: All tool responses must include valid session_id
2. **Path Traversal**: Frontend must validate paths stay within project root
3. **File Size Limits**: Enforce max file size for read/write (e.g., 10MB)
4. **Rate Limiting**: Limit tool requests per session to prevent abuse
5. **Timeout Enforcement**: Backend must enforce timeouts to prevent hanging

---

## Migration Path

### Phase 1: Backend Support
1. Add `sandbox_mode` flag to `/run` endpoint
2. Implement `RemoteExecutor` class
3. Add `/tool/respond` and `/tool/pending` endpoints
4. Add `tool_request` SSE event type

### Phase 2: Frontend Integration
1. Add `SandboxToolExecutor` class
2. Update SSE event handling to process `tool_request`
3. Wire up to existing `useFileSystem` hook

### Phase 3: Testing & Polish
1. Add timeout handling and retry logic
2. Add reconnection logic for dropped connections
3. Add progress indicators for tool execution
4. Test edge cases (large files, many files, concurrent requests)

---

## Open Questions

1. **Batching**: Should we support batching multiple tool requests? (e.g., read 5 files at once)
2. **Streaming**: For large files, should we support chunked read/write?
3. **Caching**: Should the backend cache tool results for retry scenarios?
4. **Diff Mode**: Should `write_file` support diff/patch format instead of full content?
