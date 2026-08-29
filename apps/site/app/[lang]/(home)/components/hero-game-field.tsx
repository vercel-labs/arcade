const CHESS_KNIGHT = String.raw`
          ╭╮
      ╭───╯╰╮
    ╭─╯  ╭──╯
   ╭╯   ╭╯
  ╭╯  ╭─╯
 ╭╯   ╰────╮
 ╰─────────╯`;

const CATAN_TILE = String.raw`
       ╱╲
    ╱wwww╲
  ╱ww  8 ww╲
  ╲wwwwwwww╱
    ╲wwww╱
       ╲╱`;

const DICE = String.raw`
       ______
     ╱  •  ╱│
   ╱ •  •╱  │
  ╱_____╱ • │
  │ •   │   │
  │   • │ •╱
  │_____│╱`;

const SETTLEMENT = String.raw`
       ╱╲
      ╱  ╲
     ╱____╲
     │ [] │
     │____│`;

export function HeroGameField() {
  return (
    <div aria-hidden="true" className="hero-game-field">
      <pre className="hero-game-piece hero-game-piece--knight">{CHESS_KNIGHT}</pre>
      <pre className="hero-game-piece hero-game-piece--catan">{CATAN_TILE}</pre>
      <pre className="hero-game-piece hero-game-piece--dice">{DICE}</pre>
      <pre className="hero-game-piece hero-game-piece--settlement">{SETTLEMENT}</pre>

      <div className="hero-card-shuffle">
        <div className="hero-playing-card hero-playing-card--back">▒▒</div>
        <div className="hero-playing-card hero-playing-card--red">
          <span>Q</span>
          <strong>♥</strong>
        </div>
        <div className="hero-playing-card hero-playing-card--black">
          <span>A</span>
          <strong>♠</strong>
        </div>
      </div>

      <div className="hero-road hero-road--one">════════</div>
      <div className="hero-road hero-road--two">══════</div>
    </div>
  );
}
