import { cameraMatrices } from '../engine/camera.ts';
import { islandersCinematicCamera, pokerCinematicCamera, type CinematicOrbitCamera } from '../cinematic/camera.ts';
import { ISLANDERS_SETUP_END, islandersCinematicGameplay, islandersSetupCoastProgress, islandersSetupHarborProgress, islandersSetupTileProgress } from '../cinematic/islanders-choreography.ts';
import { POKER_CINEMATIC_HANDS, pokerLoopState } from '../cinematic/scripted-games.ts';
import type { RGB } from '../engine/color.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { feltMaterial, lambertMaterial, waterMaterial } from '../engine/materials.ts';
import { mat4Multiply, mat4RotX, mat4RotY, mat4RotZ, mat4Scale, mat4Translate, normalize3, type Mat4 } from '../engine/math.ts';
import { type Mesh } from '../engine/mesh.ts';
import { shapeGlyphLayerToSurface, shapeGlyphToSurface, ShapeGlyphSurfaceCache } from '../engine/present-cells.ts';
import { rasterize } from '../engine/raster.ts';
import { Surface } from '../engine/surface.ts';
import { AnimatedTileMeshCache, animatedTileMesh, boardHarborPoses, boardOverlayMesh, coastMesh, harborPiersMesh, ISLANDERS_TILE_PLACE_HOP, ISLANDERS_TILE_STACK_BASE_Y, ISLANDERS_TILE_STACK_THICKNESS, ISLANDERS_TILE_STACK_X, ISLANDERS_TILE_STACK_Z, islandersWaterMesh, drawIslandersDiceOverlay, EDGE_ENDS, hexWorld, NODE_XZ, portMesh, robberFlightPoint, robberMesh, tileBackMesh, tileMesh, type Die } from '../game-visuals/islanders/index.ts';
import { CARD_SCALE, POKER_CARD_LIFT, POKER_CHIP_AWARD_HOP, POKER_CHIP_POT_POSITION, POKER_DEAL_HOP, POKER_DECK_FULL, POKER_DECK_POSITION, POKER_DECK_THICKNESS, POKER_FELT_STIPPLE, POKER_TABLE_AMBIENT, POKER_TABLE_ASCII_CONTRAST, POKER_TABLE_LIGHT, POKER_WOOD_BROWN, TABLE_MODEL, DeckShuffle, chairModel, createPokerGatherCard, createPokerMuckCards, drawCard, drawChipStack, drawPeekCard, fetchPokerTableMeshes, flatDown, flatUp, mergeChipColumns, playerColumns, pokerBetCenter, pokerBoardCardPose, pokerCardBackTexture, pokerChipFlight, pokerGatherCardPose, pokerHoleCardPose, pokerMuckCardPose, pokerSeatAngle, pokerStackCenter, preparePokerCardTextures, takeChipColumns, type ChipColumn, type PokerGatherCard, type PokerMuckCard, type PokerTableMeshes } from '../game-visuals/poker/index.ts';
import { HEX_COORDS } from '../rules/islanders/board-topology.ts';
import { generateBoard } from '../rules/islanders/setup.ts';
import type { BoardSetup } from '../rules/islanders/setup.ts';
import { mulberry32 } from '../engine/random.ts';
import { parseCard, RANK_LABELS, type Card } from '../rules/poker/cards.ts';
import { BrowserCreatorWisps } from './browser-wisp.ts';
import type { CinematicCreator } from './browser-wisp.ts';
import type { Texture } from '../engine/texture-data.ts';

const BLACK: RGB = [0, 0, 0];
const RED: RGB = [196, 54, 62];
const BLUE: RGB = [78, 145, 242];
const ORANGE: RGB = [231, 132, 54];
const LIGHT = normalize3({ x: -0.45, y: 0.9, z: 0.36 });

interface PokerHandAssets {
  boardCards: readonly Card[];
  seatCards: readonly (readonly [Card, Card])[];
  muckCards: readonly (PokerMuckCard & { seat: number })[];
  gatherCards: readonly PokerGatherCard[];
}

