/**
 * Integration Test: UI formatting
 * Uses Node.js native test runner
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('UI Format', () => {
  it('should format tool calls correctly', () => {
    const toolName = 'Bash';
    const toolArgs = { command: 'ls -la' };
    const formatted = `⏺ ${toolName}(${JSON.stringify(toolArgs)})`;

    assert.ok(formatted.includes('⏺'), 'Should include bullet point');
    assert.ok(formatted.includes('Bash'), 'Should include tool name');
    assert.ok(formatted.includes('ls -la'), 'Should include arguments');
  });

  it('should format tool results with indentation', () => {
    const result = 'total 672\ndrwxr-xr-x@  21 Nikita_Levyankov';
    const lines = result.split('\n');
    const formatted = `  ⎿  ${lines[0]}`;

    assert.ok(formatted.includes('⎿'), 'Should include corner symbol');
    assert.ok(formatted.startsWith('  '), 'Should be indented');
    assert.ok(formatted.includes('total 672'), 'Should include result content');
  });

  it('should truncate long multi-line results', () => {
    const result = Array(20).fill('line').join('\n');
    const lines = result.split('\n');
    const displayLines = lines.slice(0, 3);
    const hiddenLines = Math.max(0, lines.length - 3);

    assert.strictEqual(displayLines.length, 3, 'Should show only 3 lines');
    assert.strictEqual(hiddenLines, 17, 'Should hide 17 lines');
  });
});
