export const DEMO_DOC = `# Mark playground

Type \`.mk.md\` in the left pane; the right pane re-renders live.

## Scripting: a live fetch

Rendering never runs a script — it only reads whatever the value store
already has (spec §8: "rendering is pure; running is an event"). Click
**Run scripts** above the preview to actually execute this block and fetch
real data:

\`\`\`lua {name=stars}
local repo = net.fetch_json("https://api.github.com/repos/facebook/react")
return repo.stargazers_count
\`\`\`

facebook/react has :value[stars] stars.

Before you click Run, that shows the missing-value marker \`{stars}\` — the
script hasn't produced anything yet. After Run, it shows the fetched
number. Re-rendering (e.g. editing this paragraph) never re-fetches; only
another click of Run does.

## Built-in components

:::callout{type=info title="Heads up"}
This is a **container directive**. It can hold any markdown, including a
nested component:

::rating{value=4 max=5}
:::

Press :kbd[Ctrl+S] to save. That was an *inline* text directive.

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
