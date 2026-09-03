export interface CinematicLoopSample {
  elapsed: number;
  phase: number;
  iteration: number;
}

/**
 * A host-neutral clock for deterministic scene choreography. It starts at zero
 * on scene entry, advances only while active, and restarts when re-entered.
 * Camera scroll and gameplay time therefore remain independent inputs.
 */
export class ActiveSceneLoopClock {
  private active = false;
  private enteredAt = 0;

  sample(hostTimeSeconds: number, active: boolean, durationSeconds: number): CinematicLoopSample {
    const duration = Math.max(0.001, durationSeconds);
    const now = Number.isFinite(hostTimeSeconds) ? hostTimeSeconds : 0;
    if (!active) {
      this.active = false;
      return { elapsed: 0, phase: 0, iteration: 0 };
    }
    if (!this.active || now < this.enteredAt) {
      this.active = true;
      this.enteredAt = now;
    }
    const total = Math.max(0, now - this.enteredAt);
    const iteration = Math.floor(total / duration);
    const elapsed = total - iteration * duration;
    return { elapsed, phase: elapsed / duration, iteration };
  }

  reset(): void {
    this.active = false;
    this.enteredAt = 0;
  }
}
