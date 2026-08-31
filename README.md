<p align="center">
  <img src="res/logo_512x512.png" alt="Markii" width="256" height="256" />
</p>

# Markii

<p align="center">
  <a href="https://github.com/markii-org/markii/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/markii-org/markii/ci.yml?branch=main&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@markii/react"><img alt="npm" src="https://img.shields.io/npm/v/@markii/react?logo=npm&label=npm" /></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="docs/README.md"><img alt="docs" src="https://img.shields.io/badge/docs-read-1E3A5F" /></a>
  <a href="https://sadigaxund.github.io/markii-vault/"><img alt="playground" src="https://img.shields.io/badge/playground-try%20it-F28C1E" /></a>
  <a href="docs/spec.md"><img alt="spec" src="https://img.shields.io/badge/spec-read-E0A82E" /></a>
</p>

Markii is markdown that renders your own components. A `.mk.md` file is plain
CommonMark plus one small directive syntax, so it opens as readable markdown
in any editor, and opens as a living document, with callouts, tabs, charts,
and sandboxed scripts feeding them live data, in anything that speaks Markii.

````markdown
# Example Markii note

## you can use custom components

:::callout{type=warning title="Heads up"}
This ships **Tuesday**.
:::

## you can also run `Lua` code to dynamically render your notes

```lua {name=repo}
local r = net.fetch_json("https://api.github.com/repos/facebook/react")
return { stars = r.stargazers_count }
```

## this is an example of inline substitution. see `docs/format.md`

facebook/react has :value[repo.stars] stars.
````

> [!TIP]
> For more details on how Markii works, see [README.mk.md](https://sadigaxund.github.io/markii/)

Delete every directive and script and a coherent note remains. That is the
line Markii holds: components and scripts feed the document; they never become
the document. Unknown components degrade to a labeled box, scripts never run
on open, and nothing in a note can break the page.

## Identity

Markii belongs to the same family as LaTeX: a plain-text document format you
extend with your own vocabulary, and packs fill the role packages fill there.
The identity is in what it refuses, the three things LaTeX could never give up.

- The core is not a programming language. Directives carry no expressions,
  conditionals, or loops. Scripting exists, but in a separate sandboxed Lua
  layer that most files never touch.
- There is no compiler between you and the note. A `.mk.md` file is valid
  CommonMark and stays readable in any editor, with or without Markii
  installed. An unknown component renders as a quiet labeled box, never an
  error.
- The target is a living note, not a typeset page. Components render live in
  the host and can bind to data that refreshes. Static HTML or PDF is an
  export, not the product.

Closer relatives such as MDX put a full programming language inside the file,
which is exactly the trade Markii declines.

## Identity

Markii is an extensible plain-text document format: CommonMark plus one small
directive syntax that renders components you define, with packs as the unit
of sharing them. Its identity is in three refusals.

- The syntax is not a programming language. Directives carry no expressions,
  conditionals, or loops. Scripting exists, but in a separate sandboxed Lua
  layer that most files never touch.
- Nothing stands between you and the note. A `.mk.md` file is valid
  CommonMark and stays readable in any editor, with or without Markii
  installed. An unknown component renders as a quiet labeled box, never an
  error.
- The target is a living note, not a typeset page. Components render live in
  the host and can bind to data that refreshes. Static HTML or PDF is an
  export, not the product.

If you know LaTeX, Markii wants that extensibility without the macro language
or the compiler. If you know MDX, it wants those custom components without
putting a program inside the file.

## Getting started

### Apps

Ways to use Markii with no coding:

<table>
  <tr>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/playground.svg" width="40" height="40" alt="" /><br />
      <h4>Playground</h4>
      Try Markii live in the browser: source, rendered view, Run.
      <br /><br />
      <a href="https://github.com/markii-org/markii-vault">Open the playground &rarr;</a>
      <br><br>
    </td>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/vscode-mark.png" width="40" height="40" alt="" /><br />
      <h4>VS Code extension</h4>
      Preview and run <code>.mk.md</code> files and <code>.mkz</code> bundles in the editor.
      <br /><br />
      <a href="https://marketplace.visualstudio.com/items?itemName=markii.markii-vscode">Get it on the Marketplace &rarr;</a>
      <br><br>
    </td>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/obsidian.svg" width="40" height="40" alt="" /><br />
      <h4>Obsidian plugin</h4>
      Markii components inside an Obsidian vault.
      <br /><br />
      <a href="https://github.com/markii-org/markii-obsidian/releases/latest">Download for Obsidian &rarr;</a>
      <br><br>
    </td>
  </tr>
</table>

To render Markii documents in your own React app:

```tsx
import { defaultRegistry } from '@markii/react/components';
import { renderMark } from '@markii/react';

const view = renderMark(source, defaultRegistry);
```

### Engines

<table>
  <tr>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/react.svg" width="40" height="40" alt="" /><br />
      <h4>React</h4>
      <code>@markii/react</code> renders an interactive DOM view.
      <br /><br />
      <strong>Available</strong>
      <br>
      <br>
    </td>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/html5.svg" width="40" height="40" alt="" /><br />
      <h4>Static HTML</h4>
      <code>@markii/html</code> emits a static HTML for publish, CI, archive.
      <br /><br />
      <strong>Available</strong>
      <br>
      <br>
    </td>
    <td width="33%" valign="top" align="center">
      <br>
      <img src="res/icons/toolkit.svg" width="40" height="40" alt="" /><br />
      <h4>Other toolkits</h4>
      Vue, terminal, native: the format is engine-neutral.
      <br /><br />
      <em>Planned</em>
      <br>
      <br>
    </td>
  </tr>
</table>

## Components

Every Markii app ships the standard set: callout, card, badge, details,
figure, tabs, kbd, rating, divider, and the data-bound stat, progress, and
chart.
They cover everyday notes, and they are defaults, not the ceiling.

When you outgrow them, components travel as a pack: a folder with a manifest
and ordinary components for your engine, built once and pointed at your app.
On a machine without the pack, the same note shows a labeled fallback and
stays readable. The contract lives in [docs/packs.md](docs/packs.md).

## Integrating and extending

Markii is a format first and a library second. The definition is the spec plus
a language-agnostic conformance corpus, so a renderer in any language can
claim support by passing the same fixtures this repo tests against.

- Registering your own components, layout, scripting, bundles: start at
  [docs/format.md](docs/format.md) and the [docs index](docs/README.md).
- Embedding the libraries or writing a new renderer:
  [docs/integration.md](docs/integration.md).
- Sharing components as packs: [docs/packs.md](docs/packs.md).
- The normative rules: [docs/spec.md](docs/spec.md).

## Development

```
npm install
npm test       # every workspace
npm run dev    # playground
```

The repo is an npm-workspaces monorepo: eight `@markii/*` packages split along
the format's seams, a conformance corpus, and a thin playground. Read
[AGENTS.md](AGENTS.md) and the docs before changing parser or renderer
behavior.

## License and contributing

MIT. Issues and pull requests are welcome; changes to parser-visible
behavior need a conformance fixture, and the docs pages are the source of
truth for what the format is.
