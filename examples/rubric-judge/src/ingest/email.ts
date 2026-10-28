import PostalMime, { type Address, type Mailbox } from "postal-mime";
import type { Unit } from "../case.ts";
import { htmlText, textUnits } from "./units.ts";

const mailbox = (box: Mailbox): string => (box.name === "" ? box.address : `${box.name} <${box.address}>`);
const formatAddress = (address: Address): string =>
	address.group === undefined ? mailbox(address) : `${address.name}: ${address.group.map(mailbox).join(", ")}`;
const isList = (value: readonly Address[] | Address): value is readonly Address[] => Array.isArray(value);
const addresses = (value: readonly Address[] | Address | undefined): string =>
	value === undefined ? "" : (isList(value) ? value : [value]).map(formatAddress).join(", ");

/** An email's headers, its text (from HTML when it has no plain text) and the names of its attachments. */
export async function readEmail(bytes: Uint8Array): Promise<Unit[]> {
	const email = await PostalMime.parse(bytes);
	const headers = [
		["From", addresses(email.from)],
		["To", addresses(email.to)],
		["Cc", addresses(email.cc)],
		["Date", email.date ?? ""],
		["Subject", email.subject ?? ""],
	]
		.filter(([, value]) => value !== "")
		.map(([name, value]) => `${String(name)}: ${String(value)}`);
	const body = email.text ?? htmlText(email.html ?? "");
	const attachments = email.attachments.map((attachment) => `[attachment: ${attachment.filename ?? "unnamed"}]`);
	return textUnits([headers.join("\n"), "", body, ...attachments].join("\n"));
}
