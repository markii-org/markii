-- Markii for Neovim: filetype detection for `.mk.md` notes, the `markii lsp`
-- language server, and a viewer command. This file holds no Markii logic:
-- completion, hover, diagnostics, and fence lengthening all come from the
-- server in the @markii/cli package.
local M = {}

local defaults = {
  -- The server command. Override it to point at a specific install, e.g.
  -- { "node", "/path/to/markii.mjs", "lsp" }.
  cmd = { "markii", "lsp" },
  -- The viewer command that :MarkiiView runs with the note's path appended.
  view_cmd = { "markii", "view" },
  -- Folders that mark a project root. The nearest ancestor holding one wins;
  -- with none, the note's own folder is the root.
  root_markers = { ".git" },
  -- Start the server for markii buffers.
  lsp = true,
  -- Define :MarkiiView.
  commands = true,
  -- How :MarkiiView opens its terminal.
  view_split = "botright split",
  -- Called after the plugin's own on_attach (the `K` hover mapping and
  -- omnifunc); use it for more buffer-local mappings.
  on_attach = nil,
  capabilities = nil,
}

M.config = vim.deepcopy(defaults)

local group = vim.api.nvim_create_augroup("markii", { clear = true })
local warned = {}

local function warn_once(key, message)
  if warned[key] then
    return
  end
  warned[key] = true
  vim.notify("markii: " .. message, vim.log.levels.WARN)
end

--- Registers `*.mk.md` as filetype `markii`. Safe to call more than once.
function M.register_filetype()
  vim.filetype.add({
    pattern = {
      [".*%.mk%.md"] = { "markii", { priority = 20 } },
    },
  })
end

local function root_dir(buf)
  local name = vim.api.nvim_buf_get_name(buf)
  local folder = vim.fs.dirname(name)
  if folder == nil or folder == "" then
    return vim.loop.cwd()
  end
  local found = vim.fs.find(M.config.root_markers, { upward = true, path = folder })[1]
  if found ~= nil then
    return vim.fs.dirname(found)
  end
  return folder
end

--- Buffer-local editing defaults on attach: `K` shows hover and `omnifunc`
--- completes, each only when the user has not set their own.
local function on_attach(client, bufnr)
  if vim.fn.maparg("K", "n") == "" then
    vim.keymap.set("n", "K", vim.lsp.buf.hover, { buffer = bufnr, desc = "Markii hover" })
  end
  if vim.bo[bufnr].omnifunc == "" then
    vim.bo[bufnr].omnifunc = "v:lua.vim.lsp.omnifunc"
  end
  if M.config.on_attach ~= nil then
    M.config.on_attach(client, bufnr)
  end
end

--- Starts (or reuses) the language server for a buffer.
function M.start(buf)
  buf = buf or vim.api.nvim_get_current_buf()
  local cmd = M.config.cmd
  if vim.fn.executable(cmd[1]) == 0 then
    warn_once(
      "executable",
      ("`%s` was not found on PATH. Install it with `npm install -g @markii/cli@next`, or set `cmd` in setup()."):format(
        cmd[1]
      )
    )
    return nil
  end
  return vim.lsp.start({
    name = "markii",
    cmd = cmd,
    root_dir = root_dir(buf),
    capabilities = M.config.capabilities,
    on_attach = on_attach,
  }, { bufnr = buf })
end

local function on_markii_buffer(args)
  -- Markdown highlighting until a dedicated syntax exists. Tree-sitter's
  -- markdown parser is used when installed, the regex syntax otherwise.
  vim.bo[args.buf].syntax = "markdown"
  pcall(vim.treesitter.start, args.buf, "markdown")
  if M.config.lsp then
    M.start(args.buf)
  end
end

--- Opens the current note in `markii view` in a terminal split.
function M.view(path)
  path = path or vim.api.nvim_buf_get_name(0)
  if path == "" then
    vim.notify("markii: this buffer has no file to view", vim.log.levels.WARN)
    return
  end
  local cmd = vim.list_extend(vim.deepcopy(M.config.view_cmd), { path })
  if vim.fn.executable(cmd[1]) == 0 then
    warn_once("view-executable", ("`%s` was not found on PATH."):format(cmd[1]))
    return
  end
  vim.cmd(M.config.view_split)
  vim.fn.termopen(cmd)
  vim.cmd("startinsert")
end

--- Configures the plugin. Calling it is optional for filetype detection but
--- required to start the server and define commands.
function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})
  M.register_filetype()
  vim.api.nvim_clear_autocmds({ group = group })
  vim.api.nvim_create_autocmd("FileType", {
    group = group,
    pattern = "markii",
    callback = on_markii_buffer,
  })
  if M.config.commands then
    vim.api.nvim_create_user_command("MarkiiView", function(command)
      M.view(command.args ~= "" and command.args or nil)
    end, { nargs = "?", complete = "file", desc = "View a Markii note in the terminal viewer" })
  end
  -- A markii buffer opened before setup() ran.
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].filetype == "markii" then
      on_markii_buffer({ buf = buf })
    end
  end
end

return M
