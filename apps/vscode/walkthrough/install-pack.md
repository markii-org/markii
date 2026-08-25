A component pack adds its own prefixed components (for example `:::ana-timeline`) and shared Lua a note can reach with `require "ana/..."`.

Run **Markii: Add Pack Folder…** and pick a folder you trust as an installed pack. It is appended to the `markii.packs` setting, which is user-scope only for the same reason covered in the previous step: a note's own content can never add, remove, or influence which packs load.

A note that uses a pack you have not installed still renders: the unknown component shows a labeled fallback instead of an error.
