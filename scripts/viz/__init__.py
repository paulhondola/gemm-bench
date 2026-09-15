"""
Performance Visualization Package for rayon-gemm
"""

from .dashboard import generate_interactive_dashboard
from .data import (
    ACCELERATED_KERNELS,
    COLOR_PALETTE,
    KERNEL_DISPLAY_NAMES,
    PARALLEL_KERNELS,
    PRECISION_DISPLAY_NAMES,
    SERIAL_KERNELS,
    BenchmarkData,
)

__all__ = [
    "BenchmarkData",
    "SERIAL_KERNELS",
    "PARALLEL_KERNELS",
    "ACCELERATED_KERNELS",
    "COLOR_PALETTE",
    "KERNEL_DISPLAY_NAMES",
    "PRECISION_DISPLAY_NAMES",
    "generate_interactive_dashboard",
]
