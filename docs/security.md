# Security model

Reading a Markii document is always safe. Only running its scripts requires
trust, and that trust is granted in small, specific pieces rather than one
big dialog. This page describes the model and the current verification
status of the reference sandbox.

## No "trust this note?" dialog

A blanket trust prompt is the Word-macro model, and its history is the
history of macro malware: users click OK. Markii inverts it. Scripts are
sandboxed by default, capabilities are granted individually, and a prompt
only ever asks about one specific thing, such as network access to one
specific host. An untrusted note opened from anywhere starts with zero
grants and still renders fully, because scripts only feed values: the page
degrades to empty and stale component states, never to a broken document.

Opening a note runs no code, but it is not the same as making no network
requests at all. A note may reference remote images by URL, and rendering
one fetches it, exactly as opening any markdown or HTML document that links
an image does. This is the ordinary web-content posture, the same one the
host editor's built-in markdown preview takes; it is worth stating plainly
because "opening is safe" is true of execution, not of every byte that
leaves the machine.

## Capabilities

A bundle's manifest declares what its scripts want:

```json
"permissions": {
  "net":    ["api.github.com"],
  "bundle": ["read", "write:.cache/"]
}
```

The host asks the user to grant each capability and injects the granted ones
into the sandbox as functions. Nothing is ambient: Lua in the sandbox has no
network, no filesystem, and no clock beyond what the host hands it.

Network grants are per-host, and the honest prompt wording matters: the
prompt must say the note "can send data to api.github.com", not that it
"wants network access". Even a read-only GET request carries data outward
through its URL, so the per-host allowlist is the real boundary, and the
wording should say so.

Grants are remembered per note, keyed by a hash of the note's full
executable closure: its inline scripts, `src=` script files, required
bundle-local modules, and the versions of any pack modules it requires. If any of that code changes, the grant is stale and the
host prompts again. Without this rule, edited shared code would silently
inherit grants that were made to different code. The reference
implementation of the key is `computeGrantKey` in `@markii/runtime`.

A grant is scoped to a hostname, and only to a hostname. Granting
`api.github.com` authorizes every port, path, query string, and scheme on
that host, including a redirect from one path to another, for the life of
the grant. A host implementation follows redirects manually and re-checks
each hop against the same allowlist, so a redirect cannot cross to a host
the user did not grant; but a redirect that stays on the granted host is
allowed, wherever on that host it points. Two consequences follow. First,
because the boundary is the hostname string, a script that builds a request
URL at run time rather than writing it as a literal cannot be reasoned about
in advance: the host cannot know which hostname it will name, so such a
request is denied unless its host was granted through some other literal in
the same note. The consent gate that covers unlistable addresses is shown
only when the scan resolved at least one hostname, which is the only case
where the answer can change the outcome. A note whose `net` calls all build
their URLs at run time resolves no hostname, so nothing is grantable and no
gate appears. The denial still reaches the user at execution time, naming
the host actually attempted, through the component's quiet failure marker
and the host's diagnostics surface.

Second, a hostname is not an address, so the name the user
granted and the machine the request reaches are two different things. A
public name can answer with a private address, and a record can change
between the check and the connection, which is DNS rebinding. A hostname
check alone sees neither.

The reference host closes that gap by resolving and pinning.
Every hop of a request resolves its host once, vets every address the
resolver returned, and then connects to the vetted address itself, so the
gap between resolving and connecting is closed by construction rather than
by re-checking after the fact. The certificate check and the `Host` header
still use the real hostname, so pinning weakens nothing about who the
server proves itself to be. Addresses are judged by where they live rather
than by a list of three private blocks: loopback, private, link-local,
carrier-grade NAT, multicast, and the reserved and documentation ranges are
all restricted, as are the addresses that hide inside an IPv6 wrapper, such
as an IPv4-mapped or 6to4 address carrying a private one. That last part
matters because those wrappers are the usual way an incomplete filter is
walked around, along with the cloud metadata address at 169.254.169.254.

