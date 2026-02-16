# KW (Knowledge Workbench)

A browser-native system for *knowledge work*—not "coding, but with longer prompts." Built for messy, ambiguous tasks where the hard part is framing, tradeoffs, and verification, not compiling.

KW uses [kw-sdk](https://github.com/ClioAI/kw-sdk) as its orchestration harness—the engine that handles brief generation, hidden-rubric verification, subagent coordination, and the mode system. Everything else in this repo (the server, frontend, browser sandbox, file system layer, streaming infrastructure) is built around that core.

## Why this exists

Most AI tools treat knowledge work like code: one input, one output, done. But real knowledge work—strategy memos, policy analysis, vendor evaluations, research briefs—has no compiler. The hard part isn't generating text. It's figuring out what the right question is, what you're trading off, and whether you actually addressed the thing you set out to address.

KW is built around three observations:

1. **The problem statement is usually the bug.** If you jump straight to answers, you optimize for the wrong thing. KW generates a *brief* (scope, assumptions, deliverables) before doing any work—so you can catch framing errors before they compound.

2. **Self-evaluation is broken by default.** An AI grading its own work will move the goalposts to justify what it already produced. KW creates a *rubric* that's hidden from the executor—a separate verifier scores work against criteria the main agent never sees.

3. **One answer isn't enough for ambiguous problems.** When the problem space is genuinely uncertain, you need to see the *shape* of the solution space. Multiple distinct approaches with explicit tradeoffs beat a single "best" answer.

## The Workflow Engine

Every task in KW—regardless of mode—runs through the same pipeline:

```
Task → Brief → Hidden Rubric → Subagent Execution → Verification → Revision (if needed) → Output
```

**Brief:** KW formalizes your natural-language task into a structured specification. Scope, assumptions, deliverables—made explicit so you can correct them before work begins.

**Hidden Rubric:** A set of acceptance criteria generated from the brief. The executor never sees it. Only a separate verifier uses it to score the output. This prevents the "grading your own homework" problem—the AI can't subtly shift criteria to match whatever it produced.

**Subagents:** Independent AI calls that each handle a piece of the task. They work in parallel, don't share context, and can't influence each other. Divide-and-conquer for knowledge work.

**Verification:** A separate verifier scores the output against the rubric. If it fails, the system revises and re-submits—up to 3 attempts. You can also edit the rubric yourself and trigger re-validation.

**Why this matters:** Without this pipeline, AI knowledge work has no feedback loop. You get a plausible-sounding answer with no way to know if it actually met the criteria. The hidden rubric is the key—it makes verification adversarial instead of performative.

## Modes

### Standard

General-purpose execution. You provide a task, KW auto-generates the brief and rubric, executes via subagents, verifies, and returns the result. Best for well-scoped tasks where you trust the system to frame the problem correctly.

### Plan

You provide (or KW proposes) an explicit execution plan—numbered steps, sequenced dependencies. You can annotate the plan, rework specific steps, or approve and execute. The same hidden-rubric verification loop applies. Best for tasks where you need control over *how* the work gets done, not just *what* gets done.

### Explore

Generates 3–5 fundamentally different approaches to the same problem. Each take has its own brief, its own angle, its own tradeoffs. After all takes are produced, KW runs a meta-analysis across the full set:

- **Shared assumptions:** What are all the takes taking for granted?
- **Missing perspectives:** What angles weren't explored?
- **Blind spots:** What was systematically overlooked?

This "gap-finding" step is often the most valuable output. It tells you what you *didn't* think to ask—missing stakeholders, political constraints, edge cases, second-order effects.

**Why this matters:** For ambiguous, high-stakes problems, the shape of the solution space matters more than any single answer. Explore mode gives you a map instead of a pin.

## How the Server Manages the SDK

The kw-sdk is a synchronous Python library — it runs a blocking orchestration loop (provider calls, tool calls, verification) and emits `HistoryEntry` events as it goes. The server (`main.py`) is the layer that turns that into a real-time, multi-session, sandbox-aware application. Here's how it works:

### Streaming bridge

The SDK emits structured `HistoryEntry` objects (tool calls, tool responses, brief chunks, subagent output, verification results). The server registers an `on_event` callback that pushes every entry into an `asyncio.Queue`, then runs the SDK's blocking `run_single()` in a thread pool. The main async generator drains that queue in real-time, converting entries into SSE events the frontend consumes.

This is two queues, not one — there's a second `sse_queue` specifically for sandbox tool requests that the `RemoteExecutor` emits. The stream loop interleaves both: SDK events from the first queue, sandbox delegation events from the second, yielded as SSE in arrival order.

### Event filtering

The raw SDK history is verbose and internal. The `EventFilter` sits between the queue and the SSE stream, translating `HistoryEntry` types into UI-relevant events. It matches tool calls to their responses (tracking pending calls by name), counts verification attempts, infers subagent purpose in explore mode (take vs. counterfactual vs. set-level gaps), and drops anything the frontend doesn't need. The SDK doesn't know about the UI; the filter is what makes the stream legible.

### Sandbox delegation

When `sandbox_mode` is enabled, the server creates a `RemoteExecutor` instead of a `SubprocessExecutor`. The SDK doesn't know the difference — it calls `execute_code()` or `bash()` on whatever executor it's given. But the `RemoteExecutor` doesn't run anything locally. Instead it:

1. Emits a `tool_request` event into the SSE stream (with a unique request ID)
2. Blocks its thread, waiting on an `asyncio.Event`
3. The frontend picks up the request, executes it in the browser sandbox (OPFS-staged file system, isolated JS scope), and POSTs the result back to `/tool/respond`
4. The server resolves the waiting event, the SDK thread unblocks, and execution continues

This is what makes browser-native execution possible. The SDK thinks it's running code locally. The server is silently proxying tool calls across the network to a sandboxed browser runtime and back — without the SDK needing any modification.

### Session management

Each `/run` call creates a fresh `RLHarness` instance with its own provider, executor, and config. But sessions outlive individual requests when checkpointing is enabled. The server holds onto the harness (with its full snapshot history) in an in-memory `session_store`, so `/resume` can restore from any checkpoint — rewire the logging callback to a new queue, and continue the orchestration loop from where it left off. A background task garbage-collects sessions after an hour.

The server also maintains parallel registries for sandbox sessions (`sandbox_sessions`), provider sessions (`provider_sessions`), and event accumulators (`accumulator_sessions`), all keyed by session ID. This is what lets the `/tool/respond` and `/question/respond` endpoints find the right executor or provider to unblock when the frontend sends a response.

### Persistence

Every SSE event passes through an `EventAccumulator` that collects structured data — briefs, subagent outputs, verification results, tool requests with their responses, thinking traces. When the stream ends (or the client disconnects), the accumulator flushes everything to Firestore as categorized subcollection documents. The result itself is saved separately via a `done_callback` on the executor future, so it persists even if the SSE connection drops mid-stream. All Firestore writes are fire-and-forget on a dedicated thread pool to avoid blocking the event stream.

## Browser Sandbox

All modes can run against a real workspace in the browser. KW uses the File System Access API to open a local folder, then stages all AI modifications in the browser's Origin Private File System (OPFS)—a private, sandboxed layer that never touches your actual files until you explicitly commit.

```
Your Files (read-only) → OPFS Staging (AI writes here) → You Review → Commit to Disk
```

**What the AI can do in the sandbox:**
- Read, write, search, and delete files (all staged)
- Execute JavaScript in an isolated scope with file system access
- Run emulated shell commands (ls, cat, grep, find, etc.)
- Generate Excel and Word documents

**What the AI cannot do:**
- Write directly to your disk
- Access the network
- Touch the DOM
- Run longer than 30 seconds per execution

**Checkpoints:** Every successful step is logged. You can branch from any prior state, provide feedback, and iterate from that checkpoint—like an investigation trail, not a chat log.

**Why this matters:** The sandbox turns KW from a text generator into a workspace. Artifacts—docs, analyses, spreadsheets, drafts—are the product, not just text in a chat window. And because everything is staged, you can let the AI work freely without risking your files.

## Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- Radix UI / shadcn/ui
- Redux Toolkit
- Firebase
- Web Workers (via Comlink)

**Backend**
- Python 3.11+
- FastAPI + Uvicorn
- [kw-sdk](https://github.com/ClioAI/kw-sdk) for orchestration
- Multi-provider support (Gemini, OpenAI, Anthropic)
- Firebase Admin SDK for persistence

## Getting Started

**Frontend**
```bash
npm install
npm run dev
```

**Backend**
```bash
cd backend
uv run uvicorn main:app --reload
```

**API Keys (BYOK)**

KW is bring-your-own-key. You can pass a provider API key from the frontend per-request (sent via `x-provider-key` header), or set defaults in `backend/.env`:

```
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

If no key is provided, KW falls back to `gemini-3-flash-preview` as the default provider.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

---

*KW is a knowledge-work operating system: it explores, plans, executes in a real workspace, and verifies with rubric-based feedback—because knowledge work isn't code, and pretending it is leaves value on the table.*
