import type { DocPage } from './docs-content';

export const MOTIVATION_DOC: DocPage = {
  slug: 'motivation',
  label: 'Motivation',
  title: 'Why Arcade exists',
  summary: 'A letter from the developer.',
  sections: [],
  body: <div className="doc-letter">
    <p>I started Arcade because I wanted to make something fun.</p>
    <p>A lot of the conversation around AI is about productivity, benchmarks, and economics. How much faster is a model? How much does it cost? How much work can it automate? I spend a lot of my time thinking about that side of AI too, and those questions matter. But I wanted to make something that asks a different question: what does it feel like to share a world with these models?</p>
    <p>Arcade began with the terminal. I have always liked working there, but we usually treat it as a place without graphics, something practical that we use after everything visual has moved somewhere else. I kept wondering what would happen if terminal cells were treated as a real canvas instead.</p>
    <p>The constraints are part of what makes it interesting to me. Light, geometry, motion, and interfaces all have to become characters and color. It feels closer to pixel art, watercolor, or printmaking than to a normal application. The renderer is written in TypeScript and runs entirely on the CPU. That makes the medium available in the same terminals, sandboxes, servers, and headless environments where agents already live.</p>
    <p>Games gave that medium a purpose. Humans can play, models can play, and anyone can sit back and watch. I also wanted Arcade to be something you could open during a break, or while your coding agents finish their work. Not every minute spent with a computer needs to be optimized. Some software should exist because it is surprising, beautiful, funny, or simply enjoyable.</p>
    <p>The model side of Arcade came from the same curiosity. Benchmarks are useful, but they compress a lot of behavior into a percentage. A game creates a sequence of choices with context, consequences, hidden information, and other players.</p>
    <p>I do not want the harness to tell a model to be cautious, aggressive, loyal, deceptive, or cooperative. I want to give every player the same rules, the same kinds of choices, and a fair view of the game, then see what happens.</p>
    <p>Poker can show patience, appetite for risk, bluffing, and reactions to uncertainty. Islanders can show reciprocity, negotiation, cooperation, opportunism, and betrayal. Chess can show planning style, tactical preference, and how a model responds when its position changes.</p>
    <p>I am careful not to treat those observations as permanent personalities or scientific measurements. One match proves very little. Behavior also depends on context, prompting, sampling, and the model provider. Still, repeated choices under shared conditions can reveal differences that disappear inside an aggregate score.</p>
    <p>That is what I mean by a model harness. It should create a structure around the model: private observations, public rules, validated actions, visible consequences, and replayable records. Then it should get out of the way.</p>
    <p>Vercel AI Gateway makes it possible to try this across many models and providers. Arcade shows the agent stack through something alive: models making decisions, talking at the table, changing strategies, and inhabiting the same rendered world. The infrastructure matters, but it is there to support the experience.</p>
    <p>Mostly, I hope Arcade makes technology feel a little more playful. The industry can feel overstimulating and relentlessly focused on output, rankings, and turning every idea into a productivity tool or a business model. Arcade is serious engineering in service of play, curiosity, and art.</p>
    <p>If it gives someone a few enjoyable minutes, reveals something unexpected about a model, or inspires them to build a new game or look at an old interface as a new creative medium, then it is doing what I hoped it would do.</p>
    <p className="doc-letter__signature">- <a href="https://x.com/_Brian_Zhang" rel="noreferrer" target="_blank">Brian Zhang</a></p>
  </div>,
};
