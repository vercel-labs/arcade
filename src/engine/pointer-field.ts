export interface PointerFieldInput { x: number; y: number; active?: boolean }
export interface PointerTrailSample { id: number; x: number; y: number; vx: number; vy: number; age: number; strength: number }
export interface PointerBurstParticle { id: number; x: number; y: number; vx: number; vy: number; age: number; lifetime: number }
export interface PointerFieldSnapshot {
  x: number; y: number; rawX: number; rawY: number; vx: number; vy: number; speed: number; strength: number;
  trail: readonly PointerTrailSample[];
  bursts: readonly PointerBurstParticle[];
}
export interface PointerFieldOptions {
  response?: number; velocityResponse?: number; idleDelay?: number; fadeRate?: number;
  trailLifetime?: number; trailSpacing?: number; maxTrail?: number;
}

/** Input-agnostic, normalized pointer physics shared by browser and terminal hosts. */
export class PointerField {
  private readonly response: number;
  private readonly velocityResponse: number;
  private readonly idleDelay: number;
  private readonly fadeRate: number;
  private readonly trailLifetime: number;
  private readonly trailSpacing: number;
  private readonly maxTrail: number;
  private targetX = 0.5;
  private targetY = 0.5;
  private x = 0.5;
  private y = 0.5;
  private vx = 0;
  private vy = 0;
  private strength = 0;
  private active = false;
  private idleFor = Infinity;
  private trail: PointerTrailSample[] = [];
  private bursts: PointerBurstParticle[] = [];
  private nextTrailId = 1;
  private lastTrailX = 0.5;
  private lastTrailY = 0.5;

  constructor(options: PointerFieldOptions = {}) {
    this.response = options.response ?? 18;
    this.velocityResponse = options.velocityResponse ?? 14;
    this.idleDelay = options.idleDelay ?? 0.85;
    this.fadeRate = options.fadeRate ?? 4.5;
    this.trailLifetime = options.trailLifetime ?? 0.42;
    this.trailSpacing = options.trailSpacing ?? 0.018;
    this.maxTrail = options.maxTrail ?? 12;
  }

  setInput(input: PointerFieldInput): void {
    this.targetX = clamp01(input.x);
    this.targetY = clamp01(input.y);
    this.active = input.active ?? true;
    this.idleFor = 0;
    // The visual head is event-driven and should be visible on this input,
    // without waiting for a subsequent animation frame to ramp strength.
    this.strength = Math.max(this.strength, 0.85);
  }

  /** Start an independent stroke without emitting from the prior release point. */
  beginStroke(input: PointerFieldInput): void {
    const x = clamp01(input.x), y = clamp01(input.y);
    this.targetX = x;
    this.targetY = y;
    this.x = x;
    this.y = y;
    this.lastTrailX = x;
    this.lastTrailY = y;
    this.vx = 0;
    this.vy = 0;
    this.active = input.active ?? true;
    this.idleFor = 0;
    this.strength = Math.max(this.strength, 0.85);
  }

  release(): void { this.active = false; }

  /** Inject a loose, expanding triangular smoke ring. */
  burst(x = this.targetX, y = this.targetY, count = 80): void {
    const cx = clamp01(x), cy = clamp01(y);
    const total = Math.max(1, Math.min(120, Math.floor(count)));
    const burstId = this.nextTrailId;
    const rotation = hash(burstId, 11) * Math.PI * 2;
    const vertices = Array.from({ length: 3 }, (_, corner) => {
      const angle = rotation - Math.PI / 2 + corner * Math.PI * 2 / 3;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });
    for (let index = 0; index < total; index++) {
      const id = this.nextTrailId++;
      // Walk the three edges instead of sampling radial angles. A little warped
      // edge progress and normal/tangent noise keeps the outline smoky rather
      // than reading as a perfect stamped icon.
      const perimeter = ((index + hash(id, 17) * 0.72) / total) * 3;
      const edge = Math.floor(perimeter) % 3;
      const edgeT = perimeter - Math.floor(perimeter);
      const a = vertices[edge], b = vertices[(edge + 1) % 3];
      let dx = a.x + (b.x - a.x) * edgeT;
      let dy = a.y + (b.y - a.y) * edgeT;
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length, ny = dy / length;
      const tx = -ny, ty = nx;
      const normalNoise = (hash(id, 31) - 0.5) * 0.3;
      const tangentNoise = (hash(id, 37) - 0.5) * 0.18;
      dx += nx * normalNoise + tx * tangentNoise;
      dy += ny * normalNoise + ty * tangentNoise;
      const speed = 0.16 + hash(id, 41) * 0.14;
      const initial = 0.009 + hash(id, 43) * 0.006;
      this.bursts.push({
        id,
        x: clamp01(cx + dx * initial),
        y: clamp01(cy + dy * initial),
        vx: dx * speed,
        vy: dy * speed - 0.018 - hash(id, 47) * 0.012,
        age: 0,
        lifetime: 0.72 + hash(id, 73) * 0.58,
      });
    }
  }

