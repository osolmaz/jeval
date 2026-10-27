/// <reference lib="dom" />
/** The board's sounds: recorded clips that the page carries, played with the Web Audio API. */

export type SoundKind =
	"game-start" | "move" | "castling" | "capture" | "check" | "checkmate" | "stalemate" | "game-over";

/** The clips by file name as data URLs, and the clip each event plays. */
export interface SoundSet {
	readonly clips: Readonly<Record<string, string>>;
	readonly events: Readonly<Partial<Record<SoundKind, string>>>;
}

/** The sound of a move by its SAN, as chess.com plays them: a check sounds as a check, even when it takes a piece. */
export function soundOf(san: string): SoundKind {
	if (/[+#]/.test(san)) return "check";
	if (san.startsWith("O-O")) return "castling";
	return san.includes("x") ? "capture" : "move";
}

/** The sound of a game's end by the reason its outcome gives: checkmate and stalemate have their own. */
export function endingOf(reason: unknown): SoundKind {
	return reason === "checkmate" || reason === "stalemate" ? reason : "game-over";
}

/** The bytes of a base64 data URL. */
function bytesOf(url: string): ArrayBuffer {
	const text = atob(url.slice(url.indexOf(",") + 1));
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
	return bytes.buffer;
}

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
 * key press, so the audio starts at the first one, in `wake`, and the clips are decoded then.
 */
export class Sounds {
	private readonly set: SoundSet;
	private context: AudioContext | null = null;
	private readonly buffers = new Map<string, AudioBuffer>();
	private on = soundSetting();

	constructor(set: SoundSet = { clips: {}, events: {} }) {
		this.set = set;
	}

	get enabled(): boolean {
		return this.on;
	}

	wake(): void {
		if (!this.on) return;
		if (this.context === null && typeof AudioContext === "function") {
			this.context = new AudioContext();
			this.decode(this.context);
		}
		if (this.context?.state === "suspended") void this.context.resume();
	}

	toggle(): void {
		this.on = !this.on;
		saveSoundSetting(this.on);
		this.wake();
	}

	/** Plays the event's clip `delay` seconds from now. */
	play(kind: SoundKind, delay = 0): void {
		const context = this.context;
		const file = this.set.events[kind];
		const buffer = file === undefined ? undefined : this.buffers.get(file);
		if (!this.on || context?.state !== "running" || buffer === undefined) return;
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.start(context.currentTime + delay);
	}

	private decode(context: AudioContext): void {
		for (const [file, url] of Object.entries(this.set.clips)) {
			context.decodeAudioData(bytesOf(url)).then(
				(buffer) => this.buffers.set(file, buffer),
				// A clip the browser cannot decode stays silent.
				() => undefined,
			);
		}
	}
}
