/**
 * Agent Tools Integration Tests
 *
 * Tests that the CodeMie Native agent tools (glob, grep, replace_string)
 * are properly registered and available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getToolSummary, createSystemTools } from '../../src/agents/codemie-code/tools/index.js';
import type { CodeMieConfig } from '../../src/agents/codemie-code/types.js';
import { createTempWorkspace } from '../helpers/temp-workspace.js';
import path from 'path';

describe('Agent Tools - Integration', () => {
  let tempWorkspace: ReturnType<typeof createTempWorkspace>;
  let workspacePath: string;

  beforeAll(async () => {
    tempWorkspace = createTempWorkspace();
    workspacePath = tempWorkspace.path;

    // Create test files for tool testing
    const fs = await import('fs/promises');
    await fs.writeFile(
      path.join(workspacePath, 'test-file.ts'),
      'export function testFunction() {\n  return "test";\n}\n'
    );
    await fs.writeFile(
      path.join(workspacePath, 'another-file.ts'),
      'export function anotherFunction() {\n  return "another";\n}\n'
    );
    await fs.writeFile(
      path.join(workspacePath, 'README.md'),
      '# Test Project\n\nThis is a test project.\n'
    );
    await fs.mkdir(path.join(workspacePath, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, 'src', 'index.ts'),
      'console.log("Hello World");\n'
    );
  });

  afterAll(async () => {
    await tempWorkspace.cleanup();
  });

  describe('Tool Availability', () => {
    it('should have glob tool available', () => {
      const toolNames = getToolSummary().map(t => t.name);
      expect(toolNames).toContain('glob');
    });

    it('should have grep tool available', () => {
      const toolNames = getToolSummary().map(t => t.name);
      expect(toolNames).toContain('grep');
    });

    it('should have replace_string tool available', () => {
      const toolNames = getToolSummary().map(t => t.name);
      expect(toolNames).toContain('replace_string');
    });
  });

  describe('Tool Integration with Agent', () => {
    it('should be able to create tools with working directory', async () => {
      const config: CodeMieConfig = {
        workingDirectory: workspacePath,
        baseUrl: 'http://test',
        authToken: 'test',
        model: 'test',
        provider: 'openai',
        timeout: 30,
        debug: false
      };

      const tools = await createSystemTools(config);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should include new tools in tool list', async () => {
      const config: CodeMieConfig = {
        workingDirectory: workspacePath,
        baseUrl: 'http://test',
        authToken: 'test',
        model: 'test',
        provider: 'openai',
        timeout: 30,
        debug: false
      };

      const tools = await createSystemTools(config);
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('glob');
      expect(toolNames).toContain('grep');
      expect(toolNames).toContain('replace_string');
    });
  });
});
