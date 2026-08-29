/**
 * Plain string analysis over ONE pack's emitted CSS (`./pack-build.ts`'s
 * output, either freshly built or read back from the cache) — two
 * authoring rules, both WARNINGS only, per the pack CSS design
 * (docs/packs.md, the "packs style themselves" slice): a warning never
 * fails a build, never throws, and never blocks a pack's stylesheet from
 * loading (AGENTS.md's "clean is not silent": a problem gets a full
 * diagnostic somewhere findable — the "Markii" output channel via
 * `./pack-diagnostics.ts` — never a build failure or missing styling).
 *
 * No CSS parser dependency (AGENTS.md's dependency rule: only what's listed
 * under Stack) — both rules are small, deliberately permissive string scans
 * over the EMITTED (already-bundled-by-esbuild) CSS text, not the author's
 * original source. `vscode`-free and pure so it is exhaustively testable
 * without esbuild or a webview.
 */

/**
 * One CSS rule block extracted by `extractStyleRules`: a selector prelude
 * and its declaration text. `inKeyframes` is true when the rule's
 * immediately enclosing at-rule is `@keyframes` (or a vendor-prefixed
 * variant) — a keyframe's own "selectors" are percentages/`from`/`to`, not
 * class selectors, so Rule B (the prefix rule) never applies to them.
 */
interface CssRule {
  readonly selector: string;
  readonly declarations: string;
  readonly inKeyframes: boolean;
}

/**
 * Single-pass, stack-based extraction of every non-at-rule block in `css`:
 * whenever a `{` is reached, the buffered text since the last brace is the
 * block's "prelude". A prelude starting with `@` is a container (`@media`,
 * `@supports`, `@keyframes`, `@font-face`, …) whose own prelude is never
 * itself a rule; anything else — at ANY nesting depth, including inside an
 * `@media`/`@supports` container — is a real style rule. This naturally
 * handles one level of media-query nesting (the common case) and reports
 * each such nested rule's OWN selector, not the wrapping `@media (...)`
 * text. `@keyframes` inner blocks (`0%`, `from`, `to`) are still collected
 * as "rules" by this same logic — `inKeyframes` is what lets callers skip
 * the prefix check for exactly those.
 */
function extractStyleRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: Array<{
    readonly prelude: string;
    readonly isAtRule: boolean;
    readonly contentStart: number;
    readonly enclosingAtRule: string | undefined;
  }> = [];
  let buffer = '';
  let enclosingAtRule: string | undefined;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const isAtRule = prelude.startsWith('@');
      stack.push({ prelude, isAtRule, contentStart: i + 1, enclosingAtRule });
      if (isAtRule) enclosingAtRule = prelude;
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      buffer = '';
      if (!frame) continue;
      if (!frame.isAtRule) {
        rules.push({
          selector: frame.prelude,
          declarations: css.slice(frame.contentStart, i),
          inKeyframes: /@(-[a-z]+-)?keyframes\b/i.test(
            frame.enclosingAtRule ?? '',
          ),
        });
      }
      enclosingAtRule = frame.enclosingAtRule;
      continue;
    }
    buffer += ch;
  }
  return rules;
}

/**
 * Strips CSS block comments (`slash-star ... star-slash`). esbuild's CSS
 * bundler always emits at least one — a source-path banner comment per
 * bundled file, see `./pack-build.ts`'s doc comment — so both rules below
 * must not mistake a banner comment's leading text for part of the next
 * real selector/declaration. Non-greedy so multiple separate comments in
 * the same file are each stripped individually, rather than everything
 * between the FIRST comment's start and the LAST comment's end collapsing
 * into one match.
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Matches a `property: value;` declaration anywhere in the CSS text, independent of brace nesting/selector shape — good enough for the deliberately permissive scan Rule A performs. */
const DECLARATION_RE = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;

/** A hex color, or an `rgb()`/`rgba()`/`hsl()`/`hsla()` function call. `transparent`, `currentColor`, and `inherit` never match this — they are keywords, not literals, so they need no explicit allowlist. */
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/;

/**
 * A literal used as a `var()` FALLBACK is not the bug this rule hunts:
 * `var(--mk-border, #e4e4e7)` still follows the palette wherever the palette
 * exists, and the fallback is what keeps a pack readable against an older
 * `doc.css` that predates the token. `docs/integration.md` recommends
 * exactly this shape for host theme layers, so flagging it in pack CSS would
 * contradict the guidance. Strip the fallback arguments before scanning, and
 * what remains is genuinely hardcoded color.
 *
 * Deliberately simple: this removes everything from the comma to the closing
 * paren of a `var(`, which is the only form a fallback takes. A nested
 * `var()` inside a fallback is not worth parsing for a warning-only rule.
 */
function stripVarFallbacks(value: string): string {
  let out = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('var(', index);
    if (start === -1) {
      out += value.slice(index);
      break;
    }
    out += value.slice(index, start);

    // Scan for this `var(`'s matching close paren, tracking depth so a
    // fallback that is itself a function call is handled. A naive
    // `[^()]*` pattern stops at the first inner `(` and leaves the
    // literal exposed, which produced a false positive on the real
    // `var(--mk-shadow-sm, rgba(0, 0, 0, 0.05))`.
    let depth = 0;
    let cursor = start + 3;
    let firstComma = -1;
    for (; cursor < value.length; cursor += 1) {
      const char = value[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === ',' && depth === 1 && firstComma === -1) {
        firstComma = cursor;
      }
    }
    if (cursor >= value.length) {
      // Unbalanced; leave the remainder untouched rather than guessing.
      out += value.slice(start);
      break;
    }
    const nameEnd = firstComma === -1 ? cursor : firstComma;
    out += `var(${value.slice(start + 4, nameEnd).trim()})`;
    index = cursor + 1;
  }
  return out;
}

