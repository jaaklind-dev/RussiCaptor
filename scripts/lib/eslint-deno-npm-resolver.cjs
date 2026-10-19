const { createRequire } = require('node:module');
const path = require('node:path');

// Lint tooling only. Never changes a deployed Deno import or runtime resolver.
exports.interfaceVersion = 2;
exports.resolve = (source, file) => {
  if (source !== 'npm:@supabase/supabase-js@2.110.8' ||
      !file.endsWith(path.join('supabase', 'functions', '_shared', 'platformAdmin.ts'))) {
    return { found: false };
  }
  try {
    const fromImporter = createRequire(file);
    if (fromImporter('@supabase/supabase-js/package.json').version !== '2.110.8') {
      return { found: false };
    }
    return { found: true, path: fromImporter.resolve('@supabase/supabase-js') };
  } catch {
    return { found: false };
  }
};
