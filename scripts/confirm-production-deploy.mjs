import { spawnSync } from 'node:child_process';

const PRODUCTION_PROJECT = 'waselneh-prod-414e2';
const args = process.argv.slice(2);
const indexesOnly = args[0] === 'indexes';
const confirmation = args.find((arg) => arg.startsWith('--confirm-production='));
const confirmedProject = confirmation?.split('=', 2)[1];

if (confirmedProject !== PRODUCTION_PROJECT) {
  console.error(
    `Production deploy refused. Re-run with --confirm-production=${PRODUCTION_PROJECT} after verifying the target and rollback plan.`
  );
  process.exit(2);
}

const only = indexesOnly ? 'firestore:indexes' : 'functions,firestore:rules';
const result = spawnSync(
  process.execPath,
  [
    './scripts/run-firebase-node20.cjs',
    'deploy',
    '--project',
    PRODUCTION_PROJECT,
    '--only',
    only,
  ],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
