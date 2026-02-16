# KW (Knowledge Workbench)

A browser-native system for *knowledge work*—not "coding, but with longer prompts." Built for messy, ambiguous tasks where the hard part is framing, tradeoffs, and verification, not compiling.

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

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- Radix UI / shadcn/ui
- Redux Toolkit
- Firebase
- Web Workers (via Comlink)

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

---

*KW is a knowledge-work operating system: it explores, plans, executes in a real workspace, and verifies with rubric-based feedback—because knowledge work isn't code, and pretending it is leaves value on the table.*
