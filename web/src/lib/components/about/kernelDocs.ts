import gpu from "../../../docs/kernels/gpu.md?raw";
import matrix from "../../../docs/kernels/matrix.md?raw";
import parallel from "../../../docs/kernels/parallel.md?raw";
import serial from "../../../docs/kernels/serial.md?raw";
import type { Family } from "../../model/family";

export interface FamilyDoc {
	family: Family;
	/** The heading beside the family's legend name. */
	title: string;
	/**
	 * web/src/docs/kernels/<family>.md: a blurb, then one "## `<kernel>`"
	 * section per kernel.
	 */
	doc: string;
}

/**
 * The About tab's kernel catalogue, in FAMILY_ORDER. The family is written
 * here rather than read off the data with families(), so the catalogue is the
 * same whatever the data holds. kernelDocs.test.ts checks the sections against the
 * kernel registry in benchmark/src/kernel.rs.
 */
export const KERNEL_DOCS: FamilyDoc[] = [
	{ family: "serial", title: "Single-threaded CPU", doc: serial },
	{ family: "parallel", title: "Multi-threaded CPU", doc: parallel },
	{ family: "matrix", title: "Matrix unit (Apple AMX, Arm SME)", doc: matrix },
	{ family: "gpu", title: "Apple GPU (Metal)", doc: gpu },
];
