/**
 * Sandbox Tool Executor
 *
 * Handles tool_request events from the backend and executes them
 * using the browser's File System Access API.
 */

import * as XLSX from 'xlsx';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } from 'docx';

const API_BASE = 'http://localhost:8000';

export interface ToolRequest {
  request_id: string;
  session_id: string;
  tool: string;
  args: Record<string, unknown>;
  timeout_ms: number;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
  last_modified?: number;
}

export interface FileSystemInterface {
  readFile: (path: string) => Promise<string | null>;
  listFiles: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean; size?: number; lastModified?: number }>>;
  stageFile: (path: string, content: string | ArrayBuffer | Blob, originalPath?: string) => Promise<boolean>;
  readStagedFileAsBlob: (path: string) => Promise<Blob | null>;
  discardStagedFile: (path: string) => Promise<boolean>;
  commitAllFiles: () => Promise<boolean>;
  hasProject: boolean;
  hasStagedFiles: boolean;
}

export class SandboxToolExecutor {
  private fs: FileSystemInterface;
  private sessionId: string;
  private apiBase: string;
  private onToolStart?: (request: ToolRequest) => void;
  private onToolComplete?: (request: ToolRequest, result: ToolResult) => void;

  constructor(
    fs: FileSystemInterface,
    sessionId: string,
    options?: {
      apiBase?: string;
      onToolStart?: (request: ToolRequest) => void;
      onToolComplete?: (request: ToolRequest, result: ToolResult) => void;
    }
  ) {
    this.fs = fs;
    this.sessionId = sessionId;
    this.apiBase = options?.apiBase || API_BASE;
    this.onToolStart = options?.onToolStart;
    this.onToolComplete = options?.onToolComplete;
  }

  /**
   * Handle an incoming tool request from the backend
   */
  async handleToolRequest(request: ToolRequest): Promise<void> {
    this.onToolStart?.(request);

    let result: ToolResult;

    try {
      result = await this.executeLocal(request.tool, request.args);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    this.onToolComplete?.(request, result);
    // Use session_id from the request, not our stored one
    await this.sendResponse(request.request_id, request.session_id, result);
  }

  /**
   * Execute a tool locally using the File System API
   */
  private async executeLocal(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.fs.hasProject) {
      return { success: false, error: 'No project folder open' };
    }

    switch (tool) {
      case 'read_file':
        return this.readFile(args.path as string);

      case 'write_file':
        return this.writeFile(args.path as string, args.content as string, args.encoding as string | undefined);

      case 'list_files':
        return this.listFiles(
          (args.path as string) || '',
          args.recursive as boolean,
          args.pattern as string
        );

      case 'delete_file':
        return this.deleteFile(args.path as string);

      case 'search_files':
        return this.searchFiles(
          args.query as string,
          args.search_content as boolean,
          args.path as string,
          args.pattern as string
        );

      case 'execute_code':
        return this.executeCode(args.code as string, args.timeout as number);

      case 'bash':
      case 'shell':
      case 'run_command':
        return this.executeBash(args.command as string || args.cmd as string);

      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }
  }

