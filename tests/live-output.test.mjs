/**
 * Integration Test: Live output format
 * Uses Node.js native test runner
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { CodeMieAgent } from '../dist/code/agent.js';
import { loadConfig } from '../dist/code/config.js';
import { FilesystemTools } from '../dist/code/tools/filesystem.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Live Output Format', () => {
  let agent;

  before(() => {
    if (skipIfNoBaseUrl()) return;

    const config = loadConfig(process.cwd());
    const filesystemTools = new FilesystemTools({
      allowedDirectories: [process.cwd()]
    });
    const tools = filesystemTools.getTools();
    agent = new CodeMieAgent(config, tools);
  });

  it('should produce correctly formatted live output', async () => {
    if (skipIfNoBaseUrl()) return;
    let hasToolCall = false;
    let hasToolResult = false;
    let hasContent = false;

    await agent.chatStream('list files in current directory', (event) => {
      switch (event.type) {
        case 'content_chunk':
          hasContent = true;
          break;

        case 'tool_call_start':
          hasToolCall = true;
          break;

        case 'tool_call_result':
          hasToolResult = true;
          break;
      }
    });

    assert.ok(hasContent, 'Should have content chunks');
    assert.ok(hasToolCall, 'Should have tool calls');
    assert.ok(hasToolResult, 'Should have tool results');
  });
});
