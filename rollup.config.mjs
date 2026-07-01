import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

// Per-entry bundle definitions. Each entry produces its own ESM + CJS bundle
// plus a matching .d.ts file so the `package.json` `exports` map resolves.
//
// Note: each subpath bundle is built independently of the root, meaning any
// shared internal modules (e.g. utilities pulled in by multiple entries) will
// be inlined per bundle. That duplication is acceptable for a library where
// the root import is the primary entry point and subpath imports are rare;
// keeping each bundle self-contained is simpler to reason about than marking
// cross-subpath internals external.
//
// `compiler` is included even though it currently just re-exports `{}`, so the
// `./compiler` exports map entry resolves to a real file rather than failing
// at runtime for any consumer who happens to import it.
//
// Heap note: all 16 bundle configs (each running a full @rollup/plugin-typescript
// program typecheck) plus 16 dts configs run in a single rollup process, so peak
// memory grows with the entry count. Once the 16th entry (http) was added the
// process tipped over V8's default ~4GB old-space ceiling and crashed with
// "Ineffective mark-compacts near heap limit". The `package.json` "build" script
// therefore launches rollup via `node --max-old-space-size=8192` to raise the
// heap limit; keep that flag (or bump it) when adding further entries.
const entries = [
  { name: 'index', input: 'src/index.ts' },
  { name: 'core/index', input: 'src/core/index.ts' },
  { name: 'di/index', input: 'src/di/index.ts' },
  { name: 'parser/index', input: 'src/parser/index.ts' },
  { name: 'compiler/index', input: 'src/compiler/index.ts' },
  { name: 'interpolate/index', input: 'src/interpolate/index.ts' },
  { name: 'sce/index', input: 'src/sce/index.ts' },
  { name: 'sanitize/index', input: 'src/sanitize/index.ts' },
  { name: 'exception-handler/index', input: 'src/exception-handler/index.ts' },
  { name: 'filter/index', input: 'src/filter/index.ts' },
  { name: 'template/index', input: 'src/template/index.ts' },
  { name: 'controller/index', input: 'src/controller/index.ts' },
  { name: 'bootstrap/index', input: 'src/bootstrap/index.ts' },
  { name: 'async/index', input: 'src/async/index.ts' },
  { name: 'cache/index', input: 'src/cache/index.ts' },
  { name: 'http/index', input: 'src/http/index.ts' },
  { name: 'forms/index', input: 'src/forms/index.ts' },
];

// Path aliases declared in `tsconfig.json` are used across the codebase
// (e.g. `@core/utils`, `@interpolate/interpolate-provider`). `rollup-plugin-dts`
// does not read them from `tsconfig.json` automatically — we mirror them here
// with an explicit `baseUrl` so the declaration bundler can follow cross-module
// type imports and emit fully self-contained `.d.ts` files. The JS transform
// via `@rollup/plugin-typescript` already reads these from `tsconfig.json`.
const tsPathAliases = {
  '@core/*': ['src/core/*'],
  '@parser/*': ['src/parser/*'],
  '@di/*': ['src/di/*'],
  '@interpolate/*': ['src/interpolate/*'],
  '@sce/*': ['src/sce/*'],
  '@sanitize/*': ['src/sanitize/*'],
  '@exception-handler/*': ['src/exception-handler/*'],
  '@filter/*': ['src/filter/*'],
  '@compiler/*': ['src/compiler/*'],
  '@template/*': ['src/template/*'],
  '@controller/*': ['src/controller/*'],
  '@bootstrap/*': ['src/bootstrap/*'],
  '@async/*': ['src/async/*'],
  '@cache/*': ['src/cache/*'],
  '@http/*': ['src/http/*'],
  '@forms/*': ['src/forms/*'],
};

const bundleConfigs = entries.map((entry) => ({
  input: entry.input,
  output: [
    { file: `dist/esm/${entry.name}.mjs`, format: 'es', sourcemap: true },
    { file: `dist/cjs/${entry.name}.cjs`, format: 'cjs', sourcemap: true },
  ],
  external: ['tslib'],
  plugins: [
    resolve(),
    typescript({
      declaration: false,
      declarationDir: undefined,
    }),
  ],
}));

const dtsConfigs = entries.map((entry) => ({
  input: entry.input,
  output: [{ file: `dist/types/${entry.name}.d.ts`, format: 'es' }],
  plugins: [
    dts({
      compilerOptions: {
        baseUrl: '.',
        paths: tsPathAliases,
      },
    }),
  ],
}));

export default [...bundleConfigs, ...dtsConfigs];
