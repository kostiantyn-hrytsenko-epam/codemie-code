import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { getErrorMessage } from '../../utils/errors.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export class MCPTools {
  private mcpClient: MultiServerMCPClient | null = null;
  private enabledServers: string[] = [];

  constructor(private rootDir: string) {}

  async initialize(servers?: string[]): Promise<void> {
    // Load MCP server configurations
    const configs = await this.loadMCPConfigs();

    // Filter enabled servers
    const serversToUse = servers || Object.keys(configs);
    this.enabledServers = serversToUse;

    // Initialize MCP client with error handling for individual servers
    const serverConfigs: Record<string, unknown> = {};
    const failedServers: string[] = [];

    for (const serverName of serversToUse) {
      if (configs[serverName]) {
        serverConfigs[serverName] = configs[serverName];
      } else {
        failedServers.push(serverName);
        console.warn(`MCP server "${serverName}" not found in configuration`);
      }
    }

    if (Object.keys(serverConfigs).length > 0) {
      this.mcpClient = new MultiServerMCPClient(serverConfigs as any);
      // Note: MultiServerMCPClient connects automatically when getting tools
    }

    // Log failed servers for debugging
    if (failedServers.length > 0) {
      console.warn(`Skipped ${failedServers.length} MCP servers: ${failedServers.join(', ')}`);
    }
  }

  async getTools(): Promise<StructuredTool[]> {
    if (!this.mcpClient) {
      return [];
    }

    try {
      // Get tools from MCP client
      const mcpTools = await this.mcpClient.getTools();

      // Wrap MCP tools with metadata
      return mcpTools.map((tool) => new WrappedMCPTool(tool as StructuredTool));
    } catch (error: unknown) {
      console.warn(`Failed to load MCP tools: ${getErrorMessage(error)}`);
      return [];
    }
  }

  private async loadMCPConfigs(): Promise<Record<string, unknown>> {
    const configs: Record<string, unknown> = {};
    let hasGlobalServers = false;

    // Load from global config (~/.codemie/config.json)
    const globalConfigPath = path.join(os.homedir(), '.codemie', 'config.json');
    try {
      const globalConfig = JSON.parse(await fs.readFile(globalConfigPath, 'utf-8'));
      if (globalConfig.mcpServers && Object.keys(globalConfig.mcpServers).length > 0) {
        Object.assign(configs, globalConfig.mcpServers);
        hasGlobalServers = true;
      }
    } catch {
      // No global config
    }

    // Load from bundled servers.json ONLY if no global servers configured
    // This prevents loading bundled servers that require environment variables
    if (!hasGlobalServers) {
      const bundledPath = path.join(__dirname, '../../../mcp/servers.json');
      try {
        const bundled = JSON.parse(await fs.readFile(bundledPath, 'utf-8'));
        if (bundled.mcpServers) {
          // Global config takes precedence
          for (const [name, config] of Object.entries(bundled.mcpServers)) {
            if (!configs[name]) {
              configs[name] = config;
            }
          }
        }
      } catch {
        // No bundled config
      }
    }

    // Inject environment variables into configs
    for (const config of Object.values(configs)) {
      if (typeof config === 'object' && config !== null && 'env' in config) {
        const env = (config as { env: Record<string, unknown> }).env;
        if (env && typeof env === 'object') {
          for (const [key, value] of Object.entries(env)) {
            if (typeof value === 'string' && value.includes('${')) {
              env[key] = this.interpolateEnvVars(value);
            }
          }
        }
      }
    }

    return configs;
  }

  private interpolateEnvVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  async dispose(): Promise<void> {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close();
      } catch (error: unknown) {
        console.warn(`Error closing MCP client: ${getErrorMessage(error)}`);
      }
    }
  }
}

class WrappedMCPTool extends StructuredTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;

  constructor(private mcpTool: StructuredTool) {
    super();
    this.name = `mcp_${mcpTool.name}`;
    this.description = `[MCP Tool] ${mcpTool.description}`;
    // LangChain MCP tools already have a 'schema' property with the JSON schema
    this.schema = this.convertSchema(mcpTool.schema);
  }

  async _call(inputs: Record<string, unknown>): Promise<string> {
    try {
      const result = await this.mcpTool.invoke(inputs);
      // LangChain MCP tools return results as strings already
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error: unknown) {
      return `MCP Error: ${getErrorMessage(error)}`;
    }
  }

  private convertSchema(mcpSchema: z.ZodObject<z.ZodRawShape> | unknown): z.ZodObject<z.ZodRawShape> {
    // If already a Zod schema, return as-is
    if (mcpSchema instanceof z.ZodObject) {
      return mcpSchema;
    }

    const shape: Record<string, z.ZodTypeAny> = {};

    // Handle JSON Schema-like objects
    if (typeof mcpSchema === 'object' && mcpSchema !== null && 'properties' in mcpSchema) {
      const schemaObj = mcpSchema as { properties?: Record<string, unknown>; required?: string[] };

      if (schemaObj.properties) {
        for (const [key, prop] of Object.entries(schemaObj.properties)) {
          if (typeof prop === 'object' && prop !== null && 'type' in prop) {
            const propObj = prop as { type?: string; description?: string };
            let zodType: z.ZodTypeAny;

            if (propObj.type === 'string') {
              zodType = z.string();
            } else if (propObj.type === 'number' || propObj.type === 'integer') {
              zodType = z.number();
            } else if (propObj.type === 'boolean') {
              zodType = z.boolean();
            } else if (propObj.type === 'array') {
              zodType = z.array(z.any());
            } else if (propObj.type === 'object') {
              zodType = z.object({}).passthrough();
            } else {
              zodType = z.any();
            }

            // Add description if available
            if (propObj.description) {
              zodType = zodType.describe(propObj.description);
            }

            // Make optional if not required
            if (schemaObj.required && Array.isArray(schemaObj.required) && !schemaObj.required.includes(key)) {
              zodType = zodType.optional();
            }

            shape[key] = zodType;
          }
        }
      }
    }

    return z.object(shape);
  }
}
