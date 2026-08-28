import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sandbox, type CommandFinished } from '@vercel/sandbox';
import {
  BASE_TIMEOUT_MS,
  TERMINAL_CWD,
  TERMINAL_TIMEOUT_MS,
  baseNetworkPolicy,
  baseSandboxName,
  hostedGatewayCredential,
  interactiveStart,
  packageSpec,
  parseTerminalSize,
  sessionNetworkPolicy,
  terminalFiles,
} from './terminal-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const size = parseTerminalSize(await request.json().catch(() => ({})));
    const source = packageSpec();
    const archive = await readFile(join(process.cwd(), 'app/api/terminal/session/arcade-package.tgz'));
    const name = baseSandboxName();
    const initialPlaceholder = randomBytes(32).toString('hex');

    const base = await Sandbox.getOrCreate({
      name,
      runtime: 'node22',
      persistent: true,
      resume: false,
      resources: { vcpus: 2 },
      timeout: BASE_TIMEOUT_MS,
      networkPolicy: baseNetworkPolicy(),
      snapshotExpiration: 30 * 24 * 60 * 60 * 1000,
      keepLastSnapshots: { count: 1, expiration: 30 * 24 * 60 * 60 * 1000 },
      tags: { application: 'arcade-site', purpose: 'terminal-base' },
      onCreate: async (sandbox) => {
        await initializeBaseSandbox(sandbox, source, initialPlaceholder, archive);
        await sandbox.snapshot();
      },
    });

    // The placeholder belongs to the reusable base image. It is deliberately
    // not the real credential; the session policy swaps it only on matching
    // requests to AI Gateway.
    const placeholderResult = await base.runCommand({
      cmd: 'cat',
      args: [`${TERMINAL_CWD}/system/gateway-placeholder`],
      sudo: true,
    });
    const placeholder = (await placeholderResult.stdout()).trim();
    if (!placeholder) throw new Error('Hosted terminal credential placeholder is missing.');

    const session = await Sandbox.fork({
      sourceSandbox: name,
      persistent: false,
      timeout: TERMINAL_TIMEOUT_MS,
      networkPolicy: sessionNetworkPolicy(placeholder, hostedGatewayCredential()),
      tags: { application: 'arcade-site', purpose: 'terminal-session' },
    });
    const interactive = await session.openInteractive();

    return Response.json({
      ...interactive,
      start: interactiveStart(size),
      expiresInMs: TERMINAL_TIMEOUT_MS,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Unable to create Arcade terminal session:', error);
    return Response.json({
      error: 'The hosted Arcade terminal is temporarily unavailable.',
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

async function initializeBaseSandbox(
  sandbox: Sandbox,
  source: string,
  placeholder: string,
  archive: Uint8Array,
): Promise<void> {
  await sandbox.writeFiles([{
    path: '/tmp/arcade-package.tgz',
    content: archive,
    mode: 0o600,
  }]);
  await assertCommand(await sandbox.runCommand({
    cmd: 'npm',
    args: ['install', '--global', '--ignore-scripts', '--omit=optional', '/tmp/arcade-package.tgz'],
    timeoutMs: 5 * 60 * 1000,
    sudo: true,
  }), 'install Arcade');
  await assertCommand(await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'ln -sf "$(npm prefix --global)/bin/arcade" /usr/local/bin/arcade && ln -sf "$(command -v node)" /usr/local/bin/node && test -x /usr/local/bin/arcade && test -x /usr/local/bin/node'],
    sudo: true,
  }), 'expose the Arcade CLI on the system path');

  await assertCommand(await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', 'id -u arcade >/dev/null 2>&1 || useradd --create-home --shell /bin/bash arcade; id -u visitor >/dev/null 2>&1 || useradd --create-home --shell /bin/bash visitor'],
    sudo: true,
  }), 'create terminal users');

  await sandbox.writeFiles(terminalFiles(source, placeholder));
  await assertCommand(await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', [
      `install -o root -g root -m 755 ${TERMINAL_CWD}/system/arcade-demo /usr/local/bin/arcade-demo`,
      `install -o visitor -g visitor -m 644 ${TERMINAL_CWD}/system/visitor.bashrc /home/visitor/.bashrc`,
      `install -o visitor -g visitor -m 644 ${TERMINAL_CWD}/system/visitor.profile /home/visitor/.profile`,
      `chown -R visitor:visitor ${TERMINAL_CWD}`,
      `chown arcade:arcade ${TERMINAL_CWD}/system/gateway-placeholder`,
      `chmod 600 ${TERMINAL_CWD}/system/gateway-placeholder`,
      `grep -qxF 'visitor ALL=(arcade) NOPASSWD: /usr/local/bin/arcade-demo, /usr/local/bin/arcade-demo *' /etc/sudoers || cat ${TERMINAL_CWD}/system/arcade-visitor-sudoers >> /etc/sudoers`,
      'chmod 440 /etc/sudoers',
      'visudo -c',
    ].join(' && ')],
    sudo: true,
  }), 'configure terminal shell');

  await assertCommand(await sandbox.runCommand({
    cmd: 'sudo',
    args: ['-u', 'visitor', '--', 'sudo', '-n', '-u', 'arcade', '--', '/usr/local/bin/arcade-demo', '--version'],
  }), 'verify the visitor can launch Arcade');
}

async function assertCommand(command: CommandFinished, label: string): Promise<void> {
  if (command.exitCode === 0) return;
  const [stderr, stdout] = await Promise.all([command.stderr(), command.stdout()]);
  throw new Error(`Failed to ${label}: ${stderr || stdout}`);
}
