import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { getErrorMessage } from '../../utils/errors.js';

interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  transport?: string;
  env?: Record<string, string>;
}

interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export function createMCPCommand(): Command {
  const mcp = new Command('mcp');

  mcp
    .description('Manage MCP (Model Context Protocol) servers for CodeMie Code');

  // List command
  mcp
    .command('list')
    .description('List all available MCP servers')
    .option('-v, --verbose', 'Show detailed configuration')
    .action(async (options) => {
      await listMCPServers(options.verbose);
    });

  // Add command
  mcp
    .command('add <name> <command-or-url>')
    .description('Add a new MCP server configuration')
    .option('-t, --transport <type>', 'Transport type (stdio, sse, streamable_http)', 'stdio')
    .option('-a, --args <args...>', 'Command arguments (for stdio transport)')
    .option('-e, --env <vars...>', 'Environment variables (KEY=VALUE format)')
    .action(async (name: string, commandOrUrl: string, options: {
      transport: string;
      args?: string[];
      env?: string[];
    }) => {
      await addMCPServer(name, commandOrUrl, options);
    });

  // Remove command
  mcp
    .command('remove <name>')
    .alias('rm')
    .description('Remove an MCP server configuration')
    .action(async (name: string) => {
      await removeMCPServer(name);
    });

  // Test command
  mcp
    .command('test <server>')
    .description('Test if an MCP server configuration is valid')
    .action(async (serverName: string) => {
      await testMCPServer(serverName);
    });

  // Servers command
  mcp
    .command('servers')
    .description('Show which MCP servers would be loaded')
    .option('-s, --servers <names>', 'Comma-separated list of server names')
    .action(async (options) => {
      await showServersToLoad(options.servers);
    });

  return mcp;
}

async function loadMCPConfigs(): Promise<{ toolkit: MCPServersConfig | null; global: MCPServersConfig | null }> {
  const toolkit = await loadToolkitServers();
  const global = await loadGlobalServers();
  return { toolkit, global };
}

