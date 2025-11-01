/**
 * Integration Test: End-to-End Time MCP Server Integration
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

describe('MCP E2E Time Server Integration', () => {
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

    // Ensure time server is configured
    const config = { ...originalConfig };
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers.time = {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-time']
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    mcpTools = new MCPTools(process.cwd());
    await mcpTools.initialize(['time']);
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

  it('should load tools from configured time server', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    assert.ok(tools.length > 0, 'Should have loaded tools');
  });

  it('should query time in Hong Kong', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const getTimeTool = tools.find(t => t.name === 'mcp_get_current_time');

    assert.ok(getTimeTool, 'get_current_time tool should exist');

    const result = await getTimeTool.invoke({ timezone: 'Asia/Hong_Kong' });
    const data = typeof result === 'string' ? JSON.parse(result) : result;

    assert.ok(data.timezone && data.timezone.includes('Hong_Kong'), 'Should return Hong Kong timezone');
    assert.ok(data.datetime, 'Should return datetime');
    assert.ok(data.day_of_week, 'Should return day of week');
  });

  it('should convert time between timezones', async () => {
    if (skipIfNoBaseUrl()) return;
    const tools = await mcpTools.getTools();
    const convertTimeTool = tools.find(t => t.name === 'mcp_convert_time');

    assert.ok(convertTimeTool, 'convert_time tool should be available');

    const convertResult = await convertTimeTool.invoke({
      source_timezone: 'Asia/Hong_Kong',
      time: '14:00',
      target_timezone: 'America/New_York'
    });

    assert.ok(convertResult, 'Should return a result');

    const convertData = typeof convertResult === 'string' ? JSON.parse(convertResult) : convertResult;

    assert.ok(convertData.source, 'Should have source timezone data');
    assert.ok(convertData.target, 'Should have target timezone data');
    assert.ok(convertData.target.datetime, 'Should have target datetime');
    assert.ok(convertData.target.timezone.includes('New_York'), 'Should convert to New York timezone');
    assert.ok(convertData.time_difference, 'Should have time difference');
  });
});
