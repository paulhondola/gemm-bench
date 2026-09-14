"""
Benchmark Data Model and Metrics Engine
=======================================

Handles loading, parsing, filtering, and computing performance metrics
(such as speedups, throughputs, and core efficiency) from benchmark results.
"""

import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

# Kernel classifications
SERIAL_KERNELS = {"naive-ijk", "ikj", "tiled"}
PARALLEL_KERNELS = {"rayon-ikj", "rayon-tiled", "static-ikj"}
ACCELERATED_KERNELS = {"mps"}

COLOR_PALETTE = {
    "naive-ijk": "#e74c3c",  # Crimson Red (unoptimized baseline)
    "ikj": "#e67e22",  # Amber Orange (SIMD loop-interchange)
    "tiled": "#f39c12",  # Golden Yellow (cache-blocked)
    "rayon-ikj": "#38bdf8",  # Bright Blue (Rayon work-stealing)
    "rayon-tiled": "#2563eb",  # Deep Blue (Rayon tiled)
    "static-ikj": "#a855f7",  # Purple (Static OS threads)
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
    "mps": "Apple Silicon MPS",
}


class BenchmarkData:
    """Encapsulates a collection of benchmark records with query utilities."""

    def __init__(self, records: List[Dict[str, Any]]):
        self.records = records
        self.precisions = sorted(set(r["precision"] for r in records))
        self.sizes = sorted(set(r["n"] for r in records))
        self.threads = sorted(set(r["threads"] for r in records))
        self.kernels = sorted(set(r["kernel"] for r in records))

    @classmethod
    def load(cls, path: Path) -> "BenchmarkData":
        """Loads benchmark records from either a CSV or JSON file."""
        if not path.exists():
            raise FileNotFoundError(f"Benchmark file not found: {path}")

        records: List[Dict[str, Any]] = []
        suffix = path.suffix.lower()

        if suffix == ".json":
            with open(path, "r", encoding="utf-8") as f:
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
        else:
            with open(path, "r", encoding="utf-8") as f:
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

        if not records:
            raise ValueError(f"No benchmark records found in {path}")

        return cls(records)

    def filter(self, precision: Optional[str] = None) -> "BenchmarkData":
        """Returns a new BenchmarkData containing records matching the precision."""
        if not precision or precision.lower() == "all":
            return self
        filtered = [r for r in self.records if r["precision"] == precision]
        return BenchmarkData(filtered)

    def get_record(self, kernel: str, n: int, threads: int) -> Optional[Dict[str, Any]]:
        """Finds a single record by kernel, matrix size, and thread count."""
        for r in self.records:
            if r["kernel"] == kernel and r["n"] == n and r["threads"] == threads:
                return r
        return None

    def get_speedup(self, kernel: str, n: int, threads: int) -> Optional[float]:
        """Calculates strong scaling speedup T(1) / T(threads)."""
        base = self.get_record(kernel, n, 1)
        curr = self.get_record(kernel, n, threads)
        if base and curr and curr["elapsed_ms"] > 0:
            return base["elapsed_ms"] / curr["elapsed_ms"]
        return None

    def get_peak_record(self, kernel: str, n: int) -> Optional[Dict[str, Any]]:
        """Returns the highest GFLOPS configuration for a given kernel and matrix size."""
        matches = [r for r in self.records if r["kernel"] == kernel and r["n"] == n]
        if not matches:
            return None
        return max(matches, key=lambda x: x["gflops"])
