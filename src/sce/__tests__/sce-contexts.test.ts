import { describe, expect, it } from 'vitest';

import { SCE_CONTEXTS, isValidSceContext } from '@sce/sce-contexts';

describe('SCE_CONTEXTS', () => {
  it('exposes the five public context identifiers', () => {
    expect(SCE_CONTEXTS.HTML).toBe('html');
    expect(SCE_CONTEXTS.URL).toBe('url');
    expect(SCE_CONTEXTS.RESOURCE_URL).toBe('resourceUrl');
    expect(SCE_CONTEXTS.JS).toBe('js');
    expect(SCE_CONTEXTS.CSS).toBe('css');
  });

  it('declares exactly five keys', () => {
    expect(Object.keys(SCE_CONTEXTS).sort()).toEqual(['CSS', 'HTML', 'JS', 'RESOURCE_URL', 'URL']);
  });

  it('is frozen at runtime so consumers cannot tamper with it', () => {
    expect(Object.isFrozen(SCE_CONTEXTS)).toBe(true);
  });
});

describe('isValidSceContext', () => {
  it('accepts every public context string', () => {
    expect(isValidSceContext('html')).toBe(true);
    expect(isValidSceContext('url')).toBe(true);
    expect(isValidSceContext('resourceUrl')).toBe(true);
    expect(isValidSceContext('js')).toBe(true);
    expect(isValidSceContext('css')).toBe(true);
  });

  it('rejects the internal `$$ANY$$` pseudo-context', () => {
    expect(isValidSceContext('$$ANY$$')).toBe(false);
  });

  it('rejects unknown strings', () => {
    expect(isValidSceContext('bogus')).toBe(false);
    expect(isValidSceContext('HTML')).toBe(false);
    expect(isValidSceContext('URL')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidSceContext('')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(isValidSceContext(null)).toBe(false);
    expect(isValidSceContext(undefined)).toBe(false);
    expect(isValidSceContext(42)).toBe(false);
    expect(isValidSceContext({})).toBe(false);
    expect(isValidSceContext([])).toBe(false);
    expect(isValidSceContext(true)).toBe(false);
    expect(isValidSceContext(false)).toBe(false);
  });
});
