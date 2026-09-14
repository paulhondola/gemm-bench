"""
Performance Visualization Package for rayon-gemm
"""

from .dashboard import generate_interactive_dashboard
from .data import (
    ACCELERATED_KERNELS,
    COLOR_PALETTE,
    KERNEL_DISPLAY_NAMES,
    PARALLEL_KERNELS,
    SERIAL_KERNELS,
    BenchmarkData,
)
from .svg import (
    generate_mps_crossover_svg,
    generate_parallel_efficiency_svg,
    generate_parallel_speedup_grid_svg,
    generate_peak_landscape_svg,
    generate_serial_baseline_svg,
)

__all__ = [
    "BenchmarkData",
    "SERIAL_KERNELS",
    "PARALLEL_KERNELS",
    "ACCELERATED_KERNELS",
    "COLOR_PALETTE",
    "KERNEL_DISPLAY_NAMES",
    "generate_serial_baseline_svg",
    "generate_parallel_speedup_grid_svg",
    "generate_parallel_efficiency_svg",
    "generate_peak_landscape_svg",
    "generate_mps_crossover_svg",
    "generate_interactive_dashboard",
]
