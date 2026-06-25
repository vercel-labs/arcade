# TODO

- Improve button UI on the home screen and within the chess game.
- Improve the setup UI.
- Let players click a wisp directly during an AI match to open a popup that swaps the model/provider on the spot (game pauses during the switch; wisp updates to the new provider logo afterward).
- Improve the AI-vs-AI modal: scrolling instead of up/down toggling, and ideally a new scrollable dropdown component for the TUI.
- Add real-time audio: research how Vercel AI Gateway supports it, add banter wired to the wisp animation during play. Both players must share real-time audio capability (no real-time vs. traditional); gate available models behind a setup toggle.
- Bug fix: up/down arrow keys in the chess game are still absorbed by the scrollable moves modal instead of panning the 3D scene.