function createPokerHandAssets(script: typeof POKER_CINEMATIC_HANDS[number], handIndex: number, seatCount: number): PokerHandAssets {
  const boardCards = script.board.map(mustCard);
  const seatCards = script.seats.map(([a, b]) => [mustCard(a), mustCard(b)] as const);
  const rng = mulberry32(0x1053e + handIndex * 997);
  const muckCards = script.foldSeats.flatMap((seat, foldIndex) => createPokerMuckCards(seatCards[seat], seat, seatCount, foldIndex * 2, rng).map((card) => ({ ...card, seat })));
  const gatherCards: PokerGatherCard[] = [];
  const push = (card: Card, x: number, z: number, yaw: number, faceUp: boolean) => gatherCards.push(createPokerGatherCard(card, x, z, yaw, faceUp, gatherCards.length));
  for (let seat = 0; seat < seatCount; seat++) {
    if (script.foldSeats.includes(seat)) continue;
    for (let round = 0; round < 2; round++) {
      const pose = pokerHoleCardPose(seat, round, seatCount);
      push(seatCards[seat][round], pose.x, pose.z, pose.yaw, true);
    }
  }
  for (let index = 0; index < boardCards.length; index++) {
    const pose = pokerBoardCardPose(index);
    push(boardCards[index], pose.x, pose.z, 0, true);
  }
  for (const muck of muckCards) push(muck.card, muck.toX, muck.toZ, muck.yaw, false);
  return { boardCards, seatCards, muckCards, gatherCards };
}

export class BrowserPokerCinematic {
  private readonly glyphCache = new ShapeGlyphSurfaceCache();
  private readonly target = new RenderTarget(1, 1);
  private readonly shuffle = new DeckShuffle(pokerCardBackTexture(), POKER_DECK_POSITION);
  private table: PokerTableMeshes | null = null;
  private preparation: Promise<void> | null = null;
  private readonly hands: readonly PokerHandAssets[];
  private readonly wisps: BrowserCreatorWisps;
  private readonly creators = ['xai', 'openai', 'anthropic', 'google', 'deepseek'] as const;
  private readonly seatCount = 5;

  private readonly fetchTableText?: (url: string) => Promise<string>;
  private readonly rasterScale: number;

  constructor(options: { table?: PokerTableMeshes; fetchTableText?: (url: string) => Promise<string>; wispTextures?: Partial<Record<CinematicCreator, Texture>>; rasterScale?: number } = {}) {
    this.table = options.table ?? null;
    this.fetchTableText = options.fetchTableText;
    this.wisps = new BrowserCreatorWisps(options.wispTextures);
    this.rasterScale = options.rasterScale ?? 3;
    this.hands = POKER_CINEMATIC_HANDS.map((script, handIndex) => createPokerHandAssets(script, handIndex, this.seatCount));
  }

  prepare(): Promise<void> {
    this.preparation ??= Promise.all([
      this.table ? Promise.resolve() : fetchPokerTableMeshes(this.fetchTableText).then((meshes) => { this.table = meshes; }),
      this.wisps.prepare(this.creators),
      preparePokerCardTextures(),
    ]).then(() => undefined);
    return this.preparation;
  }


