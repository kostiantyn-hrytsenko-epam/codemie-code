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

        return `File: ${filePath}\n\n${content}`;
      } else {
        // For small files, read normally but still show progress
        const content = await fs.readFile(resolvedPath, 'utf-8');

        emitToolProgress(this.name, {
            percentage: 100,
            operation: `Completed reading ${path.basename(filePath)}`,
            details: `Read ${this.formatFileSize(fileSize)}`
          });

        return `File: ${filePath}\n\n${content}`;
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
 * String replacement tool - replaces occurrences of a string in a file
 * This tool is token-efficient as it only requires the search and replace strings,
 * not the entire file content like write_file would require.
 */
class ReplaceStringTool extends StructuredTool {
  name = 'replace_string';
  description = 'Replace all occurrences of a string in a file. This is more token-efficient than write_file when making small changes.';

  schema = z.object({
    filePath: z.string().describe('Path to the file to modify'),
    searchFor: z.string().describe('The string to search for and replace'),
    replaceWith: z.string().describe('The string to replace it with'),
  });

  private workingDirectory: string;

  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
  }

  async _call({ filePath, searchFor, replaceWith }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Resolve path relative to working directory
      const resolvedPath = path.resolve(this.workingDirectory, filePath);

      // Basic security check - ensure we're not escaping working directory
      if (!resolvedPath.startsWith(this.workingDirectory)) {
        throw new Error('Access denied: Path is outside working directory');
      }

      // Emit progress: starting replacement
      emitToolProgress(this.name, {
        percentage: 10,
        operation: `Replacing string in ${path.basename(filePath)}...`,
        details: `Reading file: ${filePath}`
      });

      // Read file content
      const content = await fs.readFile(resolvedPath, 'utf-8');

      // Count occurrences before replacement
      const occurrences = (content.match(new RegExp(this.escapeRegex(searchFor), 'g')) || []).length;

      if (occurrences === 0) {
        emitToolProgress(this.name, {
          percentage: 100,
          operation: `No matches found`,
          details: `String "${searchFor.substring(0, 50)}${searchFor.length > 50 ? '...' : ''}" not found in file`
        });
        return `No occurrences found: The string "${searchFor}" was not found in ${filePath}`;
      }

      // Emit progress: replacing
      emitToolProgress(this.name, {
        percentage: 50,
        operation: `Replacing ${occurrences} occurrence(s)...`,
        details: `Found ${occurrences} match(es)`
      });

      // Perform replacement
      const newContent = content.replace(new RegExp(this.escapeRegex(searchFor), 'g'), replaceWith);

      // Write back to file
      await fs.writeFile(resolvedPath, newContent, 'utf-8');

      // Emit progress: completed
      emitToolProgress(this.name, {
        percentage: 100,
        operation: `Replacement completed`,
        details: `Replaced ${occurrences} occurrence(s)`
      });

      return `Successfully replaced ${occurrences} occurrence(s) of "${searchFor.substring(0, 50)}${searchFor.length > 50 ? '...' : ''}" in ${filePath}`;
    } catch (error) {
      return `Error replacing string: ${error instanceof Error ? error.message : String(error)}`;
    }
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
    tools.push(new ReplaceStringTool(config.workingDirectory));
    tools.push(new ListDirectoryTool(config.workingDirectory, config.directoryFilters));
    tools.push(new GlobTool(config.workingDirectory));
    tools.push(new GrepTool(config.workingDirectory));

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
 */
export function getToolSummary(): Array<{ name: string; description: string }> {
  return [
    { name: 'read_file', description: 'Read the contents of a file from the filesystem' },
    { name: 'write_file', description: 'Write content to a file in the filesystem' },
    { name: 'replace_string', description: 'Replace all occurrences of a string in a file. This is more token-efficient than write_file when making small changes.' },
    { name: 'list_directory', description: 'List files and directories in a given path, automatically filtering out common ignore patterns (node_modules, .git, build artifacts, etc.)' },
    { name: 'glob', description: 'Find files matching a glob pattern (e.g., "*.ts", "**/*.test.ts", "src/**/*.js"). Supports * (any chars) and ** (any directories).' },
    { name: 'grep', description: 'Search for text patterns within files. Can search in specific files or recursively in directories. Returns matching lines with file paths and line numbers.' },
    { name: 'execute_command', description: 'Execute a shell command in the working directory' },
    { name: 'write_todos', description: 'Create or update a structured todo list for planning and progress tracking' },
    { name: 'update_todo_status', description: 'Update the status of a specific todo by index' },
    { name: 'append_todo', description: 'Add a new todo item to the existing list' },
    { name: 'clear_todos', description: 'Clear all todos from the list' },
    { name: 'show_todos', description: 'Display the current todo list with progress information' }
  ];
}