  step(dt: number): PointerFieldSnapshot {
    const elapsed = Math.max(0, Math.min(0.1, dt));
    if (elapsed > 0) {
      const oldX = this.x, oldY = this.y;
      const positionBlend = 1 - Math.exp(-this.response * elapsed);
      this.x += (this.targetX - this.x) * positionBlend;
      this.y += (this.targetY - this.y) * positionBlend;
      const rawVx = (this.x - oldX) / elapsed, rawVy = (this.y - oldY) / elapsed;
      const velocityBlend = 1 - Math.exp(-this.velocityResponse * elapsed);
      this.vx += (rawVx - this.vx) * velocityBlend;
      this.vy += (rawVy - this.vy) * velocityBlend;
      this.idleFor += elapsed;
      const targetStrength = this.active && this.idleFor <= this.idleDelay ? 1 : 0;
      this.strength += (targetStrength - this.strength) * (1 - Math.exp(-this.fadeRate * elapsed));
      const moved = Math.hypot(this.x - this.lastTrailX, this.y - this.lastTrailY);
      if (this.active && moved >= this.trailSpacing) {
        const fromX = this.lastTrailX, fromY = this.lastTrailY;
        // Emit along distance travelled, not merely once per rendered frame.
        // This keeps fast strokes volumetric instead of leaving sparse beads.
        const emissions = Math.min(10, Math.max(1, Math.floor(moved / this.trailSpacing)));
        const energy = Math.min(1, 0.18 + Math.hypot(this.vx, this.vy) * 0.22);
        for (let index = 1; index <= emissions; index++) {
          const t = index / emissions;
          this.trail.unshift({
            id: this.nextTrailId++,
            x: fromX + (this.x - fromX) * t,
            y: fromY + (this.y - fromY) * t,
            vx: this.vx,
            vy: this.vy,
            age: 0,
            strength: energy,
          });
        }
        this.lastTrailX = this.x; this.lastTrailY = this.y;
        if (this.trail.length > this.maxTrail) this.trail.length = this.maxTrail;
      }
      this.trail = this.trail
        .map((sample) => ({ ...sample, age: sample.age + elapsed }))
        .filter((sample) => sample.age < this.trailLifetime);
      this.bursts = this.bursts.flatMap((particle) => {
        const age = particle.age + elapsed;
        if (age >= particle.lifetime) return [];
        const drag = Math.pow(0.978 + hash(particle.id, 89) * 0.014, elapsed * 60);
        const curl = (hash(particle.id, 97) - 0.5) * elapsed * 0.45;
        const vx = (particle.vx - particle.vy * curl) * drag;
        const vy = (particle.vy + particle.vx * curl - 0.008 * elapsed) * drag;
        return [{ ...particle, x: particle.x + vx * elapsed, y: particle.y + vy * elapsed, vx, vy, age }];
      });
    }
    return this.snapshot();
  }

  snapshot(): PointerFieldSnapshot {
    return { x: this.x, y: this.y, rawX: this.targetX, rawY: this.targetY, vx: this.vx, vy: this.vy, speed: Math.hypot(this.vx, this.vy), strength: this.strength, trail: this.trail, bursts: this.bursts };
  }
}

export function samplePointerField(snapshot: PointerFieldSnapshot, x: number, y: number, radius = 0.14): { influence: number; rim: number; directionX: number; directionY: number } {
  const dx = x - snapshot.x, dy = y - snapshot.y;
  const distance = Math.hypot(dx, dy), safe = distance || 1;
  const normalized = distance / Math.max(1e-5, radius);
  const influence = smoothstep(1 - normalized) * snapshot.strength;
  const rim = Math.max(0, 1 - Math.abs(normalized - 0.82) / 0.22) * snapshot.strength;
  return { influence, rim, directionX: dx / safe, directionY: dy / safe };
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function hash(x:number,y:number):number{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n)}
