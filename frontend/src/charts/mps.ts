/**
 * 7. Apple Silicon MPS vs CPU Acceleration Gap Chart
 */

import { PARALLEL_KERNELS } from "../constants";
import { activePrecision, getPrecisions, getSizes } from "../state";

export function renderMpsGap(): void {
  const sizes = getSizes();
  const precisions = getPrecisions();
  if (sizes.length === 0) return;

  const precisionsToShow =
    activePrecision === "all"
      ? ["f16", "f32"].filter((p) => precisions.includes(p))
      : [activePrecision].filter((p) => p === "f16" || p === "f32");

  const data: any[] = [
    {
      x: [sizes[0], sizes[sizes.length - 1]],
      y: [1.0, 1.0],
      mode: "lines",
      line: { dash: "dash", color: "#e2e8f0", width: 1.5 },
      name: "1.0x Parity Threshold",
      hoverinfo: "none",
    },
  ];

  precisionsToShow.forEach((p) => {
    const xVals: number[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    sizes.forEach((n) => {
      const mpsRec = RAW_RECORDS.find((r) => r.kernel === "mps" && r.n === n && r.precision === p);
      const cpuMatches = RAW_RECORDS.filter(
        (r) => PARALLEL_KERNELS.has(r.kernel) && r.n === n && r.precision === p
      );
      if (mpsRec && cpuMatches.length > 0) {
        const bestCpu = cpuMatches.reduce(
          (max, r) => (r.gflops > max.gflops ? r : max),
          cpuMatches[0]
        );
        const ratio = bestCpu.elapsed_ms / mpsRec.elapsed_ms;
        xVals.push(n);
        yVals.push(ratio);
        textVals.push(
          `<b>Matrix N = ${n} (${p})</b><br>` +
            `MPS: ${mpsRec.gflops.toFixed(1)} GFLOPS (${mpsRec.elapsed_ms.toFixed(2)} ms)<br>` +
            `Best CPU (${bestCpu.kernel}, ${bestCpu.threads}T): ${bestCpu.gflops.toFixed(1)} GFLOPS (${bestCpu.elapsed_ms.toFixed(2)} ms)<br>` +
            `<b>MPS Speedup: ${ratio.toFixed(2)}x</b>`
        );
      }
    });

    if (xVals.length > 0) {
      const lineColor = p === "f16" ? "#d946ef" : "#2ecc71";
      data.push({
        x: xVals,
        y: yVals,
        mode: "lines+markers+text",
        line: { color: lineColor, width: 3 },
        marker: { size: 8, color: lineColor },
        text: yVals.map((v) => `${v.toFixed(1)}x`),
        textposition: "top center",
        textfont: { color: p === "f16" ? "#e879f9" : "#86efac", size: 11, weight: "bold" },
        hovertext: textVals,
        hoverinfo: "text",
        name: `MPS Speedup vs Best CPU (${p})`,
      });
    }
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 60, l: 70, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: "Matrix Dimension (N)", type: "log", gridcolor: "#222b35", tickvals: sizes },
    yaxis: {
      title: "Speedup Factor (MPS / Best CPU)",
      gridcolor: "#222b35",
      rangemode: "tozero",
    },
    legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } },
  };

  const el = document.getElementById("chart-mps-gap");
  if (el) {
    Plotly.newPlot("chart-mps-gap", data, layout, { responsive: true });
  }
}
