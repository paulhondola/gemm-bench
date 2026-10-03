import { hostsFrom } from "./hosts";

/** Every committed host database, found at build time: Pages can't list a directory. */
export const HOSTS = hostsFrom(
	import.meta.glob("../../../data/db/*/*.sqlite", {
		query: "?url",
		import: "default",
		eager: true,
	}) as Record<string, string>,
);
