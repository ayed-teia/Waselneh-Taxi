import { useEffect, useMemo, useState } from 'react';
import {
  subscribeToDrivers,
  DriverDocument,
  upsertDriverEligibility,
} from '../services/drivers.service';
import './DriversListPage.css';

const STALE_THRESHOLD_MS = 10 * 1000;

type ActivityState = 'online' | 'stale' | 'offline';
type VerificationStatus = 'approved' | 'pending' | 'rejected';
type DriverVehicleType = 'taxi_standard' | 'family_van' | 'minibus' | 'premium';

interface DriverWithActivity extends DriverDocument {
  activityState: ActivityState;
  lastSeenAgo: string;
}

interface DriverDraft {
  driverType: string;
  verificationStatus: VerificationStatus;
  lineId: string;
  licenseId: string;
  vehicleType: DriverVehicleType;
  seatCapacity: string;
  note: string;
}

const VEHICLE_TYPE_OPTIONS: DriverVehicleType[] = [
  'taxi_standard',
  'family_van',
  'minibus',
  'premium',
];

function normalizeVehicleType(value: string | null | undefined): DriverVehicleType {
  if (value === 'family_van' || value === 'minibus' || value === 'premium') {
    return value;
  }
  return 'taxi_standard';
}

function parseSeatCapacityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 14) return null;
  return rounded;
}

function computeActivityState(driver: DriverDocument): ActivityState {
  if (driver.status === 'offline') {
    return 'offline';
  }

  if (!driver.lastSeen) {
    return 'stale';
  }

  try {
    const lastSeenDate = driver.lastSeen.toDate
      ? driver.lastSeen.toDate()
      : new Date(driver.lastSeen as any);
    const ageMs = Date.now() - lastSeenDate.getTime();
    return ageMs <= STALE_THRESHOLD_MS ? 'online' : 'stale';
  } catch {
    return 'stale';
  }
}

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

function getStatusBadge(state: ActivityState): { text: string } {
  switch (state) {
    case 'online':
      return { text: 'Online' };
    case 'stale':
      return { text: 'Stale' };
    case 'offline':
      return { text: 'Offline' };
  }
}

function normalizeStatus(value: string | null | undefined): VerificationStatus {
  if (value === 'approved' || value === 'rejected') return value;
  return 'pending';
}

function hasLink(lineId: string, licenseId: string): boolean {
  return lineId.trim().length > 0 || licenseId.trim().length > 0;
}

function computeEligibilityFromDraft(draft: DriverDraft): {
  isEligible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (draft.driverType.trim() !== 'licensed_line_owner') {
    reasons.push('driverType must be licensed_line_owner');
  }
  if (draft.verificationStatus !== 'approved') {
    reasons.push('verificationStatus must be approved');
  }
  if (!hasLink(draft.lineId, draft.licenseId)) {
    reasons.push('lineId or licenseId is required');
  }
  return { isEligible: reasons.length === 0, reasons };
}

function createInitialDraft(driver: DriverDocument): DriverDraft {
  return {
    driverType: driver.driverType || 'licensed_line_owner',
    verificationStatus: normalizeStatus(driver.verificationStatus),
    lineId: driver.lineId || '',
    licenseId: driver.licenseId || '',
    vehicleType: normalizeVehicleType(driver.vehicleType),
    seatCapacity: String(typeof driver.seatCapacity === 'number' ? driver.seatCapacity : 4),
    note: '',
  };
}

