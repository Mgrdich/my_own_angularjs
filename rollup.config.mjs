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
const entries = [
  { name: 'index', input: 'src/index.ts' },
  { name: 'core/index', input: 'src/core/index.ts' },
  { name: 'di/index', input: 'src/di/index.ts' },
  { name: 'parser/index', input: 'src/parser/index.ts' },
  { name: 'compiler/index', input: 'src/compiler/index.ts' },
  { name: 'interpolate/index', input: 'src/interpolate/index.ts' },
  { name: 'sce/index', input: 'src/sce/index.ts' },
  { name: 'sanitize/index', input: 'src/sanitize/index.ts' },
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
