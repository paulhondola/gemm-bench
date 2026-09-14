"""
Pure-Python Vector SVG Chart Generator
======================================

Generates crisp, dependency-free SVG vector graphics for publication,
documentation, and GitHub Markdown embedding.
"""

import math
from pathlib import Path
from typing import List, Tuple
from xml.sax.saxutils import escape as xml_escape

from .data import (
    COLOR_PALETTE,
    KERNEL_DISPLAY_NAMES,
    PARALLEL_KERNELS,
    SERIAL_KERNELS,
    BenchmarkData,
)


class SvgChart:
    """Helper to build publication-grade SVG vector charts."""

    def __init__(
        self,
        width: int = 800,
        height: int = 500,
        title: str = "",
        subtitle: str = "",
        pad_left: int = 75,
        pad_right: int = 40,
        pad_top: int = 70,
        pad_bottom: int = 60,
    ):
        self.width = width
        self.height = height
        self.title = title
        self.subtitle = subtitle
        self.elements: List[str] = []
        self.pad_left = pad_left
        self.pad_right = pad_right
        self.pad_top = pad_top
        self.pad_bottom = pad_bottom

    def plot_area(self) -> Tuple[float, float, float, float]:
        x0 = self.pad_left
        y0 = self.pad_top
        x1 = self.width - self.pad_right
        y1 = self.height - self.pad_bottom
        return x0, y0, x1, y1

    def render(self) -> str:
        x0, y0, x1, y1 = self.plot_area()
        esc_title = xml_escape(self.title)
        esc_subtitle = xml_escape(self.subtitle)
        svg = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.width} {self.height}" '
            f'width="{self.width}" height="{self.height}" style="background-color:#111418; font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
            "<defs>",
            '  <linearGradient id="grid-grad" x1="0%" y1="0%" x2="100%" y2="100%">',
            '    <stop offset="0%" stop-color="#1e242c"/>',
            '    <stop offset="100%" stop-color="#15191f"/>',
            "  </linearGradient>",
            '  <filter id="drop-shadow" x="-10%" y="-10%" width="120%" height="120%">',
            '    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.5"/>',
            "  </filter>",
            "</defs>",
            # Background
            f'<rect width="{self.width}" height="{self.height}" rx="12" fill="#111418"/>',
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="8" fill="url(#grid-grad)" stroke="#2a323d" stroke-width="1"/>',
            # Title & Subtitle
            f'<text x="{self.pad_left}" y="32" fill="#f8fafc" font-size="18" font-weight="700">{esc_title}</text>',
            f'<text x="{self.pad_left}" y="52" fill="#94a3b8" font-size="12">{esc_subtitle}</text>',
        ]
        svg.extend(self.elements)
        svg.append("</svg>")
        return "\n".join(svg)


