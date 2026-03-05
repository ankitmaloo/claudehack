import asyncio
import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from firebase import save_run_doc, save_event_categories
from verif.harness import AsyncRLHarness, RunResult, IterateResult, Attachment, Prompt, ProviderConfig
from verif.prompts import BRIEF_CREATOR, PLAN_CREATOR
from verif.executor import SubprocessExecutor, RemoteExecutor
from verif.providers.base import HistoryEntry
from verif.skills import parse_skills


@dataclass
class UIEvent:
    event: str
    data: dict


class EventFilter:
    """Filters HistoryEntry stream to UI-relevant events only."""

    def __init__(self, run_id: str, mode: str = "standard"):
        self.run_id = run_id
        self.mode = mode
        self.pending_calls: list[tuple[str, dict]] = []  # (name, args)
        self.verify_counter = 0
        self.brief_counter = 0  # For explore mode: track multiple briefs
        self.briefs: list[str] = []  # Store briefs for explore mode

    def _infer_purpose(self, prompt: str) -> str | None:
        if self.mode != "explore":
            return None
        p = prompt.lower()
        if "counterfactual" in p or "what could make" in p:
            return "counterfactual"
        if "set-level" in p or "all takes" in p or "what's missing" in p:
            return "set_level_gaps"
        return "take"

    def process(self, entry: HistoryEntry) -> UIEvent | None:
        if entry.entry_type == "tool_call":
            return self._handle_tool_call(entry.content)
        elif entry.entry_type in ("tool_response", "tool_error"):
            return self._handle_tool_response(entry.content, entry.entry_type == "tool_error")
        elif entry.entry_type == "brief_start":
            idx = entry.metadata.get("brief_index") if entry.metadata else None
            return UIEvent("brief_start", {"brief_index": idx, "instruction": entry.content})
        elif entry.entry_type == "brief_chunk":
            idx = entry.metadata.get("brief_index") if entry.metadata else None
            return UIEvent("brief_chunk", {"brief_index": idx, "content": entry.content})
        elif entry.entry_type == "rubric_created":
            return UIEvent("rubric", {"run_id": self.run_id, "content": entry.content})
        elif entry.entry_type == "verification_chunk":
            return UIEvent("verification_chunk", {"content": entry.content})
        elif entry.entry_type == "thinking":
            return UIEvent("thinking_chunk", {"content": entry.content})
        elif entry.entry_type == "model_chunk":
            return UIEvent("model_chunk", {"content": entry.content})
        elif entry.entry_type == "subagent_chunk":
            sa_id = entry.metadata.get("subagent_id") if entry.metadata else None
            return UIEvent("subagent_chunk", {"subagent_id": sa_id, "content": entry.content})
        elif entry.entry_type == "subagent_start":
            # Provider started the subagent — emit start with real ID
            sa_id = entry.metadata.get("subagent_id") if entry.metadata else None
            instruction = entry.content or ""
            return UIEvent("subagent_start", {
                "subagent_id": sa_id,
                "instruction": instruction,
                "purpose": self._infer_purpose(instruction),
            })
        elif entry.entry_type == "subagent_end":
            sa_id = entry.metadata.get("subagent_id") if entry.metadata else None
            return UIEvent("subagent_end", {"subagent_id": sa_id})
        elif entry.entry_type == "user_question":
            return UIEvent("user_question", {
                "question_id": entry.metadata.get("question_id"),
                "questions": entry.metadata.get("questions", []),
                "context": entry.metadata.get("context", ""),
                "content": entry.content,
            })
        elif entry.entry_type == "agent_notify":
            level = entry.metadata.get("level", "info") if entry.metadata else "info"
            return UIEvent("agent_notify", {"message": entry.content, "level": level})
        return None

    def _parse_tool_call(self, content: str) -> tuple[str, dict]:
        """Parse 'tool_name({args})' format."""
        match = re.match(r"(\w+)\((.*)\)$", content, re.DOTALL)
        if not match:
            return "", {}
        name = match.group(1)
        try:
            args = eval(match.group(2)) if match.group(2) else {}
        except:
            args = {}
        return name, args

    def _parse_tool_response(self, content: str) -> tuple[str, str]:
        """Parse 'tool_name -> result' format."""
        parts = content.split(" -> ", 1)
        return (parts[0], parts[1]) if len(parts) == 2 else ("", content)

    def _handle_tool_call(self, content: str) -> UIEvent | None:
        name, args = self._parse_tool_call(content)
        if not name:
            return None
        self.pending_calls.append((name, args))
        # Emit bg_agent_start for background delegate or build_skill
        if name == "delegate" and args.get("background"):
            return UIEvent("bg_agent_start", {
                "prompt": args.get("prompt", "")[:300],
                "tools": args.get("tools"),
                "skill": args.get("skill"),
            })
        if name == "build_skill":
            return UIEvent("bg_agent_start", {
                "prompt": f"build_skill:{args.get('name', '')}",
                "tools": ["execute_code", "search_web"],
                "skill": args.get("name"),
            })
        return None

    def _handle_tool_response(self, content: str, is_error: bool) -> UIEvent | None:
        name, result = self._parse_tool_response(content)
        if not name:
            return None

        # Find and remove matching pending call
        args = {}
        for i, (n, a) in enumerate(self.pending_calls):
            if n == name:
                args = a
                self.pending_calls.pop(i)
                break

        if name == "create_brief":
            self.brief_counter += 1
            self.briefs.append(result)
            return UIEvent("brief", {
                "index": self.brief_counter,
                "total": self.brief_counter,
                "content": result,
                "angle": args.get("task", "").split("ANGLE:")[-1].strip() if "ANGLE:" in args.get("task", "") else None
            })

        elif name == "create_rubric":
            return None  # actual rubric emitted via rubric_created event

        elif name == "spawn_subagent":
            return None  # subagent_end already emitted from provider event

        elif name == "verify_answer":
            self.verify_counter += 1
            return UIEvent("verification", {
                "attempt": self.verify_counter,
                "answer": args.get("answer", ""),
                "result": result,
                "is_error": is_error
            })

        elif name == "submit_answer":
            return UIEvent("answer", {"content": args.get("answer", "")})

        elif name.startswith("background_"):
            agent_id = name.removeprefix("background_")
            return UIEvent("bg_agent_complete", {
                "agent_id": agent_id,
                "result": result[:1000],
                "is_error": is_error,
            })

        return None



