// A centered modal overlay: a full-screen scrim that dims the scene behind it,
// with the content panel centered on top. The scrim is a translucent background
// — under the unified renderer it alpha-composites over the scene (a real dim);
// on the legacy overlay path it would render as a flat fill, so this is meant
// for the unified path.
//
// First real consumer of the alpha (Phase 2) + absolute/center layout (Phase 4)
// capability that was otherwise dormant.

import { Box } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Node } from '../types.ts';

// Dark, ~55% opaque — enough to push the scene back without hiding it.
const DEFAULT_SCRIM: ColorToken = [6, 8, 12, 0.55];

export interface ModalOpts {
  scrim?: ColorToken;
  onDismiss?: () => void;
}

export function Modal(content: Node, opts: ModalOpts = {}): Node {
  const dismiss = opts.onDismiss;
  if (!dismiss) return Box({ justifyContent: 'center', alignItems: 'center', scrim: opts.scrim ?? DEFAULT_SCRIM }, [content]);

  // The content root absorbs blank-space clicks within the card. Interactive
  // descendants still win hit-testing because they are painted later.
  const contentMouse = content.onMouse;
  const guardedContent: Node = {
    ...content,
    onMouse: (ev) => {
      contentMouse?.(ev);
      return true;
    },
  };
  const modal: Node = Box({ justifyContent: 'center', alignItems: 'center', scrim: opts.scrim ?? DEFAULT_SCRIM }, [guardedContent]);
  modal.onMouse = (ev) => {
    if (ev.type === 'down') dismiss();
    return true;
  };
  return modal;
}
