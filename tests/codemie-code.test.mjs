/**
 * Integration Test: CodeMieCode class tool calling
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('CodeMieCode Tool Calling', () => {
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

  it('should initialize successfully', () => {
    if (skipIfNoBaseUrl()) return;

    assert.ok(assistant, 'Assistant should be initialized');
    assert.ok(assistant.agent, 'Assistant should have an agent');
  });

  it('should list files in current directory', async () => {
    if (skipIfNoBaseUrl()) return;
    const response = await assistant.chat('list files in the current directory');

    assert.ok(response, 'Response should be defined');
    assert.ok(typeof response === 'string', 'Response should be a string');
    assert.ok(response.length > 0, 'Response should not be empty');
  });
});
