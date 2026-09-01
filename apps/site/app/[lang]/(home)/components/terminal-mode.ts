export type HostedTerminalMode = 'shell' | 'arcade';
export const ARCADE_MODE_MARKER = '__ARCADE_HOST_MODE_1__';
export const SHELL_MODE_MARKER = '__ARCADE_HOST_MODE_0__';

/**
 * Tracks the PTY's real alternate-screen state. Arcade enters 1049 when it owns
 * the terminal and leaves it on exit; the shell remains on the primary screen.
 * A short carry handles control sequences split across WebSocket messages.
 */
export class TerminalModeDetector {
  private carry = '';
  private current: HostedTerminalMode = 'shell';

  mode(): HostedTerminalMode { return this.current; }

  push(output: string): HostedTerminalMode {
    const text = this.carry + output;
    const hosted = /\x1b\]777;arcade=([01])(?:\x07|\x1b\\)/g;
    let hostedMatch: RegExpExecArray | null;
    while ((hostedMatch = hosted.exec(text))) this.current = hostedMatch[1] === '1' ? 'arcade' : 'shell';
    // Alternate-screen is the primary lifecycle signal. Mouse tracking is an
    // equivalent Arcade/raw-mode signal and survives PTY/WebSocket adapters
    // that may consume the alternate-screen switch before forwarding output.
    const pattern = /\x1b\[\?(?:47|1003|1006|1047|1049)([hl])/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) this.current = match[1] === 'h' ? 'arcade' : 'shell';
    this.carry = text.slice(-16);
    return this.current;
  }
}

/** Removes hosted wrapper markers from a potentially chunked PTY stream. */
export class TerminalModeOutputFilter {
  private carry = '';
  private current: HostedTerminalMode = 'shell';
  mode(): HostedTerminalMode { return this.current; }
  push(output: string): { mode: HostedTerminalMode; output: string } {
    let text = this.carry + output;
    this.carry = '';
    for (;;) {
      const arcade = text.indexOf(ARCADE_MODE_MARKER);
      const shell = text.indexOf(SHELL_MODE_MARKER);
      const index = arcade < 0 ? shell : shell < 0 ? arcade : Math.min(arcade, shell);
      if (index < 0) break;
      const marker = index === arcade ? ARCADE_MODE_MARKER : SHELL_MODE_MARKER;
      this.current = marker === ARCADE_MODE_MARKER ? 'arcade' : 'shell';
      text = text.slice(0, index) + text.slice(index + marker.length);
    }
    let suffix = 0;
    for (let length = 1; length < ARCADE_MODE_MARKER.length; length++) {
      const candidate = text.slice(-length);
      if ([ARCADE_MODE_MARKER, SHELL_MODE_MARKER].some((marker) => marker.startsWith(candidate))) suffix = length;
    }
    if (suffix) { this.carry = text.slice(-suffix); text = text.slice(0, -suffix); }
    return { mode: this.current, output: text };
  }
}

export function terminalFontSize(viewportWidth: number, coarsePointer = false): number {
  if (viewportWidth <= 390) return 9;
  if (coarsePointer || viewportWidth <= 640) return 10;
  return 12;
}
