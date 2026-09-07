#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Runs the pure-logic unit tests.
 *
 * WHY THIS EXISTS RATHER THAN A GLOB IN package.json
 * `node --test "…/unit/*.test.mjs"` relied on the SHELL expanding the glob. Windows
 * shells expand it and Linux `sh -e` does not, so the same script passed locally and
 * failed in CI with "Could not find …/*.test.mjs" - which is precisely the kind of
 * difference a CI script must not have.
 *
 * Resolving the file list here, in Node, makes the behaviour identical everywhere,
 * and also survives the repository path containing a space.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unitDir = path.join(repoRoot, 'backend', 'functions', 'scripts', 'unit');

if (!fs.existsSync(unitDir)) {
  console.error(`No unit test directory at ${unitDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(unitDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(unitDir, name));

// An empty run must FAIL. Silently passing zero tests is how a suite quietly stops
// protecting anything after a rename.
if (files.length === 0) {
  console.error(`No *.test.mjs files found in ${unitDir}`);
  process.exit(1);
}

console.log(`Running ${files.length} unit test file(s):`);
for (const file of files) console.log(`  - ${path.relative(repoRoot, file)}`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
