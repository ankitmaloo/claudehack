#!/usr/bin/env node
/**
 * Sandbox Test Client
 *
 * Tests the sandbox tool execution protocol by:
 * 1. Sending a task with sandbox_mode + sandbox_config
 * 2. Listening for tool_request SSE events
 * 3. Executing tools locally (simulating browser sandbox)
 * 4. Responding via POST /tool/respond
 *
 * Usage:
 *   node test_client.mjs "your task here"
 *   node test_client.mjs --config pyodide "calculate fibonacci"
 *   node test_client.mjs --config node "read package.json"
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

// Configuration
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000';
const PROJECT_ROOT = process.cwd();

// Sandbox configurations - tells the MODEL what runtime to generate code for
const SANDBOX_CONFIGS = {
  // Default: JavaScript in Web Worker (per fs_spec.md section 2.4)
  javascript: {
    type: 'javascript',
    version: 'ES2022',
    capabilities: ['execute_code', 'file_read', 'file_write', 'file_list', 'file_search'],
    constraints: [
      'JavaScript executed in isolated Web Worker',
      'Use readFile(path) to read files - returns string content',
      'Use writeFile(path, content) to create or overwrite files directly in the project - this is the ONLY way to save output',
      'Use listFiles(path) to list directory contents - returns array of {name, isDirectory}',
      'To save results: call writeFile("output.md", content) - do NOT print or console.log large outputs, write them to a file instead',
      'No DOM, no fetch, no network, no downloading, no printing to save',
      'console.log() is for short status messages only',
      'All file operations are async: use await readFile(), await writeFile(), await listFiles()'
    ].join('. ')
  },
  // Alternative: WebContainers for full Node.js
  webcontainer: {
    type: 'webcontainer',
    version: 'node18',
    capabilities: ['execute_code', 'shell', 'file_read', 'file_write'],
    constraints: [
      'Node.js via WebContainers in browser',
      'Full filesystem in project directory',
      'Can use require() and npm packages',
      'No native modules'
    ].join('. ')
  }
};

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  let configName = 'javascript'; // Default: JS in Web Worker
  let task = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configName = args[i + 1];
      i++;
    } else {
      task = task ? `${task} ${args[i]}` : args[i];
    }
  }

  return {
    task: task || 'Read fs_spec.md and summarize section 2.1',
    config: SANDBOX_CONFIGS[configName] || SANDBOX_CONFIGS.javascript,
    configName
  };
}

/**
 * Execute a tool locally (simulates browser sandbox execution)
 */
