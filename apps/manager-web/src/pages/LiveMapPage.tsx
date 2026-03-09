import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DriverMap } from '../components/DriverMap';
import '../components/DriverMap.css';
import { useI18n } from '../localization';
import {
  DriverLiveLocation,
  getUniqueLineIds,
  subscribeToAllDriverLocations,
} from '../services/driver-location.service';
import { RoadblockData, createRoadblock, deleteRoadblock, subscribeToRoadblocks, updateRoadblock } from '../services/roadblocks.service';
import { TripData, subscribeToActiveTrips, subscribeToCompletedTrips, subscribeToPendingTrips } from '../services/trips.service';
import './LiveMapPage.css';

type RoadblockStatus = 'open' | 'closed' | 'congested';

const TRIP_STATUS_META: Record<
  string,
  { ar: string; en: string; color: string }
> = {
  pending: { ar: 'بانتظار سائق', en: 'Waiting for driver', color: '#D97706' },
  accepted: { ar: 'تم التعيين', en: 'Assigned', color: '#2563EB' },
  driver_arrived: { ar: 'السائق وصل', en: 'Driver arrived', color: '#7C3AED' },
  in_progress: { ar: 'الرحلة جارية', en: 'In progress', color: '#16A34A' },
  completed: { ar: 'مكتملة', en: 'Completed', color: '#475569' },
  no_driver_available: { ar: 'لا يوجد سائق', en: 'No driver available', color: '#DC2626' },
  cancelled_by_passenger: { ar: 'ألغاه الراكب', en: 'Cancelled by passenger', color: '#DC2626' },
  cancelled_by_driver: { ar: 'ألغاه السائق', en: 'Cancelled by driver', color: '#DC2626' },
};

const PAYMENT_STATUS_META: Record<string, { ar: string; en: string; color: string }> = {
  pending: { ar: 'غير مدفوع', en: 'Unpaid', color: '#D97706' },
  paid: { ar: 'مدفوع', en: 'Paid', color: '#16A34A' },
};

const ROADBLOCK_STATUS_META: Record<RoadblockStatus, { ar: string; en: string; color: string }> = {
  open: { ar: 'مفتوح', en: 'Open', color: '#16A34A' },
  congested: { ar: 'مزدحم', en: 'Congested', color: '#D97706' },
  closed: { ar: 'مغلق', en: 'Closed', color: '#DC2626' },
};

function statusMeta(
  status: string,
  map: Record<string, { ar: string; en: string; color: string }>
) {
  return map[status] ?? { ar: status, en: status, color: '#64748B' };
}

