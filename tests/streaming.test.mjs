/**
 * Integration Test: Streaming functionality
 * Uses Node.js native test runner
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { CodeMieAgent } from '../dist/code/agent.js';
import { loadConfig } from '../dist/code/config.js';
import { FilesystemTools } from '../dist/code/tools/filesystem.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Streaming', () => {
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

  it('should stream tool calling events', async () => {
    if (skipIfNoBaseUrl()) return;

    const events = [];

    await new Promise((resolve, reject) => {
      agent.chatStream('list files in this directory', (event) => {
        events.push(event.type);

        switch(event.type) {
          case 'complete':
            try {
              assert.ok(events.includes('thinking_start'), 'Should emit thinking_start');
              assert.ok(events.includes('thinking_end'), 'Should emit thinking_end');
              assert.ok(events.includes('tool_call_start'), 'Should emit tool_call_start');
              assert.ok(events.includes('tool_call_result'), 'Should emit tool_call_result');
              assert.ok(events.includes('content_chunk'), 'Should emit content_chunk');
              assert.ok(events.includes('complete'), 'Should emit complete');
              resolve();
            } catch (error) {
              reject(error);
            }
            break;
          case 'error':
            reject(new Error(event.error));
            break;
        }
      });
    });
  });
});
