/**
 * 3. Parallel Efficiency Chart
 */

import { getRecord, getSpeedup } from "../metrics";
import { activePrecision, getSizes, getThreads } from "../state";

export function renderParallelEfficiency(): void {
  const sizes = getSizes();
  const threads = getThreads();
  if (sizes.length === 0 || threads.length === 0) return;

  const targetSizes = [512, 1024, 2048, 4096].filter((s) => sizes.includes(s));
  const data: any[] = [];
  const precToUse = activePrecision === "all" ? "f32" : activePrecision;

  // 100% threshold line
  data.push({
    x: [1, Math.max(...threads)],
    y: [100, 100],
    mode: "lines",
    line: { dash: "dash", color: "#64748b", width: 1.5 },
    name: "100% Linear Efficiency",
    hoverinfo: "none",
  });

  targetSizes.forEach((n) => {
    ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach((k) => {
      const xVals: number[] = [];
      const yVals: number[] = [];
      const textVals: string[] = [];

      threads.forEach((t) => {
        const sp = getSpeedup(k, n, t, precToUse);
        if (sp !== null) {
          const eff = (sp / t) * 100;
          xVals.push(t);
          yVals.push(eff);
          textVals.push(
            `<b>${k} (${precToUse}, N=${n})</b><br>Threads: ${t}<br>Efficiency: ${eff.toFixed(1)}%<br>Speedup: ${sp.toFixed(2)}x`
          );
        }
      });

      if (xVals.length > 0) {
        data.push({
          x: xVals,
          y: yVals,
          mode: "lines+markers",
          name: `${k} (N=${n})`,
          marker: { size: 7 },
          text: textVals,
          hoverinfo: "text",
        });
      }
    });
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 60, l: 60, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    xaxis: { title: "Worker Threads", gridcolor: "#222b35", tickvals: threads },
    yaxis: { title: "Parallel Efficiency (%)", gridcolor: "#222b35", rangemode: "tozero" },
    legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } },
  };

  const el = document.getElementById("chart-parallel-efficiency");
  if (el) {
    Plotly.newPlot("chart-parallel-efficiency", data, layout, { responsive: true });
  }
}
