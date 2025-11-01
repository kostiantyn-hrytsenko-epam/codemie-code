import dotenv from 'dotenv';
import { ConfigurationError, getErrorMessage } from '../utils/errors.js';
import { loadAIConfig, detectProvider, ModelProvider } from '../utils/env-mapper.js';

dotenv.config();

export interface CodeMieConfig {
  baseUrl: string;
  authToken: string;
  model: string;
  timeout: number;
  provider: ModelProvider;
  debug: boolean;
  mcpServers?: string[];
  workingDirectory: string;
}

export function loadConfig(workingDir?: string): CodeMieConfig {
  // Load AI configuration from environment variables
  // Priority: CODEMIE_* (generic) > ANTHROPIC_*/OPENAI_* (provider-specific)
  let aiConfig;
  try {
    aiConfig = loadAIConfig();
  } catch (error: unknown) {
    throw new ConfigurationError(getErrorMessage(error));
  }

  // Detect provider from model
  const provider = detectProvider(aiConfig.model);

  // Debug mode
  const debug = process.env.CODEMIE_DEBUG === 'true';

  // MCP configuration
  const mcpServersEnv = process.env.CODEMIE_MCP_SERVERS;
  const mcpServers = mcpServersEnv ? mcpServersEnv.split(',').map(s => s.trim()) : undefined;

  // Working directory
  const workingDirectory = workingDir || process.cwd();

  return {
    baseUrl: aiConfig.baseUrl,
    authToken: aiConfig.authToken,
    model: aiConfig.model,
    timeout: aiConfig.timeout || 300,
    provider,
    debug,
    mcpServers,
    workingDirectory
  };
}
