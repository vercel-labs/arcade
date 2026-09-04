import { flatShade, mat4Multiply, mat4RotY, mat4Scale, mat4Translate, normalize3, parseObj, type Mat4, type Mesh, type Vec3 } from '../../engine/index.ts';

export const POKER_FELT_GREEN: Vec3 = { x: 12, y: 46, z: 28 };
export const POKER_WOOD_BROWN: Vec3 = { x: 132, y: 88, z: 52 };
export const POKER_TABLE_LIGHT = normalize3({ x: 0.25, y: 0.9, z: 0.4 });
export const POKER_TABLE_AMBIENT = 0.74;
export const POKER_TABLE_ASCII_CONTRAST = 2;
export const POKER_SCENE_BACKGROUND: Vec3 = { x: 6, y: 10, z: 8 };
export const POKER_FELT_STIPPLE = { stipple: { x: 40, y: 120, z: 78 } as Vec3, stippleFreq: 1.2, stippleDensity: 0.1, stippleGain: 1.1, stippleRadius: 0.27 };
const TABLE_FELT_Y = 26;
const TABLE_OUTER = 34.8;
const TABLE_SCALE = 0.16;
const CHAIR_SCALE = 0.5;
const CHAIR_MIN_Y = -0.47;
export const TABLE_RADIUS = TABLE_OUTER * TABLE_SCALE;
export const FLOOR_Y = -TABLE_FELT_Y * TABLE_SCALE;
export const TABLE_MODEL: Mat4 = mat4Multiply(mat4Translate(0, -TABLE_FELT_Y * TABLE_SCALE, 0), mat4Scale(TABLE_SCALE, TABLE_SCALE, TABLE_SCALE));
export const POKER_TABLE_ASSET_URLS = {
  table: new URL('../../../assets/poker/poker-table.obj', import.meta.url).toString(),
  chair: new URL('../../../assets/poker/chair.obj', import.meta.url).toString(),
};

export interface PokerTableMeshes { felt: Mesh; frame: Mesh; chair: Mesh; }

export function parsePokerTableMeshes(tableSource: string, chairSource: string): PokerTableMeshes {
  const table = flatShade(parseObj(tableSource));
  const feltIndices: number[] = [];
  const frameIndices: number[] = [];
  for (let i = 0; i < table.indices.length; i += 3) {
    const tri = table.indices.slice(i, i + 3);
    const vertices = tri.map((index) => table.vertices[index]);
    const yc = vertices.reduce((sum, vertex) => sum + vertex.position.y, 0) / 3;
    const felt = vertices[0].normal.y > 0.85 && yc > 25.5 && yc < 26.5;
    for (const vertex of vertices) vertex.color = { ...(felt ? POKER_FELT_GREEN : POKER_WOOD_BROWN) };
    (felt ? feltIndices : frameIndices).push(...tri);
  }
  const chair = flatShade(parseObj(chairSource));
  for (const vertex of chair.vertices) vertex.color = { ...POKER_WOOD_BROWN };
  return { felt: { vertices: table.vertices, indices: feltIndices }, frame: { vertices: table.vertices, indices: frameIndices }, chair };
}

export async function fetchPokerTableMeshes(fetchText: (url: string) => Promise<string> = async (url) => {
  const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load Poker model: HTTP ${response.status}`); return response.text();
}): Promise<PokerTableMeshes> {
  const [table, chair] = await Promise.all([fetchText(POKER_TABLE_ASSET_URLS.table), fetchText(POKER_TABLE_ASSET_URLS.chair)]);
  return parsePokerTableMeshes(table, chair);
}

export function chairModel(angle: number, radius = TABLE_RADIUS + 0.5): Mat4 {
  const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius, y = FLOOR_Y - CHAIR_MIN_Y * CHAIR_SCALE;
  return mat4Multiply(mat4Translate(x, y, z), mat4Multiply(mat4RotY(angle + Math.PI), mat4Scale(CHAIR_SCALE, CHAIR_SCALE, CHAIR_SCALE)));
}
