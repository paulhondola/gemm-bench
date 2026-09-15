/**
 * Visualization Constants, Palette & Kernel Sets
 */

export const SERIAL_KERNELS = new Set<string>(["naive-ijk", "ikj", "tiled"]);
export const PARALLEL_KERNELS = new Set<string>([
  "rayon-ikj",
  "rayon-tiled",
  "static-ikj",
  "static-tiled",
]);
export const ACCELERATED_KERNELS = new Set<string>(["mps"]);

export const COLORS: Record<string, string> = {
  "naive-ijk": "#e74c3c",
  "ikj": "#e67e22",
  "tiled": "#f39c12",
  "rayon-ikj": "#38bdf8",
  "rayon-tiled": "#2563eb",
  "static-ikj": "#a855f7",
  "static-tiled": "#d946ef",
  "mps": "#2ecc71",
  "ideal": "#94a3b8",
};

export const PRECISION_COLORS: Record<string, string> = {
  f16: "#d946ef", // Fuchsia
  f32: "#38bdf8", // Cyan / Sky blue
  f64: "#f59e0b", // Amber
};