  frame(cols: number, rows: number, cameraProgress: number, timeSeconds: number, gameplayPhase = cameraProgress, gameplayIteration = 0): Surface {
    const p = clamp01(cameraProgress);
    const hand = pokerLoopState(gameplayPhase, gameplayIteration);
    const assets = this.hands[hand.handIndex];
    const target = this.target;
    target.resize(cols * this.rasterScale, rows * this.rasterScale * 2);
    target.clear();
    const camera = pokerCinematicCamera(p, target.width / target.height);
    const vp = cameraMatrices(camera, target.width / target.height).viewProjection;
    const draw = (mesh: Mesh, model: Mat4, color: RGB, ambient = 0.35) => rasterize(target, tintCached(mesh, color), lambertMaterial, {
      mvp: mat4Multiply(vp, model), model, lightDir: POKER_TABLE_LIGHT, ambient,
    });

    if (this.table) {
      const wood: RGB = [POKER_WOOD_BROWN.x, POKER_WOOD_BROWN.y, POKER_WOOD_BROWN.z];
      draw(this.table.frame, TABLE_MODEL, wood, POKER_TABLE_AMBIENT);
      rasterize(target, this.table.felt, feltMaterial, { mvp: mat4Multiply(vp, TABLE_MODEL), model: TABLE_MODEL, lightDir: POKER_TABLE_LIGHT, ambient: POKER_TABLE_AMBIENT, ...POKER_FELT_STIPPLE });
      for (let i = 0; i < this.seatCount; i++) draw(this.table.chair, chairModel((i / this.seatCount) * Math.PI * 2), wood, POKER_TABLE_AMBIENT);
    }
    const chipStacks = Array.from({ length: this.seatCount }, () => playerColumns(1000));
    const betStacks: Array<{ seat: number; columns: ChipColumn[]; travel: number }> = [];
    for (const bet of hand.bets) {
      const moved = takeChipColumns(chipStacks[bet.seat], bet.amount);
      chipStacks[bet.seat] = moved.remaining;
      betStacks.push({ seat: bet.seat, columns: moved.pushed, travel: bet.travel });
    }
    const potColumns = mergeChipColumns(...betStacks.map(({ columns }) => columns));
    if (hand.award >= 1) chipStacks[hand.winnerSeat] = mergeChipColumns(chipStacks[hand.winnerSeat], potColumns);
    for (let seat = 0; seat < this.seatCount; seat++) {
      const angle = pokerSeatAngle(seat, this.seatCount);
      const radial = { x: Math.sin(angle), z: Math.cos(angle) };
      const columns = chipStacks[seat];
      drawChipStack(target, vp, pokerStackCenter(seat, this.seatCount, columns), radial, columns, LIGHT, 0.36, seat);
    }

    if (hand.shuffle < 1) {
      this.shuffle.setClock(hand.shuffle * this.shuffle.loop * hand.shuffleCycles);
      this.shuffle.draw(target, vp);
    } else if (hand.deckTurn < 1) {
      this.shuffle.setClock(this.shuffle.loop - 1e-6);
      this.shuffle.draw(target, vp, (1 - hand.deckTurn) * Math.PI / 2);
    }
    const dealtCards = Math.min(10, Math.floor(hand.deal * 11));
    const boardCount = (hand.flop > 0 ? Math.min(3, Math.ceil(hand.flop * 3)) : 0) + (hand.turn > 0 ? 1 : 0) + (hand.river > 0 ? 1 : 0);
    const stockCount = Math.max(18, POKER_DECK_FULL - dealtCards - boardCount);
    if (hand.deckTurn >= 1) drawCardStock(target, vp, stockCount);
    const gathering = hand.gatherElapsed !== null;
    for (let seat = 0; seat < this.seatCount; seat++) {
      for (let round = 0; round < 2; round++) {
        const order = round * this.seatCount + seat;
        const progress = smoothstep(clamp01(hand.deal * 10.8 - order));
        // During a scripted look, the production bent card becomes the sole
        // representation of that card; never leave a flat duplicate underneath.
        if (gathering) continue;
        if ((hand.seatPeeks[seat]?.[round] ?? 0) > 0) continue;
        if (hand.foldedSeats.includes(seat)) continue;
        drawSeatDeal(target, vp, assets.seatCards[seat][round], pokerHoleCardPose(seat, round, this.seatCount), progress, stockCount, hand.showdown > 0);
      }
    }
    if (!gathering) {
      for (let seat = 0; seat < this.seatCount; seat++) for (let round = 0; round < 2; round++) {
        const reveal = hand.seatPeeks[seat]?.[round] ?? 0;
        if (reveal <= 0 || hand.foldedSeats.includes(seat)) continue;
        const pose = pokerHoleCardPose(seat, round, this.seatCount);
        drawPeekCard(target, vp, { seatX: pose.x, seatZ: pose.z, reveal, peek: 0.45, restAz: pose.yaw, az: pose.yaw }, assets.seatCards[seat][round], pokerCardBackTexture(), 1.08);
      }
    }
    const boardProgress = [hand.flop, hand.flop, hand.flop, hand.turn, hand.river];
    for (let i = 0; i < assets.boardCards.length && !gathering; i++) {
      const cardP = i < 3 ? smoothstep(clamp01(hand.flop * 1.35 - i * 0.16)) : boardProgress[i];
      drawCommunityDeal(target, vp, assets.boardCards[i], pokerBoardCardPose(i), cardP, stockCount);
    }
    if (!gathering) {
      for (const fold of hand.folds) {
        for (const muck of assets.muckCards.filter((card) => card.seat === fold.seat)) {
          const pose = pokerMuckCardPose(muck, fold.progress);
          drawCard(target, vp, mat4Multiply(mat4Translate(pose.x, pose.y, pose.z), mat4Multiply(mat4RotY(pose.yaw), flatDown())), muck.card, pokerCardBackTexture(), 1);
        }
      }
    } else {
      const baseTopY = deckTopY(stockCount);
      for (let index = 0; index < assets.gatherCards.length; index++) {
        const card = assets.gatherCards[index];
        const pose = pokerGatherCardPose(card, index, hand.gatherElapsed!, baseTopY);
        drawCard(target, vp, mat4Multiply(mat4Translate(pose.x, pose.y, pose.z), mat4Multiply(mat4RotY(pose.yaw), mat4Multiply(mat4RotX(pose.rx ?? Math.PI / 2), CARD_SCALE))), card.card, pokerCardBackTexture(), 1);
      }
    }
    if (hand.award > 0 && hand.award < 1 && potColumns.length) {
      const destination = pokerStackCenter(hand.winnerSeat, this.seatCount, mergeChipColumns(chipStacks[hand.winnerSeat], potColumns));
      const at = pokerChipFlight(POKER_CHIP_POT_POSITION, destination, hand.award, POKER_CHIP_AWARD_HOP);
      drawChipStack(target, vp, at, { x: 1, z: 0 }, potColumns, LIGHT, 0.4, 300, at.lift);
    } else if (hand.collect >= 1 && potColumns.length) {
      drawChipStack(target, vp, POKER_CHIP_POT_POSITION, { x: 1, z: 0 }, potColumns, LIGHT, 0.4, 900);
    } else {
      for (const bet of betStacks) {
        const angle = pokerSeatAngle(bet.seat, this.seatCount);
        const from = pokerStackCenter(bet.seat, this.seatCount, mergeChipColumns(chipStacks[bet.seat], bet.columns));
        const front = pokerBetCenter(bet.seat, this.seatCount, bet.columns, 20 + bet.seat, boardCount);
        const placed = pokerChipFlight(from, front, bet.travel);
        const at = hand.collect > 0 ? pokerChipFlight(front, POKER_CHIP_POT_POSITION, hand.collect) : placed;
        drawChipStack(target, vp, at, { x: Math.cos(angle), z: -Math.sin(angle) }, bet.columns, LIGHT, 0.4, 20 + bet.seat);
      }
    }
    // Production seat convention: seat 0 starts at +z, then proceeds clockwise.
    // Each creator wisp shares its chair's exact polar angle and outer radius.
    for (let seat = 0; seat < this.creators.length; seat++) {
      const angle = pokerSeatAngle(seat, this.seatCount);
      const radius = 5.57 + 0.4;
      this.wisps.draw(target, vp, camera, this.creators[seat], {
        x: Math.sin(angle) * radius, y: 2.2, z: Math.cos(angle) * radius,
      }, timeSeconds, seat * 1.3, 0.72);
    }
    const surface = present(target, cols, rows, this.glyphCache);
    return surface;
  }
}