async function executeToolLocally(tool, args, sandboxConfig) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[TOOL] ${tool}`);
  console.log(`[SANDBOX] ${sandboxConfig?.type || 'unknown'}`);

  switch (tool) {
    case 'execute_code': {
      const code = args.code || '';
      const preview = code.length > 100 ? code.slice(0, 100) + '...' : code;
      console.log(`[CODE]\n${preview}`);

      // Route to appropriate runtime based on sandbox config
      const runtime = sandboxConfig?.type || 'javascript';

      if (runtime === 'webcontainer' || runtime === 'node') {
        // WebContainers would use Node - simulate with system Node
        return executePython(code); // TODO: implement executeNode
      } else {
        // Default: JavaScript in Web Worker
        return executeJavaScript(code);
      }
    }

    case 'read_file': {
      const filePath = join(PROJECT_ROOT, args.path);
      console.log(`[READ] ${args.path}`);

      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${args.path}` };
      }

      const content = readFileSync(filePath, 'utf-8');
      const stats = statSync(filePath);

      console.log(`[OK] ${stats.size} bytes`);
      return {
        success: true,
        data: { content, size: stats.size, last_modified: stats.mtimeMs }
      };
    }

    case 'write_file': {
      const filePath = join(PROJECT_ROOT, args.path);
      console.log(`[WRITE] ${args.path}`);

      writeFileSync(filePath, args.content, 'utf-8');
      const size = Buffer.byteLength(args.content);

      console.log(`[OK] ${size} bytes written`);
      return {
        success: true,
        data: { written: true, path: args.path, size, staged: true }
      };
    }

    case 'list_files': {
      const dirPath = join(PROJECT_ROOT, args.path || '');
      console.log(`[LIST] ${args.path || '.'}`);

      if (!existsSync(dirPath)) {
        return { success: false, error: `Directory not found: ${args.path}` };
      }

      const entries = readdirSync(dirPath, { withFileTypes: true }).map(dirent => {
        const fullPath = join(dirPath, dirent.name);
        const relPath = relative(PROJECT_ROOT, fullPath);
        const stats = dirent.isFile() ? statSync(fullPath) : null;

        return {
          name: dirent.name,
          path: relPath,
          is_directory: dirent.isDirectory(),
          size: stats?.size,
          last_modified: stats?.mtimeMs
        };
      });

      console.log(`[OK] ${entries.length} entries`);
      return { success: true, data: { entries } };
    }

    case 'search_files': {
      console.log(`[SEARCH] "${args.query}"`);
      const matches = [];

      function searchDir(dir) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;

          const fullPath = join(dir, entry.name);
          const relPath = relative(PROJECT_ROOT, fullPath);

          if (entry.isDirectory()) {
            searchDir(fullPath);
          } else if (entry.name.includes(args.query)) {
            matches.push({ path: relPath });
          } else if (args.search_content) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              if (content.includes(args.query)) {
                matches.push({ path: relPath, line: 1, content: 'Match found' });
              }
            } catch {}
          }

          if (matches.length >= 50) return;
        }
      }

      searchDir(join(PROJECT_ROOT, args.path || ''));
      console.log(`[OK] ${matches.length} matches`);
      return { success: true, data: { matches, total_matches: matches.length, truncated: matches.length >= 50 } };
    }

    default:
      console.log(`[ERROR] Unknown tool: ${tool}`);
      return { success: false, error: `Unknown tool: ${tool}` };
  }
}

/**
 * Execute Python code (simulates Pyodide)
 */
