const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalMode } = require('./scripts/canonical-acceptance-profile.cjs');
const config = getDefaultConfig(__dirname);
// Isolated worktrees share the installed dependency tree through a symlink.
// Metro must be able to observe its exact physical target, not a broad parent.
const dependencies = fs.realpathSync(path.join(__dirname, 'node_modules'));
if (dependencies !== path.join(__dirname, 'node_modules')) config.watchFolders.push(dependencies);
canonicalMode(process.env); // fail closed before bundling contradictory modes
config.transformer.babelTransformerPath = require.resolve('./scripts/acceptance-profile-transformer.cjs');
module.exports = config;
