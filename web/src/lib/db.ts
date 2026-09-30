export type Row = Record<string, string | number | null>;

/** A hardware ceiling, as data/build.sql writes them to public/peaks.json. */
export interface Peak {
	device: string;
	backend: string;
	precision: string;
	cores: number;
	gflops: number;
	source: string;
}

async function fetchJson<T>(file: string): Promise<T> {
	const response = await fetch(`${import.meta.env.BASE_URL}${file}`);
	if (!response.ok) {
		throw new Error(`${file}: HTTP ${response.status}`);
	}
	return response.json();
}

/** Every run row, as data/build.sql writes them to public/results.json. */
export function loadRows(): Promise<Row[]> {
	return fetchJson("results.json");
}

/**
 * The hardware peaks. Unlike the run rows they are not re-validated here:
 * build.sql fails the build on a bad peaks row, so peaks.json never holds one.
 */
export function loadPeaks(): Promise<Peak[]> {
	return fetchJson("peaks.json");
}
