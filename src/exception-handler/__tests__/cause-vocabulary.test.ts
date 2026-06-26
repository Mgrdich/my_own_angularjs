/**
 * Locks the `$exceptionHandler` cause-descriptor vocabulary at the nine
 * tokens declared in FS § 2.13 (spec 014) plus `'$filter'` introduced by
 * spec 016 slice 4, `'$compile'` introduced by spec 017 slice 11, and the
 * `'$q'` / `'$timeout'` / `'$interval'` trio introduced by spec 037 slice 2.
 * The `length === 13` assertion is intentionally a "trap" — adding a
 * fourteenth cause is a public-API change that must update both
 * `EXCEPTION_HANDLER_CAUSES` and the FS § 2.13 vocabulary table in lockstep.
 *
 * The `satisfies ExceptionHandlerCause` block below is a compile-time guard
 * that fails `pnpm typecheck` if the const tuple and the derived union ever
 * drift apart.
 */

import { describe, expect, it } from 'vitest';

import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandlerCause } from '@exception-handler/index';

describe('EXCEPTION_HANDLER_CAUSES', () => {
  it('is frozen at runtime', () => {
    expect(Object.isFrozen(EXCEPTION_HANDLER_CAUSES)).toBe(true);
  });

  it('declares exactly thirteen cause descriptors', () => {
    // Lock-in trap: bumping this number is a public-API change that must
    // update FS § 2.13 in the same commit.
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });

  it('lists the thirteen tokens in declared order', () => {
    expect(EXCEPTION_HANDLER_CAUSES).toEqual([
      'watchFn',
      'watchListener',
      '$evalAsync',
      '$applyAsync',
      '$$postDigest',
      'eventListener',
      '$digest',
      '$interpolate',
      '$filter',
      '$compile',
      '$q',
      '$timeout',
      '$interval',
    ]);
  });

  it('contains the spec-017 $compile cause descriptor', () => {
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$compile');
  });

  it('contains the spec-037 async cause descriptors', () => {
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$q');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$timeout');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$interval');
  });

  it('locks each entry to the ExceptionHandlerCause union (compile-time)', () => {
    EXCEPTION_HANDLER_CAUSES[0] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[1] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[2] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[3] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[4] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[5] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[6] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[7] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[8] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[9] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[10] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[11] satisfies ExceptionHandlerCause;
    EXCEPTION_HANDLER_CAUSES[12] satisfies ExceptionHandlerCause;

    expect(true).toBe(true);
  });

  describe('mutation attempts throw in strict mode', () => {
    it('rejects push', () => {
      expect(() => {
        (EXCEPTION_HANDLER_CAUSES as unknown as string[]).push('newCause');
      }).toThrow(TypeError);
    });

    it('rejects index assignment', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bypass readonly tuple to verify runtime freeze
        (EXCEPTION_HANDLER_CAUSES as unknown as any[])[0] = 'mutated';
      }).toThrow(TypeError);
    });

    it('rejects pop', () => {
      expect(() => {
        (EXCEPTION_HANDLER_CAUSES as unknown as string[]).pop();
      }).toThrow(TypeError);
    });

    it('rejects splice', () => {
      expect(() => {
        (EXCEPTION_HANDLER_CAUSES as unknown as string[]).splice(0, 1);
      }).toThrow(TypeError);
    });
  });
});
