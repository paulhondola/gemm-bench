/**
 * Core Domain Types and Ambient Declarations for rayon-gemm Visualization
 */

export type Precision = "f16" | "f32" | "f64";
export type PrecisionFilter = "all" | Precision;

export type SerialKernel = "naive-ijk" | "ikj" | "tiled";
export type ParallelKernel = "rayon-ikj" | "rayon-tiled" | "static-ikj" | "static-tiled";
export type AcceleratedKernel = "mps";

export type KernelName = SerialKernel | ParallelKernel | AcceleratedKernel | string;
export type KernelCategory = "serial" | "parallel" | "mps";
export type CategoryFilter = "all" | KernelCategory;

export interface BenchmarkRecord {
  readonly kernel: string;
  readonly n: number;
  readonly threads: number;
  readonly precision: string;
  readonly elapsed_ms: number;
  readonly gflops: number;
}

export interface TableRecord extends BenchmarkRecord {
  category: KernelCategory;
  speedup: number;
}

export type SortField =
  | "gflops"
  | "elapsed_ms"
  | "speedup"
  | "n"
  | "threads"
  | "kernel"
  | "precision"
  | "category";

export type SortDirection = "asc" | "desc";

declare global {
  interface Window {
    RAW_RECORDS: BenchmarkRecord[];
    Plotly: any;
    switchTab: (tabId: string) => void;
    selectGlobalPrecision: (prec: PrecisionFilter) => void;
    renderPrecisionThroughputChart: () => void;
    renderParallelGrid: () => void;
    renderParallelEfficiency: () => void;
    renderSerialBaseline: () => void;
    renderPeakLandscape: () => void;
    renderSchedulerShootout: () => void;
    renderMpsGap: () => void;
    renderPrecisionComparison: () => void;
    sortTableBy: (field: SortField) => void;
    toggleSortDirection: () => void;
    applyTableSort: () => void;
    filterTable: () => void;
    exportTableToCSV: () => void;
  }

  const RAW_RECORDS: BenchmarkRecord[];
  const Plotly: any;
}
