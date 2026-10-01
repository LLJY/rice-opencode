---
name: frontend-design
description: "load this skill when doing any frontend related work or review."
license: MIT
compatibility: opencode
metadata:
  version: 0.3.0
  author: Lucas
  tags: ui, ux, hci, gestalt, dashboards, mobile, accessibility, information-architecture
  related-skills: design-md, popular-web-designs
---

# Frontend Design

Recognition, decision, action—not explanation. Semantic structure before visual expression.

This skill owns IA, interaction, accessibility, states, recovery, dense-data identity. Companion visual skills own palette, typography, atmosphere, signature—within these constraints.

## Rule IDs

Stable section-local IDs (`HIER-2`, `HPK-4`). Supporting bullets/examples inherit the preceding ID. Cite IDs in implementation evidence and reviews. Never renumber surviving IDs; add new suffixes.

## Authority

**AUTH-1 — Precedence.** Explicit user + safety/legal/privacy/accessibility → project requirements/design system → platform conventions → this skill.

**AUTH-2 — Tradeoffs.** Keep established conventions unless documented usability failure. Resolve conflicts for the primary task; report tradeoff.

**AUTH-3 — Structural category before colour.** Grouping, position, labels, form establish category/membership. Colour works inside that structure.

**AUTH-4 — Human identity before machine identity.** Repeated records lead with human-recognizable identity—not UUID/hash by default.

## Workflow

**WF-1 — Mode.** Choose:
- **Review:** inspect; prioritized violations + locations + fixes. No edits unless asked.
- **Design:** hierarchy, interaction, states, requested spec/mockup/prototype.
- **Implement:** inspect conventions; edit; render early; test states/interactions; verify.

**WF-2 — Context.** Compose, don’t choose exclusively:
- purpose: operational / analytical / transactional / narrative;
- input: touch / pointer / keyboard / voice / assistive tech;
- presentation: narrow / wide / dense / enlarged / portrait / landscape / split.

**WF-3 — Human contract.** Before work: user; goal; immediate question; primary action; decision inputs; frequency; environment; consequence; representative real content + edge cases.

**WF-4 — Representative content.** Use realistic names, values, lengths, duplicates, missing data. Placeholders hide hierarchy, HPK, truncation, localization, state failures.

**WF-5 — Earned cost.** Remove/demote elements without demonstrated user, business, legal, trust, safety, or accessibility value. Hide machine/internal concepts unless needed to identify, decide, verify, recover, audit, troubleshoot.

**WF-6 — Mode loop.**
- **Review:** inspect → classify → render or inspect supplied visuals → locate violations → prioritize → specify fixes → evidence table. No edits unless asked.
- **Design:** inspect → classify → structure → produce requested artifact → critique → revise → evidence table.
- **Implement:** inspect → classify → structure → implement → render → list visible defects → fix → rerender → interaction/accessibility checks → evidence table.

**WF-7 — Verification blocker.** If no render: inspect supplied visuals; disclose limit; never claim visual pass.

## Hierarchy, Gestalt, load

**HIER-1 — Orientation.** Surface makes relevant scope clear: where; what matters; current state; available action; meaningful next step.

**HIER-2 — Attention.** Default: one focal point, one dominant action. Peer/no dominant action allowed for comparison, authoring, monitoring, triage, terminal states.

**HIER-3 — Semantic order.** Task → decision evidence → context → details on demand. Visual weight follows semantic importance.

**HIER-4 — Signal order.** Position/grouping → shape/form → size/weight/contrast → colour.

**HIER-5 — Structural truth.** Numbering, dividers, badges, regions, labels only for real order, grouping, kind, state, navigation. No semantic-looking decoration.

**GESTALT-1 — Proximity.** Related elements closer; groups farther apart.
**GESTALT-2 — Common region.** Boundaries only when clarifying membership; spacing/alignment before cards.
**GESTALT-3 — Similarity.** Similar appearance implies similar behavior; distinguish different behavior.
**GESTALT-4 — Continuity.** Alignment creates predictable scan path.
**GESTALT-5 — Figure–ground.** Layers and active surfaces unambiguous.
**GESTALT-6 — Closure.** Partial boundaries only when grouping remains unmistakable.
**GESTALT-7 — Common fate.** Motion may reinforce existing relationship; never add motion merely to create one.

