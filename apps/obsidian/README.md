# Markii for Obsidian

The Obsidian plugin for [Markii](https://github.com/markii-org/markii), a
markdown format that renders components inline. It opens `.mk.md` notes in a
preview pane, runs their Lua script blocks in a sandbox, and loads component
packs.

The plugin is one host among several. The format, the specification, and the
reference renderers live in the main repository; this workspace only consumes
them.

A `.mk.md` note also renders inline in Obsidian's own Reading view, alongside
the dedicated preview pane below. A plain `.md` file is never affected.

## Install

Markii is not in the Obsidian community catalogue yet. Two routes install it
from the plugin's release repository,
[markii-obsidian](https://github.com/markii-org/markii-obsidian).

The plugin is a plain three-file install: `main.js`, `manifest.json`, and
`styles.css`. Both routes below end with the same three files in the same
place, so there is no functional difference between them.

### Zip (recommended)

1. Download `markii-{{VERSION}}.zip` from that repository's Releases page.
2. Extract it into your vault's plugin folder, `<vault>/.obsidian/plugins/`.
   The archive holds a single `markii/` folder, so you should end up with
   `<vault>/.obsidian/plugins/markii/`.
3. Restart Obsidian, or reload the community plugin list.
4. Open Settings, go to Community plugins, and enable Markii.

To update, download the newer zip and extract it over the same folder, then
reload Obsidian.

### BRAT

1. Install the [obsidian42-BRAT](https://github.com/TfTHacker/obsidian42-brat)
   plugin from the community catalogue.
2. In BRAT's settings, add a beta plugin using this repository's URL,
   `https://github.com/markii-org/markii-obsidian`.
3. BRAT fetches `manifest.json`, `main.js`, and `styles.css` from the
   latest release and keeps them updated automatically.

Markii is desktop only. It runs note scripts inside a terminatable isolate,
and Obsidian on mobile does not support that.

## Commands

All of these are in the command palette.

- **Open Markii Preview** renders the active `.mk.md` note in its own pane.
- **Run Markii scripts** runs the note's named Lua script blocks and feeds the
  data-bound components.
- **Insert Markii component** inserts a chosen component's skeleton at the
  cursor.
- **Export Markii note as HTML** writes the note as one self-contained
  `.html` file beside it in the vault, with the last run's values baked in.
  The file carries its own styles, so it opens anywhere.
- **Export Markii note as PDF** prints that same file to a `.pdf` beside the
  note. If this device cannot print, the command writes the HTML file instead
  and says so.
- **Toggle Markii script execution** turns script execution on or off for this
  device. While it is off, no note runs its scripts, whether you press Run,
  open a note with run on open enabled, or wait for a scheduled refresh. Your
  network and bundle grants are left exactly as they are.
- **Install Markii pack from file** installs a pack you were given as a single
  `.mkp` file, the only way a pack enters this plugin. It checks the archive
  first, then asks before going ahead, because a pack's code runs inside the
  preview. If a pack of the same name is already installed it asks again
  before replacing it, and an archive it cannot read installs nothing. Once
  installed, it loads immediately, in every open preview and every open
  Reading view.
- **Reload Markii packs** reloads every installed pack on demand and
  re-renders every open Markii view. Install, Remove, and Enable already do
  this for you; use this command if a pack folder changed outside the
  plugin, for example after a Sync.
- **Show Markii diagnostics** prints the plugin's pack diagnostics, and the
  active preview's last run failures, to the developer console.

## Reading view

Opening a `.mk.md` note in Reading view (not just the Markii Preview pane)
renders its components inline: callouts, cards, tabs, and the rest, the same
way the preview pane shows them. Obsidian calls this once per note, over the
whole note text, so a `:::` container that spans one of Obsidian's own
section breaks still renders as one component rather than being cut in half.

Wikilinks and embeds (`[[Page]]`, `![[image.png]]`) are converted to ordinary
links and images first, resolved the way Obsidian resolves them elsewhere in
the vault. A link to a note that does not exist stays visible as plain text
rather than breaking the render.

If the note has a value from a script run, Reading view shows it, and
updates it after you run the note's scripts again from the Markii Preview
pane. Live Preview, the source-mode editor, is unaffected: this only changes
how a note reads once you are looking at it read-only.

## Component packs

Three packs ship with the plugin and need no installation: `read` for
reading and annotation notes, `dash` for dashboards, and `prep` for revision
notes. They are built in and embedded in `main.js`, so they work on every
install. A note uses them the same way it would any other pack, for example
`:::read_source`.

This plugin installs packs only from a `.mkp` archive, with the **Install
Markii pack from file** command. There is no pack-folder setting and no
compiler: a pack always arrives prebuilt, exported from VS Code's Export
Pack command, or shared by someone who built it there. If you used to point
this plugin at a folder of pack sources, export that pack as a `.mkp` from
VS Code and install it here instead.

Manage installed packs from Settings, under **Component packs**: each one
lists its name and version, with a control to remove it. Removing a pack
deletes its files and takes effect immediately, in every open view.

A pack folder can end up on this device without being trusted here, for
example one that arrived through Obsidian Sync. Settings lists it as
"present, not enabled", with an Enable button that asks the same consent
"Install Markii pack from file" asks, since enabling it is just as
consequential: its code will run inside the preview from that point on.

A pack that claims the namespace of a bundled pack (`read`, `dash`, `prep`)
is refused at install time and named in the notice; the bundled pack always
wins that name. See
[docs/packs.md](https://github.com/markii-org/markii/blob/main/docs/packs.md)
for the full pack contract.

## Settings

Open Settings, go to Community plugins, and click Markii.

Preview placement, preview width, **Hide script blocks**, and **Render
components in Reading view** are ordinary plugin settings: they are
cosmetic, and they travel with the vault. Hiding script blocks leaves the
collapsed script markers out of the preview, for a note meant to be read
rather than edited. It hides the source blocks only: a script that fails
still marks the value it feeds, and a manual run still says that it failed.
Turning off inline Reading view only stops that inline rendering; the Markii
Preview pane keeps working exactly as before.

The settings under **Scripting**, run on open, the scheduled refresh interval,
and **Turn off script execution on this device**, are stored on this device
only. They are never synced and never shared, because each of them decides
whether code runs.

That split is the rule, not a convention: a setting that decides whether code
runs or where it may connect is never written into the vault.

## Diagnostics

Pack loading and script runs report through two surfaces. A short notice
appears in Obsidian for anything you should act on, and the full detail goes
to the developer console: which packs loaded, which were skipped and why, and
what a failed run reported. **Show Markii diagnostics** prints the current
preview's lines on demand.

A failure is never silent and never dumped into the note. The rendered page
carries a quiet marker with the reason on hover; the console carries the rest.

## License

MIT, the same as the main repository. See LICENSE.
