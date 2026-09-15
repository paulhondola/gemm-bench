/**
 * 6. Rayon vs Static Scheduler Shootout Charts
 */

import { getRecord } from "../metrics";
import { activePrecision, getSizes, getThreads } from "../state";

export function renderSchedulerComparison(
  containerId: string,
  rayonKernel: string,
  staticKernel: string,
  label: string
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sizes = getSizes();
  const threads = getThreads();
  if (sizes.length === 0 || threads.length === 0) return;

  const data: any[] = [];
  const precToUse = activePrecision === "all" ? "f32" : activePrecision;
  let targetSizes = [512, 1024, 2048, 4096].filter((s) => sizes.includes(s));
  if (targetSizes.length === 0) {
    targetSizes = sizes.slice(-3);
  }

  targetSizes.forEach((n) => {
    const xVals: number[] = [];
    const yVals: number[] = [];
    const textVals: string[] = [];

    threads.forEach((t) => {
      const rayonRec = getRecord(rayonKernel, n, t, precToUse);
      const staticRec = getRecord(staticKernel, n, t, precToUse);
      if (rayonRec && staticRec && staticRec.elapsed_ms > 0 && rayonRec.elapsed_ms > 0) {
        const ratio = staticRec.elapsed_ms / rayonRec.elapsed_ms;
        xVals.push(t);
        yVals.push(ratio);
        textVals.push(
          `<b>${label} (${precToUse}, N=${n}, Threads=${t})</b><br>` +
            `Rayon Time: ${rayonRec.elapsed_ms.toFixed(2)} ms (${rayonRec.gflops.toFixed(1)} GFLOPS)<br>` +
            `Static Time: ${staticRec.elapsed_ms.toFixed(2)} ms (${staticRec.gflops.toFixed(1)} GFLOPS)<br>` +
            `Speed Ratio (Static / Rayon): ${ratio.toFixed(2)}x`
        );
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        mode: "lines+markers",
        name: `N = ${n}`,
        marker: { size: 7 },
        text: textVals,
        hoverinfo: "text",
      });
    }
  });

  if (data.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 320px; color: #94a3b8; text-align: center;">
        <p style="font-size: 15px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
          No benchmark records found for ${staticKernel} in ${precToUse}
        </p>
      </div>`;
    return;
  }

  data.push({
    x: [1, Math.max(...threads)],
    y: [1.0, 1.0],
    mode: "lines",
    line: { dash: "dash", color: "#94a3b8", width: 1.5 },
    name: "Parity (1.0x)",
    hoverinfo: "none",
  });

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#161d24",
    margin: { t: 30, b: 50, l: 55, r: 20 },
    font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8", size: 11 },
    xaxis: { title: "Worker Threads", gridcolor: "#222b35", tickvals: threads },
    yaxis: { title: "Speed Ratio (Static / Rayon Time)", gridcolor: "#222b35" },
    legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 11 } },
  };

  Plotly.newPlot(containerId, data, layout, { responsive: true });
}

export function renderSchedulerShootout(): void {
  renderSchedulerComparison("chart-scheduler", "rayon-ikj", "static-ikj", "Contiguous ikj");
  renderSchedulerComparison(
    "chart-scheduler-tiled",
    "rayon-tiled",
    "static-tiled",
    "2D Cache-Tiled"
  );
}
