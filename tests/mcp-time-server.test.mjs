/**
 * Integration Test: Time MCP Server
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MCPTools } from '../dist/code/tools/mcp.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MCP Time Server', () => {
  let mcpTools;

  before(async () => {
    if (skipIfNoBaseUrl()) return;

    mcpTools = new MCPTools(process.cwd());
    await mcpTools.initialize(['time']);
  });

  after(async () => {
    if (mcpTools) {
      await mcpTools.dispose();
    }
  });

  it('should load tools from time server', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    assert.ok(tools.length > 0, 'Should have loaded tools from time server');
  });

  it('should have get_current_time tool', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const getTimeTool = tools.find(t => t.name === 'mcp_get_current_time');
    assert.ok(getTimeTool, 'get_current_time tool should be available');
  });

  it('should execute get_current_time tool', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const getTimeTool = tools.find(t => t.name === 'mcp_get_current_time');

    const result = await getTimeTool.invoke({ timezone: 'Europe/Vilnius' });

    assert.ok(result, 'Tool should return a result');

    // Try to parse the result
    const data = typeof result === 'string' ? JSON.parse(result) : result;
    assert.ok(data.datetime || data.timezone, 'Result should contain datetime or timezone');
  });
});
