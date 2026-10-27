import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChessCase, type ChessGame, caseSchema, type Engine } from "./case.ts";
import { EngineError } from "./game.ts";

/** How long past its move time an engine may take before it counts as stuck. */
const GRACE = 60_000;

/** Reads and checks a case folder's `case.json`. */
export async function loadCase(folder: string): Promise<ChessCase> {
	return caseSchema.parse(JSON.parse(await readFile(join(folder, "case.json"), "utf8")));
}

/** A case ready to play. Against Stockfish it carries the engine whose binary the `STOCKFISH` variable names. */
export async function loadGame(folder: string, environment: NodeJS.ProcessEnv = process.env): Promise<ChessGame> {
	const game = await loadCase(folder);
	if (game.opponent !== "stockfish") return game;
	const binary = environment["STOCKFISH"];
	if (binary === undefined || binary === "") {
		throw new EngineError("the case plays Stockfish: set STOCKFISH to the path of its binary");
	}
	return { ...game, engine: await uciEngine(binary, game.movetime) };
}

/**
 * A UCI engine at `binary`, with every option at its default, that thinks `movetime` milliseconds about each move.
 * Each question starts the engine afresh, so a game leaves no process behind.
 */
export async function uciEngine(binary: string, movetime: number): Promise<Engine> {
	const { name } = await ask(binary, [], movetime);
	return {
		name,
		move: async (fen) =>
			(await ask(binary, [`position fen ${fen}`, `go movetime ${String(movetime)}`], movetime)).move,
	};
}

interface Answer {
	readonly name: string;
	readonly move: string;
}

/** What one line of the engine's output settles: the end of the handshake, or of a search with its best move. */
function settled(line: string, searching: boolean): string | undefined {
	if (!searching) return line === "uciok" ? "" : undefined;
	return /^bestmove (\S+)/.exec(line)?.[1];
}

/**
 * Starts the engine, sends `uci` and then `commands`, and reads its name and, when the commands search, its best move.
 * The engine quits once it has answered.
 */
function ask(binary: string, commands: readonly string[], movetime: number): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, [], { stdio: ["pipe", "pipe", "ignore"] });
		const timer = setTimeout(() => {
			child.kill();
			reject(new EngineError(`${binary} gave no answer in ${String(movetime + GRACE)} ms`));
		}, movetime + GRACE);
		const fail = (message: string): void => {
			clearTimeout(timer);
			reject(new EngineError(message));
		};
		child.once("error", (error) => {
			fail(`cannot start ${binary}: ${error.message}`);
		});
		child.once("exit", () => {
			// After an answer this does nothing, as the promise is settled.
			fail(`${binary} stopped before it answered`);
		});
		// A write to an engine that has already stopped fails; the exit above reports it.
		child.stdin.on("error", () => undefined);
		let name = "";
		let rest = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			const lines = (rest + chunk).split("\n");
			rest = lines.pop() ?? "";
			for (const line of lines.map((text) => text.trim())) {
				if (line.startsWith("id name ")) name = line.slice("id name ".length);
				const move = settled(line, commands.length > 0);
				if (move === undefined) continue;
				clearTimeout(timer);
				resolve({ name, move });
				child.stdin.end("quit\n");
			}
		});
		child.stdin.write(`${["uci", ...commands].join("\n")}\n`);
	});
}
