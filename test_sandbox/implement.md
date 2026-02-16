# Implementation Analysis: Browser Sandboxing for KWH

This document provides a technical roadmap for implementing the Browser Sandboxing Specification (`fs_spec.md`). It transforms conceptual requirements into an actionable, high-fidelity engineering plan focused on security, data integrity, and performance.

---

## 1. Architecture Overview

### 1.1 The Overlay Virtual File System (VFS)
The system implements a **Virtual File System (VFS)** that sits between the application logic and the browser's storage APIs. This VFS is responsible for abstraction, path resolution, and security enforcement.

*   **Storage Layer:** Uses the **Origin Private File System (OPFS)** for high-performance, synchronous I/O via `FileSystemSyncAccessHandle` within Web Workers. The **File System Access API** is used for the persistent "Project Root."
*   **Logic Layer (Inode/Block Mapping):** The VFS manages an internal Inode table. It maps virtual file paths to specific byte-ranges and metadata objects, abstracting the physical file handles.

### 1.2 Security & Isolation Strategy
*   **Rendering Sandbox:** A **Double-Iframe** pattern. The Outer Iframe (Firewall) manages the VFS state and validates origins. The Inner Iframe (Sandbox) renders untrusted LLM content with a `null` origin and strict CSP.
*   **Execution Sandbox:** All processing is offloaded to **Web Workers** running **WebAssembly (WASM)**, preventing main-thread blocking and ensuring memory isolation.
*   **Network Sandbox:** Enforced by a strict CSP (`default-src 'none'`) with an explicit whitelist for trusted AI providers.

### 1.3 Concurrency & Locking Strategy
To prevent race conditions during multi-worker access:
*   **Locking:** Use a **Mutex/RW-Lock** pattern implemented via `Atomics` and `SharedArrayBuffer` in Web Workers.
*   **Atomicity:** File operations (especially metadata updates) are treated as transactions to maintain VFS consistency.

---

## 2. Traceability Matrix

| Requirement ID | Description | Implementation Phase |
| :--- | :--- | :--- |
| **REQ-1** | File System Access API (showDirectoryPicker) | Phase 1, Phase 2 |
| **REQ-2** | Chroot Isolation (Rooted directory access) | Phase 3 |
| **REQ-3** | Read/Write Permission Layers | Phase 3 |
| **REQ-4** | OPFS Integration (Temp/Intermediate storage) | Phase 1, Phase 4 |
| **REQ-5** | Strict Content Security Policy (CSP) | Phase 1, Phase 3 |
| **REQ-6** | Double Iframe Rendering Pattern | Phase 3 |
| **REQ-7** | Web Workers for Execution | Phase 2, Phase 4 |
| **REQ-8** | WASM for Processing | Phase 4 |

---

## 3. Phased Roadmap

### Phase 1: Foundation
*Focus: Data structures, Block/Inode management, and security baselines.*

| ID | Task Name | Description | Related | Definition of Done (DoD) |
| :--- | :--- | :--- | :--- | :--- |
| **T1.1** | **CSP Baseline** | Implement strict `<meta>` CSP tags and headers. | REQ-5 | **Test:** Console shows 0 violations; unauthorized network requests are blocked. |
| **T1.2** | **Inode Schema** | Define Inode structure (UID, size, block pointers, permissions). | REQ-1 | **Test:** Create/Serialize an Inode and verify it persists/retrieves from the VFS header. |
| **T1.3** | **OPFS Provider** | Implement the driver for `FileSystemSyncAccessHandle` management. | REQ-4 | **Test:** Write/Read 1MB of random data to OPFS and verify 100% integrity. |
| **T1.4** | **Block Map** | Implement a bitmap to track free/allocated blocks in the storage pool. | REQ-4 | **Test:** Allocate 10 blocks, free 5, verify next allocation uses the freed indices ($O(1)$). |

### Phase 2: Core Operations
*Focus: Read/Write/Delete/Seek logic and Concurrency control.*

