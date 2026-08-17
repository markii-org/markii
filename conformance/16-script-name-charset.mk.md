Valid script names, charset-wise:

```lua {name=x}
return 1
```

```lua {name=repo_stars}
return 1
```

```lua {name=__proto__}
return 1
```

A dotted name is reserved for `data=`/`:value[]` path traversal, so it is
rejected by `extractScripts` even though it parses as an ordinary fence:

```lua {name=repo.stars}
local repo = net.fetch_json("https://api.github.com/repos/x/y")
return repo.stargazers_count
```

Other charset-invalid names — still ordinary code fences at the parse layer:

```lua {name=1stars}
return 1
```

```lua {name=-stars}
return 1
```

```lua {name=repo/stars}
return 1
```
