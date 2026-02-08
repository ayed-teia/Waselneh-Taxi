import * as functions from 'firebase-functions';
import { env } from '../env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Environment = 'dev' | 'pilot' | 'prod';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Trip lifecycle events for structured logging
 */
export type TripLifecycleEvent = 
  | 'TRIP_CREATED'
  | 'TRIP_ACCEPTED'
  | 'TRIP_REJECTED'
  | 'TRIP_DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'TRIP_COMPLETED'
  | 'TRIP_CANCELLED'
  | 'TRIP_EXPIRED'
  | 'DISPATCH_FAILED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_FAILED';

/**
 * Structured log entry for analytics and monitoring
 */
interface StructuredLogEntry {
  env: Environment;
  event?: string;
  tripId?: string;
  driverId?: string;
  passengerId?: string;
  [key: string]: unknown;
}

class Logger {
  private getEnvTag(): Environment {
    try {
      return env.environment;
    } catch {
      // During initialization, env might not be available
      return 'dev';
    }
  }

  private enrichContext(context?: LogContext): StructuredLogEntry {
    return {
      env: this.getEnvTag(),
      ...context,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    try {
      const configuredLevel = env.logLevel as LogLevel;
      return levels.indexOf(level) >= levels.indexOf(configuredLevel);
    } catch {
      return true; // Log everything if env not available
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      functions.logger.debug(message, this.enrichContext(context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      functions.logger.info(message, this.enrichContext(context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      functions.logger.warn(message, this.enrichContext(context));
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      functions.logger.error(message, {
        ...this.enrichContext(context),
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });
    }
  }

  // ============================================================================
  // TRIP LIFECYCLE LOGGING
  // ============================================================================

  /**
   * Log a trip lifecycle event with structured data
   */
  tripEvent(
    event: TripLifecycleEvent,
    tripId: string,
    context?: LogContext
  ): void {
    const logEntry: StructuredLogEntry = {
      env: this.getEnvTag(),
      event,
      tripId,
      timestamp: new Date().toISOString(),
      ...context,
    };

    const emoji = this.getEventEmoji(event);
    const message = `${emoji} [TripLifecycle] ${event}`;

    if (event.includes('FAILED') || event === 'TRIP_CANCELLED' || event === 'TRIP_EXPIRED') {
      functions.logger.warn(message, logEntry);
    } else {
      functions.logger.info(message, logEntry);
    }
  }

  /**
   * Log a failed dispatch attempt
   */
  dispatchFailed(
    tripId: string,
    reason: string,
    context?: LogContext
  ): void {
    const logEntry: StructuredLogEntry = {
      env: this.getEnvTag(),
      event: 'DISPATCH_FAILED',
      tripId,
      reason,
      timestamp: new Date().toISOString(),
      ...context,
    };

    functions.logger.warn(`🚫 [Dispatch] FAILED - ${reason}`, logEntry);
  }

  /**
   * Log a payment confirmation
   */
  paymentConfirmed(
    tripId: string,
    amount: number,
    method: 'cash' | 'card',
    context?: LogContext
  ): void {
    const logEntry: StructuredLogEntry = {
      env: this.getEnvTag(),
      event: 'PAYMENT_CONFIRMED',
      tripId,
      amount,
      method,
      currency: 'ILS',
      timestamp: new Date().toISOString(),
      ...context,
    };

    functions.logger.info(`💰 [Payment] CONFIRMED - ₪${amount} (${method})`, logEntry);
  }

  /**
   * Log a payment failure
   */
  paymentFailed(
    tripId: string,
    reason: string,
    context?: LogContext
  ): void {
    const logEntry: StructuredLogEntry = {
      env: this.getEnvTag(),
      event: 'PAYMENT_FAILED',
      tripId,
      reason,
      timestamp: new Date().toISOString(),
      ...context,
    };

    functions.logger.error(`❌ [Payment] FAILED - ${reason}`, logEntry);
  }

  private getEventEmoji(event: TripLifecycleEvent): string {
    const emojiMap: Record<TripLifecycleEvent, string> = {
      TRIP_CREATED: '🆕',
      TRIP_ACCEPTED: '✅',
      TRIP_REJECTED: '❌',
      TRIP_DRIVER_ARRIVED: '📍',
      TRIP_STARTED: '🚗',
      TRIP_COMPLETED: '🏁',
      TRIP_CANCELLED: '🚫',
      TRIP_EXPIRED: '⏰',
      DISPATCH_FAILED: '🚫',
      PAYMENT_CONFIRMED: '💰',
      PAYMENT_FAILED: '❌',
    };
    return emojiMap[event] || '📝';
  }
}

export const logger = new Logger();
