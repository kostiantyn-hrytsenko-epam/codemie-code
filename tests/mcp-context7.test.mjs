/**
 * Integration Test: Context7 MCP Server Integration
 * Uses Node.js native test runner
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MCPTools } from '../dist/code/tools/mcp.js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';
import * as os from 'os';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MCP Context7 Server', () => {
  let mcpTools;
  let configPath;
  let originalConfig;

  before(async () => {
    if (skipIfNoBaseUrl()) return;
    configPath = path.join(os.homedir(), '.codemie', 'config.json');

    // Backup original config
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      originalConfig = JSON.parse(content);
    } catch (error) {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      originalConfig = {};
    }

    // Ensure context7 and time servers are configured
    const config = { ...originalConfig };
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers.context7 = {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp']
    };

    config.mcpServers.time = {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-time']
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    mcpTools = new MCPTools(process.cwd());
    await mcpTools.initialize(['time', 'context7']);
  });

  after(async () => {
    if (mcpTools) {
      await mcpTools.dispose();
    }

    // Restore original config
    if (originalConfig) {
      await fs.writeFile(configPath, JSON.stringify(originalConfig, null, 2), 'utf-8');
    }
  });

  it('should load tools from both time and context7 servers', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    assert.ok(tools.length > 0, 'Should have loaded tools');

    const timeTools = tools.filter(t => t.name.includes('time'));
    const context7Tools = tools.filter(t => t.name.includes('library') || t.name.includes('resolve'));

    assert.ok(timeTools.length > 0, 'Should have time tools');
    assert.ok(context7Tools.length > 0, 'Should have context7 tools');
  });

  it('should query time in Hong Kong', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const getTimeTool = tools.find(t => t.name === 'mcp_get_current_time');

    const timeResult = await getTimeTool.invoke({ timezone: 'Asia/Hong_Kong' });
    const timeData = typeof timeResult === 'string' ? JSON.parse(timeResult) : timeResult;

    assert.ok(timeData.timezone && timeData.timezone.includes('Hong_Kong'), 'Should return Hong Kong timezone');
  });

  it('should resolve library ID for langchain', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const resolveTool = tools.find(t => t.name.includes('resolve') && t.name.includes('library'));

    assert.ok(resolveTool, 'Should have resolve-library-id tool');

    const resolveResult = await resolveTool.invoke({ libraryName: 'langchain' });

    assert.ok(resolveResult, 'Should return a result');
    assert.ok(typeof resolveResult === 'string' && resolveResult.length > 0, 'Result should be non-empty string');
  });
});
