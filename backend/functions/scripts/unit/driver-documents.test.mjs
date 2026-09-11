/**
 * Unit tests for the driver onboarding document module.
 *
 * This module had NO unit tests, despite being pure, security-relevant logic: a
 * state machine that decides whether a document counts as verified, and a path
 * builder that takes a client-supplied file name.
 *
 * The traversal cases below are the reason this file exists. `documentStoragePath`
 * interpolated `fileName` raw, so `../../other-driver/...` produced a storagePath
 * outside the uploader's own prefix. Storage itself still refused the upload
 * (storage.rules binds the object path to {driverId}), but the Firestore metadata
 * would carry an attacker-chosen path for any later consumer to trust.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  allRequiredDocumentsApproved,
  canTransition,
  documentStoragePath,
  isDriverDocumentType,
  sanitizeDocumentFileName,
  DRIVER_DOCUMENT_TYPES,
  REQUIRED_DRIVER_DOCUMENTS,
} = require(path.join(dirname, '..', '..', 'dist', 'modules', 'drivers', 'driver-documents'));

describe('sanitizeDocumentFileName - path traversal', () => {
  test('strips a parent-directory escape', () => {
    assert.equal(sanitizeDocumentFileName('../../other-driver/id.jpg'), 'id.jpg');
  });

  test('strips a leading absolute path', () => {
    assert.equal(sanitizeDocumentFileName('/etc/passwd'), 'passwd');
  });

  test('strips a Windows-style path', () => {
    // A desktop client can easily send a backslash path.
    assert.equal(sanitizeDocumentFileName('C:\\Users\\x\\licence.png'), 'licence.png');
  });

  test('a bare traversal operator yields null rather than a name', () => {
    assert.equal(sanitizeDocumentFileName('..'), null);
    assert.equal(sanitizeDocumentFileName('.'), null);
  });

  test('a name of only dots is refused', () => {
    assert.equal(sanitizeDocumentFileName('...'), null);
  });

  test('an empty or whitespace-only name is refused', () => {
    assert.equal(sanitizeDocumentFileName(''), null);
    // Whitespace becomes underscores, so this survives - but as a real name.
    assert.equal(sanitizeDocumentFileName('   '), '___');
  });
});

describe('sanitizeDocumentFileName - hostile characters', () => {
  test('a NUL byte is neutralised', () => {
    // A NUL can truncate a path in a downstream C-backed consumer.
    assert.equal(sanitizeDocumentFileName('licence.jpg\u0000.exe'), 'licence.jpg_.exe');
  });

  test('spaces and unicode become underscores', () => {
    assert.equal(sanitizeDocumentFileName('my licence.jpg'), 'my_licence.jpg');
    assert.equal(sanitizeDocumentFileName('رخصة.jpg'), '____.jpg');
  });

  test('an ordinary name is left alone', () => {
    assert.equal(sanitizeDocumentFileName('licence_2026-01.jpg'), 'licence_2026-01.jpg');
  });

  test('the result is bounded in length', () => {
    const long = `${'a'.repeat(500)}.jpg`;
    assert.equal(sanitizeDocumentFileName(long).length, 120);
  });
});

describe('documentStoragePath', () => {
  test('builds the expected path', () => {
    assert.equal(
      documentStoragePath('driver1', 'driving_licence', 'licence.jpg'),
      'driver-documents/driver1/driving_licence/licence.jpg'
    );
  });

  test('a traversal attempt cannot escape the driver prefix', () => {
    const result = documentStoragePath('driver1', 'national_id', '../../driver2/national_id/x.jpg');
    assert.equal(result, 'driver-documents/driver1/national_id/x.jpg');
    assert.ok(result.startsWith('driver-documents/driver1/'), result);
    assert.ok(!result.includes('..'), result);
  });

  test('throws rather than inventing a name when nothing survives', () => {
    // Silently substituting a generated name would hide a hostile client.
    assert.throws(() => documentStoragePath('driver1', 'insurance', '..'));
  });
});

describe('canTransition - the state machine', () => {
  test('a first upload lands as pending', () => {
    assert.equal(canTransition(null, 'pending'), true);
    assert.equal(canTransition(null, 'approved'), false);
    assert.equal(canTransition(null, 'rejected'), false);
  });

  test('a manager may approve or reject a pending document', () => {
    assert.equal(canTransition('pending', 'approved'), true);
    assert.equal(canTransition('pending', 'rejected'), true);
  });

  test('a rejected document may be re-uploaded', () => {
    assert.equal(canTransition('rejected', 'pending'), true);
  });

  test('an APPROVED document cannot silently revert to pending', () => {
    // This is the load-bearing rule: a re-upload over an approved document would
    // drop its verification without any review.
    assert.equal(canTransition('approved', 'pending'), false);
  });

  test('an approved document can still be revoked', () => {
    // A licence later found invalid must be revocable.
    assert.equal(canTransition('approved', 'rejected'), true);
  });
});

describe('allRequiredDocumentsApproved', () => {
  const approveAll = () =>
    REQUIRED_DRIVER_DOCUMENTS.map((documentType) => ({ documentType, status: 'approved' }));

  test('true only when every required document is approved', () => {
    assert.equal(allRequiredDocumentsApproved(approveAll()), true);
  });

  test('one pending required document is enough to fail', () => {
    const documents = approveAll();
    documents[0].status = 'pending';
    assert.equal(allRequiredDocumentsApproved(documents), false);
  });

  test('a missing required document is not treated as approved', () => {
    assert.equal(allRequiredDocumentsApproved(approveAll().slice(1)), false);
  });

  test('an approved profile_photo does not substitute for a required document', () => {
    assert.equal(
      allRequiredDocumentsApproved([{ documentType: 'profile_photo', status: 'approved' }]),
      false
    );
  });

  test('an empty set is not approved', () => {
    assert.equal(allRequiredDocumentsApproved([]), false);
  });
});

describe('isDriverDocumentType', () => {
  test('accepts every declared type', () => {
    for (const documentType of DRIVER_DOCUMENT_TYPES) {
      assert.equal(isDriverDocumentType(documentType), true, documentType);
    }
  });

  test('rejects anything else', () => {
    for (const value of ['passport', '', null, undefined, 42, {}]) {
      assert.equal(isDriverDocumentType(value), false, String(value));
    }
  });
});
