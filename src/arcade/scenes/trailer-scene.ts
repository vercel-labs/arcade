import { readFileSync } from 'node:fs';
import { ARCADE_CATALOGUE } from '../../cinematic/catalogue.ts';
import { decodePng } from '../../engine/texture.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { Surface } from '../../engine/surface.ts';
import { CHESS_PIECE_NAMES, type ChessPieceName } from '../../game-visuals/chess/pieces.ts';
import { POKER_TABLE_ASSET_URLS } from '../../game-visuals/poker/table.ts';
import { cardFaceTexture } from '../games/poker/card-textures.ts';
import { asset } from '../assets.ts';
import { SOCIAL_TRAILER_SECONDS, SocialTrailerDirector } from './social-trailer.ts';
import { TrailerCreatorWisps } from './trailer-wisps.ts';

export class TrailerScene {
  private scene: SocialTrailerDirector | null = null;
  private preparation: Promise<void> | null = null;
  private failed = false;

  prepare(): Promise<void> {
    this.preparation ??= new Promise<void>((resolve, reject) => setTimeout(() => {
      try { void this.getScene().prepare().then(resolve, reject); }
      catch (error) { reject(error); }
    }, 0)).catch((error) => {
      this.failed = true;
      this.preparation = null;
      throw error;
    });
    return this.preparation;
  }

  start(): boolean {
    if (this.failed || !this.scene) return false;
    this.scene.reset();
    return true;
  }

  step(seconds: number): void { this.getScene().step(seconds); }
  seek(seconds: number): void { this.getScene().seek(seconds); }
  done(): boolean { return this.getScene().done(); }
  progress(): number { return this.getScene().progress(); }

  frame(cols: number, rows: number): Surface { return this.getScene().frame(cols, rows); }

  private getScene(): SocialTrailerDirector { return this.scene ??= this.createScene(); }

  private createScene(): SocialTrailerDirector {
    return new SocialTrailerDirector({
      chess: {
        chessPieceAssetUrls: Object.fromEntries(CHESS_PIECE_NAMES.map((name) => [name, asset(`chess_blender/${name}.obj`)])) as Record<ChessPieceName, string>,
        chessPieceFetchText: async (path) => readFileSync(path, 'utf8'),
        wispRenderer: new TrailerCreatorWisps(0xc4e55, { anthropic: 0, openai: 1.7 }),
      },
      poker: {
        fetchTableText: async (url) => readFileSync(url === POKER_TABLE_ASSET_URLS.table ? asset('poker/poker-table.obj') : asset('poker/chair.obj'), 'utf8'),
        wispRenderer: new TrailerCreatorWisps(0x50fa7, { xai: 0, openai: 1.3, anthropic: 2.6, google: 3.9, deepseek: 5.2 }),
        faceTexture: cardFaceTexture,
      },
      covers: trailerCoverTextures(),
    });
  }
}

export { SOCIAL_TRAILER_SECONDS };

export function trailerCoverTextures(): Record<typeof ARCADE_CATALOGUE[number]['id'], Texture> {
  return Object.fromEntries(ARCADE_CATALOGUE.map(({ id }) => [id, decodePng(readFileSync(asset(`games/${id}.png`)))])) as Record<typeof ARCADE_CATALOGUE[number]['id'], Texture>;
}
