import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../localization';
import {
  DriverDocument,
  subscribeToDrivers,
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
  fullName: string;
  nationalId: string;
  phone: string;
  officeId: string;
  lineNumber: string;
  routePath: string;
  routeName: string;
  routeCities: string;
  photoUrl: string;
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

function normalizeStatus(value: string | null | undefined): VerificationStatus {
  if (value === 'approved' || value === 'rejected') return value;
  return 'pending';
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

function parseRouteCitiesInput(raw: string): string[] | undefined {
  const normalized = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
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

function formatRelativeTime(
  timestamp: any,
  txt: (ar: string, en: string) => string
): string {
  if (!timestamp) return txt('غير متوفر', 'N/A');

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const ageMs = Date.now() - date.getTime();
    const ageSec = Math.floor(ageMs / 1000);

    if (ageSec < 0) return txt('الآن', 'just now');
    if (ageSec < 60) return `${ageSec}s ago`;
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
    return `${Math.floor(ageSec / 3600)}h ago`;
  } catch {
    return txt('غير متوفر', 'N/A');
  }
}

function getStatusBadge(
  state: ActivityState,
  txt: (ar: string, en: string) => string
): { text: string } {
  switch (state) {
    case 'online':
      return { text: txt('متصل', 'Online') };
    case 'stale':
      return { text: txt('غير محدث', 'Stale') };
    case 'offline':
      return { text: txt('غير متصل', 'Offline') };
  }
}

function hasLineOrLicenseLink(lineId: string, licenseId: string): boolean {
  return lineId.trim().length > 0 || licenseId.trim().length > 0;
}

function isProfileCompleteForApproval(draft: DriverDraft): boolean {
  return (
    draft.fullName.trim().length > 0 &&
    draft.nationalId.trim().length > 0 &&
    draft.phone.trim().length > 0 &&
    draft.lineNumber.trim().length > 0 &&
    (draft.routePath.trim().length > 0 || draft.routeName.trim().length > 0)
  );
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
  if (!hasLineOrLicenseLink(draft.lineId, draft.licenseId)) {
    reasons.push('lineId or licenseId is required');
  }
  if (!isProfileCompleteForApproval(draft)) {
    reasons.push('fullName, nationalId, phone, lineNumber, routePath/routeName are required');
  }
  return { isEligible: reasons.length === 0, reasons };
}

function createInitialDraft(driver: DriverDocument): DriverDraft {
  return {
    fullName: driver.fullName || '',
    nationalId: driver.nationalId || '',
    phone: driver.phone || '',
    officeId: driver.officeId || '',
    lineNumber: driver.lineNumber || '',
    routePath: driver.routePath || '',
    routeName: driver.routeName || '',
    routeCities: Array.isArray(driver.routeCities) ? driver.routeCities.join(', ') : '',
    photoUrl: driver.photoUrl || '',
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
  const { txt } = useI18n();
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
        lastSeenAgo: formatRelativeTime(driver.lastSeen, txt),
      })),
    [drivers, txt]
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
      officeId: draft.officeId.trim(),
      lineId: draft.lineId.trim(),
      licenseId: draft.licenseId.trim(),
      fullName: draft.fullName.trim(),
      nationalId: draft.nationalId.trim(),
      phone: draft.phone.trim(),
      lineNumber: draft.lineNumber.trim(),
      routePath: draft.routePath.trim(),
      routeName: draft.routeName.trim(),
      routeCities: draft.routeCities.trim(),
      photoUrl: draft.photoUrl.trim(),
      driverType: draft.driverType.trim(),
      vehicleType: normalizeVehicleType(draft.vehicleType),
      seatCapacity: draft.seatCapacity.trim(),
      note: draft.note.trim(),
    };

    const parsedSeatCapacity = parseSeatCapacityInput(normalizedDraft.seatCapacity);
    if (parsedSeatCapacity === null) {
      window.alert(txt('يجب أن تكون سعة المقاعد رقمًا بين 1 و 14.', 'Seat capacity must be a number between 1 and 14.'));
      return;
    }

    if (
      mode === 'approve' &&
      (!hasLineOrLicenseLink(normalizedDraft.lineId, normalizedDraft.licenseId) ||
        !isProfileCompleteForApproval(normalizedDraft))
    ) {
      window.alert(
        txt(
          'القبول يتطلب lineId/licenseId وملفًا مكتملًا (الاسم، الهوية، الهاتف، رقم الخط، routePath/routeName).',
          'Approve requires lineId/licenseId and complete profile (fullName, nationalId, phone, lineNumber, routePath/routeName).'
        )
      );
      return;
    }

    setSavingByDriverId((current) => ({ ...current, [driverId]: true }));
    setPageError(null);
    try {
      const result = await upsertDriverEligibility({
        driverId,
        driverType: normalizedDraft.driverType || undefined,
        verificationStatus: normalizedDraft.verificationStatus,
        officeId: normalizedDraft.officeId || undefined,
        lineId: normalizedDraft.lineId || undefined,
        licenseId: normalizedDraft.licenseId || undefined,
        fullName: normalizedDraft.fullName || undefined,
        nationalId: normalizedDraft.nationalId || undefined,
        phone: normalizedDraft.phone || undefined,
        lineNumber: normalizedDraft.lineNumber || undefined,
        routePath: normalizedDraft.routePath || undefined,
        routeName: normalizedDraft.routeName || undefined,
        routeCities: parseRouteCitiesInput(normalizedDraft.routeCities),
        photoUrl: normalizedDraft.photoUrl || undefined,
        vehicleType: normalizedDraft.vehicleType,
        seatCapacity: parsedSeatCapacity,
        note: normalizedDraft.note || undefined,
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
      setPageError(error instanceof Error ? error.message : txt('تعذّر تحديث أهلية السائق.', 'Failed to update driver eligibility.'));
    } finally {
      setSavingByDriverId((current) => ({ ...current, [driverId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="drivers-page">
        <h2>{txt('السائقون', 'Drivers')}</h2>
        <p>{txt('جاري التحميل...', 'Loading...')}</p>
      </div>
    );
  }

  return (
    <div className="drivers-page">
      <h2>{txt(`السائقون (${drivers.length} إجمالي)`, `Drivers (${drivers.length} total)`)}</h2>
      <p className="drivers-subtitle">
        {txt(
          'تسجيل السائقين، اكتمال الملف، ربط الخطوط، والتحكم بالأهلية.',
          'Driver registration, profile completeness, route assignment, and eligibility control.'
        )}
      </p>

      <div className="drivers-summary">
        <span className="online-count">{txt(`${onlineCount} متصل`, `${onlineCount} Online`)}</span>
        <span className="stale-count">{txt(`${staleCount} غير محدث`, `${staleCount} Stale`)}</span>
        <span className="offline-count">{txt(`${offlineCount} غير متصل`, `${offlineCount} Offline`)}</span>
      </div>

      {pageError ? <div className="page-error">{pageError}</div> : null}

      {drivers.length === 0 ? (
        <p className="no-drivers">{txt('لا يوجد سائقون.', 'No drivers found.')}</p>
      ) : (
        <div className="drivers-table-wrap">
          <table className="drivers-table">
            <thead>
              <tr>
                <th>{txt('السائق', 'Driver')}</th>
                <th>{txt('النطاق', 'Scope')}</th>
                <th>{txt('الملف', 'Profile')}</th>
                <th>{txt('المسار / الخط', 'Route / Line')}</th>
                <th>{txt('المركبة / المقاعد', 'Vehicle / Seats')}</th>
                <th>{txt('الأهلية', 'Eligibility')}</th>
                <th>{txt('الإجراءات', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {driversWithActivity.map((driver) => {
                const badge = getStatusBadge(driver.activityState, txt);
                const draft = drafts[driver.id] ?? createInitialDraft(driver);
                const eligibility = computeEligibilityFromDraft(draft);
                const isSaving = savingByDriverId[driver.id] === true;
                const availableSeatsText =
                  typeof driver.availableSeats === 'number' ? String(driver.availableSeats) : '--';

                return (
                  <tr key={driver.id} className={driver.activityState}>
                    <td>
                      <div className="driver-id">{driver.id}</div>
                      <div className="timestamp">{formatRelativeTime(driver.lastSeen, txt)}</div>
                      <span className={`status-badge ${driver.activityState}`}>{badge.text}</span>
                    </td>

                    <td>
                      <div className="cell-stack">
                        <input
                          className="table-input"
                          value={draft.officeId}
                          onChange={(e) => setDraftField(driver.id, 'officeId', e.target.value)}
                          disabled={isSaving}
                          placeholder="officeId"
                        />
                        <input
                          className="table-input"
                          value={draft.lineId}
                          onChange={(e) => setDraftField(driver.id, 'lineId', e.target.value)}
                          disabled={isSaving}
                          placeholder="lineId"
                        />
                        <input
                          className="table-input"
                          value={draft.licenseId}
                          onChange={(e) => setDraftField(driver.id, 'licenseId', e.target.value)}
                          disabled={isSaving}
                          placeholder="licenseId"
                        />
                      </div>
                    </td>

                    <td>
                      <div className="cell-stack">
                        <input
                          className="table-input"
                          value={draft.fullName}
                          onChange={(e) => setDraftField(driver.id, 'fullName', e.target.value)}
                          disabled={isSaving}
                          placeholder="Full name"
                        />
                        <input
                          className="table-input"
                          value={draft.nationalId}
                          onChange={(e) => setDraftField(driver.id, 'nationalId', e.target.value)}
                          disabled={isSaving}
                          placeholder="National ID"
                        />
                        <input
                          className="table-input"
                          value={draft.phone}
                          onChange={(e) => setDraftField(driver.id, 'phone', e.target.value)}
                          disabled={isSaving}
                          placeholder="Phone"
                        />
                        <input
                          className="table-input"
                          value={draft.photoUrl}
                          onChange={(e) => setDraftField(driver.id, 'photoUrl', e.target.value)}
                          disabled={isSaving}
                          placeholder="Photo URL (optional)"
                        />
                      </div>
                    </td>

                    <td>
                      <div className="cell-stack">
                        <input
                          className="table-input"
                          value={draft.lineNumber}
                          onChange={(e) => setDraftField(driver.id, 'lineNumber', e.target.value)}
                          disabled={isSaving}
                          placeholder="Line number"
                        />
                        <input
                          className="table-input"
                          value={draft.routePath}
                          onChange={(e) => setDraftField(driver.id, 'routePath', e.target.value)}
                          disabled={isSaving}
                          placeholder="Route path (Nablus ↔ Ramallah)"
                        />
                        <input
                          className="table-input"
                          value={draft.routeName}
                          onChange={(e) => setDraftField(driver.id, 'routeName', e.target.value)}
                          disabled={isSaving}
                          placeholder="Route name (optional)"
                        />
                        <input
                          className="table-input"
                          value={draft.routeCities}
                          onChange={(e) => setDraftField(driver.id, 'routeCities', e.target.value)}
                          disabled={isSaving}
                          placeholder="Route cities CSV (Nablus,Ramallah)"
                        />
                      </div>
                    </td>

                    <td>
                      <div className="cell-stack">
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
                        <input
                          className="table-input table-input-sm"
                          value={draft.seatCapacity}
                          onChange={(e) => setDraftField(driver.id, 'seatCapacity', e.target.value)}
                          disabled={isSaving}
                          placeholder={txt('المقاعد', 'Seats')}
                        />
                        <div className="readonly-chip">
                          {txt(`المقاعد المتاحة الآن: ${availableSeatsText}`, `Live available seats: ${availableSeatsText}`)}
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className="cell-stack">
                        <input
                          className="table-input"
                          value={draft.driverType}
                          onChange={(e) => setDraftField(driver.id, 'driverType', e.target.value)}
                          disabled={isSaving}
                          placeholder="licensed_line_owner"
                        />
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
                          <option value="approved">{txt('مقبول', 'approved')}</option>
                          <option value="pending">{txt('قيد المراجعة', 'pending')}</option>
                          <option value="rejected">{txt('مرفوض', 'rejected')}</option>
                        </select>

                        <span
                          className={`eligibility-badge ${eligibility.isEligible ? 'ok' : 'blocked'}`}
                        >
                          {eligibility.isEligible
                            ? txt('مؤهل', 'Eligible')
                            : txt('غير مؤهل', 'Blocked')}
                        </span>
                        {!eligibility.isEligible ? (
                          <div className="eligibility-reasons">{eligibility.reasons.join(', ')}</div>
                        ) : null}
                      </div>
                    </td>

                    <td>
                      <div className="actions-cell">
                        <input
                          className="table-input"
                          value={draft.note}
                          onChange={(e) => setDraftField(driver.id, 'note', e.target.value)}
                          disabled={isSaving}
                          placeholder={txt('ملاحظة الأهلية (اختياري)', 'Eligibility note (optional)')}
                        />
                        <button
                          className="action-btn approve"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'approve')}
                          disabled={isSaving}
                        >
                          {txt('قبول', 'Approve')}
                        </button>
                        <button
                          className="action-btn reject"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'reject')}
                          disabled={isSaving}
                        >
                          {txt('رفض', 'Reject')}
                        </button>
                        <button
                          className="action-btn save"
                          onClick={() => persistDriverEligibility(driver.id, draft, 'save')}
                          disabled={isSaving}
                        >
                          {txt('حفظ', 'Save')}
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
