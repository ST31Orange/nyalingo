/**
 * 文本工具：翻译分块、HTML 清理。
 */
export const TRANSLATION_CHUNK_CHARS = 1500;

export interface Chunk {
	text: string;
	separator: string;
}

/**
 * 按段落边界切块，保留块间换行以便翻译后还原排版。
 * 尽量在换行处切；单段超长时硬切。
 */
export function splitTranslationChunks(text: string, maxChars = TRANSLATION_CHUNK_CHARS): Chunk[] {
	if (text.length <= maxChars) return [{ text, separator: "" }];
	const chunks: Chunk[] = [];
	const segments = text.split(/(\n+)/);
	let current = "";
	let pendingNewlines = "";

	for (const seg of segments) {
		if (seg.length === 0) continue;
		if (/^\n+$/.test(seg)) {
			pendingNewlines += seg;
			continue;
		}
		const overflow = current.length > 0 && current.length + pendingNewlines.length + seg.length > maxChars;
		if (overflow) {
			chunks.push({ text: current, separator: pendingNewlines });
			current = "";
			pendingNewlines = "";
		}
		if (seg.length > maxChars) {
			for (let i = 0; i < seg.length; i += maxChars) {
				chunks.push({ text: seg.slice(i, i + maxChars), separator: "" });
			}
			continue;
		}
		current += pendingNewlines + seg;
		pendingNewlines = "";
	}
	if (current.length > 0 || pendingNewlines.length > 0) {
		chunks.push({ text: current, separator: pendingNewlines });
	}
	return chunks.length ? chunks : [{ text, separator: "" }];
}

/** 简易 HTML 转纯文本（无 DOMParser 时用正则兜底）。 */
export function htmlToPlainText(html: string): string {
	if (typeof DOMParser === "undefined") {
		return html
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/\s+/g, " ")
			.trim();
	}
	const doc = new DOMParser().parseFromString(html, "text/html");
	return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
