A directive name MUST NOT contain `:`. The grammar makes this the same
case as malformed syntax: the colon inside the name breaks recognition
entirely, so the whole construct degrades to plain text rather than
parsing with a truncated or colon-bearing name.

:::a:b
Never recognized as a container directive.
:::

Inline form: :a:b[label] also stays literal text.
