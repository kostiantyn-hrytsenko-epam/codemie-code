#!/usr/bin/env node

import { Command } from 'commander';
import { createListCommand } from './commands/list';
import { createInstallCommand } from './commands/install';
import { createUninstallCommand } from './commands/uninstall';
import { createRunCommand } from './commands/run';
import { createDoctorCommand } from './commands/doctor';
import { createVersionCommand } from './commands/version';
import { createMCPCommand } from './commands/mcp';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';

const program = new Command();

// Read version from package.json
let version = '1.0.0';
try {
  const packageJsonPath = join(__dirname, '../../package.json');
  const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonContent) as { version: string };
  version = packageJson.version;
} catch {
  // Use default version if unable to read
}

program
  .name('codemie')
  .description('CLI wrapper for managing multiple AI coding agents')
  .version(version);

// Add commands
program.addCommand(createListCommand());
program.addCommand(createInstallCommand());
program.addCommand(createUninstallCommand());
program.addCommand(createRunCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createVersionCommand());
program.addCommand(createMCPCommand());

// Show help if no command provided
if (process.argv.length === 2) {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║         CodeMie CLI Wrapper           ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════╝\n'));
  program.help();
}

program.parse(process.argv);
