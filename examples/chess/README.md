# Chess

The chess example is a harness on switch with one domain, `chess`. The model plays a game of chess, against an
opponent that picks random legal moves, the setup of [LLM Chess](https://github.com/maxim-saplin/llm_chess), against
the [Stockfish](https://stockfishchess.org/) engine, or against itself. At each step the model sees the board and picks
one of the legal moves; against an opponent, the opponent then replies. The game ends at checkmate, at a draw, when the
side to move resigns, or after 200 steps.

The example uses switch only by its package name, `@osolmaz/switch`, as a project outside switch would.

## Install

Chess needs nothing beyond switch itself; `pnpm install` at the repository root installs both, as the
[main README](../../README.md#install) says. Games against Stockfish also need a Stockfish binary, such as one from its
[releases](https://github.com/official-stockfish/Stockfish/releases), and the `STOCKFISH` environment variable set to
its path.

## Cases

A case folder holds a `case.json`:

```json
{ "id": "white-seed-1", "opponent": "random", "side": "white", "seed": 1 }
```

`opponent` is `random`, the default; `stockfish`; or `self`, where the model plays both sides and each step is one
move of the side to move. Against an opponent, `side` is the side the model plays, white by default. `seed` picks the
random opponent's moves: the same seed and the same moves before it always give the same reply. Stockfish keeps every
UCI option at its default and thinks `movetime` milliseconds about each move, 1000 by default; it starts afresh for
each move, so it keeps no hash table between moves. An optional `start` gives the start position in FEN; when the
opponent is to move in it, it moves first. [`cases/`](cases) holds a game for each side against the random opponent
and against Stockfish, and a self-play game.

## The state machine

Each game is a state machine, in `src/index.ts` and `src/move.ts`:

- The state holds the side that the model plays, the opponent's name, the start position, every move so far in long
  algebraic notation and in SAN, the position in FEN, the status, whether the side to move is in check, and in words
  what the last step did. The board is never stored: chess.js works it out from the start position and the moves, so
  it also sees a repeated position.
- The initial state is the start position, after the opponent's first move when the opponent is to move.
- The choice function gives the legal moves of the state's position, and none once the game is over.
- The transition function plays the model's move and, against an opponent, the reply: a random legal move, or
  Stockfish's.

The case's seed, move time and engine stay inside these functions. The side, the opponent's name and the start
position never change, and they are in the state because the viewer draws them.

## Play a game

The program is [`src/main.ts`](src/main.ts). Run the commands from the repository root:

```bash
examples/chess/src/main.ts run examples/chess/cases/white-seed-1 --out runs/chess --model typesafe/jev-latest
STOCKFISH=/path/to/stockfish examples/chess/src/main.ts run examples/chess/cases/stockfish-white --out runs/stockfish
```

Each case's `result.json` gets an `outcome`: the `result`, its `reason`, the number of `moves` both sides made, each
side's `material` (pawn 1, knight and bishop 3, rook 5, queen 9) and the final position as `fen`. Against an opponent
the result is the model's: win, loss or draw. In self-play it names the winner: white wins or black wins, or a draw. A
game the step limit cut is unfinished.

The model sees the board as text with rank 8 at the top, each side's pieces, whether it is in check, what the last
step did, and the moves so far; when the whole game does not fit the window, only the latest 20 moves. Each choice is
a legal move in algebraic notation with its meaning in words, such as `exd5 (pawn e4 to d5, takes the pawn)`. The stop
choice resigns the game.

## Replay a game

`replay` takes each state from the game's trace, the opponent's replies included, so a game replays as it was played.
This is true also against Stockfish, which does not always pick the same move in the same position. With
`--fork <steps>`, the opponent replies again only after the fork. A replay against Stockfish still needs `STOCKFISH`,
because the load of the case starts the engine to read its name:

```bash
STOCKFISH=/path/to/stockfish examples/chess/src/main.ts replay examples/chess/cases/stockfish-white runs/stockfish/cases/stockfish-white/trace.jsonl
```

## Watch a game

Add `--view` to `run` to watch the game while it is played, or open a finished run with `view`:

```bash
examples/chess/src/main.ts run examples/chess/cases/self-play --out runs/self-play --view
examples/chess/src/main.ts view runs/self-play
```

The page looks like a game on chess.com: a green board, with each player's bar above and below it, the pieces they
took and a box lit for the side to move. At each step the board shows the position the model picked in, with orange
arrows for its five likeliest moves, as wide as their probabilities, the picked one solid; then the pieces move. Beside
the board are the model's confidence in each move it picked, the step's choices with the model's probability for each
one, and the moves in numbered rows with piece icons, where a move opens its step. The page plays the game
back at four speeds, the arrow keys step through it, and it downloads the game as PGN. The start of the game, each
move, a capture, castling, a check and the end (checkmate, stalemate, or another game over) each play their own short
recorded clip from [`assets/sounds/`](assets/sounds), which the table `SOUND_SET` in `src/viewer.ts` maps by event; the
Sound button turns them off.

All of this is the chess part of the page. switch's viewer shows every domain's steps, choices and results, and the
chess domain adds the rest: the browser modules in [`src/web/`](src/web) register it with `registerPart` from
`@osolmaz/switch/page`, `src/web/chess.css` draws it, and `src/viewer.ts` names those modules and that stylesheet and
gives them the pieces and the clips. The domain writes each state, and the page reads it, with the one type in
`src/web/data.ts`. The moves of a step are the moves that its state added to the state before it.

The pieces are cburnett by Colin M.L. Burnett, the set lichess shows by default, under the BSD license;
`assets/pieces/cburnett/` holds them unchanged from
[Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces) with their license.

## Traces from before states

A trace written before switch saved states has `observation` entries in place of `state` entries, and the newer code
does not read it. This command turns one into states; it writes a new file, and you replace the old one after a
check. A trace from before switch's PR #26 first needs that PR's renames, which
[the plan](../../docs/2026-10-28-domains-as-examples.md#migrations) lists with the `run.json` change.

```bash
jq -s -c '
  def next($before; $seen):
    $seen.data as $d
    | {you: $d.you, opponent: ($before.opponent // $d.opponent), start: ($before.start // $d.start),
       moves: (($before.moves // []) + $d.moves), san: (($before.san // []) + $d.san),
       fen: $d.fen, status: $d.status, check: $d.check, last: $seen.text};
  def flush: if .open == null then . else .out += [{type: "state", step: .open, state: .state}] | .open = null end;
  def entry($e):
    if $e.type == "case" then {type: "start", domain: $e.domain, version: $e.version, model: $e.model, limits: $e.limits}
    elif $e.type == "menu" then
      {type: "choices", step: $e.step, choices: [$e.choices[] | {key, type: .kind, text} + (if .data == null then {} else {data} end)]}
    elif $e.type == "choice" then $e | del(.id, .parent) | .type = "pick"
    elif $e.type == "asked" then (if $e.stage == "answers" then empty else $e | del(.id, .parent) | .type = "stage" end)
    else $e | del(.id, .parent) end;
  reduce .[] as $e ({out: [], state: null, open: null};
    if $e.type == "observation" then .state = next(.state; $e) | .open = $e.step else flush | .out += [entry($e)] end)
  | flush | .out | to_entries[] | .value + {id: .key, parent: (if .key == 0 then null else .key - 1 end)}
' trace.jsonl > trace.states.jsonl
```

The command was tried on copies of three runs, seven games in all. Each converted trace loads in the viewer, and each
game that needs no engine replays to the same states and picks. A trace that the code before this change wrote, once
converted, is the same as the trace that the code now writes for the same game, except for the domain's version.

## Check

`pnpm check` in this folder runs the example's own format, lint, typecheck, tests with the 85% coverage gate and DRY
scan. `pnpm check` at the repository root runs it too.