export function DriversListPage() {
  const [drivers, setDrivers] = useState<DriverDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DriverDraft>>({});
  const [savingByDriverId, setSavingByDriverId] = useState<Record<string, boolean>>({});
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToDrivers((updatedDrivers) => {
      setDrivers(updatedDrivers);
      setLoading(false);

      setDrafts((current) => {
        const next = { ...current };
        for (const driver of updatedDrivers) {
          if (!next[driver.id]) {
            next[driver.id] = createInitialDraft(driver);
          }
        }
        return next;
      });
    });

    return () => unsubscribe();
  }, []);

  const driversWithActivity: DriverWithActivity[] = useMemo(
    () =>
      drivers.map((driver) => ({
        ...driver,
        activityState: computeActivityState(driver),
        lastSeenAgo: formatRelativeTime(driver.lastSeen),
      })),
    [drivers]
  );

  const onlineCount = driversWithActivity.filter((d) => d.activityState === 'online').length;
  const staleCount = driversWithActivity.filter((d) => d.activityState === 'stale').length;
  const offlineCount = driversWithActivity.filter((d) => d.activityState === 'offline').length;

  const setDraftField = <K extends keyof DriverDraft>(
    driverId: string,
    field: K,
    value: DriverDraft[K]
  ) => {
    setDrafts((current) => ({
      ...current,
      [driverId]: {
        ...(current[driverId] ??
          createInitialDraft({ id: driverId, status: 'offline', lastSeen: null })),
        [field]: value,
      },
    }));
  };

  const persistDriverEligibility = async (
    driverId: string,
    draft: DriverDraft,
    mode: 'save' | 'approve' | 'reject'
  ) => {
    const normalizedDraft: DriverDraft = {
      ...draft,
      verificationStatus:
        mode === 'approve'
          ? 'approved'
          : mode === 'reject'
            ? 'rejected'
            : normalizeStatus(draft.verificationStatus),
      lineId: draft.lineId.trim(),
      licenseId: draft.licenseId.trim(),
      vehicleType: normalizeVehicleType(draft.vehicleType),
      seatCapacity: draft.seatCapacity.trim(),
    };

    const parsedSeatCapacity = parseSeatCapacityInput(normalizedDraft.seatCapacity);
    if (parsedSeatCapacity === null) {
      window.alert('Seat capacity must be a number between 1 and 14.');
      return;
    }

    if (mode === 'approve' && !hasLink(normalizedDraft.lineId, normalizedDraft.licenseId)) {
      window.alert('Approve requires lineId or licenseId.');
      return;
    }

    setSavingByDriverId((current) => ({ ...current, [driverId]: true }));
    setPageError(null);
    try {
      const result = await upsertDriverEligibility({
        driverId,
        driverType: normalizedDraft.driverType.trim(),
        verificationStatus: normalizedDraft.verificationStatus,
        lineId: normalizedDraft.lineId || undefined,
        licenseId: normalizedDraft.licenseId || undefined,
        vehicleType: normalizedDraft.vehicleType,
        seatCapacity: parsedSeatCapacity,
        note: normalizedDraft.note.trim() || undefined,
        forceOfflineIfIneligible: true,
      });

      setDrafts((current) => ({
        ...current,
        [driverId]: normalizedDraft,
      }));

      if (!result.isEligible) {
        console.warn(`[DriverEligibility] ${driverId} not eligible`, result.reasons);
      }
    } catch (error) {
      console.error('Failed to update driver eligibility', error);
      setPageError(error instanceof Error ? error.message : 'Failed to update driver eligibility.');
    } finally {
      setSavingByDriverId((current) => ({ ...current, [driverId]: false }));
    }
  };

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
      <p className="drivers-subtitle">
        Live status, eligibility controls, and profile edits in one place.
      </p>

      <div className="drivers-summary">
        <span className="online-count">{onlineCount} Online</span>
        <span className="stale-count">{staleCount} Stale</span>
        <span className="offline-count">{offlineCount} Offline</span>
      </div>

      {pageError ? <div className="page-error">{pageError}</div> : null}

      {drivers.length === 0 ? (
        <p className="no-drivers">No drivers found. Start the driver app to see updates.</p>
      ) : (
        <div className="drivers-table-wrap">
          <table className="drivers-table">
            <thead>
              <tr>
                <th>Driver ID</th>
                <th>Status</th>
                <th>Coordinates</th>
                <th>Last Seen</th>
                <th>Eligibility</th>
                <th>Driver Type</th>
                <th>Verification</th>
                <th>lineId</th>
                <th>licenseId</th>
                <th>Vehicle</th>
                <th>Seats</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {driversWithActivity.map((driver) => {
                const badge = getStatusBadge(driver.activityState);
                const draft = drafts[driver.id] ?? createInitialDraft(driver);
                const eligibility = computeEligibilityFromDraft(draft);
                const isSaving = savingByDriverId[driver.id] === true;

                return (
                  <tr key={driver.id} className={driver.activityState}>
                    <td className="driver-id">{driver.id}</td>
                    <td className="status">
                      <span className={`status-badge ${driver.activityState}`}>{badge.text}</span>
                    </td>
                    <td className="coord">
                      {driver.location
                        ? `${driver.location.lat.toFixed(5)}, ${driver.location.lng.toFixed(5)}`
                        : 'N/A'}
                    </td>
                    <td className="timestamp">{driver.lastSeenAgo}</td>
                    <td>
                      <span
                        className={`eligibility-badge ${eligibility.isEligible ? 'ok' : 'blocked'}`}
                      >
                        {eligibility.isEligible ? 'Eligible' : 'Blocked'}
                      </span>
                      {!eligibility.isEligible ? (
                        <div className="eligibility-reasons">{eligibility.reasons.join(', ')}</div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="table-input"
                        value={draft.driverType}
                        onChange={(e) => setDraftField(driver.id, 'driverType', e.target.value)}
                        disabled={isSaving}
                      />
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={draft.verificationStatus}
                        onChange={(e) =>
                          setDraftField(
                            driver.id,
                            'verificationStatus',
                            normalizeStatus(e.target.value)
                          )
                        }
                        disabled={isSaving}
                      >
                        <option value="approved">approved</option>
                        <option value="pending">pending</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-input"
                        value={draft.lineId}
                        onChange={(e) => setDraftField(driver.id, 'lineId', e.target.value)}
                        disabled={isSaving}
                        placeholder="line-001"
                      />
                    </td>
                    <td>
                      <input
                        className="table-input"
                        value={draft.licenseId}
                        onChange={(e) => setDraftField(driver.id, 'licenseId', e.target.value)}
                        disabled={isSaving}
                        placeholder="LIC-001"
                      />
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={draft.vehicleType}
                        onChange={(e) =>
                          setDraftField(
                            driver.id,
                            'vehicleType',
                            normalizeVehicleType(e.target.value)
                          )
                        }
                        disabled={isSaving}
                      >
                        {VEHICLE_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-input table-input-sm"
                        value={draft.seatCapacity}
                        onChange={(e) => setDraftField(driver.id, 'seatCapacity', e.target.value)}
                        disabled={isSaving}
                        placeholder="4"
                      />
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn approve"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'approve')}
                          disabled={isSaving}
                        >
                          Approve
                        </button>
                        <button
                          className="action-btn reject"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'reject')}
                          disabled={isSaving}
                        >
                          Reject
                        </button>
                        <button
                          className="action-btn save"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'save')}
                          disabled={isSaving}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