A grant that names a literal address, or `localhost`, is honored at
whatever scope it names. Nothing was resolved, so nothing could surprise
the person who typed it, and pointing a note at a local development server
stays possible. A grant that names a host may only be reached at a public
address, and a name whose answer mixes public and restricted addresses is
refused outright rather than filtered down to the public one, because
filtering is exactly what a rebinding attacker wants. A deployment whose
internal DNS legitimately points names at private space opts in with the
`markii.allowPrivateNetworkAddresses` setting, which is user-scope only so
a workspace cannot widen network reach for whoever opens it.

One property of hostname grants is unchanged and still worth stating: a
grant covers every port and path on the host it names.

### The note view (`doc`)

A script can read the note it runs in: `doc.directives()` for the note's
directives as plain data, and `doc.value(name)` for a value a script above
it already produced.

What this exposes is the note's own content and the values the same run
already computed. It reaches no host, no clock, no file, and no network,
and it has no write side. Because it grants no authority, it is not tier
gated: an auto or scheduled run gets the same view a manual run gets, and
no grant prompt is involved.

The listing is built once per run, from the tree the run already parsed,
before anything enters the interpreter. Nothing inside the sandbox parses
anything. It crosses in as JSON text and is rebuilt into ordinary tables by
the same in-Lua decoder a fetched response uses, so a script never receives
a live handle to a host object.

Caps. The listing is bounded before it is handed over: 512 KiB in total,
2,000 directives, 8 KiB of text and 32 attributes per directive, 1 KiB per
attribute value, 128 bytes per attribute name, and 200 levels of tree
depth. Exceeding any of them shortens the listing and sets
`doc.truncated`; it never raises. A value read through `doc.value` is
checked against the same depth and node budget the marshaling layer
already applies to a script's own return value.

Sanitizing. Text and attribute values arrive with C0 control characters
(other than tab and newline), DEL, and unpaired surrogates removed. The NUL
byte matters most: the interpreter's string bridge truncates at the first
NUL, so one pasted into a note would otherwise cut off the rest of the
listing silently.

Classification. Reading a script that runs later fails the run as a script
error. It is deliberately not a capability denial: nothing was denied, and
telling a user their note needs a permission it does not need is worse than
saying nothing. The message is recorded host-side, out of band, the same
way genuine capability denials are, so the user sees the sentence rather
than an interpreter traceback, and a script raising the same text cannot
forge the classification.

Verification status. An executed probe suite runs against the real
interpreter (`packages/markii-lua/src/doc.probe.test.ts`) and against a
real worker isolate (`packages/markii-host/src/run/doc-run.probe.test.ts`).
It shows that a NUL byte, an unpaired surrogate, a megabyte of text, a
thousand levels of nesting, an attribute named `__proto__`, and attribute
values shaped like Lua source all arrive as bounded ordinary strings or do
not arrive at all; that every cap is enforced where documented and being
over one is reported rather than raised; that writing to the table or to an
entry it returned changes nothing for the next call or the next script;
that rebinding the JSON decoder, `type`, or `error` before a call cannot
change what it returns; that the raw host handles are nil by the time a
script runs and the wiring leaves no private name in the globals table;
that a later-script read fails as specified and cannot be forged; and that
the table exposes exactly `directives`, `value`, and `truncated`, each
entry exposing exactly `name`, `form`, `attributes`, and `text`.

## Triggers cap capabilities

How a run was triggered limits what it may do, independent of what was
granted:

| Trigger | Tier |
|---|---|
| Manual run | full: every granted capability, including effectful operations |
| Auto-run on open | read-only: GET, bundle and cache reads, cache writes |
| Scheduled | read-only |

The read-only tier is enforced structurally, not on the honor system: the
read-only network function exposes no method or body at all, so there is
nothing to escalate. An effectful call under an auto trigger fails cleanly
and the consuming component shows a "requires manual run" hint.

A second rule governs auto-run and scheduled runs, because they carry no
click: they never prompt, and they never widen network access. Where a
manual run may open a grant prompt and remember the answer, an auto or
scheduled run resolves its allowlist only from a grant the user already made
by hand, for that exact executable closure. A host the user has not already
granted is simply unreachable on a timer or on open; the call fails as an
ordinary capability denial and the note keeps showing its last-known values,
marked stale. So a schedule can refresh the data a user already consented to,
but it can never reach somewhere new, and no dialog ever appears without a
user gesture behind it. The reference VS Code extension implements this split
in `runOnce`: a manual trigger runs the interactive grant flow, while auto
and scheduled triggers call `resolveStoredGrant`, which reads the stored
grant and prompts nothing.

