# `@markii/lua` sandbox re-audit

**Date:** 2026-08-17
**Auditor:** Claude Opus 4.8 (this session began as Fable 5 and was silently
downgraded to Opus 4.8 mid-session; see "Provenance" below — this is exactly
the trust problem this report is structured to survive).
**Target:** `packages/markii-lua/src` at commit `9924bcb`.
**Scope:** the sandbox internals that were built and "verified" during earlier
sessions whose model identity is uncertain — the empty-environment globals
whitelist, instruction/wall-clock/memory limits, the Lua↔JS marshaller, the
`require` jail, and the xpcall-deadlock fix.

## How to read this report (the trust model)

The point of this audit is that **you should not have to trust the auditor's
model.** Every claim below is one of three verdicts, and each carries evidence
you can re-run:

- **VERIFIED-SAFE** — I wrote an attack, ran it against real wasmoon, and it
  failed closed. Evidence = the probe and its actual output.
- **REASONED-SAFE** — I read the mechanism and argue why it holds, but did not
  execute an independent attack (usually because the existing suite already
  does, and I confirmed those tests are genuine, not gutted). Weaker.
- **FINDING** — something is actually wrong or weaker than intended. Severity
  and containment stated explicitly.

A "found nothing" verdict is **not** proof of absolute safety — it is bounded
by the attacks I actually tried, listed below so the gaps are visible.

The adversarial probes were run from a temporary test file
(`packages/markii-lua/src/audit-probe.test.ts`, since deleted). Anyone can
recreate them from the code snippets quoted here and re-run against the same
commit. The pre-existing suite they complement lives in
`packages/markii-lua/src/*.test.ts` (globals, limits, limits.deadlock, marshal,
capabilities, failure-classification, require, sandbox — ~161 tests).

---

## Checklist & verdicts

### 1. Empty-environment globals whitelist (`globals.ts`)

**Verdict: REASONED-SAFE, with two VERIFIED-SAFE spot-checks.**

Mechanism (read and confirmed): the engine is created with
`openStandardLibs: false`, so `os`/`io`/`package`/`debug`/`coroutine` are
**never linked into the state at all** — this is stronger than load-then-delete
because there is no table entry to recover. Only Base/String/Table/Math are
hand-loaded, then a scrub prelude nils the dangerous Base names (`load`,
`loadstring`, `loadfile`, `dofile`, `collectgarbage`, `rawget/set/equal/len`,
`getmetatable`, `setmetatable`, `print`, `warn`, `_G`, `_VERSION`,
`string.dump`). The existing `globals.test.ts` genuinely asserts each of these
absent and confirms `_ENV` recovers nothing (`_ENV.os` is nil because it was
never installed) — I read those tests; they are real assertions, not
smoke tests.

Independent spot-checks I added (existing suite covers `getmetatable` but not
these two exact forms):

- **C1 — `setmetatable` truly absent (not just `getmetatable`):**
  `return type(setmetatable)` → `{ ok: true, value: 'nil' }`. This matters
  because removing only `getmetatable` would still let a script *install* a
  hostile metatable; both are gone, so a script cannot attach a metatable to
  any value at all — which is what collapses the entire "hostile metatable"
  attack class.
- **C2 — method-form bytecode dump `("x"):dump()`:**
  `return type(("x").dump)` → `{ ok: true, value: 'nil' }`. The scrub nils
  `string.dump` on the shared string table that the string metatable's
  `__index` points at, so both `string.dump(...)` and `("x"):dump()` are
  closed in one move.

### 2. Instruction / wall-clock / memory limits (`limits.ts`, `sandbox.ts`)

**Verdict: VERIFIED-SAFE for the reported outcome; the underlying hook is
explicitly best-effort by design (correctly documented as such).**

The enforcement is layered and the layering is sound:

- The in-VM count hook sets a **JS-side `breached` flag** that no Lua value,
  metatable, or `pcall` can see or clear; `sandbox.ts` checks it
  unconditionally after every run and forces a `limit` failure regardless of
  what Lua reported. This is the real enforcement point — not the Lua-level
  error the hook also raises.
- Memory-cap breaches are told apart from a script's own
  `error("not enough memory")` by the **raw `LuaReturn.ErrorMem` C-API status
  code** (`captureAssertOkStatus`), which the VM sets and a script cannot forge.
- The async-hang case (a host capability promise that never resolves, during
  which no VM instructions run so the hook never fires) is covered by an
  **external `Promise.race` wall-clock guard** whose sentinel is a
  `ScriptLimitError` identified by `instanceof` — it never crosses the Lua
  boundary, so it is unspoofable.

Probes:

- **E1 — genuine deep recursion** (`rec(1000000)`): returns
  `{ kind: 'limit', limit: 'memory' }`, **no raw throw**. Stack growth hits the
  memory cap and is reported cleanly.
- **F3 — a 3,000,000-entry table**: killed by the memory cap in **65 ms**
  (`kind: 'limit', limit: 'memory'`), not a hang.

