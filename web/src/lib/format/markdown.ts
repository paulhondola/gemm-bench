import { lexer, parser, walkTokens } from "marked";

/**
 * Markdown to HTML for the dashboard's own docs (web/src/docs). The output is
 * inserted with {@html}, unsanitized: never pass a contributed string here
 * (kernel, precision or device names from run CSVs, or peaks' source text).
 * `headingOffset` demotes every heading, so a file's "##" sits under the
 * page's own headings.
 */
export function renderMarkdown(src: string, headingOffset = 0): string {
	const tokens = lexer(src);
	walkTokens(tokens, (token) => {
		if (token.type === "heading") {
			token.depth = Math.min(6, token.depth + headingOffset);
		}
	});
	return parser(tokens);
}
