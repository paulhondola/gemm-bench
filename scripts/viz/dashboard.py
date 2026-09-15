"""
Dashboard Assembly Engine
=========================

Emits a clean HTML dashboard that links to external CSS, JavaScript, and data assets.
"""

import json
from pathlib import Path

from .data import ACCELERATED_KERNELS, PARALLEL_KERNELS, BenchmarkData

TEMPLATES_DIR = Path(__file__).parent / "templates"


def generate_interactive_dashboard(
    data: BenchmarkData,
    dest: Path,
    page_title: str = "rayon-gemm Performance Dashboard",
):
    """Generates the HTML dashboard and emits external CSS, JS, and data assets."""
    html_template_path = TEMPLATES_DIR / "dashboard.html"
    css_path = TEMPLATES_DIR / "style.css"
    js_path = TEMPLATES_DIR / "dashboard.js"

    with open(html_template_path, "r", encoding="utf-8") as f:
        html_template = f.read()

    with open(css_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    with open(js_path, "r", encoding="utf-8") as f:
        js_content = f.read()

    # Compute KPI statistics
    mps_peaks = [r for r in data.records if r["kernel"] == "mps"]
    max_mps_gflops = max((r["gflops"] for r in mps_peaks), default=0.0)
    best_mps = max(mps_peaks, key=lambda x: x["gflops"], default=None)
    mps_prec_label = f"MPS ({best_mps['precision']})" if best_mps else "Apple Silicon MPS"

    cpu_peaks = [r for r in data.records if r["kernel"] not in ACCELERATED_KERNELS]
    best_cpu = max(cpu_peaks, key=lambda x: x["gflops"], default=None)
    max_cpu_gflops = best_cpu["gflops"] if best_cpu else 0.0
    best_cpu_kernel = f"{best_cpu['kernel']} ({best_cpu['precision']})" if best_cpu else "N/A"

    max_parallel_sp = 1.0
    for k in PARALLEL_KERNELS:
        for p in data.precisions:
            for n in data.sizes:
                for t in data.threads:
                    sp = data.get_speedup(k, n, t, precision=p)
                    if sp and sp > max_parallel_sp:
                        max_parallel_sp = sp

    max_cache_sp = 1.0
    for p in data.precisions:
        for n in data.sizes:
            naive = data.get_record("naive-ijk", n, 1, precision=p)
            ikj = data.get_record("ikj", n, 1, precision=p)
            if naive and ikj and ikj["elapsed_ms"] > 0:
                sp = naive["elapsed_ms"] / ikj["elapsed_ms"]
                if sp > max_cache_sp:
                    max_cache_sp = sp

    # Compute max f16 speedup over f32
    max_f16_sp = 1.0
    for k in data.kernels:
        for n in data.sizes:
            for t in data.threads:
                sp = data.get_precision_speedup(k, n, t, target_prec="f16", base_prec="f32")
                if sp and sp > max_f16_sp:
                    max_f16_sp = sp

    # Template replacement for KPI cards and metadata
    rendered = html_template
    rendered = rendered.replace("{{PAGE_TITLE}}", page_title)
    rendered = rendered.replace("{{PEAK_MPS_GFLOPS}}", f"{max_mps_gflops:,.0f}")
    rendered = rendered.replace("{{PEAK_MPS_META}}", mps_prec_label)
    rendered = rendered.replace("{{PEAK_CPU_GFLOPS}}", f"{max_cpu_gflops:,.0f}")
    rendered = rendered.replace("{{PEAK_CPU_KERNEL}}", best_cpu_kernel)
    rendered = rendered.replace("{{MAX_PARALLEL_SPEEDUP}}", f"{max_parallel_sp:.2f}")
    rendered = rendered.replace("{{MAX_CACHE_SPEEDUP}}", f"{max_cache_sp:.1f}")
    rendered = rendered.replace("{{MAX_F16_SPEEDUP}}", f"{max_f16_sp:.2f}")

    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(rendered)

    # Emit modular assets to assets/ directory
    assets_dir = dest.parent / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    with open(assets_dir / "style.css", "w", encoding="utf-8") as f:
        f.write(css_content)

    with open(assets_dir / "dashboard.js", "w", encoding="utf-8") as f:
        f.write(js_content)

    # Emit benchmark records as a separate JavaScript data asset
    data_js_content = f"const RAW_RECORDS = {json.dumps(data.records, indent=2)};\n"
    with open(assets_dir / "data.js", "w", encoding="utf-8") as f:
        f.write(data_js_content)
