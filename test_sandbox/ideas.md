## Yes — Co-do supports file *writing* (not just reading)

Co-do isn’t a read-only “upload some files” toy. It uses the **File System Access API** and exposes explicit write-capable tools such as **create_file**, **write_file** (full overwrite), **edit_file** (diff-based edits), plus rename/move/copy/delete/mkdir—each gated behind a permission setting (“Always allow / Ask each time / Never allow”). 

The Co-do UI itself also warns that it **modifies files** in the folder you pick, and that you should have backups and review changes. 

Separately, Paul’s write-up explicitly describes the “Layer 3” model: once the user grants a directory handle via the File System Access API, the app can (with permission) **read and write within that directory**, in a “chroot-like” jail. 


---

## So how do you give users a “commit / discard” experience in a browser-based agent?

There are two different answers:

1) **What Co-do effectively does today**, and  
2) **What you probably want for a Cowork-like “review then apply” workflow**.

### 1) Co-do’s current model: “approve each operation” (commit = approve, discard = deny)

Co-do’s main safety/UX primitive is: **the agent proposes a tool call → the app checks permissions → the user approves or denies** (configurable per tool, and destructive tools can default to “ask”). 

For edits specifically, Co-do’s `edit_file` tool is described as showing a **unified diff of changes**, which is already a big part of the “commit/discard” mental model: you can review the patch-like output before allowing the write. 

**But** Paul calls out the big missing piece: **there is no undo/backup system**—if you approve a destructive operation (like delete), it’s destructive *inside the allowed directory*. 

So in Co-do-as-shipped, the closest equivalent to “discard” is “don’t approve that operation”, and the closest equivalent to “commit” is “approve that operation”.

That’s workable, but it doesn’t feel like a single clean “review all changes → commit all” flow.


---

### 2) A stronger Cowork-style UX: stage changes, then “Commit all / Discard all”

To get a real commit/discard experience, you want to separate:

- **planning/staging** (agent does work, but doesn’t touch the real files yet)
- **application** (user explicitly applies a reviewed changeset)

Here are the most practical patterns in-browser:

#### Pattern A (most direct): “Patch-first workflow” + diff viewer
**Workflow**
- Agent is required to express modifications as **diffs/patches** (or structured edits).
- UI shows a review screen: list of changed files + per-file diffs.
- User hits **Apply** (commit) or **Discard**.

**Why it fits browsers well**
- You can keep the “real” folder untouched until approval.
- Co-do already leans this way via `edit_file` with unified diffs. 

**Implementation detail that helps**
- The File System Access API’s `createWritable()` is effectively “transactional” at the file level: **changes don’t hit disk until you close the stream** (commonly implemented via a temporary file swap on close).   
  So your “commit” is literally “close the writable stream”, and “discard” is “never close it / abort the attempt”.

This doesn’t automatically solve multi-file atomicity, but it gives a clean commit point per file.

#### Pattern B (recommended for “agentic loops”): OPFS staging area (browser-private working tree)
Paul explicitly suggests a layered approach: **read what the user granted**, but **store edits in the browser’s origin-private filesystem (OPFS)** to keep the original intact while iterating. 

**Workflow**
1. User selects a folder (the “source of truth”).
2. App copies files (or just the ones being edited) into **OPFS** as a *working copy*.
3. The agent edits **OPFS copies** freely (fast, no risk to original).
4. UI shows a changeset diff: OPFS version vs original folder version.
5. **Commit** = write changed files back to the user folder (with approvals).
6. **Discard** = delete the OPFS working copy (instant rollback).

**Why this is nice**
- You can let the agent do lots of small iterative edits without “permission fatigue” on every tiny write.
- Discard is real discard (because you never touched the originals).
- You can keep multiple “workspaces”/branches in OPFS.

#### Pattern C (minimum viable safety net): automatic backups / “trash”
If you *are* going to write directly into the selected folder (Co-do’s default mode), you can still create a commit/discard-like experience by always generating a fallback:

- Before first change to `foo.txt`, save `foo.txt` → `.co-do-backups/<timestamp>/foo.txt`
- For deletes, move to `.co-do-trash/<timestamp>/...` instead of hard delete

This directly addresses Paul’s “no undo” warning. 

It’s not as clean as OPFS staging, but it’s simple and hugely reduces the “oops” factor.

