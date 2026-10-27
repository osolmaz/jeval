import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SOUND_SET, soundSet } from "../../src/view/index.ts";

const PREFIX = "data:audio/wav;base64,";

describe("the sound set", () => {
	it("maps each event to the file named after it in assets/sounds, and carries each as a WAV data URL", async () => {
		for (const [event, file] of Object.entries(SOUND_SET)) expect(file).toBe(`${event}.wav`);
		const files = (await readdir(new URL("../../assets/sounds/", import.meta.url))).filter((file) =>
			file.endsWith(".wav"),
		);
		expect(files.sort()).toEqual(Object.values(SOUND_SET).sort());
		const set = await soundSet();
		expect(set.events).toBe(SOUND_SET);
		expect(Object.keys(set.clips).sort()).toEqual(files);
		for (const url of Object.values(set.clips)) {
			expect(url.startsWith(PREFIX)).toBe(true);
			const wav = Buffer.from(url.slice(PREFIX.length), "base64");
			expect([wav.subarray(0, 4).toString(), wav.subarray(8, 12).toString()]).toEqual(["RIFF", "WAVE"]);
		}
	});
});
