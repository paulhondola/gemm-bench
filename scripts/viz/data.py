"""
Benchmark Data Model and Metrics Engine
=======================================

Handles loading, parsing, filtering, and computing performance metrics
(such as speedups, throughputs, and core efficiency) from benchmark results.
"""

import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

# Kernel classifications
SERIAL_KERNELS = {"naive-ijk", "ikj", "tiled"}
PARALLEL_KERNELS = {"rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"}
ACCELERATED_KERNELS = {"mps"}

COLOR_PALETTE = {
    "naive-ijk": "#e74c3c",  # Crimson Red (unoptimized baseline)
    "ikj": "#e67e22",  # Amber Orange (SIMD loop-interchange)
    "tiled": "#f39c12",  # Golden Yellow (cache-blocked)
    "rayon-ikj": "#38bdf8",  # Bright Blue (Rayon work-stealing)
    "rayon-tiled": "#2563eb",  # Deep Blue (Rayon tiled)
    "static-ikj": "#a855f7",  # Purple (Static OS threads)
    "static-tiled": "#d946ef",  # Fuchsia / Magenta (Static Tiled)
    "mps": "#2ecc71",  # Emerald Green (Apple Silicon GPU / AMX)
    "ideal": "#94a3b8",  # Gray (Theoretical linear scaling)
}

KERNEL_DISPLAY_NAMES = {
    "naive-ijk": "Naive (i-j-k)",
    "ikj": "Contiguous (i-k-j)",
    "tiled": "Cache Tiled (64x64)",
    "rayon-ikj": "Rayon (i-k-j)",
    "rayon-tiled": "Rayon Tiled",
    "static-ikj": "Static Threads (i-k-j)",
    "static-tiled": "Static Tiled",
    "mps": "Apple Silicon MPS",
}

PRECISION_DISPLAY_NAMES = {
    "f16": "Half Precision (16-bit)",
    "f32": "Single Precision (32-bit)",
    "f64": "Double Precision (64-bit)",
}


def _parse_file(file_path: Path) -> List[Dict[str, Any]]:
    """Helper to parse a single CSV or JSON benchmark file."""
    if not file_path.exists():
        raise FileNotFoundError(f"Benchmark file not found: {file_path}")

    records: List[Dict[str, Any]] = []
    suffix = file_path.suffix.lower()

    if suffix == ".json":
        with open(file_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
            for item in raw:
                k = str(item["kernel"]).strip()
                if k == "naive-mps":
                    continue
                records.append(
                    {
                        "kernel": k,
                        "n": int(item["n"]),
                        "threads": int(item["threads"]),
                        "precision": str(item["precision"]).strip(),
                        "elapsed_ms": float(item["elapsed_ms"]),
                        "gflops": float(item["gflops"]),
                    }
                )
    elif suffix == ".csv":
        with open(file_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for item in reader:
                k = str(item["kernel"]).strip()
                if k == "naive-mps":
                    continue
                records.append(
                    {
                        "kernel": k,
                        "n": int(item["n"]),
                        "threads": int(item["threads"]),
                        "precision": str(item["precision"]).strip(),
                        "elapsed_ms": float(item["elapsed_ms"]),
                        "gflops": float(item["gflops"]),
                    }
                )
    return records


class BenchmarkData:
    """Encapsulates a collection of benchmark records with query utilities."""

    def __init__(self, records: List[Dict[str, Any]]):
        self.records = records
        self.precisions = sorted(set(r["precision"] for r in records))
        self.sizes = sorted(set(r["n"] for r in records))
        self.threads = sorted(set(r["threads"] for r in records))
        self.kernels = sorted(set(r["kernel"] for r in records))

    @classmethod
    def load(cls, path_or_paths: Union[Path, str, Sequence[Union[Path, str]]]) -> "BenchmarkData":
        """Loads benchmark records from one or more CSV/JSON files or directories."""
        if isinstance(path_or_paths, (str, Path)):
            candidates = [Path(path_or_paths)]
        else:
            candidates = [Path(p) for p in path_or_paths]

        files_to_load: List[Path] = []
        for p in candidates:
            if p.is_dir():
                found = sorted(
                    f for f in p.iterdir() if f.is_file() and f.suffix.lower() in {".csv", ".json"}
                )
                if not found:
                    raise FileNotFoundError(f"No benchmark files found in directory: {p}")
                files_to_load.extend(found)
            elif p.is_file():
                files_to_load.append(p)
            else:
                raise FileNotFoundError(f"Benchmark file or directory not found: {p}")

        records: List[Dict[str, Any]] = []
        for file_path in files_to_load:
            records.extend(_parse_file(file_path))

        if not records:
            raise ValueError(f"No benchmark records found from: {path_or_paths}")

        return cls(records)

    def filter(self, precision: Optional[str] = None) -> "BenchmarkData":
        """Returns a new BenchmarkData containing records matching the precision."""
        if not precision or precision.lower() == "all":
            return self
        filtered = [r for r in self.records if r["precision"] == precision]
        return BenchmarkData(filtered)

    def get_record(
        self, kernel: str, n: int, threads: int, precision: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Finds a single record by kernel, matrix size, thread count, and optional precision."""
        for r in self.records:
            if r["kernel"] == kernel and r["n"] == n and r["threads"] == threads:
                if precision is None or r["precision"] == precision:
                    return r
        return None

    def get_speedup(
        self, kernel: str, n: int, threads: int, precision: Optional[str] = None
    ) -> Optional[float]:
        """Calculates strong scaling speedup T(1) / T(threads)."""
        base = self.get_record(kernel, n, 1, precision=precision)
        curr = self.get_record(kernel, n, threads, precision=precision)
        if base and curr and curr["elapsed_ms"] > 0:
            return base["elapsed_ms"] / curr["elapsed_ms"]
        return None

    def get_peak_record(
        self, kernel: str, n: int, precision: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Returns the highest GFLOPS configuration for a given kernel, size, and precision."""
        matches = [
            r
            for r in self.records
            if r["kernel"] == kernel
            and r["n"] == n
            and (precision is None or r["precision"] == precision)
        ]
        if not matches:
            return None
        return max(matches, key=lambda x: x["gflops"])

    def get_precision_speedup(
        self,
        kernel: str,
        n: int,
        threads: int,
        target_prec: str = "f16",
        base_prec: str = "f32",
    ) -> Optional[float]:
        """Calculates relative speedup between precisions: T(base) / T(target)."""
        base = self.get_record(kernel, n, threads, precision=base_prec)
        target = self.get_record(kernel, n, threads, precision=target_prec)
        if base and target and target["elapsed_ms"] > 0:
            return base["elapsed_ms"] / target["elapsed_ms"]
        return None
