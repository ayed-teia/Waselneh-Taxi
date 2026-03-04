import { httpsCallable } from 'firebase/functions';
import { getFunctionsInstance } from './firebase';

let installed = false;

async function sendError(payload: {
  severity: 'error' | 'fatal';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}) {
  try {
    const functions = getFunctionsInstance();
    const callable = httpsCallable<
      {
        app: 'manager-web';
        severity: 'error' | 'fatal';
        message: string;
        stack?: string;
        context?: Record<string, unknown>;
      },
      { accepted: boolean }
    >(functions, 'reportClientError');

    await callable({
      app: 'manager-web',
      severity: payload.severity,
      message: payload.message,
      stack: payload.stack,
      context: payload.context,
    });
  } catch {
    // Never break app execution due telemetry failure.
  }
}

export function installWebErrorTracking(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;

  window.addEventListener('error', (event) => {
    void sendError({
      severity: 'fatal',
      message: event.message || 'Unhandled window error',
      stack: event.error?.stack,
      context: {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`;
    const stack = reason instanceof Error ? reason.stack : undefined;
    void sendError({
      severity: 'error',
      message,
      stack,
      context: {
        type: 'unhandledrejection',
      },
    });
  });
}
