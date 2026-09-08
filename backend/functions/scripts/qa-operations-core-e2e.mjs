/* eslint-disable no-console */
import fs from 'node:fs';

import admin from 'firebase-admin';

const projectId = process.env.GCLOUD_PROJECT || 'waselneh-prod-414e2';
const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const functionsPort = Number(process.env.FUNCTIONS_EMULATOR_PORT || 5001);

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = emulatorHost + ':8080';
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost + ':9099';
}
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialPath && (credentialPath.includes('%CD%') || !fs.existsSync(credentialPath))) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

const results = [];
const pass = (name) => {
  results.push({ name, ok: true });
  console.log('✅ ' + name);
};
const fail = (name, error) => {
  results.push({ name, ok: false });
  console.error('❌ ' + name + ' - ' + error);
};
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function callCallable(name, data) {
  const url =
    'http://' + emulatorHost + ':' + functionsPort + '/' + projectId + '/europe-west1/' + name;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message || name + ' failed');
  }
  return body.result;
}

async function expectCallableFailure(name, data, expectedMessage) {
  try {
    await callCallable(name, data);
    throw new Error(name + ' unexpectedly succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('unexpectedly succeeded')) throw error;
    assert(
      message.toLowerCase().includes(expectedMessage.toLowerCase()),
      'expected "' + expectedMessage + '", received "' + message + '"'
    );
  }
}

async function main() {
  const app = admin.initializeApp({ projectId }, 'qa-operations-' + Date.now());
  const db = app.firestore();
  const suffix = Date.now();
  const cleanup = [];

  const managerId = 'qa-operations-manager-' + suffix;
  const scopedManagerId = 'qa-operations-scoped-' + suffix;
  const managerRoleRef = db.collection('managerRoles').doc(managerId);
  const scopedRoleRef = db.collection('managerRoles').doc(scopedManagerId);
  cleanup.push(managerRoleRef, scopedRoleRef);

  await managerRoleRef.set({
    uid: managerId,
    role: 'admin',
    permissions: [],
    officeIds: [],
    lineIds: [],
    isActive: true,
  });
  await scopedRoleRef.set({
    uid: scopedManagerId,
    role: 'operations_manager',
    permissions: [],
    officeIds: ['OFFICE_SCOPED_' + suffix],
    lineIds: [],
    isActive: true,
  });

  let originCityId;
  let destinationCityId;
  let officeId;
  let lineId;

  try {
    const origin = await callCallable('managerUpsertCity', {
      devUserId: managerId,
      code: 'JENIN_' + suffix,
      nameAr: 'جنين',
      nameEn: 'Jenin',
      center: { lat: 32.4618, lng: 35.3003 },
      serviceRadiusKm: 18,
    });
    const destination = await callCallable('managerUpsertCity', {
      devUserId: managerId,
      code: 'RAMALLAH_' + suffix,
      nameAr: 'رام الله',
      nameEn: 'Ramallah',
      center: { lat: 31.9038, lng: 35.2034 },
      serviceRadiusKm: 20,
    });
    originCityId = origin.cityId;
    destinationCityId = destination.cityId;
    cleanup.push(
      db.collection('cities').doc(originCityId),
      db.collection('cities').doc(destinationCityId)
    );

    const originDoc = (await db.collection('cities').doc(originCityId).get()).data() ?? {};
    assert(originDoc.nameAr === 'جنين', 'Arabic city name was not persisted');
    assert(originDoc.center?.lat === 32.4618, 'city center was not persisted');
    pass('Global manager creates canonical city documents');
  } catch (error) {
    fail('Global manager creates canonical city documents', String(error));
  }

  try {
    assert(originCityId, 'origin city setup failed');
    const office = await callCallable('managerUpsertOffice', {
      devUserId: managerId,
      code: 'JENIN_OFFICE_' + suffix,
      name: 'Jenin Central Office',
      cityId: originCityId,
      dispatchMode: 'hybrid',
    });
    officeId = office.officeId;
    cleanup.push(db.collection('offices').doc(officeId));

    const officeDoc = (await db.collection('offices').doc(officeId).get()).data() ?? {};
    assert(officeDoc.cityId === originCityId, 'office cityId was not persisted');
    assert(officeDoc.city === 'جنين', 'legacy city label was not denormalized');
    pass('Office references a canonical city and keeps a legacy display label');
  } catch (error) {
    fail('Office references a canonical city and keeps a legacy display label', String(error));
  }

  try {
    assert(originCityId && destinationCityId, 'city setup failed');
    const line = await callCallable('managerUpsertLine', {
      devUserId: managerId,
      code: 'JENIN_RAMALLAH_' + suffix,
      name: 'Jenin - Ramallah',
      serviceType: 'inter_city',
      operatorType: 'independent',
      originCityId,
      destinationCityId,
      originLabel: 'Jenin central station',
      destinationLabel: 'Ramallah central station',
      distanceKm: 73,
      estimatedDurationMin: 95,
      pricingStrategy: 'fixed',
      fixedPriceIls: 35,
      bidirectional: true,
      minSeats: 1,
      maxSeats: 7,
      allowedVehicleTypes: ['family_van', 'minibus'],
    });
    lineId = line.lineId;
    cleanup.push(db.collection('lines').doc(lineId));

    const lineDoc = (await db.collection('lines').doc(lineId).get()).data() ?? {};
    assert(lineDoc.officeId === null, 'independent line must not have an office');
    assert(lineDoc.serviceType === 'inter_city', 'service type was not persisted');
    assert(lineDoc.fixedPriceIls === 35, 'fixed fare was not persisted');
    assert(lineDoc.originCityId === originCityId, 'origin city was not persisted');
    assert(lineDoc.destinationCityId === destinationCityId, 'destination city was not persisted');
    pass('Global manager creates an independent inter-city line');
  } catch (error) {
    fail('Global manager creates an independent inter-city line', String(error));
  }

  try {
    assert(originCityId && destinationCityId, 'city setup failed');
    await expectCallableFailure(
      'managerUpsertLine',
      {
        devUserId: scopedManagerId,
        code: 'SCOPED_INDEPENDENT_' + suffix,
        name: 'Forbidden independent line',
        serviceType: 'inter_city',
        operatorType: 'independent',
        originCityId,
        destinationCityId,
        distanceKm: 73,
        estimatedDurationMin: 95,
        pricingStrategy: 'distance',
        minSeats: 1,
        maxSeats: 4,
      },
      'global manager'
    );
    pass('Scoped office manager cannot create an independent line');
  } catch (error) {
    fail('Scoped office manager cannot create an independent line', String(error));
  }

  try {
    assert(originCityId, 'city setup failed');
    await expectCallableFailure(
      'managerUpsertLine',
      {
        devUserId: managerId,
        code: 'INVALID_INTERCITY_' + suffix,
        name: 'Invalid inter-city line',
        serviceType: 'inter_city',
        operatorType: 'independent',
        originCityId,
        destinationCityId: originCityId,
        distanceKm: 10,
        estimatedDurationMin: 20,
        pricingStrategy: 'fixed',
        fixedPriceIls: 10,
        minSeats: 1,
        maxSeats: 4,
      },
      'invalid line payload'
    );
    pass('Inter-city validation rejects identical origin and destination');
  } catch (error) {
    fail('Inter-city validation rejects identical origin and destination', String(error));
  }

  for (const ref of cleanup.reverse()) {
    await ref.delete().catch(() => undefined);
  }
  await app.delete().catch(() => undefined);

  const passed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    '\n[QA] Operations core E2E summary -> total: ' +
      results.length +
      ', passed: ' +
      passed +
      ', failed: ' +
      failed
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[QA] Operations core E2E FAILED', error);
  process.exit(1);
});
