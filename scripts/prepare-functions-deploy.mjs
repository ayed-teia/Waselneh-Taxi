import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const deployRoot = path.join(root, '.firebase', 'functions-deploy');
const functionsRoot = path.join(root, 'backend', 'functions');
const sharedRoot = path.join(root, 'packages', 'shared');

for (const required of [
  path.join(functionsRoot, 'dist', 'index.js'),
  path.join(sharedRoot, 'dist', 'index.js'),
]) {
  try {
    readFileSync(required);
  } catch {
    console.error(`Functions deploy preparation refused: missing build output ${required}`);
    process.exit(2);
  }
}

rmSync(deployRoot, { recursive: true, force: true });
mkdirSync(path.join(deployRoot, 'vendor', 'shared'), { recursive: true });
cpSync(path.join(functionsRoot, 'dist'), path.join(deployRoot, 'dist'), { recursive: true });
cpSync(path.join(sharedRoot, 'dist'), path.join(deployRoot, 'vendor', 'shared', 'dist'), {
  recursive: true,
});
cpSync(
  path.join(functionsRoot, '.env.waselneh-staging-ayed'),
  path.join(deployRoot, '.env.waselneh-staging-ayed')
);

const functionsPackage = JSON.parse(readFileSync(path.join(functionsRoot, 'package.json'), 'utf8'));
functionsPackage.dependencies['@taxi-line/shared'] = 'file:vendor/shared';
delete functionsPackage.devDependencies;
delete functionsPackage.scripts;
writeFileSync(path.join(deployRoot, 'package.json'), `${JSON.stringify(functionsPackage, null, 2)}\n`);

const sharedPackage = JSON.parse(readFileSync(path.join(sharedRoot, 'package.json'), 'utf8'));
writeFileSync(
  path.join(deployRoot, 'vendor', 'shared', 'package.json'),
  `${JSON.stringify({
    name: sharedPackage.name,
    version: sharedPackage.version,
    main: sharedPackage.main,
    types: sharedPackage.types,
    exports: sharedPackage.exports,
    dependencies: sharedPackage.dependencies,
  }, null, 2)}\n`
);

const install = spawnSync(
  'npm',
  ['install', '--omit=dev', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund'],
  { cwd: deployRoot, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (install.status !== 0) {
  console.error('Functions deploy preparation refused: isolated npm install failed.');
  process.exit(install.status ?? 1);
}

console.log('Prepared isolated Functions source without workspace:* dependencies.');