/**
 * The offending `property: value;` text as it appears in a warning line:
 * collapsed to one line (a multi-line value like a formatted
 * `linear-gradient(...)` would otherwise splinter the diagnostic across
 * several console lines) and truncated past `MAX_DECLARATION_EXCERPT`
 * characters — the excerpt exists to locate the declaration, not to
 * reproduce it.
 */
const MAX_DECLARATION_EXCERPT = 100;

function declarationExcerpt(property: string, value: string): string {
  const oneLine = `${property.trim()}: ${value.trim()};`.replace(/\s+/g, ' ');
  if (oneLine.length <= MAX_DECLARATION_EXCERPT) return oneLine;
  return `${oneLine.slice(0, MAX_DECLARATION_EXCERPT - 1)}\u2026`;
}

/**
 * Rule A: warn when a declaration's value carries a raw color literal
 * (hex/`rgb()`/`rgba()`/`hsl()`/`hsla()`) instead of one of `doc.css`'s
 * `--mk-*` palette tokens — the exact bug this feature exists to prevent
 * (hardcoded light colors, unreadable once a host's dark theme remaps the
 * tokens). Scans the whole emitted CSS text; each match reports the pack
 * name and the offending `property: value;` declaration. A literal serving
 * as a `var()` fallback is exempt: see `stripVarFallbacks`.
 */
export function lintPackCssColors(
  packName: string,
  css: string,
): readonly string[] {
  const warnings: string[] = [];
  const text = stripCssComments(css);
  DECLARATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARATION_RE.exec(text)) !== null) {
    const property = match[1] ?? '';
    const value = match[2] ?? '';
    if (!COLOR_LITERAL_RE.test(stripVarFallbacks(value))) continue;
    warnings.push(
      `pack "${packName}" CSS uses a raw color literal in "${declarationExcerpt(property, value)}" — use an --mk-* palette token (see docs/integration.md's theming section) instead of a hardcoded color, or it will be unreadable once a host's dark theme remaps the palette.`,
    );
  }
  return warnings;
}

/**
 * The required class prefix for `packName`'s selectors — mirrors the
 * directive-namespace join (`docs/packs.md`: pack name + component name,
 * joined with `_`), so a pack that avoids namespace collisions in its
 * directives avoids them in its classes too. Because a pack name (a
 * `SEGMENT_RE`-validated lowercase-kebab segment) can never itself contain
 * an underscore, the underscore here always marks exactly the same
 * boundary the directive-name join does — so, just like two packs'
 * composed directive names can never collide, two packs' class namespaces
 * can never overlap either.
 */
function requiredPrefix(packName: string): string {
  return `.mk-${packName}_`;
}

/**
 * True when every comma-separated part of `selector` either starts with
 * the pack's required prefix, or is not a class selector at all (a bare
 * element/attribute/pseudo selector with no `.` at all — e.g. `*`, `:root`,
 * `[data-x]` — carries no namespace risk, so it is not warned on; only a
 * selector that DOES lead with a class token is held to the prefix).
 */
function selectorPartsMissingPrefix(
  selector: string,
  packName: string,
): readonly string[] {
  const prefix = requiredPrefix(packName);
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => part.startsWith('.'))
    .filter((part) => !part.startsWith(prefix));
}

/**
 * Rule B: warn when a pack CSS selector leads with a class token that does
 * not carry the pack's `.mk-<packname>_` prefix — the class-uniqueness
 * mirror of the directive-namespace rule `@markii/pack`'s
 * `detectNamespaceCollisions` already enforces at install time (two packs
 * can never share a namespace, so two packs correctly prefixing their
 * classes can never collide either). Keyframe inner selectors (`0%`,
 * `from`, `to`) are exempt — see `extractStyleRules`'s `inKeyframes`.
 */
export function lintPackCssPrefix(
  packName: string,
  css: string,
): readonly string[] {
  const warnings: string[] = [];
  for (const rule of extractStyleRules(stripCssComments(css))) {
    if (rule.inKeyframes) continue;
    for (const part of selectorPartsMissingPrefix(rule.selector, packName)) {
      warnings.push(
        `pack "${packName}" CSS selector "${part}" does not start with the pack's required prefix "${requiredPrefix(packName)}" — pack class selectors must be prefixed so two packs' styles can never collide.`,
      );
    }
  }
  return warnings;
}

/** Both rules, in order (colors first, then prefix), as one flat warning list — what `./pack-build.ts` attaches to a `'built'` outcome and `./pack-context.ts`/`./pack-diagnostics.ts` surface to the "Markii" output channel. Warnings only: never thrown, never a build failure. */
export function lintPackCss(packName: string, css: string): readonly string[] {
  return [
    ...lintPackCssColors(packName, css),
    ...lintPackCssPrefix(packName, css),
  ];
}
