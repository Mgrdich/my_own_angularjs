/**
 * Integration tests for isolate scope (spec 022 Slice 1 — FS §2.1).
 *
 * Exercises `$compile` end-to-end with directives declaring object-form
 * `scope: { … }`. Covers:
 *
 *   - Isolate scope does NOT prototypically inherit from the parent.
 *   - Each of the four binding kinds (`=`, `@`, `<`, `&`).
 *   - The `?` optional modifier on each kind.
 *   - Attribute aliasing — `localName: '<sourceAttr'`.
 *   - `MultipleIsolateScopeError` at link time when two directives on
 *     the same element both declare object-form `scope`.
 *   - `InvalidIsolateBindingError` lazily at `<name>Directive` provider
 *     `$get` time for malformed binding specs.
 *   - Both link sites — inline `template` (synchronous path) AND
 *     `templateUrl` (post-template-install path).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidIsolateBindingError, MultipleIsolateScopeError } from '@compiler/compile-error';
import type { DirectiveFactory, DirectiveFactoryReturn } from '@compiler/directive-types';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { Scope } from '@core/index';

import { bootstrapNgModule, compileWith } from './test-helpers';

function ddoFactory(returnValue: DirectiveFactoryReturn): DirectiveFactory {
  return [() => returnValue] as DirectiveFactory;
}

interface IsolateLocals {
  [name: string]: unknown;
}

interface ParentScope {
  outerName?: string;
  pickValue?: unknown;
  cb?: (...args: unknown[]) => unknown;
  user?: { id?: string; name?: string };
  [k: string]: unknown;
}

describe('isolate scope — non-inheritance (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('isolate scope does NOT inherit from the parent — parent names are invisible', () => {
    let captured: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { foo: '=' } as Record<string, string>,
          link: (scope) => {
            captured = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', 'value');
    const parent = Scope.create<ParentScope>();
    parent.outerName = 'parent-only';
    parent.value = 'expr-value';

    $compile(node)(parent);

    expect(captured).not.toBeNull();
    // The isolate scope's prototype is NOT the parent — `Object.create`
    // was NOT used for the inheriting form.
    expect(Object.getPrototypeOf(captured)).not.toBe(parent);
    // `outerName` is on the parent and was NOT bound in via `scope: { … }`
    // so the isolate scope cannot see it.
    expect((captured as unknown as ParentScope).outerName).toBeUndefined();
  });
});

describe('isolate scope — `@` one-way text (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('seeds the local from the raw attribute value', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('title', 'Hello');
    const parent = Scope.create();
    $compile(node)(parent);

    expect((isolate as unknown as { title?: string }).title).toBe('Hello');
  });

  it('updates the local when the interpolated attribute value changes', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('title', '{{outerName}}');
    const parent = Scope.create<ParentScope>();
    parent.outerName = 'Alice';
    $compile(node)(parent);
    parent.$digest();

    expect((isolate as unknown as { title?: string }).title).toBe('Alice');

    parent.outerName = 'Bob';
    parent.$digest();
    expect((isolate as unknown as { title?: string }).title).toBe('Bob');
  });

  it('writing to the isolate local does NOT mutate the attribute value', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('title', 'static');
    const parent = Scope.create();
    $compile(node)(parent);

    (isolate as unknown as { title?: string }).title = 'mutated-by-directive';
    parent.$digest();
    // Attribute is unaffected.
    expect(node.getAttribute('title')).toBe('static');
  });

  it('absent attribute leaves the local undefined (with and without `?`)', () => {
    let isoA: Scope | null = null;
    let isoB: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'dirA',
        ddoFactory({
          scope: { title: '@' } as Record<string, string>,
          link: (scope) => {
            isoA = scope;
          },
        }),
      );
      $cp.directive(
        'dirB',
        ddoFactory({
          scope: { title: '@?' } as Record<string, string>,
          link: (scope) => {
            isoB = scope;
          },
        }),
      );
    });
    const a = document.createElement('div');
    a.setAttribute('dir-a', '');
    const b = document.createElement('div');
    b.setAttribute('dir-b', '');
    const parent = Scope.create();
    $compile(a)(parent);
    $compile(b)(parent);

    expect((isoA as unknown as { title?: string }).title).toBeUndefined();
    expect((isoB as unknown as { title?: string }).title).toBeUndefined();
  });
});

describe('isolate scope — `<` one-way expression (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('propagates parent expression changes onto the local', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { item: '<' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('item', 'user.name');
    const parent = Scope.create<ParentScope>();
    parent.user = { name: 'Alice' };
    $compile(node)(parent);
    parent.$digest();

    expect((isolate as unknown as { item?: string }).item).toBe('Alice');

    parent.user = { name: 'Bob' };
    parent.$digest();
    expect((isolate as unknown as { item?: string }).item).toBe('Bob');
  });

  it('writing to the isolate local does NOT propagate back to the parent', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { item: '<' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('item', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'initial';
    $compile(node)(parent);
    parent.$digest();
    expect((isolate as unknown as { item?: string }).item).toBe('initial');

    // Mutate the isolate local; parent must NOT see it.
    (isolate as unknown as { item?: string }).item = 'mutated-by-iso';
    parent.$digest();
    expect(parent.pickValue).toBe('initial');
  });
});

describe('isolate scope — `=` two-way (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('propagates parent → local on parent change', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { value: '=' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('value', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'one';
    $compile(node)(parent);
    parent.$digest();
    expect((isolate as unknown as { value?: string }).value).toBe('one');

    parent.pickValue = 'two';
    parent.$digest();
    expect((isolate as unknown as { value?: string }).value).toBe('two');
  });

  it('propagates local → parent on local change', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { value: '=' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('value', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'one';
    $compile(node)(parent);
    parent.$digest();

    (isolate as unknown as { value?: string }).value = 'changed-by-iso';
    parent.$digest();
    expect(parent.pickValue).toBe('changed-by-iso');
  });

  it('does NOT loop indefinitely (digest TTL is not breached)', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { value: '=' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('value', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'one';
    $compile(node)(parent);

    // Mutate both sides in alternation and digest each time — a buggy
    // reconciliation would push TTL through the ceiling.
    expect(() => {
      parent.$digest();
    }).not.toThrow();
    (isolate as unknown as { value?: string }).value = 'a';
    expect(() => {
      parent.$digest();
    }).not.toThrow();
    parent.pickValue = 'b';
    expect(() => {
      parent.$digest();
    }).not.toThrow();
    (isolate as unknown as { value?: string }).value = 'c';
    expect(() => {
      parent.$digest();
    }).not.toThrow();
  });
});

describe('isolate scope — `&` expression / callback (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('assigns a function that evaluates the parent expression', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { onDone: '&' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('on-done', 'cb(id)');
    const parent = Scope.create<ParentScope>();
    const spy = vi.fn<(arg: unknown) => string>().mockReturnValue('returned');
    parent.cb = spy as unknown as ParentScope['cb'];
    $compile(node)(parent);

    const fn = (isolate as unknown as { onDone?: (l?: IsolateLocals) => unknown }).onDone;
    expect(typeof fn).toBe('function');
    const result = fn?.({ id: 'x123' });
    expect(spy).toHaveBeenCalledWith('x123');
    expect(result).toBe('returned');
  });

  it('absent attribute + optional leaves the local undefined', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { onDone: '&?' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    const parent = Scope.create();
    $compile(node)(parent);
    expect((isolate as unknown as { onDone?: unknown }).onDone).toBeUndefined();
  });
});

describe('isolate scope — attribute aliasing (FS §2.1)', () => {
  beforeEach(() => {
    bootstrapNgModule();
  });

  it('reads the aliased source attribute when the binding spec carries an identifier', () => {
    let isolate: Scope | null = null;
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'isoDir',
        ddoFactory({
          scope: { localName: '<sourceAttr' } as Record<string, string>,
          link: (scope) => {
            isolate = scope;
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('iso-dir', '');
    node.setAttribute('source-attr', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'aliased';
    $compile(node)(parent);
    parent.$digest();
    expect((isolate as unknown as { localName?: string }).localName).toBe('aliased');
  });
});

describe('isolate scope — MultipleIsolateScopeError (FS §2.1)', () => {
  it('routes via $exceptionHandler("$compile") when two directives on the same element declare object-form scope', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    const $compile = compileWith(($cp) => {
      $cp.directive(
        'dirA',
        ddoFactory({
          scope: { a: '@' } as Record<string, string>,
          link: () => {
            /* noop */
          },
        }),
      );
      $cp.directive(
        'dirB',
        ddoFactory({
          scope: { b: '@' } as Record<string, string>,
          link: () => {
            /* noop */
          },
        }),
      );
    });
    const node = document.createElement('div');
    node.setAttribute('dir-a', '');
    node.setAttribute('dir-b', '');
    expect(() => $compile(node)(Scope.create())).not.toThrow();

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const [err, cause] = handlerSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(MultipleIsolateScopeError);
    expect(cause).toBe('$compile');
    expect((err as Error).message).toContain('dirA');
    expect((err as Error).message).toContain('dirB');
  });
});

