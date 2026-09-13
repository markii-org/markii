# Nesting

::::card{title="Outer"}
Some intro text in the outer card that is long enough to need wrapping at the width we render at.

:::card{title="Inner"}
Inner body text that also wants to wrap because it is quite long indeed yes.
:::

:::callout{type=warning title="Careful"}
A callout nested inside a card, with text long enough to wrap once or twice.
:::
::::

:::::card{title="Holder"}
::::row
:::cell
Left cell text here, long enough to wrap inside its own column.
:::
:::cell
Right cell text here, also long enough to wrap inside its own column.
:::
::::
:::::

::::row
:::card{title="A"}
Card A body text that wraps.
:::
:::card{title="B"}
Card B body text that wraps.
:::
::::

::::card{title="Listy" text=center}
- one
- two

> a quote inside a card

::::

::::callout{type=info}
:::card{title="Deep"}
A card inside a callout.
:::
::::
