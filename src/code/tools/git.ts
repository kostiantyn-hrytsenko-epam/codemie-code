import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { exec } from '../../utils/exec.js';
import { getErrorMessage } from '../../utils/errors.js';

export class GitTools {
  constructor(private rootDir: string) {}

  getTools(): StructuredTool[] {
    return [
      new GitStatusTool(this.rootDir),
      new GitDiffTool(this.rootDir),
      new GitLogTool(this.rootDir),
      new GenericGitTool(this.rootDir)
    ];
  }
}

class GitStatusTool extends StructuredTool {
  name = 'git_status';
  description = 'Get git repository status';
  schema = z.object({});

  constructor(private rootDir: string) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const result = await exec('git', ['status', '--short'], { cwd: this.rootDir });
      return result.stdout || 'No changes';
    } catch (error: unknown) {
      return `Error: ${getErrorMessage(error)}`;
    }
  }
}

class GitDiffTool extends StructuredTool {
  name = 'git_diff';
  description = 'Get git diff for changes';
  schema = z.object({
    path: z.string().nullable().optional().describe('File path to diff (optional)')
  });

  constructor(private rootDir: string) {
    super();
  }

  async _call({ path }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const args = ['diff'];
      if (path) args.push(path);

      const result = await exec('git', args, { cwd: this.rootDir });
      return result.stdout || 'No differences';
    } catch (error: unknown) {
      return `Error: ${getErrorMessage(error)}`;
    }
  }
}

class GitLogTool extends StructuredTool {
  name = 'git_log';
  description = 'Get git commit history';
  schema = z.object({
    count: z.number().nullable().optional().default(10).describe('Number of commits to show')
  });

  constructor(private rootDir: string) {
    super();
  }

  async _call({ count }: z.infer<typeof this.schema>): Promise<string> {
    try {
      const result = await exec(
        'git',
        ['log', `--max-count=${count}`, '--oneline'],
        { cwd: this.rootDir }
      );
      return result.stdout || 'No commits';
    } catch (error: unknown) {
      return `Error: ${getErrorMessage(error)}`;
    }
  }
}

class GenericGitTool extends StructuredTool {
  name = 'git_command';
  description = 'Execute any git command. Input is the git command without "git" prefix.';
  schema = z.object({
    command: z.string().describe('Git command to execute (without "git" prefix)')
  });

  constructor(private rootDir: string) {
    super();
  }

  async _call({ command }: z.infer<typeof this.schema>): Promise<string> {
    try {
      // Split command safely
      const args = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const cleanArgs = args.map(arg => arg.replace(/^"|"$/g, ''));

      const result = await exec('git', cleanArgs, { cwd: this.rootDir });
      return result.stdout || 'Command executed successfully';
    } catch (error: unknown) {
      return `Error: ${getErrorMessage(error)}`;
    }
  }
}
