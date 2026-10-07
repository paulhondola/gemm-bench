/** 3 significant figures below 100, whole numbers with separators above. */
export const fmtGops = (v: number) =>
	v >= 100
		? Math.round(v).toLocaleString("en-US")
		: String(Number(v.toPrecision(3)));

/**
 * The share of a peak reached, in percent, to 2 significant figures: the one
 * rule for the charts' hover and the About tab's hardware table. Number()
 * drops the exponent toPrecision gives past 100%: 105 reads 110, not 1.1e+2.
 */
export function percentOfPeak(gops: number, gflops: number): number {
	return Number(((100 * gops) / gflops).toPrecision(2));
}

/** A row's params for the data view: `depth_block=256 register_cols=12`. */
export function formatParams(params: Record<string, number>): string {
	return Object.entries(params)
		.map(([name, value]) => `${name}=${value}`)
		.join(" ");
}

/** 65536 → "64 KB", 12582912 → "12 MB": the largest unit that divides evenly. */
export function formatBytes(n: number): string {
	if (n >= 1 << 20 && n % (1 << 20) === 0) return `${n / (1 << 20)} MB`;
	if (n >= 1 << 10 && n % (1 << 10) === 0) return `${n / (1 << 10)} KB`;
	return `${n} B`;
}
