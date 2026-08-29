import type { NetworkPolicy } from '@vercel/sandbox';

export const TERMINAL_CWD = '/vercel/sandbox/arcade';
export const TERMINAL_TIMEOUT_MS = 20 * 60 * 1000;
export const BASE_TIMEOUT_MS = 10 * 60 * 1000;
export const TERMINAL_BASE_VERSION = 12;
export const GATEWAY_HOST = 'ai-gateway.vercel.sh';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface HostedGatewayCredential {
  token: string;
  authMethod: 'api-key' | 'oidc';
}

export function parseTerminalSize(value: unknown): TerminalSize {
  const candidate = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  return {
    cols: clampInteger(candidate.cols, 48, 240, 100),
    rows: clampInteger(candidate.rows, 24, 100, 48),
  };
}

export function packageRevision(env: NodeJS.ProcessEnv = process.env): string {
  return env.ARCADE_TERMINAL_PACKAGE_REVISION?.trim()
    || env.VERCEL_GIT_COMMIT_SHA?.trim()
    || 'main';
}

export function packageSpec(env: NodeJS.ProcessEnv = process.env): string {
  return env.ARCADE_TERMINAL_PACKAGE_SPEC?.trim()
    || `@vercel/arcade#${packageRevision(env)}`;
}

export function baseSandboxName(env: NodeJS.ProcessEnv = process.env): string {
  const revision = packageRevision(env).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12) || 'main';
  return `arcade-web-base-v${TERMINAL_BASE_VERSION}-${revision}`;
}

export function hostedGatewayCredential(env: NodeJS.ProcessEnv = process.env): HostedGatewayCredential | null {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (apiKey) return { token: apiKey, authMethod: 'api-key' };
  const oidc = env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc) return { token: oidc, authMethod: 'oidc' };
  return null;
}

export function baseNetworkPolicy(): NetworkPolicy {
  return {
    allow: [
      'registry.npmjs.org',
      '*.npmjs.org',
    ],
  };
}

export function sessionNetworkPolicy(
  placeholder: string,
  credential: HostedGatewayCredential | null,
): NetworkPolicy {
  if (!credential) return 'deny-all';
  return {
    allow: {
      [GATEWAY_HOST]: [{
        match: {
          headers: [{
            key: { exact: 'authorization' },
            value: { exact: `Bearer ${placeholder}` },
          }],
        },
        transform: [{
          headers: {
            authorization: `Bearer ${credential.token}`,
            'ai-gateway-auth-method': credential.authMethod,
          },
        }],
      }],
    },
  };
}