export class BrowserIslandersCinematic {
  private readonly glyphCache = new ShapeGlyphSurfaceCache();
  private readonly target = new RenderTarget(1, 1);
  private readonly diceTarget = new RenderTarget(1, 1);
  private readonly board = generateBoard(mulberry32(1));
  private readonly harbors = boardHarborPoses(this.board.harbors);
  private readonly brickHarbor = (() => {
    const harbor = this.harbors.find(({ kind }) => kind === 'brick') ?? this.harbors[0];
    return { x: harbor.model[12], z: harbor.model[14] };
  })();
  private readonly water = islandersWaterMesh();
  private readonly animatedTileCache = new AnimatedTileMeshCache();
  private readonly dice: [Die, Die] = [
    { val: 4, spinX: 2.4, spinZ: 1.8, yaw: 0.28, yawSpin: 1.7, jx: -0.08, jz: 0.06, wob: 0.22, dur: 0.96 },
    { val: 5, spinX: 1.9, spinZ: 2.6, yaw: -0.36, yawSpin: 2.1, jx: 0.1, jz: -0.04, wob: 0.18, dur: 1.04 },
  ];
  private readonly order = Array.from({ length: HEX_COORDS.length }, (_, i) => i).sort((a, b) => {
    const A = HEX_COORDS[a], B = HEX_COORDS[b];
    const ar = (Math.abs(A.q) + Math.abs(A.r) + Math.abs(A.q + A.r)) / 2;
    const br = (Math.abs(B.q) + Math.abs(B.r) + Math.abs(B.q + B.r)) / 2;
    if (ar !== br) return ar - br;
    const aw = hexWorld(A.q, A.r), bw = hexWorld(B.q, B.r);
    return Math.atan2(aw.z, aw.x) - Math.atan2(bw.z, bw.x);
  });

