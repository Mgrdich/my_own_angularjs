import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';

const mainConfig = {
  input: 'src/index.ts',
  output: [
    { file: 'dist/esm/index.mjs', format: 'es', sourcemap: true },
    { file: 'dist/cjs/index.cjs', format: 'cjs', sourcemap: true },
  ],
  external: ['tslib'],
  plugins: [
    resolve(),
    typescript({
      declaration: false,
      declarationDir: undefined,
    }),
  ],
};

const dtsConfig = {
  input: 'src/index.ts',
  output: [{ file: 'dist/types/index.d.ts', format: 'es' }],
  plugins: [dts()],
};

export default [mainConfig, dtsConfig];
