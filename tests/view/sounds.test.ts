import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SOUND_SET, soundSet } from "../../src/view/index.ts";

const PREFIX = "data:audio/wav;base64,";

describe("the sound set", () => {
	it("gives every event clips from assets/sounds, and carries each clip once as a WAV data URL", async () => {
		expect(Object.keys(SOUND_SET).sort()).toEqual(["capture", "castle", "check", "end", "move"]);
		const files = await readdir(new URL("../../assets/sounds/", import.meta.url));
		const used = [...new Set(Object.values(SOUND_SET).flat())].sort();
		expect(files).toEqual(expect.arrayContaining(used));
		const set = await soundSet();
		expect(set.events).toBe(SOUND_SET);
		expect(Object.keys(set.clips).sort()).toEqual(used);
		for (const url of Object.values(set.clips)) {
			expect(url.startsWith(PREFIX)).toBe(true);
			const wav = Buffer.from(url.slice(PREFIX.length), "base64");
			expect([wav.subarray(0, 4).toString(), wav.subarray(8, 12).toString()]).toEqual(["RIFF", "WAVE"]);
		}
	});
});
