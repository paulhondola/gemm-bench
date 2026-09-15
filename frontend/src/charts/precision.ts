/**
 * 2. Precision Comparison Views (f16 vs f32 vs f64)
 */

import { ACCELERATED_KERNELS, PARALLEL_KERNELS, PRECISION_COLORS } from "../constants";
import { getPrecisions, getSizes } from "../state";

export function initPrecisionControls(): void {
  const select = document.getElementById("precisionSizeSelect") as HTMLSelectElement | null;
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = "";

  const optPeak = document.createElement("option");
  optPeak.value = "peak";
  optPeak.textContent = "Peak Across All Matrix Dimensions";
  select.appendChild(optPeak);

  const sizes = getSizes();
  sizes.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `N = ${n} × ${n}`;
    if (n === 2048 || n === 1024) opt.selected = true;
    select.appendChild(opt);
  });

  if (currentVal) {
    select.value = currentVal;
  }
}

export function renderPrecisionThroughputChart(): void {
  const select = document.getElementById("precisionSizeSelect") as HTMLSelectElement | null;
  const selectedSize = select ? select.value : "peak";

  const kernels = [
    "naive-ijk",
    "ikj",
    "tiled",
    "rayon-ikj",
    "rayon-tiled",
    "static-ikj",
    "static-tiled",
    "mps",
  ];
  const precisions = getPrecisions();
  const precisionsToPlot = ["f16", "f32", "f64"].filter((p) => precisions.includes(p));

  const data: any[] = [];

  precisionsToPlot.forEach((p) => {
    const xVals: string[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    kernels.forEach((k) => {
      let rec: any = null;
      if (selectedSize === "peak") {
        const matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === p);
        if (matches.length > 0) {
          rec = matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), matches[0]);
        }
      } else {
        const nVal = parseInt(selectedSize, 10);
        const matches = RAW_RECORDS.filter(
          (r) => r.kernel === k && r.n === nVal && r.precision === p
        );
        if (matches.length > 0) {
          rec = matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), matches[0]);
        }
      }

      if (rec) {
        xVals.push(k);
        yVals.push(rec.gflops);
        textVals.push(
          `<b>${k} (${p})</b><br>Throughput: ${rec.gflops.toFixed(1)} GFLOPS<br>Time: ${rec.elapsed_ms.toFixed(3)} ms<br>N: ${rec.n}<br>Threads: ${rec.threads}`
        );
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        type: "bar",
        name: `${p.toUpperCase()} (${p === "f16" ? "Half" : p === "f32" ? "Single" : "Double"})`,
        marker: { color: PRECISION_COLORS[p] },
        text: textVals,
        hoverinfo: "text",
      });
    }
  });

  const subtitleText =
    selectedSize === "peak"
      ? "Peak Configuration across Matrix Sizes"
      : `Matrix Dimension N = ${selectedSize} × ${selectedSize}`;

  const layout = {
    barmode: "group",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 40, b: 60, l: 60, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: `Kernel (${subtitleText})`, gridcolor: "#222b35" },
    yaxis: { title: "Throughput (GFLOPS)", gridcolor: "#222b35", rangemode: "tozero" },
    legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } },
  };

  const el = document.getElementById("chart-precision-bars");
  if (el) {
    Plotly.newPlot("chart-precision-bars", data, layout, { responsive: true });
  }
}

