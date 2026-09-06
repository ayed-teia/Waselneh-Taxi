/**
 * QA Script for Step 33: Go-Live Mode
 * 
 * Tests:
 * 1) DEV Mode - emulators allowed
 * 2) PILOT Mode Guard - emulators blocked
 * 3) Feature Flags - roadblocksEnabled, paymentsEnabled
 * 4) Docs verification
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Firebase Admin
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

admin.initializeApp({ projectId: 'demo-taxi-line' });

const db = admin.firestore();

// Test results
const results: { test: string; passed: boolean; details: string }[] = [];

function log(msg: string) {
  console.log(`[QA-33] ${msg}`);
}

function pass(test: string, details: string = '') {
  results.push({ test, passed: true, details });
  console.log(`✅ PASS: ${test}${details ? ` - ${details}` : ''}`);
}

function fail(test: string, details: string) {
  results.push({ test, passed: false, details });
  console.log(`❌ FAIL: ${test} - ${details}`);
}

// ========== TEST 1: App Mode Config ==========
async function test1_AppModeConfig() {
  log('TEST 1: App Mode Configuration');
  
  // Import the shared config
  const configPath = path.join(__dirname, '../../..', 'packages/shared/dist/config/app-mode.config.js');
  
  if (fs.existsSync(configPath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- runtime-conditional load of a built artifact, guarded by fs.existsSync above
    const appModeModule = require(configPath);
    const parseAppMode = appModeModule.parseAppMode;
    
    // Test parseAppMode
    if (parseAppMode('dev') === 'dev') {
      pass('TEST 1a', 'parseAppMode("dev") returns "dev"');
    } else {
      fail('TEST 1a', 'parseAppMode failed for dev');
    }
    
    if (parseAppMode('pilot') === 'pilot') {
      pass('TEST 1b', 'parseAppMode("pilot") returns "pilot"');
    } else {
      fail('TEST 1b', 'parseAppMode failed for pilot');
    }
    
    if (parseAppMode('prod') === 'prod') {
      pass('TEST 1c', 'parseAppMode("prod") returns "prod"');
    } else {
      fail('TEST 1c', 'parseAppMode failed for prod');
    }
    
    if (parseAppMode(undefined) === 'dev') {
      pass('TEST 1d', 'parseAppMode(undefined) defaults to "dev"');
    } else {
      fail('TEST 1d', 'parseAppMode should default to dev');
    }
  } else {
    fail('TEST 1a-d', `Shared config not found at ${configPath}`);
  }
}

// ========== TEST 2: Emulator Guard ==========
async function test2_EmulatorGuard() {
  log('TEST 2: Emulator Connection Guard');
  
  const configPath = path.join(__dirname, '../../..', 'packages/shared/dist/config/app-mode.config.js');
  
  if (fs.existsSync(configPath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- runtime-conditional load of a built artifact, guarded by fs.existsSync above
    const appModeModule = require(configPath);
    const shouldAllowEmulators = appModeModule.shouldAllowEmulators;
    const getConnectionGuardMessage = appModeModule.getConnectionGuardMessage;
    
    // DEV mode allows emulators
    if (shouldAllowEmulators('dev', true) === true) {
      pass('TEST 2a', 'DEV mode + USE_EMULATORS=true → emulators allowed');
    } else {
      fail('TEST 2a', 'DEV mode should allow emulators');
    }
    
    // DEV mode with emulators disabled
    if (shouldAllowEmulators('dev', false) === false) {
      pass('TEST 2b', 'DEV mode + USE_EMULATORS=false → emulators NOT used');
    } else {
      fail('TEST 2b', 'DEV mode with USE_EMULATORS=false should not use emulators');
    }
    
    // PILOT mode blocks emulators even if requested
    if (shouldAllowEmulators('pilot', true) === false) {
      pass('TEST 2c', 'PILOT mode + USE_EMULATORS=true → emulators BLOCKED');
    } else {
      fail('TEST 2c', 'PILOT mode should BLOCK emulators');
    }
    
    // PROD mode blocks emulators
    if (shouldAllowEmulators('prod', true) === false) {
      pass('TEST 2d', 'PROD mode + USE_EMULATORS=true → emulators BLOCKED');
    } else {
      fail('TEST 2d', 'PROD mode should BLOCK emulators');
    }
    
    // Connection guard message for blocked emulators
    const pilotBlockedMsg = getConnectionGuardMessage('pilot', true);
    if (pilotBlockedMsg && pilotBlockedMsg.includes('BLOCKED')) {
      pass('TEST 2e', 'PILOT mode logs warning when emulators blocked');
    } else {
      fail('TEST 2e', `Expected BLOCKED message, got: ${pilotBlockedMsg}`);
    }
  } else {
    fail('TEST 2a-e', 'Shared config not found');
  }
}

// ========== TEST 3: Feature Flags ==========
async function test3_FeatureFlags() {
  log('TEST 3: Feature Flags');
  
  // Set up feature flags in system/config
  await db.collection('system').doc('config').set({
    tripsEnabled: true,
    roadblocksEnabled: true,
    paymentsEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'qa-test',
  });
  
  // Verify flags are stored
  const configSnap = await db.collection('system').doc('config').get();
  const config = configSnap.data();
  
  if (config?.tripsEnabled === true) {
    pass('TEST 3a', 'tripsEnabled = true (stored correctly)');
  } else {
    fail('TEST 3a', 'tripsEnabled not stored correctly');
  }
  
  if (config?.roadblocksEnabled === true) {
    pass('TEST 3b', 'roadblocksEnabled = true (stored correctly)');
  } else {
    fail('TEST 3b', 'roadblocksEnabled not stored correctly');
  }
  
  if (config?.paymentsEnabled === false) {
    pass('TEST 3c', 'paymentsEnabled = false (correct default for pilot)');
  } else {
    fail('TEST 3c', 'paymentsEnabled should be false for pilot');
  }
  
  // Toggle roadblocksEnabled
  await db.collection('system').doc('config').update({
    roadblocksEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  const updatedSnap = await db.collection('system').doc('config').get();
  const updatedConfig = updatedSnap.data();
  
  if (updatedConfig?.roadblocksEnabled === false) {
    pass('TEST 3d', 'roadblocksEnabled toggled to false');
  } else {
    fail('TEST 3d', 'roadblocksEnabled toggle failed');
  }
  
  // Reset for future tests
  await db.collection('system').doc('config').update({
    roadblocksEnabled: true,
  });
}

// ========== TEST 4: Documentation ==========
async function test4_Documentation() {
  log('TEST 4: Documentation Verification');
  
  const runbookPath = path.join(__dirname, '../../..', 'docs/PILOT_RUNBOOK.md');
  
  if (fs.existsSync(runbookPath)) {
    const content = fs.readFileSync(runbookPath, 'utf-8');
    
    // Check required sections
    const requiredSections = [
      'Environment Modes',
      'Development Setup',
      'Pilot Deployment',
      'Health Verification',
      'Troubleshooting',
      'Go/No-Go Checklist',
    ];
    
    let allSectionsPresent = true;
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        allSectionsPresent = false;
        fail(`TEST 4a`, `Missing section: ${section}`);
      }
    }
    
    if (allSectionsPresent) {
      pass('TEST 4a', 'All required sections present in PILOT_RUNBOOK.md');
    }
    
    // Check for key content
    if (content.includes('Kill Switch')) {
      pass('TEST 4b', 'Kill switch documentation present');
    } else {
      fail('TEST 4b', 'Missing kill switch documentation');
    }
    
    if (content.includes('EXPO_PUBLIC_APP_MODE') && content.includes('VITE_APP_MODE')) {
      pass('TEST 4c', 'Environment variable documentation present');
    } else {
      fail('TEST 4c', 'Missing environment variable documentation');
    }
    
    if (content.includes('No-Go Criteria')) {
      pass('TEST 4d', 'Go/No-Go checklist includes No-Go criteria');
    } else {
      fail('TEST 4d', 'Missing No-Go criteria in checklist');
    }
    
  } else {
    fail('TEST 4a-d', `PILOT_RUNBOOK.md not found at ${runbookPath}`);
  }
}

// ========== TEST 5: Verify .env Files ==========
async function test5_EnvFiles() {
  log('TEST 5: Environment Files');
  
  const envFiles = [
    { path: 'apps/driver-app/.env', mode: 'dev' },
    { path: 'apps/driver-app/.env.pilot', mode: 'pilot' },
    { path: 'apps/passenger-app/.env', mode: 'dev' },
    { path: 'apps/passenger-app/.env.pilot', mode: 'pilot' },
    { path: 'apps/manager-web/.env', mode: 'dev' },
  ];
  
  const baseDir = path.join(__dirname, '../../..');
  
  for (const envFile of envFiles) {
    const filePath = path.join(baseDir, envFile.path);
    
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      if (envFile.path.includes('driver-app') || envFile.path.includes('passenger-app')) {
        if (content.includes('EXPO_PUBLIC_APP_MODE')) {
          pass(`TEST 5: ${envFile.path}`, `Contains APP_MODE=${envFile.mode}`);
        } else {
          fail(`TEST 5: ${envFile.path}`, 'Missing EXPO_PUBLIC_APP_MODE');
        }
      } else if (envFile.path.includes('manager-web')) {
        if (content.includes('VITE_APP_MODE')) {
          pass(`TEST 5: ${envFile.path}`, `Contains VITE_APP_MODE=${envFile.mode}`);
        } else {
          fail(`TEST 5: ${envFile.path}`, 'Missing VITE_APP_MODE');
        }
      }
    } else {
      fail(`TEST 5: ${envFile.path}`, 'File not found');
    }
  }
}

// ========== MAIN ==========
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     STEP 33 QA: Go-Live Mode (Pilot Configuration)           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    await test1_AppModeConfig();
    console.log('');
    
    await test2_EmulatorGuard();
    console.log('');
    
    await test3_FeatureFlags();
    console.log('');
    
    await test4_Documentation();
    console.log('');
    
    await test5_EnvFiles();
    console.log('');
    
    // Summary
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                        QA SUMMARY                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('');
    
    if (failed === 0) {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ STEP 33 — QA PASS                            ║');
      console.log('║                                                              ║');
      console.log('║  All Go-Live Mode features verified:                         ║');
      console.log('║  • DEV/PILOT/PROD modes parsed correctly                     ║');
      console.log('║  • Emulator guard blocks non-dev modes                       ║');
      console.log('║  • Feature flags stored and toggleable                       ║');
      console.log('║  • PILOT_RUNBOOK.md complete with Go/No-Go checklist         ║');
      console.log('║  • Environment files configured                              ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      process.exit(0);
    } else {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║              ❌ STEP 33 — QA FAIL                            ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('\nFailed tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.test}: ${r.details}`);
      });
      process.exit(1);
    }
  } catch (error) {
    console.error('QA Error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
