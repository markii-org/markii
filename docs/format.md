# The document format

Mark is markdown with one extra rule. A Mark document is a plain text file,
readable in any editor, that can also carry your own components: callouts,
tabs, charts, anything you register. This page explains everything a document
can contain. You don't need to be a programmer to read it.

## A document is markdown

The base language is CommonMark plus the GitHub extensions: tables, task
lists, strikethrough, and autolinks. Any markdown you already know works
unchanged. The file extension is `.mk.md`. Because the real suffix is `.md`,
every editor and every markdown viewer on earth already opens the file and
shows readable text. Mark-aware tools recognize the `.mk` part and render the
components too.

That is the design ethos in one sentence: a Mark document must survive
outside Mark. Everything below is built to degrade into readable plain
markdown when opened in a tool that has never heard of the format.

## Directives: the one extra rule

A directive places a component in the document. There are three forms, and
the difference between them is only how much of the document they cover.

Inline, inside a sentence:

```
Press :kbd[Ctrl+S] to save. This feature is :badge[beta]{color=purple}.
```

A leaf block, standing on its own line:

```
::stat{data=stars label="GitHub stars"}
```

A container, wrapping other markdown:

```
:::callout{type=warning title="Careful"}
Any **markdown** here, including nested directives.
:::
```

The pattern is the same in all three: a name, an optional `[label]`, and
optional `{attributes}`. More colons means a bigger scope. That is the whole
syntax. It never grows, because the name is open-ended: adding your hundredth
component adds no new grammar, just a new name.

The syntax comes from the CommonMark "generic directives" proposal, so it is
shared with other markdown tools rather than invented here.

## Components and the registry

A directive name means whatever the rendering application says it means. The
renderer holds a registry, which is a plain mapping from names to components.
Attributes become the component's settings, and the markdown inside a
container becomes its content.

The reference renderer ships a standard set: `callout`, `card`, `badge`,
`details`, `figure`, `tabs` and `tab`, `kbd`, `rating`, and three data-bound
components, `stat`, `progress`, and `chart`. These are defaults, not a fixed
vocabulary. You can restyle them, replace them, or add your own.

A registry may also carry aliases: a second name for a component it already
holds, optionally with preset attributes, so `warn` can stand for
`callout{type=warning}`. An alias is resolved when the name is looked up,
one hop only, so an alias pointing at another alias is not followed. A real
registered component always beats an alias of the same name, attributes
written in the document always beat the alias's presets, and an alias
pointing at a component nobody registered shows the usual fallback box
under the target's name. Aliases belong to the application or the pack,
never to a note: a note that could define its own names would be a
preprocessor in disguise, and the raw file would stop saying what it means.

### Unknown names never break the page

If a document uses `:::timeline` and the renderer has no `timeline`
registered, the renderer shows a marked fallback box with the inner content
rendered as ordinary markdown. Nothing crashes and nothing disappears.

This matters more than it sounds. It is what lets you share a note with
someone who has fewer components installed than you, and what lets old
documents open in new tools. A Mark document is tolerant like markdown, not
brittle like code.

## Attributes are configuration, not content

The `{...}` part of a directive holds settings: `type=warning`,
`label="GitHub stars"`, `collapsed`. Values are plain strings. There are no
expressions, no conditionals, and no loops, and there never will be; that
line is what keeps a note a note instead of a program.

A rule of thumb that keeps documents portable: meaningful prose goes in the
directive body, only configuration goes in attributes. In a plain markdown
viewer, body text stays readable between the `:::` lines, while text hidden
in attributes is lost to the reader. A note whose prose lives in attribute
strings is a note you've lost.

Two attribute names are reserved on every directive: `width` and `align`.
They belong to the layout system described next, and a component never sees
them among its own attributes.

## Layout

One rule makes document layout predictable: components own their insides,
the document owns the outsides. No component brings its own outer margins.
The document stylesheet spaces every block, paragraph or component alike,
with a single rhythm rule, so anything you add sits correctly in the flow
without per-component tuning.

On top of that, authors get a small closed set of layout controls. There is
deliberately no freeform styling: no `style=` attribute, no pixel values, no
arbitrary CSS. Freeform layout is how documents rot; a fixed set of presets
is how they stay consistent as themes and component sets evolve.

### Width and alignment on a directive

Any block directive can carry the two reserved attributes:

```
:::chart{width=wide}       narrow | normal | wide | full
::figure{width=narrow align=center}    left | center | right
```

