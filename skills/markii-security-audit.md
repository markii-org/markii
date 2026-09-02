# Markii security audit skill (project-specific)

Companion to `skills/security-audit.md` (general method law, attack-class
playbook, severity rubric, report contract). This file adds the repo trust
map, the known-findings ledger, concrete per-surface checklists with code
anchors, and the harness recipes proven in the August 2026 passes.

Prior art to read first: `docs/archive/PENTEST-REPORT-2026-08-23.md` (passes 1 and 2),
`docs/security.md` (normative model plus its written promises), `docs/bundles.md`,
and `AGENTS.md`.

## Standing rules for engagements in this repo

- Subagents never run mutating git; the orchestrator commits. Deliverables are
  the report addendum plus committed probe files only.
- Audit prose (`PENTEST-REPORT-*.md`, `skills/`) is prettier-ignored.
- Gates from repo root before reporting done: `npm test`, `npm run build`,
  `npm run lint`. Probe suites run as `npx vitest run <file>` FROM INSIDE
  `apps/vscode`; a `--root` override breaks workspace aliases, never use it.
- Findings namespaces already consumed: `N-*` (external pentest), `C-*`/`F-*`
  (implementer's internal bundle pass), `P2-*` (second external pass). Choose
  an unused prefix per engagement and declare it in the report.
- Docs edits are orchestrator-owned: propose changes in the report, never apply.

## Trust-boundary map with anchors

### Parse layer (`packages/markii-core`)

- `src/parse.ts`: unified + remark-gfm + remark-directive + frontmatter.
- `src/to-hast.ts`: directive tagging (`data.hName`) and THE URL sanitizer.
- Pinned by the `conformance/` corpus; parser-visible behavior changes require
  a fixture in the same commit (AGENTS.md maintenance map).

### Render layer (`packages/platforms/markii-react`)

- `src/render.tsx`: unknown directives fall back to a dashed box, never throw;
  script fences fold into collapsed markers.
- `src/components/failure-presentation.ts`: the single home of failure
  wording; branches only on the closed `FailureKind` taxonomy.
- Standing rule: renderers consume core's sanitized hast unchanged. Any new
  renderer adding a raw-markup escape hatch violates the architecture rules.

### Wire and webview (`apps/vscode/src`)

- `protocol.ts`: host-to-webview message guards both directions,
  hasOwn discipline, stale-revision drop.
- `webview-html.ts`: nonce-only script-src CSP, hand-rolled escapeHtml on every
  interpolation, CSPRNG `createNonce`; fresh nonce per HTML assignment in
  `preview-panel.ts`.
- `resource-roots.ts`, `webview/document-images.ts`: relative image resolution;
  traversal must simply fail to load.
- Only `extension.ts` and `preview-panel.ts` may import `vscode`.

### Run pipeline (`apps/vscode/src/run`)

- `run-host.ts`: spawnRun NEVER rejects; exactly-once settlement across
  message/error/exit/watchdog; terminate-on-settle; worker heap capped
  (`WORKER_MAX_OLD_GENERATION_SIZE_MB = 128`); watchdog timer unref'd.
- `worker-entry.ts`: malformed-job guard; net provider does manual redirects
  with per-hop allowlist checks BEFORE contact, credentialed-target handling,
  streamed bounded body reads (`readBoundedBody`); per-run random denial tag
  (`createNetDenialTag`); `netGrants { get, post }` covers PATCH (patch gates
  on the post list inside @markii/lua).
- `run-flow.ts`: cache snapshot cap with wholesale drop; wire scrubbing strips
  raw error text before values reach the page.
- `grant-flow.ts`: closure-keyed grants via computeGrantKey; read-time
  re-validation of stored hosts/grants; prompt-storm cap (`MAX_HOST_PROMPTS`,
  consolidated all-or-nothing gate above it); full decline never persisted;
  bundle prompts fail safe when the adapter is missing.
- `script-requirements.ts`: static host extraction; unknown-hosts honesty gate.

### Sandbox (`packages/markii-lua`)

- Empty environment: dangerous stdlibs never linked; scrub removes load/raw*/
  metatable accessors/string.dump; pure-Lua xpcall reimplementation closes the
  C-frame deadlock class.
- `capabilities.ts`: cache plausibility clamp (integer, [0, nowMs]) with
  self-heal-as-miss; decoder budget pre-check before decode; prelude primitives
  captured at definition time (rebind-proof); tier stubs expose NO effectful
  surface under auto/scheduled triggers.
- `marshal.ts`: two-gate walk (guest side under instruction hook + JS-side
  finalizer), NUL rejection, cycle/depth/node caps.
- `limits.ts`: instruction hook, wall clock, memory caps; breaches recorded
  host-side through non-forgeable flags.
- Require jail: UNWIRED until packs (#3). Wiring it later requires its own
  adversarial pass (standing documented limitation).

### Bundle layer (`packages/markii-bundle`)

- `paths.ts`: normalizeBundlePath jail (no percent-decoding; rejects backslash,
  NUL, absolute, drive letters, any `..` segment). isWriteAllowed denies
  manifest.json/note.mk.md UNCONDITIONALLY, otherwise needs write:.cache/
  grant plus nonempty .cache/ prefix.
- `script-view.ts`: effective capability = declared INTERSECT granted; zero
  grants default; exposes read/write/exists only, never list.
- `zip.ts`: hand-rolled central-directory reader; loud whole-archive rejection
  for slip names and normalization collisions; declared-size bombs refused
  BEFORE inflation (per-entry + cumulative); CRC-32 verified; ZIP64 sentinels
  rejected; Map accumulation keeps __proto__ entry names inert.
- `fs.ts` (Node-only subpath): component-wise lstat walk refusing ANY symlink,
  realpath re-check, hard-link refusal via fd stat nlink>1; size() is
  stat-based metadata only (the C-1 guarantee); list() skips links.
- `manifest.ts`: hand-rolled validation; invalid grant vocabulary or hostname
  shapes reject loudly; document: field type-checked here, jailed at USE time.

### Snapshot model and adapters

- `bundle-run.ts`: buildBundleSnapshot consults size() BEFORE read() (C-1) with
  a post-read re-check; 20MB total and per-file budgets; deterministic
  truncation; bundleModulesFromSnapshot feeds F-1 grant keying;
  withPersistedCache overlays persisted zip-form cache (persisted wins);
  Memento encode/decode fail-safe shapes, wholesale drop past 1MB.
- `snapshot-storage.ts`: worker-side storage over a plain Map; every path
  through the shared jail; no live handle crosses into the worker.
- `preview-panel.ts` adapters: dir form persists .cache/ writes back through
  jailed openDirBundle; zip form persists to workspaceState keyed by URI-string
  identity; zip open currently does workspace.fs.readFile UNBOUNDED
  (open finding P2-b).

## Known-findings ledger (verify regressions first)

| ID | Area | Disposition | Where pinned |
|---|---|---|---|
| N-1 | cache freshness forgery | fixed: integer+range clamp, self-heal as miss | pentest-probe + sandbox.test |
| N-2 | spawnRun rejects on uncloneable payload | fixed: postMessage try/catch to settle | run-host.test |
| N-3 | forgeable denial string tag | shape fixed; RESIDUAL P2-c leak+forgery same-run | pentest-probe (two pinned cases) |
| N-4 | credentialed redirect misclassification | fixed: construction-time throw becomes denial; hop pre-checks proven non-contact | pentest-probe |
| N-5 | dishonest dynamic-address prompt wording | DEFERRED by owner, tracked in docs | docs/security.md final paragraph |
| N-6 | stored grants reused verbatim | fixed: read-time re-validation, drops force re-prompt | grant-flow.test |
| N-7 | hostname grants cover all ports/paths | accepted limit, documented AND pinned live (cross-port redirect allowed) | pentest-probe N-7 case |
| N-8 | DNS rebinding TOCTOU | accepted limit, documented | docs/security.md |
| N-9 | Math.random CSP nonce | fixed: CSPRNG per character, fresh per load | webview-html.test |
| N-10 | remote images fetch on open | documented posture | docs/security.md opening section |
| N-11 | silent data quirks (__proto__ key drop, marker reshape) | PINNED unchanged on purpose | run-host.test N-11 block |
| C-1 | dir-form snapshot read before size check | fixed: size-first at every reader incl. manifest/document (5MB caps) | pentest-probe C-1 cases |
| F-1 | grant key omitted src= content | fixed: bundleModules hashed as key section 0x02; snapshot built pre-grant | pentest-probe F-1 case |
| P2-a | zip persisted cache keyed by path identity | OPEN low: same-path swap inherits old cache values (grants fail closed) | pentest-probe overlay case |
| P2-b | unbounded raw archive readFile on zip open | OPEN medium: contradicts docs opening-promise; needs stat gate | code anchor preview-panel.ts openZipBundleArchive |
| P2-c | denial tag leaks via pcall error text; forgery reclassifies | OPEN low, CONFIRMED live; fix = sanitize tag out of guest-visible text or classify below the seam | pentest-probe N-3 pair |

## Per-surface checklists

### Parser and renderer

1. Hostile directive attributes (empty, huge, control chars, URL schemes) end
   in either a valid component or the unknown-directive fallback; never raw
   markup, never a throw.
2. URL sanitizer blocks javascript:/data:/vbscript: and any scheme additions
   stay denied by default; conformance fixtures cover each.
3. Deeply nested or enormous documents parse without pathological cost;
   render sits behind React error boundaries.
4. Component getters that throw are guarded (historical fix e4dce76); a
   throwing component degrades to failure presentation, not a blank page.
5. Failure wording comes only from failure-presentation.ts; raw error text
   never reaches the DOM (D-1 scrub verified end-to-end).

### Wire protocol and webview

6. Both message directions reject hostile shapes via structural checks with
   hasOwn; inherited-property tricks fail.
7. Stale-revision values are dropped identically by host and webview.
8. Nonce: 32 chars from node:crypto per assignment; grep for Math.random on
   security paths must stay empty.
9. CSP directives match docs promises; img-src https:+data: is the DOCUMENTED
   posture (N-10), not an accident.
10. Relative image traversal resolves outside localResourceRoots and simply
    does not render.

### Run pipeline

11. spawnRun settles exactly once across the four event races; watchdog fires
    resolve with kind 'limit'; terminate-on-settle keeps workers ephemeral.
12. Uncloneable job payloads become synthetic failures, not rejections.
13. Worker heap cap present on every spawn path.
14. Redirect chain: every hop allowlist-checked BEFORE dialing (hit counter
    proof), MAX_REDIRECTS enforced, credentialed Location becomes denial.
15. Body reads stream-abort past maxFetchBytes; declared content-length is a
    pre-check only.
16. GET/POST/PATCH share one allowlist; PATCH gates on the post grant list.
17. Denial classification: capability-denied vs script-error vs limit matches
    the taxonomy for real causes; forged MARK_CAPABILITY/MARK_LIMIT text stays
    ordinary script errors.

### Cache and persistence

18. Clamp battery: future, huge-future, fractional, negative storedAtMs all
    self-heal as misses with plausible rewrite; equal-to-now boundary is a HIT.
19. Persisted cache snapshots over cap drop WHOLESALE, never partially.
20. Memento readers degrade corrupt/foreign shapes to empty, never throw,
    never partially apply.

### Grants and consent

21. Grant key changes when ANY of: inline code, src= file content, bundle
    module content changes; manifest-only edits do NOT silently extend grants
    (new asks go unprompted and therefore denied).
22. Stored grants re-validate host shapes on read; dropped entries force the
    full prompt flow.
23. Prompt count above ten distinct hosts collapses to ONE consolidated gate;
    below it the sequential loop stands.
24. Full decline persists nothing (recoverable); partial grants persist.
25. Unknown-hosts gate wording honesty tracked while N-5 stays deferred.
26. Manifest-declared hosts union into PROMPTING only; user click remains the
    sole source of allowedHosts.
27. markii.resetScriptGrants actually clears derived state.

### Sandbox

28. Dangerous stdlibs absent from linked libs (not merely deleted globals).
29. Scrub list intact: load/loadstring/dofile/rawaccess/mt accessors/dump.
30. Prelude primitives immune to guest rebinding between calls (A1/A2/D1
    regressions).
31. Decoder budget checked BEFORE decode (B2); array-marker spoof rejected
    (A4); NUL-bearing strings rejected at the marshal boundary.
32. Cycle/depth/node caps hold on return values, cache writes, cache hits, and
    fetched bodies alike.
33. Tier stubs under auto/scheduled expose no effectful surface to probe.
34. Limit breaches classify via host-side flags; guest cannot forge kinds.

### Bundle forms

35. Jail battery rows: `../x`, `a/../b`, `/abs`, `C:/`, backslash, NUL, empty,
    `.`, plus ACCEPTED literals `..%2Fx` (no decoding) and `cache/__proto__`.
36. isWriteAllowed unconditional denials hold even with full grants.
37. ScriptView intersection both directions end-to-end through a REAL worker
    (capability-denied kind on violation); missing-path read resolves nil.
38. Snapshot: over-budget file skipped with size() consulted first and read()
    never called (spy); size()-vanishing paths skip blind-read; truncation
    deterministic under sorted listing.
39. Zip hostility via hand-built archives: slip name rejects whole archive;
    per-entry declared bomb refused pre-inflation; cumulative budget refused;
    normalization collisions rejected; wrong CRC rejected; ZIP64 sentinels
    rejected; __proto__/constructor entry names inert on open.
40. Dir-form links: symlink file, symlink dir-component, hardlink nlink>1 all
    fail closed on EVERY operation (read/write/exists/size); list skips them;
    ordinary jailed writes still work afterwards.
41. Manifest: port/path/wildcard/trailing-dot/underscore hostnames reject
    loudly; duplicate JSON keys last-wins benignly; document: field escapes
    are manifest-invalid at resolution; __proto__ keys stay inert own-props.
42. Zip-form persistence: encode/decode round-trips cache/__proto__ INTACT
    (bare magic keys unreachable through jail); prototype untouched; over-cap
    state dropped wholesale.
43. Overlay semantics: persisted wins over shipped archive cache (P2-a shape);
    identity is URI-string; swap-at-same-path cannot widen grants (key
    excludes manifest).
44. Open flow: classify uses stat ground truth; NOTE P2-b: archive bytes read
    unbounded today; asset data-URI extraction bounded 20MB AFTER read but
    capped upstream by 256MB inflate ceiling.

## Harness recipes (proven)

- spawnRun against `worker-entry.ts` directly (tsx execArgv handled inside
  run-host when workerPath ends in .ts); fence()/bytesOf() doc builders.
- Loopback HTTP helper returning { url, hostname, hostPort, hits(), close }:
  ALWAYS keep hostname separate from port; bind decoys on `localhost` when you
  need a DIFFERENT hostname string than an allowlisted 127.0.0.1 (ports alone
  never differentiate hostname grants; that IS the N-7 semantics).
- Hit counters prove non-contact for refused redirects/targets.
- Minimal STORED-method zip builder with explicit central-directory field
  order: crc32 @16, compressedSize @20, uncompressedSize @24 (swapping those
  two sizes silently turns your bomb test into a CRC test). Overrides for
  declared-size lies and CRC corruption; LFH csize@18/usize@22.
- Spy storages whose read() records calls or throws; sparse files via
  fs.open+truncate for instant multi-MB budgets; tmpdir link farms rebuilt
  per test; Map-backed fake Mementos with recorded prompt sequences.
- Resolve conditional probes during the session, then pin OBSERVED behavior
  with hard assertions and a why-comment.

## Standing out-of-scope items (say so in every report)

Supply-chain depth (CVE sweeps, provenance verification); live VS Code host
behaviors (real webview CSP enforcement, workspaceState quotas, restart
mid-run); Lua VM re-fuzzing beyond regression classes; live POST/PATCH drives
(GET path proven; verbs share fetchAllowed and tier gating is unit-tested);
auto/scheduled tiers lack a live harness under bundles; require jail audit
BLOCKED until packs (#3) wires it; second renderer (#2) inherits the renderer
checklist above when it exists.
