/**
 * `ngTransclude` — the slot-marker directive (spec 018 Slice 5 /
 * FS §2.6, technical-considerations §2.7).
 *
 * `<div ng-transclude></div>` (or the element form
 * `<ng-transclude></ng-transclude>`) placed inside a transcluding
 * directive's manually-inserted template marks the location where the
 * captured content should be projected. The directive's post-link
 * function:
 *
 * 1. Walks `element.parentElement` to find the closest ancestor
 *    carrying the non-enumerable `$$ngBoundTransclude` stash that
 *    `compile.ts` writes for every transcluding host (Slice 3).
 * 2. Reads the slot name from `attrs.ngTransclude` — empty / missing
 *    means "default slot".
 * 3. Validates the slot is declared on the host before calling
 *    `$transclude`. The marker exclusively pre-validates so it can
 *    show its pre-existing children as fallback when the host
 *    explicitly rejects the request — calling `$transclude` first
 *    would invoke `cloneAttachFn([], scope)` for unfilled-optional
 *    slots, which the marker also treats as "keep fallback children",
 *    but mis-pointed slot names need the cleaner no-op-with-fallback
 *    path.
 * 4. Invokes `bound.fn(cloneAttachFn, null, slotName)`. The
 *    `cloneAttachFn` replaces the marker's pre-existing children with
 *    the projected clone when the clone is non-empty, and leaves them
 *    intact (fallback) when the clone is empty.
 *
 * Errors at every check route through `$exceptionHandler('$compile')`
 * and the marker becomes a no-op (pre-existing children preserved).
 * The entire post-link runs inside a defensive try/catch so a thrown
 * error from the `$transclude` call itself (which already routes its
 * own internal errors) does not propagate.
 *
 * `ngTransclude` is the FIRST built-in directive on `ngModule`. It
 * registers via the spec-017 `<name>Directive` provider pattern, so
 * `injector.has('ngTranscludeDirective') === true` is observable.
 *
 * @example
 * ```ts
 * $compileProvider.directive('myCard', () => ({
 *   transclude: true,
 *   link: (_scope, element) => {
 *     const template = document.createElement('div');
 *     template.innerHTML = '<h2>Card</h2><div ng-transclude></div>';
 *     element.appendChild(template);
 *     $compile(template)(_scope);
 *   },
 * }));
 * ```
 */

import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { NgTranscludeMisuseError, UndeclaredTranscludeSlotError } from './compile-error';
import type { BoundTranscludeFn } from './transclude-types';

/**
 * Internal narrow view of an Element augmented with the stashed
 * `$$ngBoundTransclude` slot. Mirrors the `NgManagedElement` pattern
 * in `cleanup.ts`.
 */
interface NgBoundElement extends Element {
  $$ngBoundTransclude?: BoundTranscludeFn;
}

function findBoundTransclude(element: Element): { host: Element; bound: BoundTranscludeFn } | null {
  let cursor: Element | null = element.parentElement;
  while (cursor !== null) {
    const bound = (cursor as NgBoundElement).$$ngBoundTransclude;
    if (bound !== undefined) {
      return { host: cursor, bound };
    }
    cursor = cursor.parentElement;
  }
  return null;
}

function resolveSlotName(attrs: Attributes): string | null {
  const raw = attrs['ngTransclude'];
  if (typeof raw !== 'string' || raw === '') {
    return null;
  }
  return raw;
}

/**
 * The factory body for `ngTransclude`. Injects `$exceptionHandler`
 * via the array-form `Invokable` so error routing matches every
 * other built-in registration pattern (spec 014).
 */
function ngTranscludeFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (_scope, element, attrs) => {
    try {
      const resolved = findBoundTransclude(element);
      if (resolved === null) {
        invokeExceptionHandler(
          $exceptionHandler,
          new NgTranscludeMisuseError(
            'ngTransclude must be used inside a directive declaring transclude: true | { … }',
          ),
          '$compile',
        );
        return;
      }

      const { bound } = resolved;
      const slotName = resolveSlotName(attrs);

      if (bound.kind === 'content' && slotName !== null) {
        invokeExceptionHandler(
          $exceptionHandler,
          new NgTranscludeMisuseError(
            `Slot "${slotName}" is not declared; transclude: true exposes only the default slot`,
          ),
          '$compile',
        );
        return;
      }

      if (bound.kind === 'slots' && slotName !== null) {
        const declared = bound.declaredSlots.some((s) => s.name === slotName);
        if (!declared) {
          // The host directive's name isn't on the public `BoundTranscludeFn`
          // shape today — Slice 5 widens it with `directiveName` so the
          // error message carries the meaningful host name (not the
          // marker's own name).
          const directiveName = bound.directiveName;
          invokeExceptionHandler(
            $exceptionHandler,
            new UndeclaredTranscludeSlotError(directiveName, slotName),
            '$compile',
          );
          return;
        }
      }

      bound.fn(
        (clone) => {
          if (clone.length === 0) {
            // Unfilled-optional path OR an error path that returned
            // []. Keep the marker's pre-existing children intact as
            // fallback (FS §2.6 acceptance — fallback content).
            return;
          }
          while (element.firstChild !== null) {
            element.removeChild(element.firstChild);
          }
          for (const node of clone) {
            element.appendChild(node);
          }
        },
        null,
        slotName,
      );
    } catch (err) {
      // Defense in depth — `bound.fn` already routes its own internal
      // errors. This catches anything unexpected (e.g. an underlying
      // DOM mutation throw) so the marker never crashes the
      // surrounding directive's link.
      invokeExceptionHandler($exceptionHandler, err, '$compile');
    }
  };

  return {
    restrict: 'EA',
    priority: 0,
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngTransclude', ngTranscludeDirective)`.
 * The factory injects `$exceptionHandler` so error reports route via
 * the spec-014 `invokeExceptionHandler` helper with cause `'$compile'`.
 */
export const ngTranscludeDirective: DirectiveFactory = ['$exceptionHandler', ngTranscludeFactory];
