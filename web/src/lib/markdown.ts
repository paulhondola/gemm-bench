import { Marked } from "marked";

/** One parser per heading offset: walkTokens is fixed when one is built. */
const parsers = new Map<number, Marked>();

function parserFor(offset: number): Marked {
	let parser = parsers.get(offset);
	if (!parser) {
		parser = new Marked({
			walkTokens(token) {
				if (token.type === "heading") {
					token.depth = Math.min(6, token.depth + offset);
				}
			},
		});
		parsers.set(offset, parser);
	}
	return parser;
}

/**
 * Markdown to HTML for the dashboard's own docs (web/src/docs). The output is
 * inserted with {@html}, unsanitized: never pass a contributed string here
 * (kernel, precision or device names from run CSVs, or peaks' source text).
 * `headingOffset` demotes every heading, so a file's "##" sits under the
 * page's own headings.
 */
export function renderMarkdown(src: string, headingOffset = 0): string {
	return parserFor(headingOffset).parse(src, { async: false });
}
