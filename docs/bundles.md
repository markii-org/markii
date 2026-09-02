# Bundles and vaults

A single `.mk.md` file is the normal form of a note and always will be. This
page covers the two container concepts around it: the bundle, which packages
a note with its files, and the vault, which is the folder where your notes
live.

## Why bundles exist

Two problems turn out to be the same problem: where do a note's images live,
and where does a script too long for the page live? The proven answer, the
one TextBundle, `.epub`, and `.docx` all use, is a folder with a manifest,
optionally zipped. Markii adopts it directly.

```
note.mk.md          plain single file: first-class, never deprecated

note.mkz/      a bundle: the same note plus everything it needs
  manifest.json     format version, permissions, script declarations
  note.mk.md        the document itself, unchanged syntax
  assets/           images and attachments
  scripts/          script files referenced by src=
  .cache/           script outputs and fetched data: disposable
```

The document itself never grows blobs. Images and long scripts live beside
it inside the bundle, links stay relative, and moving the bundle moves
everything, so nothing can dangle. The note and its dependencies become one
object.

## Two forms, one bundle

The directory form is the working form: it diffs in git, greps, and opens
with any tool. The zip form, a single `note.mkz` file, is the
interchange form, one artifact to send someone. An application treats them
identically. Bundles from earlier releases used the longer `.mkbundle`
extension; applications keep recognizing it, but new bundles are `.mkz`.

## Running a bundle

A host that runs scripts treats a bundle the way it treats a plain note,
with two additions the bundle makes possible. Scripts gain a filesystem
capability, `bundle.read`, `bundle.write`, and `bundle.exists`, scoped to
the bundle: reads reach the bundle's own files, and writes reach only
`.cache/`. A script can never write the document or the manifest, whatever
its grants say. A missing file read returns nothing rather than failing, so
the common "read the cache if it is there, otherwise compute it" shape is
just an `if`.

Where the document lives is the conventional `note.mk.md` at the bundle
root unless the manifest names another path in its optional `document`
field. A `src=` script block loads its file from the bundle's `scripts/`
directory the same way.

A note-writer does not need any of this. Bundles serve the case where a
note's data collection is worth caching beside the note and carrying with
it. The reference host for running bundles is the VS Code extension, whose
responsibilities as a host are covered in [integration.md](integration.md).

## The cache is disposable

`.cache/` belongs to the host, never to the author. It holds script outputs
and fetched data, all of it regenerable. Deleting it must never lose
authored content. It is dot-prefixed so file browsers hide it by default.

## When to promote a file to a bundle

Promote for portability: when images, long scripts, or data need to travel
with the note. Never promote just to make values persist between sessions.
Persistence is governed by three invariants that hold for files and bundles
alike:

1. Rendering never executes a script.
2. The host never writes authored files; a note is edited only by its
   author.
3. Caches are disposable; deleting one loses no authored content.

Within those rules, where a host keeps last-run values is host policy. A
good application persists them in its own storage, keyed by note identity,
so a plain `.mk.md` file reopens with its last-known values while the vault
directory stays byte-identical. A bundle's `.cache/` is the portable form of
the same cache, the one that travels inside a zipped bundle, not the only
sanctioned one.

## Vaults

A vault is just a directory of notes: `.mk.md` files and `.mkz` bundles side
by side. Nothing else lives there.

Everything shared is referenced by name, never by path. Component packs are
installed in the application, not the vault, because they are compiled code
that must build into the host. Shared Lua travels the same way, as a pack
that declares no components, so a vault never holds a shared-code folder of
its own. The vault-published value
store is application-side too, so publishing adds no files.

Namespace collisions are handled with flat, boring rules: installing two
packs with the same namespace is rejected at install time, and a vault
library that shadows an installed pack wins, with a visible warning. There
is no transitive resolution and no version ranges, deliberately.

## The manifest

`manifest.json` is the bundle's identity card. It records the spec version
in its required `spec` field, declares the note's scripts, and lists the
permissions the note wants (see [security.md](security.md)). `mark` is the
retired name for that field. A reader still accepts it and treats its value
as the spec version, recording a warning rather than an error, so older
bundles keep opening. When both are present `spec` wins. A writer emits
`spec` and never `mark`. An optional
`document` field names the document's path within the bundle; when it is
absent, the conventional `note.mk.md` at the root applies. Scripts can
never write the manifest: a script that could edit it could grant itself
permissions, so the file is load-bearing and host-owned.