#### Pattern D (developer-centric): Git-backed commit/discard (only if it’s a repo)
If the selected folder is a Git repository, the best “commit/discard” UX developers already understand is literally:
- show `git diff`
- “Commit” creates a commit
- “Discard” checks out / restores files

In a pure browser sandbox you can’t rely on the system `git` binary, but you *can* still do Git operations using a JS implementation (e.g., isomorphic-git) wired to the File System Access API—more engineering, but very aligned with a coding-agent workflow.

(Think of this as “optional power mode”, not the default for regular users.)


---

## A concrete “Cowork in the browser” flow I’d ship

1) **Default to read-only + stage changes**
- Agent can read everything in selected folder.
- Writes go to OPFS working copy, not the real folder.

2) **Show a “Changes” drawer**
- Files changed / created / deleted
- Click a file: show unified diff (like PR review)

3) **Commit button**
- Writes changed files back using `createWritable()` and only finalizes on stream close. 
- Keep “Ask each time” for especially destructive operations (delete/rename/move), like Co-do’s permission model. 

4) **Discard button**
- Drop the OPFS working tree (fast rollback)
- Or, if you wrote directly, restore from `.co-do-backups/…`

This gives users the psychologically important guarantee: “Nothing touches my real files until I press Commit.”


---

### Bottom line
- **Does it support writing?** Yes—explicitly, with write/edit/create/delete tools and per-tool permissions.   
- **How do you do commit/discard?**
  - Co-do today: per-operation approval + diff-based edit tool (but **no undo**).   
  - Best practice: stage changes (ideally in **OPFS**) and apply as a reviewed changeset; at the file level, the browser already supports a clean “commit on close” model for writes. 


  Based on Paul Kinlan's "The browser is the sandbox" research and the **Co-do** demo, here is the answer regarding file writing and the commit/discard experience.

### **Does it support file writing?**
**Yes.** The Co-do demo and the browser sandbox architecture Paul describes support file writing using the **File System Access API** (specifically the `FileSystemFileHandle` interface).

*   **How it works:** When you select a folder in the Co-do demo, you grant the browser read/write permission to that specific directory. The agent can then create, edit, and delete files within that "jailed" environment just like a native application.
*   **The "Sandbox" Aspect:** Unlike a traditional native app that might have full disk access, the browser limits the agent *only* to the folder you explicitly selected (e.g., your "blog-drafts" folder), ensuring the agent cannot access or modify system files or other personal data outside that directory.

### **How do you give the commit / discard experience to a user?**
In this browser-based sandbox model, the "commit / discard" experience is built upon the **transactional nature** of the File System Access API's write operations.

1.  **The Technical Mechanism (Atomic Writes):**
    When the agent wants to modify a file, it calls `createWritable()` on a file handle. This creates a **`FileSystemWritableFileStream`**. Crucially, this stream writes to a **temporary file** (a "swap" file) rather than modifying the live file directly.
    *   **Commit:** The changes are only "saved" (swapped with the original file) when the `close()` method is called on the stream.
    *   **Discard:** If the operation is aborted or the stream is left open without closing, the original file remains untouched.

2.  **The User Experience (The "Review" Phase):**
    Because the changes exist in a temporary state before `close()` is called, developers can build a **"Review Mode"** or **"Diff View"** into the interface:
    *   **Step 1:** The agent generates code or text and writes it to the stream (or a separate shadow file in the Origin Private File System).
    *   **Step 2:** The application presents a **"Diff"** (difference) view to the user, showing the proposed changes alongside the original content.
    *   **Step 3:**
        *   **If the user clicks "Commit" (or "Accept"):** The app calls `stream.close()`, atomically overwriting the original file on your hard drive.
        *   **If the user clicks "Discard":** The app calls `stream.abort()`, and the temporary data is deleted, leaving your local file exactly as it was.

**Note on the Co-do Demo:**
In Paul's specific **Co-do** demo screenshot, you can see a status saying **"Live updates enabled."** This suggests that for the sake of the demo, it might be skipping the manual review step and "auto-committing" changes to show the agent's speed. However, for a production "Cowork" alternative, Paul argues that the browser's architecture perfectly supports the "Safe Code Execution" and "Review" workflow needed to trust an AI agent, using the atomic write capability described above.


Yes—you can absolutely implement an **“approve → then write”** workflow for the “browser is the sandbox” approach Paul Kinlan describes, but you have to build it at the app layer. The core trick is to **separate “draft changes” from “user’s real folder”**.

