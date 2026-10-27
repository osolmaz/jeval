/// <reference lib="dom" />
/** The board's sounds, made in the browser with the Web Audio API, so that the page needs no sound files. */

export type SoundKind = "move" | "capture" | "castle" | "check" | "end";

/** The sound of a move by its SAN, as chess.com plays them: a check sounds as a check, even when it takes a piece. */
export function soundOf(san: string): SoundKind {
	if (/[+#]/.test(san)) return "check";
	if (san.startsWith("O-O")) return "castle";
	return san.includes("x") ? "capture" : "move";
}

/** A fifth of a second of white noise, the material of every knock. */
function noiseOf(context: AudioContext): AudioBuffer {
	const buffer = context.createBuffer(1, Math.ceil(context.sampleRate / 5), context.sampleRate);
	const samples = buffer.getChannelData(0);
	for (let sample = 0; sample < samples.length; sample += 1) samples[sample] = Math.random() * 2 - 1;
	return buffer;
}

/** A gain that rises at once to `loud` and fades out over `length` seconds. */
function fade(context: AudioContext, at: number, loud: number, length: number): GainNode {
	const gain = context.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(loud, at + 0.004);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
	gain.connect(context.destination);
	return gain;
}

/** A tone that fades out: the low thump under a knock, the ping of a check, a note of the end's chime. */
function tone(context: AudioContext, at: number, frequency: number, loud: number, length: number): void {
	const oscillator = context.createOscillator();
	oscillator.frequency.setValueAtTime(frequency, at);
	oscillator.connect(fade(context, at, loud, length));
	oscillator.start(at);
	oscillator.stop(at + length);
}

/** A piece set down on wood: a burst of noise through a band-pass filter at `pitch`, over a short low thump. */
function knock(context: AudioContext, noise: AudioBuffer, at: number, loud: number, pitch: number): void {
	const source = context.createBufferSource();
	source.buffer = noise;
	const filter = context.createBiquadFilter();
	filter.type = "bandpass";
	filter.frequency.value = pitch;
	filter.Q.value = 1.4;
	source.connect(filter).connect(fade(context, at, loud, 0.07));
	source.start(at);
	source.stop(at + 0.08);
	tone(context, at, pitch / 9, loud / 2, 0.06);
}

type Synth = (context: AudioContext, noise: AudioBuffer, at: number) => void;

const SYNTHS: Readonly<Record<SoundKind, Synth>> = {
	move: (context, noise, at) => {
		knock(context, noise, at, 0.9, 1700);
	},
	// A capture is harder: a high clack, and the taken piece knocked a moment later.
	capture: (context, noise, at) => {
		knock(context, noise, at, 1, 2600);
		knock(context, noise, at + 0.03, 0.6, 1300);
	},
	// The king and the rook land one after the other.
	castle: (context, noise, at) => {
		knock(context, noise, at, 0.8, 1700);
		knock(context, noise, at + 0.11, 0.8, 1500);
	},
	check: (context, noise, at) => {
		knock(context, noise, at, 0.9, 1700);
		tone(context, at + 0.01, 1320, 0.2, 0.25);
	},
	// Two notes up, E5 and B5.
	end: (context, _noise, at) => {
		tone(context, at, 659.25, 0.4, 0.35);
		tone(context, at + 0.16, 987.77, 0.4, 0.5);
	},
};

const SOUND_SETTING = "switch.sound";

function soundSetting(): boolean {
	try {
		return localStorage.getItem(SOUND_SETTING) !== "off";
	} catch {
		// Storage can be blocked; the sound is then on.
		return true;
	}
}

function saveSoundSetting(on: boolean): void {
	try {
		localStorage.setItem(SOUND_SETTING, on ? "on" : "off");
	} catch {
		// Storage can be blocked; the setting then lasts as long as the page.
	}
}

/**
 * The page's sounds, on unless the viewer turned them off. A browser lets a page play sound only after a click or a
 * key press, so the audio starts at the first one, in `wake`.
 */
export class Sounds {
	private context: AudioContext | null = null;
	private noise: AudioBuffer | null = null;
	private on = soundSetting();

	get enabled(): boolean {
		return this.on;
	}

	wake(): void {
		if (!this.on) return;
		this.context ??= typeof AudioContext === "function" ? new AudioContext() : null;
		if (this.context?.state === "suspended") void this.context.resume();
	}

	toggle(): void {
		this.on = !this.on;
		saveSoundSetting(this.on);
		this.wake();
	}

	play(kind: SoundKind): void {
		const context = this.context;
		if (!this.on || context?.state !== "running") return;
		this.noise ??= noiseOf(context);
		SYNTHS[kind](context, this.noise, context.currentTime);
	}
}
