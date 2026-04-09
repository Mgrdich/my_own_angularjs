import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-duplicate-imports': 'error',
    },
  },
  {
    ignores: ['dist/', 'legacy/', 'node_modules/', 'coverage/'],
  },
);
