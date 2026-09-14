"""Tests for viz.svg module."""

import xml.etree.ElementTree as ET
from pathlib import Path

from viz.data import BenchmarkData
from viz.svg import (
    SvgChart,
    generate_mps_crossover_svg,
    generate_parallel_efficiency_svg,
    generate_parallel_speedup_grid_svg,
    generate_peak_landscape_svg,
    generate_serial_baseline_svg,
)


def create_dummy_data() -> BenchmarkData:
    records = []
    sizes = [64, 128, 256]
    threads_list = [1, 2, 4]

    for n in sizes:
        # Serial kernels
        records.append(
            {
                "kernel": "naive-ijk",
                "n": n,
                "threads": 1,
                "precision": "f32",
                "elapsed_ms": 10.0,
                "gflops": 1.0,
            }
        )
        records.append(
            {
                "kernel": "ikj",
                "n": n,
                "threads": 1,
                "precision": "f32",
                "elapsed_ms": 1.0,
                "gflops": 10.0,
            }
        )
        records.append(
            {
                "kernel": "tiled",
                "n": n,
                "threads": 1,
                "precision": "f32",
                "elapsed_ms": 1.2,
                "gflops": 8.5,
            }
        )
        records.append(
            {
                "kernel": "mps",
                "n": n,
                "threads": 1,
                "precision": "f32",
                "elapsed_ms": 0.1,
                "gflops": 100.0,
            }
        )

        # Parallel kernels
        for t in threads_list:
            records.append(
                {
                    "kernel": "rayon-ikj",
                    "n": n,
                    "threads": t,
                    "precision": "f32",
                    "elapsed_ms": 1.0 / t,
                    "gflops": 10.0 * t,
                }
            )
            records.append(
                {
                    "kernel": "rayon-tiled",
                    "n": n,
                    "threads": t,
                    "precision": "f32",
                    "elapsed_ms": 1.2 / t,
                    "gflops": 8.5 * t,
                }
            )
            records.append(
                {
                    "kernel": "static-ikj",
                    "n": n,
                    "threads": t,
                    "precision": "f32",
                    "elapsed_ms": 1.05 / t,
                    "gflops": 9.5 * t,
                }
            )

    return BenchmarkData(records)


def test_svg_chart_rendering():
    chart = SvgChart(400, 300, "Test Title & Features", "Test Subtitle <Speed & Accuracy>")
    chart.elements.append('<circle cx="50" cy="50" r="10" fill="red"/>')
    rendered = chart.render()

    assert "<?xml" in rendered
    assert "<svg" in rendered
    assert "</svg>" in rendered
    assert "Test Title &amp; Features" in rendered
    assert "Test Subtitle &lt;Speed &amp; Accuracy&gt;" in rendered
    assert "circle" in rendered

    # ElementTree must parse without raising xml.etree.ElementTree.ParseError
    root = ET.fromstring(rendered)
    assert root.tag.endswith("svg")


def test_generate_all_svgs(tmp_path: Path):
    data = create_dummy_data()

    f1 = tmp_path / "01.svg"
    f2 = tmp_path / "02.svg"
    f3 = tmp_path / "03.svg"
    f4 = tmp_path / "04.svg"
    f5 = tmp_path / "05.svg"

    generate_serial_baseline_svg(data, f1)
    generate_parallel_speedup_grid_svg(data, f2)
    generate_parallel_efficiency_svg(data, f3)
    generate_peak_landscape_svg(data, f4)
    generate_mps_crossover_svg(data, f5)

    for f in [f1, f2, f3, f4, f5]:
        assert f.exists()
        content = f.read_text(encoding="utf-8")
        assert "<?xml" in content
        assert "<svg" in content
        assert "</svg>" in content
        assert len(content) > 500
        # Verify valid XML structure
        root = ET.fromstring(content)
        assert root.tag.endswith("svg")
