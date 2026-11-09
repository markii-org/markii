-- Filetype detection works without calling setup(); the server and commands
-- need `require("markii").setup()`.
if vim.g.loaded_markii == 1 then
  return
end
vim.g.loaded_markii = 1
require("markii").register_filetype()
