import { doc, onSnapshot } from 'firebase/firestore';
import { getFirestoreDb } from './firebase';
import { CollectionItem, subscribeCollection } from './operations.service';

export interface OpsMetrics {
  generatedAt?: Date;
  windows?: {
    errorsMinutes: number;
    tripsHours: number;
  };
  errors?: {
    total: number;
    info: number;
    warning: number;
    error: number;
    fatal: number;
    byApp: Record<string, number>;
  };
  drivers?: {
    onlineCount: number;
    availableOnlineCount: number;
  };
  trips?: {
    activeCount: number;
    pendingCount: number;
    inProgressCount: number;
    createdLast24h: number;
    completedLast24h: number;
    cancelledLast24h: number;
  };
}

export interface OpsAlert {
  alertId: string;
  title: string;
  message: string;
  severity: 'warning' | 'critical';
  status: 'open' | 'resolved';
  acknowledgedBy?: string | null;
  acknowledgedAt?: Date | null;
  openedAt?: Date | null;
  resolvedAt?: Date | null;
  updatedAt?: Date | null;
  details?: Record<string, unknown>;
}

export interface OpsError {
  errorId: string;
  app: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  message: string;
  stack?: string | null;
  userId?: string | null;
  createdAt?: Date | null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

export function subscribeOpsMetrics(onData: (metrics: OpsMetrics | null) => void): () => void {
  const db = getFirestoreDb();
  const ref = doc(db, 'opsMetrics', 'current');
  return onSnapshot(ref, (snapshot) => {
    if (!snapshot.exists()) {
      onData(null);
      return;
    }
    const data = snapshot.data();
    onData({
      ...data,
      generatedAt: toDateOrNull(data.generatedAt) ?? undefined,
    } as OpsMetrics);
  });
}

export function subscribeOpsAlerts(
  onData: (alerts: OpsAlert[]) => void
): () => void {
  return subscribeCollection<OpsAlert>(
    'opsAlerts',
    (items) => {
      onData(
        items.map((item) => {
          const data = item.data as unknown as Record<string, unknown>;
          return {
            alertId: item.id,
            title: String(data.title ?? item.id),
            message: String(data.message ?? ''),
            severity: (data.severity === 'critical' ? 'critical' : 'warning') as 'warning' | 'critical',
            status: data.status === 'resolved' ? 'resolved' : 'open',
            acknowledgedBy: typeof data.acknowledgedBy === 'string' ? data.acknowledgedBy : null,
            acknowledgedAt: toDateOrNull(data.acknowledgedAt),
            openedAt: toDateOrNull(data.openedAt),
            resolvedAt: toDateOrNull(data.resolvedAt),
            updatedAt: toDateOrNull(data.updatedAt),
            details: (data.details ?? {}) as Record<string, unknown>,
          };
        })
      );
    },
    { orderByField: 'updatedAt', orderDirection: 'desc', limitTo: 50 }
  );
}

export function subscribeOpsErrors(
  onData: (errors: OpsError[]) => void
): () => void {
  return subscribeCollection<OpsError>(
    'opsErrors',
    (items: CollectionItem<OpsError>[]) => {
      onData(
        items.map((item) => {
          const data = item.data as unknown as Record<string, unknown>;
          return {
            errorId: item.id,
            app: String(data.app ?? 'unknown'),
            severity:
              data.severity === 'fatal' ||
              data.severity === 'warning' ||
              data.severity === 'info'
                ? (data.severity as OpsError['severity'])
                : 'error',
            message: String(data.message ?? ''),
            stack: typeof data.stack === 'string' ? data.stack : null,
            userId: typeof data.userId === 'string' ? data.userId : null,
            createdAt: toDateOrNull(data.createdAt),
          };
        })
      );
    },
    { orderByField: 'createdAt', orderDirection: 'desc', limitTo: 100 }
  );
}
