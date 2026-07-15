// Public API of the auth module: .env loading + the Vercel sign-in / AI Gateway
// key resolution used at startup and from the in-app account menu. App code imports
// from here; modules inside the module import each other directly. vercel-auth.ts /
// vercel-api.ts are internal plumbing for gateway-key and are not re-exported.
export { loadEnv } from './env.ts';
export {
  availableTeams,
  ensureCachedGatewayKey,
  ensureGatewayKey,
  isLoggedIn,
  signOut,
  switchTeam,
  useTeam,
  type EnsureOpts,
  type EnsureResult,
} from './gateway-key.ts';
export type { Team } from './vercel-api.ts';
