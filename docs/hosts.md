# Writing a host

This page is for developers building an application that runs Markii
scripts, installs packs, exports notes or offers editor features. A site
that only shows notes needs [integration.md](integration.md) instead.

A host is any application that shows Markii notes. Most of the work is
done in published packages. A host picks the packages it needs and writes
one adapter.

## The host contract

The reference hosts split every responsibility into two halves. The first
half is a small set of primitives that only the host can provide, because
each one is a real call into its own application. The second half is
everything built on top of those primitives. It is identical for every
host: the tier gate, the grant flow and its prompt wording, the watchdog,
pack discovery and installation, export, completion, hover and component
insertion. A host that supplies the first half gets the second half
without writing it.

The host writes a `HostAdapter` and passes it to `createMarkiiHost` from
`@markii/host`. The result is a `MarkiiHost` with these behaviors: `open`,
`run`, `exportNote`, `installPack`, `loadPacks`, `loadTerminalPacks`,
`removePack`, `installedPacks`, `enablePack`, `disablePack`, `completeAt`,
`completeAtSync`, `hoverAt`, `insertComponent`, `invalidateCatalog` and
`diagnostics`.

### The adapter fields

Ten fields are required. Each is a primitive or a piece of wording.

| Field | What it is |
| --- | --- |
| `id` | A short name for the host, used in diagnostics wording. |
| `labels` | The `HostLabels` nouns the shared messages use. |
| `readFile(path)` | Reads a file as bytes. |
| `exists(path)` | Reports whether a path exists. |
| `writeFile(path, bytes)` | Writes a file and creates missing parent folders. Exports and pack installs write through it. |
| `listFolder(path)` | Lists a folder. A missing folder resolves to an empty list. |
| `prompt(request)` | Shows one yes-or-no question and resolves to the answer. Every grant, consent and replace question goes through it. |
| `memento` | Device-local state with `get` and `update`. It has the shape of VS Code's `workspaceState`. |
| `diagnostics(line)` | Writes one line on the host's diagnostics surface. |
| `now()` | Reads the clock in milliseconds. |

Four capability groups are optional. A host that does not offer a group
leaves the field out.

| Field | What it carries |
| --- | --- |
| `isolate` | A `node` isolate (`workerPath()` and `spawnIsolate`) or a `browser` isolate (`spawner()`, `dispose()` and an optional `entryLabel`). Running scripts needs it. |
| `editor` | The live editor: `documentText()`, `documentPath()`, `cursor()` and `applyEdits()`, which applies a whole edit array as one undoable edit. |
| `packs` | The pack source, described in the next table. |
| `exports` | The `formats` the host offers, `resolveTarget()` for the destination, and `htmlToPdf()` for a host that offers `pdf`. |

The `HostLabels` fields are `appNoun`, `previewNoun`, `diagnosticsSurface`
and `deviceNoun`, plus an optional `settingName` for a host that exposes
script execution as one named setting. The `prompt` request carries a
`kind`, the finished `message`, the two button labels and a
`consequential` flag. The `kind` is one of `grant-host`,
`grant-unknown-hosts`, `grant-many-hosts`, `pack-install-consent`,
`pack-replace`, `pack-overwrite-export` and `enable-scripts`. A host
that can only show a surface that cannot wait for an answer denies a
consequential question instead of assuming yes.

The `packs` group has these fields.

| Field | What it carries |
| --- | --- |
| `engine` | The renderer engine the host runs packs for: `react` or `ansi`. |
| `trust` | `'device-list'` or `'none'`. It has no default. |
| `authorizedFolders()` | The folders the host currently authorizes. |
| `reservedNamespaces()` | Namespaces an install may not claim. |
| `installRoot()` | Where an installed pack is unzipped. Without it the host cannot install a pack. |
| `bundledPacks()` | Packs embedded in the host's own build, with no folder on disk. |
| `removeFolder(path)` | Deletes an installed pack folder. Required when `installRoot` is present. |

A host that installs packs a user picks, as a web page does, declares
`trust: 'device-list'`. A host that owns a private install store declares
`'none'`.

