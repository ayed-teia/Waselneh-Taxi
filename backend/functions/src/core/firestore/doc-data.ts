import type { DocumentData, DocumentSnapshot, Timestamp } from 'firebase-admin/firestore';

/**
 * ============================================================================
 * TYPED FIRESTORE DOCUMENT ACCESSORS
 * ============================================================================
 *
 * `DocumentSnapshot.data()` is typed `any`, so every field read off a Firestore
 * document is unchecked by both TypeScript and ESLint. That is the single source of
 * the ~80 `no-unsafe-*` lint errors in this codebase, and more importantly it means a
 * renamed or missing field fails silently at runtime instead of loudly at the boundary.
 *
 * These helpers narrow a value to a concrete type at the point of the read, returning a
 * caller-supplied fallback when the field is absent or the wrong shape. They are
 * deliberately small and boring: no schema registry, no converters to wire up per
 * collection, nothing that has to be adopted everywhere at once. Convert a callable at
 * a time.
 *
 * They are NOT validation - a document that is genuinely malformed should be rejected
 * by a zod schema (see packages/shared/src/schemas). These are for the ordinary case of
 * "read this field, and cope if it isn't there".
 * ============================================================================
 */

/** The raw body of a snapshot, as an unknown-valued record rather than `any`. */
export function docData(
  snapshot: DocumentSnapshot | undefined | null
): Record<string, unknown> {
  if (!snapshot) return {};
  return (snapshot.data() ?? {}) as Record<string, unknown>;
}

/** Treat an untyped Firestore body as an unknown-valued record. */
export function asRecord(data: DocumentData | undefined | null): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

export function getString(
  data: Record<string, unknown>,
  field: string,
  fallback: string
): string;
export function getString(
  data: Record<string, unknown>,
  field: string,
  fallback?: null
): string | null;
export function getString(
  data: Record<string, unknown>,
  field: string,
  fallback: string | null = null
): string | null {
  const value = data[field];
  if (typeof value !== 'string') return fallback;
  return value;
}

/** A string, but empty/whitespace-only counts as absent. */
export function getNonEmptyString(
  data: Record<string, unknown>,
  field: string,
  fallback: string | null = null
): string | null {
  const value = data[field];
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function getNumber(
  data: Record<string, unknown>,
  field: string,
  fallback: number
): number;
export function getNumber(
  data: Record<string, unknown>,
  field: string,
  fallback?: null
): number | null;
export function getNumber(
  data: Record<string, unknown>,
  field: string,
  fallback: number | null = null
): number | null {
  const value = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

export function getBoolean(
  data: Record<string, unknown>,
  field: string,
  fallback: boolean
): boolean {
  const value = data[field];
  return typeof value === 'boolean' ? value : fallback;
}

export function getStringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function isTimestampLike(value: unknown): value is Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  );
}

/** The Firestore Timestamp itself, or null when absent / not a Timestamp. */
export function getTimestamp(
  data: Record<string, unknown>,
  field: string
): Timestamp | null {
  const value = data[field];
  return isTimestampLike(value) ? value : null;
}

/** A Firestore Timestamp as an ISO string, or null when absent/!Timestamp. */
export function getTimestampIso(
  data: Record<string, unknown>,
  field: string
): string | null {
  const value = data[field];
  if (!isTimestampLike(value)) return null;
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

/** A Firestore Timestamp as a Date, or null. */
export function getTimestampDate(data: Record<string, unknown>, field: string): Date | null {
  const value = data[field];
  if (!isTimestampLike(value)) return null;
  try {
    return value.toDate();
  } catch {
    return null;
  }
}
