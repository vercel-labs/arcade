// Vercel function: canonical chess/poker match records.
import { makeHandler } from '../../lib/http.ts';
import { makeDeps } from '../../lib/deps.ts';

export default makeHandler('match', makeDeps());
