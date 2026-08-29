# Product judgment

Use this reference before making a material change to a user's task, default, scope, consequence, navigation, interaction surface, or reachable states.

## Compact brief

Write down, internally, the minimum facts needed to decide:

- **User:** who is acting and what context they already have.
- **Job:** what they are trying to accomplish.
- **Object:** the exact game, command, document, setting, or resource affected.
- **Current behavior:** what happens now, including the concrete failure or friction.
- **Desired outcome:** what should become easier, clearer, or possible.
- **Success signal:** what observable result proves the change worked.
- **Non-goals:** what is deliberately not being redesigned.
- **Scope and consequence:** what changes, for whom, and whether it is reversible.
- **Reality:** permissions, latency, loading, failure, empty, sparse, long-content, and responsive states the product can actually enter.
- **Open decisions:** choices that materially change the result and cannot be inferred safely.

## Choosing a surface

- Keep one unmistakable primary task and primary action.
- Use navigation for navigation and actions for mutations.
- Match persistence to importance: durable controls remain visible; incidental detail can be disclosed inline.
- Prefer direct behavior and strong defaults before adding configuration.
- Prefer inline disclosure before a modal. Use a modal only when focus, consequence, or interruption genuinely requires it.
- Preserve context through transitions. A terminal, game, or document should not appear to reset merely because presentation changes.
- Name the exact object, scope, and consequence for important actions.

## Arcade-specific judgment

- The native terminal application is the product, not a visual motif. Browser surfaces should host or explain the real package where practical, not recreate a second imitation renderer.
- The site may combine conventional web typography with terminal-native visual output, but the hierarchy should remain minimal and legible.
- Distinctiveness should come from actual Arcade rendering, interaction, and typography—not gradients, ornamental copy, excessive chrome, or fake operating-system metaphors.
- Keep reusable engine/TUI/game logic outside `apps/site`; site code should import public boundaries and own only browser hosting, documentation, and surrounding presentation.