  constructor(
    private readonly cameraFor: (progress: number, aspect: number, brickHarbor: { x: number; z: number }) => CinematicOrbitCamera = islandersCinematicCamera,
    private readonly rasterScale = 3,
  ) {}

  frame(cols: number, rows: number, progress: number, timeSeconds: number, gameplayElapsed = timeSeconds): Surface {
    const p = clamp01(progress);
    const gameplay = islandersCinematicGameplay(gameplayElapsed);
    const target = this.target;
    target.resize(cols * this.rasterScale, rows * this.rasterScale * 2);
    target.clear();
    const camera = this.cameraFor(p, target.width / target.height, this.brickHarbor);
    const focus = camera.target;
    const vp = cameraMatrices(camera, target.width / target.height).viewProjection;
    const draw = (mesh: Mesh, model: Mat4, color?: RGB, ambient = 0.36) => rasterize(target, color ? tintCached(mesh, color) : mesh, lambertMaterial, {
      mvp: mat4Multiply(vp, model), model, lightDir: LIGHT, ambient, wrap: 0.25,
    });
    const robber = gameplay.robber;
    const resolvedRobberHex = (hex: number): number => hex < 0 ? this.board.robberHex : hex;
    const settledRobberHex = robber?.progress === 1 ? resolvedRobberHex(robber.to) : this.board.robberHex;

    // Production staging: establish the sea first, then deal/flip the real seeded
    // board center-out. Nothing else is allowed onto the island during setup.
    rasterize(target, this.water, waterMaterial, {
      mvp: vp, model: identity(), time: timeSeconds, cameraPos: camera.eye,
      sunDirection: normalize3({ x: 0.42, y: 0.86, z: 0.5 }),
      deepColor: { x: 10, y: 58, z: 88 }, surfaceColor: { x: 28, y: 139, z: 177 },
      skyColor: { x: 112, y: 174, z: 194 }, horizonColor: { x: 218, y: 199, z: 158 },
      currentColor: { x: 196, y: 239, z: 235 }, flowSpeed: 0.22,
    });
    for (let oi = 0; oi < this.order.length; oi++) {
      const hex = this.order[oi];
      const { q, r } = HEX_COORDS[hex];
      const dest = hexWorld(q, r);
      const reveal = smoothstep(islandersSetupTileProgress(gameplay.setupElapsed, oi));
      const source = { x: ISLANDERS_TILE_STACK_X, y: ISLANDERS_TILE_STACK_BASE_Y + (18 - oi) * ISLANDERS_TILE_STACK_THICKNESS, z: ISLANDERS_TILE_STACK_Z };
      const x = lerp(source.x, dest.x, reveal), z = lerp(source.z, dest.z, reveal);
      const y = lerp(source.y, 0, reveal) + Math.sin(reveal * Math.PI) * ISLANDERS_TILE_PLACE_HOP;
      const flip = Math.PI * (1 - smoothstep(clamp01(reveal / 0.8)));
      const model = mat4Multiply(mat4Translate(x, y, z), mat4RotX(flip));
      const terrain = this.board.hexes[hex].terrain;
      const robberOn = !robber || robber.progress >= 1 ? hex === settledRobberHex : false;
      draw(flip > Math.PI / 2 ? tileBackMesh() : tileMesh(terrain, 19 + hex, robberOn), model, undefined, 0.52);
      if (reveal > 0.98) {
        const animated = animatedTileMesh(terrain, 19 + hex, timeSeconds, dest, this.animatedTileCache);
        if (animated) draw(animated, mat4Translate(dest.x, 0, dest.z), undefined, 0.54);
      }
    }

    // Connector endpoints are authored against the production beach apron,
    // which extends beyond the narrower tile slab. Grow that same shoreline
    // after the tiles settle and before the ships arrive, matching the CLI.
    const coastProgress = islandersSetupCoastProgress(gameplay.setupElapsed);
    if (coastProgress > 0) draw(coastMesh(coastProgress), identity(), undefined, 0.72);

    // Only after every tile has landed do all nine rules-derived harbor ships
    // approach their real coastal slots; no arbitrary ports are stamped on land.
    for (let i = 0; i < this.harbors.length; i++) {
      const progress = islandersSetupHarborProgress(gameplay.setupElapsed, i);
      if (progress <= 0) continue;
      const bridgeProgress = smoothstep(clamp01((progress - 0.62) / 0.38));
      if (bridgeProgress > 0) draw(harborPiersMesh([this.harbors[i].connector], bridgeProgress), identity(), undefined, 0.62);
      draw(portMesh(this.harbors[i].kind, 31 + i), interpolateMatrix(this.harbors[i].startModel, this.harbors[i].model, progress), undefined, 0.62);
    }

    // Gameplay accumulates around the terrain studies without covering their
    // focal hexes. Every piece uses the production board overlay geometry.
    const buildingMap = new Map<number, { x: number; z: number; city: boolean; color: typeof gameplay.placements[number]['color']; hot: false; lift: number }>();
    for (const beat of gameplay.placements) {
      if (beat.action.type !== 'initialSettlement' && beat.action.type !== 'buildSettlement' && beat.action.type !== 'buildCity') continue;
      const drop = beat.progress;
      if (drop <= 0) continue;
      const position = NODE_XZ[beat.action.node];
      buildingMap.set(beat.action.node, {
        x: position.x, z: position.z, city: beat.action.type === 'buildCity', color: beat.color, hot: false,
        lift: (1 - drop) * 1.25,
      });
    }
    const buildings = [...buildingMap.values()];
    const roadMap = new Map<number, { x0: number; z0: number; x1: number; z1: number; color: typeof gameplay.placements[number]['color']; hot: false; lift: number }>();
    for (const beat of gameplay.placements) {
      if (beat.action.type !== 'initialRoad' && beat.action.type !== 'buildRoad') continue;
      const drop = beat.progress;
      if (drop > 0) roadMap.set(beat.action.edge, { ...EDGE_ENDS[beat.action.edge], color: beat.color, hot: false, lift: (1 - drop) * 1.1 });
    }
    const roads = [...roadMap.values()];
    const overlay = boardOverlayMesh({
      buildings,
      roads,
      ghostSettlement: null, ghostRoad: null, hoverColor: [230, 150, 145],
    });
    if (buildings.length || roads.length) draw(overlay, identity(), undefined, 0.56);
    // Dice are screen-space foreground: settlements and roads must never paint
    // over them, even when a build drop overlaps their viewport rectangle.
    if (robber && robber.progress < 1) {
      const fromHex = resolvedRobberHex(robber.from), toHex = resolvedRobberHex(robber.to);
      const fromCoord = HEX_COORDS[fromHex], toCoord = HEX_COORDS[toHex];
      const from = hexWorld(fromCoord.q, fromCoord.r), to = hexWorld(toCoord.q, toCoord.r);
      const at = robberFlightPoint(from, to, robber.progress);
      const terrain = this.board.hexes[fromHex].terrain;
      draw(robberMesh(terrain, 19 + fromHex), mat4Translate(at.x, at.y, at.z), undefined, 0.58);
    }
    const diceTarget = this.diceTarget;
    diceTarget.resize(target.width, target.height);
    diceTarget.clear();
    if (gameplay.dice) {
      for (let index = 0; index < 2; index++) this.dice[index].val = gameplay.dice.values[index];
      drawIslandersDiceOverlay(diceTarget, this.dice, gameplay.dice.elapsed, gameplay.dice.rolling, {
        burnProgress: gameplay.dice.burn,
        scale: islandersPortraitDiceScale(target.width / target.height),
      });
    }
    const surface = presentIslandersAscii(target, cols, rows, this.glyphCache);
    if (gameplay.dice) paintIslandersDiceLayer(surface, diceTarget, cols, rows);
    return surface;
  }
}

