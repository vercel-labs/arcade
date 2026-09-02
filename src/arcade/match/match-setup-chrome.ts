import { Box, RoundedButton, Text, type LayoutBox, type Node } from '../../tui/index.ts';
import { ARCADE_CHROME_TEXT, ARCADE_OUTLINE_CONTROL } from '../theme.ts';

export const MATCH_START_READY: [number, number, number] = [120, 205, 142];
export const MATCH_START_DISABLED: [number, number, number] = [110, 114, 126];

export function matchSetupHeading(): Node {
  return Text({ text: 'new match', style: { color: ARCADE_CHROME_TEXT.title, bold: true } });
}

export function newMatchButton(id: string, onClick: () => void, disabled = false): Node {
  return RoundedButton({
    id,
    label: 'new match',
    onClick,
    disabled,
    color: disabled ? MATCH_START_DISABLED : ARCADE_OUTLINE_CONTROL.neutralText,
    borderColor: disabled ? MATCH_START_DISABLED : ARCADE_OUTLINE_CONTROL.neutralBorder,
    style: disabled ? { disabled: { color: MATCH_START_DISABLED, borderColor: MATCH_START_DISABLED } } : undefined,
  });
}

export function startMatchButton(id: string, onClick: (() => void) | undefined): Node {
  return RoundedButton({
    id,
    label: 'start',
    onClick,
    disabled: !onClick,
    color: onClick ? MATCH_START_READY : MATCH_START_DISABLED,
    style: onClick ? undefined : { disabled: { color: MATCH_START_DISABLED, borderColor: MATCH_START_DISABLED } },
  });
}

export function cancelMatchButton(id: string, onClick: (() => void) | undefined): Node {
  return RoundedButton({
    id,
    label: 'cancel',
    onClick,
    color: ARCADE_OUTLINE_CONTROL.neutralText,
    borderColor: ARCADE_OUTLINE_CONTROL.neutralBorder,
  });
}

export function matchSetupLayout(region: LayoutBox, panel: Node, actions: Node[]): Node {
  return Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 2] }, [panel]),
    Box({ flexGrow: 1 }),
    Box({ flexDirection: 'row', justifyContent: 'start', gap: 2, padding: [0, 0, 1, 2] }, actions),
  ]);
}
