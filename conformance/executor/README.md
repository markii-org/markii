# Executor conformance corpus (seed)

Language-agnostic contract cases for ANY ScriptExecutor implementation adapted
behind `@markii/runtime` (the Lua sandbox via `@markii/lua` is the reference).
Per the repo rule, this directory is plain data: no TypeScript.

A future runner maps each case onto a concrete adapter and asserts the
observable outcome. Until that runner exists, these files are the normative
checklist: an engine adapter is not conformant until every case here is
demonstrated against it by an executed probe (see
`skills/markii-security-audit.md`, "Standing rules").

## Case schema

```json
{
  "id": "stable-case-id",
  "area": "isolation | classification | marshal | limits | tiers | contract",
  "invariant": "one-sentence normative requirement",
  "scenario": { "...": "engine-neutral inputs" },
  "mustHold": ["observable assertions, engine-neutral wording"]
}
```

## Reference mapping notes

- "guest code" means source in the adapter's language; for Lua fixtures the
  existing `packages/markii-lua` test bodies are the canonical phrasing.
- "host-side record" refers to whatever non-forgeable channel the adapter
  exposes to `@markii/runtime` (Lua uses its CapabilityDenials handle and
  breach flags; a JS engine might use symbol-keyed markers). The invariant is
  the CHANNEL PROPERTY, not a specific mechanism: classification must not be
  forgeable from guest-visible text.
