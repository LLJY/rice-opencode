---
name: property-based-testing
description: "Use when the user asks to design, run, or debug property-based or generated tests for genuine bug hunting: invariants, round trips, metamorphic, stateful, or model-based properties; shrinking and counterexamples; or Hypothesis, proptest, QuickCheck, rapid, fast-check, or jqwik. Do not use for ordinary example-only unit testing, benchmarking, or fuzz-only work."
compatibility: opencode
metadata:
  domain: testing
  workflow: property-based-bug-hunting
---

# Goal and boundaries

Find genuine, reproducible bugs with a small number of evidence-backed generated tests. Do not pursue broad coverage.

- Resolve and preserve the user's explicit target. The selected contract-bearing API, file, or symbol is the test boundary.
- Do not invent expected behavior, laws, or reference behavior, and do not admit inputs outside an evidence-supported valid domain. Generated values may be novel when their constraints come from that evidence.
- Do not fix production code or make dependency, manifest, lockfile, configuration, migration, system, live-service, or external-operation changes without explicit approval.
- Keep passing focused tests enabled in the ordinary suite. Do not broaden scope after finding an unrelated concern.

# Required workflow

Use `todowrite` when it is available. Otherwise, maintain this checklist inline and update it as work progresses:

1. Resolve the target and boundary.
2. Inspect the target, contracts, callers, existing tests, and repository conventions.
3. Propose and rank evidence-backed properties.
4. Choose the existing framework, valid domain, and bounded operational budgets.
5. Write a few focused tests.
6. Execute the narrowest repo-native command.
7. Triage every failure or suspicious result.
8. Report the outcome and retained tests.

# Targeting and safe inspection

- Derive the target from the current request, never from command-placeholder text. If it is absent, ask for one unless the user explicitly requests repository-wide exploration.
- In repository-wide mode, disclose one bounded candidate at a time and set a total cap on candidates, wall-clock time, and test-command executions before starting. Stop and report when any cap is reached.
- Trace wrappers, imports, and delegation only to understand behavior. Never substitute a private helper, unrelated API, or test-only surrogate for the selected boundary.
- Fully read each explicitly targeted human-authored text file, using chunks when necessary. State honestly when a file is generated, vendored, binary, or exceptionally large and cannot reasonably be read in full.
- Imports, builds, plugins, and introspection can execute code. Inspect first; ask before executing an unknown or untrusted target.

# Establish evidence and an oracle

Use evidence in this order:

1. Durable specifications, public documentation, and API contracts.
2. Public types and signatures.
3. Existing tests.
4. Comments.
5. Consistent callers.

For every proposed property, record its evidence location, the property, and the valid input domain. Materially conflicting evidence requires clarification or an explicit inconclusive conclusion. If no evidence-backed property exists, stop without expanding scope.

- A differential reference or state model must be independent, contract-compatible, and justified by evidence. Another wrapper over the same implementation path is not an oracle.
- A random crash alone is not a bug report: establish that the input is valid and that the failure violates a contract.

Rank candidate properties by evidence strength and bug-finding value:

1. Round trip or inverse behavior.
2. Independent differential/reference behavior.
3. Invariants and postconditions.
4. Idempotence.
5. Explicitly claimed algebraic laws.
6. Metamorphic relations.
7. Stateful or model-based transitions.
8. Valid-input no-crash for one narrow entry point.

# Adapt to the repository

- Inspect manifests, lockfiles, existing generated tests, and documented repository commands. Reuse the established framework and runner.
- Illustrative framework map: Hypothesis for Python; proptest or QuickCheck for Rust; rapid or testing/quick for Go; fast-check for JavaScript/TypeScript; jqwik for JVM projects.
- Verify current official syntax and behavior for the installed framework when executing or changing framework-specific code. Do not make any one framework's mechanisms mandatory.
- Property-based testing differs from coverage-guided fuzzing. Built-in fuzzing is a disclosed fallback only when it evaluates the stated property.
- Ask before adding a dependency or changing test/build configuration.

# Generators and budgets