  /**
   * Read a file's contents
   */
  private async readFile(path: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, error: 'Path is required' };
    }

    const content = await this.fs.readFile(path);

    if (content === null) {
      return { success: false, error: `File not found: ${path}` };
    }

    return {
      success: true,
      data: {
        content,
        size: new Blob([content]).size,
        last_modified: Date.now(),
      },
    };
  }

  /**
   * Write content to a file (stages to OPFS)
   * Supports both text content and base64-encoded binary content.
   */
  private async writeFile(path: string, content: string, encoding?: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, error: 'Path is required' };
    }
    if (content === undefined || content === null) {
      return { success: false, error: 'Content is required' };
    }

    let data: string | ArrayBuffer = content;
    if (encoding === 'base64') {
      const binaryStr = atob(content);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      data = bytes.buffer;
    }

    const success = await this.fs.stageFile(path, data, path);

    if (!success) {
      return { success: false, error: `Failed to write file: ${path}` };
    }

    const size = data instanceof ArrayBuffer ? data.byteLength : new Blob([data]).size;

    return {
      success: true,
      data: {
        written: true,
        path,
        size,
        staged: true,
      },
    };
  }

  /**
   * List files in a directory (merges local + staged files)
   */
  private async listFiles(
    path: string,
    recursive?: boolean,
    pattern?: string
  ): Promise<ToolResult> {
    const entries = await this.fs.listFiles(path);

    // fs.listFiles already merges staged files
    let result: FileEntry[] = entries.map(e => ({
      name: e.name,
      path: e.path,
      is_directory: e.isDirectory,
      size: e.size,
      last_modified: e.lastModified,
    }));

    // Apply pattern filter if provided
    if (pattern) {
      const regex = this.globToRegex(pattern);
      result = result.filter(e => regex.test(e.name));
    }

    // Handle recursive listing
    if (recursive) {
      const dirs = result.filter(e => e.is_directory);
      for (const dir of dirs) {
        const subResult = await this.listFiles(dir.path, true, pattern);
        if (subResult.success && subResult.data) {
          result = result.concat((subResult.data as { entries: FileEntry[] }).entries);
        }
      }
    }

    return {
      success: true,
      data: { entries: result },
    };
  }

  /**
   * Delete a file (stages deletion)
   */
  private async deleteFile(path: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, error: 'Path is required' };
    }

    // For now, we stage an empty file to mark deletion
    // The commit logic would need to handle this specially
    await this.fs.stageFile(path, '', path);

    return {
      success: true,
      data: {
        deleted: true,
        path,
        staged: true,
      },
    };
  }

  /**
   * Search for files by name or content
   */
  private async searchFiles(
    query: string,
    searchContent?: boolean,
    basePath?: string,
    pattern?: string
  ): Promise<ToolResult> {
    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    const matches: Array<{
      path: string;
      line?: number;
      content?: string;
      context?: { before: string; after: string };
    }> = [];

    // Get all files recursively
    const listResult = await this.listFiles(basePath || '', true, pattern);
    if (!listResult.success || !listResult.data) {
      return listResult;
    }

    const entries = (listResult.data as { entries: FileEntry[] }).entries;
    const files = entries.filter(e => !e.is_directory);

    const queryLower = query.toLowerCase();

    for (const file of files) {
      // Search by filename
      if (file.name.toLowerCase().includes(queryLower)) {
        matches.push({ path: file.path });
      }

      // Search by content if enabled
      if (searchContent) {
        const content = await this.fs.readFile(file.path);
        if (content) {
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(queryLower)) {
              matches.push({
                path: file.path,
                line: index + 1,
                content: line.trim(),
                context: {
                  before: lines[index - 1]?.trim() || '',
                  after: lines[index + 1]?.trim() || '',
                },
              });
            }
          });
        }
      }

      // Limit results
      if (matches.length >= 100) break;
    }

    return {
      success: true,
      data: {
        matches,
        total_matches: matches.length,
        truncated: matches.length >= 100,
      },
    };
  }

  /**
   * Execute JavaScript code with file tools available
   */
  private async executeCode(code: string, timeout = 30000): Promise<ToolResult> {
    if (!code) {
      return { success: false, error: 'Code is required' };
    }

    return new Promise((resolve) => {
      let stdout = '';

      // Set timeout to prevent infinite loops
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Execution timed out after ${timeout}ms`,
        });
      }, timeout);

      try {
        // File tools - fs.readFile and fs.listFiles already layer staged+local
        const fsRef = this.fs;

        // Track all async file operations so un-awaited calls still complete
        const pendingOps: Promise<unknown>[] = [];

        const readFile = async (path: string): Promise<string> => {
          const content = await fsRef.readFile(path);
          if (content === null) throw new Error(`File not found: ${path}`);
          stdout += `[read] ${path} (${new Blob([content]).size} bytes)\n`;
          return content;
        };

        const writeFile = async (path: string, content: string): Promise<boolean> => {
          const op = fsRef.stageFile(path, content, path).then(success => {
            if (success) {
              stdout += `[write] ${path} (${new Blob([content]).size} bytes, staged)\n`;
            }
            return success;
          });
          pendingOps.push(op);
          return op;
        };

        // Expose bash-like helpers inside execute_code so LLMs that try bash() get something useful
        const bash = async (command: string): Promise<{ stdout: string; stderr: string }> => {
          const result = await (this as unknown as { executeBash(cmd: string): Promise<ToolResult> }).executeBash(command);
          const data = result.data as Record<string, string> | undefined;
          const out = data?.stdout || '';
          const err = data?.stderr || result.error || '';
          if (out) stdout += out + '\n';
          if (err && !result.success) stdout += `[bash error] ${err}\n`;
          return { stdout: out, stderr: err };
        };

        const writeBinaryFile = async (path: string, data: ArrayBuffer | Blob): Promise<boolean> => {
          const op = fsRef.stageFile(path, data, path).then(success => {
            if (success) {
              const size = data instanceof Blob ? data.size : data.byteLength;
              stdout += `[write binary] ${path} (${size} bytes, staged)\n`;
            }
            return success;
          });
          pendingOps.push(op);
          return op;
        };

        const listFiles = async (path = ''): Promise<Array<{ name: string; isDirectory: boolean }>> => {
          const entries = await fsRef.listFiles(path);
          return entries.map((e: { name: string; isDirectory: boolean }) => ({ name: e.name, isDirectory: e.isDirectory }));
        };

        const fileExists = async (path: string): Promise<boolean> => {
          const content = await fsRef.readFile(path);
          return content !== null;
        };

        // Helper wrapping docx library for easy document creation
        const createDocx = {
          Document,
          Paragraph,
          TextRun,
          HeadingLevel,
          AlignmentType,
          Packer,
        };

        // Create sandbox with file tools + standard globals + libraries
        const sandbox = {
          console: {
            log: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
            warn: (...args: unknown[]) => { stdout += '[WARN] ' + args.map(String).join(' ') + '\n'; },
            error: (...args: unknown[]) => { stdout += '[ERROR] ' + args.map(String).join(' ') + '\n'; },
          },
          readFile,
          writeFile,
          writeBinaryFile,
          listFiles,
          fileExists,
          bash,
          // Libraries for binary file generation
          XLSX,
          createDocx,
          // Standard globals
          Math,
          Date,
          JSON,
          Array,
          Object,
          String,
          Number,
          Boolean,
          RegExp,
          Map,
          Set,
          Promise,
          Uint8Array,
          ArrayBuffer,
          Blob,
          atob,
          btoa,
        };

        // LLMs write two patterns that produce detached promises:
        //   1. (async () => { ... })()     — self-invoking async IIFE
        //   2. async function main() { ... } main();  — trailing call
        // Since our wrapper is already async, just add `await` to both.
        let transformedCode = code;

        // Pattern 1: await top-level async IIFEs
        // (async () => { ... })()  →  await (async () => { ... })()
        transformedCode = transformedCode.replace(
          /^(\s*)\(async\s/gm,
          '$1await (async '
        );

        // Pattern 2: await trailing named function calls
        // main();  →  await main();
        transformedCode = transformedCode.replace(
          /(\w+)\s*\(\s*\)\s*;?\s*$/,
          'await $1();'
        );

        const wrappedCode = `
          "use strict";
          return (async () => {
            ${transformedCode}
          })();
        `;

        // Execute the code
        const fn = new Function(...Object.keys(sandbox), wrappedCode);
        const resultPromise = fn(...Object.values(sandbox));

        // The wrapped code always returns a Promise
        resultPromise
          .then(async (asyncResult: unknown) => {
            // Wait for any un-awaited file operations to complete
            await Promise.allSettled(pendingOps);
            clearTimeout(timeoutId);
            // Capture return value if no console output
            if (!stdout && asyncResult !== undefined) {
              stdout = typeof asyncResult === 'string' ? asyncResult : JSON.stringify(asyncResult, null, 2);
            }
            resolve({
              success: true,
              data: { stdout, stderr: '', result: asyncResult },
            });
          })
          .catch(async (err: unknown) => {
            await Promise.allSettled(pendingOps);
            clearTimeout(timeoutId);
            const errorMsg = err instanceof Error ? err.message : String(err);
            resolve({
              success: false,
              error: errorMsg,
              data: { stdout, stderr: errorMsg },
            });
          });
      } catch (err) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
          data: { stdout, stderr: err instanceof Error ? err.message : 'Unknown error' },
        });
      }
    });
  }

  /**
   * Execute a bash command by translating to file operations
   */
  private async executeBash(command: string): Promise<ToolResult> {
    if (!command) {
      return { success: false, error: 'Command is required' };
    }

    const cmd = command.trim();
    let stdout = '';

    try {
      // ls / dir
      if (/^ls\b/.test(cmd)) {
        const pathMatch = cmd.match(/^ls\s+(?:-[a-zA-Z]+\s+)*(.+)/);
        const path = pathMatch ? pathMatch[1].trim() : '';
        const entries = await this.fs.listFiles(path);
        stdout = entries.map(e => e.name + (e.isDirectory ? '/' : '')).join('\n');
        return { success: true, data: { stdout, stderr: '' } };
      }

      // cat / read
      if (/^cat\b/.test(cmd)) {
        const pathMatch = cmd.match(/^cat\s+(.+)/);
        if (!pathMatch) return { success: false, error: 'Usage: cat <file>', data: { stdout: '', stderr: 'Usage: cat <file>' } };
        const content = await this.fs.readFile(pathMatch[1].trim());
        if (content === null) return { success: false, error: `File not found: ${pathMatch[1]}`, data: { stdout: '', stderr: `cat: ${pathMatch[1]}: No such file` } };
        return { success: true, data: { stdout: content, stderr: '' } };
      }

      // mkdir - no-op in browser FS (dirs are created implicitly)
      if (/^mkdir\b/.test(cmd)) {
        return { success: true, data: { stdout: '', stderr: '' } };
      }

      // echo > file (redirect)
      const echoRedirect = cmd.match(/^echo\s+(['"]?)(.*?)\1\s*>\s*(.+)/);
      if (echoRedirect) {
        const content = echoRedirect[2];
        const path = echoRedirect[3].trim();
        await this.fs.stageFile(path, content, path);
        return { success: true, data: { stdout: '', stderr: '' } };
      }

      // echo (just print)
      if (/^echo\b/.test(cmd)) {
        const text = cmd.replace(/^echo\s+/, '').replace(/^['"]|['"]$/g, '');
        return { success: true, data: { stdout: text, stderr: '' } };
      }

      // pwd
      if (cmd === 'pwd') {
        return { success: true, data: { stdout: '/', stderr: '' } };
      }

      // head
      if (/^head\b/.test(cmd)) {
        const headMatch = cmd.match(/^head\s+(?:-n?\s*(\d+)\s+)?(.+)/);
        if (!headMatch) return { success: false, error: 'Usage: head [-n N] <file>' };
        const n = headMatch[1] ? parseInt(headMatch[1]) : 10;
        const content = await this.fs.readFile(headMatch[2].trim());
        if (content === null) return { success: false, error: `File not found`, data: { stdout: '', stderr: `head: ${headMatch[2]}: No such file` } };
        stdout = content.split('\n').slice(0, n).join('\n');
        return { success: true, data: { stdout, stderr: '' } };
      }

      // wc (word/line count)
      if (/^wc\b/.test(cmd)) {
        const pathMatch = cmd.match(/^wc\s+(?:-[a-zA-Z]+\s+)*(.+)/);
        if (!pathMatch) return { success: false, error: 'Usage: wc <file>' };
        const content = await this.fs.readFile(pathMatch[1].trim());
        if (content === null) return { success: false, error: `File not found` };
        const lines = content.split('\n').length;
        const words = content.split(/\s+/).filter(Boolean).length;
        const chars = content.length;
        stdout = `  ${lines}  ${words} ${chars} ${pathMatch[1].trim()}`;
        return { success: true, data: { stdout, stderr: '' } };
      }

      // grep
      if (/^grep\b/.test(cmd)) {
        const grepMatch = cmd.match(/^grep\s+(?:-[a-zA-Z]+\s+)*['"]?([^'"]+)['"]?\s+(.+)/);
        if (!grepMatch) return { success: false, error: 'Usage: grep <pattern> <file>' };
        const pattern = grepMatch[1];
        const filePath = grepMatch[2].trim();
        const content = await this.fs.readFile(filePath);
        if (content === null) return { success: false, error: `File not found: ${filePath}` };
        const regex = new RegExp(pattern, cmd.includes('-i') ? 'i' : '');
        const matches = content.split('\n').filter(line => regex.test(line));
        stdout = matches.join('\n');
        return { success: true, data: { stdout: stdout || '', stderr: matches.length === 0 ? '' : '' } };
      }

      // cp (copy file)
      if (/^cp\b/.test(cmd)) {
        const cpMatch = cmd.match(/^cp\s+(.+?)\s+(.+)/);
        if (!cpMatch) return { success: false, error: 'Usage: cp <src> <dest>' };
        const content = await this.fs.readFile(cpMatch[1].trim());
        if (content === null) return { success: false, error: `File not found: ${cpMatch[1]}` };
        await this.fs.stageFile(cpMatch[2].trim(), content, cpMatch[2].trim());
        return { success: true, data: { stdout: '', stderr: '' } };
      }

      // find (basic)
      if (/^find\b/.test(cmd)) {
        const result = await this.listFiles('', true);
        if (!result.success) return result;
        const entries = ((result.data as Record<string, unknown>).entries as Array<{ name: string; path: string }>) || [];
        stdout = entries.map(e => e.path).join('\n');
        return { success: true, data: { stdout, stderr: '' } };
      }

      // Reject unsupported commands explicitly
      const cmdName = cmd.split(/\s/)[0];
      const supported = ['ls', 'cat', 'mkdir', 'echo', 'pwd', 'head', 'wc', 'grep', 'cp', 'find'];
      return {
        success: false,
        error: `Unsupported command: '${cmdName}'. This is a browser sandbox, not a real shell. Supported commands: ${supported.join(', ')}. For complex logic, use the execute_code tool with JavaScript instead.`,
        data: {
          stdout: '',
          stderr: `Command '${cmdName}' is not available in the browser sandbox. Supported: ${supported.join(', ')}`,
          unsupported_command: cmdName,
          supported_commands: supported,
        },
      };

    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Command failed',
        data: { stdout, stderr: err instanceof Error ? err.message : 'Command failed' },
      };
    }
  }

  /**
   * Send tool response back to the backend
   */
  private async sendResponse(requestId: string, sessionId: string, result: ToolResult): Promise<void> {
    try {
      const response = await fetch(`${this.apiBase}/tool/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          session_id: sessionId,
          result,
        }),
      });

      if (!response.ok) {
        console.error('Failed to send tool response:', response.statusText);
      }
    } catch (err) {
      console.error('Failed to send tool response:', err);
    }
  }

  /**
   * Convert glob pattern to regex
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Check for pending tool requests (for reconnection)
   */
  async checkPendingRequests(): Promise<ToolRequest[]> {
    try {
      const response = await fetch(
        `${this.apiBase}/tool/pending?session_id=${this.sessionId}`
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.pending || [];
    } catch {
      return [];
    }
  }

  /**
   * Process any pending requests (call after reconnection)
   */
  async processPendingRequests(): Promise<void> {
    const pending = await this.checkPendingRequests();
    for (const request of pending) {
      await this.handleToolRequest(request);
    }
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