### Which primitives a behavior reaches

`createMarkiiHost` calls `readFile` in `open`, in pack discovery and in
terminal pack loading. It calls `listFolder` in pack discovery and in the
trust list. It calls `exists` in pack removal, in trust and in terminal
pack loading. A host that declares neither `packs` nor `exports` and
never calls `open` never has `readFile`, `exists` or `listFolder` called.
`run` and `completeAt` do not reach them: with no `packs` group, completion
answers from the standard component set.

### Declared, not faked

A host that has no live cursor, no pack support or no PDF writer says so
by leaving that capability out. Every behavior that needs it answers with
an `unsupported` result and writes one diagnostics line. An empty list or
a silent no-op would make an absent feature look like a working one that
found nothing. A host that offers fewer capabilities is a supported host.

### Injected, not global

A primitive takes injected values rather than reaching for a global. The
adapter in each reference host is a factory over the application objects
it needs, so the same adapter can be built over test doubles. That is how
one scenario corpus runs against all three hosts.

### How the reference hosts fill the contract

| | VS Code | Obsidian | Command line tool |
| --- | --- | --- | --- |
| Isolate | worker thread, with a heap cap | Web Worker started from an embedded blob | worker thread, with a heap cap |
| Memento | workspace and global state | the vault-external local storage | one `state.json` in the user's config folder |
| Diagnostics | the Markii output channel | the developer console, with a notice for anything the user must act on | standard error |
| Packs | engine `react`, trust `none`, from the `markii.packs` setting and installs | engine `react`, trust `device-list`, installs only | engine `ansi`, trust `none`, its own store |
| Exports | `html` | `html` and `pdf` | `html`, `ansi` and `md-plain` |
| Editor | yes | yes | only through `markii lsp` |

## Choosing entries

The main entry, `@markii/host`, is environment-neutral. It holds
`createMarkiiHost`, the adapter types, the request and outcome types, the
message helpers, bundle snapshots and pack discovery. The entry list in
[the package README](../packages/markii-host/README.md) names the others.
`@markii/host/internal` is for the reference apps and carries no
compatibility promise.

Pick the entry that matches the environment.

- A web page uses `@markii/host/browser`. It provides a module Web Worker
  isolate (`createBrowserHostIsolate`) and a network provider bound to an
  origin allowlist (`createFetchNetProvider`). Vite needs no extra
  configuration: the worker and the Lua WebAssembly file ship beside the
  entry and are found through `import.meta.url`. Vite is the only bundler
  the repository tests, in `e2e/browser-host`.
- Node and an Electron main process use `@markii/host/node`. It provides a
  worker thread isolate with a heap cap and the address-pinning network
  provider. `createNodeHostIsolate()` starts the packaged worker, which
  carries the Lua engine and needs nothing from the host's own
  dependencies. A host that bundles everything into one file bundles
  `@markii/host/node-worker` as a second output and passes its path as
  `workerPath`.
- An Electron renderer uses the browser entry's isolate. It passes
  `workerType: 'classic'` for an embedded classic worker, shipped as
  `@markii/host/browser-worker-classic`. The pinned network provider is
  served from the renderer's Node side, as the Obsidian plugin does.
- A host that exports HTML or PDF imports `createHtmlExportEngine` from
  `@markii/host/html-engine`, which needs `@markii/html`.

The Node entry needs no optional peer.

## A minimal host

A browser host that runs scripts is one adapter and one call.

```ts
import { createMarkiiHost } from '@markii/host';
import {
  createBrowserHostIsolate,
  createFetchNetProvider,
} from '@markii/host/browser';

const host = createMarkiiHost({
  id: 'my-app',
  labels,
  readFile, exists, writeFile, listFolder,
  prompt: (request) => showDialog(request),
  memento,
  diagnostics: (line) => console.info(line),
  now: () => Date.now(),
  isolate: createBrowserHostIsolate({
    netProvider: createFetchNetProvider({ allowedOrigins }),
  }),
});
```

