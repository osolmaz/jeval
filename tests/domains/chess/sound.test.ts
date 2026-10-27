// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { endingOf, type SoundKind, soundOf, Sounds, type SoundSet } from "../../../src/domains/chess/web/sound.ts";
import { clipUrl, stubAudio } from "../../helpers/audio.ts";

const SET: SoundSet = {
	clips: { "a.wav": clipUrl("a"), "b.wav": clipUrl("b"), "bad.wav": clipUrl("bad") },
	events: { move: "a.wav", castling: "b.wav", check: "bad.wav", "game-over": "missing.wav" },
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("the sounds", () => {
	it("name a move by its SAN, a check before a capture", () => {
		const moves = ["e4", "Nf3", "exd5", "Qxf7+", "Qh5#", "O-O", "O-O-O", "e8=Q", "exd8=Q"];
		expect(moves.map(soundOf)).toEqual([
			"move",
			"move",
			"capture",
			"check",
			"check",
			"castling",
			"castling",
			"move",
			"capture",
		]);
	});

	it("name the end by the outcome's reason: checkmate, stalemate, or any other game over", () => {
		expect(["checkmate", "stalemate", "resignation", "threefold repetition", undefined].map(endingOf)).toEqual([
			"checkmate",
			"stalemate",
			"game-over",
			"game-over",
			"game-over",
		]);
	});

	it("wait for a click or a key, decode the clips, and play each event's clip, now or later", async () => {
		const made = stubAudio();
		const sounds = new Sounds(SET);
		sounds.play("move");
		expect(made).toHaveLength(0);
		sounds.wake();
		sounds.wake();
		expect(made).toHaveLength(1);
		// The clips decode in the background.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const heard = (kind: SoundKind, delay?: number): string[] => {
			sounds.play(kind, delay);
			return (made[0]?.started.splice(0) ?? []).map((sound) => `${sound.clip} ${String(sound.at)}`);
		};
		expect(heard("move")).toEqual(["a 0"]);
		expect(heard("castling", 0.25)).toEqual(["b 0.25"]);
		// A clip that does not decode, a clip the page lacks, and an event without a clip stay silent.
		expect(heard("check")).toEqual([]);
		expect(heard("game-over")).toEqual([]);
		expect(heard("capture")).toEqual([]);
	});

	it("can be turned off, and remember it", () => {
		const made = stubAudio();
		const sounds = new Sounds(SET);
		sounds.wake();
		sounds.toggle();
		sounds.play("move");
		expect(made[0]?.started).toEqual([]);
		expect(localStorage.getItem("switch.sound")).toBe("off");
		const later = new Sounds();
		expect(later.enabled).toBe(false);
		later.toggle();
		expect(later.enabled).toBe(true);
		expect(localStorage.getItem("switch.sound")).toBe("on");
	});

	it("stay on when storage is blocked, and stay silent without Web Audio", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.stubGlobal("AudioContext", undefined);
		const sounds = new Sounds();
		expect(sounds.enabled).toBe(true);
		sounds.wake();
		sounds.play("move");
		sounds.toggle();
		expect(sounds.enabled).toBe(false);
	});
});
