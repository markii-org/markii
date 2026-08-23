# Security audit skill (general purpose)

Reusable methodology for adversarial security reviews of software: libraries,
file-format implementations, editor extensions, plugins, CLIs, sandboxes,
parsers, and host applications. Companion project-specific skill lives at
`skills/markii-security-audit.md`; read that one instead when auditing the
Markii repo itself.

## When to use

- Before shipping a release that touches trust boundaries (parsing untrusted
  input, executing generated code, network access, filesystem writes).
- To independently verify another party's security claims ("we fixed X").
- After introducing a new engine, renderer, host, or transport.
- Periodically against areas whose only assurance is an old audit.

## Method law (non-negotiable)

1. **Execute, do not review.** Every verdict is backed by a running attack or
   a running mechanism probe against the real pipeline. Code reading locates
   targets; execution produces evidence. A finding you could not trigger is a
   hypothesis, not a finding.
2. **Self-reported clean passes are untested claims.** If the author ran an
   internal adversarial pass, re-run its areas yourself. Authors grade their
   own exams generously.
3. **Verify fix shape, not intent.** For each claimed fix, assert the exact
   mechanism in code (ordering, bound, source of randomness, identity), then
   attack it. An intent-correct, shape-broken fix still fails.
4. **Pin what you prove.** Every confirmed behavior, good or bad, becomes a
   committed regression probe with a stable name. Uncommitted probes are lost
   evidence; treat probe suites as product code.
5. **Extract written promises first.** Documentation that says "X can never
   happen" converts directly into testable claims. A doc/code mismatch is a
   finding even when the code is the safer side (and often it is not).
6. **Hunt fail-open degradations.** For every error path ask: does this
   quietly succeed, partially apply, or lose data silently? Silent loss and
   silent success are both findings.
7. **Coverage honesty is part of the deliverable.** The report must contain an
   explicit "what this did NOT establish" section. Unexecuted areas are named
   as such, ranked by risk.
8. **Go/no-go ties to written promises.** Blockers are findings that contradict
   a documented guarantee, enable privilege escalation or escape, or corrupt
   user data. Presentation-grade dishonesty is a tracked finding, not a veto.
9. **No mutations during assessment.** Read-only VCS operations only; the
   owner commits. Deliverables are the report and committed probes, nothing
   else, unless scoped otherwise.

## Phase 0: recon

Produce these inventories before attacking anything:

- **Trust boundaries**: every line where attacker-controlled data crosses into
  privilege. Label each with the worst case if it fails.
- **Entry points**: file openers, wire messages, network listeners, CLI args,
  environment, embedded scripts, imported configs.
- **Persistence**: caches, stores, preference systems. For each: key scheme,
  who can write it, is it validated on read?
- **Serialization seams**: every encode/decode pair (JSON, custom binary,
  canonical digests). Note delimiter strategy, duplicate-key behavior, magic
  keys, depth/size caps.
- **Concurrency and lifecycle**: async settlement points, kill switches,
  timeouts, worker/isolate lifecycle, unhandled rejection channels.
- **Third-party surface**: dependencies with parsing/compression/crypto roles;
  CDN or runtime-download fallbacks; install scripts; provenance.
- **Docs promises table**: quote every security claim from documentation with
  file and line. This becomes the claim ledger the whole audit grades against.
- **Diff map** (verification engagements): map every changed hunk to a claimed
  item. Flag undisclosed scope explicitly.

## Phase 1: threat model per deliverable form

Pick the row that matches what ships; attack accordingly.

| Form | Attacker controls | Primary question |
|---|---|---|
| File format | bytes | Can parsing allocate, escape, or mislead before validation? |
| Archive/container | entry names + headers + payload | Does opening bound work before materializing? |
| Plugin/bundle | everything inside, distributed socially | Can it arrive pre-poisoned, self-elevating, or confusingly aliased? |
| Script sandbox | arbitrary code in a guest language | Can it cross the boundary, exhaust the host, or lie about failures? |
| Host application | UI trust, storage, OS access | Are consent, isolation, and persistence honest and revocable? |

## Attack-class playbook

Work through every applicable group. Each bullet is a check with a known
productive history somewhere; do not skip because it looks unlikely.

### Parsing and canonicalization

- [ ] Delimiter and framing confusion in any hand-rolled binary/text format
      (length-prefix vs terminator mixing, field-order assumptions).
- [ ] Canonicalization mismatch: same logical resource, two spellings
      (percent-encoding applied or not, backslash vs slash, case folding,
      Unicode normalization, trailing dots/slashes).
- [ ] Duplicate keys in objects/headers/params: last-wins, first-wins, or
      both-visible? Can an attacker show checker and victim different views?
- [ ] Magic property names through any plain-object accumulator:
      `__proto__`, `constructor`, `prototype` at top level AND nested.
- [ ] Integer handling: overflow, sign flips, float vs int (`Number.isInteger`
      gaps), length measured in UTF-16 units vs UTF-8 bytes vs codepoints.
