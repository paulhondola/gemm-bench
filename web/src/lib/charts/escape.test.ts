import { expect, test } from "bun:test";
import { escapeLabels } from "./escape";

test("labels from contributed data render literally, never as Plotly markup", () => {
	const hostile = '<a href="https://x">k</a> & co';
	const safe = '&lt;a href="https://x"&gt;k&lt;/a&gt; &amp; co';
	const out = escapeLabels({
		data: [
			{
				type: "bar",
				name: hostile,
				x: [hostile],
				text: [hostile],
				customdata: [[hostile, 3]],
				hovertemplate: "<b>%{y}</b>",
			},
		],
		layout: { xaxis: { categoryarray: [hostile] } },
	});
	const [t] = out.data;
	expect(t.name).toBe(safe);
	expect(t.x).toEqual([safe]);
	expect(t.text).toEqual([safe]);
	expect(t.customdata).toEqual([[safe, 3]]);
	expect(t.hovertemplate).toBe("<b>%{y}</b>");
	expect(out.layout.xaxis?.categoryarray).toEqual([safe]);
});
