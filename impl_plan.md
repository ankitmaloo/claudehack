# Vite + React Implementation Guide for Browser Sandboxing (Refined "Best Path")

This guide details the implementation of a high-security browser sandbox using **Vite**, **React**, and **TypeScript**, leveraging **OPFS** as a staging area to maximize safety.

## 1. Architecture: The "Staging" Model

To achieve the "best possible" security, we will not let the LLM write directly to the user's disk. Instead, we use a **read-process-stage-commit** loop.

1.  **Read**: App reads files from **Local File System** (User permitted).
2.  **Process**: LLM/Workers process data in isolation.
3.  **Stage**: Results are written to **OPFS (Origin Private File System)**. This is a hidden, fast file system inside the browser.
4.  **preview**: User sees the result (via SafeRenderer).
5.  **Commit**: User explicitly clicks "Save", copying files from **OPFS** -> **Local File System**.

## 2. Environment Setup (Main App)

### 2.1 Dependencies
We will use `comlink` to simplify the complex Web Worker communication required for this architecture.
```bash
npm install comlink
```

### 2.2 Content Security Policy (index.html)
The strict CSP remains the first line of defense.
**File**: `index.html`
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com;
  script-src 'self' 'unsafe-inline' 'unsafe-eval'; 
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' blob: data:;
  worker-src 'self' blob:;
">
```

## 3. The File System Layer (Hybrid)

We need a unified interface that handles both the "Real" (Local) files and the "Staged" (OPFS) files.

### 3.1 File System Hook
**File**: `src/hooks/useFileSystem.ts`
```typescript
import { useState, useCallback } from 'react';

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  
  // Select the project root
  const openProject = async () => {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    setRootHandle(handle);
  };
  
  // Read from Local Dis
  const readFile = async (path: string) => {
    // ... traversal logic to get file handle ...
    const file = await fileHandle.getFile();
    return file.text();
  };

  // Write to STAGING (OPFS) - The Safe Default
  const stageFile = async (path: string, content: string) => {
    const opfsRoot = await navigator.storage.getDirectory();
    // ... logic to create/write file in OPFS ...
    const fileHandle = await opfsRoot.getFileHandle(path, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  };

  // Commit (Copy OPFS -> Local)
  const commitFile = async (path: string) => {
    // 1. Read from OPFS
    // 2. Write to rootHandle (Local FS)
  };

  return { rootHandle, openProject, readFile, stageFile, commitFile };
}
```

## 4. The Double Iframe "SafeRenderer" (React)

This component isolates the *view* of the content.

**File**: `src/components/SafeRenderer.tsx`
```tsx
import React, { useMemo } from 'react';

export const SafeRenderer = ({ htmlContent }: { htmlContent: string }) => {
  
  // Inner Iframe: The content itself. Locked down.
  const innerBlob = useMemo(() => {
    const html = `<!DOCTYPE html><body>${htmlContent}</body>`;
    return new Blob([html], { type: 'text/html' });
  }, [htmlContent]);
  
  const innerUrl = useMemo(() => URL.createObjectURL(innerBlob), [innerBlob]);

  // Outer Iframe: The Firewall.
  // It loads the inner blob iframe.
  // CSP prevents the inner frame from phoning home even if it tries.
  const outerSrcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-src blob:;">
      <style>body, iframe { width: 100%; height: 100%; border: 0; margin: 0; }</style>
    </head>
    <body>
      <iframe src="${innerUrl}" sandbox=""></iframe>
    </body>
    </html>
  `;

  return (
    <iframe
      srcDoc={outerSrcDoc}
      sandbox="allow-scripts allow-same-origin" // allow-same-origin needed for blob? verify.
      className="w-full h-full border-0"
    />
  );
};
```
*Refinement Check*: Using `blob:` URLs for the inner frame is often cleaner than nested `srcdoc`, but the double-srcdoc approach (from the article) is more robust against blob-origin leakage in some browsers. We will stick to the **Double SrcDoc** method in implementation as it is the article's proven path.

## 5. Execution Sandbox (Web Workers + Comlink)

We move all logic (parsing commands, running vague tool calls) into a worker.

**File**: `src/workers/sandbox.ts`
```typescript
import * as Comlink from 'comlink';

const tools = {
  async heavyComputation(data: string) {
    // Perform complex logic here, off main thread
    return data.split('').reverse().join('');
  },
  
  // Future: Load WASM here
};

Comlink.expose(tools);
```

**File**: `src/hooks/useWorker.ts`
```typescript
import { useMemo } from 'react';
import * as Comlink from 'comlink';

export function useWorker() {
  const workerApi = useMemo(() => {
    const worker = new Worker(new URL('../workers/sandbox.ts', import.meta.url), {
      type: 'module'
    });
    return Comlink.wrap<typeof import('../workers/sandbox').tools>(worker);
  }, []);
  
  return workerApi;
}
```

## 6. Development Checklist

1. [ ] Install `comlink`.
2. [ ] Create `FileSystemContext` with OPFS staging logic.
3. [ ] Build `SafeRenderer` with strict Double Iframe.
4. [ ] Setup `sandbox.ts` worker.
5. [ ] Verify CSP in `index.html`.
