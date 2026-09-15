#!/usr/bin/env python3
"""
rayon-gemm Benchmark Visualization CLI
======================================

Parses benchmark results (CSV / JSON) and generates an interactive, standalone HTML
dashboard with Plotly charts, tabs, multi-precision comparison (f16 / f32 / f64),
dark mode, and detailed performance metrics.

Usage:
    ./scripts/visualize.py
    ./scripts/visualize.py --input data/f16_full_run.csv data/f32_full_run.csv data/f64_full_run.csv
    ./scripts/visualize.py --input data/ --output-dir plots/ --open
"""

import argparse
import os
import sys
from pathlib import Path
from typing import List

# Add script directory to sys.path so 'viz' package is importable
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from viz import (  # noqa: E402
    BenchmarkData,
    generate_interactive_dashboard,
)


def discover_default_inputs() -> List[Path]:
    """Finds benchmark datasets in data/ if no input argument is provided."""
    data_dir = Path("data")
    if not data_dir.exists():
        return []

    # Prefer individual precision runs
    preferred = [
        data_dir / "f16_full_run.csv",
        data_dir / "f32_full_run.csv",
        data_dir / "f64_full_run.csv",
    ]
    existing = [p for p in preferred if p.exists()]
    if existing:
        return existing

    # Fallback to any CSV or JSON in data/
    candidates = sorted(
        f for f in data_dir.iterdir() if f.is_file() and f.suffix.lower() in {".csv", ".json"}
    )
    return candidates


def main():
    parser = argparse.ArgumentParser(
        description="Performance visualization engine for rayon-gemm benchmarks."
    )
    parser.add_argument(
        "--input",
        "-i",
        nargs="*",
        type=Path,
        default=None,
        help="Path(s) to benchmark CSV or JSON files, or directory containing results "
        "(default: discovers data/f16_full_run.csv, data/f32_full_run.csv, data/f64_full_run.csv).",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        type=Path,
        default=Path("plots"),
        help="Destination directory for generated dashboard (default: plots).",
    )
    parser.add_argument(
        "--precision",
        "-p",
        type=str,
        default="all",
        help="Target precision to visualize ('all', 'f32', 'f16', 'f64'; default: 'all').",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open dashboard.html in the default web browser upon completion.",
    )

    args = parser.parse_args()

    input_paths = args.input
    if not input_paths:
        input_paths = discover_default_inputs()
        if not input_paths:
            print(
                "Error: No benchmark input files specified and none found in 'data/'.",
                file=sys.stderr,
            )
            sys.exit(1)

    print(f"Loading benchmark results from: {', '.join(str(p) for p in input_paths)}...")
    data = BenchmarkData.load(input_paths)
    filtered = data.filter(args.precision)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Generate Interactive HTML Dashboard
    print("Generating interactive HTML dashboard...")
    dashboard_path = args.output_dir / "dashboard.html"
    generate_interactive_dashboard(filtered, dashboard_path)
    print(f"  ✓ Saved interactive dashboard to {dashboard_path}")

    if args.open:
        import webbrowser

        webbrowser.open(dashboard_path.as_uri())

    print("\nVisualization generation complete!")
    print(
        f"Explore the interactive dashboard at: file://{os.path.abspath(args.output_dir / 'dashboard.html')}"
    )


if __name__ == "__main__":
    main()
