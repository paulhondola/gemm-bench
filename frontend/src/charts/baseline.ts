/**
 * 4. Serial Baseline Chart
 */

import { COLORS } from "../constants";
import { getRecord } from "../metrics";
import { activePrecision, getSizes } from "../state";

export function renderSerialBaseline(): void {
  const sizes = getSizes();
  if (sizes.length === 0) return;

  const data: any[] = [];
  const precToUse = activePrecision === "all" ? "f32" : activePrecision;

  ["naive-ijk", "ikj", "tiled"].forEach((k) => {
    const xVals: string[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    sizes.forEach((n) => {
      const rec = getRecord(k, n, 1, precToUse);
      if (rec) {
        xVals.push(`N=${n}`);
        yVals.push(rec.gflops);
        textVals.push(
          `<b>${k} (${rec.precision})</b><br>N: ${n}<br>GFLOPS: ${rec.gflops.toFixed(2)}<br>Time: ${rec.elapsed_ms.toFixed(2)} ms`
        );
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        type: "bar",
        name: `${k} (${precToUse})`,
        marker: { color: COLORS[k] },
        text: textVals,
        hoverinfo: "text",
      });
    }
  });

  const layout = {
    barmode: "group",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 60, l: 60, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: `Matrix Dimension (N) [${precToUse.toUpperCase()}]`, gridcolor: "#222b35" },
    yaxis: { title: "Throughput (GFLOPS)", gridcolor: "#222b35", rangemode: "tozero" },
    legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } },
  };

  const el = document.getElementById("chart-serial-baseline");
  if (el) {
    Plotly.newPlot("chart-serial-baseline", data, layout, { responsive: true });
  }
}