- Prefer constructive and dependent generation to rejection-heavy filtering. Preserve the valid domain while shrinking.
- Exercise contract-relevant boundaries and, where supported, structured, recursive, and sequence inputs. Prefer generating valid candidates constructively. When the framework has documented discard or precondition semantics, use them only for residual out-of-domain candidates; never make a candidate pass by returning before the oracle.
- Set and record bounded operational budgets separately from semantic coverage: cases, size/depth, state-sequence length, runtime, and parallelism. Start narrow and justify every increase.
- Track accepted and discarded cases when the framework exposes them. Use floats only with contract-defined semantics.
- Retain the seed or replay token, minimized input, and relevant environment for every failure.
- Sandbox side effects with ephemeral local resources and deterministic cleanup. Never target production, live systems, or destructive external operations.

# Write and retain focused tests

- Add only a few high-value tests in the repository's native layout and naming style, against the selected boundary.
- Make each test's oracle and evidence visible enough to audit. Do not repair production code while writing tests.
- Passing tests remain enabled in the ordinary test suite.
- A genuine bug reproducer remains exact and runnable. Follow the repository's established known-bug policy; never silently skip, ignore, expected-fail, or weaken it.
- If no policy exists, ask before choosing between leaving the default suite red and keeping a standalone, explicit reproducer. Report its location and command either way.

# Execute and establish non-vacuity

Run the narrowest repo-native command first. Capture the framework/runner version, exact command, non-secret relevant environment facts, budget, replay token, and minimized input.

- Prove at least one valid generated case reaches the oracle using a known witness and available statistics.
- If reachability remains uncertain, temporarily force the oracle to fail, confirm the test fails, restore it, and rerun it.
- An unexecuted oracle invalidates a passing result.

# Triage failures

1. Validate the harness, generator, and oracle before claiming a product bug.
2. Repeatedly reproduce the minimized input and confirm it is in-domain from the evidence or callers.
3. Separate environmental failures and flakiness from deterministic behavior.
4. Assess impact, refine false alarms without concealing genuine bugs, and deduplicate failures by root cause.

Classify with this precedence:

- **Crash:** a valid-input unhandled failure.
- **Logic:** wrong result, state, or data.
- **Contract:** API, documentation, type, or error mismatch without a stronger symptom.

Note secondary aspects, but use the first applicable category. Rate severity as:

- **High:** security issue, corruption, common core path, or widespread impact.
- **Medium:** valid-input crash, contained substantive logic issue, or substantial contract breach.
- **Low:** narrow rare edge case, or diagnostics, exception, or UX issue without corruption.

# Report outcomes

Use the repository's report-directory convention first; otherwise write reports at the repository root. Name a bug report exactly:

```text
bug_report_<sanitized-target>_<YYYY-MM-DD_HH-MM>_<suffix>.md
```

Create the timestamp in local time and include its ISO-8601 offset in the report body. For `sanitized-target`, replace runs outside `[A-Za-z0-9_-]` with `_`, trim edge separators, and use `target` if empty. Use a four-character lowercase alphanumeric suffix; regenerate it if the name collides.

A genuine bug requires a report file. Never include credentials, tokens, private connection details, personal data, or other secrets; redact sensitive commands, environment values, and inputs while preserving a safe runnable reproduction when possible. A bug report includes:

- target, environment, category, severity, and date;
- concise summary and evidence-backed property with the exact test;
- minimized input, exact command, and a minimal standalone reproduction when possible;
- expected versus actual behavior, legitimacy, and impact;
- retained-test path and known-bug policy; and
- an unapplied production-code diff only when it is straightforward.

For no-bug or inconclusive outcomes, report in chat only and do not create a report file. Include the target, properties considered, framework, commands and budgets, retained-test paths, and blockers or reasons.

# Stop rules and anti-patterns

Stop and ask rather than proceeding with explicit-target scope expansion, an invented law, an invalid-domain report, silent discards, a surrogate boundary, a circular oracle, a random-crash claim without a contract, or unapproved dependency, configuration, or system changes.