Paul’s post explicitly lays out three filesystem “layers” you can combine:

- **Layer 1 (read-only folder selection)** e.g. `webkitdirectory`
- **Layer 2 (Origin Private File System / OPFS)**: a filesystem *private to your site* (not user-visible)
- **Layer 3 (File System Access API)**: read/write access to a user-selected folder, effectively “chroot-like” to that folder handle 

That layering is exactly what you want for “non-committed changes”.

---

## What Co-do does today (and why you’re asking)
Co-do (the demo from the post) has **granular permissions** (“always allow / ask / never allow”), and it even has an `edit_file` operation that “shows a unified diff of changes” . But it still fundamentally performs writes directly against the selected folder once permission is granted—and Paul calls out the gaps:

- **No undo**: if the LLM deletes a file, “it’s gone”   
- **Permission fatigue**: approving every operation is secure but annoying 

A staging/commit model solves both: fewer prompts (approve a batch), and you can offer undo because you control the staging area.

---

## The pattern you want: “staging area” + “commit”
Think “git” but implemented in-browser:

### Key idea
1) **Read from the user folder** (Layer 1 or Layer 3 *read-only*)  
2) **Write all proposed changes into OPFS** (Layer 2)  
3) Show the user a **Changes** view (added/modified/deleted + diffs)  
4) Only when the user clicks **Commit / Apply**, request **readwrite** permission and write those staged files into the user folder (Layer 3)

Paul even hints at this: read from granted data, “save some edits to a file on the Origin, keeping the original file intact” .

---

## Why OPFS (Layer 2) is ideal for “uncommitted” changes
MDN describes OPFS as:

- private to the origin (not user-visible)
- no permission prompts needed
- fast reads/writes 

That makes it perfect as your **draft workspace**.

---

## How to show “non-committed files” (a concrete design)
You need two things:

### 1) A “base snapshot” of what the user folder looks like
Store a map in memory/IndexedDB like:

```ts
type BaseEntry = { path: string; size: number; lastModified: number; hash?: string };
baseIndex: Map<string, BaseEntry>
```

(You don’t *have* to hash; size+mtime is often enough. Hashing is more correct.)

### 2) A staging manifest that tracks OPFS changes
Example:

```ts
type Change =
  | { kind: "add"; path: string }
  | { kind: "modify"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "rename"; from: string; to: string };

changes: Change[]
```

Whenever the agent “creates/edits/deletes”, you **apply it to OPFS and record it**—but you do *not* touch the user folder.

### Rendering the “Changes” UI (like `git status`)
Group by kind:

- **Added**: exists in OPFS but not in base snapshot
- **Modified**: exists in both, content differs
- **Deleted**: marked deleted (or missing from OPFS but present in base with a delete marker)
- **Renamed**: explicit rename record

For each changed file you show:
- file path
- change type
- buttons: **View diff**, **Open staged**, **Discard**

### Showing diffs
For modified text files:
- read original from user folder
- read staged from OPFS
- generate a unified diff (Co-do already has a unified diff concept in `edit_file`) 

For new files:
- show full contents (or a “new file” diff from empty → content)

For deletes:
- show “will delete X” (and optionally show the original file contents as context)

---

## “Commit” (apply staged changes to the user folder)
On commit, you finally cross the boundary into Layer 3 writes.

MDN’s File System Access flow is essentially:
- modify contents
- request permission with `{ mode: "readwrite" }`
- then save 

So your commit button does something like:

1) `await dirHandle.requestPermission({ mode: "readwrite" })` (or per-file handle)   
2) For each staged change:
   - **add/modify**: `getFileHandle(path, { create: true })` → `createWritable()` → `write()` → `close()`
   - **delete**: `removeEntry(path)`
   - **rename**: copy+delete or directory move logic

Important detail: the File System Access API writes are not in-place; they use a temporary file and only replace the original after checks pass (Chrome does additional safety checks) . That’s good for integrity, but it’s also why staging first is nice—you can show exactly what will happen before any OS-visible file is touched.

---

## Safety / UX improvements you get “for free” with staging
These map directly to Paul’s “known gaps”:

### Reduce permission fatigue
Instead of “ask for every create/write”, you can:
- let the agent operate freely in OPFS
- ask the user once: **Commit 12 changes?**
This directly addresses the “secure but annoying” tradeoff Paul mentions .

