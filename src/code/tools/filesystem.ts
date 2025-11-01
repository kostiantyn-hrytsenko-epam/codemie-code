import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createUnifiedDiff } from './diff-utils.js';
import { PathSecurityError, getErrorMessage } from '../../utils/errors.js';

export interface FilesystemConfig {
  allowedDirectories: string[];
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules', '.git', '__pycache__', '.pytest_cache',
  '.venv', 'venv', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.DS_Store'
];

export class FilesystemTools {
  constructor(private config: FilesystemConfig) {
    if (!config.ignorePatterns) {
      config.ignorePatterns = DEFAULT_IGNORE_PATTERNS;
    }
  }

  getTools(): StructuredTool[] {
    return [
      new ReadFileTool(this.config),
      new ReadMultipleFilesTool(this.config),
      new WriteFileTool(this.config),
      new EditFileTool(this.config),
      new CreateDirectoryTool(this.config),
      new ListDirectoryTool(this.config),
      new ProjectTreeTool(this.config),
      new MoveFileTool(this.config),
      new SearchFilesTool(this.config),
      new ListAllowedDirectoriesTool(this.config)
    ];
  }
}

// Base class with security validation
abstract class BaseFilesystemTool extends StructuredTool {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodObject<z.ZodRawShape>;

  constructor(protected config: FilesystemConfig) {
    super();
  }

  protected async validatePath(requestedPath: string): Promise<string> {
    // Expand home directory
    const expanded = requestedPath.startsWith('~/')
      ? path.join(process.env.HOME || '', requestedPath.slice(2))
      : requestedPath;

    // Get absolute path
    const absolute = path.resolve(expanded);
    const normalized = path.normalize(absolute);

    // Check if path is within allowed directories
    const isAllowed = this.config.allowedDirectories.some(dir =>
      normalized.startsWith(path.normalize(dir))
    );

    if (!isAllowed) {
      throw new PathSecurityError(absolute, 'path outside allowed directories');
    }

    // Resolve symlinks and validate again
    try {
      const realPath = await fs.realpath(absolute);
      const isRealAllowed = this.config.allowedDirectories.some(dir =>
        realPath.startsWith(path.normalize(dir))
      );

      if (!isRealAllowed) {
        throw new PathSecurityError(realPath, 'symlink target outside allowed directories');
      }

      return realPath;
    } catch {
      // File doesn't exist yet, validate parent
      const parent = path.dirname(absolute);
      try {
        const realParent = await fs.realpath(parent);
        const isParentAllowed = this.config.allowedDirectories.some(dir =>
          realParent.startsWith(path.normalize(dir))
        );

        if (!isParentAllowed) {
          throw new PathSecurityError(parent, 'parent directory outside allowed directories');
        }

        return absolute;
      } catch {
        throw new PathSecurityError(parent, 'parent directory does not exist');
      }
    }
  }

  protected shouldIgnore(filePath: string): boolean {
    return this.config.ignorePatterns!.some(pattern =>
      filePath.includes(pattern)
    );
  }
}

// 1. Read File Tool
class ReadFileTool extends BaseFilesystemTool {
  name = 'read_file';
  description = 'Read contents of a file';
  schema = z.object({
    path: z.string().describe('File path to read')
  });

  async _call({ path: filePath }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(filePath);
      const content = await fs.readFile(validated, 'utf-8');
      return content;
    } catch (error: unknown) {
      return `Error reading file: ${getErrorMessage(error)}`;
    }
  }
}

// 2. Read Multiple Files Tool
class ReadMultipleFilesTool extends BaseFilesystemTool {
  name = 'read_multiple_files';
  description = 'Read contents of multiple files at once';
  schema = z.object({
    paths: z.array(z.string()).describe('Array of file paths to read')
  });

  async _call({ paths }: z.infer<typeof this.schema>): Promise<string> {
    const results: string[] = [];
    for (const filePath of paths) {
      try {
        const validated = await this.validatePath(filePath);
        const content = await fs.readFile(validated, 'utf-8');
        results.push(`${filePath}:\n${content}\n`);
      } catch (error: unknown) {
        results.push(`${filePath}: Error - ${getErrorMessage(error)}`);
      }
    }
    return results.join('\n---\n');
  }
}

