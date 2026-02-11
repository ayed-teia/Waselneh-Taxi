import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { subscribeToAllDriverLocations, DriverLiveLocation, getUniqueLineIds } from '../services/driver-location.service';
import { subscribeToActiveTrips, subscribeToPendingTrips, subscribeToCompletedTrips, TripData, getTripStatusDisplay, getPaymentStatusDisplay } from '../services/trips.service';
import { subscribeToRoadblocks, createRoadblock, updateRoadblock, deleteRoadblock, RoadblockData, getRoadblockStatusDisplay } from '../services/roadblocks.service';
import { DriverMap } from '../components/DriverMap';
import '../components/DriverMap.css';
import './LiveMapPage.css';

export function LiveMapPage() {
  const [drivers, setDrivers] = useState<DriverLiveLocation[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripData[]>([]);
  const [pendingTrips, setPendingTrips] = useState<TripData[]>([]);
  const [completedTrips, setCompletedTrips] = useState<TripData[]>([]);
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Filter state
  const [showOnlineOnly, setShowOnlineOnly] = useState(true);
  const [selectedLineId, setSelectedLineId] = useState<string>('all');
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);

  // Roadblock modal state
  const [showRoadblockModal, setShowRoadblockModal] = useState(false);
  const [editingRoadblock, setEditingRoadblock] = useState<RoadblockData | null>(null);
  const [newRoadblockLocation, setNewRoadblockLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [roadblockForm, setRoadblockForm] = useState({
    status: 'closed' as 'open' | 'closed' | 'delay',
    radiusMeters: 100,
    note: '',
  });
  const [isSavingRoadblock, setIsSavingRoadblock] = useState(false);

  // Track if component is mounted to prevent memory leaks
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // Subscribe to driver locations
    const unsubDrivers = subscribeToAllDriverLocations(
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

    // Subscribe to active trips
    const unsubActiveTrips = subscribeToActiveTrips(
      (trips) => {
        if (isMounted.current) {
          setActiveTrips(trips);
        }
      },
      (err) => {
        console.error('Error subscribing to active trips:', err);
      }
    );

    // Subscribe to pending trips
    const unsubPendingTrips = subscribeToPendingTrips(
      (trips) => {
        if (isMounted.current) {
          setPendingTrips(trips);
        }
      },
      (err) => {
        console.error('Error subscribing to pending trips:', err);
      }
    );

    // Subscribe to completed trips
    const unsubCompletedTrips = subscribeToCompletedTrips(
      (trips) => {
        if (isMounted.current) {
          setCompletedTrips(trips);
        }
      },
      (err) => {
        console.error('Error subscribing to completed trips:', err);
      }
    );

    // Subscribe to roadblocks
    const unsubRoadblocks = subscribeToRoadblocks(
      (data) => {
        if (isMounted.current) {
          setRoadblocks(data);
        }
      },
      (err) => {
        console.error('Error subscribing to roadblocks:', err);
      }
    );

    // Cleanup: unsubscribe and mark as unmounted
    return () => {
      isMounted.current = false;
      unsubDrivers();
      unsubActiveTrips();
      unsubPendingTrips();
      unsubCompletedTrips();
      unsubRoadblocks();
    };
  }, []);

  // Get unique line IDs for filter dropdown
  const lineIds = useMemo(() => getUniqueLineIds(drivers), [drivers]);

  // Count drivers by availability
  const driverStats = useMemo(() => {
    const online = drivers.filter(d => d.isOnline).length;
    const available = drivers.filter(d => d.isOnline && d.isAvailable).length;
    const busy = drivers.filter(d => d.isOnline && !d.isAvailable).length;
    return { online, available, busy };
  }, [drivers]);

  // Count unpaid completed trips
  const unpaidTripsCount = useMemo(() => {
    return completedTrips.filter(t => t.paymentStatus === 'pending').length;
  }, [completedTrips]);

  // Filter completed trips based on unpaid filter
  const filteredCompletedTrips = useMemo(() => {
    if (showUnpaidOnly) {
      return completedTrips.filter(t => t.paymentStatus === 'pending');
    }
    return completedTrips;
  }, [completedTrips, showUnpaidOnly]);

  // Count active roadblocks
  const activeRoadblocksCount = useMemo(() => {
    return roadblocks.filter(r => r.status !== 'open').length;
  }, [roadblocks]);

  // Roadblock handlers
  const handleMapClick = useCallback((lat: number, lng: number) => {
    setNewRoadblockLocation({ lat, lng });
    setEditingRoadblock(null);
    setRoadblockForm({ status: 'closed', radiusMeters: 100, note: '' });
    setShowRoadblockModal(true);
  }, []);

  const handleRoadblockClick = useCallback((roadblock: RoadblockData) => {
    setEditingRoadblock(roadblock);
    setNewRoadblockLocation(null);
    setRoadblockForm({
      status: roadblock.status,
      radiusMeters: roadblock.radiusMeters,
      note: roadblock.note || '',
    });
    setShowRoadblockModal(true);
  }, []);

  const handleSaveRoadblock = async () => {
    setIsSavingRoadblock(true);
    try {
      if (editingRoadblock) {
        // Update existing
        await updateRoadblock(editingRoadblock.id, roadblockForm);
      } else if (newRoadblockLocation) {
        // Create new
        await createRoadblock({
          lat: newRoadblockLocation.lat,
          lng: newRoadblockLocation.lng,
          ...roadblockForm,
        });
      }
      setShowRoadblockModal(false);
      setEditingRoadblock(null);
      setNewRoadblockLocation(null);
    } catch (err) {
      console.error('Failed to save roadblock:', err);
      alert('Failed to save roadblock');
    } finally {
      setIsSavingRoadblock(false);
    }
  };

  const handleDeleteRoadblock = async () => {
    if (!editingRoadblock) return;
    if (!confirm('Are you sure you want to delete this roadblock?')) return;
    
    setIsSavingRoadblock(true);
    try {
      await deleteRoadblock(editingRoadblock.id);
      setShowRoadblockModal(false);
      setEditingRoadblock(null);
    } catch (err) {
      console.error('Failed to delete roadblock:', err);
      alert('Failed to delete roadblock');
    } finally {
      setIsSavingRoadblock(false);
    }
  };

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
      <h2>📍 Live Dashboard</h2>
      
      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{driverStats.online}</span>
          <span className="stat-label">🟢 Online</span>
        </div>
        <div className="stat available">
          <span className="stat-value">{driverStats.available}</span>
          <span className="stat-label">✅ Available</span>
        </div>
        <div className="stat busy">
          <span className="stat-value">{driverStats.busy}</span>
          <span className="stat-label">🚗 Busy</span>
        </div>
        <div className="stat trips">
          <span className="stat-value">{activeTrips.length}</span>
          <span className="stat-label">🛣️ Active Trips</span>
        </div>
        {pendingTrips.length > 0 && (
          <div className="stat pending">
            <span className="stat-value">{pendingTrips.length}</span>
            <span className="stat-label">⏳ Pending</span>
          </div>
        )}
        {unpaidTripsCount > 0 && (
          <div className="stat unpaid">
            <span className="stat-value">{unpaidTripsCount}</span>
            <span className="stat-label">💰 Unpaid</span>
          </div>
        )}
        <div className="stat roadblocks">
          <span className="stat-value">{activeRoadblocksCount}</span>
          <span className="stat-label">🚧 Roadblocks</span>
        </div>
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

        <div className="filter-group">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showUnpaidOnly}
              onChange={(e) => setShowUnpaidOnly(e.target.checked)}
            />
            <span>💰 Unpaid Trips Only</span>
          </label>
        </div>
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
          {/* Live Map with Driver Markers, Trips, and Roadblocks */}
          <div className="map-container">
            <div className="map-hint">💡 Click on map to add roadblock</div>
            <DriverMap 
              drivers={filteredDrivers} 
              trips={[...activeTrips, ...pendingTrips]}
              roadblocks={roadblocks}
              onMapClick={handleMapClick}
              onRoadblockClick={handleRoadblockClick}
            />
            {/* Map Legend */}
            <div className="map-legend">
              <div className="legend-title">Legend</div>
              <div className="legend-section">
                <div className="legend-subtitle">Drivers</div>
                <div className="legend-item">
                  <span className="legend-marker driver-available"></span>
                  <span>Available</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker driver-busy"></span>
                  <span>Busy / In Trip</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker driver-offline"></span>
                  <span>Offline</span>
                </div>
              </div>
              <div className="legend-section">
                <div className="legend-subtitle">Roadblocks</div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-open"></span>
                  <span>Open</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-congested"></span>
                  <span>Congested</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-closed"></span>
                  <span>Closed</span>
                </div>
              </div>
              <div className="legend-section">
                <div className="legend-subtitle">Trips</div>
                <div className="legend-item">
                  <span className="legend-icon">📍</span>
                  <span>Pickup</span>
                </div>
                <div className="legend-item">
                  <span className="legend-icon">🎯</span>
                  <span>Dropoff</span>
                </div>
              </div>
            </div>
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
                  <th>Availability</th>
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
                    <td>
                      <span className={`status-badge ${driver.isAvailable ? 'available' : 'busy'}`}>
                        {driver.isAvailable ? '✅ Available' : '🚗 Busy'}
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

          {/* Active Trips */}
          {activeTrips.length > 0 && (
            <div className="trips-list">
              <h3>🛣️ Active Trips ({activeTrips.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th>Trip ID</th>
                    <th>Status</th>
                    <th>Driver</th>
                    <th>Price</th>
                    <th>Distance</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTrips.map((trip) => {
                    const statusDisplay = getTripStatusDisplay(trip.status);
                    return (
                      <tr key={trip.tripId}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>
                          <span className="trip-status" style={{ color: statusDisplay.color }}>
                            {statusDisplay.emoji} {statusDisplay.label}
                          </span>
                        </td>
                        <td>{trip.driverId?.slice(0, 8) ?? '—'}</td>
                        <td>₪{trip.estimatedPriceIls}</td>
                        <td>{trip.estimatedDistanceKm.toFixed(1)} km</td>
                        <td>{formatRelativeTime(trip.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending/Unmatched Trips */}
          {pendingTrips.length > 0 && (
            <div className="trips-list pending-trips">
              <h3>⏳ Pending Requests ({pendingTrips.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th>Trip ID</th>
                    <th>Status</th>
                    <th>Assigned Driver</th>
                    <th>Price</th>
                    <th>Waiting Since</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTrips.map((trip) => {
                    const statusDisplay = getTripStatusDisplay(trip.status);
                    return (
                      <tr key={trip.tripId}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>
                          <span className="trip-status" style={{ color: statusDisplay.color }}>
                            {statusDisplay.emoji} {statusDisplay.label}
                          </span>
                        </td>
                        <td>{trip.driverId?.slice(0, 8) ?? '—'}</td>
                        <td>₪{trip.estimatedPriceIls}</td>
                        <td>{formatRelativeTime(trip.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Completed Trips (with payment status) */}
          {filteredCompletedTrips.length > 0 && (
            <div className="trips-list completed-trips">
              <h3>
                ✅ Completed Trips ({filteredCompletedTrips.length})
                {showUnpaidOnly && <span className="filter-active"> — Unpaid Only</span>}
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Trip ID</th>
                    <th>Driver</th>
                    <th>Fare</th>
                    <th>Payment</th>
                    <th>Completed</th>
                    <th>Paid At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompletedTrips.map((trip) => {
                    const paymentDisplay = getPaymentStatusDisplay(trip.paymentStatus);
                    return (
                      <tr key={trip.tripId} className={trip.paymentStatus === 'pending' ? 'unpaid-row' : ''}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>{trip.driverId?.slice(0, 8) ?? '—'}</td>
                        <td className="fare-amount">₪{trip.fareAmount}</td>
                        <td>
                          <span className="payment-status" style={{ color: paymentDisplay.color }}>
                            {paymentDisplay.emoji} {paymentDisplay.label}
                          </span>
                        </td>
                        <td>{formatRelativeTime(trip.completedAt)}</td>
                        <td>{trip.paidAt ? formatRelativeTime(trip.paidAt) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Roadblocks List */}
          {roadblocks.length > 0 && (
            <div className="roadblocks-list">
              <h3>🚧 Roadblocks ({roadblocks.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Radius</th>
                    <th>Note</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roadblocks.map((roadblock) => {
                    const statusDisplay = getRoadblockStatusDisplay(roadblock.status);
                    return (
                      <tr key={roadblock.id} className={`roadblock-row ${roadblock.status}`}>
                        <td>
                          <span className="roadblock-status" style={{ color: statusDisplay.color }}>
                            {statusDisplay.emoji} {statusDisplay.label}
                          </span>
                        </td>
                        <td className="coordinates">
                          {roadblock.lat.toFixed(5)}, {roadblock.lng.toFixed(5)}
                        </td>
                        <td>{roadblock.radiusMeters}m</td>
                        <td className="note-cell">{roadblock.note || '—'}</td>
                        <td>{formatRelativeTime(roadblock.updatedAt)}</td>
                        <td>
                          <button 
                            className="action-btn edit"
                            onClick={() => handleRoadblockClick(roadblock)}
                          >
                            ✏️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Roadblock Modal */}
      {showRoadblockModal && (
        <div className="modal-overlay" onClick={() => setShowRoadblockModal(false)}>
          <div className="modal-content roadblock-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRoadblock ? '✏️ Edit Roadblock' : '🚧 Add Roadblock'}</h3>
            
            <div className="form-group">
              <label>Status</label>
              <select
                value={roadblockForm.status}
                onChange={(e) => setRoadblockForm(f => ({ ...f, status: e.target.value as 'open' | 'closed' | 'delay' }))}
              >
                <option value="closed">🚫 Closed</option>
                <option value="delay">⚠️ Delay</option>
                <option value="open">✅ Open (Cleared)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Radius (meters)</label>
              <input
                type="number"
                value={roadblockForm.radiusMeters}
                onChange={(e) => setRoadblockForm(f => ({ ...f, radiusMeters: parseInt(e.target.value) || 100 }))}
                min={10}
                max={1000}
              />
            </div>

            <div className="form-group">
              <label>Note</label>
              <textarea
                value={roadblockForm.note}
                onChange={(e) => setRoadblockForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Optional description..."
                rows={3}
              />
            </div>

            {(editingRoadblock || newRoadblockLocation) && (
              <div className="form-group location-display">
                <label>Location</label>
                <span className="location-coords">
                  {(editingRoadblock?.lat ?? newRoadblockLocation?.lat)?.toFixed(5)}, 
                  {(editingRoadblock?.lng ?? newRoadblockLocation?.lng)?.toFixed(5)}
                </span>
              </div>
            )}

            <div className="modal-actions">
              {editingRoadblock && (
                <button 
                  className="btn-delete"
                  onClick={handleDeleteRoadblock}
                  disabled={isSavingRoadblock}
                >
                  🗑️ Delete
                </button>
              )}
              <button 
                className="btn-cancel"
                onClick={() => setShowRoadblockModal(false)}
                disabled={isSavingRoadblock}
              >
                Cancel
              </button>
              <button 
                className="btn-save"
                onClick={handleSaveRoadblock}
                disabled={isSavingRoadblock}
              >
                {isSavingRoadblock ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
