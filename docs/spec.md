# Markii specification: the normative core

This page collects the rules an implementation must follow. The surrounding
pages explain the same material for humans, with rationale and examples;
when wording differs, this page and the conformance corpus win. Key words
MUST, SHOULD, and MAY are used in their usual normative sense.

The spec is versioned with plain semver and is currently pre-1.0. The
format's name, Markii, carries no version information. A bundle records
the spec version it targets in its manifest's required `spec` field.

## 1. Document syntax

A Markii document is UTF-8 text: CommonMark, plus GFM tables, task lists,
strikethrough, and autolinks, plus the three generic directive forms:

- inline `:name[label]{attrs}`
- leaf block `::name{attrs}`
- container `:::name{attrs} … :::`

Syntax-tree node shapes follow `mdast-util-directive`: textDirective,
leafDirective, and containerDirective, each with `name`, string-valued
`attributes`, and `children`.

Raw HTML MUST NOT be rendered; an implementation drops `html` nodes.
Directives MUST NOT parse inside code fences. Malformed or unclosed
directive syntax MUST degrade to text, never to an error. A closing fence
closes the innermost open container; a container left open MUST be closed
implicitly when its enclosing container's fence or the end of input
arrives, never reported as an error. Optional YAML
frontmatter MAY open a document, delimited by `---` lines, and is
recognized only as the document's first construct. It MUST parse to a
distinct metadata node and MUST NOT be rendered. A `---` sequence anywhere
else keeps its ordinary CommonMark meaning, and an unterminated opening
fence MUST degrade to ordinary markdown, never to an error. Frontmatter's
one format-defined key is `uses`, a list of pack names, informative only.
An implementation MUST read the flow form (`uses: [a, b]`) and the
block-sequence form (`- name` lines); it MUST NOT fail on any other shape,
and treating an unreadable `uses` as absent is conforming. Reading
frontmatter MUST NOT require a YAML parser.

Directive names SHOULD be lowercase-kebab. A name MUST NOT contain `:`.
Namespaced names from packs join the namespace and name with `_`; the
parser itself accepts any legal directive name.

An inline directive is recognized only when its name starts with an ASCII
letter and its colon starts a word: the colon is the first character of
the paragraph, or the character before it is not an ASCII letter or digit.
Any other single colon is literal text. A conforming parser MUST apply
this rule (conformance fixture 28); leaf and container forms are not
affected.
The first path segments `scripts`, `assets`, and `.cache` are reserved for
bundle structure and MUST NOT be pack or library namespaces; the same
reservation applies to component name prefixes.

## 2. Attributes

Attribute values are plain strings. The attribute language is not, and must
never become, Turing-complete: no expressions, no conditionals, no loops.

`width` and `align` are reserved attribute names on every directive. A
renderer intercepts them before the component sees its attributes, valid
value or not, and a component never receives them. On inline directives
they are stripped and have no effect.

## 3. Layout

Layout controls form a closed set. There is no freeform styling attribute
and no arbitrary values; an invalid value degrades to the default silently.

- `width`: `fit | narrow | normal | wide | full`; default `normal`. `fit`
  sizes the block's box to its own content, every other preset caps its
  maximum width
- `align`: `left | center | right`; default `left`. Places the block's box
  within the column and never affects the block's contents; visible only
  when the box is narrower than the column
- wrapper containers `:::center`, `:::right`, `:::left`, `:::wide`,
  `:::narrow`, `:::fit`, `:::full`: apply the corresponding preset to their
  contents, including plain markdown; the alignment wrappers also set text
  alignment in scope. A wrapper accepts the attribute of the other axis
  (`:::center{width=fit}`) and applies both to the one scope; an attribute
  for the wrapper's own axis is ignored
- `text`: `left | center | right`; a per-component attribute of the standard
  `row`, `cell`, `card`, and `callout`, aligning the text inside. On a row
  it applies to every cell; a cell's own `text` overrides it, and an
  alignment wrapper written inside a cell takes precedence over both.
  `text` is not a reserved attribute and reaches the component like any
  other
- `:::row{cols=2|3|4}`: the one multi-cell container; equal-width cells,
  responsive wrap; invalid or absent `cols` degrades to auto-fit. `align`
  on a row has its ordinary meaning and therefore no visible effect
