export interface CinematicChapterCopy {
  title: readonly [string, string];
  body: readonly [string, string];
}

/** Chapter copy shared by the browser living title and the terminal Trailer. */
export const CINEMATIC_CHAPTERS: readonly CinematicChapterCopy[] = [
  { title: ['The 3D game engine', 'built for agents.'], body: ['ASCII in your terminal, no GPU.', 'Humans can play too.'] },
  { title: ['Powered by', 'Vercel AI Gateway.'], body: ['Watch hundreds of models face off,', 'or challenge them yourself.'] },
  { title: ['Different minds.', 'Endless possibilities.'], body: ['Everything you see is open source.', 'Have an idea? Your move.'] },
  { title: ['Every player', 'has a tell.'], body: ['Discover the hidden tendencies', 'of your favorite models.'] },
  { title: ['Settle in,', 'have some fun!'], body: ['Play a few rounds while waiting for', 'your coding agents to finish.'] },
] as const;
