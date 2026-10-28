import type { Decider, Exchange } from "./types.ts";

/** `decider`, passing every request it gets and the result it gives to `record`, in the order the results come back. */
export function recording(decider: Decider, record: (exchange: Exchange) => void): Decider {
	return {
		model: decider.model,
		window: decider.window,
		charsPerToken: decider.charsPerToken,
		async decide(request) {
			const result = await decider.decide(request);
			const images = request.images.map((image) => image.label);
			record({ request: { json: request.json, images, questions: request.questions }, result });
			return result;
		},
	};
}
