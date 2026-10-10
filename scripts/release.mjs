// Build the Argus packages into publish-ready npm tarballs. Publishes nothing.
//   npm run release:build
// Output: release/<name>/ (package.json, dist, README, LICENSE) and release/<name>-<version>.tgz
// Dev code imports workspace packages as @argus/*; published packages use the unscoped names below.
// Change NAMES to publish under another scope or names.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release');

/** Dev name -> published name */
const NAMES = {
  '@argus/scoring': 'argus-x402-scoring',
  '@argus/sdk': 'argus-x402-sdk',
  '@argus/middleware': 'argus-x402-middleware',
  '@argus/mcp': 'argus-x402-mcp',
};

/** Build order matters: a package is built after the ones it depends on. */
const PACKAGES = [
  { dir: 'packages/scoring', lib: ['src/index.ts'], bin: {}, keywords: ['sybil', 'x402', 'monad', 'erc-8004', 'attestation'] },
  { dir: 'packages/sdk', lib: ['src/index.ts'], bin: { 'argus-x402': 'src/cli.ts' }, keywords: ['sybil', 'x402', 'monad', 'erc-8004', 'reputation', 'agents'] },
  { dir: 'packages/middleware', lib: ['src/index.ts', 'src/hono.ts', 'src/next.ts'], bin: {}, keywords: ['x402', 'express', 'hono', 'nextjs', 'promo', 'sybil', 'monad'] },
  { dir: 'packages/mcp', lib: ['src/server.ts'], bin: { 'argus-x402-mcp': 'src/main.ts' }, keywords: ['mcp', 'model-context-protocol', 'agents', 'erc-8004', 'monad'] },
];

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`);
};
const rewrite = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) rewrite(p);
    else if (/\.(js|mjs|cjs|ts|mts|cts|map)$/.test(f)) {
      let s = readFileSync(p, 'utf8');
      for (const [dev, pub] of Object.entries(NAMES)) s = s.split(`'${dev}'`).join(`'${pub}'`).split(`"${dev}"`).join(`"${pub}"`);
      writeFileSync(p, s);
    }
  }
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tgz = [];
/** Workspace name -> version, so a package depends on the real version of each internal dependency. */
const versions = Object.fromEntries(PACKAGES.map((p) => {
  const j = JSON.parse(readFileSync(join(root, p.dir, 'package.json'), 'utf8'));
  return [j.name, j.version];
}));

for (const p of PACKAGES) {
  const src = join(root, p.dir);
  const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
  const name = NAMES[pkg.name];
  const stage = join(out, name);
  console.log(`\n== ${pkg.name} -> ${name}`);
  mkdirSync(stage, { recursive: true });

  // library entries with type declarations
  run('npx', ['tsup', ...p.lib, '--format', 'esm', '--dts', '--target', 'node20', '--sourcemap', '--clean', '--out-dir', join(stage, 'dist')], src);
  // executables, with a shebang
  for (const entry of Object.values(p.bin)) {
    run('npx', ['tsup', entry, '--format', 'esm', '--target', 'node20', '--out-dir', join(stage, 'dist')], src);
    const file = join(stage, 'dist', entry.split('/').pop().replace(/\.ts$/, '.js'));
    // the source file carries a dev shebang (tsx); the published file must run on plain node
    const body = readFileSync(file, 'utf8').replace(/^#!.*\r?\n/, '');
    writeFileSync(file, `#!/usr/bin/env node\n${body}`);
  }
  rewrite(join(stage, 'dist'));

  const main = './dist/' + p.lib[0].split('/').pop().replace(/\.ts$/, '.js');
  const types = main.replace(/\.js$/, '.d.ts');
  const deps = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {}).map(([d, v]) => (NAMES[d] ? [NAMES[d], `^${versions[d]}`] : [d, v])),
  );
  const published = {
    name,
    version: pkg.version,
    description: pkg.description,
    keywords: p.keywords,
    license: 'MIT',
    type: 'module',
    main,
    types,
    exports: Object.fromEntries(p.lib.map((entry, i) => {
      const js = './dist/' + entry.split('/').pop().replace(/.ts$/, '.js');
      const key = i === 0 ? '.' : './' + entry.split('/').pop().replace(/.ts$/, '');
      return [key, { types: js.replace(/.js$/, '.d.ts'), import: js }];
    })),
    ...(Object.keys(p.bin).length ? { bin: Object.fromEntries(Object.entries(p.bin).map(([b, e]) => [b, 'dist/' + e.split('/').pop().replace(/\.ts$/, '.js')])) } : {}),
    files: ['dist', 'README.md', 'LICENSE'],
    dependencies: Object.fromEntries(Object.entries(deps).sort()),
    ...(pkg.peerDependencies ? { peerDependencies: pkg.peerDependencies } : {}),
    ...(pkg.peerDependenciesMeta ? { peerDependenciesMeta: pkg.peerDependenciesMeta } : {}),
    engines: { node: '>=20.12' },
    repository: { type: 'git', url: 'git+https://github.com/Rohitamalraj/Argus.git', directory: p.dir },
    homepage: 'https://github.com/Rohitamalraj/Argus#readme',
    bugs: { url: 'https://github.com/Rohitamalraj/Argus/issues' },
    publishConfig: { access: 'public' },
  };
  writeFileSync(join(stage, 'package.json'), JSON.stringify(published, null, 2) + '\n');
  for (const f of ['README.md']) if (existsSync(join(src, f))) cpSync(join(src, f), join(stage, f));
  cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  // the tarball is named by npm pack
  run('npm', ['pack', '--pack-destination', out], stage);
  tgz.push(name);
}
console.log(`\nBuilt ${tgz.length} packages in ${out} (root version ${rootPkg.version ?? 'n/a'}):`);
for (const f of readdirSync(out).filter((x) => x.endsWith('.tgz'))) console.log('  ' + f);
console.log('\nNothing was published. To publish, in order: scoring, sdk, middleware, mcp:');
console.log('  cd release/<name> && npm publish');
