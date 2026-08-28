// Runtime model discovery for Arcade's match setup. The baked catalog remains the
// offline/error fallback, but a signed-in launch replaces it with the selected team's
// owner-visible AI Gateway catalog and per-model availability annotations.
import { availableRealtimeModels } from '../../voice/index.ts';
import { includeEarlyAccessModels, pickerCreators, creatorName, type CreatorInfo } from './models.ts';

const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models?include_availability';
const DEFAULT_TIMEOUT_MS = 8_000;

type EvaluatedRuntime = 'http' | 'realtime_websocket';
type EligibilityStatus = 'eligible' | 'ineligible' | 'unknown';

interface ModelEligibility {
  status: EligibilityStatus;
  evaluated_runtime: EvaluatedRuntime;
  category?: 'configuration' | 'policy' | 'transient';
  reason?: string;
}

interface GatewayModel {
  id: string;
  name?: string;
  type?: string;
  owned_by?: string;
  model_slug?: string;
  tags?: string[];
  model_eligibility?: ModelEligibility;
}

export interface ArcadeModelCatalog {
  source: 'team' | 'fallback';
  textCreators: CreatorInfo[];
  realtimeCreators: CreatorInfo[];
  availabilityStatus?: string;
  catalogStatus?: string;
  requestContextAvailability?: unknown;
  fallbackReason?: string;
}

interface CatalogResponse {
  data: unknown[];
  availability_status?: unknown;
  catalog_status?: unknown;
  request_context_availability?: unknown;
}

export interface FetchTeamModelCatalogOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function creatorLabel(slug: string): string {
  const known = creatorName(slug);
  if (known !== slug) return known;
  return slug
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function realtimeFallback(): CreatorInfo[] {
  const byCreator = new Map<string, CreatorInfo>();
  for (const model of availableRealtimeModels(includeEarlyAccessModels())) {
    let creator = byCreator.get(model.creator);
    if (!creator) {
      creator = { slug: model.creator, name: model.creatorName, models: [] };
      byCreator.set(model.creator, creator);
    }
    creator.models.push({ id: model.id, name: model.name });
  }
  return [...byCreator.values()];
}

export function fallbackArcadeModelCatalog(reason?: string): ArcadeModelCatalog {
  return {
    source: 'fallback',
    textCreators: pickerCreators(),
    realtimeCreators: realtimeFallback(),
    fallbackReason: reason,
  };
}

function isGatewayModel(value: unknown): value is GatewayModel {
  return typeof value === 'object' && value !== null && typeof (value as GatewayModel).id === 'string';
}

function hasTag(model: GatewayModel, tag: string): boolean {
  return Array.isArray(model.tags) && model.tags.includes(tag);
}

function isDurablyUnavailable(model: GatewayModel): boolean {
  const eligibility = model.model_eligibility;
  return eligibility?.status === 'ineligible' && eligibility.category === 'policy';
}

function isTextModel(model: GatewayModel, modelsById: ReadonlyMap<string, GatewayModel>, seen = new Set<string>()): boolean {
  if (model.model_eligibility?.evaluated_runtime !== 'http') return false;
  if (model.type === 'virtual') {
    if (!model.model_slug || seen.has(model.id)) return true;
    const target = modelsById.get(model.model_slug);
    if (!target) return true;
    const nextSeen = new Set(seen);
    nextSeen.add(model.id);
    return isTextModel(target, modelsById, nextSeen);
  }
  return model.type === 'language' && !hasTag(model, 'image-generation') && !hasTag(model, 'video-generation');
}

function isRealtimeModel(model: GatewayModel): boolean {
  return model.model_eligibility?.evaluated_runtime === 'realtime_websocket';
}

function groupCreators(models: readonly GatewayModel[]): CreatorInfo[] {
  const byCreator = new Map<string, CreatorInfo>();
  for (const model of models) {
    const idCreator = model.id.split('/')[0] || 'custom';
    const slug = model.owned_by || idCreator;
    let creator = byCreator.get(slug);
    if (!creator) {
      creator = { slug, name: creatorLabel(slug), models: [] };
      byCreator.set(slug, creator);
    }
    if (creator.models.some((candidate) => candidate.id === model.id)) continue;
    creator.models.push({ id: model.id, name: model.name || model.id.split('/').at(-1) || model.id });
  }
  return [...byCreator.values()]
    .map((creator) => ({
      ...creator,
      models: creator.models.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseTeamModelCatalog(value: unknown): ArcadeModelCatalog | null {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as CatalogResponse).data)) return null;
  const response = value as CatalogResponse;
  const models = response.data.filter(isGatewayModel);
  if (models.length === 0 || !models.some((model) => model.model_eligibility !== undefined)) return null;

  const visible = models.filter((model) => !isDurablyUnavailable(model));
  const modelsById = new Map(visible.map((model) => [model.id, model]));
  return {
    source: 'team',
    textCreators: groupCreators(visible.filter((model) => isTextModel(model, modelsById))),
    realtimeCreators: groupCreators(visible.filter(isRealtimeModel)),
    availabilityStatus: typeof response.availability_status === 'string' ? response.availability_status : undefined,
    catalogStatus: typeof response.catalog_status === 'string' ? response.catalog_status : undefined,
    requestContextAvailability: response.request_context_availability,
  };
}

export async function fetchTeamModelCatalog(key: string, opts: FetchTeamModelCatalogOpts = {}): Promise<ArcadeModelCatalog> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MODELS_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!response.ok) return fallbackArcadeModelCatalog(`HTTP ${response.status}`);
    const catalog = parseTeamModelCatalog(await response.json());
    return catalog ?? fallbackArcadeModelCatalog('availability annotations unavailable');
  } catch (error) {
    return fallbackArcadeModelCatalog(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}
