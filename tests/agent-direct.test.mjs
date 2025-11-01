/**
 * Integration Test: Direct agent tool calling
 * Uses Node.js native test runner
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { CodeMieAgent } from '../dist/code/agent.js';
import { loadConfig } from '../dist/code/config.js';
import { FilesystemTools } from '../dist/code/tools/filesystem.js';
import { skipIfNoBaseUrl } from './test-helpers.mjs';

describe('Direct Agent Tool Calling', () => {
  let agent;
  let config;

  before(() => {
    if (skipIfNoBaseUrl()) return;

    config = loadConfig(process.cwd());
    const filesystemTools = new FilesystemTools({
      allowedDirectories: [process.cwd()]
    });
    const tools = filesystemTools.getTools();
    agent = new CodeMieAgent(config, tools);
  });

  it('should load configuration correctly', () => {
    if (skipIfNoBaseUrl()) return;

    assert.ok(config, 'Config should be loaded');
    assert.ok(config.model, 'Config should have a model');
    assert.ok(config.provider, 'Config should have a provider');
  });

  it('should list files in current directory', async () => {
    if (skipIfNoBaseUrl()) return;

    const response = await agent.chat('list all files in the current directory');

    assert.ok(response, 'Response should be defined');
    assert.ok(typeof response === 'string', 'Response should be a string');
    assert.ok(response.length > 0, 'Response should not be empty');
  });
});
