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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: 'Parent directory imports (../) are not allowed. Use @core/* alias instead.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
);