/** Keep desktop/landscape dice unchanged while fitting the pair to narrow phones. */
export function islandersPortraitDiceScale(aspect: number): number {
  if (aspect >= 0.8) return 1;
  const t = clamp01((aspect - 0.45) / 0.35);
  return 0.78 + 0.22 * t * t * (3 - 2 * t);
}


function drawCommunityDeal(target: RenderTarget, vp: Mat4, card: Card, destination: { x: number; z: number }, progress: number, stockCount: number): void {
  if (progress <= 0) return;
  const p = smoothstep(progress);
  const x = lerp(POKER_DECK_POSITION.x, destination.x, p);
  const z = lerp(POKER_DECK_POSITION.z, destination.z, p);
  const y = lerp(deckTopY(stockCount), POKER_CARD_LIFT, p) + Math.sin(p * Math.PI) * POKER_DEAL_HOP;
  const rx = Math.PI / 2 - Math.PI * p;
  drawCard(target, vp, mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotX(rx), CARD_SCALE)), card, pokerCardBackTexture(), 1);
}

function drawSeatDeal(target: RenderTarget, vp: Mat4, card: Card, destination: { x: number; z: number; yaw: number }, progress: number, stockCount: number, faceUp = false): void {
  if (progress <= 0) return;
  const p = smoothstep(progress);
  const y = lerp(deckTopY(stockCount), POKER_CARD_LIFT, p) + Math.sin(p * Math.PI) * POKER_DEAL_HOP;
  const model = mat4Multiply(
    mat4Translate(lerp(POKER_DECK_POSITION.x, destination.x, p), y, lerp(POKER_DECK_POSITION.z, destination.z, p)),
    mat4Multiply(mat4RotY(destination.yaw * p), faceUp ? flatUp() : flatDown()),
  );
  drawCard(target, vp, model, card, pokerCardBackTexture(), 1);
}

