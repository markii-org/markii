-- Headless check of the Neovim plugin against a real `markii lsp`.
--
--   MARKII_CMD='node /path/to/markii.mjs' \
--     nvim --headless -u NONE -i NONE --cmd 'set rtp+=apps/nvim' -l apps/nvim/test/headless.lua
--
-- It opens a .mk.md note, waits for the client to attach, then asks for
-- completion and hover and waits for diagnostics. Any failure exits non-zero.
local get_clients = vim.lsp.get_clients or vim.lsp.get_active_clients
local failures = {}

local function check(condition, message)
  if not condition then
    table.insert(failures, message)
    io.stderr:write("FAIL: " .. message .. "\n")
  else
    io.stdout:write("ok: " .. message .. "\n")
  end
end

local function finish()
  vim.cmd(#failures == 0 and "qall!" or "cquit 1")
end

local cmd = { "markii", "lsp" }
if vim.env.MARKII_CMD and vim.env.MARKII_CMD ~= "" then
  cmd = vim.split(vim.env.MARKII_CMD, " ", { trimempty = true })
  table.insert(cmd, "lsp")
end

vim.cmd("filetype on")
require("markii").setup({ cmd = cmd })

local dir = vim.fn.tempname()
vim.fn.mkdir(dir, "p")
vim.fn.mkdir(dir .. "/.git", "p")
local note = dir .. "/note.mk.md"
vim.fn.writefile({
  ":::", -- line 0: a fence with no name yet
  "",
  "::callout{type=\"bogus\"}", -- line 2: invalid attribute value
  "hi",
  "::",
  "",
  ":::cal", -- line 6
  "",
  "::nothing{}", -- line 8: unknown directive
  "",
  "Press :kb", -- line 10: inline directive name
}, note)

vim.cmd("edit " .. vim.fn.fnameescape(note))
check(vim.bo.filetype == "markii", "filetype is markii (got " .. vim.bo.filetype .. ")")
-- Newer Neovim ships a markdown tree-sitter parser; starting it turns the
-- regex syntax off, so either highlighter counts.
local ts_active = vim.treesitter.highlighter
  and vim.treesitter.highlighter.active[vim.api.nvim_get_current_buf()] ~= nil
check(ts_active or vim.bo.syntax == "markdown", "markdown highlighting is the fallback")

local attached = vim.wait(20000, function()
  return #get_clients({ bufnr = 0, name = "markii" }) > 0
end, 50)
check(attached, "the markii client attached")
if not attached then
  return finish()
end

local client = get_clients({ bufnr = 0, name = "markii" })[1]
check(client.server_capabilities.hoverProvider == true, "server advertises hover")
check(client.config.root_dir == dir, "root is the folder holding .git")

-- Completion on the `:::cal` line, cursor at its end.
local params = { textDocument = vim.lsp.util.make_text_document_params(0), position = { line = 6, character = 6 } }
local completion = vim.lsp.buf_request_sync(0, "textDocument/completion", params, 10000)
local labels = {}
for _, response in pairs(completion or {}) do
  local result = response.result
  local items = result and (result.items or result) or {}
  for _, item in ipairs(items) do
    labels[item.label] = true
  end
end
check(labels["callout"] == true, "completion offers callout")

local function complete_labels(line, character)
  local at = { textDocument = params.textDocument, position = { line = line, character = character } }
  local reply = vim.lsp.buf_request_sync(0, "textDocument/completion", at, 10000)
  local found = {}
  for _, response in pairs(reply or {}) do
    local result = response.result
    for _, item in ipairs(result and (result.items or result) or {}) do
      found[item.label] = true
    end
  end
  return found
end

check(complete_labels(0, 3)["callout"] == true, "completion after ::: offers callout")
check(complete_labels(10, 9)["kbd"] == true, "completion after : offers kbd")

local triggers = client.server_capabilities.completionProvider.triggerCharacters or {}
check(vim.tbl_contains(triggers, ":") and vim.tbl_contains(triggers, "{"), "server advertises : and { as triggers")

local k = vim.fn.maparg("K", "n", false, true)
-- Neovim 0.10 and later map K to LSP hover themselves when a client
-- attaches, so the plugin leaves that mapping alone; 0.9 has none, so the
-- plugin adds its own. Either way K must be mapped after attach.
check(next(k) ~= nil and (k.desc == "Markii hover" or vim.fn.has("nvim-0.10") == 1), "K is mapped to hover in the buffer")
check(vim.bo.omnifunc ~= "", "omnifunc is set")

local hover_params = { textDocument = params.textDocument, position = { line = 2, character = 4 } }
local hover = vim.lsp.buf_request_sync(0, "textDocument/hover", hover_params, 10000)
local hovered = false
for _, response in pairs(hover or {}) do
  if response.result and response.result.contents and tostring(response.result.contents.value):find("callout") then
    hovered = true
  end
end
check(hovered, "hover describes callout")

local got_diagnostics = vim.wait(10000, function()
  return #vim.diagnostic.get(0) >= 2
end, 50)
check(got_diagnostics, "diagnostics arrive")
local codes = {}
for _, diagnostic in ipairs(vim.diagnostic.get(0)) do
  codes[tostring(diagnostic.code)] = true
end
check(codes["invalid-attribute-value"] == true, "diagnostic for the invalid attribute value")
check(codes["unknown-directive"] == true, "diagnostic for the unknown directive")

-- :checkhealth markii reports the tool, with it installed and with it missing.
local function health_text()
  vim.cmd("checkhealth markii")
  local text = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n")
  vim.cmd("bwipeout!")
  return text
end
vim.cmd("edit " .. vim.fn.fnameescape(note))
local report = health_text()
check(report:find("supports `lsp`", 1, true) ~= nil, "health reports lsp support")
check(report:find("version ", 1, true) ~= nil, "health reports the version")
require("markii").config.cmd = { "markii-not-installed", "lsp" }
report = health_text()
check(report:find("was not found on PATH", 1, true) ~= nil, "health reports a missing tool")
check(report:find("npm install -g @markii/cli@next", 1, true) ~= nil, "health gives the install command")
require("markii").config.cmd = cmd

vim.lsp.stop_client(client.id)
vim.wait(5000, function()
  return client.is_stopped()
end, 50)
check(client.is_stopped(), "the client stops cleanly")
finish()
