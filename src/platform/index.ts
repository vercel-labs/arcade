export { createInputParser, type Handlers, type KeyEvent, type MouseEvent } from './input.ts';
export {
  detectTerminalColorMode,
  environmentAdvertisesTruecolor,
  parseTruecolorProbeResponse,
  probeTerminalTruecolor,
  type DetectTerminalColorOptions,
  type DetectedTerminalColorMode,
} from './terminal-color-detection.ts';
export { enter as enterTerminal, leave as leaveTerminal } from './terminal.ts';

