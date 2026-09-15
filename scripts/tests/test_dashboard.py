"""Tests for viz.dashboard module."""

import re
from pathlib import Path

from viz.dashboard import generate_interactive_dashboard
from viz.data import BenchmarkData


def create_sample_data() -> BenchmarkData:
    records = [
        {
            "kernel": "naive-ijk",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 1.0,
            "gflops": 2.0,
        },
        {
            "kernel": "ikj",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.1,
            "gflops": 20.0,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.1,
            "gflops": 20.0,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 2,
            "precision": "f32",
            "elapsed_ms": 0.05,
            "gflops": 40.0,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 2,
            "precision": "f16",
            "elapsed_ms": 0.025,
            "gflops": 80.0,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 2,
            "precision": "f64",
            "elapsed_ms": 0.1,
            "gflops": 20.0,
        },
        {
            "kernel": "mps",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.01,
            "gflops": 200.0,
        },
        {
            "kernel": "mps",
            "n": 64,
            "threads": 1,
            "precision": "f16",
            "elapsed_ms": 0.005,
            "gflops": 400.0,
        },
    ]
    return BenchmarkData(records)


def test_generate_interactive_dashboard(tmp_path: Path):
    data = create_sample_data()
    dest = tmp_path / "dashboard.html"

    generate_interactive_dashboard(data, dest)

    assert dest.exists()
    content = dest.read_text(encoding="utf-8")

    # Verify essential components
    assert "<!DOCTYPE html>" in content
    assert '<link rel="stylesheet" href="assets/style.css">' in content
    assert '<script src="assets/data.js"></script>' in content
    assert '<script src="assets/dashboard.js"></script>' in content

    # Verify HTML does not contain inline style or huge script tags
    assert "<style>" not in content
    assert "Plotly.newPlot" not in content  # Cleanly in assets/dashboard.js
    assert "chart-scheduler-tiled" in content

    # Verify new multi-precision comparison tab and controls
    assert "precision-comparison" in content
    assert "precisionSizeSelect" in content
    assert "precisionPills" in content
    assert "tablePrecFilter" in content
    assert "exportCsvBtn" in content

    # Verify KPI cards rendered in HTML (MPS peak is 400 for f16)
    assert "400" in content  # MPS GFLOPS
    assert "80" in content  # Peak CPU GFLOPS (f16)

    # Verify no emojis exist in the generated dashboard or assets
    emoji_pattern = re.compile(r"[\U00010000-\U0010ffff]", flags=re.UNICODE)
    assert not emoji_pattern.search(content), "Generated dashboard must not contain emojis"

    # Verify naive-mps is not in the dashboard
    assert "naive-mps" not in content

    # Verify assets are emitted and contain the respective logic
    assets_dir = tmp_path / "assets"
    assert (assets_dir / "style.css").exists()
    assert (assets_dir / "dashboard.js").exists()
    assert (assets_dir / "data.js").exists()

    js_content = (assets_dir / "dashboard.js").read_text(encoding="utf-8")
    assert "Plotly.newPlot" in js_content
    assert "renderPrecisionComparison" in js_content
    assert "exportTableToCSV" in js_content
    assert "selectGlobalPrecision" in js_content
    assert not emoji_pattern.search(js_content)
    assert "naive-mps" not in js_content

    data_js_content = (assets_dir / "data.js").read_text(encoding="utf-8")
    assert "const RAW_RECORDS =" in data_js_content
    assert "naive-mps" not in data_js_content
    assert '"precision": "f16"' in data_js_content
    assert '"precision": "f32"' in data_js_content
    assert '"precision": "f64"' in data_js_content
