import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '../localization';
import {
  CollectionItem,
  linkDriverToOperations,
  subscribeCollection,
  upsertCity,
  upsertLicense,
  upsertLine,
  upsertOffice,
  upsertPricingProfile,
  upsertPricingZone,
  upsertStaffRole,
  upsertVehicle,
} from '../services/operations.service';
import {
  ManifestRow,
  RouteRunRow,
  subscribeRouteRunManifest,
  subscribeRouteRuns,
} from '../services/route-runs.service';
import './OperationsPage.css';

type GenericDoc = Record<string, unknown>;

interface SnapshotState {
  cities: CollectionItem<GenericDoc>[];
  offices: CollectionItem<GenericDoc>[];
  lines: CollectionItem<GenericDoc>[];
  licenses: CollectionItem<GenericDoc>[];
  vehicles: CollectionItem<GenericDoc>[];
  pricingProfiles: CollectionItem<GenericDoc>[];
  pricingZones: CollectionItem<GenericDoc>[];
  managerRoles: CollectionItem<GenericDoc>[];
}

const INITIAL_SNAPSHOTS: SnapshotState = {
  cities: [],
  offices: [],
  lines: [],
  licenses: [],
  vehicles: [],
  pricingProfiles: [],
  pricingZones: [],
  managerRoles: [],
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function commaSeparatedList(input: string): string[] {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function optionalNumber(input: string): number | undefined {
  return input.trim() ? Number(input) : undefined;
}

export function OperationsPage() {
  const { txt } = useI18n();
  const [snapshots, setSnapshots] = useState<SnapshotState>(INITIAL_SNAPSHOTS);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeRuns, setRouteRuns] = useState<RouteRunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [manifest, setManifest] = useState<ManifestRow[]>([]);

  const [cityForm, setCityForm] = useState({
    cityId: '',
    code: '',
    nameAr: '',
    nameEn: '',
    governorateAr: '',
    governorateEn: '',
    centerLat: '',
    centerLng: '',
    serviceRadiusKm: '',
  });

  const [officeForm, setOfficeForm] = useState({
    officeId: '',
    name: '',
    code: '',
    cityId: '',
    contactPhone: '',
    dispatchMode: 'line_based' as 'line_based' | 'hybrid',
  });

  const [lineForm, setLineForm] = useState({
    lineId: '',
    officeId: '',
    name: '',
    code: '',
    minSeats: '1',
    maxSeats: '4',
    pricingProfileId: 'default',
    serviceAreaLabel: '',
    allowedVehicleTypes: 'taxi_standard,family_van,minibus,premium',
    serviceType: 'inter_city' as 'intra_city' | 'inter_city',
    operatorType: 'office' as 'office' | 'independent',
    originCityId: '',
    destinationCityId: '',
    originLabel: '',
    destinationLabel: '',
    distanceKm: '',
    estimatedDurationMin: '',
    pricingStrategy: 'distance' as 'distance' | 'fixed' | 'hybrid',
    fixedPriceIls: '',
    bidirectional: true,
  });

  const [licenseForm, setLicenseForm] = useState({
    licenseId: '',
    officeId: '',
    lineId: '',
    licenseNumber: '',
    holderName: '',
  });

  const [vehicleForm, setVehicleForm] = useState({
    vehicleId: '',
    officeId: '',
    lineId: '',
    licenseId: '',
    plateNumber: '',
    vehicleType: 'taxi_standard',
    seatCapacity: '4',
  });

  const [driverLinkForm, setDriverLinkForm] = useState({
    driverId: '',
    officeId: '',
    lineId: '',
    licenseId: '',
    vehicleId: '',
    vehicleType: '',
    seatCapacity: '',
  });

  const [pricingProfileForm, setPricingProfileForm] = useState({
    profileId: 'default',
    name: 'Default Pricing',
    baseRatePerKm: '0.5',
    minimumFareIls: '10',
    seatSurchargePerSeat: '2',
    vehicleMultipliersJson: '{"taxi_standard":1,"family_van":1.1,"minibus":1.2,"premium":1.35}',
    officeMultipliersJson: '{}',
    lineMultipliersJson: '{}',
    peakWindowsJson:
      '[{"id":"morning_peak","label":"Morning peak","daysOfWeek":[0,1,2,3,4,5],"startMinute":390,"endMinute":540,"multiplier":1.15}]',
    notes: '',
  });

  const [pricingZoneForm, setPricingZoneForm] = useState({
    zoneId: '',
    name: '',
    officeId: '',
    lineId: '',
    centerLat: '',
    centerLng: '',
    radiusKm: '2',
    multiplier: '1.1',
    flatSurchargeIls: '0',
    appliesTo: 'both' as 'pickup' | 'dropoff' | 'both',
  });

  const [staffRoleForm, setStaffRoleForm] = useState({
    targetUserId: '',
    role: 'operations_manager' as
      | 'admin'
      | 'manager'
      | 'operations_manager'
      | 'dispatcher'
      | 'support',
    permissionsCsv: '',
    officeIdsCsv: '',
    lineIdsCsv: '',
    isActive: true,
  });

  useEffect(() => {
    const unsubscribers = [
      subscribeCollection('cities', (items) =>
        setSnapshots((current) => ({ ...current, cities: items }))
      ),
      subscribeCollection('offices', (items) =>
        setSnapshots((current) => ({ ...current, offices: items }))
      ),
      subscribeCollection('lines', (items) =>
        setSnapshots((current) => ({ ...current, lines: items }))
      ),
      subscribeCollection('licenses', (items) =>
        setSnapshots((current) => ({ ...current, licenses: items }))
      ),
      subscribeCollection('vehicles', (items) =>
        setSnapshots((current) => ({ ...current, vehicles: items }))
      ),
      subscribeCollection('pricingProfiles', (items) =>
        setSnapshots((current) => ({ ...current, pricingProfiles: items }))
      ),
      subscribeCollection('pricingZones', (items) =>
        setSnapshots((current) => ({ ...current, pricingZones: items }))
      ),
      subscribeCollection('managerRoles', (items) =>
        setSnapshots((current) => ({ ...current, managerRoles: items }))
      ),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(
    () => subscribeRouteRuns(setRouteRuns, (runError) => setError(runError.message)),
    []
  );

  useEffect(() => {
    if (!selectedRunId) {
      setManifest([]);
      return undefined;
    }
    return subscribeRouteRunManifest(
      selectedRunId,
      setManifest,
      (manifestError) => setError(manifestError.message)
    );
  }, [selectedRunId]);

  const cityOptions = useMemo(
    () =>
      snapshots.cities.map((city) => ({
        id: city.id,
        label: `${asString(city.data.code) || city.id} - ${asString(city.data.nameAr) || asString(city.data.nameEn) || 'Unnamed city'}`,
      })),
    [snapshots.cities]
  );

  const officeOptions = useMemo(
    () =>
      snapshots.offices.map((office) => ({
        id: office.id,
        label: `${asString(office.data.code) || office.id} - ${asString(office.data.name) || 'Unnamed office'}`,
      })),
    [snapshots.offices]
  );

  const lineOptions = useMemo(
    () =>
      snapshots.lines.map((line) => ({
        id: line.id,
        label: `${asString(line.data.code) || line.id} - ${asString(line.data.name) || 'Unnamed line'}`,
      })),
    [snapshots.lines]
  );

  const safeRun = async (key: string, handler: () => Promise<void>) => {
    setSaving(key);
    setError(null);
    setMessage(null);
    try {
      await handler();
      setMessage(txt(`تم حفظ ${key} بنجاح.`, `${key} saved successfully.`));
    } catch (err) {
      setError(err instanceof Error ? err.message : txt(`تعذّر حفظ ${key}`, `Failed to save ${key}`));
    } finally {
      setSaving(null);
    }
  };

  const onSubmitCity = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('city', async () => {
      const hasCenter = cityForm.centerLat.trim() && cityForm.centerLng.trim();
      const result = await upsertCity({
        cityId: cityForm.cityId || undefined,
        code: cityForm.code,
        nameAr: cityForm.nameAr,
        nameEn: cityForm.nameEn || undefined,
        governorateAr: cityForm.governorateAr || undefined,
        governorateEn: cityForm.governorateEn || undefined,
        center: hasCenter
          ? { lat: Number(cityForm.centerLat), lng: Number(cityForm.centerLng) }
          : undefined,
        serviceRadiusKm: optionalNumber(cityForm.serviceRadiusKm),
      });
      if (!cityForm.cityId) {
        setCityForm((current) => ({ ...current, cityId: result.cityId }));
      }
    });
  };

  const onSubmitOffice = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('office', async () => {
      const result = await upsertOffice({
        officeId: officeForm.officeId || undefined,
        name: officeForm.name,
        code: officeForm.code,
        cityId: officeForm.cityId,
        contactPhone: officeForm.contactPhone || undefined,
        dispatchMode: officeForm.dispatchMode,
      });
      if (!officeForm.officeId) {
        setOfficeForm((current) => ({ ...current, officeId: result.officeId }));
      }
    });
  };

  const onSubmitLine = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('line', async () => {
      const result = await upsertLine({
        lineId: lineForm.lineId || undefined,
        officeId: lineForm.operatorType === 'office' ? lineForm.officeId : undefined,
        name: lineForm.name,
        code: lineForm.code,
        minSeats: Number(lineForm.minSeats),
        maxSeats: Number(lineForm.maxSeats),
        pricingProfileId: lineForm.pricingProfileId || undefined,
        serviceAreaLabel: lineForm.serviceAreaLabel || undefined,
        allowedVehicleTypes: commaSeparatedList(lineForm.allowedVehicleTypes),
        serviceType: lineForm.serviceType,
        operatorType: lineForm.operatorType,
        originCityId: lineForm.originCityId,
        destinationCityId: lineForm.destinationCityId,
        originLabel: lineForm.originLabel || undefined,
        destinationLabel: lineForm.destinationLabel || undefined,
        distanceKm: Number(lineForm.distanceKm),
        estimatedDurationMin: Number(lineForm.estimatedDurationMin),
        pricingStrategy: lineForm.pricingStrategy,
        fixedPriceIls: optionalNumber(lineForm.fixedPriceIls),
        bidirectional: lineForm.bidirectional,
      });
      if (!lineForm.lineId) {
        setLineForm((current) => ({ ...current, lineId: result.lineId }));
      }
    });
  };

  const onSubmitLicense = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('license', async () => {
      const result = await upsertLicense({
        licenseId: licenseForm.licenseId || undefined,
        officeId: licenseForm.officeId,
        lineId: licenseForm.lineId,
        licenseNumber: licenseForm.licenseNumber,
        holderName: licenseForm.holderName,
      });
      if (!licenseForm.licenseId) {
        setLicenseForm((current) => ({ ...current, licenseId: result.licenseId }));
      }
    });
  };

  const onSubmitVehicle = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('vehicle', async () => {
      const result = await upsertVehicle({
        vehicleId: vehicleForm.vehicleId || undefined,
        officeId: vehicleForm.officeId,
        lineId: vehicleForm.lineId,
        licenseId: vehicleForm.licenseId || undefined,
        plateNumber: vehicleForm.plateNumber,
        vehicleType: vehicleForm.vehicleType,
        seatCapacity: Number(vehicleForm.seatCapacity),
      });
      if (!vehicleForm.vehicleId) {
        setVehicleForm((current) => ({ ...current, vehicleId: result.vehicleId }));
      }
    });
  };

  const onSubmitDriverLink = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('driver-link', async () => {
      await linkDriverToOperations({
        driverId: driverLinkForm.driverId,
        officeId: driverLinkForm.officeId,
        lineId: driverLinkForm.lineId,
        licenseId: driverLinkForm.licenseId || undefined,
        vehicleId: driverLinkForm.vehicleId || undefined,
        vehicleType: driverLinkForm.vehicleType || undefined,
        seatCapacity: driverLinkForm.seatCapacity ? Number(driverLinkForm.seatCapacity) : undefined,
      });
    });
  };

  const onSubmitPricingProfile = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('pricing-profile', async () => {
      await upsertPricingProfile({
        profileId: pricingProfileForm.profileId || 'default',
        name: pricingProfileForm.name,
        baseRatePerKm: Number(pricingProfileForm.baseRatePerKm),
        minimumFareIls: Number(pricingProfileForm.minimumFareIls),
        seatSurchargePerSeat: Number(pricingProfileForm.seatSurchargePerSeat),
        vehicleMultipliers: JSON.parse(pricingProfileForm.vehicleMultipliersJson),
        officeMultipliers: JSON.parse(pricingProfileForm.officeMultipliersJson),
        lineMultipliers: JSON.parse(pricingProfileForm.lineMultipliersJson),
        peakWindows: JSON.parse(pricingProfileForm.peakWindowsJson),
        notes: pricingProfileForm.notes || undefined,
      });
    });
  };

  const onSubmitPricingZone = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('pricing-zone', async () => {
      await upsertPricingZone({
        zoneId: pricingZoneForm.zoneId || undefined,
        name: pricingZoneForm.name,
        officeId: pricingZoneForm.officeId || undefined,
        lineId: pricingZoneForm.lineId || undefined,
        center: {
          lat: Number(pricingZoneForm.centerLat),
          lng: Number(pricingZoneForm.centerLng),
        },
        radiusKm: Number(pricingZoneForm.radiusKm),
        multiplier: Number(pricingZoneForm.multiplier),
        flatSurchargeIls: Number(pricingZoneForm.flatSurchargeIls),
        appliesTo: pricingZoneForm.appliesTo,
      });
    });
  };

  const onSubmitStaffRole = async (event: FormEvent) => {
    event.preventDefault();
    await safeRun('staff-role', async () => {
      await upsertStaffRole({
        targetUserId: staffRoleForm.targetUserId,
        role: staffRoleForm.role,
        permissions: staffRoleForm.permissionsCsv
          ? commaSeparatedList(staffRoleForm.permissionsCsv)
          : undefined,
        officeIds: staffRoleForm.officeIdsCsv
          ? commaSeparatedList(staffRoleForm.officeIdsCsv)
          : undefined,
        lineIds: staffRoleForm.lineIdsCsv
          ? commaSeparatedList(staffRoleForm.lineIdsCsv)
          : undefined,
        isActive: staffRoleForm.isActive,
      });
    });
  };

  return (
    <div className="operations-page">
      <h2>{txt('لوحة التحكم التشغيلية', 'Operations Control Panel')}</h2>
      <p className="subtitle">
        {txt(
          'إدارة المكاتب، الخطوط، الرخص، المركبات، ربط السائقين، التسعير، وصلاحيات الإدارة.',
          'Manage offices, lines, licenses, vehicles, driver binding, pricing, and manager RBAC.'
        )}
      </p>

      {message ? <div className="ops-banner success">{message}</div> : null}
      {error ? <div className="ops-banner error">{error}</div> : null}

      <section className="ops-grid">
        <form className="ops-card" onSubmit={onSubmitCity}>
          <h3>City</h3>
          <input placeholder="cityId (optional)" value={cityForm.cityId} onChange={(e) => setCityForm((s) => ({ ...s, cityId: e.target.value }))} />
          <input placeholder="Code" value={cityForm.code} onChange={(e) => setCityForm((s) => ({ ...s, code: e.target.value }))} required />
          <input placeholder="Arabic name" value={cityForm.nameAr} onChange={(e) => setCityForm((s) => ({ ...s, nameAr: e.target.value }))} required />
          <input placeholder="English name (optional)" value={cityForm.nameEn} onChange={(e) => setCityForm((s) => ({ ...s, nameEn: e.target.value }))} />
          <input placeholder="Arabic governorate (optional)" value={cityForm.governorateAr} onChange={(e) => setCityForm((s) => ({ ...s, governorateAr: e.target.value }))} />
          <input placeholder="English governorate (optional)" value={cityForm.governorateEn} onChange={(e) => setCityForm((s) => ({ ...s, governorateEn: e.target.value }))} />
          <input placeholder="Center latitude (optional)" value={cityForm.centerLat} onChange={(e) => setCityForm((s) => ({ ...s, centerLat: e.target.value }))} />
          <input placeholder="Center longitude (optional)" value={cityForm.centerLng} onChange={(e) => setCityForm((s) => ({ ...s, centerLng: e.target.value }))} />
          <input placeholder="Service radius KM (optional)" value={cityForm.serviceRadiusKm} onChange={(e) => setCityForm((s) => ({ ...s, serviceRadiusKm: e.target.value }))} />
          <button disabled={saving === 'city'} type="submit">{saving === 'city' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ المدينة', 'Save City')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitOffice}>
          <h3>Office</h3>
          <input placeholder="officeId (optional)" value={officeForm.officeId} onChange={(e) => setOfficeForm((s) => ({ ...s, officeId: e.target.value }))} />
          <input placeholder="Name" value={officeForm.name} onChange={(e) => setOfficeForm((s) => ({ ...s, name: e.target.value }))} required />
          <input placeholder="Code" value={officeForm.code} onChange={(e) => setOfficeForm((s) => ({ ...s, code: e.target.value }))} required />
          <input placeholder="City ID" list="city-list" value={officeForm.cityId} onChange={(e) => setOfficeForm((s) => ({ ...s, cityId: e.target.value }))} required />
          <input placeholder="Contact phone" value={officeForm.contactPhone} onChange={(e) => setOfficeForm((s) => ({ ...s, contactPhone: e.target.value }))} />
          <select value={officeForm.dispatchMode} onChange={(e) => setOfficeForm((s) => ({ ...s, dispatchMode: e.target.value as 'line_based' | 'hybrid' }))}>
            <option value="line_based">line_based</option>
            <option value="hybrid">hybrid</option>
          </select>
          <button disabled={saving === 'office'} type="submit">{saving === 'office' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ المكتب', 'Save Office')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitLine}>
          <h3>Line</h3>
          <input placeholder="lineId (optional)" value={lineForm.lineId} onChange={(e) => setLineForm((s) => ({ ...s, lineId: e.target.value }))} />
          <select value={lineForm.operatorType} onChange={(e) => setLineForm((s) => ({ ...s, operatorType: e.target.value as 'office' | 'independent' }))}>
            <option value="office">office</option>
            <option value="independent">independent</option>
          </select>
          <input placeholder="Office ID" list="office-list" value={lineForm.officeId} onChange={(e) => setLineForm((s) => ({ ...s, officeId: e.target.value }))} required={lineForm.operatorType === 'office'} disabled={lineForm.operatorType === 'independent'} />
          <input placeholder="Name" value={lineForm.name} onChange={(e) => setLineForm((s) => ({ ...s, name: e.target.value }))} required />
          <input placeholder="Code" value={lineForm.code} onChange={(e) => setLineForm((s) => ({ ...s, code: e.target.value }))} required />
          <select value={lineForm.serviceType} onChange={(e) => setLineForm((s) => ({ ...s, serviceType: e.target.value as 'intra_city' | 'inter_city' }))}>
            <option value="inter_city">inter_city</option>
            <option value="intra_city">intra_city</option>
          </select>
          <input placeholder="Origin city ID" list="city-list" value={lineForm.originCityId} onChange={(e) => setLineForm((s) => ({ ...s, originCityId: e.target.value }))} required />
          <input placeholder="Destination city ID" list="city-list" value={lineForm.destinationCityId} onChange={(e) => setLineForm((s) => ({ ...s, destinationCityId: e.target.value }))} required />
          <input placeholder="Origin label (optional)" value={lineForm.originLabel} onChange={(e) => setLineForm((s) => ({ ...s, originLabel: e.target.value }))} />
          <input placeholder="Destination label (optional)" value={lineForm.destinationLabel} onChange={(e) => setLineForm((s) => ({ ...s, destinationLabel: e.target.value }))} />
          <input placeholder="Distance KM" value={lineForm.distanceKm} onChange={(e) => setLineForm((s) => ({ ...s, distanceKm: e.target.value }))} required />
          <input placeholder="Estimated duration minutes" value={lineForm.estimatedDurationMin} onChange={(e) => setLineForm((s) => ({ ...s, estimatedDurationMin: e.target.value }))} required />
          <input placeholder="Min seats" value={lineForm.minSeats} onChange={(e) => setLineForm((s) => ({ ...s, minSeats: e.target.value }))} required />
          <input placeholder="Max seats" value={lineForm.maxSeats} onChange={(e) => setLineForm((s) => ({ ...s, maxSeats: e.target.value }))} required />
          <input placeholder="Pricing profile id" value={lineForm.pricingProfileId} onChange={(e) => setLineForm((s) => ({ ...s, pricingProfileId: e.target.value }))} />
          <select value={lineForm.pricingStrategy} onChange={(e) => setLineForm((s) => ({ ...s, pricingStrategy: e.target.value as 'distance' | 'fixed' | 'hybrid' }))}>
            <option value="distance">distance</option>
            <option value="fixed">fixed</option>
            <option value="hybrid">hybrid</option>
          </select>
          <input placeholder="Fixed price ILS" value={lineForm.fixedPriceIls} onChange={(e) => setLineForm((s) => ({ ...s, fixedPriceIls: e.target.value }))} required={lineForm.pricingStrategy !== 'distance'} />
          <input placeholder="Service area label (optional)" value={lineForm.serviceAreaLabel} onChange={(e) => setLineForm((s) => ({ ...s, serviceAreaLabel: e.target.value }))} />
          <input placeholder="Allowed vehicle types (csv)" value={lineForm.allowedVehicleTypes} onChange={(e) => setLineForm((s) => ({ ...s, allowedVehicleTypes: e.target.value }))} />
          <label className="checkbox">
            <input type="checkbox" checked={lineForm.bidirectional} onChange={(e) => setLineForm((s) => ({ ...s, bidirectional: e.target.checked }))} />
            {txt('اتجاهان', 'Bidirectional')}
          </label>
          <button disabled={saving === 'line'} type="submit">{saving === 'line' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ الخط', 'Save Line')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitLicense}>
          <h3>License</h3>
          <input placeholder="licenseId (optional)" value={licenseForm.licenseId} onChange={(e) => setLicenseForm((s) => ({ ...s, licenseId: e.target.value }))} />
          <input placeholder="Office ID" list="office-list" value={licenseForm.officeId} onChange={(e) => setLicenseForm((s) => ({ ...s, officeId: e.target.value }))} required />
          <input placeholder="Line ID" list="line-list" value={licenseForm.lineId} onChange={(e) => setLicenseForm((s) => ({ ...s, lineId: e.target.value }))} required />
          <input placeholder="License number" value={licenseForm.licenseNumber} onChange={(e) => setLicenseForm((s) => ({ ...s, licenseNumber: e.target.value }))} required />
          <input placeholder="Holder name" value={licenseForm.holderName} onChange={(e) => setLicenseForm((s) => ({ ...s, holderName: e.target.value }))} required />
          <button disabled={saving === 'license'} type="submit">{saving === 'license' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ الرخصة', 'Save License')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitVehicle}>
          <h3>Vehicle</h3>
          <input placeholder="vehicleId (optional)" value={vehicleForm.vehicleId} onChange={(e) => setVehicleForm((s) => ({ ...s, vehicleId: e.target.value }))} />
          <input placeholder="Office ID" list="office-list" value={vehicleForm.officeId} onChange={(e) => setVehicleForm((s) => ({ ...s, officeId: e.target.value }))} required />
          <input placeholder="Line ID" list="line-list" value={vehicleForm.lineId} onChange={(e) => setVehicleForm((s) => ({ ...s, lineId: e.target.value }))} required />
          <input placeholder="License ID" value={vehicleForm.licenseId} onChange={(e) => setVehicleForm((s) => ({ ...s, licenseId: e.target.value }))} />
          <input placeholder="Plate number" value={vehicleForm.plateNumber} onChange={(e) => setVehicleForm((s) => ({ ...s, plateNumber: e.target.value }))} required />
          <select value={vehicleForm.vehicleType} onChange={(e) => setVehicleForm((s) => ({ ...s, vehicleType: e.target.value }))}>
            <option value="taxi_standard">taxi_standard</option>
            <option value="family_van">family_van</option>
            <option value="minibus">minibus</option>
            <option value="premium">premium</option>
          </select>
          <input placeholder="Seat capacity" value={vehicleForm.seatCapacity} onChange={(e) => setVehicleForm((s) => ({ ...s, seatCapacity: e.target.value }))} required />
          <button disabled={saving === 'vehicle'} type="submit">{saving === 'vehicle' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ المركبة', 'Save Vehicle')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitDriverLink}>
          <h3>Driver Binding</h3>
          <input placeholder="Driver UID" value={driverLinkForm.driverId} onChange={(e) => setDriverLinkForm((s) => ({ ...s, driverId: e.target.value }))} required />
          <input placeholder="Office ID" list="office-list" value={driverLinkForm.officeId} onChange={(e) => setDriverLinkForm((s) => ({ ...s, officeId: e.target.value }))} required />
          <input placeholder="Line ID" list="line-list" value={driverLinkForm.lineId} onChange={(e) => setDriverLinkForm((s) => ({ ...s, lineId: e.target.value }))} required />
          <input placeholder="License ID" value={driverLinkForm.licenseId} onChange={(e) => setDriverLinkForm((s) => ({ ...s, licenseId: e.target.value }))} />
          <input placeholder="Vehicle ID" value={driverLinkForm.vehicleId} onChange={(e) => setDriverLinkForm((s) => ({ ...s, vehicleId: e.target.value }))} />
          <input placeholder="Vehicle type (optional)" value={driverLinkForm.vehicleType} onChange={(e) => setDriverLinkForm((s) => ({ ...s, vehicleType: e.target.value }))} />
          <input placeholder="Seat capacity (optional)" value={driverLinkForm.seatCapacity} onChange={(e) => setDriverLinkForm((s) => ({ ...s, seatCapacity: e.target.value }))} />
          <button disabled={saving === 'driver-link'} type="submit">{saving === 'driver-link' ? txt('جارٍ الحفظ...', 'Saving...') : txt('ربط السائق', 'Bind Driver')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitPricingProfile}>
          <h3>Pricing Profile</h3>
          <input placeholder="profileId" value={pricingProfileForm.profileId} onChange={(e) => setPricingProfileForm((s) => ({ ...s, profileId: e.target.value }))} required />
          <input placeholder="Name" value={pricingProfileForm.name} onChange={(e) => setPricingProfileForm((s) => ({ ...s, name: e.target.value }))} required />
          <input placeholder="Base rate per km" value={pricingProfileForm.baseRatePerKm} onChange={(e) => setPricingProfileForm((s) => ({ ...s, baseRatePerKm: e.target.value }))} required />
          <input placeholder="Minimum fare ILS" value={pricingProfileForm.minimumFareIls} onChange={(e) => setPricingProfileForm((s) => ({ ...s, minimumFareIls: e.target.value }))} required />
          <input placeholder="Seat surcharge per seat" value={pricingProfileForm.seatSurchargePerSeat} onChange={(e) => setPricingProfileForm((s) => ({ ...s, seatSurchargePerSeat: e.target.value }))} required />
          <textarea placeholder="Vehicle multipliers JSON" value={pricingProfileForm.vehicleMultipliersJson} onChange={(e) => setPricingProfileForm((s) => ({ ...s, vehicleMultipliersJson: e.target.value }))} rows={3} />
          <textarea placeholder="Office multipliers JSON" value={pricingProfileForm.officeMultipliersJson} onChange={(e) => setPricingProfileForm((s) => ({ ...s, officeMultipliersJson: e.target.value }))} rows={2} />
          <textarea placeholder="Line multipliers JSON" value={pricingProfileForm.lineMultipliersJson} onChange={(e) => setPricingProfileForm((s) => ({ ...s, lineMultipliersJson: e.target.value }))} rows={2} />
          <textarea placeholder="Peak windows JSON" value={pricingProfileForm.peakWindowsJson} onChange={(e) => setPricingProfileForm((s) => ({ ...s, peakWindowsJson: e.target.value }))} rows={4} />
          <textarea placeholder="Notes" value={pricingProfileForm.notes} onChange={(e) => setPricingProfileForm((s) => ({ ...s, notes: e.target.value }))} rows={2} />
          <button disabled={saving === 'pricing-profile'} type="submit">{saving === 'pricing-profile' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ ملف التسعير', 'Save Pricing Profile')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitPricingZone}>
          <h3>Pricing Zone</h3>
          <input placeholder="zoneId (optional)" value={pricingZoneForm.zoneId} onChange={(e) => setPricingZoneForm((s) => ({ ...s, zoneId: e.target.value }))} />
          <input placeholder="Name" value={pricingZoneForm.name} onChange={(e) => setPricingZoneForm((s) => ({ ...s, name: e.target.value }))} required />
          <input placeholder="Office ID" list="office-list" value={pricingZoneForm.officeId} onChange={(e) => setPricingZoneForm((s) => ({ ...s, officeId: e.target.value }))} />
          <input placeholder="Line ID" list="line-list" value={pricingZoneForm.lineId} onChange={(e) => setPricingZoneForm((s) => ({ ...s, lineId: e.target.value }))} />
          <input placeholder="Center latitude" value={pricingZoneForm.centerLat} onChange={(e) => setPricingZoneForm((s) => ({ ...s, centerLat: e.target.value }))} required />
          <input placeholder="Center longitude" value={pricingZoneForm.centerLng} onChange={(e) => setPricingZoneForm((s) => ({ ...s, centerLng: e.target.value }))} required />
          <input placeholder="Radius KM" value={pricingZoneForm.radiusKm} onChange={(e) => setPricingZoneForm((s) => ({ ...s, radiusKm: e.target.value }))} required />
          <input placeholder="Multiplier" value={pricingZoneForm.multiplier} onChange={(e) => setPricingZoneForm((s) => ({ ...s, multiplier: e.target.value }))} required />
          <input placeholder="Flat surcharge ILS" value={pricingZoneForm.flatSurchargeIls} onChange={(e) => setPricingZoneForm((s) => ({ ...s, flatSurchargeIls: e.target.value }))} required />
          <select value={pricingZoneForm.appliesTo} onChange={(e) => setPricingZoneForm((s) => ({ ...s, appliesTo: e.target.value as 'pickup' | 'dropoff' | 'both' }))}>
            <option value="both">both</option>
            <option value="pickup">pickup</option>
            <option value="dropoff">dropoff</option>
          </select>
          <button disabled={saving === 'pricing-zone'} type="submit">{saving === 'pricing-zone' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ منطقة التسعير', 'Save Pricing Zone')}</button>
        </form>

        <form className="ops-card" onSubmit={onSubmitStaffRole}>
          <h3>Staff RBAC</h3>
          <input placeholder="Target user UID" value={staffRoleForm.targetUserId} onChange={(e) => setStaffRoleForm((s) => ({ ...s, targetUserId: e.target.value }))} required />
          <select value={staffRoleForm.role} onChange={(e) => setStaffRoleForm((s) => ({ ...s, role: e.target.value as typeof staffRoleForm.role }))}>
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="operations_manager">operations_manager</option>
            <option value="dispatcher">dispatcher</option>
            <option value="support">support</option>
          </select>
          <input placeholder="Permissions CSV (optional)" value={staffRoleForm.permissionsCsv} onChange={(e) => setStaffRoleForm((s) => ({ ...s, permissionsCsv: e.target.value }))} />
          <input placeholder="officeIds CSV (optional)" value={staffRoleForm.officeIdsCsv} onChange={(e) => setStaffRoleForm((s) => ({ ...s, officeIdsCsv: e.target.value }))} />
          <input placeholder="lineIds CSV (optional)" value={staffRoleForm.lineIdsCsv} onChange={(e) => setStaffRoleForm((s) => ({ ...s, lineIdsCsv: e.target.value }))} />
          <label className="checkbox">
            <input type="checkbox" checked={staffRoleForm.isActive} onChange={(e) => setStaffRoleForm((s) => ({ ...s, isActive: e.target.checked }))} />
            {txt('نشط', 'Active')}
          </label>
          <button disabled={saving === 'staff-role'} type="submit">{saving === 'staff-role' ? txt('جارٍ الحفظ...', 'Saving...') : txt('حفظ دور الطاقم', 'Save Staff Role')}</button>
        </form>
      </section>

      <section className="ops-snapshot">
        <h3>{txt('اللقطة الحالية', 'Current Snapshot')}</h3>
        <div className="snapshot-grid">
          <div><strong>{txt('المدن', 'Cities')}</strong><span>{snapshots.cities.length}</span></div>
          <div><strong>{txt('المكاتب', 'Offices')}</strong><span>{snapshots.offices.length}</span></div>
          <div><strong>{txt('الخطوط', 'Lines')}</strong><span>{snapshots.lines.length}</span></div>
          <div><strong>{txt('الرخص', 'Licenses')}</strong><span>{snapshots.licenses.length}</span></div>
          <div><strong>{txt('المركبات', 'Vehicles')}</strong><span>{snapshots.vehicles.length}</span></div>
          <div><strong>{txt('ملفات التسعير', 'Pricing Profiles')}</strong><span>{snapshots.pricingProfiles.length}</span></div>
          <div><strong>{txt('مناطق التسعير', 'Pricing Zones')}</strong><span>{snapshots.pricingZones.length}</span></div>
          <div><strong>{txt('أدوار الإدارة', 'Manager Roles')}</strong><span>{snapshots.managerRoles.length}</span></div>
        </div>
        {snapshots.offices.length > 0 ? (
          <div className="snapshot-grid">
            {snapshots.offices.map((office) => (
              <Link key={office.id} to={`/offices/${office.id}`}>
                {asString(office.data.name) || office.id} →
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section className="ops-snapshot">
        <h3>{txt('الرحلات المباشرة وقائمة الركاب', 'Live Route Runs & Passenger Manifest')}</h3>
        <select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
          <option value="">{txt('اختر رحلة خط', 'Select a route run')}</option>
          {routeRuns.map((run) => (
            <option key={run.id} value={run.id}>
              {run.lineId} · {run.status} · {run.bookedSeats}/{run.seatCapacity}
            </option>
          ))}
        </select>
        {selectedRunId ? (
          <div className="snapshot-grid">
            {manifest.map((passenger) => (
              <div key={passenger.id}>
                <strong>{passenger.passengerName}</strong>
                <span>{passenger.seats} {txt('مقاعد', 'seats')} · {passenger.status}</span>
                <small>{passenger.pickupLabel || '—'} → {passenger.destinationLabel || '—'}</small>
              </div>
            ))}
            {manifest.length === 0 ? <p>{txt('لا يوجد ركاب بعد.', 'No passengers yet.')}</p> : null}
          </div>
        ) : null}
      </section>

      <datalist id="city-list">
        {cityOptions.map((city) => (
          <option key={city.id} value={city.id}>
            {city.label}
          </option>
        ))}
      </datalist>
      <datalist id="office-list">
        {officeOptions.map((office) => (
          <option key={office.id} value={office.id}>
            {office.label}
          </option>
        ))}
      </datalist>
      <datalist id="line-list">
        {lineOptions.map((line) => (
          <option key={line.id} value={line.id}>
            {line.label}
          </option>
        ))}
      </datalist>
    </div>
  );
}

export function OperationsPageSummary() {
  const { txt } = useI18n();
  return (
    <div>
      <h2>{txt('العمليات', 'Operations')}</h2>
      <p>{txt('تهيئة المكاتب، الخطوط، الرخص، المركبات، التسعير، وصلاحيات الإدارة.', 'Configure offices, lines, licenses, vehicles, pricing profiles/zones, and manager RBAC.')}</p>
    </div>
  );
}
