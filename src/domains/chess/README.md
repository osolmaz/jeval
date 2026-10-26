# Chess

The `chess` domain has the model play a game of chess against an opponent that picks random legal moves, the setup
of [LLM Chess](https://github.com/maxim-saplin/llm_chess). At each step the model sees the board and picks one of
its legal moves, and the opponent replies. The game ends at checkmate, at a draw, when the model resigns, or after 100
moves of the model.

## Install

Chess needs nothing beyond switch itself; install it as the [main README](../../../README.md#install) says.

## Cases

A case folder holds a `case.json`:

```json
{ "id": "white-seed-1", "side": "white", "seed": 1 }
```

`side` is the side the model plays. `seed` picks the opponent's moves: the same seed and the same moves before it
always give the same reply, so a game can be replayed. An optional `start` gives the start position in FEN; when the
opponent is to move in it, the opponent moves first. [`examples/chess/`](../../../examples/chess) holds two cases.

## Play a game

Run the commands from the repository root:

```bash
node src/cli/main.ts run --domain chess examples/chess/white-seed-1 --out runs/chess --model typesafe/jev-latest
```

Each case's `result.json` gets an `outcome`: the `result` (win, loss, draw, or unfinished at the move limit), its
`reason`, the number of `moves` both sides made, each side's `material` (pawn 1, knight and bishop 3, rook 5, queen 9)
and the final position as `fen`.

The model sees the board as text with rank 8 at the top, each side's pieces, whether it is in check, what the last
step did, and the moves so far; when the whole game does not fit the window, only the latest 20 moves. Each option is
a legal move in algebraic notation with its meaning in words, such as `exd5 (pawn e4 to d5, takes the pawn)`. The stop
option resigns the game.

## Watch a game

Add `--view` to `run` to watch the game while it is played, or open a finished run with `view`:

```bash
node src/cli/main.ts run --domain chess examples/chess/white-seed-1 --out runs/chess --view
node src/cli/main.ts view runs/chess --case white-seed-1
```

The board stands on the model's side. At each step it shows the position the model chose in, with arrows for its five
likeliest moves, as wide as their probabilities and the chosen move dark; then the pieces move for the model's move
and the reply. Beside the board are the players with the pieces each has taken, every option with its probability,
the model's confidence in each move it chose, and the move list, where a move opens its step. The page plays the game
back at four speeds, and the arrow keys step through it. It downloads the game as PGN, and saves itself as one HTML
file.

The pieces are [Chessnut](https://github.com/LexLuengas/chessnut-pieces) by Alexis Luengas, under the Apache License
2.0; `assets/pieces/chessnut/` holds them unchanged with their license.
