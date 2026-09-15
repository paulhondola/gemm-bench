/**
 * Performance Metric Derivations & KPI Computation
 */

import { ACCELERATED_KERNELS, PARALLEL_KERNELS } from "./constants";
import { activePrecision, getPrecisions, getSizes, getThreads } from "./state";
import type { BenchmarkRecord, PrecisionFilter } from "./types";

export function getRecord(
  kernel: string,
  n: number,
  threads: number,
  precision?: string
): BenchmarkRecord | undefined {
  const targetPrec = precision || (activePrecision === "all" ? "f32" : activePrecision);
  return RAW_RECORDS.find(
    (r) => r.kernel === kernel && r.n === n && r.threads === threads && r.precision === targetPrec
  );
}

export function getSpeedup(
  kernel: string,
  n: number,
  threads: number,
  precision?: string
): number | null {
  const base = getRecord(kernel, n, 1, precision);
  const curr = getRecord(kernel, n, threads, precision);
  if (base && curr && curr.elapsed_ms > 0) {
    return base.elapsed_ms / curr.elapsed_ms;
  }
  return null;
}

export function updateKpisForPrecision(prec: PrecisionFilter): void {
  const records = prec === "all" ? RAW_RECORDS : RAW_RECORDS.filter((r) => r.precision === prec);
  if (records.length === 0) return;

  // MPS KPI
  const mpsRecords = records.filter((r) => r.kernel === "mps");
  const mpsVal = document.getElementById("kpi-mps-val");
  const mpsMeta = document.getElementById("kpi-mps-meta");
  if (mpsRecords.length > 0) {
    const bestMps = mpsRecords.reduce(
      (max, r) => (r.gflops > max.gflops ? r : max),
      mpsRecords[0]
    );
    if (mpsVal) mpsVal.innerHTML = `${Math.round(bestMps.gflops).toLocaleString()} <span>GFLOPS</span>`;
    if (mpsMeta) mpsMeta.textContent = `Apple Silicon MPS (${bestMps.precision})`;
  } else {
    if (mpsVal) mpsVal.innerHTML = "N/A";
    if (mpsMeta) mpsMeta.textContent = `MPS not supported in ${prec}`;
  }

  // CPU KPI
  const cpuRecords = records.filter((r) => !ACCELERATED_KERNELS.has(r.kernel));
  const cpuVal = document.getElementById("kpi-cpu-val");
  const cpuMeta = document.getElementById("kpi-cpu-meta");
  if (cpuRecords.length > 0) {
    const bestCpu = cpuRecords.reduce(
      (max, r) => (r.gflops > max.gflops ? r : max),
      cpuRecords[0]
    );
    if (cpuVal) cpuVal.innerHTML = `${Math.round(bestCpu.gflops).toLocaleString()} <span>GFLOPS</span>`;
    if (cpuMeta) cpuMeta.textContent = `${bestCpu.kernel} (${bestCpu.precision}) @ ${bestCpu.threads}T`;
  }

  // Max Parallel Speedup
  let maxSp = 1.0;
  const sizes = getSizes();
  const threads = getThreads();
  const precisions = getPrecisions();

  PARALLEL_KERNELS.forEach((k) => {
    sizes.forEach((n) => {
      threads.forEach((t) => {
        const precsToTest = prec === "all" ? precisions : [prec];
        precsToTest.forEach((p) => {
          const sp = getSpeedup(k, n, t, p);
          if (sp && sp > maxSp) maxSp = sp;
        });
      });
    });
  });
  const parVal = document.getElementById("kpi-parallel-val");
  if (parVal) parVal.textContent = `${maxSp.toFixed(2)}x`;

  // Max Cache Speedup
  let maxCacheSp = 1.0;
  sizes.forEach((n) => {
    const precsToTest = prec === "all" ? precisions : [prec];
    precsToTest.forEach((p) => {
      const naive = getRecord("naive-ijk", n, 1, p);
      const ikj = getRecord("ikj", n, 1, p);
      if (naive && ikj && ikj.elapsed_ms > 0) {
        const sp = naive.elapsed_ms / ikj.elapsed_ms;
        if (sp > maxCacheSp) maxCacheSp = sp;
      }
    });
  });
  const cacheVal = document.getElementById("kpi-cache-val");
  if (cacheVal) cacheVal.textContent = `${maxCacheSp.toFixed(1)}x`;

  // f16 vs f32 Speedup
  let maxF16Sp = 1.0;
  [
    "naive-ijk",
    "ikj",
    "tiled",
    "rayon-ikj",
    "rayon-tiled",
    "static-ikj",
    "static-tiled",
    "mps",
  ].forEach((k) => {
    sizes.forEach((n) => {
      threads.forEach((t) => {
        const f32Rec = getRecord(k, n, t, "f32");
        const f16Rec = getRecord(k, n, t, "f16");
        if (f32Rec && f16Rec && f16Rec.elapsed_ms > 0) {
          const sp = f32Rec.elapsed_ms / f16Rec.elapsed_ms;
          if (sp > maxF16Sp) maxF16Sp = sp;
        }
      });
    });
  });
  const f16Val = document.getElementById("kpi-f16-val");
  if (f16Val) f16Val.textContent = `${maxF16Sp.toFixed(2)}x`;
}
