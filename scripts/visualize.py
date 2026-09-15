#!/usr/bin/env python3
"""
rayon-gemm Benchmark Visualization CLI
======================================

Parses benchmark results (CSV / JSON) and generates:
1. Publication-quality vector (SVG) figures cleanly separating serial and
   parallel benchmarks, including a multi-panel parallel speedup grid.
2. An interactive, standalone HTML dashboard with Plotly charts, tabs, dark mode,
   and detailed performance metrics.

Usage:
    ./scripts/visualize.py --input data/full_run.csv --output-dir plots/
    ./scripts/visualize.py --open
"""

import argparse
import os
import sys
from pathlib import Path

# Add script directory to sys.path so 'viz' package is importable
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from viz import (  # noqa: E402
    BenchmarkData,
    generate_interactive_dashboard,
)


def main():
    parser = argparse.ArgumentParser(
        description="Performance visualization engine for rayon-gemm benchmarks."
    )
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=Path("data/full_run.csv"),
        help="Path to benchmark CSV or JSON results file (default: data/full_run.csv).",
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        type=Path,
        default=Path("plots"),
        help="Destination directory for generated plots and dashboard (default: plots).",
    )
    parser.add_argument(
        "--precision",
        "-p",
        type=str,
        default="f32",
        help="Target precision to visualize ('f32', 'f16', 'f64', or 'all'; default: 'f32').",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open dashboard.html in the default web browser upon completion.",
    )

    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: Input file '{args.input}' not found.", file=sys.stderr)
        sys.exit(1)

    print(f"Loading benchmark results from {args.input}...")
    data = BenchmarkData.load(args.input)
    filtered = data.filter(args.precision)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Generate Interactive HTML Dashboard
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
