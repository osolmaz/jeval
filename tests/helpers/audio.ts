import { vi } from "vitest";

/** A clip that a fake audio context started: the clip's text, and the time it starts. */
export interface Started {
	readonly clip: string;
	readonly at: number;
}

interface Clip {
	readonly clip: string;
}

/** A data URL whose bytes are `text`, as a fake clip. */
export const clipUrl = (text: string): string => `data:audio/wav;base64,${btoa(text)}`;

/**
 * An audio context that makes no sound. It runs once resumed, as after a click; it decodes a clip into its text, fails
 * on a clip whose text starts with "bad", and records each clip it starts.
 */
export class FakeAudioContext {
	state: "suspended" | "running" = "suspended";
	readonly currentTime = 0;
	readonly destination = {};
	readonly started: Started[] = [];

	resume(): Promise<void> {
		this.state = "running";
		return Promise.resolve();
	}

	decodeAudioData(bytes: ArrayBuffer): Promise<Clip> {
		const clip = new TextDecoder().decode(bytes);
		return clip.startsWith("bad") ? Promise.reject(new Error("cannot decode")) : Promise.resolve({ clip });
	}

	createBufferSource(): { buffer: Clip | null; connect(node: object): object; start(at: number): void } {
		const source = {
			buffer: null as Clip | null,
			connect: (node: object) => node,
			start: (at: number) => {
				this.started.push({ clip: source.buffer?.clip ?? "?", at });
			},
		};
		return source;
	}
}

/** Puts fake audio contexts in place of the browser's; the list holds each one made. */
export function stubAudio(): FakeAudioContext[] {
	const made: FakeAudioContext[] = [];
	vi.stubGlobal(
		"AudioContext",
		class extends FakeAudioContext {
			constructor() {
				super();
				made.push(this);
			}
		},
	);
	return made;
}