function drawCardStock(target: RenderTarget, vp: Mat4, count: number): void {
  const back = pokerCardBackTexture();
  const card: Card = { rank: 0, suit: 0 };
  for (let index = Math.max(0, count - 1); index >= 0; index--) {
    drawCard(target, vp, mat4Multiply(mat4Translate(POKER_DECK_POSITION.x, POKER_CARD_LIFT + index * POKER_DECK_THICKNESS, POKER_DECK_POSITION.z), flatDown()), card, back, 1);
  }
}

function deckTopY(count: number): number { return count * POKER_DECK_THICKNESS + POKER_CARD_LIFT; }

type Draw = (mesh: Mesh, model: Mat4, color: RGB, ambient?: number) => void;

function present(target: RenderTarget, cols: number, rows: number, cache?: ShapeGlyphSurfaceCache): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, BLACK);
  // Wisps are additive screen-space light and intentionally do not write depth.
  // Cropping to opaque mesh depth bounds cuts their flame caps along a flat
  // internal line, so Poker must present the complete color target.
  shapeGlyphToSurface(surface, target, cols, rows, { color: true, contrast: POKER_TABLE_ASCII_CONTRAST, hybrid: false, coloredBackground: false }, 0, 0, cache);
  return surface;
}

function presentIslandersAscii(target: RenderTarget, cols: number, rows: number, glyphCache?: ShapeGlyphSurfaceCache): Surface {
  const surface = new Surface(cols, rows);
  surface.fillRect(0, 0, cols, rows, BLACK);
  shapeGlyphToSurface(surface, target, cols, rows, {
    color: true,
    contrast: 2.15,
    hybrid: false,
    coloredBackground: false,
    blankOutsideDepthBounds: true,
  }, 0, 0, glyphCache);
  return surface;
}

