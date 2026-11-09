# Markii CLI

A terminal front end for [Markii](../../README.md) (`.mk.md`) notes: view a
note in the terminal, export it, and run its scripts through the same
shared, security-critical run path the VS Code extension and the Obsidian
plugin use. For the format itself, see [`../../docs/`](../../docs/); this
page only covers the CLI.

The CLI is a host, not a renderer: rendering is `@markii/ansi`'s job, and
running scripts is `@markii/host`'s job. This app supplies only its own
seams: argument parsing, terminal input and output, file and bundle access,
and device-local state.

## Install

The CLI needs Node.js 22 or later. It has no runtime dependencies: the
renderer, the script runner, and the Lua engine are bundled into the
package.

```
npm install -g @markii/cli
markii --help
```

## Running from source

From the repository root:

```
npm run build --workspace @markii/cli
node apps/cli/dist/markii.mjs --help
```

## Commands

### `markii view <file>`

Renders a note to the terminal.

- `<file>` is a `.mk.md` file, a `.mkz` (or legacy `.mkbundle`) bundle, or a
  directory holding a bundle's `manifest.json`.
- `--width <n>` renders at a fixed column width. Without it, the CLI uses
  the terminal's own width, or 80 columns when that is not available.
- `--color <auto|never|16|256|truecolor>` controls color output. `auto`
  (the default) detects from `NO_COLOR`, `FORCE_COLOR`, `TERM`, `COLORTERM`,
  and whether stdout is a terminal, the same rules a well-behaved terminal
  program follows. `never` always renders plain text.
- `--box <unicode|ascii>` picks the characters frames, rules, bars, and
  markers are drawn with. `ascii` uses plain 7-bit characters, for a
  terminal or a log that cannot show box drawing. Without the flag, the CLI
  uses `ascii` when `TERM` is `dumb` or the locale (the first of `LC_ALL`,
  `LC_CTYPE`, `LANG` that is set) is not UTF-8, and `unicode` otherwise.
- `--no-run` never runs the note's scripts, even in an interactive
  terminal.
- `--static` renders the note once and exits, even in a terminal.
- `--watch` renders the note again whenever its file changes, until you
  quit the live viewer with q or stop a static render with Ctrl+C. The live
  viewer keeps its focus and open tabs across a change. A static render
  clears the screen and prints the note again, so `--watch` needs a
  terminal on stdout and exits with code 3 when given a pipe. Scripts are
  not re-run on a change. If the file disappears or cannot be read, the
  last render stays on screen and the reason goes to stderr once.

If the note has scripts, `--no-run` was not given, and both stdin and
stdout are terminals, `markii view` runs the note's scripts once before
rendering. Otherwise it renders with whatever values the note last
produced, shown as cached. A note that has never been run shows its
standard empty states.

#### The live viewer

In a terminal, `markii view` opens the note in a live viewer rather than
printing it and exiting. Tabs show one panel at a time, and a details block
starts folded unless it was written with `open`.

| Key              | What it does                                      |
| ---------------- | ------------------------------------------------- |
| left, right, tab | Switch to the previous or next tab                |
| enter            | Fold a details block open or closed               |
| up, down, j, k   | Move focus to the previous or next foldable block |
| space, pgdn      | Scroll down one screen                            |
| b, pgup          | Scroll up one screen                              |
| g, G             | Jump to the top or the bottom of the note         |
| ctrl-e, ctrl-y   | Scroll down or up one line                        |
| q                | Quit                                              |

The focused block is marked in the accent color and with a `›` glyph (`>`
with `--box ascii`) before its heading, so focus is visible even on a theme with no perceptible accent
color. A focused, closed details block also shows a dim `enter to open`
hint next to its summary (`enter to close` once it is open). A status line
at the bottom of the view names the focused block and repeats the key
legend.

A note longer than the terminal scrolls inside the window, and the status
line stays pinned at the bottom. Moving focus to a block scrolls it into
view. With nothing to focus, j and k scroll one line.

A tabs or details block nested inside a callout, a card, or a figure takes
focus like any other.

The viewer needs both stdin and stdout to be terminals. Piping the output,
redirecting it to a file, or passing `--static` renders the note once and
exits, which is the behavior scripts and CI depend on. That path is plain
text with no cursor movement in it, so it is safe to capture.

### `markii export <file> --format <html|ansi|md-plain> -o <file>`

Exports a note to a file. Both `--format` and `-o`/`--output` are required.

- `html` renders through the same static HTML engine the VS Code and
  Obsidian exports use, so the output is byte-identical to what either
  host would export for the same note and the same last-run values.
