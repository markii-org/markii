# Prototype-name directives

Directive names that collide with inherited `Object.prototype` members must
still render the unknown-directive fallback, not blank the document.

::constructor

:::toString
Content inside a container directive literally named `toString`.
:::

Inline collision: :hasOwnProperty[x] should also show a fallback.

::valueOf

Normal paragraph after all four collisions, proving the rest of the
document still renders.
