import { expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

test("renders inline markup, lists and links", () => {
	const html = renderMarkdown(
		"**What it shows.** A [link](https://example.com).\n\n- one\n- two",
	);
	expect(html).toContain("<strong>What it shows.</strong>");
	expect(html).toContain('<a href="https://example.com">link</a>');
	expect(html).toContain("<li>one</li>");
});

test("escapes code block contents", () => {
	const html = renderMarkdown("```text\nif a < b\n```");
	expect(html).toContain("<pre><code");
	expect(html).toContain("if a &lt; b");
});

test("renders GFM tables", () => {
	expect(renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |")).toContain(
		"<table>",
	);
});

test("headingOffset demotes headings, capped at h6", () => {
	expect(renderMarkdown("## x")).toContain("<h2");
	expect(renderMarkdown("## x", 2)).toContain("<h4");
	expect(renderMarkdown("#### x", 5)).toContain("<h6");
	// A later call at another offset doesn't disturb an earlier one's.
	expect(renderMarkdown("## x", 2)).toContain("<h4");
});
