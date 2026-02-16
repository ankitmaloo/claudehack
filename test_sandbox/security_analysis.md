# Security Analysis of Browser Sandboxing Specification for KWH

## 1. Executive Summary
The proposed architecture in `fs_spec.md` creates a robust, multi-layered defense using native browser isolation. While individual pillars (FS, CSP, Iframes) are strong, the system's primary risks reside in the **Inter-Sandbox Communication (ISC)** and the susceptibility to **Indirect Prompt Injection**, where data-as-instructions can bypass technical controls. The posture is **Strong**, but requires rigorous enforcement of handle-based state management and request sanitization.

---

## 2. Pillar-by-Pillar Deep Dive (STRIDE Model)

### 2.1 File System Sandbox (FSAA)
*   **Strengths**: Native OS-level isolation via the File System Access API.
*   **Vulnerability 1: Information Disclosure (Recursive Access)**
    *   **Description**: Users granting root access inadvertently expose `.ssh`, `.env`, or `.git`.
    *   **Impact: High | Likelihood: High**
    *   **STRIDE**: Information Disclosure
*   **Vulnerability 2: Tampering (Symlink Attacks)**
    *   **Description**: Malicious repos using symlinks to trick the AI into overwriting system files.
    *   **Impact: High | Likelihood: Low**
    *   **STRIDE**: Tampering
*   **Attack Scenarios**:
    *   **User-centric**: The AI convinces the user that "Full Drive Access" is required for a simple search task.
    *   **System-centric**: An injection command triggers a recursive search for `id_rsa` in parent directories via a symlink.

### 2.2 Network Sandbox (CSP)
*   **Strengths**: Zero-trust network policy via `default-src 'none'`.
*   **Vulnerability 1: Information Disclosure (Exfiltration via Allowed Endpoints)**
    *   **Description**: Data tunneled through `api.anthropic.com` via prompt/metadata fields.
    *   **Impact: High | Likelihood: Medium**
    *   **STRIDE**: Information Disclosure
*   **Vulnerability 2: Information Disclosure (Side-Channel Timing)**
    *   **Description**: CSS `unicode-range` timing attacks to leak DOM data if `unsafe-inline` is permitted.
    *   **Impact: Medium | Likelihood: Low**
    *   **STRIDE**: Information Disclosure
*   **Attack Scenarios**:
    *   **System-centric**: A script uses the allowed `connect-src` to send base64-encoded file data to the AI provider.
    *   **User-centric**: AI hallucinates a reason for the user to manually white-list a domain in a configuration file.

### 2.3 Rendering Sandbox (Double Iframe)
*   **Strengths**: Prevents untrusted HTML from accessing the main thread's origin.
*   **Vulnerability 1: Elevation of Privilege (`srcdoc` Injection)**
    *   **Description**: Attribute breakout during string-based iframe construction.
    *   **Impact: Critical | Likelihood: Medium**
    *   **STRIDE**: Elevation of Privilege
*   **Vulnerability 2: Spoofing (Same-Origin Leakage)**
    *   **Description**: Misconfigured `allow-same-origin` allowing access to parent cookies/DOM.
    *   **Impact: High | Likelihood: Medium**
    *   **STRIDE**: Spoofing
*   **Attack Scenarios**:
    *   **System-centric**: An LLM-generated payload injects a script into the outer iframe that attempts to post messages to the main thread.
    *   **User-centric**: A fake "Login" prompt is rendered in the sandboxed iframe to harvest credentials for the main app.

### 2.4 Execution Sandbox (Web Workers & WASM)
*   **Strengths**: Isolated execution thread with no DOM access.
*   **Vulnerability 1: Information Disclosure (Spectre/Side-Channel)**
    *   **Description**: Timing attacks via WASM to read memory from the host process.
    *   **Impact: Medium | Likelihood: Low**
    *   **STRIDE**: Information Disclosure
*   **Vulnerability 2: Tampering (Over-Privileged Host Functions)**
    *   **Description**: WASM modules calling host-provided `writeFile` without path validation.
    *   **Impact: High | Likelihood: Medium**
    *   **STRIDE**: Tampering
*   **Attack Scenarios**:
    *   **System-centric**: A WASM tool executes a buffer overflow to overwrite memory within the worker context.
    *   **User-centric**: AI suggests using a "Performance Optimization" WASM binary that actually contains a cryptojacker.

---

## 3. Cross-Cutting Concerns

### 3.1 Inter-Sandbox Communication (ISC) & IPC
The "broker" logic in the main thread is the critical failure point. 
*   **Statefulness & Race Conditions**: If the broker manages multiple file handles without strictly mapping them to specific sandbox sessions, a race condition could allow Sandbox A to write to a handle owned by Sandbox B.
*   **Shared Memory**: Using `SharedArrayBuffer` for performance introduces Spectre risks.
*   **Mitigation**: Use `MessageChannel` for point-to-point security and strict session-to-handle mapping.

### 3.2 "Dark Matter": Logging & Auditing
The spec lacks a mechanism for **Security Observability**.
*   **Gap**: No audit log for file system operations or CSP violations.
*   **Requirement**: Implement a tamper-proof log in the main thread that records all "privileged" calls requested by sandboxes.

---

## 4. Strategic Recommendations

| Priority | Category | Recommendation | Type |
| :--- | :--- | :--- | :--- |
| **Critical** | **IPC** | **Handle-Based Access**: Use UUIDs for IPC; never pass raw string paths. | Immediate |
| **Critical** | **Iframe** | **Blob URL Sourcing**: Use `URL.createObjectURL` instead of `srcdoc` strings. | Immediate |
| **High** | **Network** | **Request Proxy**: Scrub AI request payloads for sensitive patterns. | Architectural |
| **High** | **FS** | **Path Blocklisting**: Explicitly deny access to `.ssh`, `.env`, `.git`. | Immediate |
| **Medium** | **Execution**| **Isolation Headers**: Enforce `COOP` and `COEP` browser headers. | Architectural |
| **Medium** | **Audit** | **Security Event Logging**: Log all sandbox-to-main-thread requests. | Architectural |

---

## 5. Residual Risk Assessment
1.  **Logical Corruption**: AI may still delete valid data within a "permitted" folder.
2.  **Prompt Injection Evolution**: Future injection techniques may bypass current delimiter-based protections.
3.  **Social Engineering**: Persuasive agents tricking users into manual "Security Downgrades."

**Final Posture**: The system is resilient against direct technical exploits but requires focus on **data-plane security** (scrubbing prompts) and **IPC state integrity**.