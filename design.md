# Arcade design guidance

Arcade follows Vercel's public [`design.md`](https://vercel.com/design.md) as its
brand and interface baseline. Read the canonical document before designing,
implementing, or reviewing a user-facing Arcade surface.

The canonical guidance is maintained by Vercel and explains how agents should
use Geist typography, Vercel's monochrome visual system, shared grids,
intentional hierarchy, restrained surfaces, accessible interaction, responsive
layouts, and evidence-based visual review. Its companion article is
[`How our agents build on-brand pages with design.md`](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md).

The homepage cinematic's approved title and subtitle system is documented in
[`docs/site-wording-justification.md`](docs/site-wording-justification.md). Read
it before changing the chapter wording, ordering, or scene associations.

## Arcade-specific interpretation

The Vercel baseline does not make Arcade a generic product page. Preserve the
identity established by the product and its renderer:

- The cinematic, terminal-cell composition, ASCII imagery, prism, ink cuts,
  wisps, and game-specific color are product evidence, not ornamental effects.
- Geist Pixel may be used for the Arcade wordmark and short, page-defining
  display headlines. Geist Sans owns prose, navigation, descriptions, and
  ordinary controls. Geist Mono owns commands, code, paths, terminal output,
  and compact operational identifiers.
- Prefer one continuous black canvas, strong alignment, and open space. Add a
  border, panel, blur, gradient, or shadow only when it clarifies interaction,
  state, readability, or a real content boundary.
- Reuse installed Geistdocs components and semantic tokens when they fit the
  interaction. Do not force a stock component when it weakens the cinematic or
  terminal experience; preserve its semantics and interaction quality in any
  page-owned treatment.
- Keep product claims direct and defensible. Let the rendered experience prove
  the technical ambition. Do not add generic marketing filler, decorative
  eyebrows, repeated calls to action, or redundant navigation.
- Treat desktop, mobile, reduced-motion, keyboard, pointer, and terminal-hosted
  states as one product. Verify the actual rendered surface at representative
  sizes rather than approving design from source alone.

## Precedence

Apply guidance in this order:

1. The user's explicit request and settled design decisions.
2. Repository and directory-specific `AGENTS.md` instructions.
3. Arcade's `.agents/skills/product-design/SKILL.md` and its focused references.
4. This Arcade interpretation.
5. The canonical Vercel `design.md` baseline.

When two sources appear to conflict, preserve factual correctness,
accessibility, established product behavior, and Arcade's distinctive identity.
Raise a material unresolved product decision instead of silently choosing a
generic pattern.
