export class CodeMieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeMieError';
  }
}

export class ConfigurationError extends CodeMieError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class AgentNotFoundError extends CodeMieError {
  constructor(agentName: string) {
    super(`Agent not found: ${agentName}`);
    this.name = 'AgentNotFoundError';
  }
}

export class AgentInstallationError extends CodeMieError {
  constructor(agentName: string, reason: string) {
    super(`Failed to install agent ${agentName}: ${reason}`);
    this.name = 'AgentInstallationError';
  }
}

export class ToolExecutionError extends CodeMieError {
  constructor(toolName: string, reason: string) {
    super(`Tool ${toolName} failed: ${reason}`);
    this.name = 'ToolExecutionError';
  }
}

export class PathSecurityError extends CodeMieError {
  constructor(path: string, reason: string) {
    super(`Path security violation: ${path} - ${reason}`);
    this.name = 'PathSecurityError';
  }
}

/**
 * Extracts error message from unknown error type
 * @param error - The caught error (unknown type)
 * @returns Error message as string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