An invalid value is ignored as if it were absent; nothing errors. Alignment
only has a visible effect when the block is narrower than the column; a
full-width block has nothing to align. Inline directives ignore both
attributes entirely.

### Layout wrappers for plain markdown

Ordinary markdown has nowhere to write attributes: a table or an image has no
`{...}`. Five wrapper containers carry the same presets to any content:

```
:::center
| goals | scored |
|-------|--------|
| home  | 3      |
:::
```

The five names are `:::center`, `:::right`, `:::wide`, `:::narrow`, and
`:::full`. Each applies its preset to everything in its scope. The centering
wrappers also center text lines, and center or right-align any block that is
narrower than the column, which tables and images naturally are. There is no
`:::left` or `:::normal`, because defaults need no wrapper. In a plain
viewer, a wrapper is just two extra fence lines around readable markdown.

### Side-by-side content

`:::row` is the one multi-cell container. Its block children become
equal-width cells that sit side by side, wrap responsively, and stack on
narrow screens or in plain viewers.

```
:::row{cols=3}
::stat{data=stars label="Stars"}
::stat{data=forks label="Forks"}
::stat{data=issues label="Issues"}
:::
```

`cols` accepts 2, 3, or 4; anything else falls back to automatic fitting.
There are no spans, no per-cell sizes, and no other knobs. It exists so a
dashboard of stats and charts can share a line, and nothing more.

### What layout deliberately cannot do

Text does not wrap around components. Floating content is the single largest
source of layout pain in documents and reads badly at every width, so
everything stacks, and side-by-side placement is what `:::row` is for.

## Live values in prose

A document can display values produced by its scripts. `:value[stars]`
renders a named value inline in a sentence, and `data=stars` feeds one to a
component. If the value doesn't exist yet, the component shows a quiet empty
state instead of an error.

One caveat belongs here rather than in the scripting guide: `:value[...]` is
the worst-degrading construct in the format, because in a plain viewer it
appears as literal directive syntax in the middle of a sentence. It stays in
the format, since live values in prose are worth having, but prose meant to
travel should prefer component bindings like `::stat{data=stars}`, which
degrade to a clean line of their own. The full scripting model is in
[scripting.md](scripting.md).

## What markdown features are out

Raw HTML is not rendered. The reference renderer drops `html` nodes rather
than parsing them. This is deliberate: directives are the extension
mechanism, and layout is a directive concern, never a raw `<div>`. Dropping
HTML also removes a whole class of injection problems before they start.

## Frontmatter and links

A document may open with optional YAML frontmatter for metadata. The
reference parser recognizes it: a leading `---` block becomes a metadata
node in the syntax tree and is dropped from the rendered page, because
metadata is never content. Everywhere else `---` keeps its ordinary
meaning, so a horizontal rule mid-document is still a horizontal rule, and
an opening fence that is never closed degrades to ordinary markdown rather
than swallowing the file.

Its one format-defined key is `uses:`, which names the component packs a
note expects, written either inline as `uses: [ana, gh]` or as a list of
`- name` lines beneath it. It is purely informative; it lets a renderer say
"this note uses pack `ana`, which is not installed" instead of showing bare
fallback boxes. The rest of the block belongs to whoever wrote it: the
reference implementation reads `uses:` in those two shapes and hands the
remaining text back raw, deliberately carrying no YAML library. A `uses:`
written any other way is simply not read; the note still renders, and
nothing is reported as an error.

Links between notes are ordinary relative markdown links, like
`[roadmap](./roadmap.mk.md)`. They work in every viewer today. Wiki-style
`[[links]]` are an application feature, not part of the format. So that
promoting a note to a bundle doesn't break links pointing at it, a link to
`./x.mk.md` should resolve to `./x.mkbundle` when a bundle of that name
exists.

## One file or a bundle

A single `.mk.md` file is first-class and never deprecated. When a note
accumulates images, long scripts, or data that should travel with it, it can
be promoted to a `.mkbundle` bundle: a folder (or a zip of that folder)
holding the document plus its assets. See [bundles.md](bundles.md).

## The name

The format is called Mark, and the brand it ships under is Mark II — the
same pun the `@markii` npm scope spells out. The two are used consistently:
product-facing titles (the repository, the documentation, the VS Code
extension, the playground) say Mark II, while running prose and the format
name itself say Mark — "a Mark document", never "a Mark II document". The
file extension is `.mk.md` and bundles are `.mkbundle`.

The name carries no version: the spec uses ordinary semantic versioning,
and the "II" is the Iron Man suit motif, flavor rather than a version
scheme. Do not read Mark II as "version 2".
