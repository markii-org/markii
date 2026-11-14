-- :checkhealth markii
local M = {}

local health = vim.health
local start = health.start or health.report_start
local ok = health.ok or health.report_ok
local warn = health.warn or health.report_warn
local err = health.error or health.report_error

local INSTALL = "npm install -g @markii/cli@next"

local function run(cmd)
  local output = vim.fn.system(cmd)
  return vim.v.shell_error == 0, vim.trim(output)
end

function M.check()
  start("markii")

  local config = require("markii").config
  local cmd = config.cmd
  local exe = cmd[1]

  if vim.fn.executable(exe) == 0 then
    err(("`%s` was not found on PATH"):format(exe), {
      "Install the command line tool, which carries the language server: " .. INSTALL,
      "Or point the plugin at an install with setup({ cmd = { ... } }).",
      "The tool needs Node 22 or newer.",
    })
    return
  end
  ok(("`%s` found at %s"):format(exe, vim.fn.exepath(exe)))

  -- A `node /path/markii.mjs lsp` command keeps its script argument.
  local base = vim.list_slice(cmd, 1, math.max(#cmd - 1, 1))
  if cmd[#cmd] ~= "lsp" then
    base = vim.deepcopy(cmd)
  end

  local version_ok, version = run(vim.list_extend(vim.deepcopy(base), { "--version" }))
  if version_ok and version ~= "" then
    ok("version " .. version)
  else
    warn("could not read the version (`--version` failed)", { INSTALL })
  end

  local help_ok, help = run(vim.list_extend(vim.deepcopy(base), { "--help" }))
  if help_ok and help:find("markii lsp", 1, true) then
    ok("supports `lsp`")
  else
    err("this install does not support `lsp`", { "Update it: " .. INSTALL })
  end

  if vim.fn.has("nvim-0.9") == 0 then
    err("Neovim 0.9 or newer is required")
  else
    local v = vim.version()
    ok(("Neovim %d.%d.%d"):format(v.major, v.minor, v.patch))
  end
end

return M