function paintIslandersDiceLayer(surface: Surface, target: RenderTarget, cols: number, rows: number): void {
  shapeGlyphLayerToSurface(surface, target, cols, rows, {
    color: true,
    contrast: 2.15,
    hybrid: false,
    coloredBackground: false,
  });
}

function identity(): Mat4 { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function interpolateMatrix(from: Mat4, to: Mat4, progress: number): Mat4 {
  return from.map((value, index) => lerp(value, to[index], progress));
}

function mustCard(label: string): Card { const card=parseCard(label); if(!card) throw new Error(`Invalid cinematic card ${label}`); return card; }


function tint(mesh: Mesh, color: RGB): Mesh {
  return { indices: mesh.indices, vertices: mesh.vertices.map((vertex) => ({ ...vertex, color: { x: color[0], y: color[1], z: color[2] } })) };
}

const TINTED_MESHES = new WeakMap<Mesh, Map<string, Mesh>>();
function tintCached(mesh: Mesh, color: RGB): Mesh {
  const key = `${color[0]},${color[1]},${color[2]}`;
  let variants = TINTED_MESHES.get(mesh);
  if (!variants) { variants = new Map(); TINTED_MESHES.set(mesh, variants); }
  let result = variants.get(key);
  if (!result) { result = tint(mesh, color); variants.set(key, result); }
  return result;
}

function transformMesh(mesh: Mesh, matrix: Mat4): Mesh {
  // These tiny showcase meshes only need translated/scaled positions; normals from
  // flatShade remain coherent for the axis-aligned transforms used here.
  const m = matrix;
  return { indices: mesh.indices, vertices: mesh.vertices.map((vertex) => {
    const p = vertex.position;
    return { ...vertex, position: { x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12], y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13], z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14] } };
  }) };
}

function mergeMeshes(meshes: Mesh[]): Mesh {
  const vertices: Mesh['vertices'] = [];
  const indices: number[] = [];
  for (const mesh of meshes) { const offset = vertices.length; vertices.push(...mesh.vertices); indices.push(...mesh.indices.map((index) => index + offset)); }
  return { vertices, indices };
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(value: number): number { return value * value * (3 - 2 * value); }
