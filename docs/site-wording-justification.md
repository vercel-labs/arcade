# Site wording justification

This document records the approved wording for the five chapters in the Arcade
homepage cinematic and explains how each phrase pairs with its scene. The copy
is implemented in `apps/site/app/[lang]/(home)/components/hero.tsx`; scene order
and timing live in `src/cinematic/timeline.ts`.

## Current wording

| Scene | Title | Subtitle |
| --- | --- | --- |
| Prism | **The 3D game engine for agents.** | ASCII in your terminal. No GPU.<br>Humans can play too. |
| Cover Flow | **Powered by Vercel’s AI Gateway.** | Watch hundreds of models face off, or challenge them yourself. |
| Chess | **Different minds. Endless possibilities.** | Everything you see is open source. Your move. |
| Poker | **Every player has a tell.** | Discover the hidden tendencies of your favorite models. |
| Islanders | **Settle in, have some fun!** | Play a few rounds while coding agents do your work. |

## Chapter pairings

### 1. Prism

**The 3D game engine for agents.**

**ASCII in your terminal. No GPU.**

**Humans can play too.**

The opening scene transforms the Vercel triangle into Arcade's software-rendered
glass prism. The title establishes Arcade as an extensible engine for agents,
not merely a collection of games. The first subtitle line names its terminal and
CPU-rendered identity; the separate “Humans can play too” line adds a restrained
joke while keeping people explicitly invited.

### 2. Cover Flow

**Powered by Vercel’s AI Gateway.**

**Watch hundreds of models face off, or challenge them yourself.**

The launcher rotates through Arcade's games while model-provider wisps occupy the
same world. The pairing gives AI Gateway prominent credit and translates its
broad model catalog into an Arcade choice: spectate model-versus-model matches or
join one yourself. “Hundreds” reflects a bundled catalog of 203 models when this
line was approved, but availability varies by team and should be rechecked before
making a stronger claim.

### 3. Chess

**Different minds. Endless possibilities.**

**Everything you see is open source. Your move.**

The Chess scene shows different model wisps sharing one board and one set of
rules. “Different minds” refers both to models choosing different strategies and
developers bringing different ideas to the project; “endless possibilities”
connects emergent play with what the open-source engine can become. “Your move”
is both a Chess reference and an invitation to build on the code without implying
a future commitment from the current maintainer.

### 4. Poker

**Every player has a tell.**

**Discover the hidden tendencies of your favorite models.**

The Poker scene deals private cards to models whose decisions unfold around the
same table. A “tell” belongs naturally to poker while also naming Arcade's broader
ethos: games can reveal differences in model strategy, risk preference, and
behavior. The wording stays observational rather than claiming that one match is
a formal benchmark or scientifically stable measurement.

### 5. Islanders

**Settle in, have some fun!**

**Play a few rounds while coding agents do your work.**

The final scene assembles a living island, places pieces, travels along the coast,
and shifts between ASCII, hybrid, and pixel presentation. “Settle in” lightly
references settlement gameplay while remaining a normal invitation to relax.
The playful subtitle places Arcade alongside a real agent workflow: someone can
play or spectate while coding agents run elsewhere. The exclamation mark is
intentional because this final chapter releases the more serious product framing.

## Narrative and voice

The cinematic moves from product definition, to Gateway-powered model choice, to
open-source extensibility, to behavioral observation, and finally to play. The
first four chapters explain Arcade; the fifth ends on a lighter note.

- Keep five chapters unless the visual timeline materially changes.
- Let subtitles explain meaning instead of listing props already visible onscreen.
- Use Geist Pixel for titles, Geist Sans for subtitles, and the exact product name
  “Vercel’s AI Gateway.”
- Keep game references subtle enough that every line works without recognizing the
  reference.
- Avoid em-dash pivots and generic marketing language.
- Do not add roadmap promises to the open-source chapter.
- Keep the opening subtitle on two lines so its technical statement and human joke
  remain distinct.
- Treat the late Islanders display-mode transformation as visual proof, not a sixth
  chapter, unless its timeline is deliberately expanded.

## Arcade ethos

Arcade treats the terminal as a real graphics and interaction surface. Its 3D
renderer, retained UI, rules, model harness, visuals, and cinematics are reusable
TypeScript layers. Humans and models play through the same game authority, and
model matches can be watched as behavior rather than reduced to a score alone.
The cinematic demonstrates that engineering; the wording invites people to play,
observe, and build.