**LOAD-1 — Recognition.** Current-task content first; progressive disclosure; visible context/constraints/recent choices; controls near affected content; familiar language; consequential defaults visible. Don’t ask what can be safely inferred or force cross-screen recall.

**LOAD-2 — Appropriate density.** Complexity allowed; confusion not. Density valid for scan/compare/monitor/repeated operation.

## Colour

**COLOR-1 — Semantic role.** Colour is semantic—not categorical structure.

**COLOR-2 — Permitted meaning.** After referent, category, and membership are structurally clear, colour may carry meaning on its own—including as the primary visible cue for supplementary state—when losing that nuance cannot block understanding or action.

**COLOR-3 — Category separation.** Never colour-only category/membership. Blue vs purple is insufficient without structural distinction.

**COLOR-4 — Critical meaning.** Task-critical state/action/interpretation: perceivable non-colour cue (text, shape, pattern, position, annotation) plus programmatic semantics where applicable. Charts/maps: preserve needed distinctions via labels/patterns/shapes/position and accessible data.

**COLOR-5 — Indicator salience.** Tiny coloured dots cannot be the primary important-state cue. Adequate area, location, label/name; avoid ambiguous “small blue dot” semantics.

**COLOR-6 — Grayscale.** Structure/category and task-critical distinctions survive grayscale. Nonessential nuance may not.

## Error and recovery

**RECOVER-1 — Prevention + recovery.** Prevent before execution; recover after when feasible.

**RECOVER-2 — Undo vs confirmation.** Accessible, discoverable undo for low-risk reversible actions. Specific review/confirmation for high-impact, hard-to-reverse/detect, broad, external, financial, privacy, or trust-boundary effects.

**RECOVER-3 — Consequence clarity.** Name object, scope, consequence, committing action. No routine “Are you sure?” Highest risk may need confirmation + recovery.

## Human Primary Keys and dense data

**HPK-1 — Human identity anchor.** Machine keys serve databases; HPKs serve recognition.

**HPK-2 — Definition.** HPK = most recognizable, task-relevant label/compact attributes for this user/context. Presentation heuristic—not DB uniqueness. Add secondary identity for safe disambiguation.

**HPK-3 — Familiar codes.** Flight number, ticker, case ID, invoice, SKU may be HPK when users identify by it.

**HPK-4 — Leading identity.** HPK = leading prominent identity content in logical reading order; normally medium/bold. Utility controls may precede.

**HPK-5 — Persistence.** Keep HPK visible when horizontal scroll separates identity from values.

**HPK-6 — Field order.** Remaining fields by task priority, meaningful grouping, chronology, analytical relationship—not schema order.

**HPK-7 — Machine identity.** UUID/hash/low-value metadata later, secondary, or details/copy affordance. Preserve canonical ID for exact link/audit/API/troubleshooting.

**HPK-8 — Differentiation.** Don’t truncate the differentiating part while retaining generic prefixes.

**HPK-9 — Privacy/truth.** Viewer-appropriate identity only. Never infer/fabricate personal identity. Test duplicates, renamed/anonymous entities, localization, mixed scripts.

**HPK-10 — Table semantics.** Proper row/column headers + associations. Identity cell as row header where appropriate. Logical start/end; RTL/mixed direction; programmatic reading order.

**DATA-1 — Analytical identity.** Analytical anchor may be dimension, period, cohort, subtotal, hierarchy—not entity. Cross-tabs may need multiple headers.

**DATA-2 — Comparison integrity.** Preserve adjacent baseline/variance; grouped measures; chronology/hierarchy; numeric alignment; units; filters/scope; freshness/timezone; zero vs missing/unavailable/suppressed/estimated; sort state; totals/uncertainty/provenance.

**DATA-3 — Responsive comparison.** Reflow simple records only if relationships survive. Keep scrollable semantic table/frozen headers/alternate view when 2D comparison matters. Never silently drop columns/header relationships.

## Copy and icons

**COPY-1 — UI copy.** Clear labels; familiar domain nouns; direct result verbs; sentence case by convention. Helper text only to prevent uncertainty/error. No repetition of structure; long explanation in contextual help/docs.

**COPY-2 — State copy.** Error = what + recovery. Empty = next useful action. Success only when not obvious. Trust/consent/provenance/consequence/legal text may remain.

**COPY-3 — Necessary explanation.** Keep trust, consent, provenance, consequence, safety, and legal text when required—even without immediate action.

