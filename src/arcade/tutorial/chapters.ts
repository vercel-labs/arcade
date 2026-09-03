// The tutorial's content: chapters, their steps, and the copy — pure data. The controller
// (tutorial.ts) walks it; main.ts stages each chapter's screen and emits the signals the
// steps wait for. Keep behavior out of here so the walkthrough reads as one document.

// Which screen a chapter plays on. main maps these to its enter* transitions.
export type TutorialScreen = 'chess' | 'poker' | 'islanders';

export interface TutorialStep {
  id: string;
  // The checklist line (lowercase, like the app's chrome).
  label: string;
  // One or two sentences shown while this is the current step: how, and why it matters.
  hint: string;
  // Signal name(s) that tick this step (main emits them from the real feature). A step
  // listening to several completes on whichever arrives first.
  signal: string | readonly string[];
  // Node ids to pulse while this is the current step (wherever they were built). A
  // missing id (a menu item before the menu opens) is harmless.
  target?: readonly string[];
  // How many times the signal must arrive before the step ticks (default 1) — "cycle
  // through every display style" is three presses.
  count?: number;
  // A step that needs an AI Gateway key (a real model match). Without one it is shown dimmed
  // with a sign-in note and does not count toward the chapter, so a signed-out player is
  // never stuck behind it.
  requires?: 'gateway';
}

export interface TutorialChapter {
  id: string;
  title: string;
  screen: TutorialScreen;
  // Short intro under the title — what this chapter is about.
  intro: string;
  steps: readonly TutorialStep[];
  // A closing thought shown once every step is ticked (or on a step-less chapter).
  outro?: string;
  // The primary action shown once the chapter is complete (immediately for a step-less one):
  // welcome's `begin`, and the closing chapter's `end tutorial`, which returns home.
  action?: string;
}

// The terminal's own font-size shortcut, named for the platform. The app never sees the
// chord (the emulator eats it) — it sees the cell grid change — so this is copy, not a binding.
const MAC = process.platform === 'darwin';
const FONT_SMALLER = MAC ? '⌘ −' : 'ctrl −';
const FONT_BIGGER = MAC ? '⌘ +' : 'ctrl +';

