import type { ReactNode } from 'react';
import { Mermaid } from '@vercel/geistdocs/components/mermaid';
import { CodeBlock } from './docs-code';

export interface DocSection { heading: string; body: ReactNode }
export interface DocPage { slug: string; label: string; title: string; summary: string; sections: DocSection[]; body?: ReactNode; navParent?: string; navGroup?: string }

const REPO = 'https://github.com/vercel-labs/arcade/blob/main/';
const Code = ({ children, title, language }: { children: string; title?: string; language?: 'typescript' | 'bash' | 'text' }) => <CodeBlock language={language} title={title}>{children}</CodeBlock>;
const Source = ({ path, children }: { path: string; children?: ReactNode }) => <a className="source-link" href={`${REPO}${path}`} rel="noreferrer" target="_blank">{children ?? path} ↗</a>;
const Note = ({ children }: { children: ReactNode }) => <aside className="doc-note">{children}</aside>;
const Api = ({ rows }: { rows: [string, string][] }) => <dl className="api-list">{rows.map(([name, description]) => <div key={name}><dt><code>{name}</code></dt><dd>{description}</dd></div>)}</dl>;
const ARCHITECTURE_CHART = `flowchart TB
  subgraph complete["Complete Arcade"]
    direction LR
    fullLayers["Reusable layers<br/>Engine · Terminal platform · Terminal UI<br/>Rules · Game harness · Game visuals"]
    cli["Arcade CLI"]
    local["Local terminal<br/>ANSI"]
    hosted["Browser host<br/>isolated PTY + xterm.js"]
    fullLayers --> cli
    cli --> local
    cli --> hosted
  end

  subgraph focused["Focused browser surfaces"]
    direction LR
    browserLayers["Browser-safe layers<br/>Engine · Terminal UI · Rules · Game visuals"]
    browser["Browser API"]
    canvas["Canvas"]
    browserLayers --> browser
    browser --> canvas
  end
  complete ~~~ focused`;
const MOBILE_ARCHITECTURE_CHART = `flowchart TB
  full["Complete Arcade<br/>all reusable layers"] --> cli["Arcade CLI"]
  cli --> local["Local terminal<br/>ANSI"]
  cli --> hosted["Browser host<br/>isolated PTY + xterm.js"]
  hosted ~~~ focused["Focused browser surfaces<br/>browser-safe layers"]
  focused --> browser["Browser API"]
  browser --> canvas["Canvas"]`;

const ArchitectureDiagram = () => <figure className="doc-architecture">
  <div className="doc-architecture__diagram doc-architecture__diagram--desktop"><Mermaid chart={ARCHITECTURE_CHART} /></div>
  <div className="doc-architecture__diagram doc-architecture__diagram--mobile"><Mermaid chart={MOBILE_ARCHITECTURE_CHART} /></div>
  <figcaption>Two delivery paths from the same reusable package: the complete CLI and focused browser-safe scenes.</figcaption>
</figure>;