function executePython(code) {
  const tempFile = join(PROJECT_ROOT, '.temp_exec.py');

  try {
    writeFileSync(tempFile, code);
    const stdout = execSync(`python3 "${tempFile}"`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    console.log(`[STDOUT] ${stdout.slice(0, 200)}${stdout.length > 200 ? '...' : ''}`);
    return { success: true, data: { stdout, stderr: '' } };
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    const stdout = e.stdout?.toString() || '';
    console.log(`[STDERR] ${stderr.slice(0, 200)}`);
    return { success: true, data: { stdout, stderr } };
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

/**
 * Execute JavaScript code (simulates Web Worker with file tools)
 */
function executeJavaScript(code) {
  let stdout = '';

  // File tools available in the sandbox
  const readFile = (path) => {
    const fullPath = join(PROJECT_ROOT, path);
    if (!existsSync(fullPath)) throw new Error(`File not found: ${path}`);
    return readFileSync(fullPath, 'utf-8');
  };

  const writeFile = (path, content) => {
    const fullPath = join(PROJECT_ROOT, path);
    writeFileSync(fullPath, content, 'utf-8');
    return true;
  };

  const listFiles = (path = '') => {
    const fullPath = join(PROJECT_ROOT, path);
    if (!existsSync(fullPath)) throw new Error(`Directory not found: ${path}`);
    return readdirSync(fullPath, { withFileTypes: true }).map(d => ({
      name: d.name,
      isDirectory: d.isDirectory()
    }));
  };

  try {
    // Create sandbox with file tools + standard globals
    const sandbox = {
      console: { log: (...args) => { stdout += args.map(String).join(' ') + '\n'; } },
      readFile,
      writeFile,
      listFiles,
      Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise
    };

    const fn = new Function(...Object.keys(sandbox), `"use strict";\n${code}`);
    const result = fn(...Object.values(sandbox));

    // Capture return value if no console output
    if (!stdout && result !== undefined) {
      stdout = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    console.log(`[STDOUT] ${stdout.slice(0, 200)}${stdout.length > 200 ? '...' : ''}`);
    return { success: true, data: { stdout, stderr: '' } };
  } catch (e) {
    console.log(`[ERROR] ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Post tool result back to server
 */
async function respondToTool(requestId, sessionId, result) {
  console.log(`[RESPOND] → ${requestId.slice(0, 8)}...`);

  const response = await fetch(`${API_BASE}/tool/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, session_id: sessionId, result })
  });

  const data = await response.json();
  if (!data.acknowledged) {
    console.log(`[WARN] Server did not acknowledge: ${data.error}`);
  }
  return data;
}

/**
 * Run a sandbox task
 */
async function runSandboxTask(task, sandboxConfig, configName) {
  const sessionId = `test_${Date.now()}`;

  console.log('\n' + '═'.repeat(60));
  console.log('SANDBOX TEST CLIENT');
  console.log('═'.repeat(60));
  console.log(`Task: ${task}`);
  console.log(`Config: ${configName} (${sandboxConfig.type})`);
  console.log(`Session: ${sessionId}`);
  console.log(`Packages: ${sandboxConfig.packages?.join(', ') || 'none'}`);
  console.log('═'.repeat(60));

  const requestBody = {
    task,
    mode: 'standard',
    enable_code: true,
    sandbox_mode: true,
    sandbox_session_id: sessionId,
    sandbox_config: sandboxConfig
  };

  console.log('\n[REQUEST]', JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${API_BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = null;
  let currentSandboxConfig = sandboxConfig;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:') && currentEvent) {
        const dataStr = line.slice(5).trim();
        if (dataStr) {
          try {
            const data = JSON.parse(dataStr);
            await handleEvent(currentEvent, data, sessionId, currentSandboxConfig);

            // Update sandbox config if provided in tool_request
            if (currentEvent === 'tool_request' && data.sandbox) {
              currentSandboxConfig = data.sandbox;
            }
          } catch (e) {
            // Ignore JSON parse errors for incomplete data
          }
        }
        currentEvent = null;
      }
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('COMPLETED');
  console.log('═'.repeat(60));
}

/**
 * Handle SSE events
 */
async function handleEvent(eventType, data, sessionId, sandboxConfig) {
  switch (eventType) {
    case 'run_start':
      console.log(`\n[RUN] Started - ID: ${data.run_id}`);
      break;

    case 'tool_request':
      // Execute the tool and respond
      const result = await executeToolLocally(
        data.tool,
        data.args,
        data.sandbox || sandboxConfig
      );
      await respondToTool(data.request_id, data.session_id, result);
      break;

    case 'tool_response':
      console.log(`\n[TOOL DONE] ${data.tool}`);
      break;

    case 'subagent_start':
      console.log(`\n[AGENT] Started: ${data.subagent_id}`);
      break;

    case 'subagent_chunk':
      process.stdout.write(data.content || '');
      break;

    case 'subagent_end':
      console.log(`\n[AGENT] Done: ${data.subagent_id}`);
      break;

    case 'answer':
      console.log('\n' + '─'.repeat(50));
      console.log('[ANSWER]');
      console.log('─'.repeat(50));
      console.log(data.content);
      break;

    case 'result':
      console.log('\n[RESULT]');
      console.log(`  Task: ${data.task?.slice(0, 50)}...`);
      break;

    case 'error':
      console.log(`\n[ERROR] ${data.message || JSON.stringify(data)}`);
      break;

    case 'brief':
    case 'rubric':
    case 'verification':
      // Silent for these
      break;

    default:
      // Log unknown events for debugging
      if (process.env.DEBUG) {
        console.log(`\n[${eventType}]`, JSON.stringify(data).slice(0, 80));
      }
  }
}

// Main
const { task, config, configName } = parseArgs();
runSandboxTask(task, config, configName).catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
