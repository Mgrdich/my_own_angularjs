/**
 * `$compile` class-restricted directive tests (Slice 6 / FS §2.5 + §2.15).
 *
 * Locks the AngularJS-canonical class-matching surface on the
 * directive collector:
 *
 * - Bare class form `<div class="my-dir">` matches `restrict: 'C'`
 *   and produces `attrs.myDir === ''`.
 * - Class-with-value form `<div class="my-dir: value;">` exposes the
 *   value as `attrs.myDir === 'value'`. Multiple `name: value;`
 *   pairs in a single attribute parse independently.
 * - Whitespace inside the class-with-value form is trimmed on both
 *   sides of the colon and the semicolon.
 * - Without `'C'` in `restrict`, class-name matches are ignored —
 *   `restrict: 'EA'` skips the class pass entirely on a node that
 *   has no matching attribute.
 * - Class names normalize via the same prefix/separator rules as
 *   attributes: `<div class="data-my-dir">` matches `myDir`.
 * - An empty `class=""` attribute is a no-op (no parsing attempted).
 * - `restrict: 'C'` alone does NOT match attribute syntax — the
 *   collector keeps the four restrict letters strictly partitioned.
 *
 * Mixed class + attribute on the same node (`restrict: 'CA'`) — the
 * collector matches BOTH the attribute pass and the class pass, so
 * the same directive object is appended TWICE to the matched list.
 * This test locks that behavior with an inline comment so future
 * refactors are deliberate.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type {
  Attributes,
  CompileService,
  DirectiveFactory,
  DirectiveFactoryReturn,
} from '@compiler/directive-types';
import { Scope } from '@core/index';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

function bootstrapNgModule(): void {
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => () => undefined])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    .provider('$compile', ['$provide', $CompileProvider]);
}

function compileWith(register: ($cp: $CompileProvider) => void): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([appModule]).get('$compile');
}

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

describe('$compile — class-restricted directives (FS §2.15)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('bare class name matches a `restrict: "C"` directive and exposes `attrs.myDir === ""`', () => {
    let captured: Attributes | undefined;
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-dir');

    $compile(node)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('');
    expect(captured?.$attr['myDir']).toBe('my-dir');
  });

  it('one matching class among many is recognized', () => {
    let captured: Attributes | undefined;
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'foo my-dir bar');

    $compile(node)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('');
  });

  it('class-with-value form `class="my-dir: hello;"` populates `attrs.myDir === "hello"`', () => {
    let captured: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            captured = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-dir: hello;');

    $compile(node)(Scope.create());

    expect(captured?.['myDir']).toBe('hello');
    expect(captured?.$attr['myDir']).toBe('my-dir');
  });

  it('multiple class-value pairs in one attribute are parsed independently', () => {
    let myDirAttrs: Attributes | undefined;
    let otherAttrs: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            myDirAttrs = attrs;
          },
        }),
      );
      $cp.directive(
        'other',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            otherAttrs = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-dir: a; other: b;');

    $compile(node)(Scope.create());

    // Both directives received the SAME shared `Attributes` instance,
    // so we can read both keys off either reference.
    expect(myDirAttrs?.['myDir']).toBe('a');
    expect(myDirAttrs?.['other']).toBe('b');
    expect(otherAttrs).toBe(myDirAttrs);
  });

  it('whitespace inside class-with-value is trimmed on both sides of the colon', () => {
    let captured: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            captured = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-dir : hello ;');

    $compile(node)(Scope.create());

    expect(captured?.['myDir']).toBe('hello');
  });

  it('without `"C"` in `restrict`, a class-name match does NOT fire (`restrict: "EA"` is ignored)', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'EA',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'my-dir');
    // No `my-dir` attribute — only the class. With `restrict: 'EA'`
    // there is no path that matches.

    $compile(node)(Scope.create());

    expect(fired).toBe(false);
  });

  it('class-name normalization respects the AngularJS prefix rules: `data-my-dir` → `myDir`', () => {
    let captured: Attributes | undefined;
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', 'data-my-dir');

    $compile(node)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('');
    // `$attr` records the ORIGINAL un-normalized class spelling
    // (including the `data-` prefix).
    expect(captured?.$attr['myDir']).toBe('data-my-dir');
  });

  it('mixed class + attribute on the same node — `restrict: "CA"` matches under BOTH passes (directive appended twice)', () => {
    // Both the attribute pass and the class pass append the SAME
    // Directive object to the matched list, so the directive's link
    // function fires TWICE on the node. This locks the current
    // collector behavior — AngularJS itself dedupes via priority +
    // an internal `addAttrs` short-circuit, so a future spec slice
    // may revisit. The inline counter test guards against silent
    // regressions in either direction.
    let count = 0;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'CA',
          link: () => {
            count += 1;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    node.setAttribute('class', 'my-dir');

    $compile(node)(Scope.create());

    expect(count).toBe(2);
  });

  it('empty `class=""` attribute is a no-op (no parsing, no errors)', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('class', '');

    expect(() => {
      $compile(node)(Scope.create());
    }).not.toThrow();
    expect(fired).toBe(false);
  });

  it('`restrict: "C"` alone does NOT match attribute syntax `<div my-dir>`', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'C',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const node = document.createElement('div');
    node.setAttribute('my-dir', '');
    // No `class` attribute.

    $compile(node)(Scope.create());

    expect(fired).toBe(false);
  });
});