`e2e/browser-host/` in the repository is a complete, tested example of
this shape.

## Network in a browser

A page cannot choose the address a name connects to. The browser provider
has no address pinning and no private-range protection. The user's grant
and the origin allowlist are the boundary.

`createFetchNetProvider` sends a request with `fetch` only when the host is
one the run was granted and its origin is on `allowedOrigins`. An empty
allowlist denies every request. Credentials are never sent.

The provider refuses redirects, because a browser hides the target of a
manual redirect and it cannot be checked against the allowlist. A note
must therefore name the final URL.

The provider's `fetch` option replaces the global `fetch`. It is the place
to add a header for one origin: the replacement receives the URL and the
request options, and returns the response.

```ts
createFetchNetProvider({
  allowedOrigins: ['https://api.example.com'],
  fetch: (url, init) =>
    fetch(url, url.startsWith('https://api.example.com/')
      ? { ...init, headers: { ...init?.headers, authorization: token } }
      : init),
});
```

The script side has one more rule. A note must write each URL as one
complete string literal inside the call, because the grant scan reads
literal URLs and cannot see an address assembled at run time.
[scripting.md](scripting.md) explains the rule for note authors.

## Proving the adapter

`@markii/host/conformance` ships the scenario corpus the reference apps run
against: notes, actions, scripted prompt answers and the exact outcomes
expected. Run it against your adapter in your own test suite. A scenario
your host cannot support reports `unsupported` because the adapter left
that capability out, which is a pass.

The corpus is `conformance/host/`. Like the rest of `conformance/` it is
plain data: a note, an ordered list of actions with scripted answers to any
prompt, and the outcome each action must produce. It records the exact
questions a run asks, in order. Agreeing on what is asked before code runs
matters more than agreeing on anything else.

The runner runs in Node and needs `@markii/html` installed, because the
export scenarios render through it. Pack install writes through the
adapter's own `writeFile` and removes through `packs.removeFolder`, so an
adapter over any store passes the install scenarios without extra wiring.

## Host responsibilities for scripting

The libraries stop at the seam where application policy begins. A host
that enables scripting owns the responsibilities below, in rough order of
importance. The reference hosts meet each one through `createMarkiiHost`.
Conformance is measured against the responsibilities, whichever way a host
meets them.

1. A terminatable isolate. Run scripts in a Web Worker or worker thread
   with an external wall-clock watchdog that terminates it on overrun.
   This is normative, and auto-run is unsound without it; see
   [security.md](security.md). Pick the isolate your runtime supports. An
   Electron renderer has no worker threads, and a worker thread accepts a
   heap cap that a Web Worker does not. A host that lands on a Web Worker
   records the missing cap where its users can find it.

   The worker's bytes can arrive as a sibling file on disk or embedded in
   the host's own bundle and started from a blob URL. The Obsidian plugin
   embeds, so an install channel that copies only the plugin's entry file
   still runs scripts. The requirement is termination, not delivery.

   The Lua runtime's WebAssembly binary has to reach the isolate the same
   way, and it is the larger of the two. A host that embeds the worker and
   leaves the wasm on disk runs scripts only where the install channel
   copied the extra file. Outside Node, the host tells the Lua runtime
   where the binary is by passing `wasmUri` to `@markii/lua`'s `runScript`
   or `createEmptyLuaEngine`. A run without it fails before any engine
   exists, as a labeled `runtime` failure that names `wasmUri`. The runtime
   never fetches the binary from a CDN. In Node, `wasmUri` may be left out,
   and the copy installed with wasmoon is used.

   A host that ships its own executable bundles the worker entry into the
   program's output directory and copies the WebAssembly binary next to it.
   It resolves both relative to the program's own location at run time. The
   command line tool does this, and runs the worker from source only in its
   development and test runs.

2. The grant store and prompts. Persist grants keyed by `computeGrantKey`'s
   executable-closure hash, and prompt again when the key changes. Word
   network prompts as "can send data to `<host>`". Validate stored hosts
   when you read them back, so a record from an older version cannot
   reintroduce a host your current checks would reject.

   Every question a run asks is a yes-or-no question with fixed wording, so
   a host implements one prompt primitive. A host whose surface cannot wait
   for an answer denies instead of assuming consent.

