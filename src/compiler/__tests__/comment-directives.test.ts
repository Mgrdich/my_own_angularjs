/**
 * `$compile` comment-restricted directive tests (Slice 7 / FS §2.5 + §2.14).
 *
 * Locks the AngularJS-canonical comment-matching surface on the
 * directive collector and tree walker:
 *
 * - `<!-- directive: my-dir -->` matches a directive registered
 *   under `myDir` with `restrict: 'M'`; the post-link fires and
 *   `attrs.myDir === ''`.
 * - Trailing-value form `<!-- directive: my-dir hello world -->`
 *   exposes the trimmed trailing text as `attrs.myDir`.
 * - No-space-after-colon form `<!-- directive:my-dir hello -->`
 *   matches — whitespace around the colon is optional.
 * - Leading/trailing whitespace inside the comment text is trimmed
 *   before parsing (`<!--   directive: my-dir   -->`).
 * - Non-directive comments (`<!-- not a directive -->`) and
 *   case-mismatched prefixes (`<!-- DIRECTIVE: my-dir -->`) do NOT
 *   match — the regex is case-sensitive on `directive:` per FS §2.14.
 * - Without `'M'` in `restrict`, comment matching is filtered out.
 * - The comment node IS passed to link as `element`, so directives
 *   that need to insert siblings call
 *   `comment.parentNode?.insertBefore(...)`.
 * - Multiple comment directives in the same parent each match
 *   independently and run in document order.
 * - `$compile(commentNode)(scope)` accepts a `Comment` directly so
 *   comment-restricted directives can be compiled out of context.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { $CompileProvider } from '@compiler/compile-provider';
import type { Attributes, CompileService, DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
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

describe('$compile — comment-restricted directives (FS §2.14)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('`<!-- directive: my-dir -->` matches `restrict: "M"`; post-link fires; `attrs.myDir === ""`', () => {
    let captured: Attributes | undefined;
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    const comment = document.createComment(' directive: my-dir ');
    parent.appendChild(comment);

    $compile(parent)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('');
  });

  it('trailing value `<!-- directive: my-dir hello world -->` populates `attrs.myDir === "hello world"`', () => {
    let captured: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: (_scope, _element, attrs) => {
            captured = attrs;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: my-dir hello world '));

    $compile(parent)(Scope.create());

    expect(captured?.['myDir']).toBe('hello world');
  });

  it('no-space-after-colon `<!-- directive:my-dir hello -->` matches; `attrs.myDir === "hello"`', () => {
    let captured: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: (_scope, _element, attrs) => {
            captured = attrs;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive:my-dir hello '));

    $compile(parent)(Scope.create());

    expect(captured?.['myDir']).toBe('hello');
  });

  it('leading/trailing comment-text whitespace is trimmed; `<!--   directive: my-dir   -->` matches', () => {
    let captured: Attributes | undefined;
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment('   directive: my-dir   '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('');
  });

  it('non-directive comment `<!-- not a directive -->` does NOT match', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' not a directive '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(false);
  });

  it('case-sensitive on `directive:` — `<!-- DIRECTIVE: my-dir -->` does NOT match', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' DIRECTIVE: my-dir '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(false);
  });

  it('without `"M"` in `restrict`, comment is skipped (`restrict: "EAC"` ignores comments)', () => {
    let fired = false;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'EAC',
          link: () => {
            fired = true;
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: my-dir '));

    $compile(parent)(Scope.create());

    expect(fired).toBe(false);
  });

  it('comment directive can mutate via `parentNode` (e.g. insert a sibling)', () => {
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'insertSibling',
        ddoFactory({
          restrict: 'M',
          link: (_scope, element) => {
            const sibling = document.createElement('div');
            sibling.className = 'inserted';
            // `element` IS the matched Comment node — directives that
            // need to insert siblings reach for `parentNode`.
            element.parentNode?.insertBefore(sibling, element);
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: insert-sibling '));

    $compile(parent)(Scope.create());

    expect(parent.querySelectorAll('div.inserted')).toHaveLength(1);
  });

  it('multiple comment directives in the same parent both fire in document order', () => {
    const fired: string[] = [];

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'a',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired.push('a');
          },
        }),
      );
      $cp.directive(
        'b',
        ddoFactory({
          restrict: 'M',
          link: () => {
            fired.push('b');
          },
        }),
      );
    });

    const parent = document.createElement('div');
    parent.appendChild(document.createComment(' directive: a '));
    parent.appendChild(document.createComment(' directive: b '));

    $compile(parent)(Scope.create());

    expect(fired).toEqual(['a', 'b']);
  });

  it('`$compile(commentNode)(scope)` accepts a `Comment` directly without a wrapping element', () => {
    let fired = false;
    let captured: Attributes | undefined;

    const $compile = compileWith(($cp) => {
      $cp.directive(
        'myDir',
        ddoFactory({
          restrict: 'M',
          link: (_scope, _element, attrs) => {
            fired = true;
            captured = attrs;
          },
        }),
      );
    });

    const comment = document.createComment(' directive: my-dir top-level ');

    $compile(comment)(Scope.create());

    expect(fired).toBe(true);
    expect(captured?.['myDir']).toBe('top-level');
  });
});
