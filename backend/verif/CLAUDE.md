# Claude Instructions for verif/

## Module Map

```
verif/
├── __init__.py          # Exports: RLHarness, RunResult, ProviderConfig, HistoryEntry, Attachment
├── harness.py           # RLHarness class - public API entry point
├── config.py            # Dataclasses: ModeConfig, ProviderConfig, Attachment, Prompt, Snapshot, CompactionConfig
├── modes.py             # Mode registry: STANDARD, PLAN, EXPLORE, ITERATE + get_mode(), get_tools_for_mode()
├── prompts.py           # All LLM system prompts as module-level string constants
├── executor.py          # CodeExecutor protocol, SubprocessExecutor, RemoteExecutor
└── providers/
    ├── base.py          # BaseProvider ABC + TOOL_DEFINITIONS dict + orchestrator loop
    ├── gemini.py        # GeminiProvider (gemini-3-flash-preview, thinking levels)
    ├── openai.py        # OpenAIProvider (gpt-5.2, reasoning effort)
    └── anthropic.py     # AnthropicProvider (claude-opus-4-6, extended thinking)
```

## Data Flow

```
RLHarness.run_single(task, mode)
  → get_mode(name) → ModeConfig
  → provider.run_with_mode(task, mode, ...)
      → get_tools_for_mode(mode, enable_search, ...)  # merge optional tools
      → PROMPTS[mode.orchestrator_prompt].format(**mode_kwargs)
      → _orchestrator_loop(task, system, tool_names, max_iterations)
          → _init_context()  [provider-specific]
          → loop: _call_model() → _execute_tools_parallel() → _append_tool_results()
          → returns submitted_answer
```

## Key Abstractions

### ModeConfig (config.py)
Declarative mode definition. All behavior differences live here, not in branching code:
- `orchestrator_prompt`: key into `PROMPTS` dict in `base.py`
- `brief_prompt`: key into `PROMPTS` dict
- `tools`: base tool list (optional tools appended by `get_tools_for_mode`)
- `rubric_strategy`: `"create"` | `"provided"` | `"skip"`
- `prompt_kwargs`: list of format vars injected into orchestrator prompt

### BaseProvider (providers/base.py)
Abstract class all providers implement. Contains:
- Full orchestrator loop (`run_with_mode`, `_orchestrator_loop`)
- All tool execution logic (`_execute_tool`, `_execute_tools_parallel`)
- Context compaction (async, via Gemini cross-provider)
- Checkpointing (`Snapshot`) and resume
- `ask_user` with threading.Event wait
- `TOOL_DEFINITIONS` dict: canonical tool schemas (converted per-provider)

Abstract methods each provider must implement:
- `generate(prompt, system, ...)` → str
- `search(query, ...)` → str
- `read_file_with_vision(file_path, prompt)` → str
- `_init_context(task, system, tool_names)` → context object
- `_call_model(context, step_desc, stream)` → (list[FunctionCall], str)
- `_append_tool_results(context, func_calls, results)`
- `_estimate_context_tokens(context)` → int
- `_get_context_length(context)` → int
- `_rebuild_context_with_summary(context, summary, keep_recent)` → context
- `_inject_feedback(context, text)`
- `_item_to_xml(item)` → str
- `_extract_context_section(context, start, end)` → list
- `_debug_log(message)`

### TOOL_DEFINITIONS (providers/base.py)
Dict of canonical tool schemas. Keys: `create_brief`, `create_rubric`, `delegate`,
`search_web`, `verify_answer`, `submit_answer`, `bash`, `read_file`, `execute_code`,
`search_files`, `verify_exploration`, `ask_user`, `notify`, `check_background`.

Providers convert via their own helper (e.g. `_to_anthropic_tool`, Gemini/OpenAI formats differ).

### PROMPTS registry (providers/base.py)
Maps string keys → prompt constants from `prompts.py`:
```python
PROMPTS = {
    "ORCHESTRATOR": ORCHESTRATOR,
    "ORCHESTRATOR_WITH_PLAN": ORCHESTRATOR_WITH_PLAN,
    "EXPLORE_ORCHESTRATOR": EXPLORE_ORCHESTRATOR,
    "ITERATE_ORCHESTRATOR": ITERATE_ORCHESTRATOR,
    "BRIEF_CREATOR": BRIEF_CREATOR,
    "EXPLORE_BRIEF": EXPLORE_BRIEF,
    "RUBRIC_CREATOR": RUBRIC_CREATOR,
    "VERIFICATION": VERIFICATION,
    "EXPLORE_VERIFIER": EXPLORE_VERIFIER,
}
```
`ModeConfig.orchestrator_prompt` and `ModeConfig.brief_prompt` are keys into this dict.

## Adding a New Mode

1. Add prompt(s) to `prompts.py`
2. Register prompts in `PROMPTS` dict in `providers/base.py`
3. Define `ModeConfig` in `modes.py` and add to `MODES` dict
4. If mode needs new tools: add to `TOOL_DEFINITIONS` and implement in `_execute_tool`

## Adding a New Tool

1. Add definition to `TOOL_DEFINITIONS` in `providers/base.py`
2. Add execution branch in `_execute_tool` (same file)
3. Add to relevant `ModeConfig.tools` lists in `modes.py`

## Adding a New Provider

1. Create `providers/<name>.py` subclassing `BaseProvider`
2. Set `provider_name = "<name>"`
3. Implement all abstract methods
4. Add load branch in `harness.py::load_provider()`

## Rubric Strategies
- `"create"`: orchestrator calls `create_rubric` tool during execution (standard mode)
- `"provided"`: rubric pre-set by caller on `provider.rubric` (plan/iterate mode); orchestrator can still call `create_rubric` if not set
- `"skip"`: no rubric; uses `verify_exploration` with `EXPLORE_VERIFIER` checklist instead

## Tool Ordering Convention
`get_tools_for_mode()` inserts optional tools (`search_web`, `search_files`, `execute_code`, `ask_user`) just before the verification tool. Preserve this ordering when modifying mode tool lists.

## Streaming
- `stream=True` on harness → main orchestrator emits chunk events via `on_log`
- `stream_subagents=True` → subagents emit `subagent_chunk` events
- Providers emit via `self.emit(entry_type, content, metadata)` (no history storage)
- Providers log via `self.log(entry_type, content)` (stored in history + triggers `on_log`)

## Compaction
Triggered async when context exceeds `CompactionConfig.threshold` (default 80%) of provider's max tokens. Always uses Gemini (`_run_gemini_compaction_sync`) regardless of active provider. Applied on next loop iteration.

## Checkpointing
- Enabled via `checkpoint=True` on `run_single()`
- Snapshots stored in `provider.snapshots` dict keyed by `"{run_id}:step:{n}"`
- Resume via `harness.resume(checkpoint_id=..., feedback=..., rubric_update=...)`
- `rubric_update` merges via `RUBRIC_MERGER` prompt before restoring snapshot

## Security: Bash Tool
`_execute_bash` enforces allowlist (`ALLOWED_BASH_COMMANDS`) and blocks dangerous patterns (`DANGEROUS_PATTERNS`). Do not weaken these without explicit justification.

## Provider Models
- Gemini: `gemini-3-flash-preview` (thinking levels: LOW/MEDIUM/HIGH)
- OpenAI: `gpt-5.2` (reasoning effort: low/medium/high)
- Anthropic: `claude-opus-4-6` (thinking budget_tokens, default 10000)
- Compaction always uses: `gemini-3-flash-preview` with LOW thinking
