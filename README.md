# Mark

[![CI](https://github.com/sadigaxund/markii/actions/workflows/ci.yml/badge.svg)](https://github.com/sadigaxund/markii/actions/workflows/ci.yml)

Mark is a markdown format that renders your own components inline. It is CommonMark and GitHub-Flavored Markdown plus a small directive syntax, so a note stays plain, readable markdown while also carrying callouts, tabs, charts, and anything else you register. Optional sandboxed scripting feeds live data into the page.

The product is the format and its reference library, not an application. A `.mk.md` file opens as ordinary markdown in any editor, and a Mark-aware renderer adds the components on top.

> [!NOTE]
> This is version 0.1.0. The `@markii/*` libraries are not on npm yet. You can run everything from source and try the hosted playground today.

## Try it

The playground is live at https://sadigaxund.github.io/markii/. Write `.mk.md` source on the left, watch it render on the right, and press Run to execute an embedded Lua block that fetches real data and drops it into the document.

## A document looks like this

````markdown
# Release notes

:::callout{type=warning title="Heads up"}
This ships Tuesday.
:::

```lua {name=repo}
local r = net.fetch_json("https://api.github.com/repos/facebook/react")
return { stars = r.stargazers_count, spark = {3, 5, 4, 8, 7, 10, 12} }
```

facebook/react has :value[repo.stars] stars.

::stat{data=repo.stars label="stars"}
::chart{data=repo.spark kind=line}
````

Delete every directive and script and a coherent note remains. That is the line Mark holds: components and scripts feed the document, they do not become the document.

## How it works

The parser emits generic directive nodes and knows nothing about any component. The renderer maps a directive name to a component, its attributes to props, and its inner markdown to children. A directive with no registered component renders a labeled fallback box, so an unknown or unsupported name never breaks the page.

You register your own components exactly the way the built-ins are registered. The twelve names below are a default set you can restyle or replace, not a fixed vocabulary.

## Standard components

The reference renderer ships callout, card, badge, details, figure, tabs and its tab child, kbd, rating, and the data-bound stat, progress, and chart. The data-bound three read a named value that a script produced, so a chart can draw from a Lua table and a stat can show a fetched number.

Tables, task lists, and strikethrough come from GFM and render natively, without a component.

## Scripting

Scripts are data providers. A block runs, returns a value, and that value gets a name. Directives then read values by name. The document stays declarative and the script never rewrites the file.

Rendering is pure. Opening a note reads the last cached values and runs nothing, so a note renders instantly and offline with its last-known data. Running a script is a separate, explicit event. What a script may do depends on how it was triggered: a manual run can use every granted capability, while an auto or scheduled run is read-only.

The runtime is Lua 5.4 in WebAssembly (wasmoon), started in an empty environment with host-injected capabilities (network, cache, bundle filesystem) and resource limits on instructions, wall-clock time, memory, and fetch size.

> [!IMPORTANT]
> In-process limits are best-effort. A production host must run scripts in a terminatable Web Worker with an external watchdog (see DESIGN.md section 10). The playground runs on the main thread only because it executes the author's own trusted demo script.

## Packages

Mark is an npm workspaces monorepo.

`@markii/core` parses text to an AST and tags directives, with zero React. `@markii/stdlib` defines the neutral component contracts (name, kind, attribute schema) that every renderer targets. `@markii/react` is the reference renderer and lives under `packages/platforms/`, so a future renderer for another toolkit sits beside it. `@markii/runtime` holds the value store and the run orchestrator. `@markii/bundle` handles the `.mkbundle` container (a document plus its scripts, assets, and cache). `@markii/lua` is the sandbox.

The conformance corpus under `conformance/` pairs `.mk.md` inputs with their expected AST as JSON. A renderer written in any language can verify against the same fixtures, which is what makes the format portable rather than tied to this TypeScript implementation.

## Development

```
npm install
npm test      # every workspace
npm run build
npm run lint
npm run dev   # start the playground
```

DESIGN.md is the specification and the source of truth for syntax, architecture, and scope. Read it before changing the parser or the renderer.

## Status

Version 0.1.0, semantic versioning. Implemented and tested (511 tests): CommonMark and GFM, the directive system, the twelve-component standard library, the Lua sandbox with the full scripting loop, and the bundle format. On the roadmap: layout presets, shareable component packs, frontmatter, a terminatable-worker host, and npm publishing.