- `ansi` writes the same rendering `markii view` shows, to a file. Color
  defaults to `never` for a file (nobody's terminal reads it directly); an
  explicit `--color` is still honored. The box style defaults to
  `unicode` for the same reason; `--box ascii` is honored.
- `md-plain` downgrades the note to plain CommonMark. See "Ceilings" below.

`markii export` never runs a note's scripts. `html` and `ansi` bake in
whatever values the note last produced, exactly like `markii view`
without running.

### `markii pack install <file.mkp>`, `markii pack list`, `markii pack remove <namespace>`

Component packs add directives of their own. A pack can carry terminal
views next to its React ones, and `markii view` and `markii export --format
ansi` draw those. A pack component with no terminal view renders as a box
reading "no terminal view for `name`", and in an HTML export every pack
component reads "no HTML view for `name`". A pack whose `terminal.js`
fails to load reads "the `name` pack failed to load" instead, with the
cause on stderr. A misspelled or uninstalled name still reads "unknown
component".
The packs `read`, `dash` and `prep` ship with the CLI; their names cannot
be installed over or removed.

`markii pack install` installs a `.mkp` archive. It checks the archive
first, then asks:

```
Installing "ana" lets its code run inside the rendered note. Only install a pack from someone you trust. In the terminal this code runs with all the permissions of your user account. [y/N]
```

Installing over a pack that is already there asks again. When stdin is not
a terminal, the install is refused unless you pass `--yes`. `--yes` answers
only these two questions; it never grants network access to a note.

`markii pack list` shows what is installed, and `markii pack remove`
deletes one pack.

### `markii run <file>`

Runs a note's scripts once, at the manual tier, and exits. For each
network host the note's scripts reach, the CLI asks in the terminal:

```
This note's scripts can send data to api.example.com. Allow? [y/N]
```

Anything other than `y` or `yes` (case-insensitive), including an empty
line, is a decline. There is no flag to answer these automatically: a
grant cannot be given non-interactively. If stdin is not a terminal, every
prompt is declined without asking, and the CLI says so once on stderr.

Granted hosts are remembered per note (keyed by its exact script content)
so the same note does not re-prompt on every run.

### `markii lsp`

Runs a language server over stdin and stdout for editors such as Neovim,
Helix and Emacs: completion, hover, diagnostics, and fence lengthening for
`.mk.md` documents. It never runs a note's scripts and never uses the
network. Pack-loading problems go to the editor's log; `--verbose` adds the
informational pack lines. It exits with 0 after the client's shutdown
request and 1 otherwise, as the protocol specifies.

## Where the CLI keeps its state

Everything the CLI remembers between runs lives in one file, `state.json`,
in a per-platform, per-device directory:

| Platform | Location                                                       |
| -------- | -------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/markii` if set, otherwise `~/.config/markii` |
| macOS    | `~/Library/Application Support/markii`                         |
| Windows  | `%APPDATA%/markii`                                             |

Installed packs live beside it, in a `packs` folder with one folder per
namespace. Those folders and the packs that ship with the CLI are the only
places pack code is loaded from: never a note, a bundle, the current
directory, or an environment variable.

That file holds the network grants you gave by hand, each note's last-run
values, its bundle cache snapshot, and the outcome of its last run. It is
created with restrictive permissions and is never synced or shared by the
CLI itself. Deleting it clears your grants and your notes' cached values
together, so a note you delete it for will both re-prompt and render its
empty states until you run it again.

## Diagnostics

Everything that is not the rendered note or the exported file goes to
stderr: a run's failures, a note's declared-vs-actual network mismatches,
render-time notices, packs that could not load, and, without `--verbose`,
one line for each installed pack component the note uses that has no
terminal view. `markii run` always
prints these. `markii view` prints only a one-line marker per script
failure by default, plus one line for each pack that failed to load; pass
`--verbose` for the full detail and for the list of packs that loaded.

## Exit codes

| Code | Meaning                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 0    | Success                                                                                                     |
| 1    | The file could not be read, or rendering failed                                                             |
| 2    | A script failed while running                                                                               |
| 3    | A usage error (an unknown flag, a flag the subcommand does not take, missing arguments, unknown subcommand) |

## Ceilings

- **Pack views are static.** A pack's terminal view is drawn once, as a
  snapshot: it cannot take focus or react to keys in the live viewer.
- **`md-plain` is a downgrade, not a render.** It rewrites the note's own
  source text: a container directive loses its opening and closing fence
  lines but keeps its inner markdown, a leaf directive is removed, a text
  directive is replaced by its own text content, and script fences are
  removed. A component becomes its inner content, nothing more: the result
  is readable plain markdown, not a faithful render of what the component
  would have shown. Use `--format html` when you need the real rendering.
