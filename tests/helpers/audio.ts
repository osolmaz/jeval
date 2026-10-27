import { vi } from "vitest";

/** A sound that a fake audio context started: noise through a filter at `frequency`, or a tone at it. */
export interface Started {
	readonly kind: "noise" | "tone";
	readonly frequency: number;
}

interface Param {
	value: number;
	setValueAtTime(value: number): Param;
	exponentialRampToValueAtTime(): Param;
}

function param(): Param {
	const node: Param = {
		value: 0,
		setValueAtTime(value: number) {
			node.value = value;
			return node;
		},
		exponentialRampToValueAtTime: () => node,
	};
	return node;
}

interface Linked {
	to: object | null;
	connect<T extends object>(target: T): T;
}

/** `fields` as an audio node that remembers what it was connected to. */
function linked<T extends object>(fields: T): T & Linked {
	const node: T & Linked = Object.assign(fields, {
		to: null,
		connect<U extends object>(target: U): U {
			node.to = target;
			return target;
		},
	});
	return node;
}

/** An audio context that makes no sound and records what starts; it runs once resumed, as after a click. */
export class FakeAudioContext {
	state: "suspended" | "running" = "suspended";
	readonly sampleRate = 8000;
	readonly currentTime = 0;
	readonly destination = {};
	readonly started: Started[] = [];

	resume(): Promise<void> {
		this.state = "running";
		return Promise.resolve();
	}

	createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
		const samples = new Float32Array(length);
		return { getChannelData: () => samples };
	}

	createGain(): Linked & { gain: Param } {
		return linked({ gain: param() });
	}

	createBiquadFilter(): Linked & { type: string; frequency: Param; Q: Param } {
		return linked({ type: "", frequency: param(), Q: param() });
	}

	createOscillator(): Linked & { frequency: Param; start(): void; stop(): void } {
		const frequency = param();
		const start = (): void => {
			this.started.push({ kind: "tone", frequency: frequency.value });
		};
		return linked({ frequency, start, stop: () => undefined });
	}

	createBufferSource(): Linked & { buffer: unknown; start(): void; stop(): void } {
		const node = linked({
			buffer: null,
			start: () => {
				// The noise sounds at the frequency of the filter it goes through.
				const filter = node.to as { frequency?: Param } | null;
				this.started.push({ kind: "noise", frequency: filter?.frequency?.value ?? 0 });
			},
			stop: () => undefined,
		});
		return node;
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