## The sandbox

Scripts run in Lua 5.4 (wasmoon, WebAssembly) with an empty environment.
The dangerous standard libraries (`os`, `io`, `package`, `debug`,
`coroutine`) are never linked into the interpreter at all, which is stronger
than loading and deleting them; only a curated slice of `string`, `table`,
and `math` is available, with the remaining unsafe entry points (`load`,
`getmetatable`, `setmetatable`, `string.dump`, and the rest) removed by a
scrub pass. Each run gets a fresh environment; that costs microseconds, so
sandbox-per-note is cheap.

Resource limits bound every run: an instruction-count hook, a wall-clock
timeout, a memory cap, and a fetch response size cap. Limit breaches and
capability denials are recorded on the host side, outside the sandbox, so a
script cannot forge or suppress how its failure is classified.

## The isolate requirement

In-process limits are best-effort; the terminatable isolate is the real
guarantee. A WebAssembly interpreter cannot always be interrupted from
inside its own realm: an adversarial script can reach a state the
instruction hook can no longer unwind, synchronously blocking the thread it
runs on. The runtime contract is therefore normative:

**A host must run note scripts in a dedicated, terminatable isolate (a Web
Worker or worker thread) with an external wall-clock watchdog that
terminates the isolate when a run overruns.**

Which KIND of isolate a host can use is decided by the host's runtime, and
the two are not equivalent in what they can bound. A worker thread accepts
a V8 heap cap, so the reference VS Code extension limits each run's worker
to 128 MB and a runaway allocation dies inside that ceiling. A Web Worker
accepts no such cap. Where a host has only Web Workers available, as an
Electron renderer does, script memory is still bounded inside the
interpreter by the sandbox's own Lua memory limit, and a wedged run is
still killed by the watchdog, but a large allocation on the JavaScript side
of the isolate is bounded only by the browser engine. The realistic
consequence is worse than a failed run: exhausting a Web Worker's heap can
take down the renderer that hosts it, which for an editor means the
application exits rather than the run reporting an error. A host in that
position should say so, and should not present its memory ceiling as
equivalent to a worker thread's.

Where the isolate is a Web Worker, the pinned request cannot run inside it
either: pinning needs a DNS resolver and a socket the caller chooses the
address for, and a Web Worker has neither. The reference Obsidian plugin
therefore performs the request in its host, using the same pinning code the
worker-thread host runs, and the isolate asks for it over a message. The
protection is unchanged, and the boundary gets stronger rather than weaker:
an isolate with no network stack has nothing to bypass the allowlist with.
A refusal made in the host is marked as a policy denial on the wire, so it
still reaches the script as a capability error rather than as an ordinary
failure.

The worker's bytes reach the isolate differently in the Obsidian plugin
than in the worker-thread hosts. The plugin embeds the worker bundle and
the Lua interpreter's wasm binary in its own entry file as base64 and
decodes them at spawn time, rather than reading them from sibling files on
disk. The isolate boundary is the same either way: the same bundle runs, in
the same kind of worker, under the same watchdog. What differs is
provenance. A partially copied install cannot leave the Run path loading a
stale or missing worker file, and the build fails outright if the embedding
step did not run, so an entry file with empty worker bytes cannot ship.
Verification: the worker-bundle probe builds the real bundle from the real
build options, decodes it through the same base64 path the plugin uses, and
executes it.

One Electron-specific finding qualifies the Web Worker picture further.
Obsidian creates its workers with Node integration enabled, so `process`,
`require`, and `Buffer` exist inside the isolate's global scope. This had
two consequences. The first was functional: the Lua runtime's environment
detection saw `process` and took a Node code path a blob worker cannot
complete, so every run failed; the worker bundle now shadows those
globals at its top, which restores the browser path and keeps the
bundle's own code off Node APIs. The second is a boundary statement that
must be made honestly: that shadowing is scoping, not a privilege
boundary. Sandboxed Lua still cannot reach JavaScript at all, and that
remains the enforced line. But a hypothetical interpreter escape inside
this particular isolate would find real Node capabilities in reach,
where the same escape inside a plain browser worker would not. The
watchdog, the allowlist, and the host-side pinned request are unaffected;
the difference is only in what an escaped script's JavaScript could
touch, and a host with node-integrated workers should know it sits in
that position.

