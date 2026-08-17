# Mark documentation

Mark is a markdown format that renders your own components inline. These
pages are the full documentation; the repository README is only the front
door.

Start with the page that matches what you're doing:

- [format.md](format.md) — the document format: directives, components,
  layout, and how everything degrades gracefully. Start here.
- [scripting.md](scripting.md) — live data in documents: script blocks,
  values, publishing, and shared code.
- [bundles.md](bundles.md) — the `.mkbundle` container and vaults.
- [security.md](security.md) — the capability model and the sandbox's
  verification status.
- [integration.md](integration.md) — embedding the libraries, writing your
  own renderer, and what a host application owns.
- [packs.md](packs.md) — sharing components and Lua modules (designed, not
  yet implemented).
- [spec.md](spec.md) — the normative core: the rules an implementation must
  follow, and what conformance means.

The conformance corpus in [`../conformance/`](../conformance/) is part of
the format's definition; spec.md explains its role.
