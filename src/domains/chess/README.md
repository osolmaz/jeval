# Chess

The `chess` domain has the model play a game of chess, against an opponent that picks random legal moves, the setup
of [LLM Chess](https://github.com/maxim-saplin/llm_chess), against the [Stockfish](https://stockfishchess.org/) engine,
or against itself. At each step the model sees the board and picks one of the legal moves; against an opponent, the
opponent then replies. The game ends at checkmate,
at a draw, when the side to move resigns, or after 200 steps.

## Install

Chess needs nothing beyond switch itself; install it as the [main README](../../../README.md#install) says. Games
against Stockfish also need a Stockfish binary, such as one from its
[releases](https://github.com/official-stockfish/Stockfish/releases), and the `STOCKFISH` environment variable set to
its path.

## Cases

A case folder holds a `case.json`:

```json
{ "id": "white-seed-1", "opponent": "random", "side": "white", "seed": 1 }
```

`opponent` is `random`, the default; `stockfish`; or `self`, where the model plays both sides and each step is one
move of the side to move. Against an opponent, `side` is the side the model plays, white by default. `seed` picks the
random opponent's moves: the same seed and the same moves before it always give the same reply. Stockfish keeps every UCI option at its default and thinks `movetime` milliseconds about each move, 1000 by
default; it starts afresh for each move, so it keeps no hash table between moves. An optional `start` gives the start
position in FEN; when the opponent is to move in it, it moves first. [`examples/chess/`](../../../examples/chess) holds
a game for each side against the random opponent and against Stockfish, and a self-play game.

## Play a game

Run the commands from the repository root:

```bash
node src/cli/main.ts run --domain chess examples/chess/white-seed-1 --out runs/chess --model typesafe/jev-latest
STOCKFISH=/path/to/stockfish node src/cli/main.ts run --domain chess examples/chess/stockfish-white --out runs/stockfish
```

Each case's `result.json` gets an `outcome`: the `result`, its `reason`, the number of `moves` both sides made, each side's `material` (pawn 1, knight and bishop 3, rook 5, queen 9)
and the final position as `fen`. Against an opponent the result is the model's: win, loss or draw. In
self-play it names the winner: white wins or black wins, or a draw. A game the step limit cut is unfinished.

The model sees the board as text with rank 8 at the top, each side's pieces, whether it is in check, what the last
step did, and the moves so far; when the whole game does not fit the window, only the latest 20 moves. Each choice on
the menu is a legal move in algebraic notation with its meaning in words, such as
`exd5 (pawn e4 to d5, takes the pawn)`. The stop choice resigns the game.

## Replay a game

`replay` takes each step's observation from the game's trace, the opponent's replies included, so a game replays as it
was played. This is true also against Stockfish, which does not always pick the same move in the same position. With
`--fork <steps>`, the opponent replies again only after the fork. A replay against Stockfish still needs `STOCKFISH`,
because the load of the case starts the engine to read its name:

```bash
STOCKFISH=/path/to/stockfish node src/cli/main.ts replay --domain chess examples/chess/stockfish-white runs/stockfish/cases/stockfish-white/trace.jsonl
```

## Watch a game

Add `--view` to `run` to watch the game while it is played, or open a finished run with `view`:

```bash
node src/cli/main.ts run --domain chess examples/chess/self-play --out runs/self-play --view
node src/cli/main.ts view runs/self-play
```

The page looks like a game on chess.com: a green board, with each player's bar above and below it, the pieces they
took and a box lit for the side to move. At each step the board shows the position the model chose in, with orange
arrows for its five likeliest moves, as wide as their probabilities, the chosen one solid; then the pieces move. Beside
the board are the model's confidence in each move it chose, the step's menu with the model's probability for each
choice, and the move history in numbered rows with piece icons, where a move opens its step. The page plays the game back at four speeds,
the arrow keys step through it, and it downloads the game as PGN. The start of the game, each move, a capture,
castling, a check and the end (checkmate, stalemate, or another game over) each play their own short recorded clip
from [`assets/sounds/`](../../../assets/sounds), which the table `SOUND_SET` in `src/view/sounds.ts` maps by event;
the Sound button turns them off.

The pieces are cburnett by Colin M.L. Burnett, the set lichess shows by default, under the BSD license;
`assets/pieces/cburnett/` holds them unchanged from
[Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces) with their license.
