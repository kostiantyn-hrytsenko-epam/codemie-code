import { Command } from 'commander';
import { AgentRegistry } from '../../agents/registry';
import { logger } from '../../utils/logger';
import { AgentNotFoundError } from '../../utils/errors';

export function createRunCommand(): Command {
  const command = new Command('run');

  command
    .description('Run an agent')
    .argument('<agent>', 'Agent name to run')
    .argument('[args...]', 'Additional arguments to pass to the agent')
    .option('-m, --model <model>', 'Model to use')
    .action(async (agentName: string, args: string[], options) => {
      try {
        const agent = AgentRegistry.getAgent(agentName);

        if (!agent) {
          throw new AgentNotFoundError(agentName);
        }

        // Check if installed
        if (!(await agent.isInstalled())) {
          logger.error(`${agent.displayName} is not installed. Install it first with: codemie install ${agentName}`);
          process.exit(1);
        }

        // Set model environment variable if provided
        if (options.model) {
          const envVar = `${agentName.toUpperCase().replace('-', '_')}_MODEL`;
          process.env[envVar] = options.model;
        }

        // Run the agent
        await agent.run(args);
      } catch (error: unknown) {
        logger.error('Failed to run agent:', error);
        process.exit(1);
      }
    });

  return command;
}
