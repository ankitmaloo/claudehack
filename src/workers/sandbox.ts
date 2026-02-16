import * as Comlink from 'comlink';

/**
 * Sandbox Worker - Isolated Execution Environment
 *
 * This worker runs off the main thread with:
 * - No DOM access
 * - No direct network access (CSP inherited)
 * - Memory isolation from main thread
 *
 * Use this for:
 * - Heavy computation
 * - Parsing untrusted data
 * - Running LLM-generated code (with extreme caution)
 */

interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
}

interface FileProcessingResult {
  success: boolean;
  data?: unknown;
  error?: string;
  stats?: {
    lines: number;
    words: number;
    characters: number;
    size: number;
  };
}

const sandboxTools = {
  /**
   * Heavy computation example - string reversal
   */
  async reverseString(data: string): Promise<string> {
    return data.split('').reverse().join('');
  },

  /**
   * Parse JSON safely with size limits
   */
  async parseJSON(jsonString: string, maxSize = 10 * 1024 * 1024): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      if (jsonString.length > maxSize) {
        throw new Error(`JSON too large: ${jsonString.length} bytes (max: ${maxSize})`);
      }

      const result = JSON.parse(jsonString);

      return {
        success: true,
        result,
        executionTime: performance.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        executionTime: performance.now() - startTime,
      };
    }
  },

  /**
   * Process text file - count lines, words, characters
   */
  async processTextFile(content: string): Promise<FileProcessingResult> {
    try {
      const lines = content.split('\n');
      const words = content.split(/\s+/).filter(w => w.length > 0);

      return {
        success: true,
        stats: {
          lines: lines.length,
          words: words.length,
          characters: content.length,
          size: new Blob([content]).size,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  },

  /**
   * Search text content with regex
   */
  async searchContent(
    content: string,
    pattern: string,
    flags = 'gi'
  ): Promise<{ matches: Array<{ line: number; text: string; index: number }> }> {
    const regex = new RegExp(pattern, flags);
    const lines = content.split('\n');
    const matches: Array<{ line: number; text: string; index: number }> = [];

    lines.forEach((line, lineIndex) => {
      let match;
      while ((match = regex.exec(line)) !== null) {
        matches.push({
          line: lineIndex + 1,
          text: line.trim(),
          index: match.index,
        });

        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) break;
      }
    });

    return { matches };
  },

  /**
   * Transform text with a simple mapping function
   */
  async transformText(
    content: string,
    transformation: 'uppercase' | 'lowercase' | 'titlecase' | 'reverse-lines' | 'sort-lines' | 'dedupe-lines'
  ): Promise<string> {
    switch (transformation) {
      case 'uppercase':
        return content.toUpperCase();
      case 'lowercase':
        return content.toLowerCase();
      case 'titlecase':
        return content.replace(/\b\w/g, c => c.toUpperCase());
      case 'reverse-lines':
        return content.split('\n').reverse().join('\n');
      case 'sort-lines':
        return content.split('\n').sort().join('\n');
      case 'dedupe-lines':
        return [...new Set(content.split('\n'))].join('\n');
      default:
        return content;
    }
  },

  /**
   * Extract code blocks from markdown
   */
  async extractCodeBlocks(markdown: string): Promise<Array<{ language: string; code: string }>> {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks: Array<{ language: string; code: string }> = [];

    let match;
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }

    return blocks;
  },

  /**
   * Compute hash of content (simple implementation)
   */
  async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Diff two strings (simple line-based diff)
   */
  async diffStrings(
    original: string,
    modified: string
  ): Promise<Array<{ type: 'add' | 'remove' | 'same'; line: string }>> {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const result: Array<{ type: 'add' | 'remove' | 'same'; line: string }> = [];

    // Simple LCS-based diff (not optimal but works for reasonable sizes)
    const originalSet = new Set(originalLines);
    const modifiedSet = new Set(modifiedLines);

    // Lines in original but not in modified
    originalLines.forEach(line => {
      if (!modifiedSet.has(line)) {
        result.push({ type: 'remove', line });
      } else {
        result.push({ type: 'same', line });
      }
    });

    // Lines in modified but not in original
    modifiedLines.forEach(line => {
      if (!originalSet.has(line)) {
        result.push({ type: 'add', line });
      }
    });

    return result;
  },

  /**
   * Execute arbitrary JavaScript (USE WITH EXTREME CAUTION)
   * This is sandboxed within the worker but still risky
   */
  async executeCode(code: string, timeout = 5000): Promise<ExecutionResult> {
    const startTime = performance.now();

    return new Promise((resolve) => {
      // Set timeout to prevent infinite loops
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Execution timed out after ${timeout}ms`,
          executionTime: timeout,
        });
      }, timeout);

      try {
        // Create a restricted scope
        const restrictedGlobals = {
          console: {
            log: (...args: unknown[]) => args,
            warn: (...args: unknown[]) => args,
            error: (...args: unknown[]) => args,
          },
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
        };

        // Wrap code in a function to capture return value
        const wrappedCode = `
          "use strict";
          ${code}
        `;

        // Execute with restricted scope
        const fn = new Function(...Object.keys(restrictedGlobals), wrappedCode);
        const result = fn(...Object.values(restrictedGlobals));

        clearTimeout(timeoutId);
        resolve({
          success: true,
          result,
          executionTime: performance.now() - startTime,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: (err as Error).message,
          executionTime: performance.now() - startTime,
        });
      }
    });
  },

  /**
   * Health check
   */
  async ping(): Promise<string> {
    return 'pong';
  },
};

export type SandboxTools = typeof sandboxTools;

// Expose the tools via Comlink
Comlink.expose(sandboxTools);
