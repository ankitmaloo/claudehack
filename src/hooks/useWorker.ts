import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import * as Comlink from 'comlink';
import type { SandboxTools } from '@/workers/sandbox';

interface WorkerState {
  isReady: boolean;
  isProcessing: boolean;
  error: string | null;
}

export function useWorker() {
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<SandboxTools> | null>(null);
  const [state, setState] = useState<WorkerState>({
    isReady: false,
    isProcessing: false,
    error: null,
  });

  // Initialize the worker
  useEffect(() => {
    try {
      // Create the worker
      const worker = new Worker(
        new URL('../workers/sandbox.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current = worker;

      // Wrap with Comlink
      const api = Comlink.wrap<SandboxTools>(worker);
      apiRef.current = api;

      // Test the connection
      api.ping().then(() => {
        setState(s => ({ ...s, isReady: true, error: null }));
      }).catch(err => {
        setState(s => ({ ...s, error: `Worker initialization failed: ${err.message}` }));
      });

      // Handle worker errors
      worker.onerror = (event) => {
        setState(s => ({ ...s, error: `Worker error: ${event.message}` }));
      };

      return () => {
        worker.terminate();
        workerRef.current = null;
        apiRef.current = null;
      };
    } catch (err) {
      setState(s => ({ ...s, error: `Failed to create worker: ${(err as Error).message}` }));
    }
  }, []);

  // Wrapper to track processing state
  const withProcessing = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setState(s => ({ ...s, isProcessing: true, error: null }));
    try {
      const result = await fn();
      setState(s => ({ ...s, isProcessing: false }));
      return result;
    } catch (err) {
      setState(s => ({
        ...s,
        isProcessing: false,
        error: (err as Error).message
      }));
      throw err;
    }
  }, []);

  // Exposed API methods
  const api = useMemo(() => {
    const worker = apiRef.current;

    return {
      // String operations
      reverseString: (data: string) =>
        withProcessing(() => worker?.reverseString(data) ?? Promise.reject('Worker not ready')),

      // JSON parsing
      parseJSON: (jsonString: string, maxSize?: number) =>
        withProcessing(() => worker?.parseJSON(jsonString, maxSize) ?? Promise.reject('Worker not ready')),

      // File processing
      processTextFile: (content: string) =>
        withProcessing(() => worker?.processTextFile(content) ?? Promise.reject('Worker not ready')),

      // Search
      searchContent: (content: string, pattern: string, flags?: string) =>
        withProcessing(() => worker?.searchContent(content, pattern, flags) ?? Promise.reject('Worker not ready')),

      // Text transformation
      transformText: (content: string, transformation: 'uppercase' | 'lowercase' | 'titlecase' | 'reverse-lines' | 'sort-lines' | 'dedupe-lines') =>
        withProcessing(() => worker?.transformText(content, transformation) ?? Promise.reject('Worker not ready')),

      // Markdown processing
      extractCodeBlocks: (markdown: string) =>
        withProcessing(() => worker?.extractCodeBlocks(markdown) ?? Promise.reject('Worker not ready')),

      // Hash computation
      computeHash: (content: string) =>
        withProcessing(() => worker?.computeHash(content) ?? Promise.reject('Worker not ready')),

      // Diff
      diffStrings: (original: string, modified: string) =>
        withProcessing(() => worker?.diffStrings(original, modified) ?? Promise.reject('Worker not ready')),

      // Code execution (use with caution!)
      executeCode: (code: string, timeout?: number) =>
        withProcessing(() => worker?.executeCode(code, timeout) ?? Promise.reject('Worker not ready')),

      // Health check
      ping: () =>
        worker?.ping() ?? Promise.reject('Worker not ready'),
    };
  }, [withProcessing]);

  // Restart the worker (useful for recovery)
  const restart = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setState({ isReady: false, isProcessing: false, error: null });

    // Re-trigger the effect by updating a dep (handled by React)
    const worker = new Worker(
      new URL('../workers/sandbox.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current = worker;
    apiRef.current = Comlink.wrap<SandboxTools>(worker);

    apiRef.current.ping().then(() => {
      setState(s => ({ ...s, isReady: true }));
    });
  }, []);

  return {
    ...state,
    ...api,
    restart,
  };
}
