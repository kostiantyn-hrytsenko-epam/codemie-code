/**
 * Integration Test: Verify MCP tools are loaded correctly
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { CodeMieCode } from '../dist/code/index.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Tool Loading', () => {
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

  it('should load all tools', () => {
    if (skipIfNoBaseUrl()) return;
    const agent = assistant.agent;
    const tools = agent.tools;

    assert.ok(tools, 'Tools should be defined');
    assert.ok(tools.length > 0, 'Should have loaded tools');
  });

  it('should load tools by category', () => {
    if (skipIfNoBaseUrl()) return;
    const agent = assistant.agent;
    const tools = agent.tools;

    const toolTypes = {
      filesystem: [],
      command: [],
      git: [],
      mcp: [],
      other: []
    };

    tools.forEach(tool => {
      if (tool.name.startsWith('mcp_')) {
        toolTypes.mcp.push(tool);
      } else if (tool.name.includes('file') || tool.name.includes('directory') || tool.name.includes('read') || tool.name.includes('write')) {
        toolTypes.filesystem.push(tool);
      } else if (tool.name.includes('command') || tool.name.includes('execute')) {
        toolTypes.command.push(tool);
      } else if (tool.name.includes('git')) {
        toolTypes.git.push(tool);
      } else {
        toolTypes.other.push(tool);
      }
    });

    assert.ok(toolTypes.filesystem.length >= 8, `Expected >= 8 filesystem tools, got ${toolTypes.filesystem.length}`);
    assert.ok(toolTypes.command.length >= 2, `Expected >= 2 command tools, got ${toolTypes.command.length}`);
    assert.ok(toolTypes.git.length >= 3, `Expected >= 3 git tools, got ${toolTypes.git.length}`);
  });

  it('should load MCP tools from context7', () => {
    if (skipIfNoBaseUrl()) return;
    const agent = assistant.agent;
    const tools = agent.tools;

    const mcpTools = tools.filter(tool => tool.name.startsWith('mcp_'));

    assert.ok(mcpTools.length >= 2, `Expected >= 2 MCP tools, got ${mcpTools.length}`);

    const toolNames = mcpTools.map(t => t.name);
    assert.ok(toolNames.includes('mcp_resolve-library-id'), 'Should have mcp_resolve-library-id');
    assert.ok(toolNames.includes('mcp_get-library-docs'), 'Should have mcp_get-library-docs');
  });
});