export function LiveMapPage() {
  const { txt, locale } = useI18n();
  const [drivers, setDrivers] = useState<DriverLiveLocation[]>([]);
  const [activeTrips, setActiveTrips] = useState<TripData[]>([]);
  const [pendingTrips, setPendingTrips] = useState<TripData[]>([]);
  const [completedTrips, setCompletedTrips] = useState<TripData[]>([]);
  const [roadblocks, setRoadblocks] = useState<RoadblockData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showOnlineOnly, setShowOnlineOnly] = useState(true);
  const [selectedLineId, setSelectedLineId] = useState<string>('all');
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);

  const [showRoadblockModal, setShowRoadblockModal] = useState(false);
  const [editingRoadblock, setEditingRoadblock] = useState<RoadblockData | null>(null);
  const [newRoadblockLocation, setNewRoadblockLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [roadblockForm, setRoadblockForm] = useState({
    name: '',
    status: 'closed' as RoadblockStatus,
    radiusMeters: 100,
    note: '',
  });
  const [isSavingRoadblock, setIsSavingRoadblock] = useState(false);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    const unsubDrivers = subscribeToAllDriverLocations(
      (driverLocations) => {
        if (!isMounted.current) return;
        setDrivers(driverLocations);
        setLoading(false);
        setError(null);
      },
      (err) => {
        if (!isMounted.current) return;
        console.error('Error subscribing to driver locations:', err);
        setError(
          txt(
            'تعذّر تحميل مواقع السائقين. يرجى التحقق من الاتصال.',
            'Failed to load driver locations. Please check your connection.'
          )
        );
        setLoading(false);
      }
    );

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

    return () => {
      isMounted.current = false;
      unsubDrivers();
      unsubActiveTrips();
      unsubPendingTrips();
      unsubCompletedTrips();
      unsubRoadblocks();
    };
  }, [txt]);

  const lineIds = useMemo(() => getUniqueLineIds(drivers), [drivers]);

  const driverStats = useMemo(() => {
    const online = drivers.filter((d) => d.isOnline).length;
    const available = drivers.filter((d) => d.isOnline && d.isAvailable).length;
    const busy = drivers.filter((d) => d.isOnline && !d.isAvailable).length;
    return { online, available, busy };
  }, [drivers]);

  const unpaidTripsCount = useMemo(
    () => completedTrips.filter((trip) => trip.paymentStatus === 'pending').length,
    [completedTrips]
  );

  const filteredCompletedTrips = useMemo(() => {
    if (showUnpaidOnly) {
      return completedTrips.filter((trip) => trip.paymentStatus === 'pending');
    }
    return completedTrips;
  }, [completedTrips, showUnpaidOnly]);

  const activeRoadblocksCount = useMemo(
    () => roadblocks.filter((roadblock) => roadblock.status !== 'open').length,
    [roadblocks]
  );

  const filteredDrivers = useMemo(
    () =>
      drivers.filter((driver) => {
        if (showOnlineOnly && !driver.isOnline) return false;
        if (selectedLineId !== 'all' && driver.lineId !== selectedLineId) return false;
        return true;
      }),
    [drivers, selectedLineId, showOnlineOnly]
  );

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setNewRoadblockLocation({ lat, lng });
    setEditingRoadblock(null);
    setRoadblockForm({ name: '', status: 'closed', radiusMeters: 100, note: '' });
    setShowRoadblockModal(true);
  }, []);

  const handleRoadblockClick = useCallback((roadblock: RoadblockData) => {
    setEditingRoadblock(roadblock);
    setNewRoadblockLocation(null);
    setRoadblockForm({
      name: roadblock.name || '',
      status: roadblock.status,
      radiusMeters: roadblock.radiusMeters,
      note: roadblock.note || '',
    });
    setShowRoadblockModal(true);
  }, []);

  const handleSaveRoadblock = async () => {
    if (!roadblockForm.name.trim()) {
      window.alert(txt('يرجى إدخال اسم للإغلاق.', 'Please enter a name for the roadblock.'));
      return;
    }

    setIsSavingRoadblock(true);
    try {
      if (editingRoadblock) {
        await updateRoadblock(editingRoadblock.id, roadblockForm);
      } else if (newRoadblockLocation) {
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
      window.alert(txt('تعذّر حفظ الإغلاق.', 'Failed to save roadblock.'));
    } finally {
      setIsSavingRoadblock(false);
    }
  };

  const handleDeleteRoadblock = async () => {
    if (!editingRoadblock) return;
    if (
      !window.confirm(
        txt('هل أنت متأكد من حذف هذا الإغلاق؟', 'Are you sure you want to delete this roadblock?')
      )
    ) {
      return;
    }

    setIsSavingRoadblock(true);
    try {
      await deleteRoadblock(editingRoadblock.id);
      setShowRoadblockModal(false);
      setEditingRoadblock(null);
    } catch (err) {
      console.error('Failed to delete roadblock:', err);
      window.alert(txt('تعذّر حذف الإغلاق.', 'Failed to delete roadblock.'));
    } finally {
      setIsSavingRoadblock(false);
    }
  };

  const formatTime = (date: Date | null) => {
    if (!date) return txt('غير متوفر', 'N/A');
    return date.toLocaleTimeString(locale === 'ar' ? 'ar-PS' : 'en-US');
  };

  const formatRelativeTime = (date: Date | null) => {
    if (!date) return txt('غير متوفر', 'N/A');
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return txt('الآن', 'Just now');
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return formatTime(date);
  };

  const formatSpeed = (speed: number | null) => {
    if (speed === null || speed <= 0) return txt('متوقف', 'Stationary');
    return `${Math.round(speed * 3.6)} km/h`;
  };

  const getDriverDisplayName = (driver: DriverLiveLocation) => {
    if (driver.name) return driver.name;
    return txt(`سائق ${driver.driverId.slice(0, 8)}`, `Driver ${driver.driverId.slice(0, 8)}`);
  };

  if (loading) {
    return (
      <div className="live-map-page">
        <h2>{txt('خريطة العمليات المباشرة', 'Live Operations Map')}</h2>
        <p className="subtitle">
          {txt(
            'متابعة السائقين وتدفق الرحلات وحالة الطرق بشكل لحظي.',
            'Track drivers, trip flow, and road conditions in realtime.'
          )}
        </p>
        <div className="loading">{txt('جاري تحميل مواقع السائقين...', 'Loading driver locations...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="live-map-page">
        <h2>{txt('خريطة العمليات المباشرة', 'Live Operations Map')}</h2>
        <p className="subtitle">
          {txt(
            'متابعة السائقين وتدفق الرحلات وحالة الطرق بشكل لحظي.',
            'Track drivers, trip flow, and road conditions in realtime.'
          )}
        </p>
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="live-map-page">
      <h2>{txt('خريطة العمليات المباشرة', 'Live Operations Map')}</h2>
      <p className="subtitle">
        {txt(
          'متابعة السائقين وتدفق الرحلات وحالة الطرق بشكل لحظي.',
          'Track drivers, trip flow, and road conditions in realtime.'
        )}
      </p>

      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{driverStats.online}</span>
          <span className="stat-label">{txt('سائقون متصلون', 'Online drivers')}</span>
        </div>
        <div className="stat available">
          <span className="stat-value">{driverStats.available}</span>
          <span className="stat-label">{txt('متاحون الآن', 'Available now')}</span>
        </div>
        <div className="stat busy">
          <span className="stat-value">{driverStats.busy}</span>
          <span className="stat-label">{txt('قيد رحلة', 'Busy')}</span>
        </div>
        <div className="stat trips">
          <span className="stat-value">{activeTrips.length}</span>
          <span className="stat-label">{txt('رحلات نشطة', 'Active trips')}</span>
        </div>
        {pendingTrips.length > 0 ? (
          <div className="stat pending">
            <span className="stat-value">{pendingTrips.length}</span>
            <span className="stat-label">{txt('طلبات معلقة', 'Pending requests')}</span>
          </div>
        ) : null}
        {unpaidTripsCount > 0 ? (
          <div className="stat unpaid">
            <span className="stat-value">{unpaidTripsCount}</span>
            <span className="stat-label">{txt('رحلات غير مدفوعة', 'Unpaid trips')}</span>
          </div>
        ) : null}
        <div className="stat roadblocks">
          <span className="stat-value">{activeRoadblocksCount}</span>
          <span className="stat-label">{txt('إغلاقات فعالة', 'Active roadblocks')}</span>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showOnlineOnly}
              onChange={(event) => setShowOnlineOnly(event.target.checked)}
            />
            <span>{txt('إظهار المتصلين فقط', 'Online only')}</span>
          </label>
        </div>

        {lineIds.length > 0 ? (
          <div className="filter-group">
            <label>
              <span className="filter-label">{txt('الخط', 'Line')}:</span>
              <select
                value={selectedLineId}
                onChange={(event) => setSelectedLineId(event.target.value)}
                className="filter-select"
              >
                <option value="all">{txt('كل الخطوط', 'All lines')}</option>
                {lineIds.map((lineId) => (
                  <option key={lineId} value={lineId}>
                    {lineId}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="filter-group">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showUnpaidOnly}
              onChange={(event) => setShowUnpaidOnly(event.target.checked)}
            />
            <span>{txt('غير المدفوع فقط', 'Unpaid only')}</span>
          </label>
        </div>
      </div>

      {filteredDrivers.length === 0 ? (
        <div className="empty-state">
          <p>{txt('لا يوجد سائقون مطابقون للفلاتر الحالية.', 'No drivers match current filters.')}</p>
          {drivers.length > 0 ? (
            <button
              className="reset-filters-btn"
              onClick={() => {
                setShowOnlineOnly(true);
                setSelectedLineId('all');
              }}
            >
              {txt('إعادة ضبط الفلاتر', 'Reset filters')}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="map-container">
            <div className="map-hint">{txt('انقر على الخريطة لإضافة إغلاق.', 'Click on map to add roadblock.')}</div>
            <DriverMap
              drivers={filteredDrivers}
              trips={[...activeTrips, ...pendingTrips]}
              roadblocks={roadblocks}
              onMapClick={handleMapClick}
              onRoadblockClick={handleRoadblockClick}
            />

            <div className="map-legend">
              <div className="legend-title">{txt('الدليل', 'Legend')}</div>
              <div className="legend-section">
                <div className="legend-subtitle">{txt('السائقون', 'Drivers')}</div>
                <div className="legend-item">
                  <span className="legend-marker driver-available" />
                  <span>{txt('متاح', 'Available')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker driver-busy" />
                  <span>{txt('مشغول', 'Busy')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker driver-offline" />
                  <span>{txt('غير متصل', 'Offline')}</span>
                </div>
              </div>
              <div className="legend-section">
                <div className="legend-subtitle">{txt('الطرق', 'Roadblocks')}</div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-open" />
                  <span>{txt('مفتوح', 'Open')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-congested" />
                  <span>{txt('مزدحم', 'Congested')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-marker roadblock-closed" />
                  <span>{txt('مغلق', 'Closed')}</span>
                </div>
              </div>
              <div className="legend-section">
                <div className="legend-subtitle">{txt('الرحلات', 'Trips')}</div>
                <div className="legend-item">
                  <span className="legend-icon">P</span>
                  <span>{txt('نقطة الالتقاط', 'Pickup')}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-icon">D</span>
                  <span>{txt('الوجهة', 'Dropoff')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="driver-list">
            <h3>
              {txt('تفاصيل السائقين', 'Driver details')} ({filteredDrivers.length})
            </h3>
            <table>
              <thead>
                <tr>
                  <th>{txt('السائق', 'Driver')}</th>
                  <th>{txt('الخط', 'Line')}</th>
                  <th>{txt('الحالة', 'Status')}</th>
                  <th>{txt('التوفر', 'Availability')}</th>
                  <th>{txt('الموقع', 'Location')}</th>
                  <th>{txt('السرعة', 'Speed')}</th>
                  <th>{txt('آخر تحديث', 'Last update')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrivers.map((driver) => (
                  <tr key={driver.driverId}>
                    <td className="driver-name">
                      <div className="driver-info">
                        <span className="name">{getDriverDisplayName(driver)}</span>
                        <span className="driver-id-small">{driver.driverId.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td>
                      {driver.lineId ? <span className="line-badge">{driver.lineId}</span> : <span className="no-line">—</span>}
                    </td>
                    <td>
                      <span className={`status-badge ${driver.isOnline ? 'online' : 'offline'}`}>
                        {driver.isOnline ? txt('متصل', 'Online') : txt('غير متصل', 'Offline')}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${driver.isAvailable ? 'available' : 'busy'}`}>
                        {driver.isAvailable ? txt('متاح', 'Available') : txt('مشغول', 'Busy')}
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

          {activeTrips.length > 0 ? (
            <div className="trips-list">
              <h3>
                {txt('الرحلات النشطة', 'Active trips')} ({activeTrips.length})
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>{txt('الرحلة', 'Trip')}</th>
                    <th>{txt('الحالة', 'Status')}</th>
                    <th>{txt('السائق', 'Driver')}</th>
                    <th>{txt('السعر', 'Fare')}</th>
                    <th>{txt('المسافة', 'Distance')}</th>
                    <th>{txt('الإنشاء', 'Created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTrips.map((trip) => {
                    const meta = statusMeta(trip.status, TRIP_STATUS_META);
                    return (
                      <tr key={trip.tripId}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>
                          <span className="trip-status" style={{ color: meta.color }}>
                            {txt(meta.ar, meta.en)}
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
          ) : null}

          {pendingTrips.length > 0 ? (
            <div className="trips-list pending-trips">
              <h3>
                {txt('الطلبات المعلقة', 'Pending requests')} ({pendingTrips.length})
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>{txt('الرحلة', 'Trip')}</th>
                    <th>{txt('الحالة', 'Status')}</th>
                    <th>{txt('السائق المعين', 'Assigned driver')}</th>
                    <th>{txt('السعر', 'Fare')}</th>
                    <th>{txt('زمن الانتظار', 'Waiting')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTrips.map((trip) => {
                    const meta = statusMeta(trip.status, TRIP_STATUS_META);
                    return (
                      <tr key={trip.tripId}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>
                          <span className="trip-status" style={{ color: meta.color }}>
                            {txt(meta.ar, meta.en)}
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
          ) : null}

          {filteredCompletedTrips.length > 0 ? (
            <div className="trips-list completed-trips">
              <h3>
                {txt('الرحلات المكتملة', 'Completed trips')} ({filteredCompletedTrips.length})
                {showUnpaidOnly ? (
                  <span className="filter-active">
                    {' '}
                    — {txt('غير المدفوعة فقط', 'Unpaid only')}
                  </span>
                ) : null}
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>{txt('الرحلة', 'Trip')}</th>
                    <th>{txt('السائق', 'Driver')}</th>
                    <th>{txt('الأجرة', 'Fare')}</th>
                    <th>{txt('الدفع', 'Payment')}</th>
                    <th>{txt('وقت الإكمال', 'Completed')}</th>
                    <th>{txt('وقت الدفع', 'Paid at')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompletedTrips.map((trip) => {
                    const paymentMeta = statusMeta(trip.paymentStatus, PAYMENT_STATUS_META);
                    return (
                      <tr key={trip.tripId} className={trip.paymentStatus === 'pending' ? 'unpaid-row' : ''}>
                        <td className="trip-id">{trip.tripId.slice(0, 8)}...</td>
                        <td>{trip.driverId?.slice(0, 8) ?? '—'}</td>
                        <td className="fare-amount">₪{trip.fareAmount}</td>
                        <td>
                          <span className="payment-status" style={{ color: paymentMeta.color }}>
                            {txt(paymentMeta.ar, paymentMeta.en)}
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
          ) : null}

          {roadblocks.length > 0 ? (
            <div className="roadblocks-list">
              <h3>
                {txt('الإغلاقات', 'Roadblocks')} ({roadblocks.length})
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>{txt('الحالة', 'Status')}</th>
                    <th>{txt('الموقع', 'Location')}</th>
                    <th>{txt('النطاق', 'Radius')}</th>
                    <th>{txt('ملاحظة', 'Note')}</th>
                    <th>{txt('التحديث', 'Updated')}</th>
                    <th>{txt('إجراءات', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {roadblocks.map((roadblock) => {
                    const meta = statusMeta(roadblock.status, ROADBLOCK_STATUS_META);
                    return (
                      <tr key={roadblock.id} className={`roadblock-row ${roadblock.status}`}>
                        <td>
                          <span className="roadblock-status" style={{ color: meta.color }}>
                            {txt(meta.ar, meta.en)}
                          </span>
                        </td>
                        <td className="coordinates">
                          {roadblock.lat.toFixed(5)}, {roadblock.lng.toFixed(5)}
                        </td>
                        <td>{roadblock.radiusMeters}m</td>
                        <td className="note-cell">{roadblock.note || '—'}</td>
                        <td>{formatRelativeTime(roadblock.updatedAt)}</td>
                        <td>
                          <button className="action-btn edit" onClick={() => handleRoadblockClick(roadblock)}>
                            {txt('تعديل', 'Edit')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

      {showRoadblockModal ? (
        <div className="modal-overlay" onClick={() => setShowRoadblockModal(false)}>
          <div className="modal-content roadblock-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{editingRoadblock ? txt('تعديل إغلاق', 'Edit roadblock') : txt('إضافة إغلاق', 'Add roadblock')}</h3>

            <div className="form-group">
              <label>{txt('الاسم', 'Name')}</label>
              <input
                type="text"
                value={roadblockForm.name}
                onChange={(event) => setRoadblockForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={txt('مثال: حاجز قلنديا', 'Example: Qalandia checkpoint')}
                required
              />
            </div>

            <div className="form-group">
              <label>{txt('الحالة', 'Status')}</label>
              <select
                value={roadblockForm.status}
                onChange={(event) =>
                  setRoadblockForm((current) => ({
                    ...current,
                    status: event.target.value as RoadblockStatus,
                  }))
                }
              >
                <option value="closed">{txt('مغلق', 'Closed')}</option>
                <option value="congested">{txt('مزدحم', 'Congested')}</option>
                <option value="open">{txt('مفتوح', 'Open')}</option>
              </select>
            </div>

            <div className="form-group">
              <label>{txt('النطاق (متر)', 'Radius (meters)')}</label>
              <input
                type="number"
                value={roadblockForm.radiusMeters}
                onChange={(event) =>
                  setRoadblockForm((current) => ({
                    ...current,
                    radiusMeters: Number.parseInt(event.target.value, 10) || 100,
                  }))
                }
                min={10}
                max={1000}
              />
            </div>

            <div className="form-group">
              <label>{txt('ملاحظة', 'Note')}</label>
              <textarea
                value={roadblockForm.note}
                onChange={(event) => setRoadblockForm((current) => ({ ...current, note: event.target.value }))}
                placeholder={txt('وصف اختياري لفرق التشغيل...', 'Optional note for operations...')}
                rows={3}
              />
            </div>

            {(editingRoadblock || newRoadblockLocation) ? (
              <div className="form-group location-display">
                <label>{txt('الموقع', 'Location')}</label>
                <span className="location-coords">
                  {(editingRoadblock?.lat ?? newRoadblockLocation?.lat)?.toFixed(5)},{' '}
                  {(editingRoadblock?.lng ?? newRoadblockLocation?.lng)?.toFixed(5)}
                </span>
              </div>
            ) : null}

            <div className="modal-actions">
              {editingRoadblock ? (
                <button className="btn-delete" onClick={handleDeleteRoadblock} disabled={isSavingRoadblock}>
                  {txt('حذف', 'Delete')}
                </button>
              ) : null}
              <button
                className="btn-cancel"
                onClick={() => setShowRoadblockModal(false)}
                disabled={isSavingRoadblock}
              >
                {txt('إلغاء', 'Cancel')}
              </button>
              <button className="btn-save" onClick={handleSaveRoadblock} disabled={isSavingRoadblock}>
                {isSavingRoadblock ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ', 'Save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
