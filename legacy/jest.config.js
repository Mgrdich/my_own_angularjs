/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  modulePaths: ['node_modules', 'src'],
  moduleFileExtensions: ['ts', 'js'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts|js)?$',
  transform: {
    '^.+\\.(ts|js)?$': 'ts-jest',
  },
  modulePathIgnorePatterns: ['dist/*'],
};
