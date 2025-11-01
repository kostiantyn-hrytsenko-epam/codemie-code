import chalk from 'chalk';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

class Logger {
  private debugEnabled: boolean;

  constructor() {
    this.debugEnabled = process.env.CODEMIE_DEBUG === 'true';
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.debugEnabled) {
      console.log(chalk.cyan(message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.log(chalk.blueBright(message), ...args);
  }

  success(message: string, ...args: unknown[]): void {
    console.log(chalk.green(`✓ ${message}`), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(chalk.yellow(`⚠ ${message}`), ...args);
  }

  error(message: string, error?: Error | unknown): void {
    console.error(chalk.red(`✗ ${message}`));
    if (error) {
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (this.debugEnabled && error.stack) {
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.red(error));
      }
    }
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }
}

export const logger = new Logger();
