import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { conformanceDir, listCorpusNames } from './corpus';

/**
 * Guards docs/spec.md §9 ("Requirement-to-fixture map"): every normative
 * `MUST`/`MUST NOT` sentence in spec.md sections 1 through 6 must be pinned
 * to a conformance fixture (or an explicitly justified stand-in), and every
 * fixture reference in that table must actually exist. This is the
 * executable half of that table — the table itself is prose for humans,
 * this test is what keeps it honest as the spec and the corpus evolve.
 *
 * ## The Fixtures-column grammar this test parses
 *
 * Each row's `Fixtures` cell is one of, or a numeric list followed by one of:
 *
 * - a comma-separated list of two-digit fixture numbers, e.g. `08` or
 *   `09, 25`: each number must have a matching `conformance/NN-*.mk.md` +
 *   `.json` pair (@markii/core's own mdast-level corpus);
 * - `render:render/<name>` for a `conformance/render/` fixture, or
 *   `render:<pkg>:<file>` (e.g. `render:react:aliases.test.tsx`,
 *   `render:runtime:vault.test.ts`) for a named test file in another
 *   `@markii/*` package's own suite: a renderer/value-binding requirement
 *   pinned by something outside @markii/core's own parse-only corpus.
 *   `<pkg>` is looked up in `PACKAGE_SRC_DIRS` below. Valid only on the
 *   hardcoded `RENDER_ALLOWED_IDS` list below;
 * - `gap:<reason>`: an explicit, honest "nothing pins this yet" marker.
 *   This ALWAYS fails — there is no spelling that marks a real gap as
 *   passing. It exists only so the failure message can say why, rather
 *   than making a future contributor rediscover the gap from scratch;
 * - `core:<file>`: pinned by a colocated Vitest suite in this package's
 *   `src/` directory instead of a numbered fixture (used when the
 *   requirement lives past the parse-only corpus format, e.g. a
 *   hast-conversion or frontmatter/script-accessor behavior). Checked by
 *   file existence only;
 * - `other:<reason>`: a requirement that is neither parse- nor
 *   render-observable at all, valid ONLY on the hardcoded
 *   `OTHER_ALLOWED_IDS` list below.
 *
 * A cell may combine a numeric list with ONE trailing marker (e.g.
 * `29, core:to-hast.test.ts`): everything before the first occurrence of
 * `core:`/`render:`/`other:` is treated as the numeric list, everything
 * from that marker onward (commas included) is the marker's own text —
 * this is what lets an `other:` reason carry a comma without breaking the
 * numeric split.
 *
 * There is no "no coverage yet" spelling that passes this test. A row
 * either names something real (a fixture, a file, a cross-package reason
 * on the allowlist) or it fails — a bare "needs a fixture" placeholder is
 * exactly the silently-unpinned state this test exists to catch.
 *
 * A requirement with an empty Fixtures cell, a reference to something that
 * doesn't exist, or a `render:`/`other:` marker used outside its
 * allowlist, fails this test by name — the failure message names the
 * requirement's own text, not just its row ID, so a future contributor can
 * act on the failure without first finding this file.
 */

function specPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/markii-core/src -> packages/markii-core -> packages -> repo root
  return join(here, '..', '..', '..', 'docs', 'spec.md');
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..');
}

function sectionText(
  spec: string,
  headingPrefix: string,
  nextHeadingPrefix: string,
): string {
  const startIdx = spec.indexOf(headingPrefix);
  if (startIdx === -1) {
    throw new Error(`spec.md: could not find heading "${headingPrefix}"`);
  }
  const afterStart = spec.slice(startIdx + headingPrefix.length);
  const endIdx = afterStart.indexOf(nextHeadingPrefix);
  if (endIdx === -1) {
    throw new Error(
      `spec.md: could not find heading "${nextHeadingPrefix}" after "${headingPrefix}"`,
    );
  }
  return afterStart.slice(0, endIdx);
}

interface RequirementRow {
  id: string;
  section: string;
  requirement: string;
  fixturesCell: string;
}

