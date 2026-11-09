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
vim.fn.writefile({ "::callout{type=\"bogus\"}", "hi", "::", "", ":::cal", "", "::nothing{}" }, note)

vim.cmd("edit " .. vim.fn.fnameescape(note))
check(vim.bo.filetype == "markii", "filetype is markii (got " .. vim.bo.filetype .. ")")
check(vim.bo.syntax == "markdown", "markdown syntax is the fallback")

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
local params = { textDocument = vim.lsp.util.make_text_document_params(0), position = { line = 4, character = 6 } }
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

local hover_params = { textDocument = params.textDocument, position = { line = 0, character = 4 } }
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

vim.lsp.stop_client(client.id)
vim.wait(5000, function()
  return client.is_stopped()
end, 50)
check(client.is_stopped(), "the client stops cleanly")
finish()
