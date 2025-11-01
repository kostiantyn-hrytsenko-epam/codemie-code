import { AgentAdapter } from '../registry';
import { exec } from '../../utils/exec';
import { logger } from '../../utils/logger';
import { spawn } from 'child_process';

export class AiderAdapter implements AgentAdapter {
  name = 'aider';
  displayName = 'Aider';
  description = 'Aider - AI pair programming in your terminal';

  async install(): Promise<void> {
    logger.info('Installing Aider...');
    try {
      // Install via pip
      await exec('pip', ['install', 'aider-chat'], { timeout: 120000 });
      logger.success('Aider installed successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to install Aider: ${errorMessage}`);
    }
  }

  async uninstall(): Promise<void> {
    logger.info('Uninstalling Aider...');
    try {
      await exec('pip', ['uninstall', '-y', 'aider-chat']);
      logger.success('Aider uninstalled successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to uninstall Aider: ${errorMessage}`);
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      const result = await exec('which', ['aider']);
      return result.code === 0;
    } catch {
      return false;
    }
  }

  async run(args: string[]): Promise<void> {
    logger.info('Starting Aider...');

    // Set model from environment if configured
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.env.AIDER_MODEL) {
      env.AIDER_MODEL = process.env.AIDER_MODEL;
    }

    // Spawn Aider
    const child = spawn('aider', args, {
      stdio: 'inherit',
      env
    });

    return new Promise((resolve, reject) => {
      child.on('error', (error) => {
        reject(new Error(`Failed to start Aider: ${error.message}`));
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Aider exited with code ${code}`));
        }
      });
    });
  }

  async getVersion(): Promise<string | null> {
    try {
      const result = await exec('aider', ['--version']);
      return result.stdout.trim();
    } catch {
      return null;
    }
  }
}
