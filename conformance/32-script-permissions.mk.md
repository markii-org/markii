A script block declaring its intended capabilities. The `permissions`
attribute is display-only: it never affects what is actually granted, and
at the parse layer it is ordinary fence-meta text like any other attribute.

```lua {name=stars permissions=api.github.com}
local repo = net.fetch_json("https://api.github.com/repos/x/y")
return repo.stargazers_count
```

A script can declare more than one host, comma-separated with no spaces:

```lua {name=weather permissions=api.weather.com,api.geocode.com}
return net.fetch_json("https://api.weather.com/now")
```