@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(_cleanup_sessions())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _fs_fire(coro):
    """Fire-and-forget async Firestore write with error logging."""
    async def _safe():
        try:
            await coro
        except Exception as e:
            import traceback
            print(f"Firestore error: {e}\n{traceback.format_exc()}")
    asyncio.create_task(_safe())


def fs_doc(**kwargs):
    """Fire-and-forget run doc write."""
    _fs_fire(save_run_doc(**kwargs))


def fs_categories(run_id: str, categories: dict[str, dict]):
    """Fire-and-forget category doc flush."""
    if categories:
        _fs_fire(save_event_categories(run_id, categories))


class EventAccumulator:
    """Accumulates UIEvents into category-based docs for Firestore."""

    def __init__(self):
        self.briefs: list[dict] = []
        self.subagents: list[dict] = []
        self._subagent_buffers: dict[str, dict] = {}
        self.verifications: list[dict] = []
        self.tool_requests: list[dict] = []
        self._tool_request_index: dict[str, int] = {}  # request_id -> list index
        self.thinking: str = ""
        self.answer: str | None = None
        self.plan: dict | None = None
        self._pending_brief_instruction: str = ""
        self.bg_agents: list[dict] = []
        self.notifications: list[dict] = []

    def process(self, ev: UIEvent):
        e, d = ev.event, ev.data
        if e == "brief_start":
            self._pending_brief_instruction = d.get("instruction", "")
        elif e == "brief":
            self.briefs.append({
                "index": d.get("index"),
                "instruction": self._pending_brief_instruction,
                "content": d.get("content", ""),
                "angle": d.get("angle"),
            })
            self._pending_brief_instruction = ""
        elif e == "subagent_start":
            sa_id = d.get("subagent_id", "")
            self._subagent_buffers[sa_id] = {
                "id": sa_id, "instruction": d.get("instruction", ""),
                "content": "", "purpose": d.get("purpose"),
            }
        elif e == "subagent_chunk":
            sa_id = d.get("subagent_id", "")
            if sa_id in self._subagent_buffers:
                self._subagent_buffers[sa_id]["content"] += d.get("content", "")
        elif e == "subagent_end":
            sa_id = d.get("subagent_id", "")
            if buf := self._subagent_buffers.pop(sa_id, None):
                self.subagents.append(buf)
        elif e == "verification":
            self.verifications.append({
                "attempt": d.get("attempt"), "answer": d.get("answer", ""),
                "result": d.get("result", ""), "is_error": d.get("is_error", False),
            })
        elif e == "thinking_chunk":
            self.thinking += d.get("content", "")
        elif e == "tool_request":
            req_id = d.get("request_id", "")
            self._tool_request_index[req_id] = len(self.tool_requests)
            self.tool_requests.append({
                "request_id": req_id,
                "tool": d.get("tool", ""),
                "args": d.get("args", {}),
                "created_at": time.time(),
                "output": None,
            })
        elif e == "plan_created":
            self.plan = {"brief": d.get("brief", ""), "plan": d.get("plan", "")}
        elif e == "bg_agent_start":
            self.bg_agents.append({"prompt": d.get("prompt", ""), "skill": d.get("skill"), "result": None})
        elif e == "bg_agent_complete":
            # Match to last unfinished bg_agent entry
            for ba in reversed(self.bg_agents):
                if ba["result"] is None:
                    ba["result"] = d.get("result", "")
                    ba["is_error"] = d.get("is_error", False)
                    break
        elif e == "agent_notify":
            self.notifications.append({"message": d.get("message", ""), "level": d.get("level", "info")})
        elif e == "answer":
            self.answer = d.get("content", "")

    def set_tool_output(self, request_id: str, result: dict):
        if (idx := self._tool_request_index.get(request_id)) is not None:
            self.tool_requests[idx]["output"] = result

    def set_explore_result(self, answer: str):
        parsed = parse_explore_takes(answer)
        self.answer = parsed["takes"]  # array for explore
        self.set_level_gaps = parsed.get("set_level_gaps")

    def to_docs(self) -> dict[str, dict]:
        docs = {}
        if self.briefs:
            docs["briefs"] = {"items": self.briefs}
        if self.subagents:
            docs["subagents"] = {"items": self.subagents}
        if self.verifications:
            docs["verification"] = {"items": self.verifications}
        if self.tool_requests:
            docs["tool_requests"] = {"items": self.tool_requests}
        if self.thinking:
            docs["thinking"] = {"content": self.thinking}
        if self.bg_agents:
            docs["bg_agents"] = {"items": self.bg_agents}
        if self.notifications:
            docs["notifications"] = {"items": self.notifications}
        if self.plan:
            docs["plan"] = self.plan
        if self.answer is not None:
            doc = {"content": self.answer}
            if hasattr(self, "set_level_gaps") and self.set_level_gaps:
                doc["set_level_gaps"] = self.set_level_gaps
            docs["answer"] = doc
        return docs