/** Parses the `| ID | § | Requirement | Fixtures |` table out of §9's text. */
function parseRequirementTable(sectionBody: string): RequirementRow[] {
  const lines = sectionBody
    .split('\n')
    .filter((line) => line.trim().startsWith('|'));
  // Row 0 is the header (`| ID | § | ... |`), row 1 is the `|---|---|...`
  // separator; data rows start at index 2.
  const rows: RequirementRow[] = [];
  for (const line of lines.slice(2)) {
    const cells = line
      .split('|')
      .slice(1, -1) // drop the empty strings before the first and after the last `|`
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [id, section, requirement, fixturesCell] = cells;
    if (!id || id === '') continue;
    rows.push({
      id,
      section: section ?? '',
      requirement: requirement ?? '',
      fixturesCell: fixturesCell ?? '',
    });
  }
  return rows;
}

const MARKER_PATTERN = /(core:|render:|other:|gap:)/;

/** Where a package's `src/` lives, for `render:<pkg>:<file>` references. */
const PACKAGE_SRC_DIRS: Record<string, string> = {
  react: 'platforms/markii-react',
  html: 'platforms/markii-html',
  runtime: 'markii-runtime',
  host: 'markii-host',
  lua: 'markii-lua',
  stdlib: 'markii-stdlib',
  bundle: 'markii-bundle',
  pack: 'markii-pack',
};

interface ParsedFixtures {
  numbers: string[];
  marker: string | undefined; // full marker text, e.g. "render:react:alias.test.ts"
}

function parseFixturesCell(cell: string): ParsedFixtures {
  const match = MARKER_PATTERN.exec(cell);
  if (!match || match.index === undefined) {
    return { numbers: splitNumbers(cell), marker: undefined };
  }
  const before = cell.slice(0, match.index).replace(/,\s*$/, '').trim();
  const marker = cell.slice(match.index).trim();
  return { numbers: before ? splitNumbers(before) : [], marker };
}

