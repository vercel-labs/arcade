import type { Texture } from '../../../engine/index.ts';
import { DeckShuffle as SharedDeckShuffle } from '../../../game-visuals/poker/deck-shuffle.ts';
import { cardFaceTexture } from './card-textures.ts';

export class DeckShuffle extends SharedDeckShuffle {
  constructor(back: Texture, center: { x: number; z: number }) { super(back, center, cardFaceTexture); }
}
