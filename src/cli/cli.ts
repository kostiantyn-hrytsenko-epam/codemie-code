import { Command } from 'commander';
import { CodeMieCode } from '../code/index';
import { logger } from '../utils/logger';
import { createMCPCommand } from './commands/mcp';

export async function createCLI(): Promise<Command> {
  const program = new Command();

  program
    .name('codemie-code')
    .description('CodeMie Code - AI coding assistant and CLI wrapper for multiple agents')
    .version('1.0.0');

  // Add MCP management command
  program.addCommand(createMCPCommand());

  // Interactive mode (default)
  program
    .command('interactive', { isDefault: false })
    .description('Start interactive mode with terminal UI (default)')
    .argument('[working-dir]', 'Working directory', process.cwd())
    .option('--mcp-servers <servers>', 'Comma-separated list of MCP servers to load')
    .action(async (workingDir: string, options: { mcpServers?: string }) => {
      try {
        // Set MCP servers in environment if provided
        if (options.mcpServers) {
          process.env.CODEMIE_MCP_SERVERS = options.mcpServers;
        }

        const assistant = new CodeMieCode(workingDir);
        await assistant.initialize();
        await assistant.startInteractive();
        await assistant.dispose();
      } catch (error: unknown) {
        logger.error('Failed to start CodeMie Code:', error);
        process.exit(1);
      }
    });

  // Execute mode (non-interactive)
  program
    .command('exec')
    .description('Execute a task non-interactively')
    .argument('<task>', 'Task to execute (or /command for proxy commands)')
    .option('-d, --dir <path>', 'Working directory', process.cwd())
    .action(async (task: string, options: { dir: string }) => {
      try {
        const assistant = new CodeMieCode(options.dir);
        await assistant.initialize({ showTips: false });
        await assistant.executeNonInteractive(task);
        await assistant.dispose();
      } catch (error: unknown) {
        logger.error('Failed to execute task:', error);
        process.exit(1);
      }
    });

  // Test connection
  program
    .command('test')
    .description('Test connection to AI provider')
    .action(async () => {
      try {
        await CodeMieCode.testConnection();
        process.exit(0);
      } catch (error: unknown) {
        logger.error('Connection test failed:', error);
        process.exit(1);
      }
    });

  // Add global options
  program
    .option('--mcp-servers <servers>', 'Comma-separated list of MCP servers to load');

  // Default behavior: if no command specified and no args, run interactive
  // If args provided without command, treat first arg as working directory for interactive mode
  program.action(async (options: { mcpServers?: string }) => {
    const args = process.argv.slice(2);

    // If there are no arguments at all, run interactive mode
    if (args.length === 0 || (args.length > 0 && args[0].startsWith('--'))) {
      try {
        // Set MCP servers in environment if provided
        if (options.mcpServers) {
          process.env.CODEMIE_MCP_SERVERS = options.mcpServers;
        }

        const assistant = new CodeMieCode(process.cwd());
        await assistant.initialize();
        await assistant.startInteractive();
        await assistant.dispose();
      } catch (error: unknown) {
        logger.error('Failed to start CodeMie Code:', error);
        process.exit(1);
      }
    } else {
      // If there's a single argument and it's a directory, use it as working dir
      // Otherwise show help
      program.help();
    }
  });

  return program;
}

export async function runCLI(): Promise<void> {
  const program = await createCLI();
  await program.parseAsync(process.argv);
}
