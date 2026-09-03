import { readFileSync } from 'node:fs';
import { ARCADE_CATALOGUE } from '../../cinematic/catalogue.ts';
import { bakeMarkAlpha } from '../../engine/logo-mark.ts';
import { decodePng } from '../../engine/texture.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { Surface } from '../../engine/surface.ts';
import { CHESS_PIECE_NAMES, type ChessPieceName } from '../../game-visuals/chess/pieces.ts';
import { POKER_TABLE_ASSET_URLS } from '../../game-visuals/poker/table.ts';
import type { CinematicCreator } from '../../web/browser-wisp.ts';
import { asset } from '../assets.ts';
import { Box, Button, type Node } from '../../tui/index.ts';
import { MENU_BUTTON_LABEL, UI_CHROME_PILL } from '../theme.ts';
import { SOCIAL_TRAILER_SECONDS, SocialTrailerDirector } from './social-trailer.ts';

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
        wispTextures: trailerWispTextures(),
      },
      poker: {
        fetchTableText: async (url) => readFileSync(url === POKER_TABLE_ASSET_URLS.table ? asset('poker/poker-table.obj') : asset('poker/chair.obj'), 'utf8'),
        wispTextures: trailerWispTextures(),
      },
      covers: trailerCoverTextures(),
    });
  }
}

export { SOCIAL_TRAILER_SECONDS };

export function trailerCoverTextures(): Record<typeof ARCADE_CATALOGUE[number]['id'], Texture> {
  return Object.fromEntries(ARCADE_CATALOGUE.map(({ id }) => [id, decodePng(readFileSync(asset(`games/${id}.png`)))])) as Record<typeof ARCADE_CATALOGUE[number]['id'], Texture>;
}

export function trailerWispTextures(): Record<CinematicCreator, Texture> {
  const logos: Record<CinematicCreator, string> = {
    xai: 'xai', openai: 'openai', anthropic: 'claude', google: 'google', deepseek: 'deepseek',
  };
  return Object.fromEntries(Object.entries(logos).map(([creator, name]) => [creator, bakeMarkAlpha(decodePng(readFileSync(asset(`logos/${name}.png`))))])) as Record<CinematicCreator, Texture>;
}

export function buildTrailerOverlay(cols: number, rows: number, onMenu: () => void): Node {
  return Box({ width: cols, height: rows }, [
    Box({ position: 'absolute', top: 1, right: 2 }, [
      Button({ id: 'trailer-menu-button', label: MENU_BUTTON_LABEL, onClick: onMenu, style: UI_CHROME_PILL }),
    ]),
  ]);
}
