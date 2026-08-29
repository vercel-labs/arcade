import { flatShade, type Mesh } from '../engine/mesh.ts';
import { parseObj, type ParseObjOptions } from '../engine/obj.ts';

export type TextAssetTransport = (url: string) => Promise<string>;

export const fetchTextAsset: TextAssetTransport = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load model ${url}: HTTP ${response.status}`);
  return response.text();
};

/** Fetch and parse one Wavefront model with Arcade's own browser-safe loader. */
export async function fetchObjMesh(
  url: string,
  transport: TextAssetTransport = fetchTextAsset,
  options?: ParseObjOptions,
): Promise<Mesh> {
  return flatShade(parseObj(await transport(url), options));
}

/** Load a named model set while retaining the caller's exact key type. */
export async function fetchObjMeshSet<K extends string>(
  urls: Record<K, string>,
  transport: TextAssetTransport = fetchTextAsset,
): Promise<Record<K, Mesh>> {
  const entries = await Promise.all(Object.entries<string>(urls).map(async ([name, url]) => [
    name,
    await fetchObjMesh(url, transport),
  ] as const));
  return Object.fromEntries(entries) as Record<K, Mesh>;
}
