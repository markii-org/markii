export const DEMO_DOC = `# Super Markdown playground

Type \`.smd\` in the left pane; the right pane re-renders live.

## Built-in components

:::callout{type=info title="Heads up"}
This is a **container directive**. It can hold any markdown, including a
nested component:

::rating{value=4 max=5}
:::

Press :kbd[Ctrl+S] to save. That was an *inline* text directive.

## Nesting

::::callout{type=warning title="Nested callouts work too"}
Outer callout.

:::callout{type=danger title="Inner"}
Inner callout, nested one level deep.
:::
::::

## Unknown directives degrade gracefully

:::timeline{src="repo.json"}
Not registered in this playground — renders as a neutral fallback box
instead of crashing.
:::

## Directive-like text inside a code fence stays literal

\`\`\`
:::callout{type=info title="Not rendered"}
This text looks like a directive but is inside a code fence, so it stays
as plain text.
:::
\`\`\`
`;
