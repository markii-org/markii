# Proposal: security-process rules for AGENTS.md

Status: ADOPTED (2026-08-23). Change 1 (maintenance-map additions) and Change
2 (the executed-probe coding standard) are in AGENTS.md; Change 3 (the promise
ledger) is in `docs/security.md`. This file is kept as the rationale record.
Companion artifacts shipped alongside: `skills/security-audit.md` (general
method), `skills/markii-security-audit.md` (repo-specific), and a seed executor
conformance corpus at `conformance/executor/`.

## Motivation

Both 2026 passes show hardening concentrates at seams: engine boundary,
storage jail, consent flow, archive readers. When a second script engine, a
second renderer, or a second host lands, most posture should transfer through
existing contracts instead of being re-derived. That transfer is currently
convention, not rule. Three changes close the gap.

## Change 1: maintenance-map additions (paste into "Maintenance map")

- **New ScriptExecutor implementation** (any engine adapted behind
  `@markii/runtime`'s seam) → must pass `conformance/executor/` cases plus an
  independent adversarial pass before merge; findings update `docs/security.md`
  in the same commit.
- **New platform renderer** → must consume `@markii/core`'s sanitized hast
  unchanged (no raw-markup escape hatch) and implement the
  failure-presentation contract; renderer checklist in
  `skills/markii-security-audit.md` is the review gate.
- **New host embedding the Run path** → the isolate requirement and host
  checklist (`docs/integration.md`) are the merge gate; grant persistence must
  re-validate on read; bundle handling goes through `@markii/bundle`, never a
  reimplemented jail.
- **Security probe suites are product code**: colocated `*probe*` suites are
  committed, kept green in CI, and never removed or weakened to make a suite
  pass. (Pass 1's 41-case suite was lost as an untracked file; this rule makes
  that class of evidence loss impossible.)

## Change 2: one-line addition to "Coding standards"

- Security-relevant behavior gets an executed probe (real worker/interpreter/
  server), not only unit assertions on mocks; conditional probes are resolved
  before merge.

## Change 3: docs/security.md promise ledger

Add a short subsection listing every normative "must/never" sentence with an
anchor, so audits (and the skills) grade code against an explicit claim table.
Currently these promises are scattered across prose paragraphs.

## Why rules alone are not enough

C-1 and F-1 were found by process, not by prose. The durable mechanism is the
committed conformance corpus plus committed probe suites; the AGENTS.md entries
exist so agents know those artifacts are mandatory gates rather than optional
hygiene.

## Suggested rollout order

1. Land this proposal's AGENTS.md edits (orchestrator).
2. Promote `apps/vscode/src/run/pentest-probe.test.ts` naming convention to
   the standing one; future passes append files like `pentest-probe-p3.ts`.
3. Grow `conformance/executor/` when the first non-Lua executor is proposed;
   its README defines the runner contract so #2 (second renderer) and #3
   (packs) can reuse the pattern.