- [ ] Embedded NUL truncation in any C-adjacent or string-marshaling layer.
- [ ] Depth and width bombs: nesting, entity expansion, repeated structures;
      allocation-before-validation anywhere in the parse loop.
- [ ] Regex safety on attacker input (catastrophic backtracking).
- [ ] Charset/encoding sniffing divergence between validator and consumer.
- [ ] Trailing garbage, BOM handling, empty-vs-absent distinctions.

### Archives and containers

- [ ] Path-traversal entry names, encoded variants, absolute paths, drive
      letters; rejection loud (whole artifact) or silent pruning?
- [ ] Declared-size trust: is uncompressed size honored before allocation?
      Header fields vs actual stream; ZIP64/sentinel values.
- [ ] Decompression bombs per-entry and cumulative; ratio caps.
- [ ] Entry-name collisions after normalization (dual-view attacks).
- [ ] Symlink and special-file entries; what materializes on extract?
- [ ] Integrity: checksums verified? On the authoritative metadata or a
      spoofable copy?
- [ ] Cost of OPENING: raw container read bounded before parse?

### Filesystem

- [ ] Component-wise symlink refusal on EVERY operation (read, write, exists,
      stat, list); leaf vs ancestor links; links resolving inside the root.
- [ ] Hard-link aliasing (nlink > 1) before overwrite.
- [ ] Check-to-use TOCTOU windows; fd-based (fstat/open-with-O_NOFOLLOW-style)
      closing where the platform allows.
- [ ] Traversal in every consumer of user-supplied paths, including ones
      validated elsewhere ("jailed at use time" consistency).
- [ ] Platform aliasing: case-insensitive collision, trailing dot/space,
      reserved device names, separator differences.
- [ ] Enumeration leaks: listing revealing structure beyond granted scope.
- [ ] Temp file races and predictable names.

### Sandboxes and guest code

- [ ] Ambient capability inventory: clock, randomness, iteration order,
      globals, stack inspection reachable from guest?
- [ ] Fresh-state-per-run: leftovers, memoized engines, shared protos.
- [ ] Global/primitive rebinding between definition-time and call-time
      (capture primitives into locals at prelude definition).
- [ ] Error-object crossing: do host error MESSAGES enter guest-visible text?
      Can guest forge host-side classification using leaked tokens/tags?
- [ ] Value crossing bounds: depth, node count, cycles, size, key types, NUL,
      non-finite numbers, BigInt; enforced on BOTH directions and BOTH sides
      (guest walk under instruction hook + host finalizer).
- [ ] Array/type markers spoofable by remote or stored data.
- [ ] Resource limits: instruction hook unwindability, memory ceilings on the
      right heap (worker vs host), wall clock enforced OUTSIDE the guest,
      terminatable isolate with an always-available kill switch.
- [ ] Classification integrity: capability/limit failures distinguishable
      from bugs via non-forgeable, host-side-only mechanisms; tier gating
      structural (no effectful surface exposed) rather than check-based.
- [ ] Settlement races: exactly-once across message/error/exit/watchdog;
      unhandled-rejection channels; floating promises swallowing failures.
- [ ] Feature-detection probing used to infer permissions (stubs that exist
      but deny vs absent).

### State, cache, persistence

- [ ] Poisoned stored state served without re-validation (shape, freshness,
      size) — especially state shipped by an attacker-deliverable artifact.
- [ ] Freshness forgery: future, huge, fractional, negative timestamps;
      clamped against a clock read at use time.
- [ ] Identity keying: can two different artifacts collide on one storage key
      (path reuse, name reuse)? Does persisted state bleed across swaps?
- [ ] Partial writes: is drop-wholesale implemented where documented?
- [ ] Self-heal paths: does healing rewrite plausible values and bound the
      healed write like a normal write?
- [ ] Quota growth: unbounded keys/values in preference stores.

### Authorization, grants, and consent UI

- [ ] Intersection enforcement both directions: declaration cannot expand a
      grant; a grant cannot exceed declaration.
- [ ] Grant keying covers the FULL executable closure: inline code, referenced
      files' CONTENT, transitively required modules, dependency versions.
      Swapping any of these must re-prompt.
- [ ] Stored grants re-validated against current rules on read; dropped items
      force re-prompt rather than partial silent reuse.
- [ ] Prompt honesty: wording matches actual semantics (send vs access);
      dynamic-address cases handled without implying unlisted hosts get
      allowed.
- [ ] Consent fatigue: per-item prompt counts capped; consolidated all-or-
      nothing gates above the cap; storms cannot recur forever across runs.
- [ ] Decline semantics: full declines recoverable (re-prompt later) without
      permanent silent lockout; partial declines persisted deliberately.
- [ ] Revocation: explicit reset exists and actually clears derived state.
- [ ] New declarations on cached grants: prompted, denied-by-default, or
      silently inherited? (Silent inheritance of NEW asks = finding.)

### Network and SSRF

- [ ] Allowlist granularity honestly documented: hostname-string matching
      implies ALL ports/paths/schemes on that host; is that stated?
- [ ] Redirects followed manually with per-hop pre-contact checks; hit-counter
      proof that refused targets were never dialed.
