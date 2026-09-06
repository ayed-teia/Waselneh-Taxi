/**
 * ============================================================================
 * SYSTEM CONFIGURATION - Runtime Config from Firestore
 * ============================================================================
 * 
 * Step 32: Pilot Hardening & Kill Switches
 * Step 33: Go-Live Mode - Feature Flags
 * 
 * Reads runtime configuration from Firestore document:
 *   system/config
 * 
 * Provides:
 * - tripsEnabled: Global kill switch for trip creation
 * - roadblocksEnabled: Toggle roadblocks/station management
 * - paymentsEnabled: Toggle payment features (off for pilot)
 * 
 * ============================================================================
 */

import { getFirestore } from './firebase.config';
import { logger } from '../logger';
import { docData, getBoolean, getNonEmptyString, getTimestamp } from '../firestore/doc-data';

/**
 * System configuration interface
 */
export interface SystemConfig {
  /** Global kill switch - if false, reject all new trip requests */
  tripsEnabled: boolean;
  /** Roadblocks/station management feature flag */
  roadblocksEnabled: boolean;
  /** Payments feature flag (disabled for pilot unless required) */
  paymentsEnabled: boolean;
  /** Timestamp of last update */
  updatedAt?: FirebaseFirestore.Timestamp;
  /** Who last updated the config */
  updatedBy?: string;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: SystemConfig = {
  tripsEnabled: true,
  roadblocksEnabled: true,
  paymentsEnabled: false, // Off by default for pilot safety
};

/**
 * Cache for system config to avoid repeated reads
 */
let configCache: SystemConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 10000; // 10 seconds

/**
 * Get system configuration from Firestore
 * Uses caching to avoid excessive reads
 */
export async function getSystemConfig(): Promise<SystemConfig> {
  const now = Date.now();
  
  // Return cached value if still valid
  if (configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return configCache;
  }

  try {
    const db = getFirestore();
    const configDoc = await db.collection('system').doc('config').get();
    
    if (!configDoc.exists) {
      // Initialize with defaults if not exists
      await db.collection('system').doc('config').set({
        ...DEFAULT_CONFIG,
        createdAt: new Date(),
      });
      configCache = DEFAULT_CONFIG;
    } else {
      const data = docData(configDoc);
      const updatedAt = getTimestamp(data, 'updatedAt');
      const updatedBy = getNonEmptyString(data, 'updatedBy');
      configCache = {
        tripsEnabled: getBoolean(data, 'tripsEnabled', DEFAULT_CONFIG.tripsEnabled),
        roadblocksEnabled: getBoolean(
          data,
          'roadblocksEnabled',
          DEFAULT_CONFIG.roadblocksEnabled
        ),
        paymentsEnabled: getBoolean(data, 'paymentsEnabled', DEFAULT_CONFIG.paymentsEnabled),
        // exactOptionalPropertyTypes is on, so an absent optional field must be
        // OMITTED rather than set to undefined.
        ...(updatedAt ? { updatedAt } : {}),
        ...(updatedBy ? { updatedBy } : {}),
      };
    }
    
    cacheTimestamp = now;
    return configCache;
  } catch (error) {
    logger.error('Failed to read system config', { error });
    // Return defaults on error to avoid blocking the system
    return DEFAULT_CONFIG;
  }
}

/**
 * Check if trips are currently enabled
 * @returns true if trips can be created, false otherwise
 */
export async function areTripsEnabled(): Promise<boolean> {
  const config = await getSystemConfig();
  return config.tripsEnabled;
}

/**
 * Invalidate the config cache
 * Call this when config is updated
 */
export function invalidateConfigCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}