class AttachmentRequest(BaseModel):
    content: str  # File path
    mime_type: str = "text/plain"
    name: Optional[str] = None
    preview: Optional[str] = None  # First N lines for context


class RunRequest(BaseModel):
    task: str
    user_id: str  # User ID (will be API key in future)
    attachments: Optional[list[AttachmentRequest]] = None  # File attachments
    ground_truth: str = ""
    provider: str = "gemini"  # "gemini" | "openai" | "anthropic"
    api_key: Optional[str] = None  # Provider API key (overrides env var)
    thinking_level: str = "medium"  # "low" | "medium" | "high"
    enable_search: bool = False
    enable_bash: bool = False  # Filesystem navigation
    enable_code: bool = False  # Python code execution
    enable_ask_user: bool = False  # Allow orchestrator to ask user questions
    artifacts_dir: str = "./artifacts"  # Directory for code artifacts
    skills_dir: Optional[str] = None  # Directory containing reusable skills
    max_iterations: int = 30
    mode: str = "standard"  # "standard" | "plan" | "explore"
    plan: Optional[str] = None  # User-provided execution plan
    rubric: Optional[str] = None  # User-provided rubric
    num_takes: Optional[int] = None  # For explore mode
    checkpoint: bool = False  # enable checkpointing (persists session for /resume)
    # Sandbox mode: delegate tool execution to frontend
    sandbox_mode: bool = False
    sandbox_session_id: Optional[str] = None
    sandbox_config: Optional[dict] = None  # {runtime, environment, capabilities?, packages?, constraints?, instructions?}


class RubricEditRequest(BaseModel):
    rubric: str
    plan_id: Optional[str] = None


