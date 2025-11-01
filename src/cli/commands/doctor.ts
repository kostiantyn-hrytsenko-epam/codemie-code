import { Command } from 'commander';
import { tipDisplay } from '../../utils/tips';
import { exec } from '../../utils/exec';
import chalk from 'chalk';
import { AgentRegistry } from '../../agents/registry';

export function createDoctorCommand(): Command {
  const command = new Command('doctor');

  command
    .description('Check system health and configuration')
    .action(async () => {
      console.log(chalk.bold('\n🔍 CodeMie Code Health Check\n'));

      let hasIssues = false;

      // Check Node.js version
      console.log(chalk.bold('Node.js:'));
      try {
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

        if (majorVersion >= 18) {
          console.log(`  ${chalk.green('✓')} Version ${nodeVersion}`);
        } else {
          console.log(`  ${chalk.yellow('⚠')} Version ${nodeVersion} (recommended: >= 18.0.0)`);
          hasIssues = true;
        }
      } catch {
        console.log(`  ${chalk.red('✗')} Failed to check version`);
        hasIssues = true;
      }
      console.log();

      // Check npm
      console.log(chalk.bold('npm:'));
      try {
        const result = await exec('npm', ['--version']);
        console.log(`  ${chalk.green('✓')} Version ${result.stdout}`);
      } catch {
        console.log(`  ${chalk.red('✗')} npm not found`);
        hasIssues = true;
      }
      console.log();

      // Check git
      console.log(chalk.bold('git:'));
      try {
        const result = await exec('git', ['--version']);
        console.log(`  ${chalk.green('✓')} ${result.stdout}`);
      } catch {
        console.log(`  ${chalk.yellow('⚠')} git not found (optional)`);
      }
      console.log();

      // Check AI Configuration
      console.log(chalk.bold('AI Configuration:'));

      // Check for any valid base URL
      const baseUrl = process.env.CODEMIE_BASE_URL ||
                      process.env.ANTHROPIC_BASE_URL ||
                      process.env.OPENAI_BASE_URL;

      // Check for any valid auth token
      const authToken = process.env.CODEMIE_AUTH_TOKEN ||
                        process.env.CODEMIE_API_KEY ||
                        process.env.ANTHROPIC_AUTH_TOKEN ||
                        process.env.ANTHROPIC_API_KEY ||
                        process.env.OPENAI_AUTH_TOKEN ||
                        process.env.OPENAI_API_KEY;

      if (baseUrl) {
        console.log(`  ${chalk.green('✓')} Base URL: ${baseUrl}`);
      } else {
        console.log(`  ${chalk.red('✗')} Base URL not set`);
        console.log(`      Set: CODEMIE_BASE_URL (or provider-specific: ANTHROPIC_BASE_URL, OPENAI_BASE_URL)`);
        hasIssues = true;
      }

      if (authToken) {
        const masked = authToken.substring(0, 4) + '***';
        console.log(`  ${chalk.green('✓')} Auth Token: ${masked}`);
      } else {
        console.log(`  ${chalk.red('✗')} Auth Token not set`);
        console.log(`      Set: CODEMIE_AUTH_TOKEN (or provider-specific: ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY)`);
        hasIssues = true;
      }

      // Check model configuration
      const model = process.env.CODEMIE_MODEL ||
                    process.env.ANTHROPIC_MODEL ||
                    process.env.OPENAI_MODEL;

      if (model) {
        console.log(`  ${chalk.green('✓')} Model: ${model}`);
      } else {
        console.log(`  ${chalk.yellow('⚠')} Model not set (will use default: claude-4-5-sonnet)`);
      }

      console.log();

      // Check installed agents
      console.log(chalk.bold('Installed Agents:'));
      const installedAgents = await AgentRegistry.getInstalledAgents();

      if (installedAgents.length > 0) {
        for (const agent of installedAgents) {
          const version = await agent.getVersion();
          const versionStr = version ? ` (${version})` : '';
          console.log(`  ${chalk.green('✓')} ${agent.displayName}${versionStr}`);
        }
      } else {
        console.log(`  ${chalk.yellow('⚠')} No agents installed (CodeMie Code is built-in)`);
      }
      console.log();

      // Summary
      if (hasIssues) {
        console.log(chalk.yellow('⚠ Some issues detected. Please resolve them for optimal performance.\n'));
        process.exit(1);
      } else {
        console.log(chalk.green('✓ All checks passed!\n'));
        // Show a helpful tip after successful health check (unless in assistant context)
        if (!process.env.CODEMIE_IN_ASSISTANT) {
          tipDisplay.showRandomTip();
        }
      }
    });

  return command;
}
