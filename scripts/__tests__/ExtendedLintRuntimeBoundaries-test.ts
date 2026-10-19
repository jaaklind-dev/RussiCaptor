import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const importer = path.join(root, 'supabase/functions/_shared/platformAdmin.ts');
const resolverPath = path.join(root, 'scripts/lib/eslint-deno-npm-resolver.cjs');

describe('extended lint runtime boundaries', () => {
  test('exact Deno npm import resolves to the pinned installed package', () => {
    const result = spawnSync(process.execPath, ['-e', `
      const resolver=require(process.argv[1]);
      const result=resolver.resolve('npm:@supabase/supabase-js@2.110.8',process.argv[2]);
      if(!result.found || !require('node:fs').existsSync(result.path))process.exit(1);
      console.log(JSON.stringify(result));
    `, resolverPath, importer], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).found).toBe(true);
  });

  test.each([
    ['npm:@supabase/supabase-js@0.0.0', importer],
    ['npm:unapproved-package@1.0.0', importer],
    ['npm:@supabase/supabase-js@2.110.8', path.join(root, 'scripts/not-the-edge-helper.ts')],
  ])('resolver rejects unsupported binding %s', (source, file) => {
    const result = spawnSync(process.execPath, ['-e', `
      const resolver=require(process.argv[1]);
      console.log(JSON.stringify(resolver.resolve(process.argv[2],process.argv[3])));
    `, resolverPath, source, file], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ found: false });
  });

  test.each([
    ['npm:@supabase/supabase-js@2.110.8', true],
    ['npm:@supabase/supabase-js@0.0.0', false],
    ['npm:unapproved-package@1.0.0', false],
    ['./missing-local-module.ts', false],
  ])('actual ESLint keeps import/no-unresolved active for %s', (source, valid) => {
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/eslint/bin/eslint.js'),
      '--stdin', '--stdin-filename', importer, '--format', 'json'], {
      cwd: root, encoding: 'utf8', input: `import { createClient } from ${JSON.stringify(source)};\nconsole.log(createClient);\n`,
    });
    const diagnostics = JSON.parse(result.stdout).flatMap((file: { messages: { ruleId: string }[] }) => file.messages);
    expect(result.status).toBe(valid ? 0 : 1);
    expect(diagnostics.some((item: { ruleId: string }) => item.ruleId === 'import/no-unresolved')).toBe(!valid);
  });

  test('transformer self-resolution identifies the same CJS directory and source bytes', () => {
    const file = path.join(root, 'scripts/acceptance-profile-transformer.cjs');
    const result = spawnSync(process.execPath, ['-e', `
      const fs=require('node:fs'),path=require('node:path');
      const self=require.resolve(process.argv[1]);
      if(self!==fs.realpathSync(process.argv[1]))process.exit(1);
      console.log(path.resolve(path.dirname(self),'..'));
    `, file], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(fs.realpathSync(root));
  });
});
