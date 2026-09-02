# prep

Components for interview preparation notes: a question whose answer stays
hidden until you ask for it, a topic row that tracks how solid you feel,
a block for the mistake you keep making, and a self-test built from the
questions the note already contains.

| Directive           | Form      | Description                                                              |
| ------------------- | --------- | ------------------------------------------------------------------------ |
| `:::prep_q{}`       | container | A question card with the answer behind a collapsed "Answer" region.      |
| `::prep_topic[]{}`  | leaf      | A topic row with a one-to-five confidence rating.                        |
| `:::prep_pitfall{}` | container | A common-mistake block, styled apart from the standard callout.          |
| `::prep_quiz{}`     | leaf      | The note's own questions as one worked-through list, from a bound value. |

## `prep_q`

<img width="975" height="314" alt="image" src="https://github.com/user-attachments/assets/90e74ce1-870d-480d-ba82-a07a2c4a7aa5" />

```markdown
:::prep_q{q="What does a bloom filter get wrong?" level=medium topic="data structures"}
It can report a false positive, never a false negative.
:::
```

Attributes:

- `q` (string, optional): the question. It is shown in the card header,
  and the body becomes a collapsed "Answer" region you open when you want
  to check yourself.
- `level` (string, optional): one of `easy`, `medium`, `hard`. Each gets
  its own tint. Any other value still shows as a tag carrying the text you
  wrote, styled neutral, so a typo never relabels the question.
- `topic` (string, optional): a small neutral tag next to the level.

The body is the answer. With no `q` attribute there is nothing to test
yourself against, so the card drops the reveal and shows the body
directly, tags included. That keeps a half-written card readable instead
of hiding its only content.

## `prep_topic`

<img width="975" height="314" alt="image" src="https://github.com/user-attachments/assets/83ec4e63-da1f-422c-8ff2-d9aba5e84cc9" />

```markdown
::prep_topic[Graph traversal]{confidence=3}
```

Attributes:

- `name` (string, optional): the topic, for when you would rather not use
  bracket content.
- `confidence` (number, optional): 1 to 5, drawn as filled and empty dots.
  A value outside the range is clamped.

The label comes from the bracket content when it is written, and from
`name` otherwise. With neither, the row renders a quiet "Untitled topic"
placeholder. A `confidence` that is not a number omits the dots entirely,
because "not rated yet" and "rated zero" are different things.

## `prep_pitfall`

<img width="975" height="322" alt="image" src="https://github.com/user-attachments/assets/b960ded0-adfc-412e-b67a-16c7241770e3" />

```markdown
:::prep_pitfall{title="Off by one on the window"}
The sliding window is inclusive on both ends, so the length is
`right - left + 1`.
:::
```

Attributes:

- `title` (string, optional): the heading. Defaults to "Common mistake",
  so the block is never left unlabeled.

The body is the mistake, and what to do instead. The styling is
deliberately unlike the standard `callout`: a revision sheet is mostly
callout-shaped already, and a pitfall that borrowed those colors would
disappear into the page.

## `prep_quiz`

The only data-bound component here. It takes a quiz a script produced and
draws it as one numbered list, each answer behind its own "Answer"
region, so a revision sheet ends with something you can actually work
through top to bottom.

```markdown
::prep_quiz{data=quiz}
```

Attributes:

- `data` (required): the bound quiz. The shape is
  `{questions = {{q, topic, level, answer}, ...}}`. Every field is
  optional per question: a question with no `topic` simply shows no topic
  tag, and one with no `answer` shows no reveal.

`level` is read the same way `prep_q` reads it: `easy`, `medium` and
`hard` get their own tint, and anything else shows as written, styled
neutral.

### Building the quiz from the note itself

The point of this component is that you do not type the questions twice.
A script reads the note's own `prep_q` blocks and turns them into the
bound value:

```lua
local questions = {}

for _, card in ipairs(doc.directives{ name = "prep_q" }) do
  if card.attributes.q then
    questions[#questions + 1] = {
      q = card.attributes.q,
      topic = card.attributes.topic,
      level = card.attributes.level,
      answer = card.text,
    }
  end
end

return { questions = questions }
```

`doc.directives` returns the note's directives in document order, each
with the attributes it was written with and its plain inner text with the
markdown stripped. The answer is that text. Cards nested inside another
directive come back too, so a question written inside a section wrapper
is still collected. A card that WRAPS another directive, a `prep_pitfall`
say, contributes that inner text as part of its own answer, because the
text really is inside the card. Move the pitfall out of the card if you
would rather the answer stopped short of it. See `docs/scripting.md` in
the main repository for what else `doc` exposes.

Write the script above the `::prep_quiz{}` line: a script can only read
values produced by scripts that ran before it, and the component reads a
value the run has already stored.

Before the first run there is no bound value at all, so the component
shows a quiet "No questions collected yet" line rather than an error. The
same line appears when the script fails: the reason for the failure
belongs in the host's diagnostics, not in the middle of a revision sheet.
