# Markii for Neovim

A thin Neovim plugin for [Markii](https://github.com/markii-org/markii) notes
(`.mk.md`). It detects the filetype, starts the Markii language server, and
adds a viewer command. The editing features come from the server, which uses
the same completion and hover code as the VS Code extension.

- Directive, attribute, and value completion, including installed packs.
- Hover documentation for a directive, on `K`.
- Diagnostics for a directive that names nothing, a block component written
  inline, and an attribute value outside its allowed set.
- Fence lengthening: completing a container inside another container extends
  the enclosing fences so the nesting stays legal.
- `:MarkiiView` opens the note in `markii view` in a terminal split.
- `:checkhealth markii` checks that the server is installed.

## Requirements

- Neovim 0.9 or newer.
- Node.js 22 or newer.
- The Markii command line tool, which carries the language server:

```sh
npm install -g @markii/cli@next
```

The plugin only runs `markii lsp`; it reads no note content itself.

## Install

The plugin lives in the `apps/nvim` folder of the Markii repository. No
separate plugin repository exists, so a plugin manager clones the whole
repository and the plugin's folder is added to the runtime path.

With lazy.nvim, point a spec at the repository and add the subfolder in
`config`:

```lua
{
  "markii-org/markii",
  lazy = false,
  config = function(plugin)
    vim.opt.rtp:append(plugin.dir .. "/apps/nvim")
    require("markii").setup()
  end,
}
```

With no plugin manager, clone the repository and add the folder to the
runtime path in your `init.lua`:

```lua
vim.opt.rtp:append(vim.fn.expand("~/src/markii/apps/nvim"))
require("markii").setup()
```

The clone is one command:

```sh
git clone https://github.com/markii-org/markii ~/src/markii
```

## How to use it

Install the tool, add the plugin, and check the setup:

```sh
npm install -g @markii/cli@next
```

```vim
:checkhealth markii
```

The report shows whether `markii` is on your `PATH`, its version, and
whether it supports `lsp`. It prints the install command when the tool is
missing.

Open a note. Any file ending in `.mk.md` gets the `markii` filetype and the
language server starts:

```sh
nvim notes/trip.mk.md
```

Type `:::` and press `<C-x><C-o>` to complete a directive name. Completion
also opens on its own in a client with automatic completion, since the
server asks for it after `:`, `{`, `=`, a quote, and a space. Move the
cursor onto a directive and press `K` to read its documentation.

Diagnostics appear in the sign column and as virtual text. Use
`vim.diagnostic.open_float()` or `]d` to read one. A directive that names
nothing, a block component written inline, and an attribute value outside
its allowed set each get one.

Run the note's scripts and read the result with the viewer:

```vim
:MarkiiView
```

The viewer opens in a split and runs the note's scripts, asking first when
a script wants the network. Press `r` there to run them again and `q` to
quit. Install a pack with `markii pack install <file.mkp>` in a shell. The
server reads the pack's `pack.json` the next time it starts, so restart it
with `:LspRestart` or reopen the note. The pack's components then complete
and validate.

The server never runs a script or a pack's code. A pack folder it cannot
read is written to the language server log, which `:LspLog` opens.

## Keys

The plugin sets two buffer-local defaults when the server attaches. Each is
left alone when you already set your own.

| Setting    | Default                  | What it does                         |
| ---------- | ------------------------ | ------------------------------------ |
| `K`        | `vim.lsp.buf.hover`      | Show documentation for the directive |
| `omnifunc` | `v:lua.vim.lsp.omnifunc` | Complete with `<C-x><C-o>`           |

## Configuration

These are the defaults. Pass only what you change.

```lua
require("markii").setup({
  cmd = { "markii", "lsp" },
  view_cmd = { "markii", "view" },
  root_markers = { ".git" },
  lsp = true,
  commands = true,
  view_split = "botright split",
  on_attach = nil,
  capabilities = nil,
})
```

To use a tool that is not on your `PATH`:

```lua
require("markii").setup({
  cmd = { "node", "/path/to/markii.mjs", "lsp" },
})
```

For completion with snippet support, pass your completion plugin's
capabilities, for example `capabilities = require("cmp_nvim_lsp").default_capabilities()`.
The server then places the cursor inside a completed component.

## Commands

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `:MarkiiView [file]` | Open the file (default: this note) in `markii view` |

## Notes

The server never runs a note's scripts, never evaluates a pack's code, and
never uses the network. It reads each installed pack's `pack.json`, in the
folder `markii pack install` writes to and in the folder of packs shipped
with the tool.

Its findings do not depend on a renderer. A pack component that has no
terminal view is not reported, because the same note renders in other
hosts.

## Tests

`apps/nvim/test/run.sh` starts Neovim headless against the CLI built in
this repository. It checks the filetype, the client attaching, completion
after `:::` and `:`, the completion trigger characters, hover, the `K`
mapping, diagnostics, and `:checkhealth markii`. Build the CLI first with
`npm run build -w @markii/cli`. The `Neovim plugin` workflow runs it on
Neovim 0.9.5 and the current stable release.

## License

MIT.