**Honest limitation:** I did **not** re-run the four known xpcall/pcall *hang*
reproductions inside this audit. Those require the out-of-repo child-process
SIGKILL harness precisely because a regression would hang the process; running
them under vitest could wedge CI. I read `limits.deadlock.test.ts` (which
exercises all four hang shapes with a bounded instruction cap so they terminate
as `limit` failures) and confirmed the assertions are genuine. The design also
correctly declares the in-VM hook best-effort and names the **external
terminatable isolate** (DESIGN §10) as the real guarantee — I did not audit a
host's isolate because none ships in this repo.

### 3. Lua↔JS marshaller (`marshal.ts`, `sandbox.ts`)

**Verdict: FINDING F-1 (LOW, contained) + otherwise VERIFIED-SAFE.**

The design is genuinely good: the return value is walked and re-shaped by a
**trusted Lua prelude inside the VM, under the instruction hook**, so a
1,000,000-entry table is rejected at ~20,000 `pairs` steps instead of paying
wasmoon's unbounded eager JS conversion. A JS-side `finalizeMarshaledValue`
pass is the second gate (rejects functions/`typeof`, cycles via a `Set`,
non-finite numbers).

VERIFIED-SAFE backstops (probes):

- **G3 — honest large table** (100k entries, no tricks): rejected
  `marshal/nodes` in **70 ms**. The cap works as designed on the normal path.
- **F2 / G1 — smuggle a function** by overriding `type()` (F2) or replacing
  `__smd_marshal_root` (G1): both come back
  `marshal / type ("unsupported ... type: function")`. No live function ever
  reaches the host — the JS-side `finalize` `typeof` check is the backstop.
- **A2 / G2 — cycle with `type()` overridden / entry point replaced**: both
  `marshal / cycle`. Cycle detection is defense-in-depth (Lua-side *and*
  JS-side `Set`), so defeating one still hits the other.
- **F1 — 40,000-deep nested table with `error` disabled**: comes back
  `{ kind: 'runtime', message: 'Maximum call stack size exceeded' }` — **no raw
  throw out of `runScript`.** wasmoon's own recursive `getValue` overflows
  first and the `RangeError` is caught by the run's `try/catch` and typed as a
  runtime failure.

**FINDING F-1 — the Lua-side marshal caps (node count, depth) are bypassable
by rebinding globals the walk uses.** The marshal prelude calls `error`,
`type`, `pairs`, and `math.floor` as **dynamic global lookups**, and the
untrusted user chunk runs *before* the walk in the *same* globals table. So:

```lua
error = function() end          -- neuter the walk's rejection primitive
local t = {}
for i = 1, 100000 do t[i] = i end
return t
```

- **A1** (node cap 20,000): the 100,000-entry table **passes through in full**
  — `{ ok: true, value: [1,2,3,...] }`. The node cap is entirely defeated.
- **F3** (same trick, 3,000,000 entries): no longer rejected by the node cap;
  instead caught by the **memory cap** in 65 ms.
- **A3** (`pairs` overridden to yield nothing): the walk emits `[]` — the
  script only corrupts its *own* return value.

Note (from G1/G2): replacing the entry point `__smd_marshal_root` itself does
**not** work — Lua resolves that global in the wrapper (`return
__smd_marshal_root(__smd_user_chunk())`) *before* the user chunk runs and
rebinds it. Only globals resolved *during* the walk (`error`/`type`/`pairs`/
`math.floor`) are reachable by the rebinding.

**Why this is LOW and not exploitable:** every downstream consequence hits a
non-bypassable backstop — leaked functions → JS `finalize` (F2/G1); cycles →
JS `Set` (A2/G2); oversized values → memory cap (F3, 65 ms) plus
instruction/wall-clock limits; deep nesting → caught `RangeError` typed as
runtime (F1). There is **no sandbox escape, no capability gain, no host hang,
no raw throw, and no function/userdata leak.** What is actually lost is the
marshaller's *fast-rejection performance property* — a hostile note can force
the host to spend up to the memory/instruction/wall-clock budget building a
value before it is rejected, instead of failing in ~20k steps. Given the
normative external isolate, even that is bounded.

**Recommended fix (cheap, not yet applied):** in `buildMarshalPrelude`, capture
the primitives into locals at prelude-definition time so the walk is immune to
later global rebinding:

```lua
local error, type, pairs, floor = error, type, pairs, math.floor
```

and use `floor` in place of `math.floor`. This restores fast-rejection and
removes the "what if a backstop has a gap" surface. **Also recommended:** wrap
the `runScript` body in a `catch` that classifies any unexpected JS throw as a
`runtime` failure — currently `finalizeMarshaledValue` is called outside any
`catch` (only the `finally`), and is safe *today* only because wasmoon's
`getValue` overflows first on deep input (F1); a defensive catch closes the
never-throws guarantee unconditionally.

### 4. `require` jail (`require.ts`)

**Verdict: NOT APPLICABLE in this phase — VERIFIED-ABSENT.**

