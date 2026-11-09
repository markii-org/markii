# Markii for Neovim

A thin Neovim plugin for [Markii](https://github.com/markii-org/markii) notes
(`.mk.md`). It detects the filetype, starts the Markii language server, and
adds a viewer command. The editing features come from the server, which uses
the same completion and hover code as the VS Code extension.

- Directive, attribute, and value completion, including installed packs.
- Hover documentation for a directive.
- Diagnostics for an invalid attribute value, a block component written
  inline, an unsafe image source, and a directive that names nothing.
- Fence lengthening: completing a container inside another container extends
  the enclosing fences so the nesting stays legal.
- `:MarkiiView` opens the note in `markii view` in a terminal split.

## Requirements

- Neovim 0.9 or newer.
- The Markii command line tool, which carries the language server:

```sh
npm install -g @markii/cli
```

Node 22 or newer is needed for the tool. The plugin only runs
`markii lsp`; it reads no note content itself.

## Install

With lazy.nvim:

```lua
{
  "markii-org/markii",
  config = function(plugin)
    vim.opt.rtp:append(plugin.dir .. "/apps/nvim")
    require("markii").setup()
  end,
}
```

The plugin lives in the `apps/nvim` folder of the Markii repository. A
dedicated repository for plugin managers is not published yet, so the
snippet adds that folder to the runtime path.

With packer.nvim:

```lua
use({
  "markii-org/markii",
  rtp = "apps/nvim",
  config = function()
    require("markii").setup()
  end,
})
```

As a native package, clone the repository and link the folder:

```sh
git clone https://github.com/markii-org/markii ~/src/markii
mkdir -p ~/.local/share/nvim/site/pack/markii/start
ln -s ~/src/markii/apps/nvim ~/.local/share/nvim/site/pack/markii/start/markii
```

Then call `require("markii").setup()` from your configuration.

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

The server never runs a note's scripts and never uses the network. It loads
the packs installed with `markii pack install`, plus the packs shipped with
the tool, the same ones `markii view` uses.

Problems with the server itself, such as a pack that failed to load, appear
in the language server log (`:LspLog`), not in the note.

## Tests

`apps/nvim/test/run.sh` starts Neovim headless against the CLI built in
this repository and checks the filetype, the client attaching, completion,
hover, and diagnostics. Build the CLI first with `npm run build -w @markii/cli`.
The `Neovim plugin` workflow runs it on Neovim 0.9.5 and the current stable
release.

## License

MIT.