3. A bounded network capability. The `net` implementation is the real
   allowlist boundary, so it enforces the list. It resolves redirects
   itself, checks every hop's host before requesting it, and bounds each
   response to the fetch-size cap instead of buffering a whole body. A
   request whose host is built dynamically cannot be named in advance, so
   it is denied. A prompt offered for that case must not imply the request
   will be allowed.

4. Trigger discipline. Route manual, auto and scheduled runs through the
   runtime's trigger parameter so the tier gate applies. Schedules live in
   the app, never in scripts.

   A host may offer one switch that turns script execution off for the
   user's own machine. The check belongs in the shared body every trigger
   passes through, so a trigger added later cannot miss it. The host reads
   the setting at the moment of the run, so turning the switch on stops a
   view that is already open. The switch decides whether a run happens and
   does not touch stored grants. A blocked run reports on both surfaces: a
   short line for a run the user asked for, and the diagnostics surface for
   a run the host started itself.

5. Value persistence. Keep last-run values in app storage keyed by note
   identity, so plain files reopen with data and the vault directory stays
   untouched. Write a bundle's `.cache/` only for bundles.

   Apply each script's value to the page as it arrives. A progress message
   from the isolate is never the run's result: only the final settlement
   is. A run cut short by the watchdog still delivers the values that
   landed before it.

6. The vault stores. Enforce one writer per published name, and back the
   `@`-prefixed reads with your vault store implementation.

7. The require mappings. Resolve pack modules, and keep the reserved bundle
   segments (`scripts`, `assets`, `.cache`) bundle-local.

8. Bundle handling, if you run bundles. A `.mkz` bundle is
   attacker-deliverable, so treat every part as untrusted. Read its files
   through `@markii/bundle`'s jailed storage, never your own path joins.
   Check a file with `BundleStorage.size` before materializing it, so one
   oversized entry cannot exhaust the host. Expose the bundle to scripts
   only through a `ScriptView` scoped to the declared permissions
   intersected with the granted ones, and keep writes confined to `.cache/`.
   Include the content of `src=` script files in the grant-key closure, so
   editing a bundled script prompts again.

9. A diagnostics surface. A host that loads packs or runs scripts names one
   place where failures are readable in full. It routes every pack that
   failed to load, every deprecated configuration entry and every failed
   run there. The rendered note keeps only a quiet marker. A failure
   recorded internally and reachable from neither is a bug.

   The VS Code extension uses an output channel named Markii. The Obsidian
   plugin uses the developer console, with a notice for anything the user
   must act on. Both expose a command that shows the current state. The
   command line tool uses standard error, which keeps diagnostics out of
   the rendered note even when it is piped into another program. It writes
   a failure line for every failed script always, and the full detail
   behind a verbose flag.

   Write a run's failure lines in one place: the shared body every trigger
   passes through. It reports each failed script and each mismatch between
   a script's declared hosts and its requests. A host that also writes them
   from its own commands prints every failure twice.

   The renderers' `onDiagnostic` callback belongs on this surface too. A
   quiet marker in the page is half of the contract, and the reason has to
   reach the surface as well. Deduplicate before writing, because a preview
   re-renders on every keystroke.

