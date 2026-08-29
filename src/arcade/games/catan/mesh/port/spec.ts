// The harbour ship's form data: what a port trades, the hull palette, and the longitudinal
// station tables (deck-edge and keel half-widths/heights) the hull is lofted through.

import { type RGB } from '../../../../../game-visuals/catan/build.ts';

export type PortKind = 'generic' | 'brick' | 'grain' | 'lumber' | 'ore' | 'wool';

// A warm, fairly LIGHT wood so the hull reads in ASCII on the dark background — a Lambert face
// can't get brighter than its base color, so a dark brown crushes to near-black there no matter
// the light. Form still comes from the raking key + wrap shading these faces differently.
export const HULL: RGB = [154, 100, 72]; // outer planking
export const HULL_DK: RGB = [124, 80, 58]; // keel underside + inner walls (shadowed, for form)
export const LIP: RGB = [184, 130, 98]; // the gunwale rim band (lighter, catches the light)
export const DECK: RGB = [180, 122, 90]; // interior floor
export const MASTC: RGB = [112, 78, 58]; // mast + spar
export const SAIL_TAN: RGB = [227, 219, 203]; // warm cream for the masthead pennant
export const SAIL_WHITE: RGB = [244, 242, 236]; // the sail (one consistent color)

// Longitudinal stations from stern (−x) to bow (+x): deck-edge half-width/height (T) and keel
// half-width/height (B) at each. Both the sheer (TY) and the keel (BY) rise toward the ends for
// the raised prow + stern; the widths taper to near-points at bow and stern.
export const ST_X = [-0.70, -0.50, -0.24, 0.04, 0.32, 0.58, 0.80];
export const ST_TW = [0.17, 0.30, 0.35, 0.35, 0.32, 0.24, 0.08];
export const ST_TY = [0.52, 0.46, 0.42, 0.30, 0.32, 0.38, 0.44];
export const ST_BW = [0.09, 0.18, 0.22, 0.21, 0.18, 0.11, 0.03];
export const ST_BY = [0.30, 0.1, 0.03, 0.02, 0.04, 0.12, 0.31];
export const LIPW = 0.055; // rim band width
export const DECK_INSET = 0.03; // keep horizontal floors safely inside the narrowing hull shell
export const FLOOR_Y = 0.19; // main (cargo well) deck height — cargo sits here
export const AFT_Y = 0.38; // raised aft-deck (poop) height: below the stern rim, above the well floor
export const STEP = 2; // station where the poop deck steps down to the well
export const BOW = 5; // bow bulkhead station (forward end of the well)

// One hull side wall (`s` = +1 / −1) as a smooth-shaded strip: per-vertex normals are averaged
// across the wall facets, so the curved side lights as one smooth gradient instead of stepping
// facet-to-facet (which, under the raking key, left a dark wedge where two flat facets met).
