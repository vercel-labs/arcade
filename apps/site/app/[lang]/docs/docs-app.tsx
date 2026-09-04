import Link from 'next/link';
import type { ReactNode } from 'react';
import { CodeBlock } from './docs-code';
import type { DocPage } from './docs-content';

const Code = ({ children, title }: { children: string; title?: string }) => <CodeBlock title={title}>{children}</CodeBlock>;
const Note = ({ children }: { children: ReactNode }) => <aside className="doc-note">{children}</aside>;
const Details = ({ rows }: { rows: Array<[string, ReactNode]> }) => <dl className="api-list">{rows.map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>;
const External = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} rel="noreferrer" target="_blank">{children}</a>;

const GATEWAY_DASHBOARD = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway';
const GATEWAY_KEYS = 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys';
const GATEWAY_PRICING = 'https://vercel.com/docs/ai-gateway/pricing';
const GATEWAY_FREE_MODELS = 'https://vercel.com/ai-gateway/models?freeTier=true';
const GATEWAY_BUDGETS = 'https://vercel.com/docs/ai-gateway/observability-and-spend/budgets';

export const APP_DOCS: DocPage[] = [
  {
    slug: 'app', label: 'Using Arcade', title: 'Play and spectate',
    summary: 'Move through the Arcade app, start human and model matches, follow live games, and know where each screen and control lives.',
    sections: [
      {
        heading: 'Choose how to play',
        body: <><p>The <code>arcade</code> command launches an interactive terminal app. From its Cover Flow home screen, open Chess, Poker, Islanders, or the Tutorial. The games support different combinations of human and model seats; the Tutorial supplies local practice bots so you can learn the interface before making a model request.</p><Details rows={[
          ['Play a model', <>Choose <strong>human</strong> for your seat and a model for the opposing seat. Chess is the shortest path to a one-on-one match.</>],
          ['Spectate models', <>Assign models to every seat and watch the match, public commentary, animations, and records progress without taking a turn yourself.</>],
          ['Practice offline', <>Open the Tutorial. Its Poker and Islanders chapters use local policy bots, and Gateway-only checklist steps are skipped when you are signed out.</>],
        ]} /><Note>You can open Arcade and complete most of the Tutorial without a Vercel account. Only real model seats require Vercel sign-in and AI Gateway access.</Note></>,
      },
      {
        heading: 'Follow the app flow',
        body: <Details rows={[
          ['Opening prism', 'Arcade detects terminal color support while a CPU-rendered prism introduces the display. Continue to the launcher with any key.'],
          ['Cover Flow', 'Move between the three public games and Tutorial. Open a cover to enter its scene; the home menu also holds account and telemetry controls.'],
          ['Match setup', 'Choose which seats are human or model controlled, select models, and start only when every required seat is assigned.'],
          ['Health check', 'Before a model match begins, Arcade sends one small request to each unique selected model. A failed check leaves setup recoverable and explains the likely access, billing, or provider problem.'],
          ['Game scene', 'The board or table owns the camera, contextual action bar, status, and animated consequences. Optional panels expose controls, history, chat, or private reads where the game supports them.'],
          ['Menu and account', 'Press m or open the top-right menu for display, controls, reset, home, account, and quit actions. Switch the billed Vercel team or sign out from Account.'],
        ]} />,
      },
      {
        heading: 'Start a match',
        body: <><Details rows={[
          ['1. Open a game', 'Choose Chess, Poker, or Islanders from the launcher. The scene opens before you commit to a model match.'],
          ['2. Open match setup', 'Use New match or the model setup control. Escape closes setup without changing the current game.'],
          ['3. Assign seats', 'Choose human where you want to act, or select a model creator and model. Poker and Islanders support more seats than Chess.'],
          ['4. Start', 'Arcade health-checks the selected models, then applies every human or model action through the same authoritative game rules.'],
          ['5. Recover if needed', <>If a model fails before the match, stay in setup and read <Link href="/docs/app/models">Models, teams, and billing</Link>. You can change the model or billed team and retry.</>],
        ]} /><p>Model availability and pricing can differ by team. A model appearing in the picker is useful discovery, but the Start-time health check is the final proof that the selected team can route a request right now.</p></>,
      },
      {
        heading: 'Follow a live game',
        body: <Details rows={[
          ['Public commentary', 'Chat contains table-facing speech or rationale, not hidden chain-of-thought. Press c where chat is available; directed @model mentions can request one bounded reply.'],
          ['Private reads', 'Poker seats can keep private notes about how others play. These notes belong to the local match experience and are not part of canonical telemetry.'],
          ['History and records', 'Chess exposes move history and PGN copy. Poker and Islanders preserve their own action and match records for replay and inspection.'],
          ['Model wisps', 'A colored wisp identifies a model seat and reacts when it speaks or thinks. In supported screens, select the wisp to swap that seat to another model.'],
          ['Human pacing', 'Arcade waits for visible movement, dice, cards, resources, and other consequences before advancing even when a model decides immediately.'],
        ]} />,
      },
      {
        heading: 'Continue from here',
        body: <div className="doc-cards doc-cards--single">
          <Link href="/docs/app/controls"><strong>Controls and tutorial</strong><span>Camera gestures, global keys, display modes, contextual help, and the eight-chapter walkthrough</span></Link>
          <Link href="/docs/app/models"><strong>Models, teams, and billing</strong><span>Vercel sign-in, the generated Arcade key, team-aware model discovery, credits, and troubleshooting</span></Link>
          <Link href="/docs/games"><strong>Game rules and case studies</strong><span>Detailed Chess, Poker, and Islanders rules plus graphics, model context, communication, and records</span></Link>
        </div>,
      },
    ],
  },
  {
    slug: 'app/controls', label: 'Controls and tutorial', title: 'Controls and tutorial', navParent: 'app',
    summary: 'Learn Arcade on its real game screens, then use the global camera, navigation, display, and contextual controls across every table.',
    sections: [
      {
        heading: 'Start with the Tutorial',
        body: <><p>The Tutorial is a playable cover in the home launcher, not a separate simulation. It opens the real Chess, Poker, and Islanders screens with a checklist rail on the right. Controls pulse when a chapter asks you to use them, completed steps turn green, and you decide when to continue or skip.</p><Details rows={[
          ['1. Welcome', 'Explains the checklist, skip, and exit behavior on the Chess screen.'],
          ['2. Camera', 'Practices zoom, orbit, pan, arrow-key movement, reset, and terminal font density.'],
          ['3. Menu', 'Covers display styles, color modes, the Chess evaluation bar, contextual controls, and Escape.'],
          ['4. Chess', 'Selects and moves pieces, opens history and match setup, starts an optional real model match, and swaps a model wisp.'],
          ['5. Poker', 'Practices card peeking, checking, calling, raising, folding, chat, and private reads against local bots.'],
          ['6. Keyboard', 'Reinforces global help, Escape, display cycling, menu, and quit behavior.'],
          ['7. Islanders', 'Walks through camera movement, initial placement, rolling, building, bank trading, and ending a turn against local bots.'],
          ['8. Done', 'Returns home or lets you revisit an earlier chapter.'],
        ]} /><Note>The walkthrough is offline-first and does not record practice-bot games. Steps that require AI Gateway are labelled and left out of completion when you are signed out.</Note></>,
      },
      {
        heading: 'Move the camera',
        body: <Details rows={[
          ['Scroll or two-finger swipe', 'Zoom toward or away from the current game scene.'],
          ['Click and drag', 'Orbit around the board or table while keeping the camera above the scene.'],
          ['Right-drag or modified drag', 'Pan the scene. Shift, Command, or Control can replace the right mouse button when the terminal reserves it.'],
          ['Arrow keys', 'Pan without the pointer. Hold a key for continuous movement.'],
          ['r', 'Reset the current game camera to its authored framing.'],
        ]} />,
      },
      {
        heading: 'Use global controls',
        body: <><Details rows={[
          ['?', 'Open the complete keyboard and mouse reference for the current screen. This is the source of truth for contextual controls.'],
          ['m', 'Open or close the current screen menu.'],
          ['Escape', 'Close the topmost popup or menu. With nothing open inside a game, Arcade asks before returning home.'],
          ['d', 'Cycle ASCII, pixels, and hybrid display styles.'],
          ['q or Ctrl+C', 'Enter the app quit path. An active screen may ask for confirmation before Arcade exits.'],
        ]} /><p>Arcade maps these inputs to stable command IDs. The same command can be invoked from a menu, a key binding, or an agent-capable host without changing what the action means.</p></>,
      },
      {
        heading: 'Know the game controls',
        body: <><Details rows={[
          ['Chess', <>Select a piece to reveal legal destinations, then select a highlighted square. Toggle move history with <code>h</code>, the evaluation bar with <code>e</code>, and use New match for human or model seats.</>],
          ['Poker', <>Use the contextual action bar to fold, check, call, bet, or raise. Press <code>c</code> for chat, <code>p</code> to pause, and Space to skip the countdown between hands.</>],
          ['Islanders', 'Use the phase-specific HUD for placement, rolling, building, trading, robber actions, and ending a turn. Chat and directed model mentions stay separate from legal game actions.'],
        ]} /><p>Press <code>?</code> after entering a game for the exact controls available in its current phase. Read the <Link href="/docs/games">Games</Link> chapter for complete rules and game-specific behavior.</p></>,
      },
      {
        heading: 'Choose a display density',
        body: <><Details rows={[
          ['ASCII', 'Shape-matches source brightness into terminal glyphs. It is the default and usually the clearest at ordinary terminal sizes.'],
          ['Pixels', 'Uses half-block cells for two vertical color samples per terminal cell.'],
          ['Hybrid', 'Combines a shape-matched glyph with foreground and background color.'],
          ['Truecolor and 256 color', 'Arcade detects terminal support at launch. The menu can switch modes when you need compatibility or want to compare output.'],
          ['Terminal font size', 'Use your terminal application’s font-size shortcut. A smaller font creates more cells and a sharper scene; a larger font improves text comfort.'],
        ]} /><p>Resize the window freely. Arcade recomputes its layout and camera framing from the available terminal grid rather than assuming one fixed resolution.</p></>,
      },
    ],
  },
  {
    slug: 'app/models', label: 'Models and billing', title: 'Models, teams, and billing', navParent: 'app',
    summary: 'Understand Vercel sign-in, the team-scoped Arcade key, model availability, free and paid AI Gateway access, spend, and recoverable failures.',
    sections: [
      {
        heading: 'Know what model play requires',
        body: <><p>Arcade itself and its offline-first Tutorial do not require a Vercel account. Real model seats require a Vercel account that belongs to at least one team, because AI Gateway keys and usage are scoped to a team.</p><p>Every Vercel team has an AI Gateway free tier and paid tier. You can use the free-tier model subset without purchasing Gateway Credits. Other models and higher limits require purchased AI Gateway Credits, or invoiced billing for an eligible Enterprise team.</p><Note>The monthly free-credit amount, eligible models, and limits are controlled by AI Gateway and can change. Arcade links to the canonical Gateway pages instead of hardcoding a dollar amount.</Note></>,
      },
      {
        heading: 'Sign in and choose a team',
        body: <><p>On first model-enabled launch, Arcade starts Vercel device authorization in the normal terminal before entering its full-screen UI. Approve the browser request, return to the terminal, and choose the team that should own AI Gateway usage.</p><Code title="Terminal">{`arcade --login
arcade --switch-team
arcade --logout`}</Code><Details rows={[
          ['Sign in', 'Force a new device-authorization flow when you skipped it or need another Vercel account.'],
          ['Switch team', 'Choose another team, create or reuse its Arcade key, refresh the model catalog, and bill future model requests there.'],
          ['Sign out', 'Remove the cached Vercel session and process-local Gateway key from this machine. It does not delete keys already listed in the Vercel dashboard.'],
          ['Account menu', 'Perform the same account and team changes without leaving the running Arcade app.'],
        ]} /></>,
      },
      {
        heading: 'Understand the Arcade key',
        body: <><p>Arcade creates or reuses an AI Gateway key for the selected team through Vercel’s get-or-create exchange. A newly created key is named <code>{'Arcade (<username>)'}</code>, or <code>Arcade</code> when the username is unavailable. An existing exchanged key keeps the name it already has.</p><Details rows={[
          ['Where to find it', <>Open the <External href={GATEWAY_KEYS}>AI Gateway API Keys page</External> for the selected team. The raw secret cannot be retrieved again, but the key entry, last use, budget, spend, and revoke controls remain visible.</>],
          ['What Arcade stores', <>Vercel OAuth tokens, the chosen team, and username are cached in <code>~/.config/arcade/auth.json</code> with private file permissions.</>],
          ['What Arcade does not store', 'The generated AI Gateway key is held only in the running process. Arcade derives it again from the cached Vercel session on the next launch.'],
          ['Shell credentials', <>The app intentionally ignores an inherited <code>AI_GATEWAY_API_KEY</code> so an unrelated shell key cannot silently select a different billing scope.</>],
          ['Revocation', 'Signing out of Arcade clears local access only. Delete the key from the Vercel API Keys page when you want to revoke it for the team.'],
        ]} /></>,
      },
      {
        heading: 'Understand the model picker',
        body: <><p>After sign-in, Arcade requests an availability-aware AI Gateway model catalog using the selected team’s key. It refreshes at launch and after a team switch, groups models by creator, and uses Gateway popularity only to order choices.</p><Details rows={[
          ['Hidden models', 'Models that Gateway marks durably ineligible because of team policy are removed from the picker.'],
          ['Visible unknowns', 'Unknown, transient, or configuration-dependent eligibility can remain visible so a temporary evaluation does not empty the catalog.'],
          ['Fallback catalog', 'If the availability request fails, times out, or lacks eligibility annotations, Arcade uses its baked compatibility-tested catalog.'],
          ['Final health check', 'Starting a match sends one small request to each unique selected model. This is the final check for current credits, rate limits, provider access, and routing health.'],
        ]} /><Note>The picker is team-aware, but appearing there is not a guarantee that a model can answer right now. Use the Start-time health result as the current routing verdict.</Note></>,
      },
      {
        heading: 'Understand free and paid access',
        body: <Details rows={[
          ['Free tier', <>A monthly included credit covers a <External href={GATEWAY_FREE_MODELS}>subset of models</External>. Free requests have lower per-model rate limits, and the credit period begins with the team’s first Gateway request.</>],
          ['Paid tier', <>Purchase AI Gateway Credits from the <External href={GATEWAY_DASHBOARD}>Gateway dashboard</External> to use models outside the free subset and receive higher Gateway rate limits.</>],
          ['Monthly credit after purchase', <>Purchasing Gateway Credits moves the team to the paid tier, and the monthly free credit no longer applies. See <External href={GATEWAY_PRICING}>AI Gateway pricing</External> for the current policy.</>],
          ['Payment method', 'Choose a payment method during the Gateway credit purchase flow. Merely opening Arcade or using a free-tier model does not require a credit purchase.'],
          ['Enterprise', 'Eligible Enterprise teams can arrange invoice billing instead of purchasing credits through the dashboard.'],
          ['Token pricing', 'AI Gateway charges provider list prices with no token markup. Model pages show current input, output, and cached-token rates.'],
        ]} />,
      },
      {
        heading: 'Manage keys, spend, and limits',
        body: <Details rows={[
          ['AI Gateway dashboard', <>Open <External href={GATEWAY_DASHBOARD}>AI Gateway</External> to see the current credit balance. Overview charts usage and spend by model, while Logs shows individual request costs and routing attempts.</>],
          ['API Keys', <>Open <External href={GATEWAY_KEYS}>API Keys</External> to identify the Arcade key, inspect last use, set a key budget where available, or revoke it.</>],
          ['Free-tier models', <>Browse the current <External href={GATEWAY_FREE_MODELS}>free-tier model list</External> rather than relying on a static list in Arcade documentation.</>],
          ['Pricing and credits', <>Read <External href={GATEWAY_PRICING}>AI Gateway pricing</External> for current free-tier, credit-purchase, expiration, and Enterprise billing policy.</>],
          ['Budgets', <>Use <External href={GATEWAY_BUDGETS}>Gateway budgets</External> to cap or alert on spend for a team, project, API key, or team member.</>],
        ]} />,
      },
      {
        heading: 'Troubleshoot model play',
        body: <Details rows={[
          ['No teams available', 'Create or join a Vercel team, then sign in again. Arcade cannot create a Gateway key for an account with no available teams.'],
          ['Fewer models than expected', 'Confirm the selected team, then check its free or paid tier and any team-wide model or provider policy. Different teams can receive different catalogs.'],
          ['Model appears but Start fails', 'Read the health-check reason. The common causes are missing paid credits for that model, exhausted credits, a free-tier rate limit, provider access, or a transient Gateway/provider failure.'],
          ['Wrong team is billed', 'Open Account and switch team before starting the match. Arcade refreshes the key and model catalog for the new selection.'],
          ['HTTP 429', 'Wait for the model’s free-tier window to recover, choose another eligible model, or move the team to paid Gateway access for higher limits.'],
          ['Key was revoked', 'Run arcade --login or use Account to sign in again so Arcade can obtain a valid team key.'],
          ['Catalog fell back', 'Check network access, relaunch, or switch teams after connectivity recovers. Start-time health checks still prevent a broken selection from silently beginning a match.'],
        ]} />,
      },
    ],
  },
];
