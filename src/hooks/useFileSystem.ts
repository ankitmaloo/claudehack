import { useState, useCallback, useRef } from 'react';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: number;
}

interface StagedFile {
  path: string;
  content: string | ArrayBuffer | Blob;
  originalPath?: string;
}

export function useFileSystem() {
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<Map<string, StagedFile>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache for file handles to avoid repeated traversals
  const handleCache = useRef<Map<string, FileSystemFileHandle | FileSystemDirectoryHandle>>(new Map());

  // Request access to a project directory
  const openProject = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setRootHandle(handle);
      setProjectName(handle.name);
      handleCache.current.clear();

      return handle;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(`Failed to open project: ${(err as Error).message}`);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Close the current project
  const closeProject = useCallback(() => {
    setRootHandle(null);
    setProjectName(null);
    setStagedFiles(new Map());
    handleCache.current.clear();
  }, []);

  // Traverse path to get file/directory handle
  const getHandle = useCallback(async (
    path: string,
    options?: { create?: boolean; isFile?: boolean }
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> => {
    if (!rootHandle) return null;

    const cacheKey = `${path}:${options?.create}:${options?.isFile}`;
    if (handleCache.current.has(cacheKey)) {
      return handleCache.current.get(cacheKey)!;
    }

    const parts = path.split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = rootHandle;

    try {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (isLast && options?.isFile) {
          const handle = await current.getFileHandle(part, { create: options?.create });
          handleCache.current.set(cacheKey, handle);
          return handle;
        } else {
          current = await current.getDirectoryHandle(part, { create: options?.create });
        }
      }

      handleCache.current.set(cacheKey, current);
      return current;
    } catch {
      return null;
    }
  }, [rootHandle]);

  // Read file from local file system only (for diffs / comparing against original)
  const readLocalFile = useCallback(async (path: string): Promise<string | null> => {
    try {
      const handle = await getHandle(path, { isFile: true });
      if (!handle || handle.kind !== 'file') {
        return null;
      }

      const file = await (handle as FileSystemFileHandle).getFile();
      return await file.text();
    } catch {
      return null;
    }
  }, [getHandle]);

  // Read file: staged (OPFS) first, then local filesystem
  const readFile = useCallback(async (path: string): Promise<string | null> => {
    // Check staged files first — this is what makes writes immediately readable
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const parts = path.split('/').filter(Boolean);
      let current = opfsRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }
      const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      // Not staged — fall through to local
    }

    return readLocalFile(path);
  }, [readLocalFile]);

  // Read file as ArrayBuffer (for binary files)
  const readFileAsBuffer = useCallback(async (path: string): Promise<ArrayBuffer | null> => {
    try {
      const handle = await getHandle(path, { isFile: true });
      if (!handle || handle.kind !== 'file') {
        throw new Error(`File not found: ${path}`);
      }

      const file = await (handle as FileSystemFileHandle).getFile();
      return await file.arrayBuffer();
    } catch (err) {
      setError(`Failed to read file: ${(err as Error).message}`);
      return null;
    }
  }, [getHandle]);

  // Stage file to OPFS (safe write to browser-private storage)
  const stageFile = useCallback(async (path: string, content: string | ArrayBuffer | Blob, originalPath?: string) => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();

      // Create directory structure in OPFS
      const parts = path.split('/').filter(Boolean);
      let current = opfsRoot;

      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i], { create: true });
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();

      // Track staged file
      setStagedFiles(prev => {
        const next = new Map(prev);
        next.set(path, { path, content, originalPath });
        return next;
      });

      return true;
    } catch (err) {
      setError(`Failed to stage file: ${(err as Error).message}`);
      return false;
    }
  }, []);

  // Read staged file from OPFS
  const readStagedFile = useCallback(async (path: string): Promise<string | null> => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const parts = path.split('/').filter(Boolean);
      let current = opfsRoot;

      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }, []);

  // Read staged file from OPFS as Blob (for binary downloads)
  const readStagedFileAsBlob = useCallback(async (path: string): Promise<Blob | null> => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const parts = path.split('/').filter(Boolean);
      let current = opfsRoot;

      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await current.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return file;
    } catch {
      return null;
    }
  }, []);

  // Commit staged file to local file system
  const commitFile = useCallback(async (path: string): Promise<boolean> => {
    if (!rootHandle) {
      setError('No project open');
      return false;
    }

    try {
      // Read from OPFS as blob (works for both text and binary)
      const blob = await readStagedFileAsBlob(path);
      if (blob === null) {
        throw new Error(`Staged file not found: ${path}`);
      }

      // Write to local file system
      const handle = await getHandle(path, { create: true, isFile: true });
      if (!handle || handle.kind !== 'file') {
        throw new Error(`Failed to create file: ${path}`);
      }

      const writable = await (handle as FileSystemFileHandle).createWritable();
      await writable.write(blob);
      await writable.close();

      // Remove from staged files
      setStagedFiles(prev => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      // Invalidate cache
      handleCache.current.clear();

      return true;
    } catch (err) {
      setError(`Failed to commit file: ${(err as Error).message}`);
      return false;
    }
  }, [rootHandle, readStagedFileAsBlob, getHandle]);

  // Commit all staged files
  const commitAllFiles = useCallback(async (): Promise<boolean> => {
    const paths = Array.from(stagedFiles.keys());

    for (const path of paths) {
      const success = await commitFile(path);
      if (!success) return false;
    }

    return true;
  }, [stagedFiles, commitFile]);

  // Delete staged file from OPFS
  const discardStagedFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const parts = path.split('/').filter(Boolean);
      let current = opfsRoot;

      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }

      const fileName = parts[parts.length - 1];
      await current.removeEntry(fileName);

      setStagedFiles(prev => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      return true;
    } catch (err) {
      setError(`Failed to discard staged file: ${(err as Error).message}`);
      return false;
    }
  }, []);

  // Discard all staged files
  const discardAllStagedFiles = useCallback(async (): Promise<boolean> => {
    const paths = Array.from(stagedFiles.keys());

    for (const path of paths) {
      const success = await discardStagedFile(path);
      if (!success) return false;
    }

    return true;
  }, [stagedFiles, discardStagedFile]);

  // List files in a directory (local + staged files merged)
  const listFiles = useCallback(async (path: string = ''): Promise<FileEntry[]> => {
    if (!rootHandle) return [];

    try {
      const handle = path
        ? await getHandle(path) as FileSystemDirectoryHandle
        : rootHandle;

      if (!handle || handle.kind !== 'directory') return [];

      const entries: FileEntry[] = [];

      for await (const [name, entryHandle] of handle.entries()) {
        entries.push({
          name,
          path: path ? `${path}/${name}` : name,
          isDirectory: entryHandle.kind === 'directory',
        });
      }

      // Merge staged files that are new (not on local disk yet)
      const existingNames = new Set(entries.map(e => e.name));
      const normalizedDir = path.replace(/\/$/, '');

      for (const [stagedPath, staged] of stagedFiles) {
        const parts = stagedPath.split('/').filter(Boolean);
        const parentDir = parts.slice(0, -1).join('/');
        const fileName = parts[parts.length - 1];

        if (parentDir === normalizedDir && !existingNames.has(fileName)) {
          const content = staged.content;
          const size = content instanceof Blob ? content.size
            : content instanceof ArrayBuffer ? content.byteLength
            : new Blob([content]).size;
          entries.push({
            name: fileName,
            path: stagedPath,
            isDirectory: false,
            size,
            lastModified: Date.now(),
          });
        }
      }

      return entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [];
    }
  }, [rootHandle, getHandle, stagedFiles]);

  // Clear all OPFS data for this app
  const clearOPFS = useCallback(async () => {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      for await (const [name] of opfsRoot.entries()) {
        await opfsRoot.removeEntry(name, { recursive: true });
      }
      setStagedFiles(new Map());
      return true;
    } catch (err) {
      setError(`Failed to clear OPFS: ${(err as Error).message}`);
      return false;
    }
  }, []);

  return {
    // State
    rootHandle,
    projectName,
    stagedFiles,
    isLoading,
    error,
    hasProject: !!rootHandle,
    hasStagedFiles: stagedFiles.size > 0,

    // Project operations
    openProject,
    closeProject,

    // File operations (layered: staged first, then local)
    readFile,
    readLocalFile,
    readFileAsBuffer,
    listFiles,

    // Staging operations (OPFS)
    stageFile,
    readStagedFile,
    readStagedFileAsBlob,
    commitFile,
    commitAllFiles,
    discardStagedFile,
    discardAllStagedFiles,
    clearOPFS,
  };
}
