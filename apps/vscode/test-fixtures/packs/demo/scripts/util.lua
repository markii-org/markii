-- The "demo" exemplar pack's one shared Lua module (docs/packs.md: "A pack
-- is also the distribution unit for shared Lua"). A note's script reaches
-- this via `require "demo/util"`.
return {
  greet = function(name)
    return "hello, " .. tostring(name)
  end,
}
