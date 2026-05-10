/**
 * Camel-case → kebab-case conversion for attribute names.
 *
 * Used by `AttributesImpl.$set` (spec 017 Slice 8) when the attribute
 * being written is NOT present in `$attr` — i.e., the directive is
 * creating an attribute that did not exist on the source DOM element.
 * The DOM-form name is derived from the camelCase identifier by
 * lowercasing each uppercase letter and prefixing it with `-` (skipping
 * the very first character so a leading uppercase becomes lowercase
 * without a leading hyphen).
 *
 * Memoized in a private `Map<string, string>` keyed by the raw
 * camelCase input — repeated lookups for the same name return the
 * cached kebab-case result without re-running the regex. The hot-path
 * matters because every `$set` on an attribute-not-yet-in-`$attr`
 * goes through this helper.
 *
 * @example
 * ```ts
 * camelToKebab('href');     // 'href'
 * camelToKebab('myAttr');   // 'my-attr'
 * camelToKebab('aBcDeF');   // 'a-bc-de-f'
 * camelToKebab('Foo');      // 'foo' (leading uppercase becomes lowercase, no hyphen)
 * ```
 */

const KEBAB_REGEXP = /[A-Z]/g;

const cache = new Map<string, string>();

/**
 * Converts a camelCase identifier to its kebab-case DOM-form spelling.
 * Memoized on the raw input.
 */
export function camelToKebab(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const result = name.replace(KEBAB_REGEXP, (match: string, idx: number) =>
    idx === 0 ? match.toLowerCase() : `-${match.toLowerCase()}`,
  );
  cache.set(name, result);
  return result;
}
