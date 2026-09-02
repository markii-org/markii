---
title: Reading notes, August
uses: [read]
---

# Reading notes, August

## Gödel, Escher, Bach

::read_source{data=books.geb title="Gödel, Escher, Bach" author="Douglas Hofstadter" year="1979" type=book url="https://us.macmillan.com/books/9780465026562"}

Hofstadter keeps circling back to the idea of a :read_mark[strange
loop]{kind=insight}, a hierarchy that, followed far enough, lands back
where it started. I still need to work out whether that is the same idea
as a :read_term[fixed point]{def="A value that a function maps to itself: f(x) = x."},
or just a cousin of it.

:::read_quote{source="Gödel, Escher, Bach" page="152" note="Worth rereading before the chapter on Gödel's theorem."}
A strange loop arises when, by moving only upwards or downwards through the
levels of a hierarchical system, we unexpectedly find ourselves right back
where we started.
:::

## The Making of the Atomic Bomb

::read_source{title="The Making of the Atomic Bomb" author="Richard Rhodes" year="1986" type=book status=reading pages-read=120 pages=340}

No script feeds that card. The bar comes from the two page counts written
on it, and hovering the bar says "120 of 340 pages", which is the number I
actually keep track of while reading.

The chapter on Los Alamos starts at :read_at[p. 449]{href="https://example.com/atomic-bomb.pdf"},
and the link carries the page with it.

## A talk on the halting problem

::read_source{title="Computability and the Limits of Computation" author="Ana Reyes" type=talk status=done}

The `type` attribute above is not one of the recognized values, so the
badge shows the raw text instead of falling back to the "Book" styling.
That is by design: a typo in `type` should not quietly relabel a talk as a
book.

:read_at[8:42]{href="https://example.com/talks/halting-problem"} is where
the speaker walks through Turing's diagonal argument, which is the part I
:read_mark[still need to redo by hand]{kind=todo}.

## A podcast episode

::read_source{data=books.podcast title="Distributed systems, one failure at a time" author="Grace Oduya" type=podcast status=reading progress=65}

At :read_at[1:02:03]{href="https://example.com/ep/12?t=9&x=season2"} the
host makes a claim I want to push back on: that consensus algorithms are
"basically all the same shape." I :read_mark[disagree]{kind=disagree}, or
at least the failure modes are different enough that the shape stops
mattering.

## Unfiled

::read_source{}

An empty citation card, like the one above, still renders as a labeled
placeholder instead of leaving a gap or breaking the page.

```lua {name=books}
-- Static demo data only, no network access, so this note renders the
-- same way everywhere and needs no run grant.
return {
  geb = { progress = 40 },
  podcast = { value = 65 },
}
```
