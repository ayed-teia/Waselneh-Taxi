import * as functions from 'firebase-functions';
import { env } from '../env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configuredLevel = env.logLevel as LogLevel;
    return levels.indexOf(level) >= levels.indexOf(configuredLevel);
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      functions.logger.debug(message, context);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      functions.logger.info(message, context);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      functions.logger.warn(message, context);
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      functions.logger.error(message, {
        ...context,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    }
  }
}

export const logger = new Logger();
