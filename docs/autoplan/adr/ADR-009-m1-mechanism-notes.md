# ADR-009 — M1 implementation mechanism notes (DRIFT-MINOR record)

## Status
accepted (records mechanism choices in M1 that differ from the literal wording of earlier ADRs/spec but uphold their intent; flagged DRIFT-MINOR by the M1 architect-review, none blocking M2)

## Context
M1 implemented the canonical tree (ADR-003/004/008). The architect-review noted several mechanism substitutions vs the literal spec text. They pass all gates and are ADR-faithful; this ADR records them so the ADR set reflects the implementation.

## Decision
1. **Semantic source = per-actor `Accessibility::Accessible::Get(actor)->GetRoleName()/GetName()`**, NOT parsing the whole `DumpTree(DUMP_FULL)` string. Same headless-working accessible subsystem proven in ADR-008; per-actor queries avoid an in-C++ JSON-in-JSON parse and the non-deterministic atspi `path` counter. ADR-008's intent (use the headless accessible data) is upheld.
2. **`semanticsSource` vocabulary = `"bridge"` | `"reconstructed"`** (TS treeModel normalizes the harness's raw `"accessible"`→`"bridge"`). "bridge" = semantics came from the accessibility bridge/subsystem. (F1.1's test accepts {dumptree, reconstructed, bridge}.)
3. **`src/treeSchema.ts` pure TS mirror NOT extracted.** The structural-id and type→role logic live in the **C++ harness** (single source of truth, Inv-1). A TS mirror would be a second implementation that could diverge. Unit tests cover the TS `treeModel` (semanticsSource normalize, sourceLine merge) directly; the C++ id/role logic is validated by the render + determinism tests. Accept the omission.
4. **`sourceLine` via TS `cppParser` parallel-merge**, NOT C++ `__tag`. The CLI compiles the user's RAW C++ (Inv-5 faithful render), so we cannot inject `__tag` calls without rewriting user source; merging the parser's `sourceLine` on the TS side (anchored at the first non-`CameraActor` child) is the clean path.
5. **Role map**: `Layer`→"panel", `FlexLayoutImpl`→"container", `LabelImpl`→"label", `CameraActor`→"camera", etc. (DALi default accessible roles are "unknown" for the DSL controls).

## Alternatives considered
- Parse the full `DumpTree` JSON string in C++ — rejected (atspi-path nondeterminism, redundant parse).
- Extract `treeSchema.ts` and duplicate id/role in TS — rejected (divergence risk vs the C++ source of truth).
- C++ `__tag` for sourceLine — rejected (would require rewriting the user's source, breaking Inv-5).

## Consequences
- Good: cleaner, deterministic, single-source-of-truth for id/role (C++); sourceLine without touching user source.
- Bad: the C++ id/role logic is not directly TS-unit-testable (covered by render tests instead).
- Neutral: `semanticsSource` is "bridge" not "dumptree" — a vocabulary choice.

## Affected milestones
- M2 (overlay marks reuse the WU-1 structural ids), M5 (structured errors will improve the empty-input / compile-failure UX, which currently surfaces as a generic container-failure + eldbus stderr noise).
