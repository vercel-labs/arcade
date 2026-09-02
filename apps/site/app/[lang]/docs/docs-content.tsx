import type { ReactNode } from 'react';

export interface DocSection { heading: string; body: ReactNode }
export interface DocPage { slug: string; eyebrow: string; title: string; summary: string; sections: DocSection[] }

const REPO = 'https://github.com/vercel-labs/arcade/blob/main/';
const Code = ({ children }: { children: string }) => <pre className="doc-code"><code>{children}</code></pre>;
const Source = ({ path, children }: { path: string; children?: ReactNode }) => <a className="source-link" href={`${REPO}${path}`} rel="noreferrer" target="_blank">{children ?? path} ↗</a>;
const Note = ({ children }: { children: ReactNode }) => <aside className="doc-note">{children}</aside>;
const Api = ({ rows }: { rows: [string, string][] }) => <div className="api-list">{rows.map(([name, description]) => <div key={name}><code>{name}</code><p>{description}</p></div>)}</div>;

export const DOCS: DocPage[] = [
  {
    slug: '',
    eyebrow: 'Arcade developer kit',
    title: 'A terminal is a canvas.',
    summary: 'Use the CPU renderer, retained TUI, game contracts, hosted CLI, and self-play tooling independently—or compose them into a complete agent-playable game.',
    sections: [
      {
        heading: 'Choose a layer',
        body: <div className="doc-cards">
          <a href="/docs/engine"><strong>Engine</strong><span>Geometry, camera, materials, rasterization</span></a>
          <a href="/docs/tui"><strong>TUI</strong><span>Layout, components, input, Surface</span></a>
          <a href="/docs/game-harness"><strong>Game harness</strong><span>Rules, models, communication, traces</span></a>
          <a href="/examples"><strong>Live examples</strong><span>Focused renderer and interface specimens</span></a>
        </div>,
      },
      {
        heading: 'Install and import',
        body: <><Code>{`npm install @vercel/arcade

import { Surface } from '@vercel/arcade/engine'
import { Box, Text } from '@vercel/arcade/tui'
import { ChessState } from '@vercel/arcade/rules/chess'
import {
  CanvasSurfaceHost, createBrowserMiniScene
} from '@vercel/arcade/web'`}</Code><Note>The package is currently restricted while the source, asset, license, and packed-consumer audits finish. These explicit subpaths are the intended boundary and are exercised by the site today; do not claim general public npm availability yet.</Note></>,
      },
      {
        heading: 'One-way architecture',
        body: <><p><code>engine</code> is the reusable CPU graphics layer. <code>tui</code> consumes engine cells and normalized platform input. Rules and AI contracts remain presentation-agnostic. <code>arcade</code> composes those libraries into games. Browser examples import only browser-safe subpaths, while the homepage connects to the actual packaged CLI in an isolated PTY.</p><Code>{`engine ----> tui ---------> terminal host -> ANSI
   |          |
   |          +-----------> focused browser examples -> Canvas
   +----> arcade <---- rules + ai ----> hosted PTY`}</Code><p>Read the <Source path="docs/architecture/0001-hosted-arcade-terminal.md">hosted-terminal decision record</Source> before introducing a new host or credential path.</p></>,
      },
      {
        heading: 'When Arcade fits',
        body: <><ul><li>Terminal-first CPU-rendered 3D and hybrid ASCII graphics.</li><li>Retained, composable TUI controls over a moving scene.</li><li>Authoritative board-game rules shared by humans, models, tests, and replays.</li><li>Local, persistent self-play runs whose intermediate state can be inspected while they execute.</li></ul><p>Choose a GPU renderer, remote-desktop stack, or authoritative multiplayer service when that is the actual product. Arcade does not pretend its read-only website API is a remote game-control service.</p></>,
      },
    ],
  },
  {
    slug: 'engine',
    eyebrow: '01 / Core renderer',
    title: 'Render 3D with TypeScript and a CPU.',
    summary: 'Arcade transforms indexed meshes through programmable materials into a floating-point framebuffer, then samples that image into terminal cells.',
    sections: [
      {
        heading: 'Minimal scene',
        body: <><Code>{`import {
  RenderTarget, cameraMatrices, cube, flatShade,
  lambertMaterial, mat4Multiply, mat4RotY, normalize3,
  OrbitCamera, rasterize
} from '@vercel/arcade/engine'

const target = new RenderTarget(120, 80)
target.clear()
const model = mat4RotY(performance.now() / 1000)
const camera = new OrbitCamera({
  azimuth: .35, elevation: .42, distance: 6.7,
  target: { x: 0, y: 0, z: 0 }
}).toCamera({ fovy: Math.PI / 4, near: .05, far: 100 })
const { viewProjection } = cameraMatrices(camera, 120 / 80)

rasterize(target, flatShade(cube()), lambertMaterial, {
  mvp: mat4Multiply(viewProjection, model), model,
  lightDir: normalize3({ x: -.4, y: .8, z: .5 }),
  ambient: .25, wrap: .2
})`}</Code><p>The renderer has no scene-global singleton. You own the target, camera, draw order, and reusable scratch buffers. Start with <Source path="src/engine/index.ts">the engine barrel</Source> and follow direct module imports inside the library.</p></>,
      },
      {
        heading: 'Data model',
        body: <Api rows={[
          ['VertexIn', 'Position, normal, UV, and base color entering a material vertex program.'],
          ['Mesh', 'A vertex array plus triangle indices. Use cube, quad, tetrahedron, GeometryBuilder, BufferGeometry, or parseObj.'],
          ['Material<U>', 'A typed vertex/fragment shader pair plus blend and cull state—the extension point for every visual look.'],
          ['RenderTarget', 'Float RGB color storage plus depth. Opaque, additive, and alpha writes share one tested plot path.'],
          ['Surface', 'The final cell grid: glyph, foreground, background, style bits, opacity, and wide-character continuation.'],
        ]} />,
      },
      {
        heading: 'Geometry and imported models',
        body: <><p><code>GeometryBuilder</code> appends vertices, triangles, and quads without forcing a scene graph. <code>BufferGeometry</code> stores named position, normal, UV, and color attributes, update ranges, indices, and bounding spheres for repeated mutable geometry. <code>flatShade</code> rebuilds triangle soup with geometric face normals.</p><p><code>parseObj(text)</code> parses Wavefront OBJ text; asset transport intentionally stays outside the renderer. Browser callers fetch text, Node adapters may read a file, and both pass the same string to the parser.</p><Source path="src/engine/obj.ts" /><Source path="src/engine/buffer-geometry.ts" /></>,
      },
      {
        heading: 'Camera, picking, and animation',
        body: <><p><code>cameraMatrices</code> creates view, projection, and view-projection matrices from a plain camera. <code>OrbitCamera</code> owns input-agnostic orbit, pan, zoom, reset, eye, and basis math. <code>Raycaster</code> converts normalized screen coordinates into world rays and exposes plane and projected-shape helpers.</p><p><code>FrameClock</code>, <code>Tween</code>, <code>SpringValue</code>, and <code>AnimationScheduler</code> keep motion independent of the terminal loop. <code>travelPoint</code> is the shared parabolic path used for resources and cards.</p><Source path="src/engine/animation.ts" /></>,
      },
      {
        heading: 'Materials and color',
        body: <><p>Materials are the style hook. The same mesh becomes Lambert-lit geometry, felt, water, glass, a textured piece, a speech wisp, or a cover by changing shader code and uniforms—not by teaching the rasterizer about Arcade games.</p><p>Color helpers parse CSS-like colors, blend RGBA over RGB, interpolate palettes, and convert HSL. Terminal conversion is deliberately later: <code>rgbToAnsi256</code> and <code>applyTerminalColorMode</code> preserve hue while providing a 256-color fallback.</p><Source path="src/engine/materials.ts" /><Source path="src/engine/terminal-color.ts" /></>,
      },
      {
        heading: 'Continue through the pipeline',
        body: <p>The clipping, triangle fill, depth, supersampling, bloom, presenter, Surface, and diff stages are documented in <a href="/docs/renderer-pipeline">Renderer pipeline</a>.</p>,
      },
    ],
  },
  {
    slug: 'renderer-pipeline',
    eyebrow: '01a / Pipeline',
    title: 'From triangle to terminal cell.',
    summary: 'The rendering path is small enough to inspect end to end: transform, clip, rasterize, shade, post-process, sample, composite, and diff.',
    sections: [
      {
        heading: '1. Transform and near-plane clip',
        body: <><p>The material vertex function produces clip-space position plus world position, normal, UV, and color varyings. Triangles fully in front of <code>w = 1e-4</code> take a fast path. Intersecting triangles use Sutherland–Hodgman clipping, then fan-triangulate the resulting polygon.</p><Note>Clipping against <code>w</code> prevents geometry behind the camera from projecting through the perspective singularity. The allocation-free common path matters for dense Islanders scenes.</Note><Source path="src/engine/raster.ts" /></>,
      },
      {
        heading: '2. Rasterize and shade',
        body: <><p>Vertices are projected to screen coordinates. Back or front culling uses signed triangle area. A clamped bounding box visits pixel centers; edge functions produce barycentric coverage. Depth is interpolated first so opaque fragments can take an early-Z rejection before running a potentially expensive fragment shader.</p><p>Surviving varyings use perspective-correct interpolation. The fragment may discard or produce opaque, additive, or alpha output. <code>RenderTarget.plot</code> owns the final depth test and blend behavior.</p></>,
      },
      {
        heading: '3. Post-process and resolve',
        body: <><p><code>downsample</code> averages supersampled colors in linear light, converts them back to sRGB, and preserves nearest finite depth for sparse foreground layers. Reuse its optional output target to avoid per-frame allocations. <code>bloom</code> extracts bright pixels, applies separable box-blur passes, and adds the result back in place.</p><Api rows={[
          ['downsample(src, factor, out?)', 'Gamma-correct supersample resolve with a reusable output target.'],
          ['bloom(target, options)', 'Threshold, radius, passes, and intensity control a CPU bright-pass glow.'],
          ['ResourceCache', 'Reference-counted factories and disposers for reusable engine resources.'],
          ['ObjectPool', 'Reuses scene objects so animation-heavy systems avoid churn.'],
        ]} /></>,
      },
      {
        heading: '4. Choose a display mode',
        body: <><ul><li><strong>ASCII:</strong> reduces source pixels to a 3 by 6 brightness vector and chooses the glyph whose ink distribution is closest.</li><li><strong>Pixel:</strong> a <code>▀</code> stores the top pixel in foreground and bottom pixel in background, giving two vertical samples per cell.</li><li><strong>Hybrid:</strong> combines the ASCII glyph and full-fidelity foreground with a darker, quantized average-color background. Truly blank cells stay black.</li></ul><p>Surface presenters enable unified scene and UI compositing. <code>ShapeGlyphSurfaceCache</code> skips glyph search when a cell’s 3 by 6 samples are unchanged.</p></>,
      },
      {
        heading: '5. Composite and flush',
        body: <><p><code>Surface</code> draws text, wide glyphs, rectangles, clips, alpha backgrounds, and overlays. <code>Screen.frameComposited</code> caches an unchanged scene layer, paints retained UI, and asks <code>CellDiffer</code> for only changed cells. An idle frame writes nothing.</p><p>The native terminal host serializes those changed cells to ANSI. The homepage preserves that entire path by running the actual CLI in a PTY; xterm.js displays the emitted bytes without recreating Arcade’s cells in React.</p><Source path="src/engine/present-cells.ts" /><Source path="src/engine/surface.ts" /><Source path="src/engine/diff.ts" /></>,
      },
      {
        heading: 'Performance checklist',
        body: <ul><li>Render at the lowest source resolution that preserves the selected presenter.</li><li>Reuse RenderTargets, geometry, material instances, arrays, and downsample outputs.</li><li>Draw opaque geometry front-to-back to maximize early-Z wins.</li><li>Bound static scenes and cache stable glyph cells; do not shade land-hidden water.</li><li>Separate scene-dirty from UI-dirty frames so hover changes do not re-sample 3D.</li><li>Pause browser animation when examples are offscreen.</li><li>Benchmark by mode: pixel touches every half-block color pair; hybrid does ASCII matching plus background color state, so both cost more than plain ASCII.</li></ul>,
      },
    ],
  },
  {
    slug: 'tui',
    eyebrow: '02 / Interface',
    title: 'Retained UI over a live scene.',
    summary: 'Build plain component trees, lay them out into cells, paint them into Surface, and keep input semantics independent from ANSI.',
    sections: [
      {
        heading: 'Compose',
        body: <><Code>{`import { Box, FilledButton, Text } from '@vercel/arcade/tui'

const hud = Box({
  flexDirection: 'row', gap: 1, padding: [1, 2],
  background: 'surfaceChrome'
}, [
  Text({ text: 'white to move', style: { color: 'textStrong' } }),
  FilledButton({ id: 'reset', label: 'reset', onClick: reset })
])`}</Code><p>Nodes are plain data. Rebuild the tree each frame; <code>Screen</code> retains hover, focus, press, component state, pointer capture, scene cache, and cell diff state by stable IDs.</p></>,
      },
      {
        heading: 'Layout and paint',
        body: <><p>The layout engine resolves numeric, percentage, and intrinsic dimensions; row or column direction; gaps; padding; alignment; grow, shrink, and basis; absolute positioning; and overflow clips. Painting resolves semantic theme tokens, state overlays, borders, text overflow, scrims, alpha backgrounds, framebuffer callbacks, and floating overlays.</p><p>Scene and UI share one Surface. A modal can dim existing 3D glyphs instead of replacing them with a flat rectangle, while projected labels can opt out of pointer interception.</p></>,
      },
      {
        heading: 'Input and command semantics',
        body: <><p>The platform normalizes terminal escape sequences into key and mouse events before they reach TUI. <code>Keymap</code> maps chords to stable command IDs and supports layered contexts. Agents can invoke unbound command IDs such as navigation tools without inventing keystrokes. Browser hosts translate DOM pointer coordinates into the same normalized scene coordinates.</p><p><code>Screen</code> manages focus order, component ownership, outside-click behavior, pointer capture, wheel routing, and hit-testing. The shortcuts modal is generated from active bindings, so documentation cannot drift from the actual keymap.</p></>,
      },
      {
        heading: 'Portable Surface boundary',
        body: <p>Every cell stores glyph, foreground, background, style bits, opacity, and wide-character continuation. Terminal hosts serialize and diff it to ANSI. <code>CanvasSurfaceHost</code> draws it into a 2D canvas. Snapshot tools consume it headlessly. The <a href="/examples#tui">live retained-HUD example</a> uses real <code>Box</code>, <code>Text</code>, <code>Table</code>, <code>FilledButton</code>, <code>Screen</code>, and <code>Surface</code> imports.</p>,
      },
      {
        heading: 'Browse components',
        body: <p>See <a href="/docs/components">Component reference</a> for controls, persistent component lifecycle, overlays, tables, scrollboxes, inputs, dropdowns, tooltips, projected anchors, and escape hatches.</p>,
      },
    ],
  },
  {
    slug: 'components',
    eyebrow: '02a / Components',
    title: 'A toolkit for cell-constrained interfaces.',
    summary: 'Arcade components embrace terminal geometry: one glyph, one foreground, and one background per cell.',
    sections: [
      {
        heading: 'Primitive nodes',
        body: <Api rows={[
          ['Box(style, children)', 'Flex-like layout container, surface, border, clip, scrim, or overlay anchor.'],
          ['Text({ text, style })', 'Styled text with clip or ellipsis overflow.'],
          ['Button / RoundedButton / FilledButton', 'Focusable actions with hover, focus, pressed, and disabled state. Rounded controls use ink-only arcs; filled controls are intentionally square.'],
          ['FrameBuffer', 'A clipped callback for drawing custom cells inside a normal layout node.'],
          ['Slot(componentId)', 'Mount point for persistent components whose internal state survives tree rebuilds.'],
        ]} />,
      },
      {
        heading: 'Data and navigation',
        body: <Api rows={[
          ['Table', 'Fixed, auto, and flex columns with per-column alignment and row gaps.'],
          ['ScrollBox', 'Persistent vertical content offset, wheel and key handling, and scrollbar.'],
          ['Sidebar', 'Shared edge-panel chrome with layout insets rather than accidental scene overlap.'],
          ['Modal / Dialog', 'Overlay composition, scrim, close action, and shared dialog geometry.'],
          ['ASCIIFont', 'Large text built from cell glyphs for title treatments.'],
        ]} />,
      },
      {
        heading: 'Fields and feedback',
        body: <Api rows={[
          ['Input', 'Caret, selection, editing, focus lifecycle, and growing text state.'],
          ['Select / Dropdown', 'Keyboard-searchable option picking and floating overlay results.'],
          ['Slider', 'Pointer and key value control.'],
          ['Field', 'Shared label, hint, and validation furniture around controls.'],
          ['Tooltip', 'Passive or disabled-control explanations with cell-aware wrapping and placement.'],
          ['ProjectedAnchor', 'Positions retained UI from scene-projected coordinates while keeping layout and hit semantics.'],
        ]} />,
      },
      {
        heading: 'Themes and accessibility',
        body: <><p><code>Theme</code> exposes semantic surfaces, text roles, interaction states, selection, scrollbars, tooltips, scrim, and compatibility aliases. Prefer role names over game-specific RGB values in reusable components. Focus and disabled states are semantic rather than hover-only; wide glyph measurement prevents emoji from breaking column geometry.</p><p>Browser wrappers add DOM labels, keyboard controls, focus-visible styling, resize handling, and reduced-motion behavior while leaving cell rendering to Arcade.</p><Source path="src/tui/index.ts" /></>,
      },
    ],
  },
  {
    slug: 'game-harness',
    eyebrow: '03 / Agentic loop',
    title: 'Make games legible to models and debuggable by humans.',
    summary: 'Arcade separates authoritative rules, player-safe context, model decisions, public communication, visible animation, telemetry, and persistent local traces.',
    sections: [
      {
        heading: 'Game contract',
        body: <Code>{`interface GameState<Action> {
  currentPlayer(): number
  legalActions(): Action[]
  applyAction(action: Action): void
  isTerminal(): boolean
  returns(): number[]
  clone(): GameState<Action>
  toString(): string
  actionToString(action: Action): string
  actionFromString(text: string): Action | null
  decisionContextString?(player: number): string
}`}</Code>,
      },
      {
        heading: 'Perfect and imperfect information',
        body: <><p>Chess can expose the whole position. Poker implements <code>ImperfectInfoState</code>, which adds chance nodes and per-player information strings so another player’s hole cards never enter the prompt. Islanders supplies parameterized legal-action examples and player-safe resource and trade context.</p><p>The rule engine remains authoritative. Model output is parsed, normalized, validated, retried where appropriate, and only then applied. Presentation renders the resulting state; it does not define legality.</p></>,
      },
      {
        heading: 'Model decision ladder',
        body: <><p><code>ModelPlayer</code> receives the state the acting player is allowed to know, optional decision context, and legal-action vocabulary. Structured output is preferred when supported. Explicit marker-based text parsing preserves public communication for schema-incompatible models, while legal fallbacks prevent malformed output from corrupting state.</p><Note>A fallback-completed turn is traceable and does not count as model compatibility in the game audit. This keeps “the match continued” separate from “the target model produced a usable action.”</Note></>,
      },
      {
        heading: 'Communication and human pacing',
        body: <><p>Communication is a separate typed proposal: silent or speak, with intent, public text, optional addressees, and a private reason that never appears as table talk. Autoreply preserves the older action-by-action behavior. Ambient mode detects notable moments, allows model-chosen silence, applies host policy, supports bounded directed replies, and records proposals and suppression decisions.</p><p>Drivers synchronize model progression with visible dice, resource, card, trade, and construction animations. Models may decide quickly; the UI reveals intent at human-readable pace without changing authoritative game ordering.</p></>,
      },
      {
        heading: 'Self-play and persistent traces',
        body: <><Code>{`ARCADE_TELEMETRY=0 pnpm match:run -- \
  --game islanders --players 4 --communication ambient \
  --output .runs/islanders-4p`}</Code><p>Runs write a manifest, chronological events, per-match JSONL traces, result, canonical record or replay transcript, summary, and failures. Files appear while a match is active, enabling <code>tail -f</code> and mid-run inspection. Run directories are durable but gitignored. Read <a href="/docs/tools">Tools and self-play</a> for commands and privacy boundaries.</p></>,
      },
    ],
  },
  {
    slug: 'tools',
    eyebrow: '03a / Tools',
    title: 'Give humans and agents the same evidence.',
    summary: 'Snapshots, match-lab, model audits, render checks, and benchmarks turn visual or model-driven behavior into inspectable artifacts.',
    sections: [
      {
        heading: 'Visual snapshots',
        body: <><Code>{`pnpm snapshot:png 140 50 0.7
pnpm snapshot:png islanders 180 70 0.7
pnpm snapshot:png shortcuts chess`}</Code><p>Snapshot commands render one bounded frame instead of starting the infinite raw-mode app. They are the normal path for code review, regression checks, and agent visual QA. Outputs live under <code>.snapshots/</code>.</p></>,
      },
      {
        heading: 'Match lab',
        body: <><Code>{`pnpm match:run -- --game chess --games=4 --concurrency=2 --swap-seats
pnpm match:run -- --game poker --players=4 --starting-chips=1000
pnpm match:run -- --game islanders --players=4 --communication=ambient`}</Code><p>The lab reuses real rules, action parsers, normalizers, model catalog and authentication selection, game defaults, and canonical recorders. Random seeds are stored; external model calls remain nondeterministic. Concurrency is match-level, never within one game turn.</p><Source path="docs/match-lab.md">Complete match-lab guide</Source></>,
      },
      {
        heading: 'Model compatibility',
        body: <><p><code>pnpm models:audit</code> probes provider and structured-output compatibility. <code>pnpm models:game-audit</code> combines the team-aware catalog with real Chess, Poker, and Islanders adapters and classifies structured, text, normalized, fallback, access, timeout, error, and no-action outcomes.</p><p>The audit targets each model in a bounded scenario rather than assuming a static hard-coded list remains compatible forever.</p></>,
      },
      {
        heading: 'Benchmarks and game-specific checks',
        body: <Api rows={[
          ['pnpm bench', 'Renderer and presenter timing for high-resolution performance work.'],
          ['pnpm islanders:check', 'Bounded Islanders render and performance correctness check.'],
          ['src/tools/wisp-audit.ts', 'Inspects speech-wisp behavior without manual terminal play.'],
          ['src/tools/edge-check.ts', 'Validates geometry edge behavior.'],
          ['src/tools/perft.ts', 'Counts Chess rule-tree nodes for move-generation correctness.'],
        ]} />,
      },
      {
        heading: 'Privacy and telemetry',
        body: <><p>Match-lab forces telemetry off. Local traces may contain prompts, model attempts, private reasoning, public communication, hands, and intermediate state; they must not be committed or uploaded as production telemetry. Arcade telemetry separately records anonymous usage and canonical game records only—never prompts, reasoning, chat, voice, or account identity.</p><p>Credentials are resolved by the CLI’s Vercel device flow and selected team. They never enter the browser bundle, docs examples, repository, or run manifest.</p></>,
      },
    ],
  },
  {
    slug: 'browser-host',
    eyebrow: '04 / Host adapter',
    title: 'Run the actual CLI in the browser.',
    summary: 'The homepage connects xterm.js to an isolated PTY containing the package; focused examples continue to use browser-safe imports.',
    sections: [
      {
        heading: 'Use the hosted shell',
        body: <Code>{`$ ls
README.md  docs  examples

$ cd docs
$ cat README.md

$ arcade
# launches the packaged CLI in the same PTY`}</Code>,
      },
      {
        heading: 'What is shared',
        body: <p>The homepage shares the complete CLI: launcher, games, renderer, TUI, key and mouse parsing, model harness, and ANSI output. The site owns only Sandbox lifecycle, xterm sizing, the WebSocket bridge, and surrounding prose. Focused examples use browser-safe mini scenes: the site owns the canvas lifecycle, while Arcade still owns the geometry, camera, rasterization, and terminal cells.</p>,
      },
      {
        heading: 'Security boundary',
        body: <p>The public demo is local two-player Chess. It does not embed an AI Gateway key or simulate model responses. Browser AI play needs an authenticated, rate-limited server contract plus explicit telemetry and abuse policy before it can be enabled. Until that exists, the honest blocker is product architecture—not a fake client-side agent.</p>,
      },
      {
        heading: 'Isolation and credentials',
        body: <><p>Each visitor receives a temporary Sandbox fork. The shell and Arcade process use separate unprivileged users. The real Gateway credential stays in the Sandbox network policy; the process sees only a random placeholder, and telemetry is disabled. General shell egress is denied.</p><Source path="docs/architecture/0001-hosted-arcade-terminal.md">ADR 0001</Source></>,
      },
    ],
  },
  {
    slug: 'examples',
    eyebrow: '05 / Gallery',
    title: 'Examples are small systems, not screenshots.',
    summary: 'Each advertised example identifies its imports, real source, controls, and the production Arcade feature that already uses the same primitive.',
    sections: [
      {
        heading: 'Run the live gallery',
        body: <><p><a href="/examples">Open interactive examples</a> for the complete Chess board, an imported Chess asset, all 6 Islanders terrain systems, the production Poker chip stack, and the prism stream. The gallery is deliberately organized around things Arcade actually ships—not generic renderer demos.</p><div className="example-grid"><Example glyph="♞" title="Chess" text="The complete board plus an isolated imported knight asset." /><Example glyph="⬡" title="Islanders" text="Fields, forest, pasture, hills, mountains, and desert terrain." /><Example glyph="●" title="Poker" text="The real chip geometry, denomination model, and pile layout." /><Example glyph="◢" title="Prism" text="The standalone ANSI stream rendered with terminal semantics." /></div></>,
      },
      {
        heading: 'Embed a focused Arcade scene',
        body: <><Code>{`import {
  CanvasSurfaceHost,
  createBrowserMiniScene
} from '@vercel/arcade/web'

const scene = createBrowserMiniScene('islanders-fields')
const host = new CanvasSurfaceHost(canvas)
const frame = scene.frame(58, 34, performance.now() / 1000)

host.resize(canvas.clientWidth, canvas.clientHeight, 58, 34)
host.draw(frame.surface)`}</Code><p>Use one host component for resize, visibility, reduced motion, pointer orbit, zoom, and reset. Add a new scene inside Arcade only when it exposes a reusable visual boundary. Production geometry should live below <code>src/arcade</code> so both the terminal application and <code>@vercel/arcade/web</code> can consume it without reversing the import graph.</p></>,
      },
      {
        heading: 'Production systems to study',
        body: <><p>Some systems are documented before they are exposed as browser mini-scenes. Keep these app-level until a browser-safe, reusable boundary can be extracted without importing the terminal shell or game controller.</p><div className="example-grid"><Example glyph="⬡" title="Islanders board" text="Island assembly, number tokens, ports, cached water, and projected labels." /><Example glyph="▤" title="Cards" text="Peek, reveal, parabolic flight, shuffle geometry, and retained hit targets." /><Example glyph="↔" title="Cover flow" text="Projected hit bounds, horizontal and vertical wheel input, and launch flip." /><Example glyph="⇅" title="Trade and discard" text="Resource rows, constraints, animated transfers, and model playback." /></div></>,
      },
      {
        heading: 'Example standard',
        body: <ul><li>Import public Arcade modules instead of copying engine or game logic into the website.</li><li>Provide controls, reset behavior, responsive sizing, focus labels, and reduced-motion behavior.</li><li>Name the source file and API subpaths used.</li><li>Add focused source tests and a packed-consumer smoke test before promising a stable public API.</li><li>Extract only browser-safe geometry and state; terminal shell, auth, voice, telemetry, and full-game orchestration stay out of mini scenes.</li></ul>,
      },
      {
        heading: 'Machine-readable catalog',
        body: <p>Agents can discover examples through <a href="/examples.json">/examples.json</a>, validate the shape with <a href="/schemas/examples-v1.json">its JSON schema</a>, and read the broader offline corpus at <a href="/llms-full.txt">/llms-full.txt</a>.</p>,
      },
    ],
  },
];

function Example({ glyph, title, text }: { glyph: string; title: string; text: string }) {
  return <article className="example-card"><div aria-hidden="true">{glyph}</div><strong>{title}</strong><p>{text}</p></article>;
}

export function findDoc(slug: string): DocPage | undefined { return DOCS.find((page) => page.slug === slug); }
