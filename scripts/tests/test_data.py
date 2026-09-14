"""Tests for viz.data module."""

import json
from pathlib import Path

import pytest

from viz.data import ACCELERATED_KERNELS, PARALLEL_KERNELS, SERIAL_KERNELS, BenchmarkData


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    csv_file = tmp_path / "test_bench.csv"
    csv_file.write_text(
        "kernel,n,threads,precision,elapsed_ms,gflops\n"
        "naive-ijk,64,1,f32,0.32,1.63\n"
        "ikj,64,1,f32,0.05,10.13\n"
        "rayon-ikj,64,1,f32,0.08,6.17\n"
        "rayon-ikj,64,2,f32,0.04,10.51\n"
        "rayon-ikj,64,4,f32,0.02,14.86\n"
        "mps,64,1,f32,0.24,2.22\n"
        "naive-mps,64,1,f32,0.37,1.40\n"
        "ikj,64,1,f16,0.03,16.00\n"
    )
    return csv_file


@pytest.fixture
def sample_json(tmp_path: Path) -> Path:
    json_file = tmp_path / "test_bench.json"
    records = [
        {
            "kernel": "naive-ijk",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.32,
            "gflops": 1.63,
        },
        {
            "kernel": "ikj",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.05,
            "gflops": 10.13,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.08,
            "gflops": 6.17,
        },
        {
            "kernel": "rayon-ikj",
            "n": 64,
            "threads": 4,
            "precision": "f32",
            "elapsed_ms": 0.02,
            "gflops": 14.86,
        },
        {
            "kernel": "naive-mps",
            "n": 64,
            "threads": 1,
            "precision": "f32",
            "elapsed_ms": 0.37,
            "gflops": 1.40,
        },
    ]
    json_file.write_text(json.dumps(records))
    return json_file


def test_load_csv_filters_naive_mps(sample_csv: Path):
    data = BenchmarkData.load(sample_csv)
    assert len(data.records) == 7  # naive-mps omitted
    assert "naive-mps" not in data.kernels
    assert "naive-ijk" in data.kernels
    assert "ikj" in data.kernels
    assert "rayon-ikj" in data.kernels
    assert "mps" in data.kernels


def test_load_json(sample_json: Path):
    data = BenchmarkData.load(sample_json)
    assert len(data.records) == 4
    assert "naive-mps" not in data.kernels


def test_filter_by_precision(sample_csv: Path):
    data = BenchmarkData.load(sample_csv)
    f32_data = data.filter("f32")
    assert all(r["precision"] == "f32" for r in f32_data.records)
    assert len(f32_data.records) == 6

    f16_data = data.filter("f16")
    assert len(f16_data.records) == 1
    assert f16_data.records[0]["precision"] == "f16"


def test_speedup_calculation(sample_csv: Path):
    data = BenchmarkData.load(sample_csv)
    # rayon-ikj: T(1) = 0.08, T(4) = 0.02 -> speedup = 4.0
    speedup = data.get_speedup("rayon-ikj", 64, 4)
    assert speedup == pytest.approx(4.0, rel=1e-2)

    # Nonexistent configuration returns None
    assert data.get_speedup("rayon-ikj", 64, 99) is None


def test_peak_record(sample_csv: Path):
    data = BenchmarkData.load(sample_csv)
    peak = data.get_peak_record("rayon-ikj", 64)
    assert peak is not None
    assert peak["threads"] == 4
    assert peak["gflops"] == 14.86


def test_kernel_classification():
    assert "naive-ijk" in SERIAL_KERNELS
    assert "ikj" in SERIAL_KERNELS
    assert "tiled" in SERIAL_KERNELS

    assert "rayon-ikj" in PARALLEL_KERNELS
    assert "rayon-tiled" in PARALLEL_KERNELS
    assert "static-ikj" in PARALLEL_KERNELS
    assert "static-tiled" in PARALLEL_KERNELS

    assert "mps" in ACCELERATED_KERNELS
    assert "naive-mps" not in ACCELERATED_KERNELS