// 3. Write File Tool
class WriteFileTool extends BaseFilesystemTool {
  name = 'write_file';
  description = 'Write content to a file, creating parent directories if needed';
  schema = z.object({
    path: z.string().describe('File path to write'),
    content: z.string().describe('Content to write to file')
  });

  async _call({ path: filePath, content }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(filePath);
      await fs.mkdir(path.dirname(validated), { recursive: true });
      await fs.writeFile(validated, content, 'utf-8');
      return `Successfully wrote to ${filePath}`;
    } catch (error: unknown) {
      return `Error writing file: ${getErrorMessage(error)}`;
    }
  }
}

// 4. Edit File Tool (with indentation preservation and diff generation)
class EditFileTool extends BaseFilesystemTool {
  name = 'edit_file';
  description = `Edit a file by replacing specific text blocks. Provides a diff of changes.

  Each edit should specify:
  - old_text: Exact text to find (must match exactly including whitespace)
  - new_text: Replacement text

  The tool preserves indentation and shows a unified diff of changes.`;

  schema = z.object({
    path: z.string().describe('File path to edit'),
    edits: z.array(
      z.object({
        old_text: z.string().describe('Exact text to find'),
        new_text: z.string().describe('Replacement text')
      })
    ).describe('Array of edit operations'),
    dry_run: z.boolean().nullable().optional().describe('If true, show diff without writing')
  });

  async _call({
    path: filePath,
    edits,
    dry_run = false
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(filePath);
      const originalContent = await fs.readFile(validated, 'utf-8');
      let modifiedContent = originalContent;

      // Apply each edit
      for (const edit of edits) {
        const oldText = this.normalizeLineEndings(edit.old_text);
        const newText = this.normalizeLineEndings(edit.new_text);

        // Try direct replacement first
        if (modifiedContent.includes(oldText)) {
          modifiedContent = modifiedContent.replace(oldText, newText);
          continue;
        }

        // Try line-by-line with indentation preservation
        const result = this.applyEditWithIndentation(modifiedContent, oldText, newText);
        if (result) {
          modifiedContent = result;
        } else {
          throw new Error(`Could not find exact match for:\n${edit.old_text}`);
        }
      }

      // Create diff
      const diff = createUnifiedDiff(originalContent, modifiedContent, filePath);

      // Write if not dry run
      if (!dry_run) {
        await fs.writeFile(validated, modifiedContent, 'utf-8');
      }

      return diff;
    } catch (error: unknown) {
      return `Error editing file: ${getErrorMessage(error)}`;
    }
  }

  private normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
  }

  private applyEditWithIndentation(
    content: string,
    oldText: string,
    newText: string
  ): string | null {
    const contentLines = content.split('\n');
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Find matching position
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const matches = oldLines.every((oldLine, j) =>
        contentLines[i + j].trim() === oldLine.trim()
      );

      if (matches) {
        // Preserve original indentation
        const indent = contentLines[i].match(/^\s*/)?.[0] || '';
        const indentedNewLines = newLines.map((line, j) => {
          if (j === 0) return indent + line.trimStart();
          return line;
        });

        contentLines.splice(i, oldLines.length, ...indentedNewLines);
        return contentLines.join('\n');
      }
    }

    return null;
  }
}

// 5. Create Directory Tool
class CreateDirectoryTool extends BaseFilesystemTool {
  name = 'create_directory';
  description = 'Create a directory (and parent directories if needed)';
  schema = z.object({
    path: z.string().describe('Directory path to create')
  });

  async _call({ path: dirPath }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(dirPath);
      await fs.mkdir(validated, { recursive: true });
      return `Successfully created directory ${dirPath}`;
    } catch (error: unknown) {
      return `Error creating directory: ${getErrorMessage(error)}`;
    }
  }
}

// 6. List Directory Tool
class ListDirectoryTool extends BaseFilesystemTool {
  name = 'list_directory';
  description = 'List files and directories in a path';
  schema = z.object({
    path: z.string().describe('Directory path to list')
  });

