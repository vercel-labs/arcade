# Contributing to Arcade

Thanks for helping improve Arcade. Focused bug reports, reproductions,
documentation fixes, tests, and pull requests are welcome.

## Development

Arcade requires Node.js 22 or newer and pnpm 10.34.5.

```bash
pnpm install
pnpm type-check
pnpm test
pnpm smoke:package
```

Arcade is a full-screen TTY application. Do not judge its visual output from
raw `pnpm dev` output. Follow `docs/verifying-output.md` and attach a focused
snapshot when a change affects rendering or interaction.

## Pull requests

- Keep each change focused and explain the user-visible or API effect.
- Add or update tests for behavior changes.
- Preserve the one-way library import boundaries documented in
  `docs/architecture/package-boundaries.md`.
- Run the relevant checks and report exactly what was verified.
- Do not commit credentials, private prompts, model reasoning, customer data,
  or generated match traces.

## Contributions and assets

By submitting a contribution, you represent that you have the right to submit
it and agree that it may be licensed under the repository's MIT License.

Do not add downloaded images, fonts, audio, 3D models, copied code, or generated
media without recording the creator, source URL, license, and modifications in
`NOTICE.md`. Include required license text under `LICENSES/`. Company and model
logos must be official marks used only for identification.

## Security

Do not report vulnerabilities or expose credentials in a public issue. Follow
the [security policy](.github/SECURITY.md) instead.