10. Pack loading, if you load packs. Several rules apply.

    A pack with a prebuilt `webview.js` may ship a `webview.css` beside it.
    Load and unload it like a stylesheet you compiled yourself, keyed by the
    pack's namespace, and treat its absence as normal. When a pack has both
    a prebuilt script and component sources on disk, say so on the
    diagnostics surface as an informational line. It is a supported state
    and never warrants a notification.

    A host may ship packs of its own, loaded with no configuration. Register
    them before any pack the user configured. When a user pack claims a
    namespace a shipped pack holds, skip the user pack and say so on the
    diagnostics surface. Shipped packs feed completion and the insert picker
    as well as the renderer. A host that embeds them in its own bundle hands
    them to those behaviors through `HostPackSource.bundledPacks`, or they
    render but are never offered.

    A pack list names folders, never archive files. A host that offers a
    folder list validates a folder before it reports the folder added.
    Discovery runs first, the notice says what was found, and the reasons
    for anything skipped go to the diagnostics surface. A host with no
    folder list, such as an archive-only one, has nothing to do here.

    A `.mkp` archive enters a host through an install step, and installing
    is a consent step, because it decides what code runs. The host validates
    the archive, asks in words that say the pack's code will run, and asks
    again before replacing a namespace already installed. It writes nothing
    until all of those pass. A rejected archive is reported on the
    diagnostics surface and leaves nothing behind. A namespace one of the
    host's own shipped packs holds is refused at install.

    A host that installs packs owns where they live: its own directory, one
    folder per namespace, never a folder the reader chose and never their
    content tree. The folder name is the namespace. A folder whose manifest
    declares a different namespace does not load and is reported. Which
    namespaces load is a per-device decision, recorded with the other
    decisions that authorize execution (item 12). A pack folder that arrives
    by hand or through a sync service does not load until the device says
    so. Installing, removing and enabling take effect at once: reload packs
    and re-render what is open.

    Gate on engines everywhere a pack's components are offered, and gate per
    component. Offer exactly the components that have a source for your
    engine. A pack with components but none for your engine is reported as
    skipped, with the engines it declares named, so nothing reaches a
    completion list or an insert picker that the renderer would answer with
    the unknown-component box.

    A host that loads terminal pack code runs it in its own process, so it
    loads that code only from its own device-local store and its shipped
    packs; see [security.md](security.md). The command line tool keeps that
    store in a `packs` folder beside its state file, one folder per
    namespace. Its install consent adds that the code runs with all of the
    user's permissions. With no terminal to ask in, it refuses unless the
    user passed an explicit flag, and that flag answers the pack questions
    only, never a network grant. A pack that only lacks views for the host's
    engine is informational. A missing or throwing `terminal.js`, or one
    registering another namespace, is a failure line. A host that renders
    with React keeps a pack's `terminal.js` on disk and never evaluates it.

11. Pack compilation, if you compile packs from source. A pack ships
    component sources and no build step of its own, so a host that offers
    source packs compiles them at load time with `esbuild-wasm`. It must use
    the in-process WebAssembly path. The Node path spawns a child process,
    and an Electron renderer ships no `node` binary for it to spawn. Feed
    sources to the compiler through a resolve and load plugin instead of
    letting it read the disk, and cache the output outside the pack's own
    folder so a pack's source directory is never written to.

    The runtime costs about fourteen megabytes, so a host may choose not to
    embed it. A host without it loads prebuilt packs normally and reports a
    source-only pack on its diagnostics surface. The reference hosts split
    here on purpose. VS Code is the authoring host and compiles from source.
    Obsidian is the consuming host, carries no compiler and loads the
    prebuilt form only. A host may also load no packs at all. Every pack
    directive then renders as the unknown-component box, the note stays
    readable, and the host says so where its users will look. The command
    line tool compiles nothing: it loads the prebuilt `terminal.js` of its
    shipped packs and of the packs installed into its own store.

12. Storage that does not travel. Anything that authorizes execution or
    network access is stored per user and per device, never anywhere that
    moves with the content. That covers grants, auto-run, any scheduled
    interval, the list of packs a device loads, and any switch that decides
    whether scripts run at all. VS Code's application-scoped settings and
    global state satisfy this. Obsidian has no equivalent, because plugin
    data lives inside the vault and rides Sync, so the plugin uses
    device-local storage.

    A host with no application around it writes its own file under the
    per-user configuration directory its platform defines, with permissions
    that keep it to that user. Name the file for everything it holds. The
    same store carries each note's last values and its run record, and a
    reader who deletes it to reset permissions should not be surprised by
    what else goes.

    The pack list matters most where the pack folder can arrive by sync. A
    host whose install folder can receive packs it did not install, such as
    Obsidian's vault, keeps a device trust list. An installed folder loads
    only when the list names it. A folder that is present but not named is
    shown as "present, not enabled" and is never read or evaluated.
    Installing a pack trusts it. Enabling a present folder asks the same
    consent as an install, and a folder without a valid `pack.json` is
    refused before the prompt. Removing a pack withdraws its entry. A host
    whose install store only it writes to, as VS Code and the command line
    tool do, trusts that store directly. Getting this wrong hands whoever
    receives a copy of the content an authority they never granted.

