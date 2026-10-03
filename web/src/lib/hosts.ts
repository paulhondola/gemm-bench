/** A host database the build found: `<login>/<machine>` and its asset URL. */
export interface Host {
	id: string;
	url: string;
}

/** Hosts from Vite's glob map (`…/data/db/<login>/<machine>.sqlite` → URL), sorted by id. */
export function hostsFrom(urls: Record<string, string>): Host[] {
	return Object.entries(urls)
		.flatMap(([path, url]) => {
			const id = path.match(/data\/db\/([^/]+\/[^/]+)\.sqlite$/)?.[1];
			return id ? [{ id, url }] : [];
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** The host `?host=` names, else the first; undefined when there are none. */
export function pickHost(hosts: Host[], search: string): Host | undefined {
	const wanted = new URLSearchParams(search).get("host");
	return hosts.find((host) => host.id === wanted) ?? hosts[0];
}
