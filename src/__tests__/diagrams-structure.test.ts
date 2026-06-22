/**
 * Structural guard for the `context/diagrams/` collection (spec 035 Slice 1).
 *
 * This test validates the SHAPE of the service-diagram docs, not their prose:
 * it GLOB-DISCOVERS every `*.md` file in `context/diagrams/` (so future slices
 * adding diagram files are covered with zero edits here) and asserts, per file:
 *
 *  - the index `README.md` exists;
 *  - every non-index file carries all five required section headings IN ORDER;
 *  - every relative `*.md` link in a file resolves to an existing sibling file;
 *  - the file is linked from `README.md`;
 *  - `CLAUDE.md` carries a `context/diagrams/<filename>` discoverability row.
 *
 * It deliberately imports NO `src/` runtime module — it reads files via
 * `node:fs` from the repo root (`process.cwd()`), so it has zero coverage
 * impact on the 90% line-coverage gate.
 *
 * The project intentionally ships no `@types/node`, so the tiny slice of the
 * Node filesystem / path / process surface this test touches is typed inline
 * below via ambient `declare module` blocks. Keeping the declarations local
 * (rather than adding a dev-dependency) is the minimal change that satisfies
 * `strict` typecheck and the `strictTypeChecked` ESLint preset without
 * perturbing the build.
 */

import { describe, expect, it } from 'vitest';

interface NodeFsModule {
  readFileSync(filePath: string, encoding: 'utf8'): string;
  readdirSync(dirPath: string): string[];
  existsSync(filePath: string): boolean;
}

interface NodePathModule {
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
}

/**
 * The project intentionally ships no `@types/node`, so the Node built-ins can
 * neither be `import`ed with types nor augmented via `declare module` from a
 * module file. We declare the synchronous `require` global and pull the two
 * built-ins through the minimal local interfaces that describe exactly the
 * surface this test touches — vitest's Vite runtime supplies `require` for node
 * built-ins, so this resolves at run time with zero added dependencies.
 */
declare const require: (id: string) => unknown;
declare const process: { cwd(): string };

const fs = require('node:fs') as NodeFsModule;
const pathModule = require('node:path') as NodePathModule;

const repoRoot = process.cwd();
const diagramsDir = pathModule.join(repoRoot, 'context', 'diagrams');
const indexFileName = 'README.md';

const indexPath = pathModule.join(diagramsDir, indexFileName);
const claudeMdPath = pathModule.join(repoRoot, 'CLAUDE.md');

/**
 * The canonical set of service diagrams the spec requires (spec 035 Slice 7).
 * Guards against a future deletion: every one of these must exist in
 * `context/diagrams/`. New diagrams may be added beyond this set without
 * editing the list — the glob-driven per-file checks still cover them — but
 * none of these may disappear.
 */
const EXPECTED_DIAGRAMS = [
  'scope-and-digest.md',
  'injector-and-modules.md',
  'expression-parser.md',
  'interpolate.md',
  'sce.md',
  'sanitize.md',
  'exception-handler.md',
  'filters.md',
  'template-loading.md',
  'compile.md',
  'controller.md',
  'built-in-directives.md',
] as const;

/** The fixed five-section layout every service diagram must carry, in order. */
const REQUIRED_HEADINGS = [
  '## Purpose',
  '## Collaborators & call order',
  '## Using it the primary way',
  '## Using it the dependency-injection way',
  '## Related diagrams',
] as const;

/**
 * Extract every relative Markdown link target (`](./foo.md)` / `](foo.md)`)
 * from raw Markdown text — excluding absolute `http(s)` links and any target
 * that does not end in `.md`.
 */
function relativeMarkdownLinks(markdown: string): string[] {
  const targets: string[] = [];
  const linkPattern = /\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(markdown)) !== null) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    const trimmed = target.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      continue;
    }
    if (!trimmed.toLowerCase().endsWith('.md')) {
      continue;
    }
    targets.push(trimmed);
  }
  return targets;
}

const indexText = fs.readFileSync(indexPath, 'utf8');
const claudeMdText = fs.readFileSync(claudeMdPath, 'utf8');

const serviceFiles: string[] = fs
  .readdirSync(diagramsDir)
  .filter((name) => name.endsWith('.md') && name !== indexFileName)
  .sort();

describe('context/diagrams structure', () => {
  it('has an index README.md', () => {
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it('discovers at least one service diagram file', () => {
    expect(serviceFiles.length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_DIAGRAMS)('has the required canonical diagram %s', (fileName: string) => {
    const filePath = pathModule.join(diagramsDir, fileName);
    expect(fs.existsSync(filePath), `missing required diagram context/diagrams/${fileName}`).toBe(true);
  });

  describe.each(serviceFiles)('service diagram %s', (fileName: string) => {
    const filePath = pathModule.join(diagramsDir, fileName);
    const fileText = fs.readFileSync(filePath, 'utf8');

    it('contains all five required headings in order', () => {
      const positions = REQUIRED_HEADINGS.map((heading) => fileText.indexOf(heading));

      for (const [index, heading] of REQUIRED_HEADINGS.entries()) {
        expect(positions[index], `missing heading "${heading}" in ${fileName}`).toBeGreaterThanOrEqual(0);
      }

      for (let i = 1; i < positions.length; i += 1) {
        const previous = positions[i - 1] ?? -1;
        const current = positions[i] ?? -1;
        expect(
          current,
          `heading "${REQUIRED_HEADINGS[i] ?? ''}" must appear after "${REQUIRED_HEADINGS[i - 1] ?? ''}" in ${fileName}`,
        ).toBeGreaterThan(previous);
      }
    });

    it('has only relative markdown links that resolve to existing files', () => {
      for (const link of relativeMarkdownLinks(fileText)) {
        const resolved = pathModule.resolve(diagramsDir, link);
        expect(fs.existsSync(resolved), `broken relative link "${link}" in ${fileName}`).toBe(true);
      }
    });

    it('is linked from the index README.md', () => {
      const linkedByDotSlash = indexText.includes(`(./${fileName})`);
      const linkedBare = indexText.includes(`](${fileName})`);
      expect(linkedByDotSlash || linkedBare, `${fileName} is not linked from README.md`).toBe(true);
    });

    it('has a discoverability row in CLAUDE.md', () => {
      expect(
        claudeMdText.includes(`context/diagrams/${fileName}`),
        `CLAUDE.md missing context/diagrams/${fileName}`,
      ).toBe(true);
    });
  });
});