13. A module format that can hold the terminal engine, if you bundle it.
    The terminal engine's layout module loads its WebAssembly through a
    top-level await, which a CommonJS output cannot represent. A host that
    bundles the engine emits an ECMAScript module or does not bundle it. The
    layout WebAssembly is embedded in that module, so unlike the Lua
    runtime it needs no sidecar file. Two things surface at bundle time. The
    optional developer-tools peer the layout library imports has to be
    stubbed out, and a bundler that wraps CommonJS dependencies has to be
    given a `require` shim. A host that ships a single executable file
    should expect its output to grow by under two megabytes.

## Editor support

The two GUI hosts carry a shared authoring layer: a rendered preview, an
Insert Component command and directive completion. VS Code adds a grammar
for highlighting and hover documentation. Every other editor gets
completion, hover, diagnostics and fence lengthening from a language
server, described at the end of this section.

`@markii/stdlib/editor` is the whole editor seam, published and installable.
It holds the standard-set component catalog, completion, hover
documentation, the Insert Component skeleton builder and container fence
lengthening. It has no dependencies of its own, so a host that wants the
standard components in its completion list does not pull in pack loading,
a bundler or the script runtime. A host that also loads packs composes the
pack half on top of the standard catalog, the way this repository's hosts
do. A host calls `completionAt` and `hoverAt`, which read the line around
the cursor and return the items and the range to replace. It never
re-derives directive parsing of its own.

### Fence lengthening

Nesting a container inside a container needs the outer fence pair to carry
more colons than the inner one. When a host inserts a container, through
Insert Component or by accepting one from the completion popup, it
lengthens the enclosing fences in the same undoable edit. This happens in
those two places only, never while typing.

The scanner in `@markii/stdlib/editor` acts only on a document whose
fences pair cleanly from the top of the file. It leaves anything ambiguous
alone.

### Completion context offsets

A directive-name completion context reports two offsets that answer
different questions. `replaceStart` is where an accepted item's text
replaces from. On a line whose rest is empty it sits at the start of the
colon run, because accepting an item there rewrites the whole fence.
`tokenStart` is where the name itself begins, after the colon run.

A widget that filters candidates against the text between its own anchor
and the cursor must filter from `tokenStart`. CodeMirror's
`CompletionResult.from` works this way. Filtering from `replaceStart`
compares every label against a leading `:::` and shows an empty popup. Use
`replaceStart` for the edit and `tokenStart` for the filter. A host whose
widget derives one anchor from the other, as VS Code's does, builds its
filter text from the pair.

Completion does not open on a line that closes a container. A bare colon
run can be a fence someone just started typing or the closing half of a
container already open above it, and only the document can tell them
apart. `closesOpenContainerFence` makes that call at the host's trigger
boundary. `completionAt` itself still offers the full catalog for a bare
opener.

The items come from the component catalog (the standard set plus installed
packs), the attribute contracts in `@markii/stdlib`, and the layout preset
lists the same package exports (`WIDTH_PRESETS`, `ALIGN_PRESETS` and
`LAYOUT_ATTRIBUTES`). Both renderers build their layout class maps from
those exports too.

A pack contributes attribute metadata to the same layer. A component that
declares an `attributes` list in its `pack.json` (see [packs.md](packs.md))
is completed by attribute name and by enumerated value. Its hover
documentation lists those attributes. A pack that declares nothing gets
completion by name only.

Obsidian carries completion and the Insert Component command. It has no
hover. VS Code carries completion, hover and Insert Component.

### Images in a preview