def generate_serial_baseline_svg(data: BenchmarkData, dest: Path):
    """Figure 1: Serial kernels (naive, ikj, tiled) GFLOPS vs matrix size N."""
    chart = SvgChart(
        820,
        520,
        "Single-Threaded Baseline: Cache Locality and SIMD",
        "Comparison of serial CPU kernels (naive-ijk vs ikj vs tiled) at thread count = 1",
    )
    x0, y0, x1, y1 = chart.plot_area()

    sizes = data.sizes
    all_gflops = [
        r["gflops"] for r in data.records if r["kernel"] in SERIAL_KERNELS and r["threads"] == 1
    ]
    if not all_gflops:
        return

    max_g = max(all_gflops) * 1.15
    min_g = 0

    # Gridlines and Y-ticks
    y_ticks = 5
    for i in range(y_ticks + 1):
        val = min_g + i * (max_g - min_g) / y_ticks
        y = y1 - (i / y_ticks) * (y1 - y0)
        chart.elements.append(
            f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="#222b35" stroke-width="1"/>'
        )
        chart.elements.append(
            f'<text x="{x0 - 10}" y="{y + 4}" fill="#64748b" font-size="11" text-anchor="end">{val:.1f}</text>'
        )
    chart.elements.append(
        f'<text x="{x0 - 45}" y="{(y0 + y1) / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 {x0 - 45} {(y0 + y1) / 2})">Throughput (GFLOPS)</text>'
    )

    # X-ticks
    x_coords = {}
    for i, n in enumerate(sizes):
        x = x0 + (i / (len(sizes) - 1)) * (x1 - x0)
        x_coords[n] = x
        chart.elements.append(
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y1 + 6}" stroke="#475569" stroke-width="1.5"/>'
        )
        chart.elements.append(
            f'<text x="{x}" y="{y1 + 22}" fill="#94a3b8" font-size="12" font-weight="500" text-anchor="middle">N={n}</text>'
        )
    chart.elements.append(
        f'<text x="{(x0 + x1) / 2}" y="{y1 + 48}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Matrix Dimension (N x N)</text>'
    )

    # Plot Lines & Points for each serial kernel
    legend_items = []
    for kernel in SERIAL_KERNELS:
        pts = []
        for n in sizes:
            rec = data.get_record(kernel, n, 1)
            if rec:
                x = x_coords[n]
                y = y1 - (rec["gflops"] / max_g) * (y1 - y0)
                pts.append((x, y, rec["gflops"]))

        if pts:
            color = COLOR_PALETTE.get(kernel, "#ffffff")
            pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in pts)
            chart.elements.append(
                f'<polyline points="{pts_str}" fill="none" stroke="{color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            )
            for x, y, gflops in pts:
                chart.elements.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{color}" stroke="#111418" stroke-width="1.5"/>'
                )
        legend_items.append((KERNEL_DISPLAY_NAMES.get(kernel, kernel), color))

    # Legend
    leg_x = x1 - 220
    leg_y = y0 + 15
    chart.elements.append(
        f'<rect x="{leg_x - 10}" y="{leg_y - 8}" width="215" height="{len(legend_items) * 22 + 10}" rx="6" fill="#161c23" stroke="#2e3846" stroke-width="1"/>'
    )
    for i, (name, color) in enumerate(legend_items):
        iy = leg_y + i * 22 + 8
        chart.elements.append(f'<circle cx="{leg_x + 6}" cy="{iy - 4}" r="5" fill="{color}"/>')
        chart.elements.append(
            f'<text x="{leg_x + 20}" y="{iy}" fill="#e2e8f0" font-size="11" font-weight="500">{xml_escape(name)}</text>'
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(chart.render())


def generate_parallel_speedup_grid_svg(data: BenchmarkData, dest: Path):
    """Figure 2: Multi-panel grid comparing parallel speedups across matrix sizes N."""
    grid_sizes = [s for s in data.sizes if s >= 128]
    if len(grid_sizes) < 4:
        grid_sizes = data.sizes

    num_panels = len(grid_sizes)
    cols = 3 if num_panels >= 5 else max(1, min(num_panels, 2))
    rows = math.ceil(num_panels / cols)

    panel_w = 340
    panel_h = 240
    gap_x = 24
    gap_y = 24
    inner_pad_x = 24
    inner_pad_y = 24
    outer_margin_x = 28
    outer_margin_top = 78
    outer_margin_bottom = 28

    grid_content_w = cols * panel_w + (cols - 1) * gap_x
    grid_content_h = rows * panel_h + (rows - 1) * gap_y

    card_w = grid_content_w + 2 * inner_pad_x
    card_h = grid_content_h + 2 * inner_pad_y

    total_w = card_w + 2 * outer_margin_x
    # Ensure minimum width so legend doesn't overlap header title/subtitle
    min_w = 980
    if total_w < min_w:
        extra_w = min_w - total_w
        total_w = min_w
        card_w += extra_w
        inner_pad_x += extra_w // 2

    total_h = outer_margin_top + card_h + outer_margin_bottom

    chart = SvgChart(
        total_w,
        total_h,
        "Parallel Speedup Strong Scaling Grid",
        "Multi-core CPU scaling (T(1) / T(p)) across worker threads vs ideal linear speedup",
        pad_left=outer_margin_x,
        pad_right=outer_margin_x,
        pad_top=outer_margin_top,
        pad_bottom=outer_margin_bottom,
    )

    threads = [t for t in data.threads if t >= 1]
    max_thread = max(threads) if threads else 10

    for idx, n in enumerate(grid_sizes):
        r_idx = idx // cols
        c_idx = idx % cols
        px0 = outer_margin_x + inner_pad_x + c_idx * (panel_w + gap_x)
        py0 = outer_margin_top + inner_pad_y + r_idx * (panel_h + gap_y)
        px1 = px0 + panel_w
        py1 = py0 + panel_h

        # Panel frame
        chart.elements.append(
            f'<rect x="{px0}" y="{py0}" width="{panel_w}" height="{panel_h}" rx="6" fill="#161d24" stroke="#2b3542" stroke-width="1"/>'
        )
        # Panel Title
        chart.elements.append(
            f'<text x="{px0 + 12}" y="{py0 + 22}" fill="#38bdf8" font-size="13" font-weight="700">Matrix N = {n} × {n}</text>'
        )

        # Plot boundary inside panel
        bx0 = px0 + 45
        by0 = py0 + 35
        bx1 = px1 - 20
        by1 = py1 - 35

        max_y = max(max_thread, 10) * 1.05

        # Y gridlines
        for y_val in [2, 4, 6, 8, 10]:
            if y_val <= max_y:
                y_pos = by1 - (y_val / max_y) * (by1 - by0)
                chart.elements.append(
                    f'<line x1="{bx0}" y1="{y_pos}" x2="{bx1}" y2="{y_pos}" stroke="#222b35" stroke-width="0.8"/>'
                )
                chart.elements.append(
                    f'<text x="{bx0 - 6}" y="{y_pos + 3}" fill="#64748b" font-size="9" text-anchor="end">{y_val}x</text>'
                )

        # X ticks
        for t in threads:
            x_pos = bx0 + ((t - 1) / (max_thread - 1)) * (bx1 - bx0)
            chart.elements.append(
                f'<line x1="{x_pos}" y1="{by1}" x2="{x_pos}" y2="{by1 + 4}" stroke="#475569" stroke-width="1"/>'
            )
            chart.elements.append(
                f'<text x="{x_pos}" y="{by1 + 16}" fill="#94a3b8" font-size="10" text-anchor="middle">{t}</text>'
            )

        # Ideal linear line (y = x)
        ideal_x1 = bx0
        ideal_y1 = by1 - (1.0 / max_y) * (by1 - by0)
        ideal_x2 = bx0 + ((max_thread - 1) / (max_thread - 1)) * (bx1 - bx0)
        ideal_y2 = by1 - (max_thread / max_y) * (by1 - by0)
        chart.elements.append(
            f'<line x1="{ideal_x1}" y1="{ideal_y1}" x2="{ideal_x2}" y2="{ideal_y2}" stroke="#64748b" stroke-width="1.2" stroke-dasharray="3,3"/>'
        )

        # Curves for parallel kernels
        for kernel in ["rayon-ikj", "rayon-tiled", "static-ikj"]:
            pts = []
            for t in threads:
                speedup = data.get_speedup(kernel, n, t)
                if speedup is not None:
                    x_pos = bx0 + ((t - 1) / (max_thread - 1)) * (bx1 - bx0)
                    y_pos = by1 - (speedup / max_y) * (by1 - by0)
                    pts.append((x_pos, y_pos, speedup))

            if pts:
                color = COLOR_PALETTE.get(kernel, "#ffffff")
                pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in pts)
                chart.elements.append(
                    f'<polyline points="{pts_str}" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
                )
                for x, y, sp in pts:
                    chart.elements.append(
                        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{color}"/>'
                    )

        # MPS annotation callout if available
        mps_rec = data.get_record("mps", n, 1)
        if mps_rec:
            mps_gflops = mps_rec["gflops"]
            chart.elements.append(
                f'<rect x="{bx1 - 125}" y="{by0}" width="120" height="18" rx="4" fill="#14532d" stroke="#22c55e" stroke-width="0.8"/>'
            )
            chart.elements.append(
                f'<text x="{bx1 - 65}" y="{by0 + 12}" fill="#86efac" font-size="9" font-weight="600" text-anchor="middle">MPS: {mps_gflops:.0f} GFLOPS</text>'
            )

    # Shared Legend at top right
    leg_x = total_w - outer_margin_x - 470
    leg_y = 30
    items = [
        ("Rayon (i-k-j)", COLOR_PALETTE["rayon-ikj"]),
        ("Rayon Tiled", COLOR_PALETTE["rayon-tiled"]),
        ("Static Threads", COLOR_PALETTE["static-ikj"]),
        ("Ideal Linear (y=x)", "#94a3b8", "dash"),
    ]
    for i, item in enumerate(items):
        ix = leg_x + i * 115
        if len(item) == 3:
            chart.elements.append(
                f'<line x1="{ix}" y1="{leg_y + 4}" x2="{ix + 16}" y2="{leg_y + 4}" stroke="{item[1]}" stroke-width="2" stroke-dasharray="3,3"/>'
            )
        else:
            chart.elements.append(
                f'<circle cx="{ix + 8}" cy="{leg_y + 4}" r="4" fill="{item[1]}"/>'
            )
        chart.elements.append(
            f'<text x="{ix + 22}" y="{leg_y + 8}" fill="#cbd5e1" font-size="10" font-weight="500">{xml_escape(item[0])}</text>'
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(chart.render())


def generate_parallel_efficiency_svg(data: BenchmarkData, dest: Path):
    """Figure 3: Parallel Efficiency (S(p)/p * 100%) vs threads for large matrix sizes."""
    chart = SvgChart(
        820,
        520,
        "Parallel Efficiency vs Worker Threads",
        "Core utilization efficiency (Speedup / Threads × 100%) showing Amdahl saturation",
    )
    x0, y0, x1, y1 = chart.plot_area()

    threads = [t for t in data.threads if t >= 1]
    max_thread = max(threads) if threads else 10

    # Y-axis (0% to 120%)
    for pct in [20, 40, 60, 80, 100]:
        y = y1 - (pct / 120.0) * (y1 - y0)
        chart.elements.append(
            f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="#222b35" stroke-width="1"/>'
        )
        chart.elements.append(
            f'<text x="{x0 - 10}" y="{y + 4}" fill="#64748b" font-size="11" text-anchor="end">{pct}%</text>'
        )
    chart.elements.append(
        f'<text x="{x0 - 45}" y="{(y0 + y1) / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 {x0 - 45} {(y0 + y1) / 2})">Efficiency (%)</text>'
    )

    # 100% threshold guide
    y_100 = y1 - (100.0 / 120.0) * (y1 - y0)
    chart.elements.append(
        f'<line x1="{x0}" y1="{y_100}" x2="{x1}" y2="{y_100}" stroke="#475569" stroke-width="1.2" stroke-dasharray="4,4"/>'
    )

    # X-axis (Threads)
    x_coords = {}
    for t in threads:
        x = x0 + ((t - 1) / (max_thread - 1)) * (x1 - x0)
        x_coords[t] = x
        chart.elements.append(
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y1 + 6}" stroke="#475569" stroke-width="1.5"/>'
        )
        chart.elements.append(
            f'<text x="{x}" y="{y1 + 22}" fill="#94a3b8" font-size="12" font-weight="500" text-anchor="middle">{t}</text>'
        )
    chart.elements.append(
        f'<text x="{(x0 + x1) / 2}" y="{y1 + 48}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Worker Threads</text>'
    )

    # Target matrix sizes: 512, 1024, 2048
    target_sizes = [s for s in [512, 1024, 2048] if s in data.sizes]
    if not target_sizes:
        target_sizes = [data.sizes[-1]]

    colors = ["#38bdf8", "#a855f7", "#ec4899", "#f59e0b"]
    legend_items = []

    for i, n in enumerate(target_sizes):
        c = colors[i % len(colors)]
        pts = []
        for t in threads:
            sp = data.get_speedup("rayon-ikj", n, t)
            if sp is not None:
                eff = (sp / t) * 100.0
                x = x_coords[t]
                y = y1 - (eff / 120.0) * (y1 - y0)
                pts.append((x, y, eff))

        if pts:
            pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in pts)
            chart.elements.append(
                f'<polyline points="{pts_str}" fill="none" stroke="{c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            )
            for x, y, eff in pts:
                chart.elements.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{c}" stroke="#111418" stroke-width="1.5"/>'
                )
            legend_items.append((f"rayon-ikj (N={n})", c))

    # Legend
    leg_x = x1 - 220
    leg_y = y0 + 15
    chart.elements.append(
        f'<rect x="{leg_x - 10}" y="{leg_y - 8}" width="215" height="{len(legend_items) * 22 + 10}" rx="6" fill="#161c23" stroke="#2e3846" stroke-width="1"/>'
    )
    for i, (name, color) in enumerate(legend_items):
        iy = leg_y + i * 22 + 8
        chart.elements.append(f'<circle cx="{leg_x + 6}" cy="{iy - 4}" r="5" fill="{color}"/>')
        chart.elements.append(
            f'<text x="{leg_x + 20}" y="{iy}" fill="#e2e8f0" font-size="11" font-weight="500">{xml_escape(name)}</text>'
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(chart.render())


def generate_peak_landscape_svg(data: BenchmarkData, dest: Path):
    """Figure 4: Complete Peak Throughput Landscape (Serial vs Parallel vs MPS) on log scale."""
    chart = SvgChart(
        860,
        540,
        "Architectural Performance Landscape (Peak GFLOPS)",
        "Logarithmic scaling comparing serial baselines, multi-core CPU, and Apple Silicon MPS",
    )
    x0, y0, x1, y1 = chart.plot_area()

    sizes = data.sizes
    all_peaks = []
    for k in data.kernels:
        for n in sizes:
            p = data.get_peak_record(k, n)
            if p:
                all_peaks.append(p["gflops"])

    if not all_peaks:
        return

    min_log = 0.0  # 1 GFLOPS
    max_log = math.ceil(math.log10(max(all_peaks) * 1.2))

    # Y-axis ticks in powers of 10
    for log_val in range(int(min_log), int(max_log) + 1):
        g_val = 10**log_val
        y = y1 - ((log_val - min_log) / (max_log - min_log)) * (y1 - y0)
        chart.elements.append(
            f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="#252f3d" stroke-width="1"/>'
        )
        label = f"{g_val} GFLOPS" if g_val < 1000 else f"{g_val // 1000} TFLOPS"
        chart.elements.append(
            f'<text x="{x0 - 10}" y="{y + 4}" fill="#64748b" font-size="11" text-anchor="end">{label}</text>'
        )
    chart.elements.append(
        f'<text x="{x0 - 50}" y="{(y0 + y1) / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 {x0 - 50} {(y0 + y1) / 2})">Peak GFLOPS (Log Scale)</text>'
    )

    # X-axis ticks
    x_coords = {}
    for i, n in enumerate(sizes):
        x = x0 + (i / (len(sizes) - 1)) * (x1 - x0)
        x_coords[n] = x
        chart.elements.append(
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y1 + 6}" stroke="#475569" stroke-width="1.5"/>'
        )
        chart.elements.append(
            f'<text x="{x}" y="{y1 + 22}" fill="#94a3b8" font-size="12" font-weight="500" text-anchor="middle">N={n}</text>'
        )
    chart.elements.append(
        f'<text x="{(x0 + x1) / 2}" y="{y1 + 48}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Matrix Dimension (N x N)</text>'
    )

    # Plot Lines for distinct architectural tiers
    tiers = [
        ("naive-ijk", "Naive (1 thread)", COLOR_PALETTE["naive-ijk"], "dash"),
        ("ikj", "Contiguous ikj (1 thread)", COLOR_PALETTE["ikj"], "solid"),
        ("rayon-ikj", "Rayon ikj (Peak Threads)", COLOR_PALETTE["rayon-ikj"], "solid"),
        ("static-ikj", "Static ikj (Peak Threads)", COLOR_PALETTE["static-ikj"], "solid"),
        ("mps", "Apple Silicon MPS (GPU/AMX)", COLOR_PALETTE["mps"], "solid"),
    ]

    legend_items = []
    for kernel, display, color, style in tiers:
        pts = []
        for n in sizes:
            rec = data.get_peak_record(kernel, n)
            if rec and rec["gflops"] > 0:
                log_g = math.log10(max(rec["gflops"], 1.0))
                x = x_coords[n]
                y = y1 - ((log_g - min_log) / (max_log - min_log)) * (y1 - y0)
                pts.append((x, y, rec["gflops"]))

        if pts:
            pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in pts)
            stroke_dash = 'stroke-dasharray="4,4"' if style == "dash" else ""
            chart.elements.append(
                f'<polyline points="{pts_str}" fill="none" stroke="{color}" stroke-width="2.8" {stroke_dash} stroke-linecap="round" stroke-linejoin="round"/>'
            )
            for x, y, g in pts:
                chart.elements.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{color}" stroke="#111418" stroke-width="1.5"/>'
                )
            legend_items.append((display, color))

    # Legend
    leg_x = x0 + 15
    leg_y = y0 + 15
    chart.elements.append(
        f'<rect x="{leg_x - 8}" y="{leg_y - 8}" width="250" height="{len(legend_items) * 22 + 10}" rx="6" fill="#161c23" stroke="#2e3846" stroke-width="1"/>'
    )
    for i, (name, color) in enumerate(legend_items):
        iy = leg_y + i * 22 + 8
        chart.elements.append(f'<circle cx="{leg_x + 6}" cy="{iy - 4}" r="5" fill="{color}"/>')
        chart.elements.append(
            f'<text x="{leg_x + 20}" y="{iy}" fill="#e2e8f0" font-size="11" font-weight="500">{xml_escape(name)}</text>'
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(chart.render())


def generate_mps_crossover_svg(data: BenchmarkData, dest: Path):
    """Figure 5: Apple Silicon MPS vs Best Multi-Core CPU Crossover & Gap."""
    chart = SvgChart(
        820,
        520,
        "Hardware Coprocessor Gap: MPS vs Multi-Core CPU",
        "Ratio of Apple Silicon MPS throughput to the fastest multi-threaded CPU kernel",
    )
    x0, y0, x1, y1 = chart.plot_area()

    sizes = data.sizes
    ratios = []
    for n in sizes:
        mps_rec = data.get_record("mps", n, 1)
        best_cpu = max(
            [r for r in data.records if r["kernel"] in PARALLEL_KERNELS and r["n"] == n],
            key=lambda x: x["gflops"],
            default=None,
        )
        if mps_rec and best_cpu and best_cpu["elapsed_ms"] > 0:
            ratio = best_cpu["elapsed_ms"] / mps_rec["elapsed_ms"]
            ratios.append((n, ratio, mps_rec["gflops"], best_cpu["gflops"]))

    if not ratios:
        return

    max_ratio = max(r[1] for r in ratios) * 1.15

    # 1.0x parity line (crossover)
    y_1x = y1 - (1.0 / max_ratio) * (y1 - y0)
    chart.elements.append(
        f'<line x1="{x0}" y1="{y_1x}" x2="{x1}" y2="{y_1x}" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="4,4"/>'
    )
    chart.elements.append(
        f'<text x="{x1 - 10}" y="{y_1x - 6}" fill="#e2e8f0" font-size="11" font-weight="600" text-anchor="end">1.0x Parity (Crossover Threshold)</text>'
    )

    # Y ticks
    y_ticks = 5
    for i in range(y_ticks + 1):
        val = i * (max_ratio / y_ticks)
        y = y1 - (i / y_ticks) * (y1 - y0)
        chart.elements.append(
            f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="#222b35" stroke-width="1"/>'
        )
        chart.elements.append(
            f'<text x="{x0 - 10}" y="{y + 4}" fill="#64748b" font-size="11" text-anchor="end">{val:.1f}x</text>'
        )
    chart.elements.append(
        f'<text x="{x0 - 45}" y="{(y0 + y1) / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90 {x0 - 45} {(y0 + y1) / 2})">Speedup Multiplier (MPS / Best CPU)</text>'
    )

    # X ticks
    x_coords = {}
    for i, n in enumerate(sizes):
        x = x0 + (i / (len(sizes) - 1)) * (x1 - x0)
        x_coords[n] = x
        chart.elements.append(
            f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y1 + 6}" stroke="#475569" stroke-width="1.5"/>'
        )
        chart.elements.append(
            f'<text x="{x}" y="{y1 + 22}" fill="#94a3b8" font-size="12" font-weight="500" text-anchor="middle">N={n}</text>'
        )
    chart.elements.append(
        f'<text x="{(x0 + x1) / 2}" y="{y1 + 48}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Matrix Dimension (N x N)</text>'
    )

    # Curve
    pts = []
    for n, ratio, _, _ in ratios:
        x = x_coords[n]
        y = y1 - (ratio / max_ratio) * (y1 - y0)
        pts.append((x, y, ratio, n))

    pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y, _, _ in pts)
    chart.elements.append(
        f'<polyline points="{pts_str}" fill="none" stroke="#2ecc71" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    for x, y, ratio, n in pts:
        chart.elements.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#2ecc71" stroke="#111418" stroke-width="2"/>'
        )
        badge_y = y - 12 if y > y0 + 30 else y + 18
        chart.elements.append(
            f'<text x="{x:.1f}" y="{badge_y:.1f}" fill="#86efac" font-size="11" font-weight="700" text-anchor="middle">{ratio:.1f}x</text>'
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(chart.render())
