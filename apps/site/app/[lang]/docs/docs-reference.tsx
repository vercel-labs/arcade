import type { ReactNode } from 'react';
import { CodeBlock } from './docs-code';
import type { DocPage } from './docs-content';
import { PUBLIC_SYMBOLS } from './generated-symbols';

const Code = ({ children, title, language }: { children: string; title?: string; language?: 'typescript' | 'bash' | 'text' }) => <CodeBlock language={language} title={title}>{children}</CodeBlock>;
const Note = ({ children }: { children: ReactNode }) => <aside className="doc-note">{children}</aside>;
const Api = ({ rows }: { rows: [string, string][] }) => <dl className="api-list">{rows.map(([name, description]) => <div key={name}><dt><code>{name}</code></dt><dd>{description}</dd></div>)}</dl>;

export const REFERENCE_DOCS: DocPage[] = [
  {
    slug: 'reference', label: 'Reference', title: 'API reference',
    summary: 'Signatures, defaults, lifecycle rules, errors, and complete examples for Arcade’s public extension points.',
    sections: [{ heading: 'Choose a reference', body: <div className="doc-cards">
      <a href="/docs/reference/engine/render-target"><strong>Engine</strong><span>Targets, materials, rasterization, surfaces, scene objects, cameras, and resources</span></a>
      <a href="/docs/reference/tui/screen"><strong>TUI</strong><span>Screen lifecycle, layout, scheduling, component state, input, and commands</span></a>
      <a href="/docs/reference/components/input"><strong>Components</strong><span>Input, selection, scrolling, overlays, and data controls</span></a>
      <a href="/docs/reference/symbols"><strong>Symbol index</strong><span>Every exported name grouped by supported npm entry point</span></a>
    </div> }],
  },
  {
    slug: 'reference/engine/render-target', label: 'RenderTarget', title: 'RenderTarget', navParent: 'reference', navGroup: 'Engine',
    summary: 'Own the CPU color/depth framebuffer, clear or resize it, and control opaque, additive, and alpha writes.',
    sections: [
      { heading: 'Import', body: <Code>{`import { RenderTarget } from '@vercel/arcade/engine'`}</Code> },
      { heading: 'Signature', body: <Code>{`class RenderTarget {
  width: number
  height: number
  color: Float32Array
  depth: Float32Array
  constructor(width: number, height: number)
  resize(width: number, height: number): void
  clear(r?: number, g?: number, b?: number): void
  plot(x: number, y: number, z: number, color: RGBA8, blend: BlendMode): void
}`}</Code> },
      { heading: 'Parameters and storage', body: <Api rows={[
        ['width / height', 'Pixel dimensions, clamped to at least one. These are renderer pixels, not terminal cells.'],
        ['color', 'Row-major Float32 RGB in the 0–255 working range. Additive effects may temporarily exceed 255.'],
        ['depth', 'One float per pixel. Smaller NDC z is nearer; clear() resets every element to Infinity.'],
        ['finite-depth bounds', 'minDepthX/Y and maxDepthX/Y track opaque writes for sparse presentation.'],
      ]} /> },
      { heading: 'Depth and blending', body: <><Api rows={[
        ['opaque', 'Reject z greater than or equal to stored depth; write RGB, depth, and finite bounds.'],
        ['add', 'Test against opaque depth, add RGB multiplied by alpha, and leave depth unchanged.'],
        ['alpha', 'Test against opaque depth, source-over composite RGB, and leave depth unchanged.'],
      ]} /><p>Draw opaque geometry first, preferably front-to-back. Transparent layers are occluded by opaque depth but do not occlude each other, so their order remains caller-owned.</p></> },
      { heading: 'Lifecycle', body: <><p>Create and reuse a target. <code>resize()</code> is a no-op for unchanged dimensions and reallocates both typed arrays otherwise. Call <code>clear()</code> before a new independent frame.</p><Note>There is no disposal method because the target owns ordinary JavaScript typed arrays. Release references when finished.</Note></> },
      { heading: 'Example', body: <Code>{`const target = new RenderTarget(cols * 3, rows * 6)
target.clear(0, 0, 0)
rasterize(target, mesh, material, uniforms)
bloom(target, { threshold: 180, radius: 2, passes: 1, intensity: 0.35 })
shapeGlyphToSurface(surface, target, cols, rows, { color: true })`}</Code> },
    ],
  },
  {
    slug: 'reference/engine/material', label: 'Material and rasterize', title: 'Material and rasterize', navParent: 'reference', navGroup: 'Engine',
    summary: 'Define typed CPU vertex and fragment programs and submit indexed meshes through Arcade’s triangle rasterizer.',
    sections: [
      { heading: 'Import', body: <Code>{`import { rasterize, type Material, type VertexIn, type Varying } from '@vercel/arcade/engine'`}</Code> },
      { heading: 'Signature', body: <Code>{`interface Material<U> {
  vertex(uniforms: U, vertex: VertexIn): Varying
  fragment(uniforms: U, varying: Varying): RGBA8 | null
  blend?: 'opaque' | 'add' | 'alpha'
  cull?: 'back' | 'front' | 'none'
}

function rasterize<U>(
  target: RenderTarget,
  mesh: Mesh,
  material: Material<U>,
  uniforms: U
): void`}</Code> },
      { heading: 'Contract', body: <Api rows={[
        ['vertex', 'Return clip-space position plus world, normal, UV, color, and barycentric varyings.'],
        ['fragment', 'Receives perspective-correct interpolated varyings. Return RGBA8 or null to discard.'],
        ['blend', 'Defaults to opaque. Add and alpha test opaque depth without writing it.'],
        ['cull', 'Defaults to back. Winding is evaluated after projection.'],
        ['uniforms', 'Caller-owned typed data. Arcade has no global camera, time, lighting, or material registry.'],
      ]} /> },
      { heading: 'Pipeline behavior', body: <p>The rasterizer clips against positive clip-space w, fan-triangulates the resulting polygon, projects to pixel centers, culls by signed area, performs opaque early-Z, perspective-correctly interpolates varyings, then delegates the final write to <code>RenderTarget.plot()</code>.</p> },
      { heading: 'Custom material', body: <Code>{`interface FlatUniforms { mvp: Mat4; color: Vec3 }

const flat: Material<FlatUniforms> = {
  vertex: (u, v) => ({
    clip: mat4MulVec4(u.mvp, { ...v.position, w: 1 }),
    world: v.position, normal: v.normal, uv: v.uv,
    color: u.color, bary: { x: 0, y: 0, z: 0 }
  }),
  fragment: (u) => ({ r: u.color.x, g: u.color.y, b: u.color.z, a: 1 }),
  cull: 'back',
  blend: 'opaque'
}`}</Code> },
    ],
  },
  {
    slug: 'reference/engine/surface', label: 'Surface and presenters', title: 'Surface and presenters', navParent: 'reference', navGroup: 'Engine',
    summary: 'Represent terminal cells canonically, draw or composite them, and convert rendered pixels into ASCII, pixel, or luminance output.',
    sections: [
      { heading: 'Import', body: <Code>{`import {
  Surface, halfBlockToSurface, shapeGlyphToSurface,
  luminanceToSurface, ShapeGlyphSurfaceCache
} from '@vercel/arcade/engine'`}</Code> },
      { heading: 'Cell contract', body: <Code>{`interface Cell {
  ch: string
  fg: [number, number, number]
  bg: [number, number, number]
  style: number
  opaque: boolean
}`}</Code> },
      { heading: 'Surface methods', body: <Api rows={[
        ['setCell / drawText / fillRect', 'Write clipped terminal-cell content; colors are rounded and clamped at storage.'],
        ['setCellWithAlphaBlending / blendRect', 'Composite over existing scene cells while preserving the canonical result.'],
        ['setClip', 'Restrict later writes to one rectangle; pass null to clear the clip.'],
        ['getCell / cellEqualsAt / copyInto', 'Inspect, compare, or copy complete cell state.'],
        ['serialize', 'Emit ANSI for opaque cells. Prefer CellDiffer or Screen.frameComposited for incremental frames.'],
      ]} /> },
      { heading: 'Wide glyphs', body: <p>Cell width follows Arcade’s wcwidth model. A two-cell glyph reserves a continuation cell. Starting one in the final column drops the glyph while retaining color, preventing terminal line wrap from creating unreachable debris.</p> },
      { heading: 'Choose a presenter', body: <Api rows={[
        ['halfBlockToSurface', 'Maps two vertical source pixels to one ▀ cell; use for pixel output.'],
        ['shapeGlyphToSurface', 'Matches a 3×6 luminance sample against glyph ink; supports color, contrast, jitter, hybrid backgrounds, and sparse bounds.'],
        ['luminanceToSurface', 'Maps average brightness through a fixed character ramp.'],
        ['ShapeGlyphSurfaceCache', 'Reuses complete glyph/color results when source samples are unchanged. Disable with stochastic jitter.'],
      ]} /> },
      { heading: 'Example', body: <Code>{`const surface = new Surface(cols, rows)
shapeGlyphToSurface(surface, target, cols, rows, {
  color: true,
  contrast: 2,
  hybrid: false,
  blankOutsideDepthBounds: true
})
process.stdout.write(surface.serialize())`}</Code> },
    ],
  },
  {
    slug: 'reference/engine/camera-resources', label: 'Camera and resources', title: 'Camera, animation, and resources', navParent: 'reference', navGroup: 'Engine',
    summary: 'Own input-agnostic camera state, sampled animation, reusable geometry, and bounded resource lifetimes.',
    sections: [
      { heading: 'OrbitCamera', body: <><Code>{`const orbit = new OrbitCamera(home, 2, 60)
orbit.orbit(pointerDx, pointerDy)
orbit.pan(pointerDx, pointerDy)
orbit.zoomBy(0.9)
const camera = orbit.toCamera({ fovy: Math.PI / 4, near: 0.05, far: 100 })`}</Code><p><code>orbit()</code> clamps elevation to avoid poles; <code>orbitAbovePlane()</code> also prevents travel below a board. Input sensitivity lives in the class, but event binding remains host-owned.</p></> },
      { heading: 'Animation', body: <Api rows={[
        ['FrameClock', 'Tracks frame-relative time without coupling to a terminal loop.'],
        ['Tween', 'Samples a bounded interpolation through a supplied easing function.'],
        ['SpringValue', 'Stateful damped motion with caller-controlled stepping.'],
        ['AnimationScheduler', 'Owns multiple animations and reports whether work remains.'],
        ['travelPoint', 'Samples a straight or parabolic world-space flight between two points.'],
      ]} /> },
      { heading: 'ResourceCache', body: <><Code>{`const meshes = new ResourceCache<string, Mesh>({
  maxEntries: 24,
  dispose(mesh, key) { releaseAssociatedState(key) }
})

const piece = meshes.getOrCreate(name, loadPiece)`}</Code><p>An unbounded cache preserves insertion order. A bounded cache is LRU: <code>get()</code> retouches an entry and overflow disposes the oldest. Replacing, deleting, evicting, or clearing calls the disposer exactly once for the removed value.</p><p><code>maxEntries</code> must be a positive integer or Infinity; invalid values throw <code>RangeError</code>.</p></> },
    ],
  },
  {
    slug: 'reference/tui/screen', label: 'Screen', title: 'Screen', navParent: 'reference', navGroup: 'TUI',
    summary: 'Retain focus, pointer state, mounted components, scene caches, and terminal diffs across disposable node trees.',
    sections: [
      { heading: 'Import', body: <Code>{`import { Screen, Slot } from '@vercel/arcade/tui'`}</Code> },
      { heading: 'Lifecycle', body: <Api rows={[
        ['setRoot(root, region?)', 'Expand mounted slots and lay out immediately. Equivalent rebuilt trees do not mark the Screen dirty.'],
        ['mount / unmount / component', 'Own persistent Component instances. Slots leaving the tree auto-unmount after reconciliation.'],
        ['resize / setTheme', 'Resize buffers or replace semantic color roles; both invalidate cached presentation.'],
        ['setGlobalOverlay', 'Paint and hit-test application chrome above the current root.'],
        ['dirty / resetDiff', 'Report interaction/content changes or force the next composited frame to repaint.'],
      ]} /> },
      { heading: 'Frame methods', body: <Api rows={[
        ['frame()', 'Paint UI and return absolute ANSI output.'],
        ['frameComposited(present, sceneChanged?, foreground?)', 'Cache a scene Surface, paint UI, and return only changed ANSI cells.'],
        ['snapshot(present, foreground?)', 'Return a complete Surface for tests or images without ANSI diffing.'],
      ]} /> },
      { heading: 'Input routing', body: <p><code>handleKey()</code> routes focused-node input before application fallthrough. Pointer down is one-based at the public boundary, captures the hit node, and keeps drag/up routed there. Hover and wheel use current laid-out geometry; overlays paint last and hit-test first.</p> },
      { heading: 'Example', body: <Code>{`screen.mount(input)
screen.setRoot(Box({ flexDirection: 'column' }, [
  Text({ text: 'Name' }),
  Slot(input.id)
]))

if (screen.dirty()) renderer.requestRender()
renderer.write(screen.frameComposited(presentScene, sceneChanged))`}</Code> },
    ],
  },
  {
    slug: 'reference/tui/layout-nodes', label: 'Nodes and layout', title: 'Nodes and layout', navParent: 'reference', navGroup: 'TUI',
    summary: 'Build disposable node trees and resolve flex-like terminal-cell geometry without a DOM.',
    sections: [
      { heading: 'Node model', body: <Code>{`interface Node {
  kind: 'box' | 'text' | 'button' | 'framebuffer'
  id?: string
  style: Style
  children?: Node[]
  focusable?: boolean
  disabled?: boolean
  onKey?: (event: KeyEvent) => boolean
  onMouse?: (event: PointerHit) => boolean
}`}</Code> },
      { heading: 'Sizing', body: <Api rows={[
        ['number', 'Exact terminal-cell count. Fractional results are rounded by layout.'],
        ['{ pct: number }', 'Fraction of the parent content box.'],
        ['auto', 'Intrinsic text or child size.'],
        ['flexGrow / flexShrink / flexBasis', 'Distribute free space and overflow on the main axis.'],
        ['min/max width/height', 'Clamp the resolved size after intrinsic and flexible calculations.'],
      ]} /> },
      { heading: 'Position and clipping', body: <p>Relative nodes participate in row/column flow. Absolute nodes leave flow and resolve offsets against the nearest content box. <code>overflow: hidden</code> clips both paint and hit testing, so visual and interactive bounds cannot diverge.</p> },
      { heading: 'Common failures', body: <ul><li>Using JavaScript string length instead of terminal display width.</li><li>Expecting percentage dimensions without a resolved parent size.</li><li>Rebuilding a stateful class rather than mounting it through Slot.</li><li>Positioning projected labels without caller-owned viewport clamping.</li></ul> },
    ],
  },
  {
    slug: 'reference/tui/renderer-keymap', label: 'Renderer and Keymap', title: 'Renderer and Keymap', navParent: 'reference', navGroup: 'TUI',
    summary: 'Schedule terminal work on demand and expose stable command IDs to humans and agents through layered bindings.',
    sections: [
      { heading: 'Renderer', body: <><Code>{`const renderer = new Renderer({ maxFps: 60, minFps: 30 })
renderer.onFrame((dt, now) => renderer.write(render(dt, now)))
renderer.start()
renderer.requestRender()`}</Code><p><code>requestRender()</code> coalesces one frame. Counted live leases animate until every owner calls <code>dropLive()</code>. Output is written once per frame and resumes after stream backpressure drains. Recent p95 cost shifts between fast and steady cadence.</p></> },
      { heading: 'Keymap', body: <><Code>{`keymap.register({ id: 'camera.reset', title: 'Reset view', run: reset })
keymap.bind('game', { key: 'r', cmd: 'camera.reset' })
keymap.setBase('game')

keymap.handle(event)       // human input
keymap.commands()[0].run() // same command surface for an agent`}</Code><p>Contexts resolve top-down over the always-present global layer. A modal context swallows unbound keys. <code>activeBindings()</code> returns effective labelled shortcuts from non-modal layers, while <code>commands()</code> returns the complete named action surface.</p></> },
      { heading: 'Cleanup and tests', body: <p>Call <code>destroy()</code> to stop the timer. Inject <code>output</code> and <code>now</code>, then invoke public <code>tick()</code> for deterministic scheduler tests. Use synthetic normalized <code>KeyEvent</code> values to test Keymap without a terminal.</p> },
    ],
  },
  ...componentDocs(),
  {
    slug: 'reference/symbols', label: 'Symbol index', title: 'API and symbol index', navParent: 'reference', navGroup: 'Reference',
    summary: 'Every public symbol generated from the supported TypeScript entry points. Regenerate with pnpm docs:symbols.',
    sections: Object.entries(PUBLIC_SYMBOLS).map(([specifier, symbols]) => ({
      heading: specifier,
      body: <><p>{symbols.length} exported symbols.</p><div className="doc-symbol-grid">{symbols.map((symbol) => <code key={symbol}>{symbol}</code>)}</div></>,
    })),
  },
];

