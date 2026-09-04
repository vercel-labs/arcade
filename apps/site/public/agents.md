# Working with Arcade as an agent

## When this guidance applies

Use these instructions when modifying Arcade source, importing its browser-safe modules, rendering snapshots, or running telemetry-disabled match-lab tests. If you only want to play the browser demo, use the controls on the home page instead. Arcade does not expose a remote endpoint for agents to play games on a user's behalf.

1. Read `/llms.txt`, then the specific `/docs/*` page for the layer you will change.
2. Preserve the import direction: `arcade` may consume libraries; libraries must not import `arcade`.
3. Render visual output with snapshot tooling rather than starting the infinite raw-mode TTY.
4. Prefer existing materials, components, commands, and examples over one-off replicas.
5. Keep browser imports on explicit browser-safe package subpaths.
6. Never read or expose credentials. Keep telemetry disabled for local self-play unless the user explicitly asks otherwise.
7. Validate with focused tests, `pnpm test`, `pnpm type-check`, and `git diff --check`.

Useful commands:

```bash
pnpm snapshot:png 140 50 0.7
ARCADE_TELEMETRY=0 pnpm match:run -- --help
pnpm models:game-audit -- --help
pnpm test
pnpm type-check
```

The site's existing HTTP surfaces are described at `/openapi.json`.
Use `/api/v1/status` to inspect the public capability boundary before assuming a remote action exists.
