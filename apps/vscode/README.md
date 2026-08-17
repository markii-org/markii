# Mark II for VS Code

A preview for Mark (`.mk.md`) documents: CommonMark plus directives that
render your own React components (callouts, cards, tabs, dashboard stats,
and more — see [`docs/format.md`](../../docs/format.md) for the full
format).

This is a consumer of `@markii/react`, not a renderer. The extension
contains no parsing or rendering logic of its own; it hosts `@markii/react`
in a webview and gets a preview for free from the reference renderer.

**This v1 is rendering only.** It never runs scripts. Script blocks (the
` ```lua {name=...} ` form, see [`docs/scripting.md`](../../docs/scripting.md))
render as the reference renderer's collapsed marker, never execute, and
data-bound components (`stat`, `progress`, `chart`, `:value[...]`) show their
standard empty states rather than live data.

## Running and debugging

1. Open the repository root in VS Code.
2. From the repo root: `npm install`.
3. Build the extension: `npm run build -w markii-vscode`.
4. Launch it: press F5 ("Run Extension"), or from the command line:

   ```
   code --extensionDevelopmentPath=apps/vscode
   ```

A `.vscode/launch.json` is not committed to the repo. If you want F5 to work
without the command line, add one locally with a single configuration:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/apps/vscode"]
    }
  ]
}
```

## Preview

The command **Mark: Open Preview** opens a rendered preview of the active
`.mk.md` file. It's also available as an editor-title button (the preview
icon in the tab bar) whenever the active file matches `*.mk.md`.

## Syntax highlighting

An injection grammar (`syntaxes/markii-directives.injection.json`,
`scopeName: markdown.markii.injection`) layers highlighting for directive
syntax on top of VS Code's built-in markdown grammar: the three directive
forms (`:::container{...}`, `::leaf{...}`, `:inline[label]{attrs}`) and the
shared `{...}` attribute block. One trade-off applies to the fence-meta
group (` ```lua {name=stars} `): the built-in markdown grammar claims the
whole fence line first, so on a real fence line its own highlighting wins
and the injected rule for that `{...}` group is inert — accepted because
never risking the fence's own code-block highlighting matters more than
coloring that one attribute group.

## Packaging

`npm run package -w markii-vscode` builds the extension and produces a
`.vsix` file (gitignored). That's packaging only; publishing the `.vsix` to
the Marketplace is a separate, manual step that requires a publisher
account and is not part of this workflow.