export const CORE_DOCS: DocPage[] = [
  {
    slug: '',
    label: 'Overview',
    title: 'Arcade documentation',
    summary: 'Learn how Arcade turns a terminal into a CPU-rendered 3D game surface for humans and agents, then use each layer independently or compose the complete stack.',
    sections: [
      {
        heading: 'Start here',
        body: <><p>Arcade is both an application and a set of reusable TypeScript layers. Install the CLI when you want to play, spectate, or run the complete product. Import a package subpath when you want to build a renderer, terminal interface, game, model harness, or browser presentation of your own.</p><Code title="Terminal">{`npm i -g @vercel/arcade
arcade`}</Code><p>To try the latest version once without installing a global command, run <code>npx @vercel/arcade@latest</code>. Arcade requires Node.js 22 or newer and a terminal with truecolor support for the intended presentation. The renderer itself is CPU-only: there are no native graphics dependencies and no GPU requirement.</p></>,
      },
      {
        heading: 'Choose what to build',
        body: <><div className="doc-cards">
          <a href="/docs/engine"><strong>Render a scene</strong><span>Geometry, cameras, materials, rasterization, and terminal-cell presentation</span></a>
          <a href="/docs/tui"><strong>Build an interface</strong><span>Retained components, layout, focus, input, and Surface composition</span></a>
          <a href="/docs/game-harness"><strong>Run models in games</strong><span>Rules contracts, player-safe context, decisions, communication, and records</span></a>
          <a href="/docs/game-visuals"><strong>Reuse game visuals</strong><span>Production geometry, asset loading, layouts, and animation choreography</span></a>
          <a href="/docs/tools"><strong>Develop with agents</strong><span>Headless runners, bounded snapshots, artifacts, and deterministic checks</span></a>
          <a href="/docs/web"><strong>Integrate with the browser</strong><span>Focused Canvas scenes or the complete CLI in an isolated browser terminal</span></a>
        </div><Code title="TypeScript">{`npm install @vercel/arcade

import { Surface } from '@vercel/arcade/engine'
import { Box, Text } from '@vercel/arcade/tui'
import { ChessState } from '@vercel/arcade/rules/chess'
import { runMatch } from '@vercel/arcade/harness'
import {
  CanvasSurfaceHost, createBrowserMiniScene
} from '@vercel/arcade/web'`}</Code><Note>The package currently has restricted npm access while its public beta is being finalized. These documented subpaths are the supported consumer boundary; repository-internal <code>src/</code> paths are not public APIs.</Note></>,
      },
      {
        heading: 'Understand the architecture',
        body: <><p>Arcade has two delivery paths. The full CLI composes the reusable graphics, terminal interface, rules, game harness, and game visuals, then writes ANSI to a local terminal or runs unchanged inside the website’s isolated PTY. The Browser API imports browser-safe package layers and renders focused scenes directly to Canvas instead of loading the full application.</p><ArchitectureDiagram /><p>Read the <Source path="docs/architecture/0001-hosted-arcade-terminal.md">hosted-terminal decision record</Source> before introducing a new host or credential path.</p></>,
      },
      {
        heading: 'Explore the documentation',
        body: <><ul><li>Start with <a href="/docs/getting-started">Getting started</a> to install the CLI, sign in, or run from source.</li><li>Open <a href="/docs/app">Using Arcade</a> to learn the launcher, tutorial, controls, model setup, teams, and billing.</li><li>Study <a href="/docs/games">Games</a> for complete Chess, Poker, and Islanders case studies, shared rules, and model communication.</li><li>Continue through <a href="/docs/engine">Rendering engine</a> and <a href="/docs/renderer-pipeline">Rendering pipeline</a> to understand how meshes become terminal cells.</li><li>Reuse <a href="/docs/game-visuals">Game visuals</a> when a new host needs Arcade’s production boards, cards, pieces, or motion.</li><li>Use <a href="/docs/platform">Terminal platform</a>, <a href="/docs/tui">Terminal UI</a>, and <a href="/docs/components">Components</a> to own terminal lifecycle and place interactive UI over a live scene.</li><li>Start with <a href="/docs/game-harness">Game harness</a> when rules, models, human players, or reproducible match records are the primary problem.</li><li>Use <a href="/docs/tools">Agentic tooling</a> to give coding agents bounded snapshots, structured artifacts, and inspectable self-play.</li><li>Choose <a href="/docs/web">Browser integration</a> for focused Canvas scenes or the complete CLI hosted in an isolated PTY.</li><li>Follow a <a href="/docs/guides">Guide</a> for an end-to-end workflow, then use <a href="/docs/package-api">Package API</a> and <a href="/docs/reference">API Reference</a> for exact lookup.</li></ul><p>Arcade fits terminal-first graphics and agent-playable games. Choose a GPU renderer, remote-desktop stack, or authoritative multiplayer service when those are the actual requirements.</p></>,
      },
    ],
  },
  {
    slug: 'getting-started',
    label: 'Getting started',
    title: 'Getting started',
    summary: 'Install Arcade, launch the terminal application, sign in for model play, and choose the package layer that matches what you want to build.',
    sections: [
      {
        heading: 'Before you start',
        body: <><ul><li>Use Node.js 22 or newer.</li><li>Run Arcade in a terminal with truecolor support for the intended presentation; 256-color terminals receive a compatible fallback.</li><li>You do not need a Vercel account to open Arcade or complete most of the offline-first Tutorial.</li><li>Real model seats require a Vercel account that belongs to at least one team. The selected team owns the generated AI Gateway key and model usage.</li></ul><p>After valid card verification, the AI Gateway Free tier grants $5 every 30 days for a changing subset of models with lower limits. Read <a href="/docs/app/models">Models, teams, and billing</a> before selecting paid models or troubleshooting access.</p></>,
      },
      {
        heading: 'Install the CLI',
        body: <><p>Arcade requires Node.js 22 or newer. Install the package globally when you plan to return, then launch it from any terminal.</p><Code title="Terminal">{`npm i -g @vercel/arcade
arcade`}</Code><p>For a one-off run, <code>npx @vercel/arcade@latest</code> downloads and launches the newest published version without leaving a global <code>arcade</code> command behind.</p><Code title="Terminal">{`npx @vercel/arcade@latest`}</Code><p>The first screen is a CPU-rendered prism followed by the game launcher. Keyboard and mouse input both work; open the in-app menu to see the active controls for the current screen.</p><Note>The npm package currently has restricted access while the public beta is finalized. If npm cannot resolve the package for your account, clone the repository and use the development workflow below.</Note></>,
      },
      {
        heading: 'Run from source',
        body: <><p>Use the repository workflow when contributing to Arcade or inspecting unreleased work. The application is a full-screen raw-mode TTY, so use snapshots, not redirected terminal output, to review visuals.</p><Code title="Terminal">{`git clone https://github.com/vercel-labs/arcade.git
cd arcade
pnpm install
pnpm dev`}</Code><Code title="Terminal">{`pnpm snapshot:png 140 50 0.7
pnpm snapshot:png islanders 180 70 0.7`}</Code><p>Snapshot output is written under <code>.snapshots/</code>. A development run also appends internal test surfaces to Cover Flow and labels each one <strong>dev only</strong>; published installs hide them. Continue to <a href="/docs/tools">Agentic tooling</a> for bounded render checks, self-play, and model audits.</p></>,
      },
      {
        heading: 'Enable model play',
        body: <><p>Arcade uses Vercel device authorization rather than asking you to paste a credential. On first model-enabled launch, follow the browser prompt, select the Vercel team that should own AI Gateway usage, and return to the terminal. Arcade automatically obtains a team-scoped AI Gateway key, then refreshes the model picker from an availability-aware team catalog.</p><Code title="Terminal">{`arcade --login
arcade --switch-team
arcade --logout`}</Code><p>The session is cached in <code>~/.config/arcade/auth.json</code>. The minted AI Gateway key is re-derived instead of stored. An unrelated <code>AI_GATEWAY_API_KEY</code> inherited from your shell is intentionally ignored. Continue to <a href="/docs/app/models">Models, teams, and billing</a> for key naming, free and paid access, spend links, and health-check failures.</p></>,
      },
      {
        heading: 'Play your first game',
        body: <><p>From Cover Flow, open the Tutorial to learn camera movement, menus, global keys, Chess, Poker, and Islanders on their real screens. The walkthrough uses local practice bots by default and skips its optional Gateway steps when you are signed out.</p><p>To start a model match instead, open a game and choose New match. Arcade suggests a creator for each AI seat, but waits for you to choose every model before Start is available. It then tests each unique selected model, so a billing or routing problem remains recoverable in setup.</p><p>Continue to <a href="/docs/app">Using Arcade</a> for the complete app flow and <a href="/docs/games">Games</a> for detailed rules and technical case studies.</p></>,
      },
      {
        heading: 'Use Arcade as a library',
        body: <><p>Install the package locally when your application needs only part of Arcade. Import supported subpaths instead of reaching into <code>src/</code>.</p><Code title="Terminal">{`npm install @vercel/arcade`}</Code><Api rows={[
          ['@vercel/arcade/engine', 'CPU rasterization, geometry, materials, cameras, animation, terminal presenters, and Surface.'],
          ['@vercel/arcade/tui', 'Retained terminal components, layout, focus, input, and compositing.'],
          ['@vercel/arcade/rules/*', 'Presentation-independent Chess, Poker, and Islanders rules.'],
          ['@vercel/arcade/harness', 'Human and model players, match execution, communication, and records.'],
          ['@vercel/arcade/game-visuals/*', 'Production geometry, layouts, asset loaders, and reusable game animation plans.'],
          ['@vercel/arcade/engine/png', 'Node-only PNG decoding and encoding, intentionally separate from the browser-safe engine barrel.'],
          ['@vercel/arcade/web', 'Browser-safe Canvas presentation and focused scene adapters.'],
        ]} /><p>Continue to <a href="/docs/engine">Rendering engine</a> for your first mesh or <a href="/docs/game-harness">Game harness</a> for an agent-playable game loop.</p></>,
      },
    ],
  },
  {
    slug: 'package-api',
    label: 'Package API',
    title: 'Package API',
    summary: 'Choose the supported npm subpath for each reusable layer and distinguish stable consumer APIs from repository-only Arcade tooling.',
    sections: [
      {
        heading: 'Import from a public subpath',
        body: <><p>The package export map is the compatibility boundary. If a path is listed here, a consumer can import it from the packed npm artifact without reaching into <code>src/</code>. A source file being exported from an internal barrel does not make that source path public.</p><Code>{`import { RenderTarget, Surface } from '@vercel/arcade/engine'
import { Screen, Box, Text } from '@vercel/arcade/tui'
import { ChessState } from '@vercel/arcade/rules/chess'
import { runHeadlessChessMatch } from '@vercel/arcade/harness/chess'`}</Code><Note>The package currently publishes with restricted access. The boundaries below describe what the packed artifact exposes; they do not imply that every npm user can install the beta today.</Note></>,
      },
      {
        heading: 'Core and host subpaths',
        body: <Api rows={[
          ['@vercel/arcade', 'Browser-safe convenience entry: engine and TUI namespaces plus CanvasSurfaceHost and packaged browser showcases.'],
          ['@vercel/arcade/engine', 'Browser-safe math, shaders, CPU rasterization, scene objects, materials, animation, picking, effects, Surface, presenters, and terminal color helpers.'],
          ['@vercel/arcade/engine/png', 'Node-only decodePng and encodePng for 8-bit non-interlaced PNGs, plus Texture sampling. Uses node:zlib.'],
          ['@vercel/arcade/tui', 'The browser-safe retained TUI API plus the Node terminal Renderer. Use individual named imports.'],
          ['@vercel/arcade/platform', 'Raw input parsing, terminal-color detection/probing, and alternate-screen enter/leave helpers. Node terminal applications only.'],
          ['@vercel/arcade/web', 'Canvas Surface presentation, responsive grids, xterm width parity, browser showcases, cinematic clocks, and pointer effects.'],
        ]} />,
      },
      {
        heading: 'Rules and harness subpaths',
        body: <Api rows={[
          ['@vercel/arcade/rules', 'Generic Game, GameState, ImperfectInfoState, TERMINAL, and CHANCE contracts.'],
          ['@vercel/arcade/rules/chess', 'ChessState, chessGame, board constants/types, square helpers, and SAN/UCI conversion.'],
          ['@vercel/arcade/rules/poker', 'HoldemState, holdemGame, cards/deck, hand evaluation, actions, records, and blind structures.'],
          ['@vercel/arcade/rules/islanders', 'IslandersState, islandersGame, actions, topology, setup, placement, development cards, production, and maritime trade.'],
          ['@vercel/arcade/harness', 'Player, HumanPlayer, ModelPlayer, runMatch, diagnostics, error classification, and common canonical records.'],
          ['@vercel/arcade/harness/communication', 'Public conversation, communication proposals, ambient/autoreply policy, moments, and coordination.'],
          ['@vercel/arcade/harness/chess', 'Chess model-player factory, bounded scene/headless runners, salience, notation, hooks, results, and recorder.'],
          ['@vercel/arcade/harness/poker', 'Production text-player factory and complete headless multi-hand tournament session with records and events.'],
          ['@vercel/arcade/harness/islanders', 'Model-player factories, initial-placement/full-match runners, communication helpers, bounds, hooks, and results.'],
          ['@vercel/arcade/harness/records', 'Complete versioned Chess, Poker, and Islanders canonical record types.'],
        ]} />,
      },
      {
        heading: 'Game visual subpaths',
        body: <><Api rows={[
          ['@vercel/arcade/game-visuals', 'Namespaced chess, poker, and islanders modules plus transport-injected OBJ loading helpers.'],
          ['@vercel/arcade/game-visuals/chess', 'Piece assets/metrics and deterministic move plans for captures, castling, en passant, jail placement, and arcs.'],
          ['@vercel/arcade/game-visuals/poker', 'Cards, chips, table assets, seat/card/stack layout, shuffle, collection, muck, and award motion.'],
          ['@vercel/arcade/game-visuals/islanders', 'Tiles, coast/water/harbors, pieces, dice overlay/choreography, board setup timing, and robber motion.'],
        ]} /><p>These modules share production geometry without exporting the complete Arcade application scenes or HUDs. See <a href="/docs/game-visuals">Game visuals</a> for the composition boundary.</p></>,
      },
      {
        heading: 'What is not a package API',
        body: <><p><code>src/arcade</code>, <code>src/tools</code>, <code>src/cinematic</code>, authentication, telemetry delivery, voice I/O, and prism deployment code are not npm subpaths. Contributors may run their commands from a checkout, but consumers should not deep-import them.</p><p>In particular, the snapshot CLI and match-lab artifact orchestrator are repository tools. The underlying render, Surface, rules, Player, game-specific headless runner, and canonical record primitives are public and can support equivalent tooling in another project.</p></>,
      },
    ],
  },
  {
    slug: 'engine',
    label: 'Engine',
    title: 'Rendering engine',
    summary: 'Render indexed 3D meshes with programmable TypeScript materials on the CPU, then present the framebuffer as terminal cells or browser canvas output.',
    sections: [
      {
        heading: 'Render a mesh',
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
          ['Material<U>', 'A typed vertex and fragment shader pair plus blend and cull state. This is the extension point for every visual look.'],
          ['RenderTarget', 'Float RGB color storage plus depth. Opaque, additive, and alpha writes share one tested plot path.'],
          ['Surface', 'The final cell grid: glyph, foreground, background, style bits, opacity, and wide-character continuation.'],
        ]} />,
      },
      {
        heading: 'RenderTarget',
        body: <><Code>{`const target = new RenderTarget(width, height)
target.clear(0, 0, 0)

// Usually called through rasterize(); exposed for custom raster work.
target.plot(x, y, depth, { r: 255, g: 160, b: 80, a: 1 }, 'opaque')`}</Code><p><code>RenderTarget</code> stores RGB channels as <code>Float32Array</code> values in the 0–255 range and depth as one float per pixel. <code>clear()</code> resets color, depth to <code>Infinity</code>, and finite-depth bounds. <code>resize()</code> reallocates only when dimensions change.</p><Api rows={[
          ['opaque', 'Rejects fragments at equal or greater depth, writes color and depth, and expands finite-depth bounds.'],
          ['add', 'Depth-tests against opaque geometry, adds color × alpha, and does not write depth.'],
          ['alpha', 'Depth-tests, composites source over destination, and does not write depth.'],
        ]} /><p>Draw opaque geometry front-to-back when possible. Additive and alpha layers can accumulate behind each other but remain occluded by nearer opaque depth.</p></>,
      },
      {
        heading: 'Material contract',
        body: <><Code>{`interface Material<Uniforms> {
  vertex(uniforms: Uniforms, vertex: VertexIn): Varying
  fragment(uniforms: Uniforms, varying: Varying): RGBA8 | null
  blend?: 'opaque' | 'add' | 'alpha'
  cull?: 'back' | 'front' | 'none'
}`}</Code><p>A material is the renderer’s visual extension point. The vertex function returns clip position plus world position, normal, UV, color, and barycentric data. The rasterizer perspective-correctly interpolates those varyings. Returning <code>null</code> from the fragment function discards the pixel.</p><p>Uniforms are caller-owned typed data. The renderer does not maintain global time, camera, or lighting state; pass every value the material needs. Built-in Lambert, felt, water, glass, piece, wisp, and cover materials are ordinary implementations of this contract.</p></>,
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
        heading: 'Math, optics, and interaction utilities',
        body: <><Api rows={[
          ['math', 'Vec2/3/4, Mat4 construction/multiplication, transforms, vector arithmetic, normalization, dot/cross, length, and scalar clamp.'],
          ['optics', 'Fresnel transmission, dielectric IOR, reflection/refraction, prism topology, and wavelength-to-RGB helpers.'],
          ['light-field', 'Add soft points, segments, localized edge light, and sampled spectral ribbons directly to a RenderTarget.'],
          ['pointer-field', 'Persistent pointer bursts/trails and deterministic field sampling for Surface effects.'],
          ['interaction', 'Nearest-hit selection, hysteresis thresholds, and sticky-hover resolution for noisy projected geometry.'],
          ['random', 'Seedable mulberry32 plus stable scalar and two-dimensional hashes.'],
          ['color / texture / logo', 'Color parsing/blending/interpolation, RGBA8 texture sampling, and alpha-mask analysis/baking.'],
        ]} /><p>These are renderer-neutral functions rather than hidden helpers. Import them by name from <code>@vercel/arcade/engine</code> when building custom materials, pickers, effects, deterministic tests, or asset preprocessing.</p></>,
      },
      {
        heading: 'Scene objects and resources',
        body: <><p>The low-level path calls <code>rasterize()</code> directly. The optional scene layer adds <code>Object3D</code>, <code>Group</code>, <code>MeshObject</code>, <code>InstancedMesh</code>, material instances, world-uniform sources, and <code>SceneRenderer</code> without changing the rasterizer.</p><Api rows={[
          ['ResourceCache', 'Creates resources by key, tracks references, and calls a disposer when the final lease is released.'],
          ['ObjectPool', 'Reuses short-lived scene objects to reduce allocation during animation.'],
          ['BufferGeometry', 'Named mutable attributes, optional indices, update ranges, and a bounding sphere.'],
          ['GeometryBuilder', 'Append-oriented vertices, triangles, and quads for procedural geometry.'],
        ]} /><p>Create meshes, materials, and targets once. Update transforms, uniforms, or bounded attributes per frame. Rebuilding static geometry in the render loop is both slower and harder to inspect.</p></>,
      },
      {
        heading: 'Materials and color',
        body: <><p>Materials are the style hook. The same mesh becomes Lambert-lit geometry, felt, water, glass, a textured piece, a speech wisp, or a cover by changing shader code and uniforms, without teaching the rasterizer about Arcade games.</p><p>Color helpers parse CSS-like colors, blend RGBA over RGB, interpolate palettes, and convert HSL. Terminal conversion is deliberately later: <code>rgbToAnsi256</code> and <code>applyTerminalColorMode</code> preserve hue while providing a 256-color fallback.</p><Source path="src/engine/materials.ts" /><Source path="src/engine/terminal-color.ts" /></>,
      },
      {
        heading: 'Present terminal cells',
        body: <><p>Rendering and presentation use different resolutions. Pixel mode expects one source pixel per horizontal cell and two per row. ASCII and hybrid normally render a 3×6 sample region per terminal cell so glyph matching has enough spatial information.</p><Api rows={[
          ['halfBlockToSurface', 'Writes ▀ with the top pixel as foreground and bottom pixel as background.'],
          ['shapeGlyphToSurface', 'Chooses the glyph whose 3×6 ink pattern best matches source luminance.'],
          ['luminanceToSurface', 'Maps scalar brightness through a fixed glyph ramp.'],
          ['ShapeGlyphSurfaceCache', 'Reuses glyph/color results for cells whose complete source sample region is unchanged.'],
          ['CellDiffer', 'Compares complete Surface cells and emits ANSI only for changed runs.'],
        ]} /><p><code>blankOutsideDepthBounds</code> lets sparse layers leave untouched areas black without sampling the complete target. Disable glyph caching when stochastic jitter is active, because identical colors no longer imply identical output.</p></>,
      },
      {
        heading: 'Continue through the pipeline',
        body: <p>The clipping, triangle fill, depth, supersampling, bloom, presenter, Surface, and diff stages are documented in <a href="/docs/renderer-pipeline">Renderer pipeline</a>.</p>,
      },
    ],
  },
  {
    slug: 'renderer-pipeline',
    label: 'Rendering pipeline',
    title: 'Rendering pipeline',
    summary: 'Follow a frame from vertex transformation and triangle rasterization through shading, post-processing, terminal-cell sampling, composition, and incremental output.',
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
        heading: 'Browser-safe scenes',
        body: <><p><code>@vercel/arcade/web</code> adapts the same geometry, cameras, rules, cinematic timing, and terminal-cell surfaces to Canvas. The homepage composes the prism, Cover Flow, Chess, Poker, and Islanders from those shared layers; it is the replacement for the former standalone examples gallery.</p><p>Use <code>CanvasSurfaceHost</code> for a focused browser surface and keep reusable scene logic below <code>src/arcade</code>. Browser hosts should own only image decoding, Canvas presentation, pointer input, visibility, and resize behavior.</p><Source path="src/web/index.ts" /><Source path="src/web/living-title-scene.ts" /></>,
      },
      {
        heading: 'Performance checklist',
        body: <ul><li>Render at the lowest source resolution that preserves the selected presenter.</li><li>Reuse RenderTargets, geometry, material instances, arrays, and downsample outputs.</li><li>Draw opaque geometry front-to-back to maximize early-Z wins.</li><li>Bound static scenes and cache stable glyph cells; do not shade land-hidden water.</li><li>Separate scene-dirty from UI-dirty frames so hover changes do not re-sample 3D.</li><li>Pause browser animation when surfaces are offscreen.</li><li>Benchmark by mode: pixel touches every half-block color pair; hybrid does ASCII matching plus background color state, so both cost more than plain ASCII.</li></ul>,
      },
    ],
  },
  {
    slug: 'platform',
    label: 'Terminal platform',
    title: 'Terminal platform',
    summary: 'Normalize raw terminal input, detect color capability, and safely enter and leave Arcade’s alternate-screen runtime.',
    sections: [
      {
        heading: 'Parse input',
        body: <><Code>{`const parse = createInputParser({
  onKey(event) { screen.handleKey(event) },
  onMouse(event) { routeMouse(event) }
})

process.stdin.on('data', parse)`}</Code><p>The parser accepts arbitrary chunks because escape sequences may be split across reads. It buffers incomplete CSI or SGR mouse sequences and emits normalized events only when complete.</p><Api rows={[
          ['KeyEvent.name', 'Lowercase letters or named keys such as up, escape, enter, tab, space, backspace, home, end, and delete.'],
          ['KeyEvent.raw', 'Literal typed character for text input, preserving case and punctuation. Empty for pure escape sequences.'],
          ['ctrl / shift / meta / super', 'Normalized modifier state, including xterm/Kitty CSI modifier parameters.'],
          ['MouseEvent.type', 'down, up, drag, move, or wheel from SGR 1006 coordinates.'],
          ['wheel / wheelAxis', 'Direction and vertical/horizontal axis for mouse wheel buttons 64–67.'],
        ]} /><p>Terminal coordinates are one-based at this boundary. <code>Screen</code> converts them to zero-based local cell coordinates.</p></>,
      },
      {
        heading: 'Detect terminal color',
        body: <><p><code>detectTerminalColorMode()</code> returns <code>truecolor</code> or <code>256-color</code>. It accepts strong environment signals from known terminals, but does not blindly trust outer-terminal variables inside tmux or screen.</p><p>When capability is uncertain, Arcade sends a bounded DECRQSS SGR probe in raw mode and parses whether the terminal reports the exact RGB background. Non-TTY streams and probe timeouts safely fall back to 256 colors.</p><Code>{`const mode = await detectTerminalColorMode()
const frame = applyTerminalColorMode(ansiFrame, mode)`}</Code></>,
      },
      {
        heading: 'Enter and leave raw mode',
        body: <><p><code>enterTerminal()</code> switches to the alternate screen, hides the cursor, enables SGR mouse motion, forces the default background to black, and enables raw stdin. <code>leaveTerminal()</code> reverses every setting.</p><p>Cleanup is registered for normal exit, SIGINT, SIGTERM, and uncaught exceptions. Both functions are idempotent. Applications embedding this platform layer must still structure their own startup and shutdown so <code>leaveTerminal()</code> is reached after recoverable failures.</p><Note>Do not enable mouse mode or raw input merely to render a static frame. Snapshot tools operate directly on <code>Surface</code> and avoid terminal state entirely.</Note></>,
      },
      {
        heading: 'Respect the platform boundary',
        body: <><p>The public platform subpath intentionally stops at input, color capability, and terminal lifecycle. Arcade’s URL opener, clipboard integration, hosted private OSC events, authentication, and process policy remain application internals.</p><p>If your terminal application opens a browser, print the URL as a fallback and own validation at the host boundary. Do not depend on <code>src/platform/open-browser.ts</code>; it is not exported by <code>@vercel/arcade/platform</code>.</p></>,
      },
    ],
  },
  {
    slug: 'tui',
    label: 'Terminal UI',
    title: 'Terminal UI',
    summary: 'Build retained component trees over a live scene, lay them out in terminal cells, and keep focus, pointer, keyboard, and command semantics independent from ANSI.',
    sections: [
      {
        heading: 'Build a component tree',
        body: <><Code>{`import { Box, FilledButton, Screen, Text } from '@vercel/arcade/tui'

const screen = new Screen(120, 40)
const hud = Box({
  flexDirection: 'row', gap: 1, padding: [1, 2],
  background: 'surfaceChrome'
}, [
  Text({ text: 'white to move', style: { color: 'textStrong' } }),
  FilledButton({ id: 'reset', label: 'reset', onClick: reset })
])

screen.setRoot(hud, { x: 0, y: 0, w: 120, h: 40 })
process.stdout.write(screen.frame())`}</Code><p>Nodes are plain data and may be rebuilt every frame. <code>Screen</code> owns the retained state: hover, focus, press, pointer capture, mounted components, scene cache, and cell diff history. Stable IDs are the identity boundary; changing an ID creates a different interactive control.</p><Note><code>Screen.frame()</code> emits a UI overlay. Use <code>frameComposited()</code> when the scene and UI share one <code>Surface</code> and should be diffed together.</Note></>,
      },
      {
        heading: 'Own the Screen lifecycle',
        body: <><Api rows={[
          ['new Screen(cols, rows, theme?)', 'Creates retained interaction state and two reusable Surface buffers.'],
          ['setRoot(root, region?)', 'Expands component slots and lays out immediately so hit testing is current even before repaint.'],
          ['resize(cols, rows)', 'Resizes buffers and invalidates scene and diff caches. Call it before painting the new terminal geometry.'],
          ['frame()', 'Paints the current UI tree and serializes its opaque cells as ANSI.'],
          ['frameComposited(present, sceneChanged?, foreground?)', 'Caches the scene layer, paints UI over it, and emits only changed cells.'],
          ['snapshot(present, foreground?)', 'Returns a complete Surface for tests and image snapshots without terminal diffing.'],
          ['dirty()', 'Reports interaction or component-content changes that require a render-on-demand frame.'],
          ['resetDiff()', 'Forces the next composited frame to repaint after an external terminal clear or geometry change.'],
        ]} /><p><code>setRoot()</code> does not itself mark the screen dirty. This lets an application rebuild an equivalent tree every tick without forcing output. Stateful components call <code>markDirty</code> through the registry when their internal value, caret, selection, or scroll offset changes.</p></>,
      },
      {
        heading: 'Layout and paint',
        body: <><p>Every number is measured in terminal cells. A <code>Dimension</code> is a fixed number, <code>{`{ pct: number }`}</code>, or <code>auto</code>. Auto width uses text width or the children’s intrinsic size; percentage values resolve against the parent content box.</p><Api rows={[
          ['flexDirection', 'row or column; row is the default.'],
          ['justifyContent / alignItems', 'Main-axis distribution and cross-axis placement.'],
          ['gap / padding / margin', 'Cell spacing. Padding and margin accept one, two, or four values.'],
          ['flexGrow / flexShrink / flexBasis', 'Distribute remaining space or absorb overflow without CSS or DOM layout.'],
          ['position / top / right / bottom / left', 'Absolute nodes leave normal flow and resolve against the nearest content box.'],
          ['overflow: hidden', 'Clips descendant painting and hit testing to the same computed rectangle.'],
          ['textOverflow', 'clip or ellipsis; requires a resolved width and is inert for auto-width text.'],
        ]} /><p>Painting resolves semantic theme tokens, interaction-state overlays, square or rounded borders, alpha backgrounds, and scrims. A scrim blends over cells already in the <code>Surface</code>, preserving the scene glyph while dimming it; a normal background replaces the cell.</p></>,
      },
      {
        heading: 'Input and command semantics',
        body: <><p>The platform parser normalizes escape sequences into <code>KeyEvent</code> and <code>MouseEvent</code> before they reach TUI. <code>Screen.handleKey()</code>, <code>pointerDown()</code>, <code>drag()</code>, <code>pointerUp()</code>, <code>hover()</code>, and <code>wheel()</code> route those events through the laid-out tree.</p><p>Tab follows focusable nodes in paint order and skips disabled controls. Pointer down captures the node until pointer up, so dragging a slider or scrollbar continues outside its original box. Overlay nodes are painted last and hit-tested first. Returning <code>true</code> from <code>onKey</code> or <code>onMouse</code> prevents application-level fallthrough.</p><p><code>Keymap</code> maps chords to stable command IDs and supports layered contexts. Agents can invoke the same command IDs directly instead of synthesizing keystrokes; shortcut help can be generated from active bindings.</p></>,
      },
      {
        heading: 'Drive the terminal renderer',
        body: <><Code>{`const renderer = new Renderer({
  maxFps: 60,
  minFps: 30,
  fastFrameBudgetMs: 13
})

renderer.onFrame((dt, now) => {
  renderer.write(screen.frameComposited(presentScene, sceneChanged))
})
renderer.start()
renderer.requestLive()`}</Code><p><code>Renderer</code> is the Node-only adaptive scheduler included in the TUI subpath. <code>requestRender()</code> coalesces a one-frame update. Counted <code>requestLive()</code>/<code>dropLive()</code> leases keep animation active until every owner releases. Writes are buffered into one output call per frame and resume after stream backpressure drains.</p><p>Recent p95 frame cost selects the fast or steady cadence. Pass <code>targetFps</code> for a fixed compatibility cadence, or inject <code>output</code> and <code>now</code> to drive <code>tick()</code> deterministically in tests. Call <code>destroy()</code> when the host shuts down.</p></>,
      },
      {
        heading: 'Mount stateful components',
        body: <><Code>{`const input = new Input({
  id: 'player-name',
  value: '',
  placeholder: 'name',
  onChange: (value) => save(value)
})

screen.mount(input)
screen.setRoot(Slot('player-name'))`}</Code><p><code>Input</code>, <code>Select</code>, <code>Dropdown</code>, <code>Slider</code>, and <code>ScrollBox</code> implement the persistent <code>Component</code> contract. Mount the instance once, then place it with <code>Slot(id)</code>. Before layout, <code>Screen</code> replaces the slot with <code>component.build()</code>.</p><p>A component is automatically unmounted when its slot leaves the tree. Focus transitions call <code>onFocus</code> and <code>onBlur</code>; explicit <code>unmount(id)</code> is only needed when the host must dispose it before the next tree reconciliation.</p></>,
      },
      {
        heading: 'Compose scene and UI',
        body: <><p>Every final cell stores a glyph, foreground, background, style bits, opacity, and wide-character continuation. Terminal hosts serialize and diff it to ANSI; <code>CanvasSurfaceHost</code> draws the same <code>Surface</code> into Canvas; snapshot tools consume it headlessly.</p><Code>{`const ansi = screen.frameComposited(
  (surface) => renderSceneInto(surface),
  sceneChanged,
  (surface) => drawDiceForeground(surface)
)
process.stdout.write(ansi)`}</Code><p>Set <code>sceneChanged</code> to false for UI-only frames so the cached scene cells are reused. The optional foreground painter runs after UI and is appropriate only for intentional topmost layers. Continue to <a href="/docs/components">Component reference</a> for every public component and escape hatch.</p></>,
      },
    ],
  },
  {
    slug: 'components',
    label: 'Components',
    title: 'Component reference',
    summary: 'Choose controls, fields, data displays, overlays, and scene-aware primitives designed around terminal geometry and persistent interaction state.',
    sections: [
      {
        heading: 'Node primitives',
        body: <><Api rows={[
          ['Box(style, children?)', 'A flex-like layout container. It may paint a background, border, scrim, clip, or absolute positioning context.'],
          ['Text({ text, id?, style? })', 'A non-focusable text run. Width is measured with terminal wcwidth rules, not JavaScript string length.'],
          ['Button({ id, label, … })', 'A focusable action. id is required; disabled controls remain painted and absorb pointer input but skip hover, focus, and activation.'],
          ['Slot(componentId, style?)', 'A layout mount point for a persistent Component already registered with Screen.mount().'],
          ['FrameBuffer({ id?, style?, draw })', 'A clipped callback for custom Surface drawing inside a normal node content box.'],
        ]} /><Code>{`const panel = Box({
  width: { pct: 1 },
  flexDirection: 'column',
  gap: 1,
  padding: [1, 2],
  overflow: 'hidden',
  background: 'surfaceChrome'
}, [
  Text({ text: 'match ready', style: { bold: true } }),
  Button({ id: 'start', label: 'start', onClick: start })
])`}</Code></>,
      },
      {
        heading: 'Buttons and toggles',
        body: <><Api rows={[
          ['RoundedButton', 'Builds a pill-like ink border with semantic hover/focus/pressed/disabled styles.'],
          ['FilledButton', 'Uses a solid semantic surface and intentionally square terminal-cell geometry.'],
          ['roundedButtonStyle / filledButtonStyle', 'Return reusable Style objects when a custom node needs the same interaction language.'],
          ['ToggleButton({ pressed, … })', 'A button with persistent external pressed state and an active style; the caller owns the boolean.'],
          ['CloseButton({ id, onClick })', 'Standard × action used by Dialog and sidebar chrome.'],
        ]} /><p>Button callbacks are synchronous. Use <code>disabled</code> while an action is unavailable; do not remove <code>onClick</code> alone, because an otherwise focusable node would still participate in keyboard and hover interaction.</p></>,
      },
      {
        heading: 'Input',
        body: <><Code>{`const name = new Input({
  id: 'name', value: '', placeholder: 'player name',
  onChange: (value) => updateName(value),
  onEnter: (value) => join(value)
})

screen.mount(name)`}</Code><Api rows={[
          ['InputOpts.id', 'Required stable focus and mount identity.'],
          ['value / placeholder', 'Initial editable value and muted empty-state text. The instance owns later edits.'],
          ['width / maxRows', 'Visible cell width defaults to 24; maxRows defaults to one and enables wrapped vertical growth.'],
          ['onChange(value)', 'Runs after an edit changes the buffer, not after caret-only movement.'],
          ['onEnter(value)', 'Runs on Enter without clearing or replacing the buffer.'],
          ['onKeyDown(event, input)', 'Runs before built-in editing; return true to consume the key.'],
        ]} /><p><code>Input</code> owns its value, caret, horizontal scroll, wrapped-row scroll, and focus state. Left/Right move the caret, Backspace edits, Enter calls <code>onEnter</code>, and printable non-control characters insert at the caret. The current buffer and caret are public instance fields for host synchronization.</p><p>Selection, Delete, Home/End, and pointer caret placement are not currently implemented.</p><Note>The component is persistent. Reconstructing <code>new Input()</code> every frame discards its caret and scroll position; mount once and render it through <code>Slot</code>.</Note></>,
      },
      {
        heading: 'Select and Dropdown',
        body: <><Api rows={[
          ['SelectOpts', 'id, items, optional index/height/width/wrapping, plus onChange and onSelect callbacks.'],
          ['Select.setItems / setIndex', 'Replace dependent options or synchronize a selection while preserving viewport visibility.'],
          ['DropdownOpts', 'id, items, required width, optional rows/search/labels/accent/bare styling, and selection/query callbacks.'],
          ['Dropdown.setItems / setQuery', 'Replace the option source or externally seed the current filter.'],
        ]} /><p><code>Select</code> is an always-visible vertical list. Up/Down or k/j moves its selected row; Enter/Space commits it. Pointer wheel changes selection, while click both highlights and commits. Wrapped items occupy multiple visual rows but still map to one item index.</p><p><code>Dropdown</code> is a collapsing single-value control. When open, it supports Up/Down, Page Up/Down, Enter/Space, Escape, wheel navigation, and outside-click dismissal. Search is opt-in and edits a temporary query rather than the committed value; matching is case-insensitive substring filtering.</p><p>Both are persistent components with stable IDs. Use <code>Select</code> when choices should remain visible. Use <code>Dropdown</code> when space is constrained or filtering materially reduces navigation.</p></>,
      },
      {
        heading: 'Slider',
        body: <><p><code>Slider</code> owns a normalized value in the fixed 0–1 range. Left/Right or h/l nudge by <code>step</code>. Wheel, click, and drag update from pointer input; the Screen owns pointer capture during a drag.</p><Code>{`const volume = new Slider({
  id: 'volume', step: 0.05, value: 0.7,
  width: 24,
  onChange: setVolume
})`}</Code><Api rows={[
          ['id', 'Required stable focus identity.'],
          ['value', 'Initial value, clamped to 0–1; defaults to 0.5.'],
          ['step', 'Keyboard and wheel increment; defaults to 0.05. Pointer placement is continuous.'],
          ['width', 'Track width in terminal cells; defaults to 20.'],
          ['onChange(value)', 'Runs only when interaction changes the public value field.'],
        ]} /><p>There is no <code>min</code>, <code>max</code>, Home/End behavior, or <code>setValue()</code> method. For host synchronization, assign the public <code>value</code> field with a value already clamped to 0–1.</p></>,
      },
      {
        heading: 'Field and Tooltip',
        body: <><Api rows={[
          ['Field({ label, child, direction?, labelWidth? })', 'Composes a label with one or more caller-owned child nodes in a row or column.'],
          ['Tooltip(opts, trigger)', 'Adds passive hover metadata to a trigger without inserting hidden layout children.'],
        ]} /><p>Tooltips can explain passive content and disabled controls because they make the trigger hoverable without making it clickable or keyboard-focusable. Placement may be top, bottom, or auto; content wraps to <code>maxWidth</code> in terminal cells and can include bold or differently colored runs.</p><p>The painter materializes only the active tooltip after all portal overlays. It cannot resize its trigger and does not intercept pointer input.</p></>,
      },
      {
        heading: 'Table',
        body: <><p><code>Table</code> uses explicit <code>ColumnDef</code> values rather than measuring a DOM table. A column may have a fixed <code>width</code>, <code>auto</code> width measured from its cells, or a positive <code>flex</code> share of remaining cells. <code>min</code>, <code>max</code>, <code>shrink</code>, and per-column alignment are applied after gap accounting.</p><Code>{`Table({
  width: 64,
  columns: [
    { width: 18 },
    { flex: 1, min: 12 },
    { width: 8, align: 'end' }
  ],
  gap: 2
}, [
  TableHeader(['Model', 'Decision', 'Latency'].map((x) => TableCell(x))),
  TableRow({}, [TableCell(model), TableCell(move), TableCell('240ms')])
])`}</Code><p><code>TableCell</code> applies alignment and overflow; <code>TableRow</code> is an ordinary row <code>Box</code>, so it can be styled or given pointer handlers. <code>resolveColumns()</code> is exported for scene or test code that needs the exact computed widths.</p></>,
      },
      {
        heading: 'ScrollBox',
        body: <><Api rows={[
          ['id', 'Required focus identity.'],
          ['rows', 'Strings become one-line Text nodes; Node rows own their own width and styling.'],
          ['height', 'Visible row count, or the maximum when autoHeight is true.'],
          ['width', 'Optional width applied to string rows.'],
          ['autoHeight', 'Shrink to short content, then cap and scroll at height. Defaults to false.'],
        ]} /><p><code>ScrollBox</code> owns a vertical row offset and builds only the visible slice. Up/Down or k/j move one row, Page Up/Down move by the visible height, and wheel input moves three rows per notch. If nothing can scroll, keyboard and wheel events return unhandled so an ancestor or scene may use them.</p><p><code>setHeight()</code> and direct replacement of the public <code>rows</code> array are the current update surfaces; offsets are clamped when height changes. A rightmost-cell scrollbar supports click and drag. Home/End and an <code>ensureVisible()</code> API are not currently implemented.</p></>,
      },
      {
        heading: 'Modal and Dialog',
        body: <><Api rows={[
          ['Modal(content, { onDismiss?, scrim? })', 'Creates a full-region layer, blends a scrim over existing scene cells, dismisses on outside click, and keeps content clicks inside.'],
          ['Dialog({ title, onClose, closeId, … }, children)', 'Standard card with title row, optional close/back actions, width, padding, and body layout. Wrap it in Modal to center and dim.'],
        ]} /><p>Use <code>Screen.setGlobalOverlay()</code> for application-global dialogs that must paint and hit-test above the current screen. Use a node with <code>overlay: true</code> for a local floating list or popover. These are different ownership models: a modal replaces the active interaction layer; an overlay remains part of its component subtree.</p></>,
      },
      {
        heading: 'NoticeToast',
        body: <><p><code>NoticeToast(opts)</code> builds a blocking warning or error surface from <code>Modal</code>, <code>Dialog</code>, and <code>RoundedButton</code>. It requires a stable ID, title, body, severity, and dismiss callback; an optional action becomes a second focusable control.</p><Code>{`const notice = NoticeToast({
  id: 'gateway-credit',
  severity: 'error',
  title: 'Out of credit',
  body: 'Add AI Gateway credit to resume model requests.',
  action: { label: 'Add credit', onClick: openBilling },
  onDismiss: closeNotice
})

screen.setGlobalOverlay(notice)`}</Code><p><code>noticeToastHeight(view, width?)</code> computes the wrapped card height. Error titles use the danger role; warning titles use <code>textStrong</code>. Use this for blocking recovery, not transient success confirmation.</p></>,
      },
      {
        heading: 'Sidebar and projected UI',
        body: <><Api rows={[
          ['Sidebar(opts, children)', 'Shared edge-panel geometry with header, close action, padding constants, and explicit scene inset ownership.'],
          ['ProjectedAnchor(opts, children)', 'Places UI at a point already projected to terminal cells, with start/center/end alignment. The caller owns viewport clamping.'],
          ['FrameBuffer(opts)', 'Paints custom cells in a clipped content rectangle when normal nodes are insufficient.'],
          ['ASCIIFont(text, opts?)', 'Expands supported text into large glyph rows for terminal title treatments.'],
        ]} /><p><code>Sidebar</code> does not automatically shrink a 3D camera viewport. Reserve the same width with <code>insetSceneViewport()</code>, then convert pointer coordinates through <code>pointerNdcInSceneViewport()</code>. This keeps rendering, picking, and UI geometry consistent.</p><p><code>ProjectedAnchor</code> should normally set <code>pointerEvents: none</code> for visual labels so opaque badges do not block scene interaction.</p></>,
      },
      {
        heading: 'Theme and terminal width',
        body: <><p><code>Theme</code> exposes semantic surfaces, text roles, hover/focus/pressed/disabled states, selection, scrollbars, tooltips, and scrim. Reusable components should use role names rather than game-specific RGB values; callers may replace the complete theme with <code>Screen.setTheme()</code> without rebuilding component state.</p><p>Public option contracts include <code>InputOpts</code>, <code>SelectOpts</code>, <code>DropdownOpts</code>, <code>SliderOpts</code>, <code>ScrollBoxOpts</code>, <code>TableOpts</code>, <code>ColumnDef</code>, <code>FieldOpts</code>, <code>TooltipOpts</code>, <code>DialogOpts</code>, <code>ModalOpts</code>, <code>SidebarOpts</code>, <code>ProjectedAnchorOptions</code>, and <code>NoticeToastOpts</code>. Import these when building reusable wrappers rather than duplicating option shapes.</p><p><code>clipText</code>, <code>truncate</code>, and <code>wrapText</code> use Arcade’s terminal-width model. Wide emoji and CJK glyphs occupy two cells, combining marks join the preceding cell, and a wide glyph cannot start in the final column. <code>asciiFontLines</code> returns the large-glyph rows without creating a Node. Browser xterm hosts install the same width provider so CLI and browser buffers agree.</p><Source path="src/tui/index.ts" /><Source path="src/engine/width.ts" /></>,
      },
    ],
  },
  {
    slug: 'game-visuals',
    label: 'Game visuals',
    title: 'Game visuals',
    summary: 'Reuse Arcade’s production game geometry, asset loaders, layouts, and deterministic animation plans without importing the terminal application.',
    sections: [
      {
        heading: 'Compose rather than fork',
        body: <><p>The rules packages answer what happened. <code>game-visuals</code> answers where shared objects belong and how visible motion progresses. A host still owns its camera, RenderTarget, scene objects, clock, UI, and rules state.</p><Code>{`import { planChessMove, chessMovePosition } from '@vercel/arcade/game-visuals/chess'

const plan = planChessMove(move, {
  square: 1,
  flipped: false,
  whiteJailCount: capturedByWhite,
  blackJailCount: capturedByBlack
})

for (const segment of plan.segments) {
  const position = chessMovePosition(segment, progress)
  // Apply position to your own MeshObject or renderer.
}`}</Code><p>The plan includes the moving piece, castling rook, and captured-piece flight where applicable. Each segment names its source square through <code>hideSq</code>, allowing the static board renderer to suppress every object currently in motion.</p></>,
      },
      {
        heading: 'Load assets through a transport',
        body: <><Code>{`import {
  fetchObjMeshSet,
  type TextAssetTransport
} from '@vercel/arcade/game-visuals'

const fromDisk: TextAssetTransport = async (path) =>
  readFile(path, 'utf8')

const meshes = await fetchObjMeshSet({
  table: './table.obj',
  chair: './chair.obj'
}, fromDisk)`}</Code><p><code>fetchTextAsset</code> uses global <code>fetch</code>. Pass a transport for filesystem, cache, test fixture, authenticated CDN, or bundler ownership. <code>fetchObjMesh()</code> parses and flat-shades one model; <code>fetchObjMeshSet()</code> loads a typed key-to-mesh record concurrently.</p></>,
      },
      {
        heading: 'Chess visuals',
        body: <Api rows={[
          ['parse/fetch/measureChessPieceMeshes', 'Load OBJ source, normalize named piece meshes, and derive shared scale/offset metrics.'],
          ['chessSquarePosition / chessJailPosition', 'Convert rule-square and captured-piece indices into host-independent world positions, including board flip.'],
          ['planChessMove', 'Produces every moving segment for a legal Move, including en passant and castling.'],
          ['chessMovePosition / movingKingPosition', 'Sample deterministic slide/arc motion and locate an animating king for attached UI such as speech wisps.'],
        ]} />,
      },
      {
        heading: 'Poker visuals',
        body: <><p>Poker exports table/chair asset parsing, reusable card meshes and textures, seat-relative positions, board/hole-card poses, chip-column inventory operations, deck shuffle, muck/gather plans, and pot flights. Chip helpers preserve denominations rather than replacing a stack with an arbitrary visual amount.</p><Api rows={[
          ['playerColumns / potColumns / takeChipColumns', 'Build and transfer denomination-aware chip inventories.'],
          ['pokerSeatPosition / pokerHoleCardPose / pokerBoardCardPose', 'Share table geometry across terminal and browser hosts.'],
          ['DeckShuffle / createPokerMuckCards / createPokerGatherCard', 'Stateful or sampled between-hand card choreography.'],
          ['pokerChipFlight', 'Sample a smooth felt-plane transfer with optional vertical hop.'],
        ]} /><p>Call <code>preparePokerCardTextures()</code> before expecting face textures. The host supplies asset availability and decides what hidden information may be rendered.</p></>,
      },
      {
        heading: 'Islanders visuals',
        body: <><p>Islanders exports procedural terrain, coast, water, harbor, road/building, robber, and dice primitives plus choreography shared by the CLI and browser cinematic.</p><Api rows={[
          ['animatedTileMesh / AnimatedTileMeshCache', 'Create terrain geometry with time-varying props while reusing expensive static work.'],
          ['hexWorld / NODE_XZ / EDGE_ENDS', 'Map shared topology IDs to world-space board geometry.'],
          ['islandersTilePlacementProgress / islandersCoastProgress / islandersHarborProgress', 'Sample deterministic setup phases independently from a scroll or render clock.'],
          ['cinematicDiceState / drawIslandersDiceOverlay', 'Resolve dice timing and compose an opaque Surface overlay over a rendered board.'],
          ['robberFlightPoint', 'Move the robber over the board on the production parabolic path.'],
        ]} /><p>The exported constants are coordination values used by the shipped choreography. Treat them as presets: consume the higher-level functions when possible instead of duplicating their timing relationships.</p></>,
      },
      {
        heading: 'Keep rules authoritative',
        body: <><p>Visual helpers do not validate legality or mutate game state. Apply an action through <a href="/docs/rules">Rules</a>, then animate the canonical result. In interactive hosts, expose that sequencing through <code>MatchScene.playMove()</code> so <a href="/docs/game-harness">the harness</a> cannot request another action before the current motion settles.</p><Source path="src/game-visuals/index.ts" /><Source path="src/game-visuals/chess/index.ts" /><Source path="src/game-visuals/poker/index.ts" /><Source path="src/game-visuals/islanders/index.ts" /></>,
      },
    ],
  },
  {
    slug: 'rules',
    label: 'Rules',
    title: 'Rules engines',
    navParent: 'games',
    navGroup: 'Shared systems',
    summary: 'Use presentation-independent game states for legal actions, deterministic tests, search, model observations, chance events, and replay.',
    sections: [
      {
        heading: 'Implement GameState',
        body: <><Code>{`interface GameState<Action> {
  currentPlayer(): number
  legalActions(): Action[]
  applyAction(action: Action): void
  isTerminal(): boolean
  returns(): number[]
  clone(): GameState<Action>
  toString(): string
  actionToString(action: Action): string
  actionFromString(text: string): Action | null
}`}</Code><p>A state is mutable and authoritative. <code>applyAction()</code> advances it in place; <code>clone()</code> must produce an independent deep copy for search and validation. <code>currentPlayer()</code> returns a zero-based seat, <code>TERMINAL</code> after completion, or <code>CHANCE</code> for an explicit stochastic node.</p><p><code>actionToString()</code> defines canonical notation used by logs and prompts. <code>actionFromString()</code> returns null for malformed or illegal input. Games with parameterized action families may also expose <code>isLegalAction()</code>, <code>decisionContextString()</code>, and representative <code>parameterizedActionExamples()</code>.</p></>,
      },
      {
        heading: 'Protect private information',
        body: <><p>Games with hidden state implement <code>ImperfectInfoState</code>. <code>toString()</code> may describe the complete world for debugging, but a model must receive <code>informationStateString(player)</code> or <code>observationString(player)</code>. These methods must never include another player’s private cards, resources, or reasoning.</p><p>At an explicit chance node, <code>isChanceNode()</code> is true and <code>chanceOutcomes()</code> returns non-negative probabilities that sum to one. <code>runMatch()</code> validates this distribution and accepts a deterministic <code>chanceRng</code> for tests or replay.</p></>,
      },
      {
        heading: 'Chess',
        body: <><p><code>@vercel/arcade/rules/chess</code> exports <code>ChessState</code>, board/types, attack and move generation, SAN parsing/formatting, and evaluation helpers. Actions parse SAN or UCI through the state; canonical output is SAN. The engine covers castling, en passant, promotion, repetition, the fifty-move rule, insufficient material, stalemate, and checkmate.</p><Code>{`import { ChessState } from '@vercel/arcade/rules/chess'

const state = new ChessState()
const move = state.actionFromString('e4')
if (!move) throw new Error('illegal move')
state.applyAction(move)
console.log(state.fen())`}</Code></>,
      },
      {
        heading: 'Poker',
        body: <><p><code>@vercel/arcade/rules/poker</code> exports card parsing, hand evaluation, blind schedules, action types, and <code>HoldemState</code>. Poker is N-player and imperfect-information: each seat sees its own hole cards plus public board and betting history.</p><p>The state enforces fold/check/call/bet/raise legality, minimum raises, all-ins, side pots, dealer/blind movement, showdown, and payout. Chance may be explicit or internal depending on the session adapter; callers should rely on the state interface rather than assuming one deal model.</p></>,
      },
      {
        heading: 'Islanders',
        body: <><p><code>@vercel/arcade/rules/islanders</code> exports board topology, setup generation, placement validation, maritime trade, development cards, action/state types, and the complete <code>IslandersState</code>. Nodes and edges have stable integer IDs derived from one shared topology.</p><p>The action state machine covers initial snake placement, dice, production, robber movement, discards, domestic and maritime trades, roads, settlements, cities, development cards, awards, and terminal scoring. Use <code>decisionContextString()</code> for computed action facts and <code>parameterizedActionExamples()</code> for legal trade shapes that cannot be exhaustively flattened.</p><Source path="src/rules/islanders/index.ts" /></>,
      },
      {
        heading: 'Test and replay rules',
        body: <><ul><li>Inject seeded random generators into board/deck setup and chance resolution.</li><li>Assert legality before applying externally constructed parameterized actions.</li><li>Record initial state plus canonical applied actions; requested model output is not authoritative replay data.</li><li>Keep presentation animation outside the rules object. A scene may await animation, but legality and resulting state belong to rules.</li></ul><p>Use <a href="/docs/game-harness">Game harness</a> to connect these states to players, animation, diagnostics, and canonical records.</p></>,
      },
    ],
  },
  {
    slug: 'game-harness',
    label: 'Game harness',
    title: 'Game harness',
    summary: 'Connect authoritative rules to human or model players while keeping private information, legal-action validation, public communication, animation, and records separate.',
    sections: [
      {
        heading: 'Define game state',
        body: <><p>The harness consumes the <code>GameState&lt;Action&gt;</code> contract documented under <a href="/docs/rules">Rules engines</a>. Rules own legality and state transitions. The harness owns who decides, how stochastic nodes resolve, when presentation settles, and what diagnostics or records are emitted.</p><Code>{`interface MatchScene<Action> {
  state(): GameState<Action>
  playMove(action: Action): Promise<void>
}`}</Code><p><code>playMove()</code> must resolve only after the action has been applied and its required visible animation has settled. This promise is the backpressure boundary that prevents the next model request from racing the board.</p></>,
      },
      {
        heading: 'Implement a Player',
        body: <><Code>{`interface Player<Action> {
  readonly name: string
  chooseAction(
    state: GameState<Action>,
    context?: TurnContext
  ): Promise<ActionChoice<Action>>
}`}</Code><p>A player may be human input, search, a scripted policy, or a language model. It must return an action legal in the supplied state. <code>TurnContext.signal</code> aborts in-flight work; <code>emit</code> streams public commentary; <code>opponentSaid</code> carries the previous public line for optional reactions.</p><p><code>HumanPlayer</code> adapts an application-owned asynchronous move request. It does not own a terminal or DOM input system.</p></>,
      },
      {
        heading: 'Perfect and imperfect information',
        body: <><p>Chess can expose the whole position. Poker implements <code>ImperfectInfoState</code>, which adds chance nodes and per-player information strings so another player’s hole cards never enter the prompt. Islanders supplies parameterized legal-action examples and player-safe resource and trade context.</p><p>The rule engine remains authoritative. Model output is parsed, normalized, validated, retried where appropriate, and only then applied. Presentation renders the resulting state; it does not define legality.</p></>,
      },
      {
        heading: 'Model decision ladder',
        body: <><p><code>ModelPlayer</code> accepts an AI SDK <code>LanguageModel</code>; applications own provider setup and credentials. It reads the acting player’s private-safe state, optional decision context, legal-action vocabulary, persona, and game-specific notation.</p><ol><li>Request structured output and validate the parsed action.</li><li>When structured generation itself is unsupported, request marker-based text and soft-parse it.</li><li>Optionally ask a separate normalizer model to map the original answer to one legal action.</li><li>Use a legal random fallback so malformed output cannot corrupt or deadlock the match.</li></ol><Api rows={[
          ['maxRetries', 'Illegal or unparseable retries before the fallback ladder continues; defaults to three retries.'],
          ['moveNotation', 'Schema description, parser, formatter, and legal-action vocabulary for the game.'],
          ['speech / communication', 'Separates private decision reasoning from public table talk.'],
          ['normalizer', 'A separate model that recovers intended legal syntax without choosing a better action.'],
          ['fallbackRng', 'Injectable source for deterministic final legal fallback.'],
          ['onFailureNotice', 'Receives sanitized actionable Gateway failure metadata for UI recovery. Persistent failures then reject with NotifiedModelFailure instead of choosing a random move.'],
        ]} /><Note>A fallback-completed turn is traceable and does not count as model compatibility. Billing, authentication, access, and unavailable-model failures are persistent: after <code>onFailureNotice</code>, <code>chooseAction()</code> throws an exported <code>NotifiedModelFailure</code> so a host can pause and offer recovery. Diagnostics store phases, latency, token counts, rejection categories, and sanitized failure kinds. They do not store prompts, raw responses, rationale, or provider error text.</Note></>,
      },
      {
        heading: 'Drive a match',
        body: <><Code>{`const utilities = await runMatch(scene, players, {
  signal,
  chanceRng: seededRandom,
  onThinking(player, seat) {},
  onActionChosen(event) {},
  async onActionApplied(event) {},
  onChanceChosen(event) {},
  async onChanceApplied(event) {}
})`}</Code><Api rows={[
          ['scene', 'Authoritative state accessor plus an asynchronous playMove action and animation boundary.'],
          ['players', 'Zero-based seat implementations. The active seat must have a corresponding Player.'],
          ['signal', 'Stops before a turn, after a decision, or through a Player that observes the signal.'],
          ['chanceRng', 'Returns a finite number in [0, 1); inject for deterministic tests and replay.'],
          ['shouldStop(state)', 'Optional phase boundary for partial-game harnesses.'],
          ['on*Chosen / on*Applied', 'Chosen hooks see pre-action state; applied hooks run after playMove settles.'],
        ]} /><p><code>runMatch()</code> reads the scene’s authoritative state each turn. At <code>CHANCE</code>, it validates and samples <code>chanceOutcomes()</code>. Otherwise it asks the active seat’s player, emits commentary, invokes pre-apply hooks, awaits <code>scene.playMove()</code>, then invokes post-apply hooks.</p><p>It throws for a missing active player, an empty/non-finite/negative/non-normalized chance distribution, an out-of-range RNG result, or <code>CHANCE</code> without the imperfect-information chance contract. Abort returns the current utility vector after stopping between or within turns.</p></>,
      },
      {
        heading: 'Communication and human pacing',
        body: <><p><code>@vercel/arcade/harness/communication</code> keeps speech separate from action choice. A proposal is silent or speak, with intent, public text, optional addressees, and a private reason that never enters table talk.</p><Api rows={[
          ['PublicConversation', 'Stores ordered, speaker-labelled public messages and addressed seats.'],
          ['CommunicationPolicy', 'Accepts every proposal in autoreply mode; ambient mode scores salience, direct replies, silence gaps, repetition, and monologues.'],
          ['TableCommunicationCoordinator', 'Builds communication context, accepts human messages, identifies directed replies, and applies host policy across seats.'],
          ['primaryMoment / reactionOpportunities', 'Reduce game-specific public events into typed moments and bounded response opportunities.'],
        ]} /><p>Arcade’s shared composer resolves exact <code>@model</code> labels into addressed seats. Chess, Poker, and ambient Islanders games then serialize one bounded directed reply per addressed model without creating a reply chain. Call <code>CommunicationPolicy.reset()</code> between independent tables. A decision returns both the accepted or suppressed communication and the original proposal, score, threshold, reason, and score components for inspection.</p><p>Drivers synchronize model progression with visible dice, resource, card, trade, and construction animations. Models may decide quickly; the UI reveals intent at human-readable pace without changing authoritative game ordering.</p></>,
      },
      {
        heading: 'Self-play and persistent traces',
        body: <><Code title="Terminal">{`ARCADE_TELEMETRY=0 pnpm match:run -- \
  --game islanders --models=a,b,c,d --communication ambient \
  --output .runs/islanders-4p`}</Code><p>Runs write a manifest, chronological events, per-match JSONL traces, result, canonical record or replay transcript, summary, and failures. Files appear while a match is active, enabling <code>tail -f</code> and mid-run inspection. Run directories are durable but gitignored. Read <a href="/docs/tools">Tools and self-play</a> for commands and privacy boundaries.</p></>,
      },
      {
        heading: 'Canonical records',
        body: <><p><code>@vercel/arcade/harness/records</code> defines versioned match and hand records for Chess, Poker, and Islanders. Every record has stable record/match IDs, revision, status, timestamps, participants, controller assignments, ordered action sequence, results, rules version, and game-specific details.</p><Api rows={[
          ['requested', 'Structured action requested by a controller when it differs from the canonical applied action. Never raw model text.'],
          ['applied', 'Authoritative action produced by the rules engine and used for replay.'],
          ['status', 'in_progress, completed, or abandoned, with an explicit end reason where applicable.'],
          ['controllerAssignments', 'Tracks human/model ownership changes over action ranges without account identity.'],
          ['checkpoints', 'Game-specific periodic state used to validate or accelerate replay.'],
        ]} /><p>Canonical telemetry excludes prompts, reasoning, chat, voice, and raw responses. Local match-lab traces are more detailed and must not be treated as production telemetry.</p></>,
      },
    ],
  },
  {
    slug: 'tools',
    label: 'Agentic tooling',
    title: 'Agentic tooling',
    summary: 'Render inspectable frames, run games without a terminal, retain structured match artifacts, and give coding agents bounded evidence instead of an infinite TTY.',
    sections: [
      {
        heading: 'Why snapshots exist',
        body: <><p><code>pnpm dev</code> is a full-screen raw-mode animation. It switches terminal state, emits ANSI updates forever, and waits for input, so captured stdout is neither a useful image nor a bounded command. Snapshot tooling invokes the same renderer and freezes one requested state instead.</p><Code title="Terminal">{`pnpm snapshot:png 140 50 0.7
pnpm snapshot:png islanders 180 70 0.7
pnpm snapshot:png shortcuts chess`}</Code><p>The first command freezes the prism at <code>t = 0.7</code> seconds. Scene subcommands can instead select rules state, camera angles, hover/focus/pressed controls, overlays, animation progress, seeds, player count, or game phases. Run <code>pnpm snapshot help</code> for the source-generated command list.</p><Note>Snapshots are checkout tooling in <code>src/tools</code>, not an npm export. Other projects can build the same workflow from the public RenderTarget, presenters, Surface, Screen.snapshot(), and PNG APIs.</Note></>,
      },
      {
        heading: 'Follow the snapshot pipeline',
        body: <><Code language="text" title="Pipeline">{`rules or fixture state
  -> scene.frame(time)
  -> supersampled RenderTarget
  -> downsample and bloom
  -> halfBlockToSurface or shapeGlyphToSurface
  -> Screen.snapshot() for UI composition
  -> 8 x 16 pixels per terminal cell
  -> binary PPM
  -> PNG conversion for inspection`}</Code><p>Scene snapshots invoke production scene code at a bounded time and terminal geometry. Pixel scenes may write the resolved display target directly. ASCII and hybrid scenes pass the target through a presenter to produce canonical cells. UI snapshots use <code>Screen.snapshot()</code>, which paints without ANSI diff output or raw terminal state.</p><p>The repository serializer expands every terminal cell to an 8×16 pixel tile. It paints the background, then stamps Arcade’s bundled 8×8 font at terminal-cell aspect. Box drawing, half blocks, braille, controls, and several UI symbols have procedural fallback masks so a missing bitmap glyph cannot silently disappear from visual evidence.</p><p>The intermediate file is binary PPM because it needs no image dependency. <code>pnpm snapshot:png</code> forwards all arguments, reads the emitted PPM path, and converts the sibling file to PNG with macOS <code>sips</code>. On another platform, use any PPM-capable converter.</p></>,
      },
      {
        heading: 'Build a portable snapshot',
        body: <><Code>{`import { encodePng } from '@vercel/arcade/engine/png'
import {
  RenderTarget,
  Surface,
  shapeGlyphToSurface
} from '@vercel/arcade/engine'

const target = new RenderTarget(pixelWidth, pixelHeight)
renderScene(target, time)

const surface = new Surface(cols, rows)
shapeGlyphToSurface(surface, target, cols, rows, {
  color: true,
  hybrid: false
})

// A host can rasterize Surface cells into an RGBA Texture, then:
const png = encodePng(texture)
await writeFile('frame.png', png)`}</Code><p><code>encodePng()</code> and <code>decodePng()</code> live under the Node-only <code>@vercel/arcade/engine/png</code> subpath. They accept Arcade’s row-major RGBA8 <code>Texture</code>. The package does not yet export a one-call <code>Surface → PNG</code> adapter; the repository snapshot tool’s font rasterizer remains app-specific.</p><p>For tests that do not need a human-readable file, assert directly against RenderTarget colors, depth, Surface cells, or canonical rules state. Image output is most useful for composition and visual review.</p></>,
      },
      {
        heading: 'Inspect animations and states',
        body: <><Code title="Terminal">{`# Compare the same deterministic animation at four times.
for t in 0.2 1.0 2.0 3.0; do
  pnpm snapshot:png 140 50 "$t" ".snapshots/prism-$t.ppm"
done

# Freeze interactive and game-specific states.
pnpm snapshot:png ui 110 44 hover=reset
pnpm snapshot:png chess-game 140 50 0.6 match
pnpm snapshot:png islanders-game actions seed=42 180 70
pnpm snapshot:png poker 160 60 flop players=4 hud`}</Code><p>Use identical dimensions and seeds when comparing a change. Time is explicit for animation samples; rules seeds are explicit for generated boards and scripted play. External model output is not deterministic even when the rules seed is.</p></>,
      },
      {
        heading: 'Run exported headless games',
        body: <><p>Headless execution is not limited to Arcade’s internal match lab. Game-specific npm subpaths expose UI-independent runners that accept custom <code>Player</code> implementations.</p><Code>{`import { runHeadlessChessMatch } from '@vercel/arcade/harness/chess'
import { ChessState } from '@vercel/arcade/rules/chess'

const result = await runHeadlessChessMatch(
  new ChessState(),
  [white, black],
  { maxPlies: 300, signal }
)

console.log(result.status, result.plies, result.state.fen())`}</Code><Api rows={[
          ['runHeadlessChessMatch', 'Exactly two players; defaults to a 300-ply evaluator bound; returns completed or bounded state and ply count.'],
          ['runHeadlessIslandersMatch', 'One Player per state seat; defaults to 8,000 actions; returns victory/action-limit/stopped/aborted status.'],
          ['runIslandersInitialPlacement', 'Runs only the snake-placement phase and supports a bounded smoke-test action limit.'],
          ['runPokerSession', 'Runs 2–6 seats across hands with carried stacks/button, escalating blinds, action/hand limits, events, and canonical records.'],
        ]} /><p>Inject <code>rng</code>, <code>fallbackRng</code>, or <code>chanceRng</code> where the runner exposes it. Bounds are evaluator safeguards, not game rules. An interactive scene can use the corresponding non-headless runner and resolve <code>playMove()</code> after visible animation.</p></>,
      },
      {
        heading: 'Match lab',
        body: <><Code title="Terminal">{`pnpm match:run -- --game chess --games=4 --concurrency=2 --swap-seats
pnpm match:run -- --game poker --models=a,b,c,d --starting-chips=1000
pnpm match:run -- --game islanders --models=a,b,c,d --communication=ambient`}</Code><p>The lab is a repository orchestrator over the exported rules and harness. It reuses action parsers, normalizers, model catalog and authentication selection, game defaults, and canonical recorders. Random rules seeds are stored; external model calls remain nondeterministic. Concurrency is match-level, never within one game turn.</p><Api rows={[
          ['manifest.json', 'Run configuration, model order, base seed, limits, communication mode, commit, and telemetry-disabled marker.'],
          ['events.jsonl', 'Chronological run-wide event stream written while work is in progress.'],
          ['matches/<id>/trace.jsonl', 'Per-match decision, action, communication, checkpoint, and lifecycle stream.'],
          ['matches/<id>/result.json', 'Bounded/completed/failed result, timings, winners, stop reason, and error where present.'],
          ['matches/<id>/canonical.json', 'Versioned replay/telemetry-safe game record when the adapter supplies one.'],
          ['summary.json / errors.jsonl', 'Aggregate model outcomes plus a compact failure stream.'],
        ]} /><p>Artifacts are initialized before inference and queued to preserve event order, so an agent can inspect or <code>tail -f</code> a run before it finishes. <code>--swap-seats</code> rotates assignments between matches; <code>--seed</code> derives a deterministic per-match rules seed; <code>--concurrency</code> controls independent matches.</p><Source path="docs/match-lab.md">Complete match-lab guide</Source></>,
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
        body: <><p>Match-lab forces telemetry off. Local traces may contain prompts, model attempts, private reasoning, public communication, hands, and intermediate state; they must not be committed or uploaded as production telemetry. Arcade telemetry separately records anonymous usage and canonical game records only. It never records prompts, reasoning, chat, voice, or account identity.</p><p>Credentials are resolved by the CLI’s Vercel device flow and selected team. They never enter the browser bundle, documentation, repository, or run manifest.</p></>,
      },
      {
        heading: 'Design tools for agents',
        body: <><ul><li>Give every long-running tool <code>--help</code>, explicit bounds, deterministic seeds where possible, and a non-interactive output path.</li><li>Persist progress incrementally rather than only writing a final report.</li><li>Separate machine-readable state and records from PNGs intended for visual judgment.</li><li>Keep raw-mode terminal startup out of snapshot and headless paths.</li><li>Test public package imports from a packed tarball; source-relative imports can hide missing exports and Node/browser boundary leaks.</li></ul><p>These constraints let a coding agent render, inspect, compare, and retry without guessing at ANSI output or waiting indefinitely.</p></>,
      },
    ],
  },
  {
    slug: 'web',
    label: 'Browser integration',
    title: 'Browser integration',
    summary: 'Render focused Arcade surfaces directly to Canvas or host the complete CLI in an isolated browser terminal.',
    sections: [
      {
        heading: 'Choose a browser path',
        body: <><Api rows={[
          ['Canvas and focused scenes', 'Import the browser-safe web API when you own the page, render loop, and scene. This keeps the complete terminal application out of the browser bundle.'],
          ['Hosted CLI', 'Run the packaged Arcade command inside an isolated PTY when people should use the complete launcher, games, terminal input, and model flow unchanged.'],
        ]} /><div className="doc-cards doc-cards--single"><a href="/docs/browser-host"><strong>Host the complete CLI</strong><span>Sandbox lifecycle, xterm transport, device authorization, isolation, and credential boundaries</span></a></div></>,
      },
      {
        heading: 'Render a Surface to Canvas',
        body: <><Code>{`import {
  CanvasSurfaceHost,
  TERMINAL_CELL_ASPECT_RATIO
} from '@vercel/arcade/web'

const host = new CanvasSurfaceHost(canvas, {
  devicePixelRatio: window.devicePixelRatio,
  cellAspectRatio: TERMINAL_CELL_ASPECT_RATIO,
  fontFamily: 'Geist Mono, monospace',
  manageCssSize: false
})

host.resize(width, height, cols, rows)
host.draw(surface)`}</Code><p><code>CanvasSurfaceHost</code> is a presentation adapter. It does not own a render loop, scene, rules state, React component, or resize observer. The caller supplies the CSS dimensions, terminal grid dimensions, and complete <code>Surface</code>.</p><Api rows={[
          ['devicePixelRatio', 'Scales the backing buffer; defaults to one and is fixed for the host lifetime.'],
          ['cellAspectRatio', 'Width ÷ height of a terminal cell. Arcade uses 0.5; omit to stretch cells to fill.'],
          ['fontScale', 'Glyph height relative to the cell; defaults to 0.92.'],
          ['manageCssSize', 'When false, layout owns CSS width/height and the host changes only backing pixels. Use this for responsive canvases.'],
          ['draw(surface, { forceFull? })', 'Retains the previous Surface and repaints only changed cells plus glyph-overhang neighbors when economical.'],
          ['cellAt(clientX, clientY)', 'Maps browser coordinates into terminal-cell coordinates using the current centered grid.'],
        ]} /><p>The 2D context is created with <code>alpha: false</code>. A resize resets retained drawing state and reallocates the backing buffer only when dimensions actually change.</p></>,
      },
      {
        heading: 'Choose a terminal grid',
        body: <><p><code>responsiveTerminalGrid(width, height, cellHeight?)</code> keeps physical cell size stable and adds or removes rows and columns as the canvas changes. The default cinematic cell height is 12 CSS pixels; Arcade’s coarse-pointer site uses 10 for denser mobile output.</p><Code>{`const { cols, rows } = responsiveTerminalGrid(
  rect.width,
  rect.height,
  isMobile ? MOBILE_CINEMATIC_CELL_HEIGHT : undefined
)`}</Code><p>Because terminal cells are half as wide as they are tall, camera aspect is <code>cols / (rows × 2)</code>. Use the same geometry when rendering the source target or the browser composition will differ from the CLI.</p></>,
      },
      {
        heading: 'Use focused scenes',
        body: <><p><code>createBrowserMiniScene()</code> creates a small production-backed scene with a common interface: optional <code>prepare()</code>, <code>frame()</code>, display-mode cycling, orbit, zoom, and reset. Supported IDs include <code>chess-board</code>, <code>chess-knight</code>, <code>poker-chips</code>, and each <code>islanders-${'{terrain}'}</code> tile.</p><Code>{`const scene = createBrowserMiniScene('chess-knight', {
  chessPieceAssetBaseUrl: '/assets/chess'
})
await scene.prepare?.()

const { surface, status, displayMode } = scene.frame(cols, rows, time)`}</Code><p>Frames remain valid while assets prepare. The host owns fetching policy through optional URL or transport overrides; the scene owns geometry, camera, rendering, and terminal-cell presentation.</p></>,
      },
      {
        heading: 'Choose the web abstraction',
        body: <><Api rows={[
          ['CanvasSurfaceHost', 'Lowest-level framework-free Surface-to-Canvas adapter.'],
          ['createBrowserMiniScene', 'Focused production-backed board, piece, chip, or terrain scene with prepare/frame/orbit/zoom controls.'],
          ['BrowserArcade', 'Packaged browser Chess flow and BrowserArcadeScreen state for applications that want more than a mini-scene.'],
          ['BrowserRenderShowcase / BrowserTuiShowcase', 'Small inspectable examples of engine and TUI output.'],
          ['LivingTitleScene / browser cinematics', 'Homepage-oriented multi-scene choreography and timing constants; public, but more product-specific than the host adapter.'],
          ['ActiveSceneLoopClock / auto-tour helpers', 'Keep wall-clock scene animation monotonic while a caller controls scroll/tour progress.'],
          ['applySurfacePointerEffect / PointerField', 'Apply reusable pointer deformation or trails to a Surface with caller-owned pointer samples.'],
        ]} /><p>Prefer the smallest layer that meets the host’s needs. <code>CanvasSurfaceHost</code> and mini-scenes are general integration seams; the living-title exports intentionally preserve Arcade’s shipped cinematic rather than defining a generic game framework.</p></>,
      },
      {
        heading: 'Host xterm consistently',
        body: <><p>Install <code>arcadeUnicodeProvider</code> as an xterm Unicode version so the emulator and Arcade agree about cell widths. It delegates to the same <code>cellWidth()</code> logic used by <code>Surface</code>, including wide glyphs and combining marks.</p><p>A font alone cannot fix geometry when the emulator and application disagree about wcwidth. Match both the Unicode provider and terminal cell aspect, then tune font size/line height without changing the logical grid.</p></>,
      },
      {
        heading: 'Own browser lifecycle',
        body: <><ul><li>Measure the canvas with <code>ResizeObserver</code> and rebuild grid/backing resolution when either dimension changes.</li><li>Pause expensive frame production when the canvas is offscreen or the document is hidden.</li><li>Resolve and load fonts before judging glyph geometry.</li><li>Keep reusable scene logic browser-safe: no filesystem, terminal state, auth, telemetry, or secret access.</li><li>Use <code>forceFull</code> for dense effects whose neighboring glyphs all change; retained repainting is for sparse changes.</li></ul><Source path="src/web/index.ts" /></>,
      },
    ],
  },
  {
    slug: 'browser-host',
    label: 'Hosted CLI',
    title: 'Hosting the complete CLI',
    navParent: 'web',
    summary: 'Run the packaged Arcade CLI in an isolated Vercel Sandbox PTY, stream it through xterm.js, and keep credentials out of the browser.',
    sections: [
      {
        heading: 'Start the hosted shell',
        body: <Code title="Terminal">{`$ ls
README.md  docs  examples

$ cd docs
$ cat README.md

$ arcade
# launches the packaged CLI in the same PTY`}</Code>,
      },
      {
        heading: 'Understand the architecture',
        body: <p>The homepage shares the complete CLI: launcher, games, renderer, TUI, key and mouse parsing, model harness, and ANSI output. The site owns only Sandbox lifecycle, xterm sizing, the WebSocket bridge, and surrounding prose. Browser-safe scenes keep geometry, camera, rasterization, and terminal cells inside Arcade while the site owns only the canvas lifecycle.</p>,
      },
      {
        heading: 'Sign in and use models',
        body: <><p>The hosted CLI supports the same Vercel device authorization used locally. When Arcade requests sign-in, the terminal emits a private browser-open event; the site accepts only Vercel HTTPS destinations and opens the authorization page in a new tab. Team selection and team-scoped AI Gateway key setup remain part of Arcade’s normal flow.</p><p>The browser bundle never receives a Gateway key. A demo credential, when configured, is held in Sandbox network policy and replaces only the exact random placeholder used by the isolated Arcade process. A personal key minted through device authorization passes through according to the session policy rather than being substituted with the demo credential.</p></>,
      },
      {
        heading: 'Isolation and credentials',
        body: <><p>Each visitor receives a temporary Sandbox fork. The shell and Arcade process use separate unprivileged users, sessions expire automatically, and telemetry is disabled. Network policy permits the Vercel authorization APIs and AI Gateway path required by Arcade while denying general shell egress.</p><p>The reusable base Sandbox contains the packed CLI but no production credential. Session-specific policy is attached only when a visitor session is forked.</p><Source path="docs/architecture/0001-hosted-arcade-terminal.md">Hosted terminal architecture</Source></>,
      },
    ],
  },
];

export const DOCS: DocPage[] = CORE_DOCS;

export function findDoc(slug: string): DocPage | undefined { return DOCS.find((page) => page.slug === slug); }