There is no `require` jail to break because `require` is **unwired**: the
curated environment never sets a `require` global, and `sandbox.ts` never calls
anything from `require.ts`. `buildRequireStub`/`NOT_YET_SUPPORTED_MESSAGE` are
dead code kept as the landing point for the future packs phase. The existing
`require.test.ts` confirms a fresh engine has no `require`. **When** bundle-
local and pack-namespaced modules are wired (a later phase), the jail — path
normalization, pure-Lua-only, no bytecode, per-run cache — will need its own
adversarial audit against real escape attempts (`require "../.."`, symlinks,
bytecode injection). Nothing to certify today beyond "the capability does not
exist yet."

### 5. The xpcall-deadlock fix (`globals.ts`, `limits.ts`)

**Verdict: REASONED-SAFE (mechanism reviewed; hang-repros not re-run here — see
§2's honest limitation).**

The C-level `xpcall` invokes the user's message handler *while still inside the
C xpcall error-unwind frame*; once the limits hook has tightened to
`count = 1` after a first breach, a second hook-triggered `lua_error` longjmps
again inside that setjmp/Asyncify state and **deadlocks the host** (`thread.run`
never settles). The fix replaces `xpcall` with a **pure-Lua reimplementation
over `pcall`**, so the handler runs at ordinary call depth where a re-firing
hook behaves like the already-safe `pcall` case. I reviewed the reimplementation
(`XPCALL_REIMPLEMENTATION`) — it preserves multi-return via `table.pack`/
`unpack` and the handler-receives-error contract — and the deadlock suite that
covers the four hang shapes. I did not independently re-trigger the hangs for
the CI-safety reason in §2.

### 6. Capability surface & tier gating (`capabilities.ts`)

**Verdict: REASONED-SAFE — re-verified against real wasmoon during Phase E
(this session), reviewed again here.**

Capability tables are built as **genuine Lua-native tables**, and each raw host
handle is captured into a prelude `local` then niled as a global, so
`__smd_*_raw` names are unreachable from user code (existing test asserts this).
Denials are recorded on an **out-of-band JS closure** (`CapabilityDenials`)
before each throw, so classification never depends on a script-forgeable
message — the Phase E forgery battery (including `__tostring` metatable forgery
and exact-text reproduction of real denial messages) all classify as
`script-error`, and real denials/tier-blocks classify correctly with the
provider spy confirming the provider is never reached under the `auto` tier.
NUL-byte handling in `bundle.*` is a known, documented, test-pinned limitation.

---

## Additional finding (correctness, not security)

**F-2 — embedded NUL bytes in a returned string are silently truncated.**
Probe **D1**: `return "a" .. string.char(0) .. "b"` → `{ ok: true, value: "a" }`
(length 1). wasmoon's JS↔Lua string marshaling truncates at the first NUL, in
the **return-value path**, not only the `bundle.*` path that `capabilities.ts`
already documents. Impact is low (silent data loss, no security consequence;
`net.fetch_json` returns JS-parsed JSON so it is unaffected, and JSON-escaped
` ` in text is a 6-char sequence, not a NUL byte), but it is broader than
the currently-documented scope. Recommend widening the `capabilities.ts` NUL
note to cover return values, or rejecting strings containing NUL at the marshal
boundary rather than silently truncating.

---

## What I did NOT test (visible gaps)

- The four xpcall/pcall **hang** reproductions were reviewed by reading, not
  re-executed (CI-safety; §2/§5).
- No audit of a **host's external terminatable isolate** — none ships in this
  repo; it is the normative real kill switch and remains the host's to prove.
- The **`require` jail** — does not exist yet (§4); must be audited when built.
- I did not fuzz the **fence-meta / URL-sanitizer** boundaries here — those are
  `@markii/core`, outside this sandbox audit's scope (the node-path
  `data.hName` injection was already found and fixed in Phase D2).
- Marshalling of **very large integers / float-key edge cases** beyond the
  `1.5`-key probe (F4, rejected `key-type`) was not exhaustively explored.

## Provenance

This report was produced after a silent model downgrade (Fable 5 → Opus 4.8),
verified by the user via `/context`. That is why every claim is evidence-backed
and re-runnable rather than asserted: the report's integrity does not depend on
which model wrote it. The durable state it audits (source at `9924bcb`, the
existing test suite, and these probes) is all on disk and re-checkable.

## Bottom line

The sandbox core holds up. The empty-environment strategy, the out-of-band
non-spoofable limit/denial signals, the in-VM marshaller with JS-side backstops,
and the honest "in-process limits are best-effort; the external isolate is the
real guarantee" posture are all sound, and the earlier sessions' security fixes
reproduce. One **LOW, fully-contained** defense-in-depth finding (F-1: marshal
caps bypassable by global rebinding, contained by memory cap + JS finalize) and
one **low correctness** finding (F-2: NUL truncation in return values) are worth
fixing but neither is exploitable for escape, leak, or hang. No changes were
applied by this audit; the two fixes are recommended for your go-ahead.
