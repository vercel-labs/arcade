import type { DocPage } from './docs-content';

export const MOTIVATION_DOC: DocPage = {
  slug: 'motivation',
  label: 'Motivation',
  title: 'Why Arcade exists',
  summary: 'A letter from the developer.',
  sections: [],
  body: <div className="doc-letter">
    <p>I never thought about the terminal as a canvas.</p>
    <p>For most of my life, it was where I did the boring work. I used it to navigate my computer, run commands, check logs, and fix things. More recently, it became a place to prompt coding agents and wait for them to finish. As CLIs have grown alongside AI tools, I have found myself spending more and more of my day there. I still thought of the terminal as a way to tell a computer what to do, not a place to make something expressive.</p>
    <p>I did not set out to change my mind about that. The path to Arcade was less direct.</p>
    <p>Before Arcade, I entered a hackathon and built a pixel simulation of The Office where characters moved around, talked, formed relationships, and generated new episodes. I was glad that my silly idea resonated with the judges. One of them was Andrew Qu, and a few weeks later, I started my first day at Vercel.</p>
    <p>The project was playful on purpose, but it was also my way of showing what a developer platform could make possible. Instead of listing APIs on a slide, I wanted people to see a little world running on top of them.</p>
    <p>At Vercel, I kept coming back to that same instinct with AI Gateway. I could explain model routing, provider abstraction, and the rest of the AI stack one feature at a time. Or I could build something that let people experience what those pieces unlocked. Arcade became my attempt at the second option. If it makes another developer curious enough to try Vercel's AI stack for an idea of their own, that would mean a lot to me.</p>
    <p>Games felt like the right place to start. One of the moments I kept returning to was AlphaGo's Move 37 against Lee Sedol in Game 2. It looked strange, even mistaken, before becoming a move people would study and talk about. Something unexpected had emerged from a machine, and a game had given people a way to see it. That moment became one of the inspirations behind Arcade.</p>
    <p>That is what fascinates me about games. Their rules are strict enough to make decisions comparable, but open enough for something unexpected to happen.</p>
    <p>Somewhere along the way, I made the slightly unreasonable decision to put the whole thing in a terminal.</p>
    <p>At first, the terminal felt like a list of limitations. There are only so many cells. Every cell is a character. Characters are taller than they are wide. Color support depends on the terminal. A full 3D scene has to survive all of that and still be readable.</p>
    <p>I had heard the saying that constraints create creativity, but this exploration made me understand it a little better. Reading Hunter x Hunter and Jujutsu Kaisen gave me another way to think about it. Nen restrictions and binding vows both play with the idea that giving something up can be what gives an ability its force. The comparison is a little ridiculous, but that is honestly how the terminal started to feel.</p>
    <p>The grid forced me to think differently about shape, light, motion, and color. I wrote a 3D renderer in TypeScript because I wanted control over how that translation worked. As I kept building, ASCII stopped feeling like a fallback. Different characters caught edges and shadows in their own way. Half blocks turned color into another kind of brush. A glass prism, a poker table, a chess piece, or a moving sheep all asked for a different solution.</p>
    <p>Somewhere in all of that, the thought I had dismissed at the beginning started to feel obvious: the terminal could be a canvas. It was not a worse version of a browser, but a medium with its own constraints, texture, and movement.</p>
    <p>Arcade is where that artistic exploration meets the other things I wanted to understand. It is a way to show what Vercel AI Gateway can unlock, a place where humans and models can play together, and a way to look at model behavior beyond a percentage on a benchmark.</p>
    <p>I am not trying to build the next AlphaGo or teach models to play every game optimally. I also do not want to prompt one model to be aggressive and another to be cautious, then act surprised when they follow the script. The harness holds the rules steady, gives each model the information it should have, validates its actions, and otherwise tries to stay out of the way. I am interested in the tendencies that emerge from the model as it is, shaped by its training and weights rather than by a personality I wrote for it.</p>
    <p>In poker, that might look like caution, aggression, bluffing, or a strange appetite for risk. In Islanders, it can show up through cooperation, trading, grudges, generosity, or betrayal. Chess strips away most of the social layer and leaves planning and adaptation. None of this proves that a model has one true personality. Prompts, context, sampling, and providers all matter. But the choices are still worth observing, especially when the interesting part is something a final score would erase.</p>
    <p>It matters to me that this happens in something made for people, not only in an evaluation script. Arcade should be enjoyable to play, easy to watch, and capable of producing moments that are funny, tense, surprising, or just weird. The technology is real, but delight is part of the point.</p>
    <p>I hope Arcade gives someone a few fun minutes during a busy day. I hope it inspires someone to build a game of their own, try Vercel's AI stack, look at a model from a different angle, or see the terminal as a place where art can happen.</p>
    <p>If it does even one of those things, that is enough for me.</p>
    <p className="doc-letter__signature">- <a href="https://x.com/_Brian_Zhang" rel="noreferrer" target="_blank">Brian Zhang</a></p>
  </div>,
};