export function renderPrecisionSpeedupChart(): void {
  const sizes = getSizes();
  if (sizes.length === 0) return;

  const data: any[] = [];

  // 1.0x Parity Line
  data.push({
    x: [sizes[0], sizes[sizes.length - 1]],
    y: [1.0, 1.0],
    mode: "lines",
    line: { dash: "dash", color: "#64748b", width: 1.5 },
    name: "1.0x Parity (f32)",
    hoverinfo: "none",
  });

  // 2.0x Theoretical Speedup Line
  data.push({
    x: [sizes[0], sizes[sizes.length - 1]],
    y: [2.0, 2.0],
    mode: "lines",
    line: { dash: "dot", color: "#94a3b8", width: 1.5 },
    name: "2.0x Theoretical Vector Packing",
    hoverinfo: "none",
  });

  const kernelsToCompare = [
    { k: "rayon-ikj", name: "Rayon ikj (f16 vs f32)", color: "#38bdf8", isF16: true },
    { k: "rayon-tiled", name: "Rayon Tiled (f16 vs f32)", color: "#818cf8", isF16: true },
    { k: "mps", name: "Apple MPS (f16 vs f32)", color: "#2ecc71", isF16: true },
    { k: "rayon-ikj", name: "Rayon ikj (f64 vs f32)", color: "#f59e0b", isF16: false },
    { k: "rayon-tiled", name: "Rayon Tiled (f64 vs f32)", color: "#ea580c", isF16: false },
  ];

  kernelsToCompare.forEach((item) => {
    const xVals: number[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    sizes.forEach((n) => {
      const f32Matches = RAW_RECORDS.filter(
        (r) => r.kernel === item.k && r.n === n && r.precision === "f32"
      );
      const targetMatches = RAW_RECORDS.filter(
        (r) => r.kernel === item.k && r.n === n && r.precision === (item.isF16 ? "f16" : "f64")
      );

      if (f32Matches.length > 0 && targetMatches.length > 0) {
        const peakF32 = f32Matches.reduce(
          (max, r) => (r.gflops > max.gflops ? r : max),
          f32Matches[0]
        );
        const peakTarget = targetMatches.reduce(
          (max, r) => (r.gflops > max.gflops ? r : max),
          targetMatches[0]
        );

        if (peakTarget.elapsed_ms > 0 && peakF32.elapsed_ms > 0) {
          const ratio = peakF32.elapsed_ms / peakTarget.elapsed_ms; // >1 means target is faster than f32
          xVals.push(n);
          yVals.push(ratio);
          textVals.push(
            `<b>${item.name}</b><br>Matrix N: ${n}<br>Ratio: ${ratio.toFixed(2)}x<br>` +
              `f32 Time: ${peakF32.elapsed_ms.toFixed(2)} ms (${peakF32.gflops.toFixed(1)} GFLOPS)<br>` +
              `${item.isF16 ? "f16" : "f64"} Time: ${peakTarget.elapsed_ms.toFixed(2)} ms (${peakTarget.gflops.toFixed(1)} GFLOPS)`
          );
        }
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        mode: "lines+markers",
        name: item.name,
        line: {
          color: item.color,
          width: item.isF16 ? 2.5 : 2,
          dash: item.isF16 ? "solid" : "dash",
        },
        marker: { size: 6 },
        text: textVals,
        hoverinfo: "text",
      });
    }
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 60, l: 60, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: "Matrix Dimension (N)", type: "log", gridcolor: "#222b35", tickvals: sizes },
    yaxis: {
      title: "Speedup Factor vs f32 (T(f32) / T(p))",
      gridcolor: "#222b35",
      rangemode: "tozero",
    },
    legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 10 } },
  };

  const el = document.getElementById("chart-precision-speedup");
  if (el) {
    Plotly.newPlot("chart-precision-speedup", data, layout, { responsive: true });
  }
}