**COPY-4 — One job.** Label identifies; example demonstrates; helper prevents uncertainty; error directs recovery.

**COPY-5 — Vocabulary continuity.** `Publish` → publishing progress/success/error. No drift to Submit/Save/Complete.

**ICON-1 — Recognition.** Icons accelerate recognition—not merely save space.

**ICON-2 — Icon-only threshold.** Only strong platform convention/research + unambiguous context. Accessible action name; visible label when ambiguity/consequence remains. Tooltip never repairs essential unlabeled control.

**ICON-3 — Consistency.** Short label beats invented icon. Stable meaning/placement. Stateful control named by next action.

**ICON-4 — Direction/access.** Mirror by semantic direction. Hide decorative icons. Distinct silhouettes.

**ICON-5 — Discoverability.** Frequent/critical actions not buried in overflow.

## Interaction and accessibility

**A11Y-1 — Input baseline.** Design for least precise expected input; preserve semantic/programmatic access.

**TARGET-1 — Target defaults.** Current platform guidance. Apple touch ≥44×44 pt; Android ≈48×48 dp; web WCAG 2.2 SC 2.5.8 ≥24×24 CSS px or qualifying spacing; prefer ≈44×44 CSS px for important/touch-likely controls. Units not interchangeable.

**TARGET-2 — Hit regions.** Visible icon may be smaller; hit areas cannot overlap or invite neighbor activation.

**TARGET-3 — Error resistance.** Separate destructive actions from frequent benign actions.

**TARGET-4 — Equivalent route.** No essential hover, precision drag, hidden gesture without equivalent control.

**A11Y-2 — Semantics.** Landmarks, headings, labels, instructions, correct roles.

**A11Y-3 — Programmatic state.** Accessible name, role, value, state, relationships.

**A11Y-4 — Errors/status.** Fields linked to errors/instructions. Loading/error/result/completion announced without needless interruption.

**A11Y-5 — Logical order.** DOM/reading/focus order preserves meaning. Align visual/task order where sensible.

**A11Y-6 — Keyboard/focus.** Keyboard operation; visible unobscured focus; logical restoration after modal/menu/delete/navigation.

**A11Y-7 — Adaptation.** Required contrast; zoom; text resize; reflow.

**A11Y-8 — Alternatives.** Meaningful images/charts/gestures/drag have alternatives.

**A11Y-9 — Motion/time.** Respect reduced motion. Warn, extend, or recover time limits where relevant.

**A11Y-10 — Sticky regions.** Never obscure focused controls or content.

## Context deltas

**CTX-1 — Compose branches.** Apply every relevant purpose/input/presentation delta.

**SHELL-1 — Preferred dense shell.** Suitable apps: left hamburger/drawer = high-level app scope; main window = task backstack; one contextual surface = modal snap bottom sheet narrow/touch, full-height normally non-modal right sidebar wide.

**SHELL-2 — Same surface.** Sheet/sidebar share selected object, content/form state, useful scroll position, semantic relation across resize/rotation/docking/input. Never duplicate both.

**SHELL-3 — Dismissal.** Back/Escape: transient layer → previous meaningful sheet snap/closed → main backstack; stronger platform conventions win.

**SHELL-4 — State.** Opening app nav never silently destroys task/context state. Preserve per-destination backstack when resume value warrants; otherwise explicit reset.

**SHELL-5 — Modal access.** Modal sheet contains focus/navigation, labels purpose, restores focus, keeps commit reachable above gestures/keyboard.

**SHELL-6 — Sidebar access.** Desktop sidebar stays logical, non-blocking, closeable.

**SHELL-7 — Snap semantics.** Snap points = useful content states, not percentages. Collapsed identifies/predicts; expanded completes task.

**SHELL-8 — Equivalent controls.** Every drag/snap/dismiss action has non-drag route.

**SHELL-9 — Layer restraint.** Avoid nested drawers, sheets, sidebars; prefer in-surface navigation.

**SHELL-10 — Contextual default.** Not universal. Permanent sidebar/direct nav/split view may better fit comparison, accessibility, repeated expert work.

**OPS-1 — Repeated work.** Stable spatial memory, speed, predictable commands. Visible frequent actions. Dense tables/split views/bulk/sort/filter/resize/keyboard valid. HPK + task context visible. Motion = state.

