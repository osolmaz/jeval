# Chess

The `chess` domain has the model play a game of chess against an opponent that picks random legal moves, the setup
of [LLM Chess](https://github.com/maxim-saplin/llm_chess). At each step the model sees the board and picks one of
its legal moves, and the opponent replies. The game ends at checkmate, at a draw, when the model resigns, or after 100
moves of the model.

## Install

Chess needs nothing beyond Switch itself; install it as the [main README](../../../README.md#install) says.

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

```bash
node src/cli/main.ts view runs/chess --case white-seed-1
```

The page shows each step on a board from the model's side: the position it chose in, the opponent's last move marked,
and arrows for its five likeliest moves, as wide as their probabilities, with the chosen move dark. Next to the board,
every option is listed with its probability. The page follows a game while it runs.
