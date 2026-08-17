A quoted value containing a brace — the scanner ignores braces while inside
a quote, so this still finds the real closing `}`:

```lua {title="a }b" name=x}
return 1
```

Single-quoted vs double-quoted values:

```lua {name='single' src="double/quoted.lua"}
return 1
```

A bare (valueless) attribute alongside a `key=value` pair:

```lua {name=x publish}
return 1
```

Plain `key=bare` values with no quotes at all:

```lua {name=x src=scripts/etl.lua}
return 1
```

Text after the first `{...}` group in the info string is not a second
attribute group — only the first is parsed:

```lua {name=x} ignored trailing text {also=ignored}
return 1
```
