import type { Answer, Ask, ChoiceQuestion, JsonObject } from "./types.ts";

/**
 * Pointing. A decision model cannot quote text, but it can point: code shows text as a tree, and the model picks one
 * branch at a time until it reaches the place it means, or answers none. The path it took is the citation.
 */

/** Text as a tree that code builds. Children are built only when a search reaches the node. */
export interface Node {
	readonly id: string;
	/** What the model reads when the node is an option. */
	readonly title: string;
	children?(): readonly Node[] | Promise<readonly Node[]>;
}

/** Where a search ended: the nodes from the root's child down to the one picked, and how likely each pick was. */
export interface Pointer {
	readonly path: readonly Node[];
	readonly probability: number;
}

/** One search. `candidates` are offered first, such as search hits, with the option to look elsewhere. */
export interface Target {
	readonly id: string;
	readonly root: Node;
	readonly question: string;
	readonly candidates?: readonly Node[];
}

export interface LocateOptions {
	/** The stage's name in the trace. */
	readonly stage: string;
	/** The state every request of this search carries, such as the description of the stage. */
	readonly state: JsonObject;
	/** The text of the option that ends a search without a place. */
	readonly none: string;
	/** The text of the option that leaves the candidates for the whole tree. */
	readonly elsewhere?: string;
	/** The most options in one question; a longer level is shown in overlapping windows. */
	readonly options?: number;
	/** The most levels a search descends. */
	readonly depth?: number;
}

const DEFAULTS = { options: 12, depth: 8, elsewhere: "None of these: look in the whole text" } as const;
const NONE = "none";
/** A node's option key: `n` and its position in the level. "none" is not one. */
const NODE_OPTION = /^n\d+$/;
const ELSEWHERE = "elsewhere";

interface Level {
	readonly target: string;
	readonly round: number;
	readonly instructions: string;
	readonly nodes: readonly Node[];
	/** The options after the nodes: none, and, while candidates are shown, looking elsewhere. */
	readonly last: Readonly<Record<string, string>>;
	readonly size: number;
}

/** One question per window of a level; each window offers its nodes by index, then the last options. */
function levelQuestions({ target, round, instructions, nodes, last, size }: Level): ChoiceQuestion[] {
	const stride = Math.max(1, Math.floor(size / 2));
	const questions: ChoiceQuestion[] = [];
	for (let start = 0; start < nodes.length; start += stride) {
		const choices: Record<string, string> = {};
		nodes.slice(start, start + size).forEach((node, offset) => {
			choices[`n${String(start + offset)}`] = node.title;
		});
		Object.assign(choices, last);
		const shown =
			nodes.length > size
				? ` These are options ${String(start + 1)} to ${String(Math.min(start + size, nodes.length))} of ${String(nodes.length)}.`
				: "";
		questions.push({
			kind: "choice",
			id: `${target}/${String(round)}/w${String(start)}`,
			instructions: `${instructions}${shown}`,
			choices,
		});
		if (start + size >= nodes.length) break;
	}
	return questions;
}

/** Each window's pick that is not none, with its probability: `[index, probability]`. */
function picksOf(answers: Readonly<Record<string, Answer>>, questions: readonly ChoiceQuestion[]): [number, number][] {
	const picks: [number, number][] = [];
	for (const question of questions) {
		const answer = answers[question.id];
		if (answer?.kind !== "choice" || !NODE_OPTION.test(answer.choice)) continue;
		picks.push([Number(answer.choice.slice(1)), answer.probabilities[answer.choice] ?? 0]);
	}
	return picks;
}

const where = (path: readonly Node[]): string =>
	path.length === 0 ? "the whole text" : path.map((node) => node.title.slice(0, 80)).join(" > ");

interface Search {
	readonly target: Target;
	path: Node[];
	probability: number;
	level: readonly Node[];
	offeringCandidates: boolean;
	done: boolean;
	found: Pointer | null;
}

const singleOf = (level: readonly Node[]): Node | undefined => (level.length === 1 ? level[0] : undefined);

async function childrenOf(node: Node): Promise<readonly Node[]> {
	return node.children === undefined ? [] : await node.children();
}

/** A level with one option needs no question: the search takes it. */
async function skipSingles(search: Search): Promise<void> {
	let only = search.offeringCandidates ? undefined : singleOf(search.level);
	while (only !== undefined) {
		search.path.push(only);
		search.level = await childrenOf(only);
		only = singleOf(search.level);
	}
	if (!search.offeringCandidates && search.level.length === 0) {
		search.done = true;
		search.found = search.path.length > 0 ? { path: search.path, probability: search.probability } : null;
	}
}