class IterateRequest(BaseModel):
    task: str  # Original task for context
    user_id: str  # User ID (will be API key in future)
    answer: str  # Current answer to iterate on
    rubric: str  # Current rubric
    feedback: Optional[str] = None  # User feedback on answer
    rubric_update: Optional[str] = None  # Rubric changes to merge
    provider: str = "gemini"  # "gemini" | "openai" | "anthropic"
    api_key: Optional[str] = None  # Provider API key (overrides env var)
    thinking_level: str = "medium"
    enable_search: bool = False
    enable_bash: bool = False
    enable_code: bool = False
    enable_ask_user: bool = False
    artifacts_dir: str = "./artifacts"
    max_iterations: int = 30
    checkpoint: bool = False


class ResumeRequest(BaseModel):
    session_id: str
    user_id: str  # User ID (will be API key in future)
    checkpoint_id: str
    feedback: Optional[str] = None
    rubric_update: Optional[str] = None
    ground_truth: str = ""


rubric_store: dict[str, str] = {}
sandbox_sessions: dict[str, RemoteExecutor] = {}
provider_sessions: dict[str, Any] = {}  # session_id -> provider for user questions
accumulator_sessions: dict[str, EventAccumulator] = {}  # session_id -> accumulator for tool_respond


# --- Session store for checkpoint/resume ---

@dataclass
class Session:
    harness: AsyncRLHarness
    run_ids: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)
    config: dict = field(default_factory=dict)
    busy: bool = False

session_store: dict[str, Session] = {}
SESSION_TTL = 3600  # 1 hour


# Shared HTTP client pools — one per provider type, lazily initialized using env var keys
_shared_client_pools: dict[str, dict[str, Any]] = {}


def _get_shared_clients(provider: str) -> dict[str, Any]:
    """Get or create shared clients for a provider type (env var keys only)."""
    if provider not in _shared_client_pools:
        if provider == "gemini":
            from google import genai
            _shared_client_pools[provider] = {
                "client": genai.Client(api_key=os.environ.get("GEMINI_API_KEY")),
            }
        elif provider == "openai":
            from openai import OpenAI, AsyncOpenAI
            _shared_client_pools[provider] = {
                "client": OpenAI(api_key=os.environ.get("OPENAI_API_KEY")),
                "async_client": AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY")),
            }
        elif provider == "anthropic":
            import anthropic
            _shared_client_pools[provider] = {
                "client": anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")),
                "async_client": anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")),
            }
    return _shared_client_pools.get(provider, {})


def _build_provider_config(provider: str, thinking_level: str, api_key: str | None = None) -> ProviderConfig:
    # Custom API key → fresh clients (no shared pool contamination)
    shared = None if api_key else _get_shared_clients(provider)
    if provider == "openai":
        return ProviderConfig(name="openai", reasoning_effort=thinking_level, api_key=api_key, shared_clients=shared)
    elif provider == "anthropic":
        return ProviderConfig(name="anthropic", api_key=api_key, shared_clients=shared)
    return ProviderConfig(name="gemini", thinking_level=thinking_level.upper(), api_key=api_key, shared_clients=shared)


class ToolResponseRequest(BaseModel):
    request_id: str
    session_id: str
    result: dict


class QuestionResponseRequest(BaseModel):
    question_id: str
    session_id: str
    answers: dict  # {question_index: answer_text}


async def _create_plan(provider, task: str, enable_search: bool = False) -> tuple[str, str]:
    """Generate brief + plan from task using provider."""
    brief = await provider.generate_async(task, system=BRIEF_CREATOR, enable_search=enable_search, _log=False)
    plan = await provider.generate_async(
        f"Task: {task}\n\nBrief:\n{brief}", system=PLAN_CREATOR,
        enable_search=enable_search, _log=False,
    )
    return brief, plan


