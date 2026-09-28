export type Row = Record<string, string | number | null>;

/** Every run row, as data/build.sql writes them to public/results.json. */
export async function loadRows(): Promise<Row[]> {
	const response = await fetch(`${import.meta.env.BASE_URL}results.json`);
	if (!response.ok) {
		throw new Error(`results.json: HTTP ${response.status}`);
	}
	return response.json();
}