  async _call({ path: dirPath }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(dirPath);
      const entries = await fs.readdir(validated, { withFileTypes: true });

      const formatted = entries.map(entry => {
        const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
        return `${type} ${entry.name}`;
      });

      return formatted.length > 0 ? formatted.join('\n') : 'Empty directory';
    } catch (error: unknown) {
      return `Error listing directory: ${getErrorMessage(error)}`;
    }
  }
}

// 7. Project Tree Tool
class ProjectTreeTool extends BaseFilesystemTool {
  name = 'project_tree';
  description = 'Get complete project file tree as JSON array, excluding ignored patterns';
  schema = z.object({
    directory: z.string().nullable().optional().describe('Directory to scan (default: first allowed directory)')
  });

  async _call({ directory }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const targetDir = directory || this.config.allowedDirectories[0];
      const validated = await this.validatePath(targetDir);

      const files = await this.collectFiles(validated, validated);
      return JSON.stringify(files, null, 2);
    } catch (error: unknown) {
      return `Error generating project tree: ${getErrorMessage(error)}`;
    }
  }

  private async collectFiles(rootDir: string, currentDir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(rootDir, fullPath);

        // Skip ignored patterns
        if (this.shouldIgnore(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          const subFiles = await this.collectFiles(rootDir, fullPath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return files;
  }
}

// 8. Move File Tool
class MoveFileTool extends BaseFilesystemTool {
  name = 'move_file';
  description = 'Move or rename a file';
  schema = z.object({
    source: z.string().describe('Source file path'),
    destination: z.string().describe('Destination file path')
  });

  async _call({ source, destination }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validatedSource = await this.validatePath(source);
      const validatedDest = await this.validatePath(destination);

      await fs.mkdir(path.dirname(validatedDest), { recursive: true });
      await fs.rename(validatedSource, validatedDest);
      return `Successfully moved ${source} to ${destination}`;
    } catch (error: unknown) {
      return `Error moving file: ${getErrorMessage(error)}`;
    }
  }
}

// 9. Search Files Tool
class SearchFilesTool extends BaseFilesystemTool {
  name = 'search_files';
  description = `Search for files by name or content.

  - By default, searches file names
  - With full_search=true, also searches file contents
  - Respects ignore patterns`;

  schema = z.object({
    path: z.string().describe('Directory to search in'),
    pattern: z.string().describe('Search pattern (case-insensitive)'),
    exclude_patterns: z.array(z.string()).nullable().optional().describe('Additional patterns to exclude'),
    full_search: z.boolean().nullable().optional().describe('Search file contents (default: false)')
  });

  async _call({
    path: searchPath,
    pattern,
    exclude_patterns,
    full_search
  }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const validated = await this.validatePath(searchPath);
      const excludeArray = exclude_patterns || [];
      const allExclude = [...this.config.ignorePatterns!, ...excludeArray];
      const fullSearchBool = full_search || false;

      const results = await this.searchFiles(
        validated,
        pattern.toLowerCase(),
        allExclude,
        fullSearchBool
      );

      return results.length > 0 ? results.join('\n') : 'No matches found';
    } catch (error: unknown) {
      return `Error searching: ${getErrorMessage(error)}`;
    }
  }

  private async searchFiles(
    dir: string,
    pattern: string,
    excludePatterns: string[],
    fullSearch: boolean
  ): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip excluded patterns
        if (excludePatterns.some(p => fullPath.includes(p))) {
          continue;
        }

        if (entry.isDirectory()) {
          const subResults = await this.searchFiles(fullPath, pattern, excludePatterns, fullSearch);
          results.push(...subResults);
        } else {
          // Check filename
          if (entry.name.toLowerCase().includes(pattern)) {
            results.push(fullPath);
            continue;
          }

          // Check content if full_search
          if (fullSearch && await this.fileContainsPattern(fullPath, pattern)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return results;
  }

  private async fileContainsPattern(filePath: string, pattern: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.toLowerCase().includes(pattern);
    } catch {
      return false;
    }
  }
}

// 10. List Allowed Directories Tool
class ListAllowedDirectoriesTool extends BaseFilesystemTool {
  name = 'list_allowed_directories';
  description = 'Show which directories are accessible';
  schema = z.object({});

  async _call(): Promise<string> {
    return 'Allowed directories:\n' + this.config.allowedDirectories.join('\n');
  }
}
