# Chess

The `chess` domain has the model play a game of chess, against an opponent that picks random legal moves, the setup
of [LLM Chess](https://github.com/maxim-saplin/llm_chess), or against itself. At each step the model sees the board
and picks one of the legal moves; against the random opponent, the opponent then replies. The game ends at checkmate,
at a draw, when the side to move resigns, or after 200 steps.

## Install

Chess needs nothing beyond switch itself; install it as the [main README](../../../README.md#install) says.

## Cases

A case folder holds a `case.json`:

```json
{ "id": "white-seed-1", "opponent": "random", "side": "white", "seed": 1 }
```

`opponent` is `random`, the default, or `self`, where the model plays both sides and each step is one move of the
side to move. Against the random opponent, `side` is the side the model plays, white by default, and `seed` picks the
opponent's moves: the same seed and the same moves before it always give the same reply, so a game can be replayed. An
optional `start` gives the start position in FEN; when the random opponent is to move in it, it moves first.
[`examples/chess/`](../../../examples/chess) holds a game for each side and a self-play game.

## Play a game

Run the commands from the repository root:

```bash
node src/cli/main.ts run --domain chess examples/chess/white-seed-1 --out runs/chess --model typesafe/jev-latest
```

Each case's `result.json` gets an `outcome`: the `result`, its `reason`, the number of `moves` both sides made, each side's `material` (pawn 1, knight and bishop 3, rook 5, queen 9)
and the final position as `fen`. Against the random opponent the result is the model's: win, loss or draw. In
self-play it names the winner: white wins or black wins, or a draw. A game the step limit cut is unfinished.

The model sees the board as text with rank 8 at the top, each side's pieces, whether it is in check, what the last
step did, and the moves so far; when the whole game does not fit the window, only the latest 20 moves. Each option is
a legal move in algebraic notation with its meaning in words, such as `exd5 (pawn e4 to d5, takes the pawn)`. The stop
option resigns the game.

## Watch a game

Add `--view` to `run` to watch the game while it is played, or open a finished run with `view`:

```bash
node src/cli/main.ts run --domain chess examples/chess/self-play --out runs/self-play --view
node src/cli/main.ts view runs/self-play
```

The page looks like a game on chess.com: a green board, with each player's bar above and below it, the pieces they
took and a box lit for the side to move. At each step the board shows the position the model chose in, with orange
arrows for its five likeliest moves, as wide as their probabilities, the chosen one solid; then the pieces move. Beside
the board are the model's confidence in each move it chose, the step's options with their probabilities, and the move
history in numbered rows with piece icons, where a move opens its step. The page plays the game back at four speeds,
the arrow keys step through it, and it downloads the game as PGN and saves itself as one HTML file.

The pieces are [Chessnut](https://github.com/LexLuengas/chessnut-pieces) by Alexis Luengas, under the Apache License
2.0; `assets/pieces/chessnut/` holds them unchanged with their license.