### Add “undo”
Paul notes Co-do has “no undo” today . With staging you can implement:
- **Discard all staged changes**: delete the OPFS workspace directory
- **Revert a file**: remove its staged version and clear its manifest entry
- **Rollback after commit**: keep a backup copy of overwritten originals in OPFS (or store diffs)

### Block suspicious outputs
Paul highlights “malicious file creation is still possible” (e.g., scripts/macros) . A staging UI gives you a natural place to:
- warn on certain extensions (`.bat`, `.ps1`, macro-enabled Office formats, etc.)
- require extra confirmation
- restrict binary creation unless explicitly allowed

---

## Bottom line
If you want “approve before writing to the real folder”, do **not** let the agent write directly to the selected directory handle as it goes.

Instead:

- Use the user folder as **read-only source of truth**
- Use **OPFS as a staging filesystem**
- Show a **Changes** panel (added/modified/deleted + diffs)
- Only on **Commit**, request `readwrite` permission and apply the staged changes

That matches the layered model in the article and directly fixes two of the biggest issues Paul calls out (permission fatigue + no undo). 


Based on **Simon Willison’s "The Browser is the Sandbox"**, the answer is: **Yes, absolutely.**

In fact, the architecture Simon describes relies entirely on the fact that you **cannot** write to the user's real hard drive by default. The "Sandbox" he refers to (often using technologies like WebContainers or the Origin Private File System) is a completely isolated environment.

Here is how you handle the "Write $\to$ Approve $\to$ Commit" flow in that specific context.

### 1. The "Sandbox" is a Virtual Drive (OPFS/WebContainer)
When an LLM (or your app) "writes" a file in this architecture, it is strictly writing to the **Browser's Internal Storage** (specifically the *Origin Private File System* or *OPFS*).

*   **The "Write":** The LLM generates code (`index.html`, `server.js`). You save this immediately to the OPFS.
*   **Safety:** This file exists **only** inside the browser tab. It is invisible to the user's Operating System (MacOS/Windows/Linux). Even if the LLM writes malicious code, it is trapped inside the browser's sandbox.

### 2. How to show "Non-Committed" Files
Since the files are sitting in the virtual file system (the sandbox) but not on the local disk, you can build a UI that treats the Sandbox as a "Staging Area."

**The UI Workflow:**
1.  **The Live Preview (The "Functional" Diff):**
    Because the files are in the browser sandbox, you can *run* them immediately in an `<iframe>`.
    *   *User Action:* The user sees the app running.
    *   *Validation:* "Does this app actually work?" This is a form of approval that happens *before* the code touches the real disk.
2.  **The Code Diff:**
    You compare the content currently in the **OPFS (Sandbox)** against the content (if any) that you previously synced to the **Local Disk**.
    *   *UI:* A split-pane view showing "Generated Version" vs "Local Version."

### 3. The Approval (Committing to Disk)
This is the moment the user decides the code in the sandbox is safe and useful. You use the **File System Access API** to bridge the gap.

**The "Ejection" Pattern:**
Simon Willison often points to tools like `bolt.new` or `Claude Artifacts`. The flow is:

1.  **Virtual Write:** The AI generates a full project structure in the browser memory (OPFS).
2.  **User Verification:** The user interacts with the running app in the preview window.
3.  **The "Commit" Button:** The user clicks a button labeled "Download," "Export," or "Sync."
4.  **The Bridge:**
    *   The browser prompts: *"Select a folder to save these files."* (This is `window.showDirectoryPicker()`).
    *   Once the user grants permission to that *specific* local folder, your app copies the files **from the Sandbox (OPFS) $\to$ Real Disk**.

### Summary of the Architecture
In the "Browser is the Sandbox" model, **approval is implicit in the "Export" action.**

| Step | Location | Visibility to OS | Action |
| :--- | :--- | :--- | :--- |
| **1. AI Generates** | **Sandbox (OPFS)** | **Invisible** | App writes freely here. No permission needed. |
| **2. User Reviews** | **Browser UI** | **Invisible** | User sees "Pending" files and a running Preview. |
| **3. User Approves**| **Bridge** | **Prompt** | User clicks "Sync/Save"; grants Folder Access. |
| **4. Commit** | **Local Disk** | **Visible** | App copies files from Sandbox to OS. |

You verify the files by **running them inside the sandbox** first. This is the superpower of this approach: you don't just review the *code* (text), you review the *behavior* (runtime) before allowing it onto your machine.