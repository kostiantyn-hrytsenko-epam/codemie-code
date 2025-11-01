/**
 * Environment variable mapper for model-specific configurations
 *
 * This module provides a generic interface for setting AI model configurations
 * and maps them to concrete implementations (Anthropic, OpenAI, etc.)
 */

export interface AIConfig {
  baseUrl: string;
  authToken: string;
  model: string;
  timeout?: number;
}

export type ModelProvider = 'anthropic' | 'openai' | 'generic';

/**
 * Detect the model provider based on the model name
 */
export function detectProvider(model: string): ModelProvider {
  const modelLower = model.toLowerCase();

  if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
    return 'anthropic';
  }

  if (modelLower.includes('gpt') || modelLower.includes('openai')) {
    return 'openai';
  }

  return 'generic';
}

/**
 * Get environment variable with fallback to provider-specific names
 * Priority: CODEMIE_* (generic) > Provider-specific (ANTHROPIC_*, OPENAI_*)
 */
function getEnvWithFallback(
  providerPrefix: string,
  genericName: string
): string | undefined {
  return (
    process.env[`CODEMIE_${genericName}`] ||
    process.env[`${providerPrefix}_${genericName}`]
  );
}

/**
 * Load AI configuration from environment variables
 * Priority: CODEMIE_* (generic) > ANTHROPIC_* / OPENAI_* (provider-specific)
 */
export function loadAIConfig(provider?: ModelProvider): AIConfig {
  // First, try to determine the model
  const model =
    process.env.CODEMIE_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.OPENAI_MODEL ||
    'claude-4-5-sonnet';

  // Detect provider from model if not specified
  const detectedProvider = provider || detectProvider(model);
  const providerPrefix = detectedProvider.toUpperCase();

  // Get base URL with fallback chain
  const baseUrl = getEnvWithFallback(providerPrefix, 'BASE_URL');

  // Get auth token with fallback chain (try AUTH_TOKEN first, then API_KEY)
  const authToken =
    getEnvWithFallback(providerPrefix, 'AUTH_TOKEN') ||
    process.env.CODEMIE_API_KEY ||
    process.env[`${providerPrefix}_API_KEY`];

  // Get timeout with fallback
  const timeoutStr =
    process.env.CODEMIE_TIMEOUT ||
    process.env[`${providerPrefix}_TIMEOUT`] ||
    '300';

  const timeout = parseInt(timeoutStr, 10);

  if (!baseUrl) {
    throw new Error(
      `Base URL not configured. Set CODEMIE_BASE_URL or ${providerPrefix}_BASE_URL`
    );
  }

  if (!authToken) {
    throw new Error(
      `Auth token not configured. Set CODEMIE_AUTH_TOKEN or ${providerPrefix}_AUTH_TOKEN (or ${providerPrefix}_API_KEY)`
    );
  }

  return {
    baseUrl,
    authToken,
    model,
    timeout
  };
}

/**
 * Export environment variables for a specific provider
 * This is useful when spawning child processes that need provider-specific env vars
 */
export function exportProviderEnvVars(config: AIConfig, provider: ModelProvider): Record<string, string> {
  const providerPrefix = provider.toUpperCase();

  return {
    [`${providerPrefix}_BASE_URL`]: config.baseUrl,
    [`${providerPrefix}_AUTH_TOKEN`]: config.authToken,
    [`${providerPrefix}_API_KEY`]: config.authToken,  // Some tools expect API_KEY
    [`${providerPrefix}_MODEL`]: config.model,
  };
}

/**
 * Get all possible environment variable names for documentation/tips
 */
export function getEnvVarNames(provider: ModelProvider = 'generic'): {
  baseUrl: string[];
  authToken: string[];
  model: string[];
} {
  const providerPrefix = provider.toUpperCase();

  return {
    baseUrl: [
      'CODEMIE_BASE_URL',
      `${providerPrefix}_BASE_URL`
    ],
    authToken: [
      'CODEMIE_AUTH_TOKEN',
      'CODEMIE_API_KEY',
      `${providerPrefix}_AUTH_TOKEN`,
      `${providerPrefix}_API_KEY`
    ],
    model: [
      'CODEMIE_MODEL',
      `${providerPrefix}_MODEL`
    ]
  };
}

/**
 * Validate configuration and provide helpful error messages
 */
export function validateAIConfig(config: AIConfig, provider: ModelProvider): void {
  const envVars = getEnvVarNames(provider);

  if (!config.baseUrl) {
    throw new Error(
      `Missing base URL. Please set one of: ${envVars.baseUrl.join(', ')}`
    );
  }

  if (!config.authToken) {
    throw new Error(
      `Missing auth token. Please set one of: ${envVars.authToken.join(', ')}`
    );
  }

  if (!config.model) {
    throw new Error(
      `Missing model. Please set one of: ${envVars.model.join(', ')}`
    );
  }
}
