// Vercel function: complete poker hand records.
import { makeHandler } from '../../lib/http.ts';
import { makeDeps } from '../../lib/deps.ts';

export default makeHandler('poker_hand', makeDeps());
