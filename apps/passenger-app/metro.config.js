const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the shared package dist folder
config.watchFolders = [workspaceRoot];

// Resolve @taxi-line/shared to its dist folder
config.resolver.extraNodeModules = {
  '@taxi-line/shared': path.resolve(workspaceRoot, 'packages/shared/dist'),
};

// Ensure node_modules are resolved from project and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