export const TUTORIAL_CHAPTERS: readonly TutorialChapter[] = [
  {
    id: 'welcome',
    title: 'welcome',
    screen: 'chess',
    intro: 'Arcade is a set of 3D games drawn in your terminal, played against AI models.',
    outro:
      'This walkthrough covers the camera, each game, the menu, and the keyboard. Every chapter is a checklist: do the things and they turn green. Skip a chapter any time, or leave with ✕.',
    action: 'begin',
    steps: [],
  },
  {
    id: 'camera',
    title: 'camera',
    screen: 'chess',
    intro: 'Every game is a 3D scene. Frame it however you like.',
    steps: [
      { id: 'zoom', label: 'scroll to zoom', hint: 'Mouse wheel or a two-finger swipe. Zoom in on a piece, back out to see the whole board.', signal: 'camera.zoom' },
      { id: 'orbit', label: 'click and drag to rotate', hint: 'Drag anywhere on the scene. The camera stays above the board, so you can never end up underneath it.', signal: 'camera.orbit' },
      { id: 'pan', label: 'right-click and drag to pan', hint: 'Holding shift (or ⌘ / ctrl) while dragging pans too, handy when the right button opens your terminal\'s menu.', signal: 'camera.pan' },
      { id: 'pan-keys', label: 'arrow keys pan as well', hint: 'They slide the scene the way a drag does. Hold a key to keep going.', signal: 'camera.panKey' },
      { id: 'reset', label: 'press r to reset the view', hint: 'Every game menu has a reset camera item too.', signal: 'camera.reset' },
      { id: 'font-smaller', label: `${FONT_SMALLER} to shrink the text, three times`, hint: 'Your terminal\'s font-size shortcut. More cells means sharper ASCII, but the interface shrinks with it. Resizing the window counts too.', signal: 'terminal.denser', count: 3 },
      { id: 'font-bigger', label: `${FONT_BIGGER} to grow it back, three times`, hint: 'Find the size where the pieces still read and the text is comfortable.', signal: 'terminal.coarser', count: 3 },
    ],
    outro: 'The same gestures work on every table in the arcade.',
  },
  {
    id: 'menu',
    title: 'menu',
    screen: 'chess',
    intro: 'Every game has the same ☰ menu (press m). Settings change live.',
    steps: [
      { id: 'open', label: 'open the menu', hint: 'Top right, or press m.', signal: 'ui.menuOpen', target: ['chess-menu'] },
      { id: 'display', label: 'cycle through the display styles', hint: 'ascii → pixels → hybrid → back to ascii. ascii is the shape-matched default; pixels is half-block color; hybrid is both. d cycles it anywhere.', signal: 'ui.display', target: ['chess-menu-mode'], count: 3 },
      { id: 'color', label: 'switch through the color modes', hint: 'truecolor is detected at launch; 256-color is the fallback for terminals without it. Switch to it and back.', signal: 'ui.color', target: ['chess-menu-color'], count: 2 },
      { id: 'eval', label: 'turn on the eval bar', hint: 'A live material-and-position score along the right edge. e toggles it too.', signal: 'chess.evalBar', target: ['chess-menu-eval'] },
      { id: 'controls', label: 'open controls', hint: 'Every key and mouse gesture for the screen you\'re on. ? opens it anywhere.', signal: 'ui.controls', target: ['chess-menu-shortcuts'] },
      { id: 'close', label: 'close the menu with esc', hint: 'Esc backs out one level: a popup, then the menu, then the game asks before going home.', signal: 'ui.menuClose' },
    ],
    outro: 'home, reset board, reset camera, illegal moves, and quit live here too.',
  },
  {
    id: 'chess',
    title: 'chess',
    screen: 'chess',
    intro: 'Click to play. Free play lets you move both sides; a match against a model is one click away.',
    steps: [
      { id: 'select', label: 'click a white piece to select it', hint: 'Its legal squares light up. Click it again, or an empty square, to deselect.', signal: 'chess.select' },
      { id: 'move', label: 'click a lit square to move', hint: 'Pieces animate into place and the side to move flips. Captured pieces line up beside the board.', signal: ['chess.move', 'chess.capture'] },
      { id: 'history', label: 'hide or show the move list', hint: 'Press h, or click the moves pill. The copy button beside it puts the game on your clipboard as PGN.', signal: 'chess.history', target: ['moves-toggle'] },
      { id: 'setup', label: 'open new match', hint: 'The match picker: a model for either side, or you. It needs a Vercel sign-in (home → menu → account). Esc closes it.', signal: 'chess.setup', target: ['ai'] },
      { id: 'start', label: 'pick a side and a model, then start', hint: 'Choose human for one side to play the model yourself, or two models to watch. Models are billed to your Vercel team through AI Gateway, so the team needs credit or a card on file. If it doesn\'t, you\'ll see the same health-check popup a normal match shows, with the fix.', signal: 'chess.matchStarted', requires: 'gateway' },
      { id: 'swap', label: 'click a wisp to swap its model', hint: 'Each model\'s flame floats over its king and pulses while it thinks. Click one to switch that side to a different model mid-game.', signal: 'chess.swap', requires: 'gateway' },
    ],
    outro: 'Chat (c) shows each model\'s reasoning as it plays; reset board starts over.',
  },
  {
    id: 'poker',
    title: 'poker',
    screen: 'poker',
    intro: 'No-limit hold\'em against models. For this chapter the other seats are practice bots.',
    steps: [
      { id: 'peek', label: 'hover a hole card to peek', hint: 'Your two cards sit face down in front of you. Hovering bends one up so only you can see it.', signal: 'poker.peek' },
      { id: 'lift', label: 'click a card to lift it', hint: 'Lifted cards stay face up until you click them again.', signal: 'poker.lift' },
      { id: 'check', label: 'check or call', hint: 'When it\'s your turn the action bar appears bottom right. The middle button reads check or call depending on what you face.', signal: 'poker.checkCall', target: ['poker-check', 'poker-call'] },
      { id: 'raise', label: 'size a raise and bet', hint: 'Set the amount with the slider, the pot-fraction chips, the field, or the − and + keys, then press bet or raise.', signal: 'poker.raise', target: ['poker-raise'] },
      { id: 'fold', label: 'fold a hand', hint: 'You can only fold when it\'s your turn. Space skips the countdown between hands.', signal: 'poker.fold', target: ['poker-fold'] },
      { id: 'chat', label: 'open chat', hint: 'Press c or click chat. Every seat talks between actions; models do it in character, and you can type back.', signal: 'poker.chat', target: ['poker-chat-open'] },
      { id: 'reads', label: 'open reads', hint: 'Each seat keeps private notes on how everyone plays: patterns, bet sizing, what they fold to. Real models write these between hands. The bots\' are samples.', signal: 'poker.reads', target: ['poker-notes'] },
    ],
    outro: 'p pauses and resumes the table. Space skips the countdown between hands.',
  },
  {
    id: 'keyboard',
    title: 'keyboard',
    screen: 'poker',
    intro: 'A few keys work on every screen. Try them here while the table plays on.',
    steps: [
      { id: 'controls', label: 'press ? for controls', hint: 'The full key and mouse list for wherever you are.', signal: 'key.?' },
      { id: 'escape', label: 'press esc to back out', hint: 'Closes whatever is open. Inside a game with nothing open it asks before leaving; choose cancel to stay.', signal: 'key.escape' },
      { id: 'display', label: 'press d through every display style', hint: 'Three presses: ascii → pixels → hybrid → back to ascii. Works even while a popup is open.', signal: 'key.d', count: 3 },
      { id: 'menu', label: 'press m for the menu', hint: 'm closes it again.', signal: 'key.m' },
    ],
    outro: 'Here at the table: p pauses and resumes, − and + size a bet, c is table talk. In chess: h moves, c chat, e eval bar, p play/pause. r resets the camera anywhere. q asks to quit; ctrl+c quits at once.',
  },
  {
    id: 'islanders',
    title: 'islanders',
    screen: 'islanders',
    intro: 'Settle an island: place, roll, gather, build, trade. You\'re red, against two practice bots.',
    steps: [
      { id: 'explore', label: 'zoom in or rotate to look around', hint: 'Scroll and drag, like any table. Each hex is a terrain with a number; settlements go on the corners where tiles meet.', signal: ['camera.zoom', 'camera.orbit'] },
      { id: 'settlement', label: 'place a settlement at a tile intersection', hint: 'Hover a corner where tiles meet: a legal spot highlights under the cursor, and a click places. Corners touching more numbers, and more different resources, produce more.', signal: 'islanders.settlement' },
      { id: 'road', label: 'add a road beside it', hint: 'Roads leave from your settlement. Point one toward where you\'d like to build next.', signal: 'islanders.road' },
      { id: 'setup-done', label: 'finish setup: a second settlement and road', hint: 'Placement snakes: the last player to place goes first on the second round.', signal: 'islanders.setupDone' },
      { id: 'roll', label: 'roll the dice', hint: 'Every settlement on a rolled number pays its owner. A 7 moves the robber instead.', signal: 'islanders.roll', target: ['islanders-live-roll'] },
      { id: 'build', label: 'build something', hint: 'Your hand has been stocked for this. A road costs brick + lumber; a settlement adds grain + wool; a city upgrades a settlement for three ore + two grain. Pick a build, then hover and click a legal spot.', signal: 'islanders.build', target: ['islanders-live-road', 'islanders-live-settlement'] },
      { id: 'trade', label: 'trade with the bank', hint: 'Open your hand (the cards button, top right) and choose trade: four of a kind for any one card, or better at a port. The hand sidebar needs a wide window. If the button isn\'t there, widen the terminal or skip ahead.', signal: 'islanders.trade', target: ['islanders-game-sidebar-open', 'islanders-trade-open'] },
      { id: 'end', label: 'end your turn', hint: 'The bots take their turns, then the dice come back to you.', signal: 'islanders.endTurn', target: ['islanders-live-end'] },
    ],
    outro: 'The sidebar also holds the log and table talk: type to address everyone, or @ a seat.',
  },
  {
    id: 'done',
    title: 'done',
    screen: 'islanders',
    intro: 'That\'s the arcade: the camera, the games, the menu, and the keys.',
    outro:
      'Go have fun. Pick a cover, sit down against a model, and see how it plays. This tutorial stays on the shelf whenever you want it again.',
    action: 'end tutorial',
    steps: [],
  },
];
