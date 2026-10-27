// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SoundKind, soundOf, Sounds } from "../../src/view/web/sound.ts";
import { stubAudio } from "../helpers/audio.ts";

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
			"castle",
			"castle",
			"move",
			"capture",
		]);
	});

	it("wait for a click or a key, then make each kind its own way", () => {
		const made = stubAudio();
		const sounds = new Sounds();
		sounds.play("move");
		expect(made).toHaveLength(0);
		sounds.wake();
		sounds.wake();
		expect(made).toHaveLength(1);
		const heard = (kind: SoundKind): string[] => {
			sounds.play(kind);
			return (made[0]?.started.splice(0) ?? []).map(
				(sound) => `${sound.kind} ${String(Math.round(sound.frequency))}`,
			);
		};
		expect(heard("move")).toEqual(["noise 1700", "tone 189"]);
		expect(heard("capture")).toEqual(["noise 2600", "tone 289", "noise 1300", "tone 144"]);
		expect(heard("castle")).toEqual(["noise 1700", "tone 189", "noise 1500", "tone 167"]);
		expect(heard("check")).toEqual(["noise 1700", "tone 189", "tone 1320"]);
		expect(heard("end")).toEqual(["tone 659", "tone 988"]);
	});

	it("can be turned off, and remember it", () => {
		const made = stubAudio();
		const sounds = new Sounds();
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
