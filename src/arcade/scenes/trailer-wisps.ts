import type { Camera } from '../../engine/camera.ts';
import type { RenderTarget } from '../../engine/framebuffer.ts';
import { cross3, normalize3, sub3, type Mat4, type Vec3 } from '../../engine/math.ts';
import { mulberry32 } from '../../engine/random.ts';
import { cinematicWispVisible, type CinematicCreator, type CinematicWispRenderer } from '../../cinematic/wisp-renderer.ts';
import { loadCreatorWisp, type Wisp } from './wisp.ts';

export class TrailerCreatorWisps implements CinematicWispRenderer {
  private readonly wisps = new Map<CinematicCreator, Wisp>();
  private rng: () => number;
  private preparedCreators: CinematicCreator[] = [];
  private simulationTick = 0;

  constructor(
    private readonly seed: number,
    private readonly phases: Partial<Record<CinematicCreator, number>>,
  ) {
    this.rng = mulberry32(seed);
  }

  prepare(creators: readonly CinematicCreator[]): Promise<void> {
    for (const creator of creators) if (!this.preparedCreators.includes(creator)) this.preparedCreators.push(creator);
    for (const [index, creator] of this.preparedCreators.entries()) {
      if (!this.wisps.has(creator)) this.wisps.set(creator, loadCreatorWisp(creator, this.phases[creator] ?? index * 1.3, this.rng));
    }
    return Promise.resolve();
  }

  reset(): void {
    this.wisps.clear();
    this.simulationTick = 0;
    this.rng = mulberry32(this.seed);
    for (const [index, creator] of this.preparedCreators.entries()) {
      this.wisps.set(creator, loadCreatorWisp(creator, this.phases[creator] ?? index * 1.3, this.rng));
    }
  }

  draw(target: RenderTarget, vp: Mat4, camera: Camera, creator: CinematicCreator, anchor: Vec3, time: number, phase: number, scale = 1): void {
    this.advanceTo(time);
    if (!cinematicWispVisible(vp, anchor, scale)) return;
    let wisp = this.wisps.get(creator);
    if (!wisp) {
      wisp = loadCreatorWisp(creator, phase, this.rng);
      this.wisps.set(creator, wisp);
    }
    const forward = normalize3(sub3(camera.target, camera.eye));
    const right = normalize3(cross3(forward, camera.up));
    const up = cross3(right, forward);
    wisp.setSpeaking(false);
    wisp.renderWorld(target, vp, right, up, anchor, target.width, target.height, time, 0, scale, false);
  }

  private advanceTo(time: number): void {
    const targetTick = Math.max(0, Math.floor(time * 30));
    if (targetTick < this.simulationTick) this.reset();
    while (this.simulationTick < targetTick) {
      this.simulationTick++;
      const tickTime = this.simulationTick / 30;
      for (const creator of this.preparedCreators) this.wisps.get(creator)?.advance(tickTime, 1 / 30);
    }
  }
}