A preview resolves the images a note references. VS Code resolves a
relative `src` against the note's folder. Obsidian tries the same
note-relative path first, then the vault's own link resolution, which is
the lookup a wikilink uses, so a bare file name found anywhere in the vault
works. It then tries the path as vault-relative. Neither host resolves
absolute file-system paths or `obsidian://` URLs, because a note that used
them would only render on one machine.

Resolution is not authorization. Each host reads an image through its own
storage layer and never outside it, so a note cannot point the preview at a
file the host would not otherwise open. The export path reuses the same
resolution. The renderer option that carries the resolver is described in
[integration.md](integration.md).

### Obsidian link syntax

Obsidian notes can name a file with `[[Page]]`, `[[Page|Alias]]` or an
embed such as `![[image.png]]`. The parser does not know that syntax. The
plugin converts those into ordinary CommonMark links and images before the
text reaches the parser. Reading view and the Markii Preview pane both do
this, so the same note shows the same picture on either one. A link naming
nothing in the vault keeps its original text. A host that offers more than
one rendering surface for the same note converts its own link syntax at
every one of them.

### The language server and Neovim

`markii lsp`, part of the command line tool, is a language server over
stdio for `.mk.md` documents. It offers completion, with fence lengthening
as additional edits when a container is inserted, hover and pushed
diagnostics. It never runs scripts and never uses the network. It learns
pack components from each installed pack's `pack.json` and loads no pack
code.

The position encoding is negotiated (UTF-8, UTF-16 or UTF-32), with UTF-16
as the default the protocol defines. Diagnostics come from
`validateNote(tree, catalog)` in `@markii/stdlib`, which needs no renderer.
It reports a directive that names nothing, a block component written
inline or the reverse, and an attribute value outside its declared set. A
finding therefore does not depend on which engine draws the note. The
renderers report the kinds that do depend on an engine, such as a
component with no view for it. The server's diagnostics surface is the
client's diagnostics list, and pack-loading failures arrive as log
messages.

Helix, Emacs and other LSP clients start the server with the command
`markii lsp`. Neovim has a thin plugin in `apps/nvim` that registers the
`markii` filetype for `*.mk.md` and starts the server. It holds no Markii
logic of its own. It maps `K` to hover, sets `omnifunc` for completion and
answers `:checkhealth markii`.

The terminal viewer's `r` key re-runs a note's scripts. The engine only
calls the host's `onRerun` callback. The run and its grant flow stay in the
host.

## Exporting a note

A host can hand the reader a file instead of a view. All three reference
hosts do. VS Code writes an HTML file at a path the user picks. Obsidian
writes one beside the note in the vault, or prints it to PDF. The command
line tool writes a file at the path its caller names, as HTML, as the
terminal rendering or as a plain CommonMark downgrade.

The downgrade is the one export that is not a rendering. It rewrites the
author's own source. A container directive loses its fence lines and keeps
its inner markdown. A leaf directive goes away. A text directive becomes
its own text, and script fences are dropped. The output is readable
markdown for a tool that knows nothing about Markii, and it is not what any
component would have shown. A host that offers it says so.

An export is not a screenshot of the preview, but it renders the same
components. A host that has a renderer and a loaded registry, as both GUI
hosts do for their preview, renders the export body with that registry. It
passes the result to `exportNote` as `renderBody`. A host with nothing to
render through omits `renderBody`, and `@markii/html` renders the note
through the `htmlEngine` option. Either way the exported file carries the
shared `doc.css` and loads nothing at runtime, so it opens in any browser,
attaches to an email or goes into an archive unchanged.

The shared export code owns the choice between the two paths, the file
naming and the page-level CSS, so two hosts cannot drift on what an
exported file contains or what it is called. A host that renders through a
surface it does not own, as VS Code does with its webview, bounds the wait
and falls back to the static engine instead of leaving the command
hanging.

Five things follow from how an export is rendered. A host says them
rather than letting a reader discover them.

