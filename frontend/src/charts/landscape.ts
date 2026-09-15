/**
 * 5. Peak Performance Landscape Chart
 */

import { COLORS } from "../constants";
import { activePrecision, getSizes } from "../state";

export function renderPeakLandscape(): void {
  const sizes = getSizes();
  if (sizes.length === 0) return;

  const data: any[] = [];
  const precToUse = activePrecision === "all" ? null : activePrecision;

  const kernelsToPlot = [
    { k: "naive-ijk", name: "Naive (1T)", style: "dash" },
    { k: "ikj", name: "Contiguous ikj (1T)", style: "solid" },
    { k: "rayon-ikj", name: "Rayon ikj (Peak Threads)", style: "solid" },
    { k: "rayon-tiled", name: "Rayon Tiled (Peak Threads)", style: "solid" },
    { k: "static-ikj", name: "Static ikj (Peak Threads)", style: "solid" },
    { k: "static-tiled", name: "Static Tiled (Peak Threads)", style: "solid" },
    { k: "mps", name: "Apple Silicon MPS (GPU/AMX)", style: "solid" },
  ];

  kernelsToPlot.forEach((item) => {
    const xVals: number[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    sizes.forEach((n) => {
      const matches = RAW_RECORDS.filter(
        (r) => r.kernel === item.k && r.n === n && (precToUse === null || r.precision === precToUse)
      );
      if (matches.length > 0) {
        const peak = matches.reduce((max, r) => (r.gflops > max.gflops ? r : max), matches[0]);
        xVals.push(n);
        yVals.push(peak.gflops);
        textVals.push(
          `<b>${item.name}</b><br>N: ${n}<br>Peak GFLOPS: ${peak.gflops.toFixed(1)}<br>Threads: ${peak.threads}<br>Precision: ${peak.precision}<br>Time: ${peak.elapsed_ms.toFixed(2)} ms`
        );
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        mode: "lines+markers",
        name: item.name,
        line: {
          color: COLORS[item.k] || "#ffffff",
          width: 3,
          dash: item.style === "dash" ? "dash" : "solid",
        },
        marker: { size: 7 },
        text: textVals,
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
    legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } },
  };

  const el = document.getElementById("chart-peak-landscape");
  if (el) {
    Plotly.newPlot("chart-peak-landscape", data, layout, { responsive: true });
  }
}
