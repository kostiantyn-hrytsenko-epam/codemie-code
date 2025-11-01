/**
 * Integration Test: Interactive conversation simulation
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Interactive Conversation Simulation', () => {
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

  it('should handle 3 consecutive interactive questions', async () => {
    if (skipIfNoBaseUrl()) return;
    const questions = [
      'What is 2+2?',
      'What is the capital of France?',
      'List files in the current directory'
    ];

    let completedQuestions = 0;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      let hasCompleted = false;
      let hasError = false;

      await assistant.agent.chatStream(question, (event) => {
        if (event.type === 'complete') {
          hasCompleted = true;
        }
        if (event.type === 'error') {
          hasError = true;
        }
      });

      assert.ok(hasCompleted || !hasError, `Question ${i + 1} should complete successfully`);

      if (hasCompleted) {
        completedQuestions++;
      }
    }

    assert.strictEqual(completedQuestions, 3, 'All 3 questions should complete');
  });
});
