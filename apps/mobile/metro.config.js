const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// npm-workspaces monorepo: watch the repo root and resolve modules from both
// node_modules trees so hoisted packages and `@peoplecore/*` links are found.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// Keep the `@/*` TypeScript path alias working outside of Metro's tsconfig lookup.
config.resolver.alias = {
  ...config.resolver.alias,
  '@': path.resolve(projectRoot, 'src'),
};

module.exports = config;
