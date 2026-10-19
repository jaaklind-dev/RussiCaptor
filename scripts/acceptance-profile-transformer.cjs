const upstream = require('@expo/metro-config/babel-transformer');
const path = require('node:path');
const fs = require('node:fs');
const { sha, transformSource, canonicalMode } = require('./canonical-acceptance-profile.cjs');
const root = path.resolve(__dirname, '..');
module.exports.transform = options => upstream.transform({ ...options,
  src: transformSource(root, options.filename, options.src, canonicalMode(process.env)) });
module.exports.getCacheKey = () => sha([
  upstream.getCacheKey(), process.env.RUSSICAPTOR_RELEASE_VARIANT ?? '',
  process.env.RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS ?? '',
  fs.readFileSync(__filename), fs.readFileSync(path.join(__dirname, 'canonical-acceptance-profile.cjs')),
  fs.readFileSync(path.join(root, 'release/canonical-acceptance-profile.json')),
  fs.readFileSync(path.join(root, 'release/canonical-profile/SharedWorkflowMutationService.ts')),
].join('\n'));
