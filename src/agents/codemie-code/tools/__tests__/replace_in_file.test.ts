/**
 * Replace In File Tool Tests
 *
 * Tests for the replace_in_file tool including insert operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createSystemTools } from '../index.js';

// Mock the logger to avoid console output during tests
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('Replace In File Tool', () => {
  let tempDir: string;
  let replaceInFileTool: any;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replace-in-file-test-'));

    // Create the tool using the actual implementation
    const tools = await createSystemTools({
      workingDirectory: tempDir,
      debug: false,
      timeout: 30,
      directoryFilters: {}
    });

    // Find the replace_in_file tool
    replaceInFileTool = tools.find(tool => tool.name === 'replace_in_file');
    expect(replaceInFileTool).toBeDefined();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Line replacements', () => {
    it('should replace a single line', async () => {
      const testFile = 'test.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2\nline 3\nline 4';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'lines',
          startLine: 2,
          endLine: 2,
          replaceWith: 'NEW LINE 2'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toBe('line 1\nNEW LINE 2\nline 3\nline 4');
    });
  });

  describe('Insert before operations', () => {
    it('should insert text before a specified line', async () => {
      const testFile = 'insert_before.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2\nline 3';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_before',
          lineNumber: 2,
          insertText: 'INSERTED BEFORE LINE 2'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toContain('INSERTED BEFORE LINE 2');
      expect(newContent).toContain('line 1');
      expect(newContent).toContain('line 2');
      expect(newContent).toContain('line 3');
    });

    it('should insert at beginning of file', async () => {
      const testFile = 'insert_beginning.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_before',
          lineNumber: 1,
          insertText: 'NEW FIRST LINE'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toContain('NEW FIRST LINE');
      expect(newContent).toContain('line 1');
      expect(newContent).toContain('line 2');
    });
  });

  describe('Insert after operations', () => {
    it('should insert text after a specified line', async () => {
      const testFile = 'insert_after.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2\nline 3';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_after',
          lineNumber: 2,
          insertText: 'INSERTED AFTER LINE 2'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toContain('INSERTED AFTER LINE 2');
      expect(newContent).toContain('line 1');
      expect(newContent).toContain('line 2');
      expect(newContent).toContain('line 3');
    });

    it('should insert at end of file', async () => {
      const testFile = 'insert_end.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_after',
          lineNumber: 2,
          insertText: 'NEW LAST LINE'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toContain('NEW LAST LINE');
      expect(newContent).toContain('line 1');
      expect(newContent).toContain('line 2');
    });
  });

  describe('Combined operations', () => {
    it('should handle line replacement with insert operations', async () => {
      const testFile = 'combined.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'line 1\nline 2\nline 3\nline 4';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [
          {
            type: 'insert_before',
            lineNumber: 1,
            insertText: 'HEADER'
          },
          {
            type: 'lines',
            startLine: 2,
            endLine: 3,
            replaceWith: 'REPLACED LINES 2-3'
          },
          {
            type: 'insert_after',
            lineNumber: 4,
            insertText: 'FOOTER'
          }
        ]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toContain('HEADER');
      expect(newContent).toContain('REPLACED LINES 2-3');
      expect(newContent).toContain('FOOTER');
    });
  });

  describe('String replacements', () => {
    it('should replace all occurrences of a string', async () => {
      const testFile = 'string_replace.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'hello world\nhello there\ngoodbye world';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'string',
          searchFor: 'hello',
          replaceWith: 'hi'
        }]
      });

      expect(result).toContain('Successfully applied');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toBe('hi world\nhi there\ngoodbye world');
    });
  });

  describe('Error handling', () => {
    it('should validate insert_before parameters', async () => {
      const testFile = 'validation.txt';
      const testPath = path.join(tempDir, testFile);
      await fs.writeFile(testPath, 'line 1\nline 2');

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_before',
          // Missing lineNumber and insertText
        } as any]
      });

      expect(result).toContain('Error performing replacements');
      expect(result).toContain('lineNumber is required');
    });

    it('should validate insert_after parameters', async () => {
      const testFile = 'validation2.txt';
      const testPath = path.join(tempDir, testFile);
      await fs.writeFile(testPath, 'line 1\nline 2');

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'insert_after',
          lineNumber: 2,
          // Missing insertText
        } as any]
      });

      expect(result).toContain('Error performing replacements');
      expect(result).toContain('insertText is required');
    });

    it('should prevent path traversal attacks', async () => {
      const result = await replaceInFileTool._call({
        filePath: '../../../etc/passwd',
        replacements: [{
          type: 'lines',
          startLine: 1,
          endLine: 1,
          replaceWith: 'hacked'
        }]
      });

      expect(result).toContain('Error performing replacements');
      expect(result).toContain('Access denied: Path is outside working directory');
    });
  });

  describe('No-op scenarios', () => {
    it('should return no changes when string replacement finds no matches', async () => {
      const testFile = 'no_match.txt';
      const testPath = path.join(tempDir, testFile);
      const originalContent = 'hello world';
      await fs.writeFile(testPath, originalContent);

      const result = await replaceInFileTool._call({
        filePath: testFile,
        replacements: [{
          type: 'string',
          searchFor: 'nonexistent',
          replaceWith: 'replacement'
        }]
      });

      expect(result).toContain('No changes made');

      const newContent = await fs.readFile(testPath, 'utf-8');
      expect(newContent).toBe(originalContent);
    });
  });
});