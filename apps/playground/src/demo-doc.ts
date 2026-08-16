export const DEMO_DOC = `# Mark playground

Type \`.mk.md\` in the left pane; the right pane re-renders live. This tour
walks through every built-in component plus the GFM extras, on top of the
scripting model from spec §8.

## Scripting: a live fetch

Rendering never runs a script — it only reads whatever the value store
already has (spec §8: "rendering is pure; running is an event"). Click
**Run scripts** above the preview to actually execute this block and fetch
real data:

\`\`\`lua {name=repo}
local repo = net.fetch_json("https://api.github.com/repos/facebook/react")
return {
  stars = repo.stargazers_count,
  forks = repo.forks_count,
  spark = {3, 5, 4, 8, 7, 10, 12},
}
\`\`\`

facebook/react has :value[repo.stars] stars.

Before you click Run, that shows the missing-value marker \`{repo.stars}\` —
the script hasn't produced anything yet. After Run, it shows the fetched
number. \`repo\` is a single script result holding three fields; \`repo.stars\`
reaches into it by dotted path — re-rendering (e.g. editing this paragraph)
never re-fetches; only another click of Run does.

## Live dashboard from that same script

Four data-bound components, all reading dotted paths off the one \`repo\`
value the script above just populated — no separate fetch, no extra script:

:::card{title="facebook/react"}
::stat{data=repo.stars label="stars" trend=up}

::stat{data=repo.forks label="forks"}

::progress{data=repo.stars max=250000 label="stars toward 250k"}

::chart{data=repo.spark kind=line}
:::

Before Run, every one of these shows its neutral empty state (\`—\`, an
empty bar, no chart) instead of crashing — the same graceful degradation as
a missing \`:value[]\`.

## Callouts, rating, keyboard keys

:::callout{type=info title="Heads up"}
This is a **container directive**. It can hold any markdown, including a
nested component:

::rating{value=4 max=5}
:::

Press :kbd[Ctrl+S] to save. That was an *inline* text directive.

## Badges

Status pills for inline use: :badge[stable]{variant=success}
:badge[beta]{variant=info} :badge[deprecated]{variant=danger}
:badge[untagged]{variant=neutral}.

## Details (collapsible)

:::details{title="Why Lua for scripting?"}
Small (~200KB), WASM-embeddable, and reads like pseudocode — see DESIGN.md
§8 for the full rationale. Folded by default; click the summary to expand.
:::

:::details{title="This one starts open" open}
The bare \`open\` attribute expands a details block by default.
:::

## Tabs

::::tabs
:::tab{label="Pitch"}
Mark is CommonMark plus generic directives that render the author's own
React components. The file format is the product.
:::
:::tab{label="Non-goals"}
Not a Turing-complete templating language: no expressions, conditionals, or
loops in attributes (spec, Architecture rule 5).
:::
::::

## Figure

A local, offline-safe image (root-relative \`src\`, not \`data:\` or an
external URL — the URL sanitizer blocks those; see \`figure.tsx\`):

:::figure{src="/figure-sample.svg" alt="A labeled blue rectangle"}
**Figure 1.** A tiny inline SVG shipped alongside the playground, referenced
by a root-relative path so it works offline.
:::

## GFM: tables, task lists, strikethrough

| Component  | Kind      | Data-bound |
| ---------- | --------- | ---------- |
| \`stat\`     | leaf      | yes        |
| \`progress\` | leaf      | yes        |
| \`chart\`    | leaf      | yes        |
| \`card\`     | container | no         |

- [x] Fix the dashboard's dotted-path data binding
- [ ] Ship the next demo section

~~This line used to be wrong~~ — now it renders as GFM strikethrough.

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