**ANALYTIC-1 — Analysis.** Relationships, units, baseline, variance, scope, freshness, uncertainty. Preserve comparison/density. Direct-label charts + accessible data. No equal-weight metric-card soup.

**FORM-1 — Forms.** Meaningful sections; proper inputs/autofill; visible constraints/defaults; inline validation; retain input after errors; risk-based review. Minimize typing/arbitrary steps.

**LAND-1 — Narrative.** Concrete value + audience early; clear action hierarchy; evidence for claims; deliberate visual direction + one signature; readable body; motion never delays/obscures/ignores reduced motion.

**LAND-2 — Separation.** No landing-page theatrics in operational screens. Hybrid interactive tools still require app semantics, validation, focus, recovery.

**TOUCH-1 — Touch.** Touch-sized targets on large screens too. Consider reach, two-handed/stylus/switch, safe areas, keyboard, orientation, interruption. Frequent actions visible; minimize typing.

**POINTER-1 — Pointer/keyboard.** Width for comparison, not decorative emptiness. Hover enhancement only. Efficient tabs/shortcuts; stable layout.

**NARROW-1 — Narrow.** Strong reading path; HPK-first records; retain analytical table if 2D relationship matters; enlarged/localized text; orientation/keyboard. Don’t hide critical context just to avoid horizontal scroll.

**WIDE-1 — Wide/split.** Multi-column/master-detail/sidebar/split/persistent context when useful. Touch targets remain. Keyboard/trackpad support; no distant critical controls; non-drag alternatives.

## States and localization

**STATE-1 — Derive states.** From availability, latency, permissions, mutation, connectivity, collaboration, destructive effects, presentation. Relevant set: loading/partial; empty/first use; error/recovery; success; disabled; selected/unread/changed; permission; undo/confirmation; overflow/localization; offline/stale/concurrent; focus/zoom/reduced motion; viewport/orientation/split.

**STATE-2 — Continuity.** Preserve identity anchor, reading position, input, recovery path when data permits.

**STATE-3 — Localization/direction.** Logical start/end; language/direction metadata; RTL + semantic icon mirroring; mixed-direction isolation; expansion/plurals/non-Latin; localized collation/numbers/currency/units/calendar/date/timezone. Responsive reorder must preserve programmatic order.

## Verification

**VERIFY-1 — Rendered evidence.** Inspect during implementation + before completion. Record artifacts, viewports, inputs, states, paths checked.

**VERIFY-2 — Checks.** Orientation; hierarchy/squint; colour/grayscale; HPK; data relationships; targets; semantics/focus/keyboard/zoom/status; states/recovery; localization; reduction; competition; consistency.

**OUTPUT-1 — Completion gate.** Do not finish until requested artifact is delivered, mode loop complete, and evidence supports recognition, action, recovery. Put blockers, unresolved defects, and unverified claims in final evidence table.

## Mandatory final evidence

**OUTPUT-2 — Always.** If skill used, final response section = exactly one table below. No replacement prose.

Design/implementation—applicable rules materially followed/verified; merge rows only with identical screen/evidence:

| Rule followed | Linked screen | Feature / implementation evidence |
|---|---|---|
| `HPK-4 — Leading identity` | `[Accounts](artifacts/accounts.png)` or `/accounts — Accounts` | Name leads in bold; UUID moved to details. |

Review—every observed violation. Clean review: one `No violations found` row + reviewed scope.

| Rule violated | Linked screen | Code lines | Required fix |
|---|---|---|---|
| `COLOR-5 — Indicator salience` | `[Inbox](artifacts/inbox.png)` or `/inbox — Inbox` | [`src/InboxRow.tsx#L42-L51`](src/InboxRow.tsx#L42-L51) | Add a salient non-colour unread cue; do not rely on tiny blue dot. |

- **OUTPUT-3 — Citation:** exact ID + short name.
- **OUTPUT-4 — Screen:** real screenshot/artifact/frame/story/capture or route + view. Else `Not captured`. Never fabricate.
- **OUTPUT-5 — Code:** review uses exact repo-relative `path#Lx-Ly`. Else `Not located`. Never guess.
- **OUTPUT-6 — Specificity:** visible feature + implementation evidence; no intent/generic compliance.
- **OUTPUT-7 — Scope:** applicable rules only. Material but unchecked = `Not verified` + reason.
- **OUTPUT-8 — No echo:** unresolved/limits in table; no second compliance essay after it.
