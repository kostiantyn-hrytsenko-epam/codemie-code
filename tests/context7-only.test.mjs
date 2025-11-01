/**
 * Integration Test: Context7 MCP Server Only
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MCPTools } from '../dist/code/tools/mcp.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Context7 MCP Server Only', () => {
  let mcpTools;

  before(async () => {
    if (skipIfNoBaseUrl()) return;

    mcpTools = new MCPTools(process.cwd());
    await mcpTools.initialize(['context7']);
  });

  after(async () => {
    if (mcpTools) {
      await mcpTools.dispose();
    }
  });

  it('should load tools from context7 server', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    assert.ok(tools.length > 0, 'Should have loaded tools from context7');
  });

  it('should have library-related tools', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const hasLibraryTools = tools.some(tool =>
      tool.name.includes('library') || tool.name.includes('resolve')
    );

    assert.ok(hasLibraryTools, 'Should have library-related tools');
  });
});
