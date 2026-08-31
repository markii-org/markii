# Markii for VS Code

Preview for Markii (`.mk.md`) documents: CommonMark plus a small directive
syntax that renders components: callouts, cards, tabs, dashboard stats,
and more. See the
[format guide](https://github.com/markii-org/markii/blob/main/docs/format.md)
for the full picture.

## Getting started

No setup. After installing the extension:

1. Open any file ending in `.mk.md` (create one if you like; it's an
   ordinary text file).
2. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>
   (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> on macOS). You can also
   click the preview icon at the right of the editor title bar, or run
   **Markii: Open Preview** from the command palette.

In a `.mk.md` file that shortcut opens the Markii preview; in a plain `.md`
file it still opens VS Code's built-in markdown preview, unchanged.

The preview opens beside the editor, follows whichever `.mk.md` file is
active, updates as you type, and matches your VS Code theme.

Something to paste into a new file to see it work:

<img width="2324" height="1008" alt="image" src="https://github.com/user-attachments/assets/7b398ff7-8a52-4cdd-b76d-13dfcf5f8cf7" />

## Configuration

Markii has four settings: `markii.packs`, `markii.runOnOpen`,
`markii.refreshIntervalSeconds`, and `markii.allowPrivateNetworkAddresses`.
All four are user-scope only. A workspace's `.vscode/settings.json` cannot
set them, on purpose: it is what stops a repository you open from silently
enabling script execution, loading a pack, or widening network access on
your behalf.

To reach them:

- Open Settings and search for "Markii".
- Run **Welcome: Open Walkthrough...** from the Command Palette and pick
  "Get Started with Markii" for a short walkthrough that links to each
  setting.
- If you use profiles and want the raw JSON, run **Preferences: Open
  Application Settings (JSON)**, not the usual "Open User Settings (JSON)"
  command; application-scope settings live there.

A worked example, in that JSON file:

```json
{
  "markii.runOnOpen": true,
  "markii.refreshIntervalSeconds": 30,
  "markii.packs": ["/home/me/markii-packs/analytics"]
}
```

Two commands write these settings without opening the JSON by hand:
**Markii: Toggle Run On Open** flips `markii.runOnOpen`, and **Markii:
Enable Scheduled Refresh…** prompts for a number of seconds and writes
`markii.refreshIntervalSeconds`.

## Features

- **Components.** Renders the whole format: directives, the standard
  component set (callouts, cards, tabs, dashboard stats, and more), layout
  wrappers, tables, and frontmatter.
- **Live preview.** Opens beside the editor, follows the active `.mk.md`
  file, updates as you type, matches your VS Code theme, and highlights
  directive syntax in the editor too.
- **Scripts, on demand.** Press **Markii: Run Scripts** and each named Lua
  script block runs in a sandbox, feeding the data-bound components
  (`stat`, `progress`, `chart`, `:value[...]`). Scripts never run when a note
  is only opened, and network access is granted one host at a time, with a
  prompt. Until you run them, script blocks show a collapsed marker and
  data-bound components show their quiet empty states.
- **Monitoring notes.** A note's last values are remembered, so reopening it
  shows its figures immediately, marked stale, before any re-run. Turn on
  `markii.runOnOpen` to run a note once when its preview opens, or set
  `markii.refreshIntervalSeconds` to refresh it on an interval. Both run at
  the read-only tier: they reuse only the hosts you already granted by hand,
  never prompt on a timer, and never add network access.
- **Component packs.** Point the `markii.packs` setting, or the **Markii: Add
  Pack Folder…** command, at folders you trust as installed packs. Their
  prefixed components (for example `:::ana_timeline`) render in the preview,
  and their shared Lua is reachable from `require "ana/..."` in a note's
  scripts. A note that uses a pack you have not installed stays readable: the
  unknown component shows a labeled fallback. The setting is user-scope only,
  so opening someone else's project never loads a pack on your behalf. See the
  [packs guide](https://github.com/markii-org/markii/blob/main/docs/packs.md).
- **Authoring help.** Typing `:` or `:::` suggests component names; inside a
  brace it suggests attribute names and, for an attribute with a fixed set
  of values, the values themselves. Hovering a directive name shows its
  documentation. The **Markii: Insert Component…** command inserts a
  chosen component's skeleton at the cursor, with every standard component
  and any configured pack's components on offer.
- **Images.** Local images resolve relative to the note (`nice.png` beside
  it, `img/nice.png` in a subfolder) and remote images load over https.
  Anything outside the note's folder and your workspace is not loaded, the
  same rule VS Code's own preview uses.

The extension has no rendering logic of its own: it hosts `@markii/react`,
the format's reference renderer, so the preview shows exactly what the
reference implementation renders.

## Contributing

The extension lives in the
[Markii monorepo](https://github.com/markii-org/markii). Build, debug, and
release details are in the repo's
[AGENTS.md](https://github.com/markii-org/markii/blob/main/AGENTS.md); issues
and pull requests are welcome there.
