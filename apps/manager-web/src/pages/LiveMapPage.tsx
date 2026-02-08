import { useEffect, useState, useMemo, useRef } from 'react';
import { subscribeToAllDriverLocations, DriverLiveLocation, getUniqueLineIds } from '../services/driver-location.service';
import { DriverMap } from '../components/DriverMap';
import '../components/DriverMap.css';
import './LiveMapPage.css';

export function LiveMapPage() {
  const [drivers, setDrivers] = useState<DriverLiveLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Filter state
  const [showOnlineOnly, setShowOnlineOnly] = useState(true);
  const [selectedLineId, setSelectedLineId] = useState<string>('all');

  // Track if component is mounted to prevent memory leaks
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const unsubscribe = subscribeToAllDriverLocations(
      (driverLocations) => {
        if (isMounted.current) {
          setDrivers(driverLocations);
          setLoading(false);
          setError(null);
        }
      },
      (err) => {
        if (isMounted.current) {
          console.error('Error subscribing to driver locations:', err);
          setError('Failed to load driver locations. Please check your connection.');
          setLoading(false);
        }
      }
    );

    // Cleanup: unsubscribe and mark as unmounted
    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, []);

  // Get unique line IDs for filter dropdown
  const lineIds = useMemo(() => getUniqueLineIds(drivers), [drivers]);

  // Apply filters
  const filteredDrivers = useMemo(() => {
    return drivers.filter(driver => {
      // Online filter (all drivers in driverLive are online, but keeping for future)
      if (showOnlineOnly && !driver.isOnline) return false;
      
      // Line ID filter
      if (selectedLineId !== 'all' && driver.lineId !== selectedLineId) return false;
      
      return true;
    });
  }, [drivers, showOnlineOnly, selectedLineId]);

  const formatTime = (date: Date | null) => {
    if (!date) return 'N/A';
    return date.toLocaleTimeString();
  };

  const formatRelativeTime = (date: Date | null) => {
    if (!date) return 'N/A';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return formatTime(date);
  };

  const formatSpeed = (speed: number | null) => {
    if (speed === null || speed <= 0) return 'Stationary';
    return `${Math.round(speed * 3.6)} km/h`;
  };

  const getDriverDisplayName = (driver: DriverLiveLocation) => {
    if (driver.name) return driver.name;
    return `Driver ${driver.driverId.slice(0, 8)}`;
  };

  if (loading) {
    return (
      <div className="live-map-page">
        <h2>📍 Live Driver Locations</h2>
        <div className="loading">Loading driver locations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="live-map-page">
        <h2>📍 Live Driver Locations</h2>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="live-map-page">
      <h2>📍 Live Driver Locations</h2>
      
      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{drivers.length}</span>
          <span className="stat-label">Total Online</span>
        </div>
        <div className="stat">
          <span className="stat-value">{filteredDrivers.length}</span>
          <span className="stat-label">Showing</span>
        </div>
        {lineIds.length > 0 && (
          <div className="stat">
            <span className="stat-value">{lineIds.length}</span>
            <span className="stat-label">Lines Active</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showOnlineOnly}
              onChange={(e) => setShowOnlineOnly(e.target.checked)}
            />
            <span>Online Only</span>
          </label>
        </div>

        {lineIds.length > 0 && (
          <div className="filter-group">
            <label>
              <span className="filter-label">Line:</span>
              <select
                value={selectedLineId}
                onChange={(e) => setSelectedLineId(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Lines</option>
                {lineIds.map(lineId => (
                  <option key={lineId} value={lineId}>{lineId}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {filteredDrivers.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🚗</span>
          <p>No drivers match current filters</p>
          {drivers.length > 0 && (
            <button 
              className="reset-filters-btn"
              onClick={() => {
                setShowOnlineOnly(true);
                setSelectedLineId('all');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Live Map with Driver Markers */}
          <div className="map-container">
            <DriverMap drivers={filteredDrivers} />
          </div>

          {/* Driver list */}
          <div className="driver-list">
            <h3>Driver Details ({filteredDrivers.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Line</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Speed</th>
                  <th>Last Update</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrivers.map((driver) => (
                  <tr key={driver.driverId}>
                    <td className="driver-name">
                      <span className="driver-avatar">🚗</span>
                      <div className="driver-info">
                        <span className="name">{getDriverDisplayName(driver)}</span>
                        <span className="driver-id-small">{driver.driverId.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td>
                      {driver.lineId ? (
                        <span className="line-badge">{driver.lineId}</span>
                      ) : (
                        <span className="no-line">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${driver.isOnline ? 'online' : 'offline'}`}>
                        {driver.isOnline ? '● Online' : '○ Offline'}
                      </span>
                    </td>
                    <td className="coordinates">
                      {driver.lat.toFixed(5)}, {driver.lng.toFixed(5)}
                    </td>
                    <td>{formatSpeed(driver.speed)}</td>
                    <td className="last-update">
                      <span className="relative-time">{formatRelativeTime(driver.updatedAt)}</span>
                      <span className="absolute-time">{formatTime(driver.updatedAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