async function loadToolkitServers(): Promise<MCPServersConfig | null> {
  const bundledPath = path.join(__dirname, '../../../mcp/servers.json');
  try {
    const content = await fs.readFile(bundledPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function loadGlobalServers(): Promise<MCPServersConfig | null> {
  const globalConfigPath = path.join(os.homedir(), '.codemie', 'config.json');
  try {
    const content = await fs.readFile(globalConfigPath, 'utf-8');
    const config = JSON.parse(content);
    if (config.mcpServers) {
      return { mcpServers: config.mcpServers };
    }
    return null;
  } catch {
    return null;
  }
}

function getAllServers(toolkit: MCPServersConfig | null, global: MCPServersConfig | null): Record<string, MCPServerConfig> {
  const allServers: Record<string, MCPServerConfig> = {};

  // Add toolkit servers first
  if (toolkit?.mcpServers) {
    Object.assign(allServers, toolkit.mcpServers);
  }

  // Global servers override toolkit servers
  if (global?.mcpServers) {
    Object.assign(allServers, global.mcpServers);
  }

  return allServers;
}

function formatCommand(config: MCPServerConfig): string {
  if (config.command) {
    const command = config.command;
    const args = config.args || [];
    if (args.length > 0) {
      const argsStr = args.slice(0, 2).join(' ');
      return args.length > 2 ? `${command} ${argsStr}...` : `${command} ${argsStr}`;
    }
    return command;
  } else if (config.url) {
    return config.url;
  }
  return '-';
}

function getServerType(config: MCPServerConfig): string {
  if (config.command) {
    if (config.command === 'npx') return 'Node.js';
    if (config.command === 'uvx' || config.command === 'python') return 'Python';
    return 'External';
  }
  return 'HTTP';
}

async function listMCPServers(verbose: boolean): Promise<void> {
  console.log(chalk.bold.cyan('\n═══════════════════════════════════════════════'));
  console.log(chalk.bold.cyan('       Available MCP Servers for CodeMie Code'));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════\n'));

  const { toolkit, global } = await loadMCPConfigs();
  const allServers = getAllServers(toolkit, global);

  if (Object.keys(allServers).length === 0) {
    console.log(chalk.yellow('No MCP servers found in any configuration.\n'));
    console.log(chalk.dim('To add MCP servers, edit:'));
    console.log(chalk.dim(`  ${path.join(os.homedir(), '.codemie', 'config.json')}\n`));
    console.log(chalk.dim('Example configuration:'));
    console.log(chalk.dim('  "mcpServers": {'));
    console.log(chalk.dim('    "my-server": {'));
    console.log(chalk.dim('      "command": "npx",'));
    console.log(chalk.dim('      "args": ["-y", "@my/mcp-server"]'));
    console.log(chalk.dim('    }'));
    console.log(chalk.dim('  }'));
    return;
  }

  // Print table header
  const nameWidth = 20;
  const transportWidth = 12;
  const commandWidth = 35;
  const sourceWidth = 18;

  console.log(
    chalk.cyan(padRight('Server Name', nameWidth)) +
    chalk.green(padRight('Transport', transportWidth)) +
    chalk.blue(padRight('Command/URL', commandWidth)) +
    chalk.yellow(padRight('Source', sourceWidth))
  );
  console.log(chalk.gray('─'.repeat(nameWidth + transportWidth + commandWidth + sourceWidth)));

  // Get toolkit and global server names for source attribution
  const toolkitServerNames = toolkit?.mcpServers ? Object.keys(toolkit.mcpServers) : [];
  const globalServerNames = global?.mcpServers ? Object.keys(global.mcpServers) : [];

  // Print servers
  for (const [name, config] of Object.entries(allServers)) {
    const transport = config.transport || 'stdio';
    const command = formatCommand(config);
    const source = globalServerNames.includes(name)
      ? (toolkitServerNames.includes(name) ? 'Global (override)' : 'Global Config')
      : 'Toolkit';

    console.log(
      chalk.cyan(padRight(name, nameWidth)) +
      chalk.green(padRight(transport, transportWidth)) +
      chalk.blue(padRight(command, commandWidth)) +
      chalk.yellow(padRight(source, sourceWidth))
    );

    if (verbose && config.env && Object.keys(config.env).length > 0) {
      const envVars = Object.keys(config.env).join(', ');
      console.log(chalk.dim(`  Environment: ${envVars}`));
    }
  }

  console.log();

  // Show config paths
  console.log(chalk.cyan('Configuration Files:'));
  const bundledPath = path.join(__dirname, '../../../mcp/servers.json');
  if (toolkit) {
    console.log(chalk.dim(`  • Toolkit: ${bundledPath}`));
  }
  const globalPath = path.join(os.homedir(), '.codemie', 'config.json');
  if (global) {
    console.log(chalk.dim(`  • Global:  ${globalPath}`));
  }

  console.log();
  console.log(chalk.dim('To use these servers with codemie-code:'));
  console.log(chalk.dim('  • Auto-loaded: codemie-code'));
  console.log(chalk.dim('    (all configured servers load automatically)'));
  console.log();
  console.log(chalk.dim('  • Specific servers: codemie-code --mcp-servers filesystem,cli-mcp-server'));
  console.log(chalk.dim('    (load only specified servers)\n'));
}

async function testMCPServer(serverName: string): Promise<void> {
  const { toolkit, global } = await loadMCPConfigs();
  const allServers = getAllServers(toolkit, global);

  if (!allServers[serverName]) {
    console.log(chalk.red(`\n✗ Server '${serverName}' not found in configuration.\n`));
    console.log(chalk.yellow('Available servers:'));
    for (const name of Object.keys(allServers)) {
      console.log(chalk.dim(`  • ${name}`));
    }
    console.log();
    console.log(chalk.dim('Use \'codemie-code mcp list\' to see all servers'));
    return;
  }

  const config = allServers[serverName];
  const source = global?.mcpServers?.[serverName] ? 'Global Config' : 'Toolkit Config';

  console.log(chalk.bold.cyan(`\n╔═══════════════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║  MCP Server Test: ${padRight(serverName, 28)}║`));
  console.log(chalk.bold.cyan(`╚═══════════════════════════════════════════════╝\n`));

  console.log(chalk.green(`✓ Server '${serverName}' found in configuration`));
  console.log(chalk.cyan('Source:    ') + source);
  console.log(chalk.cyan('Transport: ') + (config.transport || 'stdio'));

  const transport = config.transport || 'stdio';

  if (transport === 'stdio') {
    if (config.command) {
      console.log(chalk.cyan('Command:   ') + config.command);
      if (config.args && config.args.length > 0) {
        console.log(chalk.cyan('Arguments: ') + config.args.join(' '));
      }
    } else {
      console.log(chalk.yellow('⚠  Missing \'command\' field for stdio transport'));
    }
  } else if (transport === 'sse' || transport === 'streamable_http') {
    if (config.url) {
      console.log(chalk.cyan('URL:       ') + config.url);
    } else {
      console.log(chalk.yellow(`⚠  Missing 'url' field for ${transport} transport`));
    }
  }

  if (config.env && Object.keys(config.env).length > 0) {
    const envVars = Object.keys(config.env).join(', ');
    console.log(chalk.cyan('Environment Variables: ') + envVars);
  }

  console.log();
  console.log(chalk.dim('To use this server:'));
  console.log(chalk.dim(`  codemie-code --mcp-servers ${serverName}\n`));
}

async function showServersToLoad(serversParam?: string): Promise<void> {
  if (!serversParam) {
    console.log(chalk.yellow('\nNo MCP servers specified. Use --servers option.\n'));
    console.log(chalk.dim('Example usage:'));
    console.log(chalk.dim('  codemie-code mcp servers --servers filesystem,cli-mcp-server\n'));
    return;
  }

  const serverNames = serversParam.split(',').map(s => s.trim()).filter(Boolean);

  if (serverNames.length === 0) {
    console.log(chalk.yellow('\nNo valid server names provided\n'));
    return;
  }

  const { toolkit, global } = await loadMCPConfigs();
  const allServers = getAllServers(toolkit, global);

  const missingServers = serverNames.filter(name => !allServers[name]);
  const availableServers = serverNames.filter(name => allServers[name]);

  if (missingServers.length > 0) {
    console.log(chalk.red('\n✗ The following servers were not found:'));
    for (const server of missingServers) {
      console.log(chalk.dim(`  • ${server}`));
    }
    console.log();
    console.log(chalk.yellow('Use \'codemie-code mcp list\' to see available servers\n'));
  }

  if (availableServers.length > 0) {
    console.log(chalk.green('\n✓ The following servers would be loaded:\n'));

    const nameWidth = 22;
    const transportWidth = 12;
    const commandWidth = 35;
    const typeWidth = 10;

    console.log(
      chalk.cyan(padRight('Server', nameWidth)) +
      chalk.green(padRight('Transport', transportWidth)) +
      chalk.blue(padRight('Command/URL', commandWidth)) +
      chalk.yellow(padRight('Type', typeWidth))
    );
    console.log(chalk.gray('─'.repeat(nameWidth + transportWidth + commandWidth + typeWidth)));

    for (const name of availableServers) {
      const config = allServers[name];
      const transport = config.transport || 'stdio';
      const command = formatCommand(config);
      const type = getServerType(config);

      console.log(
        chalk.cyan(padRight(name, nameWidth)) +
        chalk.green(padRight(transport, transportWidth)) +
        chalk.blue(padRight(command, commandWidth)) +
        chalk.yellow(padRight(type, typeWidth))
      );
    }

    console.log();
    console.log(chalk.dim('Start codemie-code with these servers:'));
    console.log(chalk.dim(`  codemie-code --mcp-servers ${availableServers.join(',')}\n`));
  }
}

function padRight(str: string, width: number): string {
  if (str.length >= width) {
    return str.substring(0, width - 3) + '...';
  }
  return str + ' '.repeat(width - str.length);
}

async function ensureCodemieDir(): Promise<void> {
  const codemieDir = path.join(os.homedir(), '.codemie');
  try {
    await fs.mkdir(codemieDir, { recursive: true });
  } catch (error: unknown) {
    throw new Error(`Failed to create .codemie directory: ${getErrorMessage(error)}`);
  }
}

async function loadGlobalConfig(): Promise<Record<string, unknown>> {
  const globalConfigPath = path.join(os.homedir(), '.codemie', 'config.json');
  try {
    const content = await fs.readFile(globalConfigPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function saveGlobalConfig(config:Record<string,unknown>): Promise<void> {
  await ensureCodemieDir();
  const globalConfigPath = path.join(os.homedir(), '.codemie', 'config.json');
  await fs.writeFile(globalConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function addMCPServer(
  name: string,
  commandOrUrl: string,
  options: {
    transport: string;
    args?: string[];
    env?: string[];
  }
): Promise<void> {
  // Validate transport type
  const validTransports = ['stdio', 'sse', 'streamable_http'];
  if (!validTransports.includes(options.transport)) {
    console.log(chalk.red(`\n✗ Invalid transport type: ${options.transport}`));
    console.log(chalk.yellow(`Valid types: ${validTransports.join(', ')}\n`));
    return;
  }

  // Build server configuration
  const serverConfig: MCPServerConfig = {
    transport: options.transport
  };

  if (options.transport === 'stdio') {
    serverConfig.command = commandOrUrl;
    if (options.args && options.args.length > 0) {
      serverConfig.args = options.args;
    }
  } else {
    serverConfig.url = commandOrUrl;
  }

  // Parse environment variables
  if (options.env && options.env.length > 0) {
    serverConfig.env = {};
    for (const envVar of options.env) {
      const [key, ...valueParts] = envVar.split('=');
      const value = valueParts.join('=');
      if (key && value) {
        serverConfig.env[key] = value;
      } else {
        console.log(chalk.yellow(`\n⚠ Invalid environment variable format: ${envVar}`));
        console.log(chalk.dim('Expected format: KEY=VALUE\n'));
        return;
      }
    }
  }

  try {
    // Load global config
    const config = await loadGlobalConfig();

    // Initialize mcpServers if not exists
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }

    const mcpServers = config.mcpServers as Record<string, MCPServerConfig>;

    // Check if server already exists
    const isUpdate = mcpServers[name] !== undefined;

    // Add/update server
    mcpServers[name] = serverConfig;
    config.mcpServers = mcpServers;

    // Save config
    await saveGlobalConfig(config);

    // Success message
    if (isUpdate) {
      console.log(chalk.green(`\n✓ Updated MCP server configuration: ${name}`));
    } else {
      console.log(chalk.green(`\n✓ Added MCP server configuration: ${name}`));
    }

    // Show configuration
    console.log(chalk.cyan('\nConfiguration:'));
    console.log(JSON.stringify(serverConfig, null, 2));

    console.log(chalk.dim(`\nSaved to: ${path.join(os.homedir(), '.codemie', 'config.json')}`));
    console.log(chalk.dim(`\nTo use this server:`));
    console.log(chalk.dim(`  codemie-code --mcp-servers ${name}\n`));

  } catch (error: unknown) {
    console.log(chalk.red(`\n✗ Failed to add MCP server: ${getErrorMessage(error)}\n`));
  }
}

async function removeMCPServer(name: string): Promise<void> {
  try {
    // Load global config
    const config = await loadGlobalConfig();

    // Check if mcpServers exists
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      console.log(chalk.yellow(`\n⚠ No MCP servers configured\n`));
      return;
    }

    const mcpServers = config.mcpServers as Record<string, MCPServerConfig>;

    // Check if server exists
    if (!mcpServers[name]) {
      console.log(chalk.yellow(`\n⚠ MCP server '${name}' not found in global configuration\n`));
      console.log(chalk.dim('Available servers:'));
      for (const serverName of Object.keys(mcpServers)) {
        console.log(chalk.dim(`  • ${serverName}`));
      }
      console.log();
      return;
    }

    // Remove server
    delete mcpServers[name];
    config.mcpServers = mcpServers;

    // Save config
    await saveGlobalConfig(config);

    console.log(chalk.green(`\n✓ Removed MCP server: ${name}\n`));

  } catch (error: unknown) {
    console.log(chalk.red(`\n✗ Failed to remove MCP server: ${getErrorMessage(error)}\n`));
  }
}
