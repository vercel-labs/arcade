// Board-mode harbor layout: turn the rules layer's nine coastal harbor edges into world-space
// boat poses and paired jetty endpoints. The topology remains authoritative—rendering never
// invents a second set of port locations or settlement sites.

import { type Mat4, mat4MulVec4, mat4Multiply, mat4RotY, mat4Scale, mat4Translate } from '../../../../engine/index.ts';
import { type HarborSetup } from '../../../../rules/catan/setup.ts';
import { type Resource } from '../../../../rules/catan/types.ts';
import { PORT_SAIL_CENTER } from '../mesh/port/hull.ts';
import { type PortKind } from '../mesh/port/spec.ts';
import { EDGE_ENDS } from './board-layout.ts';

// The standalone port model is deliberately large enough for close inspection. Board ships are
// miniatures: still readable in the terminal, but small enough for all nine to fit around Catan.
export const BOARD_HARBOR_SCALE = 0.56;
export const BOARD_HARBOR_DISTANCE = 0.7;
export const BOARD_HARBOR_Y = -0.19;

export interface HarborConnector {
  shoreA: { x: number; z: number };
  shoreB: { x: number; z: number };
  vesselA: { x: number; z: number };
  vesselB: { x: number; z: number };
}

export interface BoardHarborPose {
  edge: number;
  kind: PortKind;
  model: Mat4;
  forward: { x: number; z: number };
  outward: { x: number; z: number };
  sailCenter: { x: number; y: number; z: number };
  connector: HarborConnector;
}

function portKind(resource: Resource | null): PortKind {
  return resource ?? 'generic';
}

export function boardHarborPoses(harbors: readonly HarborSetup[]): BoardHarborPose[] {
  return harbors.map((harbor) => {
    const edge = EDGE_ENDS[harbor.edge];
    const p0 = { x: edge.x0, z: edge.z0 };
    const p1 = { x: edge.x1, z: edge.z1 };
    const mid = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };

    // Orient local +X along the coastline and local +Z toward land. Deriving the outward
    // direction from the edge normal—not from the island center—puts the boat on the edge's
    // perpendicular bisector. That makes its two jetties exact mirrored counterparts even on
    // coastal edges whose midpoint is not radially aligned with the board center.
    const edgeLength = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    let tx = (p1.x - p0.x) / edgeLength;
    let tz = (p1.z - p0.z) / edgeLength;
    let localZ = { x: -tz, z: tx };
    if (localZ.x * mid.x + localZ.z * mid.z > 0) {
      tx = -tx;
      tz = -tz;
      localZ = { x: -tz, z: tx };
    }
    const outward = { x: -localZ.x, z: -localZ.z };
    const yaw = Math.atan2(-tz, tx);
    const center = {
      x: mid.x + outward.x * BOARD_HARBOR_DISTANCE,
      z: mid.z + outward.z * BOARD_HARBOR_DISTANCE,
    };
    const model = mat4Multiply(
      mat4Translate(center.x, BOARD_HARBOR_Y, center.z),
      mat4Multiply(mat4RotY(yaw), mat4Scale(BOARD_HARBOR_SCALE, BOARD_HARBOR_SCALE, BOARD_HARBOR_SCALE)),
    );
    const sail = mat4MulVec4(model, { ...PORT_SAIL_CENTER, w: 1 });

    // Match each coastal node to the nearer end of the boat. The arms begin just beyond the
    // settlement point (leaving room for a house/city) and converge slightly toward the hull,
    // producing the recognizable paired harbor extensions from the physical board.
    const projection = (p: { x: number; z: number }): number => (p.x - mid.x) * tx + (p.z - mid.z) * tz;
    const negative = projection(p0) < projection(p1) ? p0 : p1;
    const positive = negative === p0 ? p1 : p0;
    // Begin on the sandy coastal apron rather than directly on the terrain wall.
    const shore = (p: { x: number; z: number }): { x: number; z: number } => ({
      x: p.x + outward.x * 0.31,
      z: p.z + outward.z * 0.31,
    });
    const vessel = (along: number): { x: number; z: number } => ({
      x: center.x + tx * along - outward.x * 0.13,
      z: center.z + tz * along - outward.z * 0.13,
    });

    return {
      edge: harbor.edge,
      kind: portKind(harbor.port.resource),
      model,
      // The hull stations run stern-to-bow along local +X. `tx/tz` is that same axis after
      // the harbor yaw, so entrance animation can advance the miniature bow-first instead of
      // sliding it sideways along the coast normal.
      forward: { x: tx, z: tz },
      outward,
      sailCenter: { x: sail.x, y: sail.y, z: sail.z },
      connector: {
        shoreA: shore(negative),
        shoreB: shore(positive),
        vesselA: vessel(-0.27),
        vesselB: vessel(0.27),
      },
    };
  });
}