export const GUIDE_DOCS: DocPage[] = [
  {
    slug: 'guides', label: 'Guides', title: 'Guides',
    summary: 'Complete task-oriented paths for rendering, terminal applications, game harnesses, and visual verification.',
    sections: [{ heading: 'Choose a guide', body: <div className="doc-cards">
      <a href="/docs/guides/render-scene"><strong>Render a terminal scene</strong><span>Mesh to Material to RenderTarget to Surface</span></a>
      <a href="/docs/guides/terminal-app"><strong>Build a terminal app</strong><span>Terminal lifecycle, TUI, input, scheduling, and cleanup</span></a>
      <a href="/docs/guides/custom-game"><strong>Add an agent-playable game</strong><span>Rules, private observations, Players, scenes, and headless execution</span></a>
      <a href="/docs/guides/visual-testing"><strong>Verify visuals with agents</strong><span>Render, inspect, revise, and close the visual self-review loop</span></a>
    </div> }],
  },
  {
    slug: 'guides/render-scene', label: 'Render a scene', title: 'Render a terminal scene', navParent: 'guides', navGroup: 'Graphics',
    summary: 'Render an indexed mesh with a typed material and present the result as terminal cells.',
    sections: [
      { heading: 'Create the target and camera', body: <><Code>{`import {
  RenderTarget, Surface, OrbitCamera, cameraMatrices,
  cube, flatShade, lambertMaterial, mat4Identity,
  normalize3, rasterize, shapeGlyphToSurface
} from '@vercel/arcade/engine'

const cols = 100, rows = 36
const target = new RenderTarget(cols * 3, rows * 6)
const surface = new Surface(cols, rows)
const orbit = new OrbitCamera({
  azimuth: 0.5, elevation: 0.4, distance: 6,
  target: { x: 0, y: 0, z: 0 }
})`}</Code><p>ASCII needs enough source samples to distinguish glyph shapes, so this guide uses the presenter’s native 3×6 source region per cell. Pixel mode would normally use <code>cols × rows*2</code>.</p></> },
      { heading: 'Render and present one frame', body: <Code>{`target.clear()
const camera = orbit.toCamera({ fovy: Math.PI / 4, near: 0.05, far: 100 })
const { viewProjection } = cameraMatrices(camera, cols / (rows * 2))

rasterize(target, flatShade(cube()), lambertMaterial, {
  mvp: viewProjection,
  model: mat4Identity(),
  lightDir: normalize3({ x: -0.4, y: 0.8, z: 0.5 }),
  ambient: 0.25,
  wrap: 0.2
})

shapeGlyphToSurface(surface, target, cols, rows, { color: true })
process.stdout.write(surface.serialize())`}</Code> },
      { heading: 'Animate without rebuilding resources', body: <p>Create meshes, targets, surfaces, and materials once. On each frame, clear the target and update only time-dependent transforms or uniforms. Reuse an output target for downsampling and a <code>ShapeGlyphSurfaceCache</code> for stable ASCII cells unless jitter is enabled.</p> },
      { heading: 'Choose the next layer', body: <p>Use <a href="/docs/reference/engine/material">Material and rasterize</a> for custom shading, <a href="/docs/reference/engine/surface">Surface and presenters</a> for output modes, or <a href="/docs/guides/terminal-app">Build a terminal app</a> to add input, scheduling, and cleanup.</p> },
    ],
  },
  {
    slug: 'guides/terminal-app', label: 'Build a terminal app', title: 'Build a terminal application', navParent: 'guides', navGroup: 'Applications',
    summary: 'Combine terminal ownership, normalized input, a retained Screen, and render-on-demand scheduling into a complete application.',
    sections: [
      { heading: 'Create persistent state', body: <Code>{`import {
  Box, FilledButton, Renderer, Screen, Text
} from '@vercel/arcade/tui'
import {
  createInputParser, enterTerminal, leaveTerminal
} from '@vercel/arcade/platform'

const screen = new Screen(process.stdout.columns, process.stdout.rows)
const renderer = new Renderer()
let count = 0

const root = () => Box({ flexDirection: 'column', gap: 1 }, [
  Text({ text: 'Count: ' + count }),
  FilledButton({ id: 'increment', label: 'Increment', onClick: () => {
    count++
    screen.setRoot(root())
    renderer.requestRender()
  } })
])`}</Code> },
      { heading: 'Wire frames and input', body: <><Code>{`renderer.onFrame(() => renderer.write(screen.frame()))

const parse = createInputParser({
  onKey(event) {
    if (event.name === 'q') return shutdown()
    if (screen.handleKey(event)) renderer.requestRender()
  },
  onMouse(event) {
    const handled = event.type === 'down'
      ? screen.pointerDown(event.x, event.y, event.button)
      : event.type === 'drag'
        ? screen.drag(event.x, event.y)
          : event.type === 'up'
          ? screen.pointerUp()
          : event.type === 'wheel'
            ? screen.wheel(event.x, event.y, event.wheel ?? 1)
            : screen.hover(event.x, event.y)
    if (handled) renderer.requestRender()
  }
})

process.stdin.on('data', parse)`}</Code><p>Platform mouse coordinates remain one-based when passed to Screen. The Screen converts at its input boundary. Stateful controls must be mounted once and referenced through Slot rather than reconstructed by <code>root()</code>.</p></> },
      { heading: 'Enter, resize, and clean up', body: <><Code>{`function shutdown() {
  renderer.destroy()
  leaveTerminal()
  process.exit(0)
}

process.stdout.on('resize', () => {
  screen.resize(process.stdout.columns, process.stdout.rows)
  screen.setRoot(root())
  renderer.requestRender()
})

enterTerminal()
screen.setRoot(root())
renderer.start()
renderer.requestRender()`}</Code><Note><code>enterTerminal()</code> registers process cleanup, but application-controlled recoverable errors should still call <code>leaveTerminal()</code>. Headless tests and snapshots should never enter raw mode.</Note></> },
    ],
  },
  {
    slug: 'guides/custom-game', label: 'Custom game', title: 'Add an agent-playable game', navParent: 'guides', navGroup: 'Agents and games',
    summary: 'Define authoritative rules once, then reuse them with humans, models, animated scenes, tests, and headless evaluators.',
    sections: [
      { heading: 'Implement authoritative state', body: <><Code>{`interface GameState<Action> {
  currentPlayer(): number
  legalActions(): Action[]
  applyAction(action: Action): void
  isTerminal(): boolean
  returns(): number[]
  clone(): GameState<Action>
  toString(): string
  actionToString(action: Action): string
  actionFromString(text: string): Action | null
}`}</Code><p>State is mutable and owns legality. <code>clone()</code> must deep-copy every mutable field. Canonical action strings are the shared language for prompts, logs, and replay.</p></> },
      { heading: 'Protect hidden information', body: <p>Implement <code>ImperfectInfoState</code> when players have secrets or explicit chance nodes. Model prompts must use <code>informationStateString(player)</code> or <code>observationString(player)</code>, never complete debug state. Chance outcomes must be finite, non-negative, non-empty, and sum to one.</p> },
      { heading: 'Implement a Player and scene', body: <><Code>{`const firstLegal: Player<Action> = {
  name: 'first-legal',
  async chooseAction(state) {
    return { action: state.legalActions()[0] }
  }
}

const scene: MatchScene<Action> = {
  state: () => state,
  async playMove(action) {
    state.applyAction(action)
    await animateCanonicalResult(action)
  }
}`}</Code><p><code>playMove()</code> is the backpressure boundary. Resolve immediately for headless execution or after required visible animation in an interactive host.</p></> },
      { heading: 'Run and record', body: <><Code>{`const result = await runMatch(scene, players, {
  signal,
  chanceRng: seededRandom,
  onActionChosen(event) { recorder.requested(event.choice.action) },
  async onActionApplied(event) { recorder.applied(event.state) }
})`}</Code><p>Chosen hooks observe pre-action state. Applied hooks run after the scene settles. Record canonical applied actions for replay; raw model text is not authoritative game data.</p></> },
      { heading: 'Package the game', body: <p>Export rules separately from visual geometry and from game-specific harness adapters. Consumers should be able to run the rules and headless harness without importing terminal, authentication, or telemetry code.</p> },
    ],
  },
  {
    slug: 'guides/visual-testing', label: 'Visual verification', title: 'Visual verification for agents', navParent: 'guides', navGroup: 'Testing',
    summary: 'Give coding agents a bounded render-and-inspect loop so they can confirm visual work instead of guessing from source or ANSI output.',
    sections: [
      { heading: 'Close the self-review loop', body: <><p>Snapshots are not only human review artifacts. An agent can render the exact state it changed, open the resulting PNG, compare the visible result against the request and reference images, revise the implementation, and rerender until the evidence matches.</p><Code language="text" title="Workflow">{`read the request and reference image
  -> choose an exact render state
  -> render a bounded PNG
  -> inspect the PNG visually
  -> identify a concrete mismatch
  -> change the smallest responsible code
  -> rerender the same state
  -> run cell, rules, and regression tests
  -> report the image and checks reviewed`}</Code><p>This closes a gap ordinary source review cannot: valid geometry and compiling CSS may still produce clipping, poor hierarchy, wrong camera framing, invisible glyphs, or animation discontinuities.</p></> },
      { heading: 'Freeze every input', body: <><p>Choose explicit terminal columns/rows, animation time, random seed, rules state, camera pose, and interaction state. Keep those identical between baseline and candidate frames so the code change, not a different scene, is responsible for the comparison.</p><p>Replace model inference with scripted actions or fixtures for visual review. Rules and render seeds can be deterministic; remote model output is not.</p></> },
      { heading: 'Render the state an agent needs', body: <><Code title="Terminal">{`pnpm snapshot help

# Composition and game states
pnpm snapshot:png chess-game 140 50 0.6 match
pnpm snapshot:png islanders-game actions seed=42 180 70
pnpm snapshot:png poker 160 60 flop players=4 hud

# Interaction and overlays
pnpm snapshot:png ui 110 44 hover=reset
pnpm snapshot:png setup 120 40 open
pnpm snapshot:png notice 100 34 focus`}</Code><p><code>pnpm snapshot help</code> is generated by the tool and is the authoritative state catalog. Prefer the narrowest snapshot that reproduces the visual concern, then add adjacent states and viewport sizes after the focused result is correct.</p></> },
      { heading: 'Inspect, do not merely generate', body: <><p>A successful command proves only that an image was written. The agent must open the PNG and inspect composition, color, text, glyph integrity, occlusion, alignment, cropping, and the requested state. For motion, render several explicit times and compare the sequence.</p><Code title="Terminal">{`for t in 0.2 0.6 1.0 1.4; do
  pnpm snapshot:png 140 50 "$t" ".snapshots/prism-$t.ppm"
done`}</Code><p>When a user supplied a screenshot, inspect it alongside the new render. Describe the observed mismatch concretely, such as “the label overlaps the board at 100 columns,” before editing.</p></> },
      { heading: 'Assert before encoding', body: <><Code>{`const surface = screen.snapshot(presentScene)
assert.deepEqual(surface.getCell(10, 4), expectedCell)

// Or inspect renderer pixels/depth directly.
assert.ok(target.depth.some(Number.isFinite))`}</Code><p>Cell and framebuffer assertions produce sharper failures than perceptual image diffs. Encode a PNG when composition, spacing, color, or motion needs human judgment.</p></> },
      { heading: 'Know what remains human-only', body: <><p>PNG inspection covers frame composition and explicit animation samples. It cannot prove live terminal color calibration, perceived motion smoothness, keyboard feel, mouse feel, audio, or terminal-specific font rendering. After the agent closes the static loop, ask for targeted human verification only when one of those properties matters.</p><Note>Do not substitute raw ANSI capture for a screenshot. <code>pnpm dev</code> is an infinite raw-mode app; redirected output is escape sequences, not visual evidence.</Note></> },
      { heading: 'Build consumer tooling', body: <p>The reusable foundation is public: RenderTarget, Surface, presenters, <code>Screen.snapshot()</code>, rules, headless runners, and <code>@vercel/arcade/engine/png</code>. Arcade does not yet export its app-specific Surface-to-font-raster PNG adapter, so the exact repository command remains contributor tooling rather than a promised npm API.</p> },
    ],
  },
];

