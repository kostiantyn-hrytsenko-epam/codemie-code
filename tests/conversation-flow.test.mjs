/**
 * Integration Test: Conversation flow with multiple questions
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Conversation Flow', () => {
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

  it('should handle 3 consecutive questions', async () => {
    if (skipIfNoBaseUrl()) return;
    // Question 1
    const response1 = await assistant.chat('What is 2+2?');
    assert.ok(response1, 'Response 1 should be defined');
    assert.ok(response1.includes('4'), 'Response 1 should contain "4"');

    // Question 2
    const response2 = await assistant.chat('What is the capital of France?');
    assert.ok(response2, 'Response 2 should be defined');
    assert.ok(response2.toLowerCase().includes('paris'), 'Response 2 should contain "paris"');

    // Question 3
    const response3 = await assistant.chat('List the files in the current directory');
    assert.ok(response3, 'Response 3 should be defined');

    // Verify conversation history
    const history = assistant.agent.getHistory();
    assert.ok(history.length > 0, 'History should not be empty');

    // Count user messages - should be exactly 3
    const userMessages = history.filter(m => m.role === 'user');
    assert.strictEqual(userMessages.length, 3, 'Should have exactly 3 user messages');

    // Verify all 3 questions are in history
    const questions = [
      'What is 2+2?',
      'What is the capital of France?',
      'List the files in the current directory'
    ];

    for (let i = 0; i < questions.length; i++) {
      assert.ok(userMessages[i], `User message ${i} should exist`);
      assert.strictEqual(userMessages[i].content, questions[i], `User message ${i} should match question`);
    }
  });
});