| ID | Task Name | Description | Related | Definition of Done (DoD) |
| :--- | :--- | :--- | :--- | :--- |
| **T2.1** | **R/W/Seek Logic** | Implement standard file operations (stream-based) with pointer seeking. | REQ-1 | **Test:** Seek to offset 10 in a file, write "Hello", and verify the file content at offset 10. |
| **T2.2** | **Concurrency Controller** | Implement `Atomics`-based locking for multi-worker access to Inodes. | REQ-7 | **Test:** Two workers attempt simultaneous write; verify sequential execution via locks. |
| **T2.3** | **Transaction Manager** | Ensure metadata updates are atomic (all-or-nothing). | REQ-1 | **Test:** Interrupt a multi-step metadata update; verify the VFS reverts to the previous valid state. |

### Phase 3: Namespace & Metadata
*Focus: Directory trees, permissions, and sandbox integration.*

| ID | Task Name | Description | Related | Definition of Done (DoD) |
| :--- | :--- | :--- | :--- | :--- |
| **T3.1** | **Directory Tree** | Implement hierarchical directory Inodes (mapping names to child IDs). | REQ-2 | **Test:** Create `/dir1/file.txt`; verify `ls /dir1` returns exactly one entry. |
| **T3.2** | **Chroot Enforcement** | Prevent path resolution from traversing outside the selected root handle. | REQ-2 | **Test:** Attempt access to `../../etc/passwd`; verify `Permission Denied` error. |
| **T3.3** | **SafeRenderer** | Implement the Double-Iframe pattern with origin-based permission checks. | REQ-6 | **Test:** Script in inner iframe attempts to access `window.parent`; verify failure (null origin). |

### Phase 4: Resilience & Optimization
*Focus: Buffering, journaling, and performance hardening.*

| ID | Task Name | Description | Related | Definition of Done (DoD) |
| :--- | :--- | :--- | :--- | :--- |
| **T4.1** | **Write-Ahead Journal** | Implement a journal to record operations before committing to Inodes. | REQ-4 | **Test:** Simulate crash during write; verify the journal "Redo" log recovers data on restart. |
| **T4.2** | **Dirty Shutdown Rec.** | Implement a consistency checker (fsck) for non-graceful exits. | REQ-4 | **Test:** Corrupt a block pointer manually; verify `fsck` identifies and repairs the orphaned block. |
| **T4.3** | **O(log n) Indexing** | Implement B-Tree indexing for directory lookups. | REQ-1 | **Test:** Search in 10k-file directory takes <5ms; performance scales logarithmically. |
| **T4.4** | **WASM Hot-Paths** | Port checksumming and encryption to WASM for max throughput. | REQ-8 | **Test:** WASM SHA-256 hashing of 10MB file is at least 2x faster than JS implementation. |

---

## 4. Dependency Graph
1.  **T1.1 (CSP)** → (Prerequisite for all features)
2.  **T1.2 (Inodes)** + **T1.3 (OPFS)** → **T1.4 (Block Map)**
3.  **T1.4** → **T2.1 (R/W/Seek)** → **T2.2 (Concurrency)**
4.  **T2.2** → **T3.1 (Directory Tree)** → **T3.2 (Chroot)**
5.  **T3.2** → **T4.1 (Journaling)** → **T4.2 (Recovery)**

---

## 5. Risk Matrix

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Metadata Corruption** | Critical | Use Phase 4 Journaling and atomic Transaction Management. |
| **XSS / Sandbox Escape** | Critical | Double-Iframe isolation with `null` origin; Strict CSP network lockdown. |
| **Storage Quota Exceeded** | Medium | Implement usage monitoring via `navigator.storage.estimate()` and auto-cleanup. |
| **Race Conditions** | High | Mandatory locking via `Atomics` for any multi-threaded Inode access. |

---

## 6. Validation Plan
- **Integrity:** MD5/SHA checksums for every file write/read cycle.
- **Security:** Automated penetration testing against the iframe boundary and CSP rules.
- **Resilience:** Power-loss simulation by forcefully terminating workers during heavy I/O.