- [ ] Credentialed redirect targets (user:pass@host): construction-time
      throwaways classified as denials, not crashes.
- [ ] DNS rebinding TOCTOU acknowledged or mitigated (pinning, range refusal).
- [ ] Response bounding STREAMED (abort mid-body), not buffer-then-check;
      declared content-length trusted only as a pre-check.
- [ ] Scheme smuggling (file://, gopher, non-http) at every fetch seam.
- [ ] Same-host-different-port equivalence tested deliberately (it is usually
      ALLOWED by design; pin it so it cannot silently change).
- [ ] Proxy/environment variables honored by the HTTP client sit OUTSIDE the
      allowlist model: documented?

### Web rendering, XSS, and CSP

- [ ] Every sink reachable from untrusted AST/data; sanitizer bypass via
      caller-supplied override fields.
- [ ] Unknown/untrusted constructs fall back to inert rendering; never throw,
      never inject raw markup.
- [ ] CSP: nonce entropy source, freshness per load, no inline fallbacks,
      base-URI control, style-attribute gaps understood, data: URIs for
      script-capable types (SVG) assessed in context.
- [ ] Local resource serving: roots coverage, traversal in relative
      resolution, query/fragment tricks.
- [ ] PostMessage/bridge contracts: origin and shape guards both directions;
      inherited-property tricks rejected.
- [ ] Remote-loading posture documented (images on open) rather than implied
      zero-network.

### Supply chain and platform

- [ ] Runtime downloads (WASM, dictionaries, models): pinned? Verified?
      Documented as dev-only vs product?
- [ ] Install/postinstall scripts; native builds; provenance attestations.
- [ ] Dependency CVE pass for parsing/compression/crypto roles at pinned
      versions.
- [ ] Platform API surprises: workspace/storage APIs without size caps;
      clipboard/URI handlers as entry points.

## Verifying someone else's fixes

For each claimed disposition, record: item, claimed fix shape, asserted shape
(file:line), live probe result, verdict (verified / regressed / new finding /
doc-only). Baseline first: run the EXISTING regression suite untouched to
detect collateral breakage, then extend. Never trust "covered by tests":
locate the test, read its assertions, confirm it would fail without the fix
(negate mentally or temporarily).

## Severity rubric

- **Critical**: escape, RCE, auth bypass, cross-origin data exposure.
- **High**: SSRF past grants, privilege escalation via stored/declared state,
  destructive corruption, bypass of a documented hard guarantee.
- **Medium**: resource exhaustion on realistic actions (open/run), grant-scope
  widening under user-observable-but-misleading consent, integrity of failure
  reporting defeated.
- **Low**: presentation-grade dishonesty, silent data-loss quirks through
  unreachable-or-defended paths, hardening gaps with defense in depth intact.
- **Note**: doc/code drift where code is safer; semantics worth pinning.

## Evidence and harness patterns

Prefer these reusable shapes; rebuild cheaply per project:

- Real-process harnesses over mocks for anything crossing languages or threads
  (real workers, real interpreters, real servers on loopback).
- Hit counters on servers to PROVE non-contact, not just denial kind.
- Hostname-vs-port separation in test topologies (bind decoys on `localhost`
  vs `127.0.0.1`) to distinguish host-scoped from socket-scoped grants.
- Minimal hand-rolled container builders (zip, tar) giving full header control
  for declared-size lies, collisions, and integrity faults; know your field
  offsets (compressed vs uncompressed size slots are easy to swap).
- Spy storages whose reads throw, proving "never materialized".
- Sparse files via truncate for multi-hundred-MB budget tests in milliseconds.
- Tempdir farms of symlinks (file, dir-component, hardlink) rebuilt per run.
- Fake persistence (Map-backed mementos) with recorded prompts for consent
  flows; assert call ORDER and repetition, not just outcomes.
- Conditional probes are forbidden in final suites: resolve observed-vs-feared
  during the session, then pin the OBSERVED behavior with hard assertions and
  a comment explaining why.

## Report contract

Fixed section order; keep prior passes intact and append numbered passes:

1. Executive summary (verdicts, headline findings).
2. Scope, method, reproduction (commit, commands, environment).
3. Verification of previously briefed/dispositioned items (table).
4. New findings (per-finding: ID, severity, evidence command, impact, suggested
   repair, pin status). Namespace findings per engagement to avoid collisions
   with prior reports and the implementer's own internal IDs.
5. Attacked-and-held list (so held areas carry evidence weight).
6. Recommended order of work.
7. Coverage limits: what this engagement did NOT establish, ranked.
8. Release recommendation: go / no-go / conditional-go with the exact
   conditions, tied to the docs-promises ledger from Phase 0.

## Anti-patterns

- Reviewing diffs without running anything; calling hostile fixtures "too
  artificial"; asserting denial KINDS while ignoring whether the target was
  contacted; trusting a size/metadata accessor without reading its
  implementation; letting conditional probes ship unresolved; deleting or
  weakening probes to make suites pass; writing coverage-limit prose that
  hides behind "out of scope" without saying what the scope omission risks.
