export const DEMO_DOC = `# Mark playground

Type \`.mk.md\` in the left pane; the right pane re-renders live.

## Scripting: a live fetch

Rendering never runs a script — it only reads whatever the value store
already has (spec §8: "rendering is pure; running is an event"). Click
**Run scripts** above the preview to actually execute this block and fetch
real data:

\`\`\`lua {name=stars}
local repo = net.fetch_json("https://api.github.com/repos/facebook/react")
return {
  stars = repo.stargazers_count,
  forks = repo.forks_count,
  spark = {3, 5, 4, 8, 7, 10, 12},
}
\`\`\`

facebook/react has :value[stars] stars.

Before you click Run, that shows the missing-value marker \`{stars}\` — the
script hasn't produced anything yet. After Run, it shows the fetched
number. Re-rendering (e.g. editing this paragraph) never re-fetches; only
another click of Run does.

## Live dashboard from that same script

Three data-bound components (\`data=stars\`), all reading from the value
store the script above just populated — no separate fetch, no extra script:

:::card{title="facebook/react"}
::stat{data=stars label="stars" trend=up}

::stat{data=forks label="forks"}

::progress{data=stars max=250000 label="stars toward 250k"}

::chart{data=spark kind=line}
:::

Before Run, every one of these shows its neutral empty state (\`—\`, an
empty bar, no chart) instead of crashing — the same graceful degradation as
a missing \`:value[]\`.

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