Auto-run and scheduled execution are only sound on top of that watchdog,
because they carry no user gesture: an auto-run note that hangs would freeze
the host on open. Manual runs share the requirement but at least fail behind
a deliberate click. No isolate ships in this repository; it is the
embedding application's code, and the host checklist in
[integration.md](integration.md) lists it first.

## The bundle jail

A script's entire filesystem is its own bundle. `bundle.read` and
`bundle.write` accept no absolute paths, no `..`, and no symlink following;
the host resolves everything inside the bundle root and rejects escapes.
Writes are limited to `.cache/` by default. A script can never write the
document (no self-modifying notes) and never `manifest.json`, since a script
that could edit the manifest could grant itself permissions. A script never
sees any other note's bundle; sharing data between notes goes through the
published-value store instead (see [scripting.md](scripting.md)).

A bundle is attacker-deliverable in a way a note opened in an editor is
not: someone can hand you a whole `.mkz`, and its manifest, document,
scripts, assets, cached data, and archive structure are all untrusted. Two
consequences follow for a host. First, opening or running a bundle must
bound what it reads: a file is size-checked before it is materialized, and
the zip archive itself is size-checked before it is read from disk, so a
single huge entry, a zip bomb, a directory bundle carrying a giant file, or
a multi-gigabyte archive cannot exhaust the host by being opened. Second, a bundle's cached data is
not trusted for freshness: a stored entry with an implausible timestamp is
recomputed rather than served, so a shipped `.cache/` cannot pin stale
values. The reference host's assessment of these paths is recorded in the
verification status below.

A `.mkp` pack archive is read through the same zip reader and the same path
jail, so it inherits both guarantees rather than restating them. Its entry
and total sizes are capped before anything is decompressed, and an entry
naming a parent directory or an absolute path is refused rather than
written. A pack archive is also prebuilt-only: nothing inside one is ever
compiled, so an archive cannot introduce source that a host would build.

## Sandboxed require

`require` resolves exactly two sources today: bundle-local modules
(`require "scripts/..."`, `"assets/..."`, `".cache/..."`), whose source text
is read through the identical `ScriptView` and path-jail that `bundle.read`
uses, and pack-namespaced modules (`require "packName/..."`), gated behind an
optional host-injected resolver. A host that has not wired one up denies
every pack-namespaced `require` cleanly rather than reaching any real pack
loader.

A resolved module runs as a protected chunk on the same Lua thread as the rest
of the run, sharing its globals, capabilities, and instruction, wall-clock, and
memory budget. A module cannot grant itself more than the script that required
it already had, and a runaway module is still killed by the shared limit. Only
pure Lua source text is ever compiled: the genuine `load` primitive is captured
privately before the public name is scrubbed, is reachable from nowhere except
`require`'s own prelude, and is always invoked in text-only mode, which refuses
anything carrying Lua's bytecode signature; `require` also rejects that
signature on the host side before the text reaches Lua. Resolution is cached
once per run, and a cycle (module `A` requiring `B` requiring `A`) is detected
and rejected immediately rather than left to hang.

Reading is the only operation `require` performs, so it is read-only under
every trigger tier with no extra gate. One coupling is worth a maintainer's
attention: the scrub leaves the captured `load` primitive in a private global
until `require`'s prelude nils it, so a host that assembles a run without that
prelude would leave the primitive reachable. The sanctioned entry point
(`runScript`) always runs the prelude; the require-jail audit slice should
confirm no other path can skip it.

## Promise ledger

The rules above are written as prose. This table collects the security
promises in one place, each with a stable identifier, so an audit or a review
can grade code against one specific claim rather than against a paragraph. An
identifier is stable across rewordings; a row is removed only when the
guarantee it names is. The verification status below reports how these were
tested, and the skills in `skills/` grade against this table.

