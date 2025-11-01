import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { exec } from '../../utils/exec.js';
import { FilesystemConfig } from './filesystem.js';
import { getErrorMessage } from '../../utils/errors.js';

export class CommandTools {
  constructor(private config: FilesystemConfig) {}

  getTools(): StructuredTool[] {
    return [new ExecuteCommandTool(this.config)];
  }
}

class ExecuteCommandTool extends StructuredTool {
  name = 'execute_command';
  description = `Execute a shell command in a working directory.

  Returns:
  - Working directory
  - Command executed
  - Exit code
  - Standard output
  - Standard error (if failed)

  Security: Blocks dangerous patterns like rm -rf /, mkfs, sudo, etc.`;

  schema = z.object({
    command: z.string().describe('Command to execute'),
    working_directory: z.string().nullable().optional().describe('Working directory (default: first allowed dir)')
  });

  // Dangerous command patterns from cli/coding
  private dangerousPatterns = [
    { regex: /rm\s+-rf\s+\//, message: 'Dangerous: recursive delete on root' },
    { regex: /mkfs/, message: 'Dangerous: filesystem formatting' },
    { regex: /dd\s+if=/, message: 'Dangerous: disk operations' },
    { regex: /wget.*\|.*sh/, message: 'Dangerous: download and execute' },
    { regex: /curl.*\|.*sh/, message: 'Dangerous: download and execute' },
    { regex: /sudo/, message: 'Dangerous: privilege escalation' },
    { regex: /chmod\s+777/, message: 'Dangerous: unsafe permissions' },
    { regex: />\s*\/etc\//, message: 'Dangerous: writing to system config' },
    { regex: />\s*\/dev\//, message: 'Dangerous: writing to devices' },
    { regex: /:\(\)\{\s*:\|:&\s*\};:/, message: 'Dangerous: fork bomb' }
  ];

  constructor(private config: FilesystemConfig) {
    super();
  }

  async _call({
    command,
    working_directory
  }: z.infer<typeof this.schema>): Promise<string> {
    // Security check
    for (const { regex, message } of this.dangerousPatterns) {
      if (regex.test(command)) {
        return `Error: ${message}`;
      }
    }

    // Determine working directory
    const workDir = working_directory || this.config.allowedDirectories[0];

    try {
      const result = await exec('sh', ['-c', command], {
        cwd: workDir
      });

      const output = [
        `Working directory: ${workDir}`,
        `Command: ${command}`,
        `Exit code: ${result.code}`
      ];

      if (result.stdout) {
        output.push('\nStandard output:', result.stdout);
      }

      if (result.code !== 0 && result.stderr) {
        output.push('\nStandard error:', result.stderr);
      }

      return output.join('\n');
    } catch (error: unknown) {
      return `Error executing command: ${getErrorMessage(error)}`;
    }
  }
}
