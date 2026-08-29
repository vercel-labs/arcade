# Interface quality

Use this for implementation, material visual changes, hardening, and full reviews.

## Hierarchy and composition

- Establish hierarchy with typography, spacing, alignment, and contrast before adding containers.
- Keep the primary action visually dominant without making every action a button.
- Use a small number of intentional alignments. Avoid accidental centering, floating labels, and card grids with no information hierarchy.
- Maintain a consistent spacing rhythm and avoid arbitrary one-off values unless the composition genuinely needs them.
- Let distinctive content breathe; do not surround every region with borders, shadows, pills, or headings.

## Typography and copy

- Use the configured Geist and Geist Pixel families through shared tokens/components.
- Keep product names and commands exact. Prefer short, literal language over slogans, filler, or claims the product cannot prove.
- Write labels that describe the action or destination. Avoid redundant subtitles and eyebrow text.
- Preserve long names and messages through wrapping or truncation with an intentional recovery path.

## Color and motion

- Respect light and dark themes and established tokens. Do not solve contrast with hard-coded theme assumptions.
- Avoid gradients and decorative color unless the user explicitly asks for them or they communicate real state.
- Motion must explain movement, continuity, focus, or state. Honor reduced-motion settings and avoid animation that delays the user's next action without purpose.

## Interaction and accessibility

- Use semantic controls with visible focus and accessible names.
- Support keyboard and pointer paths for primary interactions. Touch targets should remain usable at compact sizes.
- Keep loading labels stable; expose busy state without causing layout jumps.
- Preserve user input through validation and recoverable failures.
- Draggable/resizable surfaces need clear handles, sensible bounds, keyboard-safe content, and a usable compact fallback.

## Responsive and state coverage

- Verify wide desktop, compact desktop/tablet, and narrow mobile behavior where the surface is reachable.
- Check loading, empty, sparse, populated, disabled, error, stale, and disconnected states that can actually occur.
- Test long commands, model names, translated copy risk, large values, and terminal output that exceeds the viewport.
- Do not hide essential actions merely to make a narrow screenshot look clean.

## Evidence

- Inspect the rendered result in both supported themes.
- Compare against the nearest verified surface in the same product and against the shared Geistdocs behavior where applicable.
- Treat visual references as direction, not a license to copy branding or interactions that do not fit Arcade.
