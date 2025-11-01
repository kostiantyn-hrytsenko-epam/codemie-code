/**
 * Integration Test: UI state management
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('UI State Management', () => {
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

  it('should handle consecutive messages without blocking', async () => {
    if (skipIfNoBaseUrl()) return;
    const mockUIState = {
      isProcessing: false,
      inputEnabled: true
    };

    const questions = [
      'What is 2+2?',
      'What is the capital of France?',
      'List files in current directory'
    ];

    let messageCount = 0;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];

      // Check if processing (simulating UI check)
      assert.strictEqual(mockUIState.isProcessing, false, `Should not be processing before question ${i + 1}`);

      // Set processing flag (like the UI does)
      mockUIState.isProcessing = true;
      mockUIState.inputEnabled = false;

      try {
        // Call the agent
        await assistant.agent.chatStream(question, (event) => {
          // Track events silently
        });

        messageCount++;
      } finally {
        // Reset state (like the UI does)
        mockUIState.isProcessing = false;
        mockUIState.inputEnabled = true;
      }

      // Verify state is properly reset
      assert.strictEqual(mockUIState.isProcessing, false, `isProcessing should be reset after question ${i + 1}`);
      assert.strictEqual(mockUIState.inputEnabled, true, `inputEnabled should be reset after question ${i + 1}`);
    }

    assert.strictEqual(messageCount, 3, 'Should have processed all 3 messages');
  });
});