function componentDocs(): DocPage[] {
  return [
    componentPage('input', 'Input', `interface InputOpts {
  id: string; width?: number; maxRows?: number
  value?: string; placeholder?: string
  onChange?: (value: string) => void
  onEnter?: (value: string) => void
  onKeyDown?: (event: KeyEvent, input: Input) => boolean
}`, [
      ['State', 'The instance owns value, caret, horizontal/wrapped-row scroll, and focus. value and caret are public.'],
      ['Keyboard', 'Left/Right, Backspace, Enter, and printable non-control characters. onKeyDown runs first and may consume.'],
      ['Defaults', 'width 24; maxRows 1; value empty.'],
      ['Limitations', 'No selection, Delete, Home/End, or pointer caret placement.'],
    ], `const input = new Input({ id: 'name', placeholder: 'Player', onChange: save, onEnter: join })
screen.mount(input)
screen.setRoot(Slot(input.id))`),
    componentPage('select-dropdown', 'Select and Dropdown', `new Select(opts: SelectOpts)
new Dropdown(opts: DropdownOpts)`, [
      ['Select', 'Always-visible list; Up/Down or j/k moves, Enter/Space commits, wheel changes selection, and click commits.'],
      ['Dropdown', 'Collapsing picker with optional sticky search, case-insensitive filtering, Page Up/Down, Escape, wheel, and outside dismissal.'],
      ['Programmatic updates', 'Select.setItems/setIndex; Dropdown.setItems/setQuery/setAccent.'],
      ['Ownership', 'Both are persistent Components requiring stable IDs and Slot mounting.'],
    ], `const models = new Dropdown({
  id: 'model', items: catalog, width: 32, rows: 7,
  searchable: true, onSelect: (_, model) => choose(model)
})`),
    componentPage('slider', 'Slider', `interface SliderOpts {
  id: string; width?: number; value?: number
  step?: number; onChange?: (value: number) => void
}`, [
      ['Range', 'Fixed 0–1. Initial value clamps; default is 0.5.'],
      ['Keyboard', 'Left/Right or h/l changes by step; default step is 0.05.'],
      ['Pointer', 'Wheel nudges by step; click and drag map continuously across the track.'],
      ['Updates', 'The public value field is the host synchronization seam. There is no setValue, min/max, or Home/End.'],
    ], `const volume = new Slider({ id: 'volume', value: 0.7, step: 0.05, width: 24, onChange: setVolume })`),
    componentPage('table-scrollbox', 'Table and ScrollBox', `Table(opts: TableOpts, rows: Node[]): Node
new ScrollBox(opts: ScrollBoxOpts)`, [
      ['Table width', 'Required total terminal-cell width. Columns use exactly one of width, auto, or flex plus min/max/shrink/alignment.'],
      ['Table ownership', 'Presentational only: callers build and update rows. resolveColumns exposes exact computed widths.'],
      ['ScrollBox state', 'Owns row offset and builds only the visible slice. rows and scroll are public; setHeight reclamps.'],
      ['Scroll behavior', 'Up/Down or j/k, Page Up/Down, three rows per wheel notch, and proportional scrollbar click/drag. Unscrollable input falls through.'],
    ], `const history = new ScrollBox({ id: 'history', rows, height: 12, width: 48 })
screen.mount(history)

const table = Table({ width: 48, columns: [{ auto: true }, { flex: 1, min: 12 }] }, rows)`),
    componentPage('overlays', 'Modal, Dialog, and Tooltip', `Modal(content: Node, opts?: ModalOpts): Node
Dialog(opts: DialogOpts, children?: Node[]): Node
Tooltip(opts: TooltipOpts, trigger: Node): Node`, [
      ['Modal', 'Centers content over a Surface-composited scrim. onDismiss makes outside pointer down dismiss; content absorbs inside clicks.'],
      ['Dialog', 'Standard card chrome with optional title, back/close actions, explicit IDs, padding, width, and title alignment.'],
      ['Tooltip', 'Passive hover metadata painted after portal overlays. It does not affect layout or intercept pointer input.'],
      ['Ownership', 'Use Screen.setGlobalOverlay for application modals; use overlay nodes for subtree-owned floating controls.'],
    ], `screen.setGlobalOverlay(Modal(
  Dialog({ title: 'Confirm', onClose, closeId: 'confirm-close' }, [body]),
  { onDismiss: onClose }
))`),
  ];
}

function componentPage(slug: string, title: string, signature: string, rows: [string, string][], example: string): DocPage {
  return {
    slug: `reference/components/${slug}`, label: title, title, navParent: 'reference', navGroup: 'Components',
    summary: `Reference for Arcade’s ${title} terminal UI component${title.includes(' and ') ? 's' : ''}.`,
    sections: [
      { heading: 'Import', body: <Code>{`import { ${title.replace(' and ', ', ')} } from '@vercel/arcade/tui'`}</Code> },
      { heading: 'Signature', body: <Code>{signature}</Code> },
      { heading: 'Behavior', body: <Api rows={rows} /> },
      { heading: 'Example', body: <Code>{example}</Code> },
      { heading: 'Lifecycle', body: <Note>Construct persistent component classes once, call <code>screen.mount(instance)</code>, and place them through <code>Slot(instance.id)</code>. Plain node builders such as Modal, Dialog, Table, and Tooltip may be rebuilt with the surrounding tree.</Note> },
    ],
  };
}