async function start(target: Target): Promise<Search> {
	const candidates = target.candidates ?? [];
	const search: Search = {
		target,
		path: [],
		probability: 1,
		level: candidates.length > 0 ? candidates : await childrenOf(target.root),
		offeringCandidates: candidates.length > 0,
		done: false,
		found: null,
	};
	await skipSingles(search);
	return search;
}

function questionsFor(search: Search, round: number, options: LocateOptions): ChoiceQuestion[] {
	const size = options.options ?? DEFAULTS.options;
	const instructions = `${search.target.question}\n\nYou are looking inside: ${where(search.path)}. Pick the option that is the place or leads to it, or the last option if none does.`;
	const last: Record<string, string> = { [NONE]: options.none };
	if (search.offeringCandidates) last[ELSEWHERE] = options.elsewhere ?? DEFAULTS.elsewhere;
	return levelQuestions({ target: search.target.id, round, instructions, nodes: search.level, last, size });
}

async function advance(search: Search, picks: [number, number][], wentElsewhere: boolean): Promise<void> {
	const best = picks.sort((a, b) => b[1] - a[1])[0];
	if (best === undefined) {
		if (search.offeringCandidates && wentElsewhere) {
			search.offeringCandidates = false;
			search.level = await childrenOf(search.target.root);
			await skipSingles(search);
			return;
		}
		search.done = true;
		return;
	}
	const node = search.level[best[0]];
	if (node === undefined) return;
	search.path.push(node);
	search.probability *= best[1];
	search.offeringCandidates = false;
	search.level = await childrenOf(node);
	await skipSingles(search);
}

const choseElsewhere = (answers: Readonly<Record<string, Answer>>, questions: readonly ChoiceQuestion[]): boolean =>
	questions.some((question) => {
		const answer = answers[question.id];
		return answer?.kind === "choice" && answer.choice === ELSEWHERE;
	});

/**
 * Runs many searches level by level: every search that is still going adds its questions to one request per level,
 * so the number of requests is the depth of the deepest search, not the number of searches.
 */
export async function locate(
	ask: Ask,
	targets: readonly Target[],
	options: LocateOptions,
): Promise<Map<string, Pointer | null>> {
	const searches = await Promise.all(targets.map(start));
	for (let round = 0; round < (options.depth ?? DEFAULTS.depth); round += 1) {
		const active = searches.filter((search) => !search.done);
		if (active.length === 0) break;
		const asked = active.map((search) => ({ search, questions: questionsFor(search, round, options) }));
		const answers = await ask(
			asked.flatMap(({ questions }) => questions),
			{ stage: `${options.stage} ${String(round + 1)}`, state: options.state },
		);
		for (const { search, questions } of asked) {
			await advance(search, picksOf(answers, questions), choseElsewhere(answers, questions));
		}
	}
	return new Map(searches.map((search) => [search.target.id, search.found]));
}

export interface LocateAllOptions extends LocateOptions {
	/** The least probability of a pick that counts. */
	readonly pick?: number;
	/** Picks closer than this many positions are merged into the strongest. */
	readonly merge?: number;
}

/** The strong picks of one flat level, merged with neighbours into the strongest: the places a search marks. */
export function strongestPicks(picks: [number, number][], pick: number, merge: number): [number, number][] {
	const kept: [number, number][] = [];
	for (const candidate of picks.filter(([, probability]) => probability >= pick).sort((a, b) => b[1] - a[1])) {
		if (!kept.some(([index]) => Math.abs(index - candidate[0]) <= merge)) kept.push(candidate);
	}
	return kept.sort((a, b) => a[0] - b[0]);
}

/**
 * Marks every place in one flat level of each root that answers the question, such as every word gap of a sentence
 * where a new requirement starts. Long levels are shown in overlapping windows; each window can mark one place.
 */
export async function locateAll(
	ask: Ask,
	targets: readonly Target[],
	options: LocateAllOptions,
): Promise<Map<string, Pointer[]>> {
	const levels = await Promise.all(targets.map(async (target) => ({ target, level: await childrenOf(target.root) })));
	const asked = levels.map(({ target, level }) => ({
		target,
		level,
		questions: levelQuestions({
			target: target.id,
			round: 0,
			instructions: target.question,
			nodes: level,
			last: { [NONE]: options.none },
			size: options.options ?? DEFAULTS.options,
		}),
	}));
	const answers = await ask(
		asked.flatMap(({ questions }) => questions),
		{ stage: options.stage, state: options.state },
	);
	return new Map(
		asked.map(({ target, level, questions }) => [
			target.id,
			strongestPicks(picksOf(answers, questions), options.pick ?? 0.5, options.merge ?? 2).flatMap(
				([index, probability]) => {
					const node = level[index];
					return node === undefined ? [] : [{ path: [node], probability }];
				},
			),
		]),
	);
}
