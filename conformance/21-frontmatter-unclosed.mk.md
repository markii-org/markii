---

uses: [ana]

An opening `---` with no closing fence is not frontmatter. It degrades to
ordinary markdown — a thematic break followed by paragraphs — never to an
error, and no `yaml` node appears in the tree.
