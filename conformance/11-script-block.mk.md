A note with a script block, for contrast with plain code:

```lua {name=stars}
local repo = net.fetch_json("https://api.github.com/repos/x/y")
return repo.stargazers_count
```

::stat-card{data=stars label="GitHub stars"}

The block above is an ordinary fenced code block at the parse layer — no
special script syntax exists here. A plain markdown viewer renders it as
highlighted `lua` code and nothing more.
