import { useEffect, useState, useRef } from 'react';
import { subscribeToDrivers, DriverDocument } from '../services/drivers.service';
import './DriversListPage.css';

/**
 * ============================================================================
 * DRIVERS LIST PAGE
 * ============================================================================
 * 
 * Displays realtime list of all drivers with their activity states.
 * 
 * Activity State Logic:
 * - ONLINE: status === "online" AND lastSeen <= 10 seconds ago
 * - STALE:  status === "online" BUT lastSeen > 10 seconds ago
 * - OFFLINE: status === "offline"
 * 
 * ============================================================================
 */

/** Threshold for considering a driver "stale" (10 seconds) */
const STALE_THRESHOLD_MS = 10 * 1000;

/** Activity state types */
type ActivityState = 'online' | 'stale' | 'offline';

/** Driver with computed activity state */
interface DriverWithActivity extends DriverDocument {
  activityState: ActivityState;
  lastSeenAgo: string;
}

/**
 * Compute activity state based on status and lastSeen
 */
function computeActivityState(driver: DriverDocument): ActivityState {
  if (driver.status === 'offline') {
    return 'offline';
  }

  // Status is "online" - check lastSeen
  if (!driver.lastSeen) {
    return 'stale'; // No lastSeen = consider stale
  }

  try {
    const lastSeenDate = driver.lastSeen.toDate ? driver.lastSeen.toDate() : new Date(driver.lastSeen as any);
    const ageMs = Date.now() - lastSeenDate.getTime();
    
    if (ageMs <= STALE_THRESHOLD_MS) {
      return 'online';
    } else {
      return 'stale';
    }
  } catch {
    return 'stale';
  }
}

/**
 * Format lastSeen as relative time ("3s ago", "15s ago")
 */
function formatRelativeTime(timestamp: any): string {
  if (!timestamp) return 'N/A';
  
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const ageMs = Date.now() - date.getTime();
    const ageSec = Math.floor(ageMs / 1000);
    
    if (ageSec < 0) return 'just now';
    if (ageSec < 60) return `${ageSec}s ago`;
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
    return `${Math.floor(ageSec / 3600)}h ago`;
  } catch {
    return 'N/A';
  }
}

/**
 * Get status badge text and emoji
 */
function getStatusBadge(state: ActivityState): { emoji: string; text: string } {
  switch (state) {
    case 'online':
      return { emoji: '🟢', text: 'Online' };
    case 'stale':
      return { emoji: '🟡', text: 'Stale' };
    case 'offline':
      return { emoji: '🔴', text: 'Offline' };
  }
}

export function DriversListPage() {
  const [drivers, setDrivers] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0); // Force re-render for time updates
  
  // Track previous activity states for logging transitions
  const prevStatesRef = useRef<Map<string, ActivityState>>(new Map());

  // Periodic re-render to update relative times and stale detection
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    console.log('📡 [DriversListPage] Setting up realtime subscription...');
    
    const unsubscribe = subscribeToDrivers((updatedDrivers) => {
      setDrivers(updatedDrivers);
      setLoading(false);
    });

    return () => {
      console.log('🔌 [DriversListPage] Cleaning up subscription');
      unsubscribe();
    };
  }, []);

  // Compute activity states and detect transitions
  const driversWithActivity: DriverWithActivity[] = drivers.map(driver => {
    const activityState = computeActivityState(driver);
    const lastSeenAgo = formatRelativeTime(driver.lastSeen);
    
    // Log state transitions
    const prevState = prevStatesRef.current.get(driver.id);
    if (prevState !== undefined && prevState !== activityState) {
      switch (activityState) {
        case 'online':
          console.log(`🟢 Driver ${driver.id} became ONLINE`);
          break;
        case 'stale':
          console.log(`🟡 Driver ${driver.id} became STALE`);
          break;
        case 'offline':
          console.log(`🔴 Driver ${driver.id} became OFFLINE`);
          break;
      }
    }
    prevStatesRef.current.set(driver.id, activityState);
    
    return {
      ...driver,
      activityState,
      lastSeenAgo,
    };
  });

  // Count by activity state
  const onlineCount = driversWithActivity.filter(d => d.activityState === 'online').length;
  const staleCount = driversWithActivity.filter(d => d.activityState === 'stale').length;
  const offlineCount = driversWithActivity.filter(d => d.activityState === 'offline').length;

  if (loading) {
    return (
      <div className="drivers-page">
        <h2>Drivers</h2>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="drivers-page">
      <h2>Drivers ({drivers.length} total)</h2>
      
      <div className="drivers-summary">
        <span className="online-count">🟢 {onlineCount} Online</span>
        <span className="stale-count">🟡 {staleCount} Stale</span>
        <span className="offline-count">🔴 {offlineCount} Offline</span>
      </div>

      {drivers.length === 0 ? (
        <p className="no-drivers">No drivers found. Start the driver app to see updates.</p>
      ) : (
        <table className="drivers-table">
          <thead>
            <tr>
              <th>Driver ID</th>
              <th>Status</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {driversWithActivity.map((driver) => {
              const badge = getStatusBadge(driver.activityState);
              return (
                <tr key={driver.id} className={driver.activityState}>
                  <td className="driver-id">{driver.id}</td>
                  <td className="status">
                    <span className={`status-badge ${driver.activityState}`}>
                      {badge.emoji} {badge.text}
                    </span>
                  </td>
                  <td className="coord">{driver.location?.lat?.toFixed(5) || 'N/A'}</td>
                  <td className="coord">{driver.location?.lng?.toFixed(5) || 'N/A'}</td>
                  <td className="timestamp">{driver.lastSeenAgo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