def _make_on_log(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    """Create on_log callback that's efficient from both event loop and threads."""
    loop_thread_id = threading.get_ident()

    def on_log(entry: HistoryEntry):
        if threading.get_ident() == loop_thread_id:
            queue.put_nowait(entry)
        else:
            loop.call_soon_threadsafe(queue.put_nowait, entry)

    return on_log


def ui_event_to_sse(ev: UIEvent) -> str:
    return f"event: {ev.event}\ndata: {json.dumps(ev.data)}\n\n"


def parse_explore_takes(answer: str) -> dict:
    """Parse explore mode answer into structured takes + set-level gaps."""
    if not answer or "===" not in answer:
        return {"takes": [answer] if answer else [], "set_level_gaps": None}

    parts = [p.strip() for p in answer.split("===") if p.strip()]
    if not parts:
        return {"takes": [], "set_level_gaps": None}

    # Last part is always set-level gaps
    return {"takes": parts[:-1], "set_level_gaps": parts[-1]}


def result_to_sse(result: RunResult, event: str = "result", run_id: Optional[str] = None,
                  mode: str = "standard", briefs: Optional[list[str]] = None) -> str:
    data: dict = {"task": result.task, "answer": result.answer, "rubric": result.rubric, "mode": mode}
    if run_id:
        data["run_id"] = run_id

    # For explore mode, add structured takes
    if mode == "explore":
        parsed = parse_explore_takes(result.answer)
        data["takes"] = parsed["takes"]
        data["set_level_gaps"] = parsed["set_level_gaps"]
        data["briefs"] = briefs or []

    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def iterate_result_to_sse(result: IterateResult, run_id: str) -> str:
    data = {"answer": result.answer, "rubric": result.rubric, "run_id": run_id}
    return f"event: iterate_result\ndata: {json.dumps(data)}\n\n"


# ─── /run ────────────────────────────────────────────────────────────────────

async def stream_run(req: RunRequest):
    queue = asyncio.Queue()
    sse_queue = asyncio.Queue()  # For tool_request events in sandbox mode
    loop = asyncio.get_running_loop()
    run_id = str(uuid.uuid4())[:8]
    session_id = req.sandbox_session_id or run_id
    event_filter = EventFilter(run_id, mode=req.mode)

    accumulator = EventAccumulator()
    accumulator_sessions[session_id] = accumulator

    # Common kwargs for run doc saves
    fs_common = dict(run_id=run_id, task=req.task, user_id=req.user_id, mode=req.mode, provider=req.provider)

    on_log = _make_on_log(loop, queue)

    def emit_sandbox_event(event_type: str, data: dict):
        loop.call_soon_threadsafe(sse_queue.put_nowait, UIEvent(event_type, data))

    # Create executor based on mode
    code_executor = None
    # Sandbox mode: force-enable tools that will be delegated to frontend
    enable_code = req.enable_code
    enable_bash = req.enable_bash
    if req.sandbox_mode:
        caps = (req.sandbox_config or {}).get("capabilities", [])
        enable_code = "execute_code" in caps or enable_code
        enable_bash = "bash" in caps
        code_executor = RemoteExecutor(
            session_id, emit_sandbox_event,
            sandbox_config=req.sandbox_config
        )
        code_executor.set_loop(loop)
        sandbox_sessions[session_id] = code_executor
    elif enable_code:
        code_executor = SubprocessExecutor(req.artifacts_dir)

    # Build prompt (multimodal if attachments provided)
    if req.attachments:
        prompt: Prompt = [req.task]
        for att in req.attachments:
            prompt.append(Attachment(
                content=att.content,
                mime_type=att.mime_type,
                name=att.name or "",
                preview=att.preview,
            ))
    else:
        prompt = req.task

    # Build provider config with thinking level
    provider_config = _build_provider_config(req.provider, req.thinking_level, req.api_key)

    harness = AsyncRLHarness(
        provider=provider_config,
        enable_search=req.enable_search,
        enable_bash=enable_bash,
        enable_code=enable_code,
        enable_ask_user=req.enable_ask_user,
        code_executor=code_executor,
        artifacts_dir=req.artifacts_dir,
        skills_dir=req.skills_dir,
        max_iterations=req.max_iterations,
        on_event=on_log,
        stream=True,
        stream_subagents=True,
    )

    # Store provider for user question responses
    provider_sessions[session_id] = harness.provider

    # Create Firestore run doc (non-blocking)
    fs_doc(**fs_common, rubric=req.rubric, status="executing", is_initial=True)

    # Emit run_start
    start_data: dict = {"run_id": run_id, "session_id": session_id, "task": req.task, "mode": req.mode}
    if req.sandbox_mode and req.sandbox_config:
        start_data["sandbox"] = req.sandbox_config
    yield ui_event_to_sse(UIEvent("run_start", start_data))

    # Auto-create plan if plan mode without a plan
    plan = req.plan
    if req.mode == "plan" and not plan:
        try:
            brief, plan = await _create_plan(harness.provider, req.task, req.enable_search)
            ev = UIEvent("plan_created", {"brief": brief, "plan": plan})
            accumulator.process(ev)
            yield ui_event_to_sse(ev)
        except Exception as e:
            yield ui_event_to_sse(UIEvent("error", {"message": f"Plan creation failed: {e}"}))
            return

    # Emit client-provided rubric immediately (won't come from tool call)
    if req.rubric:
        yield ui_event_to_sse(UIEvent("rubric", {"run_id": run_id, "content": req.rubric}))

    async def _run():
        return await harness.run_single(
            prompt, req.ground_truth,
            mode=req.mode, checkpoint=req.checkpoint,
            plan=plan, rubric=req.rubric, num_takes=req.num_takes or 0,
        )

    future = asyncio.create_task(_run())

    # Save result to Firestore even if client disconnects (SSE stream closes)
    def _on_done(fut):
        try:
            res = fut.result()
            if res.rubric:
                rubric_store[run_id] = res.rubric
            fs_doc(**fs_common, rubric=res.rubric, result=res, status="completed")
        except BaseException as exc:
            fs_doc(**fs_common, status="error", error=str(exc))

    future.add_done_callback(_on_done)

    try:
        while not future.done():
            try:
                # Check both queues with short timeout
                entry = await asyncio.wait_for(queue.get(), timeout=0.05)
                if ev := event_filter.process(entry):
                    accumulator.process(ev)
                    yield ui_event_to_sse(ev)
            except asyncio.TimeoutError:
                pass
            # Yield any pending sandbox tool requests
            while not sse_queue.empty():
                sev = sse_queue.get_nowait()
                accumulator.process(sev)
                yield ui_event_to_sse(sev)

        # Drain remaining events
        while not queue.empty():
            if ev := event_filter.process(queue.get_nowait()):
                accumulator.process(ev)
                yield ui_event_to_sse(ev)
        while not sse_queue.empty():
            sev = sse_queue.get_nowait()
            accumulator.process(sev)
            yield ui_event_to_sse(sev)

        # Get result (_on_done already saved to Firestore)
        try:
            result = await future
        except Exception as e:
            yield ui_event_to_sse(UIEvent("error", {"message": str(e)}))
            return

        # Store session for resume if checkpointing enabled
        if req.checkpoint and harness.snapshots:
            now = time.time()
            session_store[run_id] = Session(
                harness=harness,
                run_ids=[run_id],
                created_at=now,
                last_accessed=now,
                config={
                    "provider": req.provider, "thinking_level": req.thinking_level,
                    "enable_search": req.enable_search, "enable_bash": req.enable_bash,
                    "enable_code": req.enable_code,
                },
            )
            yield ui_event_to_sse(UIEvent("checkpoints", {
                "session_id": run_id,
                "checkpoint_ids": list(harness.snapshots.keys()),
            }))

        if req.mode == "explore":
            accumulator.set_explore_result(result.answer)

        yield result_to_sse(result, run_id=run_id, mode=req.mode, briefs=event_filter.briefs)

    finally:
        fs_categories(run_id, accumulator.to_docs())
        accumulator_sessions.pop(session_id, None)
        provider_sessions.pop(session_id, None)
        if req.sandbox_mode:
            sandbox_sessions.pop(session_id, None)


@app.post("/run")
async def run(req: RunRequest, request: Request):
    req.api_key = request.headers.get("x-provider-key") or req.api_key
    return StreamingResponse(stream_run(req), media_type="text/event-stream")


# ─── /iterate ────────────────────────────────────────────────────────────────

async def stream_iterate(req: IterateRequest):
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    run_id = str(uuid.uuid4())[:8]
    session_id = run_id  # Use run_id as session for iterate
    event_filter = EventFilter(run_id)

    accumulator = EventAccumulator()

    fs_common = dict(run_id=run_id, task=req.task, user_id=req.user_id, mode="iterate", provider=req.provider)

    on_log = _make_on_log(loop, queue)

    provider_config = _build_provider_config(req.provider, req.thinking_level, req.api_key)

    code_executor = SubprocessExecutor(req.artifacts_dir) if req.enable_code else None
    harness = AsyncRLHarness(
        provider=provider_config,
        enable_search=req.enable_search,
        enable_bash=req.enable_bash,
        enable_code=req.enable_code,
        enable_ask_user=req.enable_ask_user,
        code_executor=code_executor,
        artifacts_dir=req.artifacts_dir,
        max_iterations=req.max_iterations,
        on_event=on_log,
        stream=True,
        stream_subagents=True,
    )

    # Store provider for user question responses
    provider_sessions[session_id] = harness.provider

    async def run_iterate():
        return await harness.iterate(
            task=req.task,
            answer=req.answer,
            rubric=req.rubric,
            feedback=req.feedback,
            rubric_update=req.rubric_update,
            checkpoint=req.checkpoint,
        )

    # Create Firestore run doc (non-blocking)
    fs_doc(**fs_common, rubric=req.rubric, status="executing", is_initial=True)

    # Emit iterate_start
    yield ui_event_to_sse(UIEvent("iterate_start", {"run_id": run_id, "session_id": session_id, "task": req.task}))

    future = asyncio.create_task(run_iterate())

    # Save result to Firestore even if client disconnects
    def _on_done(fut):
        try:
            res = fut.result()
            run_result = RunResult(task=req.task, ground_truth="", answer=res.answer, rubric=res.rubric)
            fs_doc(**fs_common, rubric=res.rubric, result=run_result, status="completed")
        except BaseException as exc:
            fs_doc(**fs_common, status="error", error=str(exc))

    future.add_done_callback(_on_done)

    try:
        while not future.done():
            try:
                entry = await asyncio.wait_for(queue.get(), timeout=0.1)
                if ev := event_filter.process(entry):
                    accumulator.process(ev)
                    yield ui_event_to_sse(ev)
            except asyncio.TimeoutError:
                continue

        while not queue.empty():
            if ev := event_filter.process(queue.get_nowait()):
                accumulator.process(ev)
                yield ui_event_to_sse(ev)

        # Get result (_on_done already saved to Firestore)
        try:
            result = await future
        except Exception as e:
            yield ui_event_to_sse(UIEvent("error", {"message": str(e)}))
            return

        if req.checkpoint and harness.snapshots:
            now = time.time()
            session_store[run_id] = Session(
                harness=harness,
                run_ids=[run_id],
                created_at=now,
                last_accessed=now,
                config={
                    "provider": req.provider, "thinking_level": req.thinking_level,
                    "enable_search": req.enable_search, "enable_bash": req.enable_bash,
                    "enable_code": req.enable_code,
                },
            )
            yield ui_event_to_sse(UIEvent("checkpoints", {
                "session_id": run_id,
                "checkpoint_ids": list(harness.snapshots.keys()),
            }))

        yield iterate_result_to_sse(result, run_id)

    finally:
        fs_categories(run_id, accumulator.to_docs())
        provider_sessions.pop(session_id, None)


@app.post("/iterate")
async def iterate(req: IterateRequest, request: Request):
    req.api_key = request.headers.get("x-provider-key") or req.api_key
    return StreamingResponse(stream_iterate(req), media_type="text/event-stream")


# ─── /resume ─────────────────────────────────────────────────────────────────

async def stream_resume(req: ResumeRequest):
    session = session_store.get(req.session_id)
    if not session:
        yield ui_event_to_sse(UIEvent("error", {"message": f"Session '{req.session_id}' not found"}))
        return
    if session.busy:
        yield ui_event_to_sse(UIEvent("error", {"message": "Session is busy with another resume"}))
        return

    session.busy = True
    session.last_accessed = time.time()
    harness = session.harness
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    run_id = str(uuid.uuid4())[:8]
    event_filter = EventFilter(run_id)

    accumulator = EventAccumulator()

    cfg = session.config
    fs_common = dict(
        run_id=run_id, task=f"resume:{req.session_id}/{req.checkpoint_id}",
        user_id=req.user_id, mode="resume", provider=cfg.get("provider", "gemini"),
    )

    on_log = _make_on_log(loop, queue)

    # Re-wire logging to new queue
    harness.provider.on_log = on_log

    # Create Firestore run doc (non-blocking)
    fs_doc(**fs_common, status="executing", is_initial=True)

    yield ui_event_to_sse(UIEvent("resume_start", {
        "run_id": run_id, "session_id": req.session_id,
        "checkpoint_id": req.checkpoint_id, "feedback": req.feedback,
    }))

    async def run_resume():
        return await harness.resume(
            checkpoint_id=req.checkpoint_id,
            feedback=req.feedback,
            rubric_update=req.rubric_update or req.feedback,
            ground_truth=req.ground_truth,
        )

    future = asyncio.create_task(run_resume())

    # Save result to Firestore even if client disconnects
    def _on_done(fut):
        try:
            res = fut.result()
            fs_doc(**fs_common, rubric=res.rubric, result=res, status="completed")
        except BaseException as exc:
            fs_doc(**fs_common, status="error", error=str(exc))

    future.add_done_callback(_on_done)

    try:
        while not future.done():
            try:
                entry = await asyncio.wait_for(queue.get(), timeout=0.05)
                if ev := event_filter.process(entry):
                    accumulator.process(ev)
                    yield ui_event_to_sse(ev)
            except asyncio.TimeoutError:
                pass

        # Drain remaining
        while not queue.empty():
            if ev := event_filter.process(queue.get_nowait()):
                accumulator.process(ev)
                yield ui_event_to_sse(ev)

        # Get result (_on_done already saved to Firestore)
        try:
            result = await future
        except Exception as e:
            yield ui_event_to_sse(UIEvent("error", {"message": str(e)}))
            return

        session.run_ids.append(run_id)

        # Emit updated checkpoints
        yield ui_event_to_sse(UIEvent("checkpoints", {
            "session_id": req.session_id,
            "checkpoint_ids": list(harness.snapshots.keys()),
        }))
        yield result_to_sse(result, run_id=run_id)
    finally:
        fs_categories(run_id, accumulator.to_docs())
        session.busy = False


@app.post("/resume")
async def resume(req: ResumeRequest):
    return StreamingResponse(stream_resume(req), media_type="text/event-stream")


# ─── Other endpoints ─────────────────────────────────────────────────────────

@app.post("/rubric/edit")
async def rubric_edit(req: RubricEditRequest):
    key = req.plan_id or "default"
    rubric_store[key] = req.rubric
    return {"ok": True, "plan_id": key}


@app.get("/rubric/{plan_id}")
async def rubric_get(plan_id: str):
    return {"rubric": rubric_store.get(plan_id, "")}


@app.get("/checkpoints/{session_id}")
async def get_checkpoints(session_id: str):
    session = session_store.get(session_id)
    if not session:
        return {"error": "Session not found"}
    session.last_accessed = time.time()
    snapshots = session.harness.snapshots
    return {
        "session_id": session_id,
        "run_ids": session.run_ids,
        "checkpoints": [
            {"id": s.id, "step": s.step, "mode": s.state.get("mode", "standard")}
            for s in snapshots.values()
        ],
    }


# --- TTL cleanup ---

async def _cleanup_sessions():
    while True:
        await asyncio.sleep(300)
        cutoff = time.time() - SESSION_TTL
        for k in [k for k, v in session_store.items() if v.last_accessed < cutoff]:
            session_store.pop(k, None)


@app.get("/skills")
async def list_skills(skills_dir: str = "./skills"):
    """List available skills from the skills directory."""
    skills = parse_skills(skills_dir)
    return {
        "skills": [
            {"name": s.name, "type": s.type, "description": s.description, "dir": s.dir_path}
            for s in skills
        ],
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# Sandbox tool execution endpoints

@app.post("/tool/respond")
async def tool_respond(req: ToolResponseRequest):
    executor = sandbox_sessions.get(req.session_id)
    if executor:
        executor.receive_response(req.request_id, req.result)
        if acc := accumulator_sessions.get(req.session_id):
            acc.set_tool_output(req.request_id, req.result)
        return {"acknowledged": True}
    return {"acknowledged": False, "error": "Session not found"}


@app.get("/tool/pending")
async def tool_pending(session_id: str):
    executor = sandbox_sessions.get(session_id)
    if executor:
        return {"pending": executor.get_pending_requests()}
    return {"pending": []}


# User question response endpoint

@app.post("/question/respond")
async def question_respond(req: QuestionResponseRequest):
    """Respond to a user question from ask_user tool."""
    provider = provider_sessions.get(req.session_id)
    if provider:
        success = provider.receive_user_response(req.question_id, req.answers)
        return {"acknowledged": success, "question_id": req.question_id}
    return {"acknowledged": False, "error": "Session not found"}