| ID | Promise | Where it holds |
| --- | --- | --- |
| `open-is-pure` | Rendering a document runs no script; every value read is a pure lookup of last-known state. | [The sandbox](#the-sandbox); `@markii/react` render |
| `open-fetches-images` | A pure open performs no network beyond fetching a remote image the document references, the same posture any markdown preview takes. | [No "trust this note?" dialog](#no-trust-this-note-dialog) |
| `no-ambient` | A script has no network, no filesystem, and no clock beyond what the host injects as a granted capability. | [Capabilities](#capabilities); `@markii/lua` empty environment |
| `net-per-host` | A network grant is scoped to a hostname, and the prompt states the note can send data to that host. | [Capabilities](#capabilities) |
| `grant-keyed-to-code` | A grant is keyed to a hash of the note's full executable closure and is re-prompted when any of that code changes. | [Capabilities](#capabilities); `computeGrantKey` in `@markii/runtime` |
| `redirect-rechecked` | Every redirect hop's host is re-checked against the allowlist before it is contacted, so a redirect cannot reach an ungranted host. | [Capabilities](#capabilities); the host `net` provider |
| `tier-caps` | An auto-run or scheduled run is read-only, and the read-only tier exposes no effectful method to escalate. | [Triggers cap capabilities](#triggers-cap-capabilities) |
| `non-forgeable-class` | A limit breach or a capability denial is recorded outside the sandbox, so a script cannot forge or suppress how its own failure is classified. | [The sandbox](#the-sandbox); `CapabilityDenials` and the limit flags |
| `isolate-required` | A host must run scripts in a dedicated terminatable isolate with an external wall-clock watchdog; auto-run and scheduled execution are unsound without it. | [The isolate requirement](#the-isolate-requirement); host code |
| `address-vetted` | A request's host is resolved once and every returned address vetted before connecting, and the connection is pinned to the vetted address, so a name cannot be reached at a private or loopback address or rebound between check and connect. | [Capabilities](#capabilities); `pinHostAddress` and `pinnedLookup` in the extension's run path |
| `bundle-jail` | `bundle.read` and `bundle.write` reject absolute paths, `..`, and symlink escapes, so a script never reaches outside its own bundle. | [The bundle jail](#the-bundle-jail); the `@markii/bundle` path jail |
| `writes-to-cache` | A script's writes are confined to `.cache/`; it can never write the document or the manifest. | [The bundle jail](#the-bundle-jail); the write jail |
| `bounded-open` | A file is size-checked before it is materialized and a zip archive before it is read, so opening or running a bundle, or reading a `.mkp` pack archive, cannot exhaust the host. | [The bundle jail](#the-bundle-jail) |
| `cache-not-trusted` | A cached entry with an implausible timestamp is recomputed rather than served, so a shipped `.cache/` cannot pin stale values. | [The bundle jail](#the-bundle-jail) |
| `unattended-is-user-scoped` | A setting that can make scripts run without a user gesture is user-scope only, so a workspace cannot enable unattended execution for whoever opens it. | [Triggers cap capabilities](#triggers-cap-capabilities); the extension's `contributes.configuration` scopes |
| `values-are-data` | A script value reaches the page as data only; its text never becomes markup, and a failure carries only its kind, never its text. | [Capabilities](#capabilities); the failure-presentation seam in `@markii/react` |

## Verification status of the reference sandbox

The `@markii/lua` sandbox was audited adversarially in August 2026 (commit
`f7d54e8`), with every claim backed by a probe that can be re-run against
the code. The audit's approach was deliberate about its own trust model:
claims were graded by whether an attack was actually executed against the
real interpreter, and a "found nothing" verdict is bounded by the attacks
tried, which were listed so the gaps stay visible.

The core held. The empty-environment strategy, the layered limits with
host-side non-forgeable breach flags, the two-gate value marshaller (an
in-sandbox walk under the instruction hook, backstopped by a host-side
finalizer), and the capability tier gating all withstood the probe set,
which included metatable forgery, denial-message spoofing, function
smuggling, cycle attacks, and deep-recursion and large-allocation attacks.

Two findings came out of the audit, neither exploitable for escape, leak, or
hang, and both were fixed in commit `272f1b6`:

1. The marshaller's fast-rejection caps could be bypassed by rebinding the
   Lua globals the walk used, degrading a rejection from ~20k instructions
   to the full memory-cap budget. The primitives are now captured into
   locals at prelude definition time, immune to rebinding, and the run path
   gained an unconditional catch so the never-throws guarantee no longer
   depends on downstream behavior.
2. Strings containing NUL bytes were silently truncated by the interpreter's
   string marshaling. They are now rejected at the marshal boundary with an
   explicit reason instead of losing data silently.

Both fixes were verified by independent re-runs of the original probes.

A third finding was reported through real-world script writing rather than
the audit (August 2026, issue #6). The `net` capability returned fetch
results to Lua as the engine's own proxy objects instead of plain tables,
and `cache.get` did the same for a stored value on a cache hit. Proxies
leaked engine semantics into scripts: `type()` misreported them, returning
a nested piece of a result was rejected by the marshaller, and reading a
field whose JSON value was `null` raised an error instead of giving `nil`.
The fix removes proxies from the script-facing surface entirely. Fetch
responses and cache hits are decoded inside the sandbox by a trusted JSON
decoder that builds genuine Lua tables, with the depth and node caps
enforced on the host side before decoding and reported as an ordinary
capability denial. The same change bounded the cache write path: a value
being stored now passes through the same capped, cycle-safe walk a
script's own return value gets, so an oversized or cyclic value fails
cleanly instead of reaching storage. A stored entry that fails those
checks on a later read, which can only mean host-side corruption, is
treated as a cache miss and recomputed rather than blocking the script. The security posture is unchanged:
nothing non-serializable crosses into the sandbox through these paths, and
the capability tier gating is untouched.

The decoder change was itself verified adversarially before merge, with
executed probes rather than review alone. That pass confirmed the decoder
introduces no escape and handles malformed input, hostile keys, and large
or deeply nested documents cleanly, and it surfaced four gaps that were
fixed before the change shipped: remote JSON could spoof the marshaller's
internal array marker and change a value's type on the host side; the
cache-hit path skipped the depth and node caps the fetch path enforces; a
script could disable the cache write bound by rebinding a global the
prelude read at call time; and the decoder resolved its own Lua primitives
dynamically, repeating the pattern the earlier audit's first finding had
already fixed in the marshaller. All four fixes carry regression tests
that re-run the original probes.

The first host to run scripts, the VS Code extension, brought the isolate
requirement and the capability providers out of the library and into a real
application, and that surface was assessed twice: an adversarial pass before
merge and an independent red-team engagement afterward (August 2026). Both
worked against the real pipeline: a real worker thread, the real Lua
sandbox, and real network endpoints. Neither found a sandbox escape, a
request past a granted hostname, a script-value path into the page as
markup, or a way for a note to run code on open. The external watchdog
terminated every runaway shape put to it, including the historical
`pcall`-loop deadlock, an allocation flood, and a request to an endpoint
that never answers.

The engagement's findings were fixes to the layers around that core, all
now landed with regression tests: a network redirect is resolved hop by hop
and each hop's host is re-checked before it is contacted, so a redirect
cannot reach a host the user did not grant; a response body is bounded to
the fetch-size cap as it streams rather than buffered whole, and the worker
runs under a capped heap, so neither a flood nor a decompression bomb can
exhaust the host; a cache entry with an implausible timestamp is treated as
a miss rather than served as permanently fresh; a network denial the host's
provider raises is recorded out of band and classified from that record, not
from any string that crosses into the script, so a script cannot read a
classification signal and cannot relabel its own failure; stored grants are
re-validated when read; a
note that names many hosts folds into one consolidated prompt rather than a
storm of them; and the values sent to the page carry only a failure's kind,
never its text. Two limits of hostname-based grants are documented above
rather than closed in code: such a grant covers every port and path on the
host, and it cannot detect a DNS record that changes after the grant.

Bringing `.mkz` bundles into that same run path was assessed adversarially
in turn, against real hostile bundles: crafted zips, on-disk symlink
escapes, and real worker runs. The path jail, the write jail confining
writes to `.cache/`, the zip-bomb guard that refuses on declared size
before inflating, the symlink and hard-link defenses, the declared-intersect-granted
capability model, and the fail-safe decoding of a hostile manifest or
cached data all held. Two weakenings specific to a deliverable bundle were
found and fixed before release: the directory-form snapshot builder read a
file before checking its size, which a size check ahead of the read now
closes; and the grant key omitted the content of `src=` script files, so a
swapped bundle script could run under an old grant, which folding that
content into the key now prevents. An independent re-attack afterward
confirmed both fixes held and found one further host-exhaustion path: the
zip form was read from disk whole before any per-entry cap applied, since
those caps operate on an already-opened archive. The archive's on-disk size
is now checked before it is read, so an oversized `.mkz` is refused at open.
The same re-attack found that the earlier network-denial fix still let a
script read its classification signal: the per-run tag that marked a denial
travelled inside the error text, where a script's own `pcall` could read it
and then forge it onto an unrelated failure to relabel that failure as a
permission denial. The presentation was cosmetic, since no boundary was
crossed, but the fix removes the seam: a provider's policy denial is now
recorded on the sandbox's out-of-band handle and the tag is gone, so no
classification signal reaches the script at all. Two smaller observations
were accepted rather than changed, and are noted here so they stay visible:
a persisted bundle cache keyed by archive path means a bundle replaced at the
same path inherits the old cache values, which is bounded because grants fail
closed and a cache entry is never trusted for freshness; and a bundle's
shipped `.cache/` is not read back into `cache.get` in the current host, so
there is no poisoned-cache path through it today.

The sandboxed `require` was wired in for the packs feature (issue #3) and
ships with an executed adversarial probe suite run through the real
interpreter: path traversal in module names (caught by the reused bundle
path-jail), bytecode rejection on both the host and Lua sides, the
pack-namespace denial-with-no-resolver seam, per-run cache isolation, cycle
detection that terminates on its own rather than by the wall-clock kill, tier
gating, a required module sharing the run's resource caps, and probes that no
require or `load` internals leak to user code. One hardening landed with it: a
fail-closed assertion in `runScript` refuses to run any user code if the
load-capture window described under "Sandboxed require" is ever left open.

That independent adversarial pass over the whole pack arc has since run
(August 2026), against the real interpreter and the real extension pack-loading
path. It confirmed the require jail invariant end to end: no code-loading
primitive reaches user code or a required module body, bytecode is rejected on
both sides, modules run inside the caller's own resource caps, cycles terminate,
and the per-run cache does not leak across runs. It also confirmed that webview
pack loading is driven only by the `markii.packs` setting, never by note
content, and that the setting's user-only application scope is what keeps a
workspace from injecting packs. No escape, grant bypass, note-driven loading, or
crash was found. Two LOW hardening items came out of it and are now fixed: the
application-scope declaration is pinned by a test so it cannot be silently
removed, and pre-reading a pack's shared Lua now applies a per-file size cap,
matching the bundle snapshot's posture.

Scheduled and auto-run execution then shipped in the reference extension (issue
#11): a note can refresh on an interval or run once when its preview opens, both
at the read-only tier. The two rules under "Triggers cap capabilities" are what
make this sound: the tier is enforced in the worker regardless of grants (a real
worker probe confirms an effectful call is refused under the auto and scheduled
triggers while the same call succeeds under manual), and grants for these
triggers are resolved from stored consent only, so a run without a click never
prompts and never reaches a host the user did not already grant by hand.

That surface has now had its own dedicated adversarial pass (August 2026, issue
#12), driven through real worker threads, the real Lua sandbox, and real local
HTTP servers rather than mocks. The two rules held under attack. Repeated
scheduled and auto ticks could not reach an effectful capability by any route
tried: not a POST or PATCH with the host allowlisted, not a bundle write even
with the write declared in the manifest and granted by the host, and not by
seeding one tick's cache with capability-shaped data for a later tick to read,
because the tier comes only from the trusted trigger the host passes and never
from anything a script can write. The same refusals applied to code reached
through a pack's `require`. On the grant side, a run without a click never
prompted and never widened access: a whitespace-only edit, a comment-only edit,
a renamed script, and a change to the content of a `src=` file all moved the
closure key and left the scheduled run with an empty allowlist. The
no-new-network claim was measured at the server rather than inferred from an
error message, with the ungranted host's own request counter staying at zero
across first-ever scheduled runs, auto runs, a script swapped between a manual
grant and the next tick, and a note naming one granted and one declined host.

The pass found one real gap and two narrower robustness bugs, all now fixed.
The gap was a declaration, not logic: `markii.runOnOpen` and
`markii.refreshIntervalSeconds` carried no configuration scope, and an
unscoped VS Code setting defaults to window scope, which a workspace's own
`.vscode/settings.json` can set. A repository could therefore turn on
unattended execution for anyone who opened it, which is precisely what the
`markii.packs` setting had been pinned to application scope to prevent. The
network gate still held in that state, since a fresh clone carries no stored
grant and an auto run never prompts, so what a workspace could actually cause
was capability-free sandboxed execution rather than any reach outward. The
property that no code runs without a user gesture was still broken, so both
settings are now pinned to application scope and a test pins every setting
that can cause an unattended run. The two smaller bugs were in the persisted
value store: a corrupt entry made rehydration throw where it should degrade,
and a value named `__proto__`, which is a legal script name, was silently
dropped by an output object built with plain assignment. Both paths now skip
what they cannot understand and build their output so that every name
survives, matching the discipline `@markii/runtime`'s own value store already
followed.

### Turning script execution off

Both hosts offer a switch that turns script execution off for one machine:
`markii.scriptsDisabled` in VS Code, and a device-local `scriptsDisabled`
setting in the Obsidian plugin. While it is on, no trigger runs a note's
scripts, whether the user presses Run, opens a note with run on open
enabled, or waits for a scheduled refresh. The check sits in the single
shared body all three triggers pass through, and it returns before any
grant is read and before the isolate is spawned.

This is a convenience, not a containment boundary. What contains a script
that does run is unchanged: the trigger-to-tier gate, the grant model, the
pinned network capability, and the terminatable isolate. The switch adds a
way to decline the whole mechanism rather than a new layer inside it.

Its storage is the part that matters. In VS Code the setting is pinned to
application scope, so a repository's own `.vscode/settings.json` cannot set
it in either direction: a workspace can neither turn scripting on for a
reader who turned it off, nor claim to have turned it off. In Obsidian it
lives in device-local storage rather than plugin data, because plugin data
is written inside the vault and travels with Sync and with any shared copy;
one device's decision about executing code must not become another's.
Grants are untouched in both directions. Turning execution off leaves every
stored network and bundle grant as it was, and turning it back on
re-authorizes nothing beyond what the user had already granted by hand.

One coverage limit from that pass is worth stating plainly rather than
leaving implied. The timer lifecycle itself, meaning the interval's clearing
on disposal, the at-most-once run on open across a hide and show, and the
guard against overlapping ticks, lives in the one module that imports the
editor API and therefore cannot be unit-tested in this repository. It was
reviewed by reading rather than by execution, and the layer directly beneath
it was probed. Closing that gap needs an editor-hosted integration test,
which is tracked with the other host-level verification below.

The resolve-and-pin work of issue #10 was verified against the real
resolver and the real network rather than only against injected answers. A
note granted a public name whose genuine DNS answer is a loopback address
is refused as an ordinary capability denial, and a note granted
`api.github.com` still completes a real request through TLS and a redirect.
That second check earned its place: porting the request path off `fetch`,
which was necessary because `fetch` cannot pin where a socket connects
without pulling in a dependency, silently dropped the default headers
`fetch` had been adding. With no user agent, the GitHub API answers 403,
so every note reading it would have broken while a suite of local-server
tests stayed green. The headers are now set explicitly and pinned by tests.

Two areas remain intentionally outside the audited surface, and are tracked
rather than forgotten: the four known hang reproductions are covered by
dedicated deadlock tests rather than re-executed in CI (re-triggering a
genuine hang would wedge the test runner); and the external terminatable
isolate is now exercised by the extension's own tests but its behavior inside a
live editor host is the application's to verify. The consent prompt shown when a note builds network
addresses at run time now states the denial outright: it says those requests
cannot be listed in advance and will be denied, and that only the hosts
written directly in the note can be granted, so accepting is never mistaken
for enabling the dynamic requests.