- `:::cell`: groups several blocks into one `row` cell; carries no
  presentation of its own beyond `text`, and is inert outside a row

No scope sets a component's own attributes for its children. A container
that passes a setting to its children does so through an attribute of its
own.

Components MUST NOT ship outer margins; the document stylesheet owns
vertical rhythm. Block components are normal flow elements, never floated,
never absolutely positioned. Text MUST NOT wrap around components.

## 4. Renderer requirements (L1)

A conforming renderer:

1. resolves directive names through a registry mapping name to component;
2. passes attributes as string key-value pairs and renders directive
   children as markdown;
3. renders unregistered names as a visible fallback containing the inner
   content as plain markdown, without failing the document;
4. never throws on any input, including hostile directive names such as
   prototype members, and including a misbehaving host value or vault
   store: a `get` that throws, a stored entry whose property access
   throws, or a stored value whose property access traps throw during a
   dotted-path walk MUST degrade to the ordinary missing resolution of
   requirement 6, never propagate out of the renderer. A renderer's own
   standard components MUST hold to this when reading a bound value; a
   third-party component's internal failure remains the embedding host's
   to contain;
5. is side-effect-free on open: rendering MUST NOT execute scripts, and
   value reads are pure lookups of last-known state;
6. presents a failed value binding as a quiet placeholder with the reason
   out of the text flow (such as a tooltip), never as body text;
7. MAY resolve directive names through registry-level aliases: an alias
   names one target and optional preset attributes. An alias MUST be
   resolved at lookup time and MUST NOT be followed more than one hop; a
   registered component MUST take precedence over an alias of the same
   name; attributes written in the document MUST take precedence over an
   alias's presets; presets that are reserved attributes MUST be
   intercepted exactly as author-written ones are; and an alias whose
   target is unregistered MUST render requirement 3's fallback under the
   target's name. Aliases are configuration of the registry or the
   application: a document MUST NOT be able to define them;
8. MUST NOT render a component in a directive form its registered kind
   contradicts, where doing so would produce invalid nesting: a component
   registered as a block, written as an inline directive, renders
   requirement 3's fallback instead of the component. A fallback's form
   MUST follow the directive's form rather than the component's kind: an
   inline directive falls back to an inline element, a block directive to
   a block one. A registration that carries no kind information renders
   unchanged, and the reverse direction (an inline component written as
   a leaf or container) MAY render.

The contract is framework-neutral; the spec's normative text does not
mention any UI framework.

## 5. Script blocks

Only a fenced code block whose info-string meta carries `name=` or `src=` is
runnable; every other code block is display-only. The fence meta grammar is
normative: the first `{...}` group in the info string holds
whitespace-separated attributes of the forms `key`, `key=bare`,
`key="quoted"`, `key='quoted'`; quoted values may contain braces.

