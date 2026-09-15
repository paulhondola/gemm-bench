/**
 * 1. Parallel Speedup Strong Scaling Grid Chart
 */

import { COLORS } from "../constants";
import { getRecord, getSpeedup } from "../metrics";
import { activePrecision, getSizes, getThreads } from "../state";

export function renderParallelGrid(): void {
  const sizes = getSizes();
  const threads = getThreads();
  const gridSizes = sizes.filter((s) => s >= 128);
  if (gridSizes.length === 0 || threads.length === 0) return;

  const cols = 3;
  const rows = Math.ceil(gridSizes.length / cols);

  const data: any[] = [];
  const maxThread = Math.max(...threads);
  const precToUse = activePrecision === "all" ? "f32" : activePrecision;

  gridSizes.forEach((n, idx) => {
    const axisSuffix = idx === 0 ? "" : idx + 1;
    const xaxis = `x${axisSuffix}`;
    const yaxis = `y${axisSuffix}`;

    // Ideal linear scaling line
    data.push({
      x: [1, maxThread],
      y: [1, maxThread],
      mode: "lines",
      line: { dash: "dot", width: 1.5, color: COLORS.ideal },
      name: "Ideal Linear (y=x)",
      xaxis: xaxis,
      yaxis: yaxis,
      showlegend: idx === 0,
      hoverinfo: "none",
    });

    // Parallel kernels
    ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach((k) => {
      const xVals: number[] = [];
      const yVals: number[] = [];
      const textVals: string[] = [];

      threads.forEach((t) => {
        const sp = getSpeedup(k, n, t, precToUse);
        const rec = getRecord(k, n, t, precToUse);
        if (sp !== null && rec) {
          xVals.push(t);
          yVals.push(sp);
          textVals.push(
            `<b>${k} (${rec.precision})</b><br>N: ${n}<br>Threads: ${t}<br>Speedup: ${sp.toFixed(2)}x<br>Time: ${rec.elapsed_ms.toFixed(3)} ms<br>GFLOPS: ${rec.gflops.toFixed(1)}`
          );
        }
      });

      if (xVals.length > 0) {
        data.push({
          x: xVals,
          y: yVals,
          mode: "lines+markers",
          line: { color: COLORS[k], width: 2.5 },
          marker: { size: 6 },
          name: k,
          xaxis: xaxis,
          yaxis: yaxis,
          showlegend: idx === 0,
          text: textVals,
          hoverinfo: "text",
        });
      }
    });

    // MPS callout trace if exists for this precision
    const mpsRec = getRecord("mps", n, 1, precToUse);
    if (mpsRec) {
      data.push({
        x: [maxThread],
        y: [maxThread * 0.95],
        mode: "text",
        text: [`<b>MPS: ${mpsRec.gflops.toFixed(0)} GFLOPS</b>`],
        textposition: "bottom right",
        textfont: { size: 10, color: COLORS.mps },
        xaxis: xaxis,
        yaxis: yaxis,
        showlegend: false,
        hoverinfo: "none",
      });
    }
  });

  const layout: Record<string, any> = {
    grid: { rows: rows, columns: cols, pattern: "independent" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 40, b: 40, l: 50, r: 30 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
    legend: { orientation: "h", x: 0, y: 1.05, font: { color: "#e2e8f0" } },
  };

  gridSizes.forEach((_n, idx) => {
    const axisSuffix = idx === 0 ? "" : idx + 1;
    layout[`xaxis${axisSuffix}`] = {
      title: "Threads",
      gridcolor: "#222b35",
      zeroline: false,
      tickmode: "array",
      tickvals: threads,
    };
    layout[`yaxis${axisSuffix}`] = {
      title: "Speedup (x)",
      gridcolor: "#222b35",
      zeroline: false,
      rangemode: "tozero",
    };
  });

  const el = document.getElementById("chart-parallel-grid");
  if (el) {
    Plotly.newPlot("chart-parallel-grid", data, layout, { responsive: true });
  }
}
