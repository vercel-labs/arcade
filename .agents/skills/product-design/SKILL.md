---
name: product-design
description: Shape, implement, review, copy-edit, or harden Arcade user interfaces. Use for the website, terminal UI, game HUDs, interaction flows, responsive behavior, accessibility, Geist consistency, and any change affecting what a user sees, understands, chooses, or does. Skip backend-only, telemetry-only, generated-file, and test-only work with no shipped UI impact.
---

# Arcade product design

Make the interface correct for the user's job and recognizably Arcade. Working code is not enough: preserve the product's terminal identity, choose the right interaction, make scope and consequences clear, cover reachable states, and verify the rendered surface.

## Resolve the request mode

- **Shape:** compare meaningful alternatives and define the flow, states, acceptance criteria, risks, and open decisions. Do not edit unless asked.
- **Implement:** resolve material decisions, then build the smallest coherent end-to-end change within scope.
- **Review:** inspect source and rendered evidence, then report prioritized findings. Do not edit unless asked.
- **Copy:** change user-facing language, labels, and directly required markup without silently redesigning the surface.
- **Harden:** preserve the settled direction while fixing responsive, accessibility, state, resilience, and finish defects.

Use the narrowest mode supported by the user's verb. A screenshot, URL, or component identifies scope; it does not by itself authorize unrelated edits.

## Operating contract

1. Identify the user, job, product object, current behavior, desired outcome, success signal, and explicit non-goals.
2. Treat existing code and screenshots as evidence, not automatic precedent. Prefer repository guidance, established APIs, and verified adjacent patterns.
3. Resolve information architecture, component semantics, interaction, and reachable states before decorative styling or copy.
4. Preserve the user's chosen direction. Do not replace distinctive Arcade identity with a generic dashboard, fake terminal, or decorative novelty.
5. Choose the smallest coherent intervention. Reuse the renderer, TUI, package entry points, Geistdocs shell, and shared components before duplicating behavior.
6. Verify the real surface at compact and wide sizes. Source inspection proves behavior; rendered output proves visual quality.

## Load focused references

- For a material product or interaction decision, read [references/product-judgment.md](references/product-judgment.md).
- For implementation, visual changes, hardening, or full review, read [references/interface-quality.md](references/interface-quality.md).
- For `apps/site`, the hero, docs, examples, or the hosted terminal, also read [references/arcade-site.md](references/arcade-site.md), `apps/site/AGENTS.md`, and `apps/site/README.md`.
- For terminal-rendered Arcade surfaces, read the root `AGENTS.md` and `docs/verifying-output.md`; use the snapshot workflow rather than running the infinite TTY app raw.

Read only the references needed for the current mode and surface.

## Decision authority

Resolve conflicts in this order:

1. The user's explicit goal and constraints.
2. Verified product behavior and user evidence.
3. Repository `AGENTS.md` files, public package boundaries, and canonical component APIs.
4. Accepted local design decisions and verified adjacent Arcade patterns.
5. General interface heuristics.

Separate verified facts, design decisions, assumptions, and open questions. Do not turn one screenshot or preference into a universal rule.

## Verification

For shipped UI changes:

1. Exercise the primary path and every newly reachable state.
2. Check keyboard focus, pointer behavior, loading/busy behavior, reduced motion, and recoverable errors when relevant.
3. Test constrained width, long model names/content, large values, and both supported color schemes.
4. Render or open the actual interface and inspect it. Do not claim visual verification from code alone.
5. Run focused tests, type checking, and repository checks proportional to the change.

## Review output

Lead with findings ordered by user impact:

- **P0:** blocks the primary task or risks unrecoverable harm.
- **P1:** likely task failure, misleading behavior, missing critical state, or major accessibility/responsive failure.
- **P2:** meaningful friction, inconsistency, weak hierarchy, or recoverability issue.
- **P3:** minor craft or consistency improvement.

For each finding, give the rendered location or file, verification status, user consequence, and smallest concrete fix.
