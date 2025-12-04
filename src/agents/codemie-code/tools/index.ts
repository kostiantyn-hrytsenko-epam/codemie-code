/**
 * System Tools Registry for CodeMie Native Agent
 *
 * Creates and manages system tools available to the LangGraph ReAct agent
 */

import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { CodeMieConfig } from '../types.js';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { filterDirectoryEntries, createFilterConfig, DEFAULT_FILTER_CONFIG, generateFilterStats } from '../filters.js';
import { logger } from '../../../utils/logger.js';

const execAsync = promisify(exec);

/**
 * Basic file read tool - reads file contents
 */
class ReadFileTool extends StructuredTool {
  name = 'read_file';
  description = 'Read the contents of a file from the filesystem';

  schema = z.object({
    filePath: z.string().describe('Path to the file to read'),
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({ filePath }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Resolve path relative to working directory
      const resolvedPath = path.resolve(this.workingDirectory, filePath);

      // Basic security check - ensure we're not escaping working directory
      if (!resolvedPath.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      // Emit progress: starting file read
      emitToolProgress(this.name, {
        percentage: 10,
        operation: `Reading ${path.basename(filePath)}...`,
        details: `Opening file: ${filePath}`
      });

      // Check file stats for progress estimation
      const stats = await fs.stat(resolvedPath);
      const fileSize = stats.size;

      // Emit progress: file opened
      emitToolProgress(this.name, {
        percentage: 30,
        operation: `Reading ${path.basename(filePath)}...`,
        details: `File size: ${this.formatFileSize(fileSize)}`
      });

      // For large files, simulate progress by reading in chunks
      if (fileSize > 50000) { // 50KB threshold for showing progress
        let content = '';
        const chunkSize = 8192; // 8KB chunks
        const totalChunks = Math.ceil(fileSize / chunkSize);

        const fileHandle = await fs.open(resolvedPath, 'r');
        const buffer = Buffer.alloc(chunkSize);

        try {
          for (let i = 0; i < totalChunks; i++) {
            const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, i * chunkSize);
            content += buffer.subarray(0, bytesRead).toString('utf-8');

            const progress = Math.min(30 + Math.round((i + 1) / totalChunks * 60), 90);
            emitToolProgress(this.name, {
              percentage: progress,
              operation: `Reading ${path.basename(filePath)}...`,
              details: `${Math.round((i + 1) / totalChunks * 100)}% complete`
            });

            // Small delay for large files to show progress
            if (i % 10 === 0) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }
        } finally {
          await fileHandle.close();
        }

        // Final progress
        emitToolProgress(this.name, {
            percentage: 100,
            operation: `Completed reading ${path.basename(filePath)}`,
            details: `Read ${this.formatFileSize(fileSize)}`
          });

        return `File: ${filePath}\n\n${this.addLineNumbers(content)}`;
      } else {
        // For small files, read normally but still show progress
        const content = await fs.readFile(resolvedPath, 'utf-8');

        emitToolProgress(this.name, {
            percentage: 100,
            operation: `Completed reading ${path.basename(filePath)}`,
            details: `Read ${this.formatFileSize(fileSize)}`
          });

        return `File: ${filePath}\n\n${this.addLineNumbers(content)}`;
      }
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Add line numbers to content for better LLM understanding
   */
  private addLineNumbers(content: string): string {
    const lines = content.split('\n');
    const maxLineNumber = lines.length;
    const padding = maxLineNumber.toString().length;

    return lines
      .map((line, index) => {
        const lineNumber = (index + 1).toString().padStart(padding, ' ');
        return `${lineNumber}: ${line}`;
      })
      .join('\n');
  }
}

/**
 * Basic file write tool - writes content to a file
 */
class WriteFileTool extends StructuredTool {
  name = 'write_file';
  description = 'Write content to a file in the filesystem';

  schema = z.object({
    filePath: z.string().describe('Path to the file to write'),
    content: z.string().describe('Content to write to the file'),
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({ filePath, content }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Resolve path relative to working directory
      const resolvedPath = path.resolve(this.workingDirectory, filePath);

      // Basic security check - ensure we're not escaping working directory
      if (!resolvedPath.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(resolvedPath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (error) {
      return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * Multi-replacement tool - perform multiple replacements in a single file
 * This is highly token-efficient as it allows multiple modifications in one tool call,
 * eliminating the need for multiple round-trips to the LLM.
 */
class ReplaceInFileTool extends StructuredTool {
  name = 'replace_in_file';
  description = 'Perform multiple replacements/insertions in a single file. PREFER line-based operations for precision. For single file include all operations in one tool call. Supports: 1) "lines" - replace content at specific line range, 2) "insert_before"/"insert_after" - insert text before/after specified line, 3) "string" - bulk replace identical text. For line operations, provide only the final content needed. For insertions, specify line number and text to insert.';

  schema = z.object({
    filePath: z.string().describe('Path to the file to modify'),
    replacements: z.array(z.object({
      type: z.enum(['lines', 'insert_before', 'insert_after', 'string', 'regex']).describe('Operation type: "lines" - replace line range, "insert_before" - insert text before line, "insert_after" - insert text after line, "string" - bulk replace text, "regex" - pattern replace.'),
      startLine: z.number().optional().describe('Starting line number (1-indexed, required for "lines" type). For line-based replacements, specify the first line to replace.'),
      endLine: z.number().optional().describe('Ending line number (1-indexed, required for "lines" type). Can be same as startLine to replace a single line. For line-based replacements, specify the last line to replace.'),
      lineNumber: z.number().optional().describe('Line number (1-indexed, required for "insert_before" and "insert_after" types). Line where insertion should occur.'),
      searchFor: z.string().optional().describe('Text or pattern to search for (required for "string" and "regex" types). NOT used for "lines" or insert types.'),
      replaceWith: z.string().optional().describe('For "lines" type: the COMPLETE FINAL CONTENT that should exist at the specified line range. For "string"/"regex": text to replace matches with. NOT used for insert types.'),
      insertText: z.string().optional().describe('Text to insert (required for "insert_before" and "insert_after" types). Content to be inserted at the specified line.')
    })).describe('Array of replacements to perform')
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({ filePath, replacements }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Resolve path relative to working directory
      const resolvedPath = path.resolve(this.workingDirectory, filePath);

      // Basic security check - ensure we're not escaping working directory
      if (!resolvedPath.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      // Validate replacements
      for (let i = 0; i < replacements.length; i++) {
        const replacement = replacements[i];
        if (replacement.type === 'lines') {
          if (replacement.startLine === undefined || replacement.endLine === undefined) {
            throw new Error(`Replacement ${i + 1}: startLine and endLine are required for "lines" type`);
          }
          if (replacement.startLine < 1 || replacement.endLine < replacement.startLine) {
            throw new Error(`Replacement ${i + 1}: invalid line range (startLine: ${replacement.startLine}, endLine: ${replacement.endLine})`);
          }
          if (!replacement.replaceWith) {
            throw new Error(`Replacement ${i + 1}: replaceWith is required for "lines" type`);
          }
        } else if (replacement.type === 'insert_before' || replacement.type === 'insert_after') {
          if (replacement.lineNumber === undefined) {
            throw new Error(`Replacement ${i + 1}: lineNumber is required for "${replacement.type}" type`);
          }
          if (replacement.lineNumber < 1) {
            throw new Error(`Replacement ${i + 1}: lineNumber must be positive (got: ${replacement.lineNumber})`);
          }
          if (!replacement.insertText) {
            throw new Error(`Replacement ${i + 1}: insertText is required for "${replacement.type}" type`);
          }
        } else if (replacement.type === 'string' || replacement.type === 'regex') {
          if (!replacement.searchFor) {
            throw new Error(`Replacement ${i + 1}: searchFor is required for "${replacement.type}" type`);
          }
          if (!replacement.replaceWith) {
            throw new Error(`Replacement ${i + 1}: replaceWith is required for "${replacement.type}" type`);
          }
        }
      }

      // Emit progress: starting replacements
      emitToolProgress(this.name, {
        percentage: 10,
        operation: `Processing ${replacements.length} replacement(s) in ${path.basename(filePath)}...`,
        details: `Reading file: ${filePath}`
      });

      // Read file content
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      let modifiedContent = content;
      let totalReplacements = 0;

      // Separate different operation types
      const lineReplacements = replacements
        .filter(r => r.type === 'lines')
        .map(r => ({
          startLine: r.startLine,
          endLine: r.endLine,
          replaceWith: r.replaceWith!
        }));
      const insertOperations = replacements
        .filter(r => r.type === 'insert_before' || r.type === 'insert_after')
        .map(r => ({
          type: r.type,
          lineNumber: r.lineNumber,
          insertText: r.insertText
        }));
      const stringRegexReplacements = replacements.filter(r => r.type === 'string' || r.type === 'regex');

      // Process line-based replacements and insertions using chunk-based approach
      if (lineReplacements.length > 0 || insertOperations.length > 0) {
        modifiedContent = this.applyChunkBasedOperations(lines, lineReplacements, insertOperations);
        totalReplacements += lineReplacements.length + insertOperations.length;
      }

      // Process string and regex replacements
      for (let i = 0; i < stringRegexReplacements.length; i++) {
        const replacement = stringRegexReplacements[i];

        const searchPattern = replacement.type === 'regex'
          ? new RegExp(replacement.searchFor!, 'g')
          : new RegExp(this.escapeRegex(replacement.searchFor!), 'g');

        const matches = (modifiedContent.match(searchPattern) || []).length;

        if (matches > 0) {
          modifiedContent = modifiedContent.replace(searchPattern, replacement.replaceWith!);
          totalReplacements += matches;
        }
      }

      // Emit progress: completed
      emitToolProgress(this.name, {
        percentage: 100,
        operation: `Replacements completed`,
        details: `Applied ${totalReplacements} change(s) across ${replacements.length} replacement(s)`
      });

      // Only write if there were changes
      if (modifiedContent !== content) {
        await fs.writeFile(resolvedPath, modifiedContent, 'utf-8');

        return `Successfully applied ${replacements.length} replacement operation(s) with ${totalReplacements} total changes in ${filePath}`;
      } else {
        return `No changes made to ${filePath} - all replacement patterns resulted in 0 matches`;
      }
    } catch (error) {
      return `Error performing replacements: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Apply line-based replacements and insertions using chunk-based approach to avoid line shifting issues
   */
  private applyChunkBasedOperations(
    lines: string[],
    lineReplacements: Array<{startLine?: number, endLine?: number, replaceWith: string}>,
    insertOperations: Array<{type: string, lineNumber?: number, insertText?: string}>
  ): string {
    // Validate and filter line replacements
    const validReplacements = lineReplacements
      .filter(r => r.startLine !== undefined && r.endLine !== undefined)
      .map(r => ({
        startLine: r.startLine!,
        endLine: r.endLine!,
        replaceWith: r.replaceWith
      }))
      .filter(r => r.startLine > 0 && r.endLine >= r.startLine && r.endLine <= lines.length);

    // Validate and filter insert operations
    const validInserts = insertOperations
      .filter(r => r.lineNumber !== undefined && r.insertText !== undefined)
      .map(r => ({
        type: r.type as 'insert_before' | 'insert_after',
        lineNumber: r.lineNumber!,
        insertText: r.insertText!
      }))
      .filter(r => r.lineNumber > 0 && r.lineNumber <= lines.length);

    if (validReplacements.length === 0 && validInserts.length === 0) {
      return lines.join('\n');
    }

    // Sort replacements by startLine to process in order
    validReplacements.sort((a, b) => a.startLine - b.startLine);

    // Check for overlapping replacements
    for (let i = 1; i < validReplacements.length; i++) {
      const prev = validReplacements[i - 1];
      const curr = validReplacements[i];
      if (curr.startLine <= prev.endLine) {
        throw new Error(`Overlapping line replacements: [${prev.startLine}-${prev.endLine}] and [${curr.startLine}-${curr.endLine}]`);
      }
    }

    // Create boundary points: start of file, start/end of each replacement, end of file
    const boundaries = new Set<number>();
    boundaries.add(1); // Start of file
    boundaries.add(lines.length + 1); // End of file (beyond last line)

    for (const replacement of validReplacements) {
      boundaries.add(replacement.startLine);
      boundaries.add(replacement.endLine + 1); // End boundary is after the last line to replace
    }

    // Add boundaries for insert operations
    for (const insert of validInserts) {
      if (insert.type === 'insert_before') {
        boundaries.add(insert.lineNumber); // Insert before this line
      } else { // insert_after
        boundaries.add(insert.lineNumber + 1); // Insert after this line
      }
    }

    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    // Create chunks between boundaries
    interface FileChunk {
      startLine: number;
      endLine: number;
      content: string;
      shouldReplace: boolean;
      replacementContent?: string;
      insertBefore?: string;
      insertAfter?: string;
    }

    const chunks: FileChunk[] = [];

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const startLine = sortedBoundaries[i];
      const endLine = sortedBoundaries[i + 1] - 1;

      // Skip empty ranges
      if (startLine > lines.length || endLine < startLine) {
        continue;
      }

      // Extract original content for this chunk
      const chunkLines = lines.slice(startLine - 1, Math.min(endLine, lines.length));
      const content = chunkLines.join('\n');

      // Check if this chunk should be replaced
      const replacement = validReplacements.find(r =>
        r.startLine === startLine && r.endLine === endLine
      );

      // Check for insert operations at this position
      const insertBefore = validInserts.find(r =>
        r.type === 'insert_before' && r.lineNumber === startLine
      );
      // For insert_after, we want to insert after the last line of this chunk
      const insertAfter = validInserts.find(r =>
        r.type === 'insert_after' && r.lineNumber === Math.min(endLine, lines.length)
      );

      chunks.push({
        startLine,
        endLine: Math.min(endLine, lines.length),
        content,
        shouldReplace: !!replacement,
        replacementContent: replacement?.replaceWith,
        insertBefore: insertBefore?.insertText,
        insertAfter: insertAfter?.insertText
      });
    }

    // Build final content by concatenating chunks
    const finalParts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Add insert_before content
      if (chunk.insertBefore) {
        finalParts.push(chunk.insertBefore);
      }

      if (chunk.shouldReplace) {
        // Use replacement content
        finalParts.push(chunk.replacementContent!);
      } else {
        // Use original content
        finalParts.push(chunk.content);
      }

      // Add insert_after content
      if (chunk.insertAfter) {
        finalParts.push(chunk.insertAfter);
      }

      // Add newline separator between chunks (except after the last chunk)
      if (i < chunks.length - 1 && chunk.content.length > 0) {
        // Only add newline if the current chunk has content and isn't the last
        const nextChunk = chunks[i + 1];
        if (nextChunk.content.length > 0 || nextChunk.shouldReplace) {
          finalParts.push('\n');
        }
      }
    }

    const finalResult = finalParts.join('');

    return finalResult;
  }

  /**
   * Escape special regex characters in the search string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Basic command execution tool - runs shell commands
 */
class ExecuteCommandTool extends StructuredTool {
  name = 'execute_command';
  description = 'Execute a shell command in the working directory';

  schema = z.object({
    command: z.string().describe('Shell command to execute'),
  });

  private workingDirectory: string;
  private timeout: number;

  constructor(workingDirectory: string, timeout: number = 300) {
    super();
    this.workingDirectory = workingDirectory;
    this.timeout = timeout * 1000; // Convert seconds to milliseconds
  }

  async _call({ command }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Basic security checks
      const dangerousCommands = ['rm -rf', 'sudo', 'chmod +x', 'curl', 'wget'];
      if (dangerousCommands.some(cmd => command.toLowerCase().includes(cmd))) {
        return `Error: Command rejected for security reasons: ${command}`;
      }

      // Emit progress: command starting
      emitToolProgress(this.name, {
          percentage: 10,
          operation: `Executing command...`,
          details: command.length > 50 ? `${command.substring(0, 47)}...` : command
        });

      // Start timer for progress estimation
      const startTime = Date.now();
      let progressInterval: NodeJS.Timeout | undefined;

      // For long-running commands, simulate progress
      const estimatedTime = this.estimateCommandTime(command);
      if (estimatedTime > 2000) { // Only show progress for commands estimated > 2s
        progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(10 + Math.round((elapsed / estimatedTime) * 80), 90);

          emitToolProgress(this.name, {
            percentage: progress,
            operation: `Executing command...`,
            details: `Running for ${Math.round(elapsed / 1000)}s`,
            estimatedTimeRemaining: Math.max(0, estimatedTime - elapsed)
          });
        }, 1000);
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: this.workingDirectory,
          timeout: this.timeout, // Use configured timeout (default: 5 minutes)
          maxBuffer: 1024 * 1024 // 1MB output limit
        });

        // Clear interval and emit completion
        if (progressInterval) {
          clearInterval(progressInterval);
        }

        const executionTime = Date.now() - startTime;
        emitToolProgress(this.name, {
            percentage: 100,
            operation: `Command completed`,
            details: `Finished in ${executionTime}ms`
          });

        let result = '';
        if (stdout) result += `STDOUT:\n${stdout}\n`;
        if (stderr) result += `STDERR:\n${stderr}\n`;

        return result || 'Command executed successfully (no output)';
      } catch (error) {
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        throw error;
      }
    } catch (error) {
      return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private estimateCommandTime(command: string): number {
    // Simple heuristics for command execution time estimation
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('npm install') || lowerCommand.includes('yarn install')) {
      return 15000; // 15s for package installs
    }
    if (lowerCommand.includes('npm run build') || lowerCommand.includes('yarn build')) {
      return 10000; // 10s for builds
    }
    if (lowerCommand.includes('git clone') || lowerCommand.includes('git pull')) {
      return 8000; // 8s for git operations
    }
    if (lowerCommand.includes('find') || lowerCommand.includes('grep -r')) {
      return 5000; // 5s for search operations
    }
    if (lowerCommand.includes('tar') || lowerCommand.includes('zip') || lowerCommand.includes('unzip')) {
      return 6000; // 6s for compression operations
    }

    return 2000; // Default 2s
  }
}

/**
 * Directory listing tool - lists files and directories with intelligent filtering
 */
class ListDirectoryTool extends StructuredTool {
  name = 'list_directory';
  description = 'List files and directories in a given path, automatically filtering out common ignore patterns (node_modules, .git, build artifacts, etc.)';

  schema = z.object({
    directoryPath: z.string().optional().describe('Directory path to list (defaults to working directory)'),
    showAll: z.boolean().optional().describe('Show all files including normally filtered ones (default: false)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories (default: false)'),
  });

  private workingDirectory: string;
  private filterConfig: any;

  constructor(workingDirectory: string, filterConfig?: any) {
    super();
    this.workingDirectory = workingDirectory;
    this.filterConfig = filterConfig || DEFAULT_FILTER_CONFIG;
  }

  async _call({ directoryPath, showAll = false, includeHidden = false }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const targetPath = directoryPath
        ? path.resolve(this.workingDirectory, directoryPath)
        : this.workingDirectory;

      // Security check
      if (!targetPath.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      const entries = await fs.readdir(targetPath, { withFileTypes: true });

      // Convert to our format for filtering
      let directoryEntries = entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory()
      }));

      // Filter hidden files if not requested
      if (!includeHidden) {
        directoryEntries = directoryEntries.filter(entry => !entry.name.startsWith('.'));
      }

      // Store original count for statistics
      const originalEntries = [...directoryEntries];

      // Apply filtering if not showAll
      let filteredEntries = directoryEntries;
      let filterStats;

      if (!showAll) {
        const filterConfig = createFilterConfig({
          ...this.filterConfig,
          enabled: true
        });

        filteredEntries = filterDirectoryEntries(directoryEntries, filterConfig, directoryPath || '');
        filterStats = generateFilterStats(originalEntries, filteredEntries, filterConfig);
      }

      // Separate into files and directories
      const files: string[] = [];
      const directories: string[] = [];

      for (const entry of filteredEntries) {
        if (entry.isDirectory) {
          directories.push(`${entry.name}/`);
        } else {
          files.push(entry.name);
        }
      }

      // Build result string
      let result = `Directory: ${directoryPath || '.'}\n\n`;

      if (directories.length > 0) {
        result += 'Directories:\n';
        result += directories.map(dir => `  ${dir}`).join('\n') + '\n\n';
      }

      if (files.length > 0) {
        result += 'Files:\n';
        result += files.map(file => `  ${file}`).join('\n');
      }

      if (directories.length === 0 && files.length === 0) {
        result += 'Directory is empty';
      }

      // Add filtering summary if filtering was applied
      if (!showAll && filterStats && filterStats.ignoredEntries > 0) {
        result += `\n\n--- Filtered out ${filterStats.ignoredEntries} items ---`;
        result += `\nShowing ${filterStats.filteredEntries} of ${filterStats.totalEntries} total items`;
        result += `\nUse showAll: true to see all items`;
      }

      return result;
    } catch (error) {
      return `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * Glob pattern matching tool - finds files matching a pattern
 */
class GlobTool extends StructuredTool {
  name = 'glob';
  description = 'Find files matching a glob pattern (e.g., "*.ts", "**/*.test.ts", "src/**/*.js"). Supports * (any chars) and ** (any directories).';

  schema = z.object({
    pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.test.ts", "src/**/*.js")'),
    directoryPath: z.string().optional().describe('Directory to search in (defaults to working directory)'),
    maxResults: z.number().optional().describe('Maximum number of results to return (default: 100)'),
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({ pattern, directoryPath, maxResults = 100 }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const searchDir = directoryPath
        ? path.resolve(this.workingDirectory, directoryPath)
        : this.workingDirectory;

      // Security check
      if (!searchDir.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      // Emit progress: starting search
      emitToolProgress(this.name, {
        percentage: 10,
        operation: `Searching for files...`,
        details: `Pattern: ${pattern}`
      });

      // Convert glob pattern to regex once
      const regex = this.globToRegex(pattern);
      const matches: string[] = [];
      await this.searchDirectory(searchDir, regex, matches, maxResults);

      // Emit progress: completed
      emitToolProgress(this.name, {
        percentage: 100,
        operation: `Search completed`,
        details: `Found ${matches.length} file(s)`
      });

      if (matches.length === 0) {
        return `No files found matching pattern "${pattern}"`;
      }

      if (matches.length > maxResults) {
        return `Found ${matches.length} files (showing first ${maxResults}):\n${matches.slice(0, maxResults).map(m => `  ${m}`).join('\n')}\n\n... and ${matches.length - maxResults} more (use maxResults to see more)`;
      }

      return `Found ${matches.length} file(s) matching "${pattern}":\n${matches.map(m => `  ${m}`).join('\n')}`;
    } catch (error) {
      return `Error searching files: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async searchDirectory(
    dir: string,
    regex: RegExp,
    matches: string[],
    maxResults: number
  ): Promise<void> {
    if (matches.length >= maxResults) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const relativeDir = path.relative(this.workingDirectory, dir);

      for (const entry of entries) {
        if (matches.length >= maxResults) {
          break;
        }

        const fullPath = path.join(dir, entry.name);
        const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

        // Skip common ignore patterns
        if (this.shouldIgnore(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          await this.searchDirectory(fullPath, regex, matches, maxResults);
        } else if (entry.isFile()) {
          // Check if file matches pattern
          if (regex.test(relativePath) || regex.test(entry.name)) {
            matches.push(relativePath);
          }
        }
      }
    } catch {
      // Skip directories we can't access (permissions, etc.)
      // Silently continue - this is expected for some directories
    }
  }

  private globToRegex(globPattern: string): RegExp {
    // Convert glob pattern to regex
    // * matches any characters except /
    // ** matches any characters including /
    // Escape special regex characters
    let regexStr = globPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLE_STAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE_STAR___/g, '.*');

    // If pattern doesn't start with /, allow matching at any depth
    if (!globPattern.startsWith('/')) {
      regexStr = `.*${regexStr}`;
    }

    return new RegExp(`^${regexStr}$`);
  }

  private shouldIgnore(name: string): boolean {
    // Skip common ignore patterns
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.next',
      '.cache',
      'dist',
      'build',
      '.DS_Store',
      'coverage',
      '.turbo',
    ];
    return ignorePatterns.includes(name);
  }
}

/**
 * Grep tool - searches for text patterns within files
 */
class GrepTool extends StructuredTool {
  name = 'grep';
  description = 'Search for text patterns within files. Can search in specific files or recursively in directories. Returns matching lines with file paths and line numbers.';

  schema = z.object({
    pattern: z.string().describe('Text pattern to search for (plain text, not regex)'),
    filePath: z.string().optional().describe('Specific file to search in (if not provided, searches recursively from working directory)'),
    directoryPath: z.string().optional().describe('Directory to search in (defaults to working directory, ignored if filePath is provided)'),
    filePattern: z.string().optional().describe('Optional glob pattern to filter files (e.g., "*.ts", "*.js")'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default: false)'),
    maxResults: z.number().optional().describe('Maximum number of matches to return (default: 100)'),
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({
    pattern,
    filePath,
    directoryPath,
    caseSensitive = false,
    filePattern,
    maxResults = 100,
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Emit progress: starting search
      emitToolProgress(this.name, {
        percentage: 10,
        operation: `Searching for "${pattern}"...`,
        details: filePath ? `In file: ${filePath}` : 'Recursively in directory'
      });

      const matches: Array<{ file: string; line: number; content: string }> = [];

      if (filePath) {
        // Search in specific file
        const resolvedPath = path.resolve(this.workingDirectory, filePath);
        if (!resolvedPath.startsWith(this.workingDirectory)) {
          throw new Error('Access denied: Path is outside working directory');
        }
        await this.searchFile(resolvedPath, pattern, caseSensitive, matches, maxResults);
      } else {
        // Search recursively in directory
        const searchDir = directoryPath
          ? path.resolve(this.workingDirectory, directoryPath)
          : this.workingDirectory;

        if (!searchDir.startsWith(this.workingDirectory)) {
          throw new Error('Access denied: Path is outside working directory');
        }

        await this.searchDirectory(searchDir, pattern, caseSensitive, filePattern, matches, maxResults);
      }

      // Emit progress: completed
      emitToolProgress(this.name, {
        percentage: 100,
        operation: `Search completed`,
        details: `Found ${matches.length} match(es)`
      });

      if (matches.length === 0) {
        return `No matches found for "${pattern}"`;
      }

      if (matches.length > maxResults) {
        const result = matches.slice(0, maxResults).map(m => 
          `${m.file}:${m.line}: ${m.content}`
        ).join('\n');
        return `${result}\n\n... and ${matches.length - maxResults} more matches (use maxResults to see more)`;
      }

      return matches.map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
    } catch (error) {
      return `Error searching: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async searchFile(
    filePath: string,
    pattern: string,
    caseSensitive: boolean,
    matches: Array<{ file: string; line: number; content: string }>,
    maxResults: number
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
      const relativePath = path.relative(this.workingDirectory, filePath);

      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        const line = lines[i];
        const searchLine = caseSensitive ? line : line.toLowerCase();

        if (searchLine.includes(searchPattern)) {
          matches.push({
            file: relativePath,
            line: i + 1,
            content: line.trim(),
          });
        }
      }
    } catch {
      // Skip files we can't read (permissions, binary files, etc.)
      // Silently continue - this is expected for some files
    }
  }

  private async searchDirectory(
    dir: string,
    pattern: string,
    caseSensitive: boolean,
    filePattern: string | undefined,
    matches: Array<{ file: string; line: number; content: string }>,
    maxResults: number
  ): Promise<void> {
    if (matches.length >= maxResults) {
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      let fileRegex: RegExp | null = null;
      if (filePattern) {
        fileRegex = this.globToRegex(filePattern);
      }

      for (const entry of entries) {
        if (matches.length >= maxResults) {
          break;
        }

        const fullPath = path.join(dir, entry.name);

        // Skip common ignore patterns
        if (this.shouldIgnore(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          await this.searchDirectory(fullPath, pattern, caseSensitive, filePattern, matches, maxResults);
        } else if (entry.isFile()) {
          // Check file pattern if specified
          if (fileRegex && !fileRegex.test(entry.name)) {
            continue;
          }

          // Search in file
          await this.searchFile(fullPath, pattern, caseSensitive, matches, maxResults);
        }
      }
    } catch {
      // Skip directories we can't access (permissions, etc.)
      // Silently continue - this is expected for some directories
    }
  }

  private globToRegex(globPattern: string): RegExp {
    let regexStr = globPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLE_STAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLE_STAR___/g, '.*');
    return new RegExp(`^${regexStr}$`);
  }

  private shouldIgnore(name: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.next',
      '.cache',
      'dist',
      'build',
      '.DS_Store',
      'coverage',
      '.turbo',
    ];
    return ignorePatterns.includes(name);
  }
}

/**
 * Tool event callback type for progress reporting
 */
export type ToolEventCallback = (event: {
  type: 'tool_call_progress';
  toolName: string;
  progress: {
    percentage: number;
    operation: string;
    details?: string;
    estimatedTimeRemaining?: number;
  };
}) => void;

/**
 * Global tool event emitter - set during chatStream
 */
let globalToolEventCallback: ToolEventCallback | null = null;

/**
 * Set the global tool event callback for the current execution
 */
export function setGlobalToolEventCallback(callback: ToolEventCallback | null): void {
  globalToolEventCallback = callback;
}

/**
 * Emit a tool progress event using the global callback
 */
export function emitToolProgress(toolName: string, progress: {
  percentage: number;
  operation: string;
  details?: string;
  estimatedTimeRemaining?: number;
}): void {
  if (globalToolEventCallback) {
    globalToolEventCallback({
      type: 'tool_call_progress',
      toolName,
      progress
    });
  }
}

/**
 * Create system tools available to the CodeMie agent
 */
export async function createSystemTools(config: CodeMieConfig): Promise<StructuredTool[]> {
  const tools: StructuredTool[] = [];

  try {
    // Basic file system tools
    tools.push(new ReadFileTool(config.workingDirectory));
    tools.push(new WriteFileTool(config.workingDirectory));
    tools.push(new ListDirectoryTool(config.workingDirectory, config.directoryFilters));

    // Conditionally add new tools based on environment variable
    // Set CODEMIE_DISABLE_NEW_TOOLS=true to test with old tools only
    const disableNewTools = process.env.CODEMIE_DISABLE_NEW_TOOLS === 'true';

    if (!disableNewTools) {
      // New token-efficient tools (added in commit 6accd3d)
      tools.push(new ReplaceInFileTool(config.workingDirectory));
      tools.push(new GlobTool(config.workingDirectory));
      tools.push(new GrepTool(config.workingDirectory));

      if (config.debug) {
        logger.debug('New tools enabled: replace_in_file, glob, grep');
      }
    } else {
      if (config.debug) {
        logger.debug('New tools disabled via CODEMIE_DISABLE_NEW_TOOLS environment variable');
      }
    }

    // Command execution tool
    tools.push(new ExecuteCommandTool(config.workingDirectory, config.timeout));

    // Planning and todo tools
    try {
      const { planningTools, initializeTodoStorage } = await import('./planning.js');

      // Initialize todo storage for this working directory
      initializeTodoStorage(config.workingDirectory, config.debug);

      tools.push(...planningTools);

      if (config.debug) {
        logger.debug(`Added ${planningTools.length} planning tools`);
        logger.debug(`Initialized todo storage for: ${config.workingDirectory}`);
      }
    } catch (error) {
      if (config.debug) {
        logger.debug('Planning tools not available:', error);
      }
    }

    if (config.debug) {
      logger.debug(`Created ${tools.length} total system tools`);
    }

    return tools;
  } catch (error) {
    if (config.debug) {
      logger.debug('Error creating system tools:', error);
    }

    // Return empty array on error to allow agent to function
    return [];
  }
}

/**
 * Get available tool names and descriptions
 * Respects CODEMIE_DISABLE_NEW_TOOLS environment variable
 */
export function getToolSummary(): Array<{ name: string; description: string }> {
  const disableNewTools = process.env.CODEMIE_DISABLE_NEW_TOOLS === 'true';

  const baseTools = [
    { name: 'read_file', description: 'Read the contents of a file from the filesystem' },
    { name: 'write_file', description: 'Write content to a file in the filesystem' },
    { name: 'list_directory', description: 'List files and directories in a given path, automatically filtering out common ignore patterns (node_modules, .git, build artifacts, etc.)' },
    { name: 'execute_command', description: 'Execute a shell command in the working directory' },
    { name: 'write_todos', description: 'Create or update a structured todo list for planning and progress tracking' },
    { name: 'update_todo_status', description: 'Update the status of a specific todo by index' },
    { name: 'append_todo', description: 'Add a new todo item to the existing list' },
    { name: 'clear_todos', description: 'Clear all todos from the list' },
    { name: 'show_todos', description: 'Display the current todo list with progress information' }
  ];

  const newTools = [
    { name: 'replace_in_file', description: 'Perform multiple replacements/insertions in a single file. Supports: line replacements, insert_before/insert_after operations, string/regex replacements. PREFER line-based operations for precision. Much more token-efficient than multiple calls.' },
    { name: 'glob', description: 'Find files matching a glob pattern (e.g., "*.ts", "**/*.test.ts", "src/**/*.js"). Supports * (any chars) and ** (any directories).' },
    { name: 'grep', description: 'Search for text patterns within files. Can search in specific files or recursively in directories. Returns matching lines with file paths and line numbers.' }
  ];

  return disableNewTools ? baseTools : [...baseTools, ...newTools];
}
