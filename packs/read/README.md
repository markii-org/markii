# read

Components for reading notes: citing a source, quoting a passage,
annotating a term, linking to a timestamp, and highlighting a line. None of
them require a `data=` binding except `read_source`, whose progress bar can
optionally follow one.

| Directive         | Form      | Description                                                        |
| ----------------- | --------- | ------------------------------------------------------------------ |
| `::read_source{}` | leaf      | A citation card: type badge, title, author/year, status, progress. |
| `:::read_quote{}` | container | A cited passage with a right-aligned citation line.                |
| `:read_term[]{}`  | inline    | A term with an optional tooltip and focus-reachable definition.    |
| `:read_at[]{}`    | inline    | A monospace timestamp chip, optionally linked.                     |
| `:read_mark[]{}`  | inline    | A highlighter-style marker, tinted by kind.                        |

## `read_source`

<img width="981" height="293" alt="image" src="https://github.com/user-attachments/assets/7dd157ba-837e-4013-8314-684b113dfa50" />

```markdown
::read_source{title="Gödel, Escher, Bach" author="Douglas Hofstadter" year="1979" type=book status=reading progress=40}
```

Attributes:

- `title` (string, optional): the source's title. With no usable title the
  card still renders, labeled "Untitled source", rather than vanishing.
- `author` (string, optional): shown in the byline.
- `year` (string, optional): shown in the byline, next to `author`.
- `url` (string, optional): when it is a safe `http:`/`https:` URL, the
  title becomes a link.
- `type` (string, optional): one of `book`, `article`, `paper`, `podcast`,
  `video`, `course`. Defaults to `book`. An unrecognized value still shows
  as a badge carrying that text (trimmed, capped at 24 characters), styled
  neutral rather than forced into the default look.
- `status` (string, optional): one of `queued`, `reading`, `done`.
  Anything else is omitted entirely rather than shown as "unknown".
- `progress` (number, optional): 0 to 100, clamped into range.
- `pages-read` (number, optional): pages read so far.
- `pages` (number, optional): the total page count.

The byline reads "Author, 2019" when both are present, "Author" or "2019"
alone when only one is, and is omitted entirely when neither is set. The
progress bar only appears when a progress value is available from one of
the three sources below.

### How far along a source is

There are three ways to say it, and they are tried in this order:

1. a written `progress`,
2. the `pages-read` and `pages` pair,
3. a `data=` binding.

The pair is usually what a reader has to hand, so writing both turns into
a percentage: `pages-read / pages`, rounded, clamped to 0 through 100. The
progress bar then carries a tooltip reading "120 of 340 pages", so the
count that produced the bar stays readable without cluttering the card.

```markdown
::read_source{title="The Making of the Atomic Bomb" pages-read=120 pages=340}
```

Both counts must be whole numbers, and `pages` must be greater than zero.
A fraction, a negative, a word, or a `pages` of zero is ignored, and the
binding takes over as if the pair had not been written. Nothing errors.

Bound data (`data=`): a finite number, or an object with a finite
`.progress` or `.value` field.

```json
{ "progress": 40 }
```

## `read_quote`

<img width="975" height="370" alt="image" src="https://github.com/user-attachments/assets/c10bee87-d89a-44e6-b6b3-2e206aadcf39" />

```markdown
:::read_quote{source="Gödel, Escher, Bach" page="152" note="Worth rereading."}
A strange loop arises when, by moving only upwards or downwards through the
levels of a hierarchical system, we unexpectedly find ourselves right back
where we started.
:::
```

Attributes:

- `source` (string, optional): a short citation, such as a title or author.
- `page` (string, optional): rendered as "p. 152".
- `loc` (string, optional): rendered as "loc. 240", for an ebook location.
- `at` (string, optional): a timestamp such as `12:34`, rendered as given,
  for a podcast or video source.
- `note` (string, optional): a short commentary line shown under the
  citation.

The container's markdown content is the quoted passage. The citation line
is built from whichever of `source`, `page`, `loc`, and `at` are set, in
that order, and is omitted entirely when none are. Each attribute is capped
at a few hundred characters.

## `read_term`

<img width="970" height="202" alt="image" src="https://github.com/user-attachments/assets/5684ea14-e7c7-4ea8-bbee-c5cb332dbc4b" />

```markdown
:read_term[monad]{def="A type with a way to wrap a value and a way to chain operations that return wrapped values."}
```

Attributes:

- `def` (string, optional): the definition. With a `def`, the term gets a
  dotted underline, a native tooltip, and a keyboard-reachable definition
  panel revealed on focus. With no `def`, only the underline shows: there
  is nothing focusable that would say nothing.

The directive's text is the term itself.

## `read_at`

<img width="970" height="202" alt="image" src="https://github.com/user-attachments/assets/6c3a14fb-660c-435f-853b-f29d228bc1ee" />

```markdown
:read_at[12:34]{href="https://example.com/watch?v=abc123"}

:read_at[p. 42]{href="https://example.com/paper.pdf"}
```

Attributes:

- `href` (string, optional): a link target. When it parses as a safe
  `http:`/`https:` URL, the chip becomes a link, and the position the text
  names is added to that URL. Anything else renders a plain, unlinked
  chip.

The directive's text is read two ways, and the chip always displays it
exactly as written either way.

A timestamp is `mm:ss`, `m:ss`, or `hh:mm:ss`. It is appended to a safe
`href` as `t=<seconds>` in the query string, replacing any existing `t`
and preserving the rest.

A page reference is `p. 42`, `p.42`, `page 42`, or a bare `42`. It sets
the URL fragment to `#page=42`, the convention a PDF viewer reads,
replacing any fragment the `href` already carried. The two readings never
collide: a timestamp always has a colon in it, a page reference never
does.

Text that is neither still displays, and still links if the `href` is
safe, just with nothing appended.

## `read_mark`

<img width="970" height="202" alt="image" src="https://github.com/user-attachments/assets/22c16133-2656-4a5f-a518-317b7e3c8375" />

```markdown
Turing's paper reframes the Entscheidungsproblem as a question about
:read_mark[machines, not proofs]{kind=insight}.
```

Attributes:

- `kind` (string, optional): one of `insight`, `question`, `disagree`,
  `todo`. Each maps to a theme hue tinting the highlight. A missing or
  unrecognized value falls back to a neutral tint.

The directive's text is the highlighted span.
