/**
 * Integration Test: Agent output format
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Agent Output Format', () => {
  let assistant;

  before(async () => {
    if (skipIfNoBaseUrl()) return;

    assistant = new CodeMieCode(process.cwd());
    await assistant.initialize({ showTips: false });
  });

  after(async () => {
    if (assistant) {
      await assistant.dispose();
    }
  });

  it('should produce correctly formatted output', async () => {
    if (skipIfNoBaseUrl()) return;
    const capturedOutput = {
      contentChunks: [],
      toolCalls: [],
      toolResults: [],
      errors: []
    };

    await assistant.agent.chatStream('list files in current directory', (event) => {
      switch (event.type) {
        case 'content_chunk':
          capturedOutput.contentChunks.push(event.content);
          break;

        case 'tool_call_start':
          const args = Object.entries(event.toolArgs)
            .map(([k, v]) => typeof v === 'string' ? v : JSON.stringify(v))
            .join(', ');
          capturedOutput.toolCalls.push(`${event.toolName}(${args})`);
          break;

        case 'tool_call_result':
          capturedOutput.toolResults.push(event.result);
          break;

        case 'tool_call_error':
          capturedOutput.errors.push(event.error);
          break;
      }
    });

    // Validate output format
    assert.ok(capturedOutput.contentChunks.length > 0, 'Should have content chunks');
    assert.ok(capturedOutput.toolCalls.length > 0, 'Should have tool calls');
    assert.ok(capturedOutput.toolResults.length > 0, 'Should have tool results');
  });
});