Boolean fence-meta attributes (`publish`; the reference renderer's `open`)
are bare-only. Any written value, including `=true`, counts as absent.
Implementations MUST fail closed: an unrecognized spelling never enables
behavior.

A script name MUST match `[A-Za-z_][A-Za-z0-9_-]*`. A block with an invalid
name is display-only, not an error. Script blocks may appear anywhere
markdown may; all names land in one note-scoped value store.

## 6. Values

Scripts return values; they never mutate the document. `:value[name]`
renders a value inline; `data=name` binds one to a component. Both accept
dotted paths resolved with own-property access only. A missing or stale
value renders the consumer's empty or stale state.

A script fence with the bare `publish` attribute publishes its value to a
vault-level store after a successful run. Consumers read vault values with
an `@` prefix. One writer per published name; the application MUST reject a
second publisher. Reading a vault value is pure and requires no grant;
publishing requires a grant.

## 7. Execution and capabilities (L3)

Rendering is pure; running is an event with a trigger, and the trigger caps
capabilities:

| Trigger | Tier |
|---|---|
| manual | all granted capabilities |
| auto-run on open | read-only: GET, bundle/cache reads, cache writes |
| scheduled | read-only |

Capabilities are declared in the bundle manifest, granted by the user, and
injected as functions; the sandbox environment is otherwise empty. Network
grants are per-host. Grants are keyed by a hash of the note's full
executable closure and MUST be re-prompted when any of that code changes.
Resource limits (instructions, wall-clock, memory, fetch size) bound every
run.

A host MUST run scripts in a dedicated terminatable isolate with an
external wall-clock watchdog. Auto-run and scheduled execution MUST NOT be
offered without it. In-process limits are best-effort by design.

## 8. Bundles (L2)

A bundle is a directory, or a zip of that directory, containing
`manifest.json`, the document, and optionally `assets/`, `scripts/`, and
`.cache/`. The two forms are equivalent, and both carry the `.mkz`
extension. An implementation SHOULD also recognize the legacy
`.mkbundle` name.

The manifest MUST declare the spec version it targets in its `spec` field.
`mark` is the retired name for that field. An implementation SHOULD still
accept `mark` and treat its value as `spec`, reporting a warning and never
an error. When both fields are present, `spec` MUST win. An implementation
MUST write `spec` and MUST NOT write `mark`.

`.cache/` is disposable;
deleting it MUST NOT lose authored content. The document is `note.mk.md` at
the bundle root unless the manifest's optional `document` field names
another bundle-relative path; when present it MUST be a string, and it is
resolved under the same path rules as any other bundle path.

Scripts see only their own bundle. Paths are resolved inside the bundle
root; absolute paths, `..`, and symlink escapes are rejected. Writes are
limited to `.cache/` by default; a script MUST NOT be able to write the
document or the manifest.

Three persistence invariants hold regardless of file form: rendering never
executes; the host never writes authored files; caches are disposable.
Where a host persists last-run values is host policy.

## 9. Requirement-to-fixture map

This section pins every normative `MUST`/`MUST NOT` sentence in sections 1
through 6 to the conformance fixture(s) that check it, so a requirement can
never quietly go unverified. Each row splits one clause of the spec into a
single checkable claim; several rows can come from the same sentence when
that sentence bundles more than one requirement.

The `Fixtures` column uses one of five forms:

- a comma-separated list of fixture numbers, e.g. `08` or `09, 25`: each
  number names a `conformance/NN-*.mk.md` / `.json` pair, checked against
  the parser's actual output;
- `core:<file>`: pinned by a colocated Vitest suite in
  `packages/markii-core/src` rather than a numbered fixture, used only when
  the requirement lives past the parse stage (the hast conversion, or a
  frontmatter/script accessor that reads a fixture's raw text rather than
  its tree shape) and so falls outside the parse-only corpus format;
- `render:render/<name>` for a `conformance/render/` fixture, or
  `render:<pkg>:<file>` (e.g. `render:react:aliases.test.tsx`,
  `render:runtime:vault.test.ts`) naming a real test file in another
  `@markii/*` package's own suite: a renderer- or value-binding requirement
  that a live registry (or a running script/store) is needed to observe.
  Valid only for requirements that are genuinely renderer/value behavior
  (section 4 and one row of section 6), never for a requirement the parser
  alone can check;
- `other:<reason>`: a requirement that is neither parse- nor
  render-observable at all (a dependency constraint, or a rule enforced by
  a different package's own tests). Used only for the two rows marked below;
- `gap:<reason>`: an honest admission that nothing pins this requirement
  yet. A `gap:` row is a known TODO, not a passing state. The accompanying
  test in `packages/markii-core` fails on every `gap:` row on purpose, so
  the table can never quietly treat "not done" as "done."

| ID | § | Requirement | Fixtures |
|---|---|---|---|
| S1-01 | 1 | Raw HTML MUST NOT be rendered. | 29, core:to-hast.test.ts |
| S1-02 | 1 | Directives MUST NOT parse inside code fences. | 08 |
| S1-03 | 1 | Malformed or unclosed directive syntax MUST degrade to text, never to an error. | 09, 31 |
| S1-04 | 1 | A container left open MUST be closed implicitly when its enclosing container's fence or the end of input arrives, never reported as an error. | 09, 25 |
| S1-05 | 1 | Frontmatter MUST parse to a distinct metadata node. | 19 |
| S1-06 | 1 | Frontmatter MUST NOT be rendered. | core:to-hast.test.ts |
| S1-07 | 1 | An unterminated opening frontmatter fence MUST degrade to ordinary markdown, never to an error. | 21 |
| S1-08 | 1 | An implementation MUST read the flow form of `uses` (`uses: [a, b]`). | 19 |
| S1-09 | 1 | An implementation MUST read the block-sequence form of `uses` (`- name` lines). | 20 |
| S1-10 | 1 | An implementation MUST NOT fail on any other shape of `uses`. | core:frontmatter.test.ts |
| S1-11 | 1 | Reading frontmatter MUST NOT require a YAML parser. | other: dependency constraint, not AST-observable; `frontmatter.ts` is a hand-rolled reader and no `@markii/core` dependency is a YAML library |
| S1-12 | 1 | A directive name MUST NOT contain `:`. | 30 |
| S1-13 | 1 | A conforming parser MUST apply the inline-directive word-start recognition rule. | 28 |
| S1-14 | 1 | The reserved first path segments (`scripts`, `assets`, `.cache`) MUST NOT be pack or library namespaces, nor component name prefixes. | other: pack/bundle namespace rule enforced by `@markii/pack`'s `namespace.ts` (own test suite), not by `@markii/core`'s parser, which this same section says accepts any legal directive name |
| S3-01 | 3 | Components MUST NOT ship outer margins. | render:react:doc-css-invariants.test.ts |
| S3-02 | 3 | Text MUST NOT wrap around components. | render:react:doc-css-invariants.test.ts |
| S4-01 | 4 | A throwing `get`, a stored entry whose property access throws, or a stored value whose property-access trap throws during a dotted-path walk MUST degrade to the ordinary missing resolution, never propagate out of the renderer. | render:react:hostile-store.test.tsx |
| S4-02 | 4 | A renderer's own standard components MUST hold to this same never-throw guarantee when reading a bound value. | render:react:hostile-store.test.tsx |
| S4-03 | 4 | Rendering MUST NOT execute scripts. | render:react:render.test.tsx |
| S4-04 | 4 | An alias MUST be resolved at lookup time. | render:react:aliases.test.tsx |
| S4-05 | 4 | An alias MUST NOT be followed more than one hop. | render:react:aliases.test.tsx |
| S4-06 | 4 | A registered component MUST take precedence over an alias of the same name. | render:react:aliases.test.tsx |
| S4-07 | 4 | Attributes written in the document MUST take precedence over an alias's preset attributes. | render:react:aliases.test.tsx |
| S4-08 | 4 | Alias presets that are reserved attributes MUST be intercepted exactly as author-written ones are. | render:react:aliases.test.tsx |
| S4-09 | 4 | An alias whose target is unregistered MUST render the unknown-directive fallback under the target's name. | render:react:aliases.test.tsx |
| S4-10 | 4 | A document MUST NOT be able to define aliases itself. | render:react:alias-injection.test.tsx |
| S4-11 | 4 | A renderer MUST NOT render a component in a directive form that contradicts its registered kind, where doing so would produce invalid nesting. | render:react:form-mismatch.test.tsx |
| S4-12 | 4 | The fallback's form MUST follow the directive's own form, not the component's registered kind. | render:react:form-mismatch.test.tsx |
| S5-01 | 5 | Implementations MUST fail closed on an unrecognized boolean fence-meta spelling: it never enables behavior. | core:publish-attribute.test.ts |
| S5-02 | 5 | A script name MUST match `[A-Za-z_][A-Za-z0-9_-]*`. | 16 |
| S6-01 | 6 | The application MUST reject a second publisher of the same published name. | render:runtime:vault.test.ts |

## 10. Conformance

Levels: L0 parse, L1 render behavior, L2 bundles, L3 scripting with the
capability model. An implementation states the level it meets.

The corpus in `conformance/` is part of the definition: `.mk.md` inputs
paired with expected syntax trees as JSON, plus behavioral assertions. An
implementation at a level MUST reproduce the corpus results relevant to
that level. The corpus is plain data, usable from any language.

## 11. Non-goals

Fixed by design, not open for extension: no rendered raw HTML, no freeform
styling, no floats, no expressions in attributes, no self-modifying
documents, no timers in the sandbox, no package manager for scripts, no
per-file dependencies or scaffolding, no programming-language ambitions for
the directive syntax, and no math notation (`$...$`).
