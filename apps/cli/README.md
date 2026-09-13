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

This package is not published yet. Run it from source.

## Running from source

From the repository root:

```
npm run build --workspace markii-cli
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
- `--no-run` never runs the note's scripts, even in an interactive
  terminal.
- `--static` renders the note once and exits, even in a terminal.

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
| q                | Quit                                              |

The focused block is marked in the accent color, so it is always clear what
a key will act on.

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
  explicit `--color` is still honored.
- `md-plain` downgrades the note to plain CommonMark. See "Ceilings" below.

`markii export` never runs a note's scripts. `html` and `ansi` bake in
whatever values the note last produced, exactly like `markii view`
without running.

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

## Where the CLI keeps its state

Everything the CLI remembers between runs lives in one file, `state.json`,
in a per-platform, per-device directory:

| Platform | Location                                                       |
| -------- | -------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/markii` if set, otherwise `~/.config/markii` |
| macOS    | `~/Library/Application Support/markii`                         |
| Windows  | `%APPDATA%/markii`                                             |

That file holds the network grants you gave by hand, each note's last-run
values, its bundle cache snapshot, and the outcome of its last run. It is
created with restrictive permissions and is never synced or shared by the
CLI itself. Deleting it clears your grants and your notes' cached values
together, so a note you delete it for will both re-prompt and render its
empty states until you run it again.

## Diagnostics

Everything that is not the rendered note or the exported file goes to
stderr: a run's failures, a note's declared-vs-actual network mismatches,
and render-time notices. `markii run` always prints these. `markii view`
prints only a one-line marker per script failure by default; pass
`--verbose` for the full detail.

## Exit codes

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 0    | Success                                                          |
| 1    | The file could not be read, or rendering failed                  |
| 2    | A script failed while running                                    |
| 3    | A usage error (bad flags, missing arguments, unknown subcommand) |

## Ceilings

- **No packs.** The CLI loads no component packs. A pack directive renders
  as the unknown-component fallback, which is the same ceiling the editor
  hosts' static HTML export has, and the note stays readable either way.
- **`md-plain` is a downgrade, not a render.** It rewrites the note's own
  source text: a container directive loses its opening and closing fence
  lines but keeps its inner markdown, a leaf directive is removed, a text
  directive is replaced by its own text content, and script fences are
  removed. A component becomes its inner content, nothing more: the result
  is readable plain markdown, not a faithful render of what the component
  would have shown. Use `--format html` when you need the real rendering.