export function terminalFiles(packageSource: string, placeholder: string): Array<{
  path: string;
  content: string;
  mode?: number;
}> {
  return [
    {
      path: `${TERMINAL_CWD}/README.md`,
      content: `# Arcade terminal\n\nThis is an isolated Linux shell containing the real Arcade CLI.\n\nStart it:\n\n    arcade\n\nExplore this miniature documentation filesystem:\n\n    ls\n    cd docs\n    cat README.md\n    cd ../examples\n    cat README.md\n\nThe session is temporary. Telemetry is disabled.\n`,
    },
    {
      path: `${TERMINAL_CWD}/docs/README.md`,
      content: `# Documentation\n\n- engine.md — CPU 3D renderer, scenes, cameras, materials, and output modes\n- tui.md — retained terminal UI, layout, focus, input, and Surface compositing\n- games.md — Chess, Poker, Catan, rules, and presentation layers\n- agents.md — model harness, tools, communication, self-play, and traces\n\nThe complete documentation is available on the website at /docs.\n`,
    },
    {
      path: `${TERMINAL_CWD}/docs/engine.md`,
      content: `# Engine\n\nArcade's engine is a pure-TypeScript CPU renderer. It owns geometry, transforms, cameras, materials, lighting, picking, rasterization, and the ASCII, pixel, and hybrid presenters. It has no dependency on the Arcade application.\n\nPackage import:\n\n    import { Camera, Mesh, RenderTarget } from '@vercel/arcade/engine';\n`,
    },
    {
      path: `${TERMINAL_CWD}/docs/tui.md`,
      content: `# TUI\n\nThe retained TUI library lays out components, handles focus and pointer input, and paints into a terminal Surface. The same Surface is used by the CLI, snapshots, and browser terminal transport.\n\nPackage import:\n\n    import { Box, Button, Screen } from '@vercel/arcade/tui';\n`,
    },
    {
      path: `${TERMINAL_CWD}/docs/games.md`,
      content: `# Games\n\nArcade currently includes Chess, Poker, and Catan. Rules and legal actions live below presentation. Game-specific scenes and HUDs consume the shared engine and TUI libraries.\n\nRun the application with:\n\n    arcade\n`,
    },
    {
      path: `${TERMINAL_CWD}/docs/agents.md`,
      content: `# Agents\n\nThe game harness gives models legal actions, player-safe context, communication policy, and persistent local traces. Match Lab can run bounded or complete self-play games with telemetry disabled by default.\n\nExamples in a checkout:\n\n    pnpm match:run --help\n    pnpm models:game-audit --help\n`,
    },
    {
      path: `${TERMINAL_CWD}/examples/README.md`,
      content: `# Examples\n\n- rendering.md — package-level renderer imports\n- self-play.md — Match Lab and model compatibility tools\n- prism.md — standalone ANSI stream\n\nInteractive visual examples are available on the website at /examples.\n`,
    },
    {
      path: `${TERMINAL_CWD}/examples/rendering.md`,
      content: `# Rendering example\n\n    import { Camera, Mesh, RenderTarget } from '@vercel/arcade/engine';\n    import { CanvasSurfaceHost } from '@vercel/arcade/web';\n\nCreate the scene with engine primitives, paint it into a Surface, and select the host appropriate to the environment.\n`,
    },
    {
      path: `${TERMINAL_CWD}/examples/self-play.md`,
      content: `# Self-play example\n\nMatch Lab runs Chess, Poker, or Catan with persistent local artifacts and telemetry disabled. Runs contain manifests, intermediate state, actions, model attempts, and final summaries.\n`,
    },
    {
      path: `${TERMINAL_CWD}/examples/prism.md`,
      content: `# Prism stream\n\nThe standalone prism deploy streams ANSI frames generated from the same CPU renderer:\n\n    curl ascii-prisms.vercel.app\n`,
    },
    {
      path: `${TERMINAL_CWD}/system/arcade-package.txt`,
      content: `${packageSource}\n`,
    },
    {
      path: `${TERMINAL_CWD}/system/gateway-placeholder`,
      content: `${placeholder}\n`,
      mode: 0o600,
    },
    {
      path: `${TERMINAL_CWD}/system/arcade-demo`,
      content: `#!/bin/sh\nset -eu\nexport HOME=/home/arcade\nexport PATH=/usr/local/bin:/usr/bin:/bin\nexport ARCADE_HOSTED_TERMINAL=1\nexport ARCADE_TELEMETRY=0\nexport AI_GATEWAY_API_KEY="$(cat ${TERMINAL_CWD}/system/gateway-placeholder)"\nexec /usr/local/bin/arcade "$@"\n`,
      mode: 0o755,
    },
    {
      path: `${TERMINAL_CWD}/system/visitor.bashrc`,
      content: `export PATH="/usr/local/bin:/usr/bin:/bin"\nexport PS1='arcade \\w $ '\nexport PAGER=cat\nfunction arcade() { sudo -n -u arcade -- /usr/local/bin/arcade-demo "$@"; }\nfunction arcade_help() {\n  printf '\\033[1mArcade terminal\\033[0m\\n\\n'\n  printf '  \\033[36marcade\\033[0m             Start Arcade\\n'\n  printf '  \\033[36mhelp\\033[0m               Show this guide\\n'\n  printf '  \\033[36mls\\033[0m                 List files\\n'\n  printf '  \\033[36mcd docs\\033[0m            Browse documentation\\n'\n  printf '  \\033[36mcd examples\\033[0m        Browse examples\\n'\n  printf '  \\033[36mcat README.md\\033[0m      Read the current directory\\n'\n  printf '  \\033[36marcade --version\\033[0m   Show the installed version\\n\\n'\n  printf '\\033[2mThis session is temporary. Telemetry is disabled.\\033[0m\\n'\n}\nfunction help() { arcade_help; }\ncd ${TERMINAL_CWD}\nclear\narcade_help\nprintf '\\n'\n`,
    },
    {
      path: `${TERMINAL_CWD}/system/visitor.profile`,
      content: `if [ -f ~/.bashrc ]; then . ~/.bashrc; fi\n`,
    },
    {
      path: `${TERMINAL_CWD}/system/arcade-visitor-sudoers`,
      content: `visitor ALL=(arcade) NOPASSWD: /usr/local/bin/arcade-demo, /usr/local/bin/arcade-demo *\n`,
      mode: 0o440,
    },
  ];
}

export function interactiveStart(size: TerminalSize) {
  return {
    command: '/usr/bin/sudo',
    args: ['-iu', 'visitor', 'env', 'TERM=xterm-256color', 'COLORTERM=truecolor', '/bin/bash', '-li'],
    env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
    cwd: TERMINAL_CWD,
    cols: size.cols,
    rows: size.rows,
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
