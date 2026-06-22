import { clamp } from './math.ts';
import type { Color, Instance } from './renderer.ts';

/** Half-width of the playfield the player and obstacles live within. */
export const PLAY_RANGE = 3.5;

// Obstacles spawn far away and march toward the camera at z = 0.
const SPAWN_Z = 34;
const PLAYER_Z = 1.2;
const DESPAWN_Z = -2;

const START_SPEED = 9;
const ACCEL = 0.3;
const BASE_SPAWN_INTERVAL = 0.5;
const MIN_SPAWN_INTERVAL = 0.18;

const FAR_COLOR: Color = [70, 130, 240];
const NEAR_COLOR: Color = [255, 90, 60];

interface Obstacle extends Instance {
  spinX: number;
  spinY: number;
  prevZ: number;
  scored: boolean;
}

function lerpColor(a: Color, b: Color, t: number): Color {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export class Game {
  player = { x: 0, y: 0 };
  obstacles: Obstacle[] = [];
  score = 0;
  speed = START_SPEED;
  time = 0;
  over = false;

  private spawnTimer = 0;

  reset(): void {
    this.player = { x: 0, y: 0 };
    this.obstacles = [];
    this.score = 0;
    this.speed = START_SPEED;
    this.time = 0;
    this.over = false;
    this.spawnTimer = 0;
  }

  movePlayerTo(x: number, y: number): void {
    this.player.x = clamp(x, -PLAY_RANGE, PLAY_RANGE);
    this.player.y = clamp(y, -PLAY_RANGE, PLAY_RANGE);
  }

  nudge(dx: number, dy: number): void {
    this.movePlayerTo(this.player.x + dx, this.player.y + dy);
  }

  private spawn(): void {
    this.obstacles.push({
      position: {
        x: (Math.random() * 2 - 1) * PLAY_RANGE,
        y: (Math.random() * 2 - 1) * PLAY_RANGE,
        z: SPAWN_Z,
      },
      rotX: Math.random() * Math.PI,
      rotY: Math.random() * Math.PI,
      spinX: (Math.random() * 2 - 1) * 1.6,
      spinY: (Math.random() * 2 - 1) * 1.6,
      scale: 0.55 + Math.random() * 0.5,
      color: FAR_COLOR,
      prevZ: SPAWN_Z,
      scored: false,
    });
  }

  update(dt: number): void {
    if (this.over) return;

    this.time += dt;
    this.speed = START_SPEED + this.time * ACCEL;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - this.time * 0.01);
    }

    for (const o of this.obstacles) {
      o.prevZ = o.position.z;
      o.position.z -= this.speed * dt;
      o.rotX += o.spinX * dt;
      o.rotY += o.spinY * dt;
      o.color = lerpColor(FAR_COLOR, NEAR_COLOR, clamp(1 - o.position.z / SPAWN_Z, 0, 1));

      // Resolve the moment an obstacle crosses the player's plane: either it
      // overlaps the ship (collision) or the player threaded past it (score).
      if (!o.scored && o.prevZ > PLAYER_Z && o.position.z <= PLAYER_Z) {
        const hit = o.scale + 0.5;
        const dx = Math.abs(o.position.x - this.player.x);
        const dy = Math.abs(o.position.y - this.player.y);
        if (dx < hit && dy < hit) {
          this.over = true;
        } else {
          this.score++;
          o.scored = true;
        }
      }
    }

    this.obstacles = this.obstacles.filter((o) => o.position.z > DESPAWN_Z);
  }
}
