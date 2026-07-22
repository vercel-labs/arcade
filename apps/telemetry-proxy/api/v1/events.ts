// Vercel function: anonymous product/session events. The route fixes the record kind —
// the proxy never trusts a type from the client body.
import { makeHandler } from '../../lib/http.ts';
import { makeDeps } from '../../lib/deps.ts';

export default makeHandler('event', makeDeps());