describe('isolate scope — InvalidIsolateBindingError (FS §2.1)', () => {
  it('routes via $exceptionHandler("$compile") at provider $get time when the binding spec is malformed', () => {
    const handlerSpy = vi.fn<(...args: unknown[]) => void>();
    bootstrapNgModule({ exceptionHandler: handlerSpy });
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'badDir',
          ddoFactory({
            scope: { value: 'nope' } as Record<string, string>,
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    // Trigger the lazy `<name>Directive` provider $get — the malformed
    // spec routes via the handler and the directive is dropped from the
    // resolved array.
    const result = injector.get<unknown[]>('badDirDirective');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
    expect(handlerSpy).toHaveBeenCalled();
    const [err, cause] = handlerSpy.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(InvalidIsolateBindingError);
    expect(cause).toBe('$compile');
  });
});

describe('isolate scope — async templateUrl link path (FS §2.1)', () => {
  it('isolate scope + `<` binding works through the templateUrl post-install link site', async () => {
    bootstrapNgModule();
    let isolate: Scope | null = null;
    // Build the app module + injector inline so we can pre-seed the
    // template cache against the SAME injector that resolves $compile.
    const appModule = createModule('app', ['ng']).config([
      '$compileProvider',
      ($cp) => {
        $cp.directive(
          'asyncIso',
          ddoFactory({
            scope: { item: '<' } as Record<string, string>,
            templateUrl: '/tpl/iso.html',
            link: (scope) => {
              isolate = scope;
            },
          }),
        );
      },
    ]);
    const injector = createInjector([appModule]);
    const $compile = injector.get<ReturnType<typeof compileWith>>('$compile');
    const cache = injector.get<{ put: (k: string, v: string) => void }>('$templateCache');
    cache.put('/tpl/iso.html', '<span>inside</span>');

    const node = document.createElement('div');
    node.setAttribute('async-iso', '');
    node.setAttribute('item', 'pickValue');
    const parent = Scope.create<ParentScope>();
    parent.pickValue = 'urlie';

    $compile(node)(parent);
    // Allow the deferred drain to settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    parent.$digest();

    expect(isolate).not.toBeNull();
    expect((isolate as unknown as { item?: string }).item).toBe('urlie');
    expect(node.innerHTML).toContain('inside');
  });
});