The last run is baked in. A host passes the same persisted value store the
preview rehydrates from, so a monitoring note exports with the figures it
was showing. Those values are not demoted to stale, because a file has no
re-run to be stale against. A note that has never been run exports with its
ordinary empty states, and the host says so in its confirmation.

Pack components render when the host has them loaded. Their markup comes
from the same merged registry the preview uses. Each loaded pack's
stylesheet is embedded in the exported file after `doc.css`, in the order
the host injects it for the preview. Where the host has no renderer to
reach, the static engine renders instead. A pack directive then exports as
the ordinary unknown-component fallback, a labeled box with the author's
inner content rendered inside it. Neither outcome is a failure, and a host
must not report either as one. The diagnostics surface distinguishes the
two, so a reader who expected a component and got a box can find out why.
The short notice stays the same either way.

Local images travel with the file. A host hands the exporter a reader for
its own storage, and every local image a note references is embedded as a
`data:` URI. Remote `http` and `https` sources stay live URLs, because
embedding them would change what the page fetches. Each host resolves an
image with the same code its preview uses and reads it under its own jail,
so an export cannot reach a file the preview could not show. An image above
two megabytes keeps its original source, and so does one whose extension
the embedder does not recognize or one that could not be read. Each of
those is named on the diagnostics surface, with its size where size is the
reason. None of them is a failure, and none belongs in the notice.

PDF is a host capability, not a format feature. A host that runs inside a
browser engine can print the exported document directly, and Obsidian does
so through Electron. Elsewhere the documented path is to export the HTML
and print it from a browser. A host that offers PDF writes the HTML file
when printing is unavailable. It says which of the two happened on both
surfaces: the short notice, and the diagnostics surface named in the
responsibilities above.

### Exporting a linked set

Both GUI hosts can follow the links out of a note, export every note they
reach, and write the whole set as one zip archive. Obsidian writes the
archive beside the root note in the vault. VS Code asks where to save it,
offering the root note's own name with a `.zip` extension. Each note in the
set is exported the way that host exports a single note, so pack
components, stored values and embedded images behave the same in a set as
they do alone.

The host decides what counts as a link, because only it knows what its own
links mean. Obsidian resolves both wikilinks and markdown links against the
vault. VS Code resolves note-relative markdown links against the folder of
the note that wrote them. It refuses any target outside the note's own
folder and the open workspace folders. Neither host follows a link to
something that is not a markdown note.

Every archive carries an `index.html` that lists the exported notes. A note
named `index` is renamed so it does not collide with that page.

The walk detects cycles and stops at a depth bound and a note-count bound.
It says on the diagnostics surface which bound stopped it. A note that a
link pointed at and the host could not read is named there too, beside the
note that linked to it. When that happens, the notice says some linked
notes were left out and points at the diagnostics surface.

Links between exported notes are rewritten to point at the sibling files,
so the archive is navigable with no vault and no network. A link to a note
outside the set, or to something that is not a note, is left as written. A
wikilink that points into the set becomes a markdown link, because Markii
renders CommonMark, where a wikilink is ordinary text.

The walk, the naming, the rewriting and the archive are host-neutral logic
in `@markii/host`. A host adopts the command by supplying two functions:
one that reads a note and one that resolves a link. This path does not go
through the host object. The reference hosts call it from
`@markii/host/internal`, which carries no compatibility promise. Exporting
a linked set to PDF is not offered.

## Limits to know

A page cannot pin addresses, so a browser host has no protection against
DNS rebinding or against requests that reach private ranges. The origin
allowlist and the user's grant are the boundary. A host that needs more
routes requests through a server of its own that resolves and pins.

A Web Worker takes no heap cap. Lua's own limits and the external
watchdog still apply.

A browser host installs prebuilt `.mkp` archives only. Compiling pack
sources needs `@markii/pack-build`, which runs in Node.

A pack's React views run with the page's privileges. Install consent is the
gate. Where a pack folder can arrive by sync, the device trust list
(`HostPackSource.trust: 'device-list'`) is a second gate. A sandboxed
iframe per pack is not implemented.

Terminal packs run inside the host's own process; see
[security.md](security.md).
