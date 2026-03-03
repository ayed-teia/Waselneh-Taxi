#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

function shellEscape(arg) {
  if (!arg) return '""';
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(arg)) {
    return arg;
  }
  return `"${String(arg).replace(/(["\\$`])/g, '\\$1')}"`;
}

const firebaseArgs = process.argv.slice(2);
const firebaseCommand = `firebase ${firebaseArgs.map(shellEscape).join(' ')}`.trim();

const fullCommand = `npx -y -p node@20 -p firebase-tools -c ${shellEscape(firebaseCommand)}`;

const result = spawnSync(fullCommand, {
  stdio: 'inherit',
  shell: true,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  console.error('[run-firebase-node20] Failed to run Firebase CLI:', result.error.message);
}

process.exit(1);
