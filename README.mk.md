---
title: Markii
description: The README, written in Markii and rendered by Markii.
---

# Markii

This page is a Markii document. It is the same `.mk.md` you would write in any
editor: plain CommonMark, plus a small directive syntax that renders your own
components. Open it as text and it reads fine. Open it in something that speaks
Markii and it comes alive.

:::callout{type=info title="You are reading the proof"}
Everything below is authored in Markii. The callout, the badges, the tabs, and
the numbers in the cards are all directives. Delete every one of them and a
coherent note still remains.
:::

## Components, inline

Directives come in three shapes, and they nest by colon count. A short inline
one sits in a sentence: press :kbd[Ctrl]+:kbd[K] to open the palette. A rating
reads as :rating[4]. A badge labels a thing: :badge[stable].

A block directive wraps content:

:::callout{type=warning title="Scripts never run on open"}
A Markii note is safe to open anywhere. Scripts stay dormant until you ask for
them, and unknown components degrade to a labeled box instead of breaking the
page.
:::

## Live data

The block below is an ordinary Lua script. In the playground, press **Run** to
execute it. It fetches once, returns a small table, and the components read
from that table by name.

```lua {name=repo}
local r = net.fetch_json("https://api.github.com/repos/facebook/react")
return {
  stars = r.stargazers_count,
  forks = r.forks_count,
  issues = r.open_issues_count,
}
```

facebook/react has :value[repo.stars] stars and :value[repo.forks] forks.

:::::row{cols=3}

::::card
:::center
::stat{data=repo.stars label="stars"}
:::
::::

::::card
:::center
::stat{data=repo.forks label="forks"}
:::
::::

::::card
:::center
::stat{data=repo.issues label="open issues"}
:::
::::

:::::

Before you press Run, the cards show a quiet empty state. That is the point:
the document is whole with or without its data.

## Tabs and details

::::tabs

:::tab{title="Install"}
Add the renderer to a React app:

```
npm install @markii/core @markii/react
```
:::

:::tab{title="Render"}
```tsx
import { renderMark } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';

const view = renderMark(source, defaultRegistry);
```
:::

::::

:::details{title="What just happened"}
The parser turned this text into a generic directive tree. The renderer matched
each directive name to a component and handed it the attributes and the inner
markdown, already rendered. No component name is baked into the parser.
:::

## Where to go next

The full story lives in the docs: the normative spec, the format guide, the
scripting and bundle models, and the security posture. Start at
`docs/README.md`.
