<p align="center">
  <img src="res/logo_512x512.png" alt="Markii" width="256" height="256" />
</p>
<p align="center">
  <a href="https://github.com/markii-org/markii/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/markii-org/markii/ci.yml?branch=main&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@markii/react"><img alt="npm" src="https://img.shields.io/npm/v/@markii/react?logo=npm&label=npm" /></a>
  <a href="LICENSE"><img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-green" /></a>
  <a href="docs/README.md"><img alt="docs" src="https://img.shields.io/badge/docs-read-1E3A5F" /></a>
  <a href="https://markii-org.github.io/markii-vault/"><img alt="playground" src="https://img.shields.io/badge/playground-try%20it-F28C1E" /></a>
  <a href="docs/spec.md"><img alt="spec" src="https://img.shields.io/badge/spec-read-E0A82E" /></a>
</p>

# Markii

https://github.com/user-attachments/assets/a806b239-8d73-4735-a1f5-53e22a76adf3

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
> For more details on how Markii works, try the [guided tour](https://markii-org.github.io/markii-vault/#tour) in the vault playground.

Delete every directive and script and a coherent note remains. Components and
scripts feed the document and never become the document. An unknown component
renders as a labeled box, scripts never run on open, and nothing in a note can
break the page.

Directives carry no expressions, conditionals or loops. Scripting lives in a
separate sandboxed Lua layer that most files never touch. Components render
live in the host and can bind to data that refreshes. Static HTML or PDF is an
export. Packs are the unit for sharing components.

## Getting started

### Apps

Ways to use Markii with no coding:

<table>
  <tr>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/playground.svg" width="40" height="40" alt="" /><br />
      <h4>Playground</h4>
      Try Markii live in the browser: source, rendered view, Run.
      <br /><br />
      <a href="https://github.com/markii-org/markii-vault">Open the playground &rarr;</a>
      <br><br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/vscode-mark.png" width="40" height="40" alt="" /><br />
      <h4>VS Code extension</h4>
      Preview and run <code>.mk.md</code> files and <code>.mkz</code> bundles in the editor.
      <br /><br />
      <a href="https://marketplace.visualstudio.com/items?itemName=markii.markii-vscode">Get it on the Marketplace &rarr;</a>
      <br><br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/obsidian.svg" width="40" height="40" alt="" /><br />
      <h4>Obsidian plugin</h4>
      Markii components inside an Obsidian vault.
      <br /><br />
      <a href="https://github.com/markii-org/markii-obsidian/releases/latest">Download for Obsidian &rarr;</a>
      <br><br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/terminal.svg" width="40" height="40" alt="" /><br />
      <h4>Command line</h4>
      View, export and run a note straight in the terminal, plus a language server for Helix, Emacs and Neovim.
      <br /><br />
      <a href="https://www.npmjs.com/package/@markii/cli">Install from npm &rarr;</a>
      <br><br>
    </td>
  </tr>
</table>

Neovim has a plugin inside this repository, in `apps/nvim`. It is installed
from a checkout and has no separate plugin repository. See the
[Neovim README](apps/nvim/README.md).

To render Markii documents in your own React app:

```tsx
import { defaultRegistry } from '@markii/react/components';
import { renderMark } from '@markii/react';

const view = renderMark(source, defaultRegistry);
```

### Engines

<table>
  <tr>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/react.svg" width="40" height="40" alt="" /><br />
      <h4>React</h4>
      <code>@markii/react</code> renders an interactive DOM view.
      <br /><br />
      <strong>Available</strong>
      <br>
      <br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/html5.svg" width="40" height="40" alt="" /><br />
      <h4>Static HTML</h4>
      <code>@markii/html</code> emits a static HTML for publish, CI, archive.
      <br /><br />
      <strong>Available</strong>
      <br>
      <br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/terminal.svg" width="40" height="40" alt="" /><br />
      <h4>Terminal</h4>
      <code>@markii/ansi</code> renders a note as text you can pipe, or as a
      live view you can read at a prompt.
      <br /><br />
      <strong>Available</strong>
      <br>
      <br>
    </td>
    <td width="25%" valign="top" align="center">
      <br>
      <img src="res/icons/toolkit.svg" width="40" height="40" alt="" /><br />
      <h4>Other toolkits</h4>
      Vue, native, print: the format is engine-neutral.
      <br /><br />
      <em>Planned</em>
      <br>
      <br>
    </td>
  </tr>
</table>

## Components

Every Markii app ships a standard set of components, and packs add more.
[docs/format.md](docs/format.md) lists the set and [docs/packs.md](docs/packs.md)
describes packs.

## Integrating and extending

Markii is a format first and a library second. The definition is the spec plus
a language-agnostic conformance corpus, so a renderer in any language can
claim support by passing the same fixtures this repo tests against.

- Registering your own components, layout, scripting, bundles: start at
  [docs/format.md](docs/format.md) and the [docs index](docs/README.md).
- Embedding the libraries or writing a new renderer:
  [docs/integration.md](docs/integration.md).
- Writing a host that runs scripts, installs packs and exports:
  [docs/hosts.md](docs/hosts.md).
- Sharing components as packs: [docs/packs.md](docs/packs.md).
- The normative rules: [docs/spec.md](docs/spec.md).

## License and contributing

MIT. Issues and pull requests are welcome; changes to parser-visible
behavior need a conformance fixture, and the docs pages are the source of
truth for what the format is.

To work on the repository, run `npm install`, then `npm test` for every
workspace and `npm run dev` for the playground. Read [AGENTS.md](AGENTS.md)
and the docs before changing parser or renderer behavior.