export function renderPrecisionEnvelopeChart(): void {
  const sizes = getSizes();
  const precisions = getPrecisions();
  if (sizes.length === 0) return;

  const data: any[] = [];

  precisions.forEach((p) => {
    const cpuX: number[] = [];
    const cpuY: number[] = [];
    const cpuText: string[] = [];

    const mpsX: number[] = [];
    const mpsY: number[] = [];
    const mpsText: string[] = [];

    sizes.forEach((n) => {
      const cpuMatches = RAW_RECORDS.filter(
        (r) => !ACCELERATED_KERNELS.has(r.kernel) && r.n === n && r.precision === p
      );
      if (cpuMatches.length > 0) {
        const peakCpu = cpuMatches.reduce(
          (max, r) => (r.gflops > max.gflops ? r : max),
          cpuMatches[0]
        );
        cpuX.push(n);
        cpuY.push(peakCpu.gflops);
        cpuText.push(
          `<b>Peak CPU (${p})</b><br>N: ${n}<br>Kernel: ${peakCpu.kernel}<br>Throughput: ${peakCpu.gflops.toFixed(1)} GFLOPS<br>Threads: ${peakCpu.threads}`
        );
      }

      const mpsRec = RAW_RECORDS.find((r) => r.kernel === "mps" && r.n === n && r.precision === p);
      if (mpsRec) {
        mpsX.push(n);
        mpsY.push(mpsRec.gflops);
        mpsText.push(
          `<b>Apple MPS (${p})</b><br>N: ${n}<br>Throughput: ${mpsRec.gflops.toFixed(1)} GFLOPS<br>Time: ${mpsRec.elapsed_ms.toFixed(3)} ms`
        );
      }
    });

    if (cpuX.length > 0) {
      data.push({
        x: cpuX,
        y: cpuY,
        mode: "lines+markers",
        name: `Peak CPU (${p})`,
        line: { color: PRECISION_COLORS[p], width: 2 },
        marker: { size: 6 },
        text: cpuText,
        hoverinfo: "text",
      });
    }

    if (mpsX.length > 0) {
      data.push({
        x: mpsX,
        y: mpsY,
        mode: "lines+markers",
        name: `Apple MPS (${p})`,
        line: {
          color: p === "f16" ? "#22c55e" : "#10b981",
          width: 3,
          dash: p === "f16" ? "solid" : "dot",
        },
        marker: { size: 7 },
        text: mpsText,
        hoverinfo: "text",
      });
    }
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 60, l: 70, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: "Matrix Dimension (N)", type: "log", gridcolor: "#222b35", tickvals: sizes },
    yaxis: { title: "Peak Throughput (GFLOPS, Log Scale)", type: "log", gridcolor: "#222b35" },
    legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 10 } },
  };

  const el = document.getElementById("chart-precision-envelope");
  if (el) {
    Plotly.newPlot("chart-precision-envelope", data, layout, { responsive: true });
  }
}

export function renderPrecisionSummaryTable(): void {
  const tbody = document.querySelector("#precisionSummaryTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const kernels = [
    "naive-ijk",
    "ikj",
    "tiled",
    "rayon-ikj",
    "rayon-tiled",
    "static-ikj",
    "static-tiled",
    "mps",
  ];

  kernels.forEach((k) => {
    const f16Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f16");
    const f32Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f32");
    const f64Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f64");

    const peakF16 =
      f16Matches.length > 0
        ? f16Matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), f16Matches[0])
        : null;
    const peakF32 =
      f32Matches.length > 0
        ? f32Matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), f32Matches[0])
        : null;
    const peakF64 =
      f64Matches.length > 0
        ? f64Matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), f64Matches[0])
        : null;

    let catBadge = '<span class="badge badge-serial">Serial</span>';
    if (PARALLEL_KERNELS.has(k)) {
      catBadge = '<span class="badge badge-parallel">Parallel</span>';
    } else if (ACCELERATED_KERNELS.has(k)) {
      catBadge = '<span class="badge badge-mps">MPS</span>';
    }

    const f16Sp =
      peakF16 && peakF32 && peakF32.gflops > 0
        ? `${(peakF16.gflops / peakF32.gflops).toFixed(2)}x`
        : "—";
    const f64Pen =
      peakF64 && peakF32 && peakF32.gflops > 0
        ? `${(peakF64.gflops / peakF32.gflops).toFixed(2)}x`
        : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:600; color:#f8fafc;">${k}</td>
      <td style="text-align:left;">${catBadge}</td>
      <td style="font-weight:600; color:#e879f9;">${peakF16 ? peakF16.gflops.toFixed(1) : "—"}</td>
      <td style="font-weight:600; color:#38bdf8;">${peakF32 ? peakF32.gflops.toFixed(1) : "—"}</td>
      <td style="font-weight:600; color:#fbbf24;">${peakF64 ? peakF64.gflops.toFixed(1) : "—"}</td>
      <td style="font-weight:600; color:#86efac;">${f16Sp}</td>
      <td style="color:#cbd5e1;">${f64Pen}</td>
      <td style="color:#94a3b8; font-size:12px;">f16: 32MB | f32: 64MB | f64: 128MB</td>
    `;
    tbody.appendChild(tr);
  });
}

export function renderPrecisionComparison(): void {
  initPrecisionControls();
  renderPrecisionThroughputChart();
  renderPrecisionSpeedupChart();
  renderPrecisionEnvelopeChart();
  renderPrecisionSummaryTable();
}