function splitNumbers(text: string): string[] {
  return text
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Rows whose Fixtures cell may legitimately use `render:` — a genuine
 * renderer/CSS/value-store behavior that @markii/core (a parser, not a
 * renderer) cannot pin at the mdast level, but which IS pinned by a real
 * `conformance/render/` fixture or a named test in a platform package.
 * Adding an ID here for a requirement the parser itself can check is
 * exactly the failure mode this allowlist exists to block.
 */
const RENDER_ALLOWED_IDS = new Set([
  'S3-01',
  'S3-02',
  'S4-01',
  'S4-02',
  'S4-03',
  'S4-04',
  'S4-05',
  'S4-06',
  'S4-07',
  'S4-08',
  'S4-09',
  'S4-10',
  'S4-11',
  'S4-12',
  'S6-01',
]);

/**
 * Rows whose Fixtures cell may use `other:` — a requirement that is not an
 * AST or a render-time fact at all (a dependency constraint, or a naming
 * rule enforced by a different package's own tests).
 */
const OTHER_ALLOWED_IDS = new Set(['S1-11', 'S1-14']);

describe('docs/spec.md §9: every requirement is pinned to a real fixture', () => {
  const spec = readFileSync(specPath(), 'utf8');
  const tableSection = sectionText(
    spec,
    '## 9. Requirement-to-fixture map',
    '## 10.',
  );
  const rows = parseRequirementTable(tableSection);
  const fixtureNames = new Set(listCorpusNames());
  const dir = conformanceDir();
  const coreSrcDir = dirname(fileURLToPath(import.meta.url));
  const root = repoRoot();

  it('finds a non-empty requirement table', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('has exactly one row per MUST/MUST NOT sentence in sections 1-6 (plus the one documented split)', () => {
    const sections1to6 = sectionText(spec, '## 1. Document syntax', '## 7.');
    const mustCount = (sections1to6.match(/\bMUST\b/g) ?? []).length;
    // One sentence in §1 ("An implementation MUST read the flow form ...
    // and the block-sequence form ...") bundles two independently
    // checkable requirements (S1-08, S1-09) under a single literal `MUST`,
    // per docs/spec.md §9's own methodology note. That is the one place
    // this corpus deliberately has more rows than literal `MUST` tokens.
    const knownBundledSplits = 1;
    expect(rows.length).toBe(mustCount + knownBundledSplits);
  });

  /** Resolves a `render:` marker's target and returns whether it exists. */
  function renderTargetExists(reason: string): boolean {
    if (reason.startsWith('render/')) {
      return existsSync(join(root, 'conformance', reason));
    }
    // `<pkg>:<file>` — a named test file in another @markii/* package's src/,
    // per PACKAGE_SRC_DIRS above.
    const colon = reason.indexOf(':');
    if (colon === -1) return false;
    const pkg = reason.slice(0, colon).trim();
    const file = reason.slice(colon + 1).trim();
    const srcDir = PACKAGE_SRC_DIRS[pkg];
    if (!srcDir || !file) return false;
    return existsSync(join(root, 'packages', srcDir, 'src', file));
  }

  it.each(rows.map((row) => [row.id, row] as const))(
    '%s has a fixture reference that resolves',
    (_id, row) => {
      const { numbers, marker } = parseFixturesCell(row.fixturesCell);

      if (numbers.length === 0 && marker === undefined) {
        throw new Error(
          `spec.md §9 row ${row.id} ("${row.requirement}") has no fixture reference at all.`,
        );
      }

      for (const number of numbers) {
        const found = [...fixtureNames].some((name) =>
          name.startsWith(`${number}-`),
        );
        if (!found) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") references fixture ` +
              `"${number}", which has no matching conformance/${number}-*.mk.md file.`,
          );
        }
      }

      if (marker === undefined) return;

      if (marker.startsWith('core:')) {
        const file = marker.slice('core:'.length).trim();
        const filePath = join(coreSrcDir, file);
        if (!existsSync(filePath)) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") references "${marker}", ` +
              `but packages/markii-core/src/${file} does not exist.`,
          );
        }
        return;
      }

      if (marker.startsWith('render:')) {
        if (!RENDER_ALLOWED_IDS.has(row.id)) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") uses a "render:" marker, ` +
              'but is not on this test\'s RENDER_ALLOWED_IDS allowlist. A "render:" marker ' +
              'is only for a genuine renderer/value-binding requirement @markii/core cannot ' +
              'pin — if this requirement is parse-level, it needs a real fixture instead.',
          );
        }
        const target = marker.slice('render:'.length).trim();
        if (!renderTargetExists(target)) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") references "${marker}", but ` +
              `neither conformance/${target} nor a matching packages/platforms/markii-*/src ` +
              'file exists. A bare reason with no real target does not pin anything.',
          );
        }
        return;
      }

      if (marker.startsWith('gap:')) {
        const reason = marker.slice('gap:'.length).trim();
        throw new Error(
          `spec.md §9 row ${row.id} ("${row.requirement}") is an ACKNOWLEDGED GAP: ${reason} ` +
            'This requirement has no test anywhere yet. This failure is expected until that ' +
            'coverage is added — it is not a bug in this test.',
        );
      }

      if (marker.startsWith('other:')) {
        if (!OTHER_ALLOWED_IDS.has(row.id)) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") uses an "other:" marker, ` +
              'but is not on this test\'s OTHER_ALLOWED_IDS allowlist. "other:" is reserved ' +
              'for requirements that are neither parse- nor render-observable at all.',
          );
        }
        const reason = marker.slice('other:'.length).trim();
        if (reason.length < 10) {
          throw new Error(
            `spec.md §9 row ${row.id} ("${row.requirement}") has an "other:" marker with no ` +
              'real reason text.',
          );
        }
        return;
      }

      throw new Error(
        `spec.md §9 row ${row.id} ("${row.requirement}") has an unrecognized Fixtures ` +
          `marker: "${marker}".`,
      );
    },
  );

  it('every fixture cited by a numeric reference has both a .mk.md and a .json file', () => {
    // Belt-and-suspenders on top of the per-row check above: confirms the
    // corpus loader itself (which requires both files) can load every
    // fixture this table names.
    for (const row of rows) {
      const { numbers } = parseFixturesCell(row.fixturesCell);
      for (const number of numbers) {
        const name = [...fixtureNames].find((candidate) =>
          candidate.startsWith(`${number}-`),
        );
        expect(name, `fixture ${number} referenced by ${row.id}`).toBeDefined();
        expect(existsSync(join(dir, `${name}.mk.md`))).toBe(true);
        expect(existsSync(join(dir, `${name}.json`))).toBe(true);
      }
    }
  });
});
