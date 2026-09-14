/**
 * Client-Side Performance Dashboard Logic
 * ========================================
 * Uses Plotly.js to render interactive charts for serial baselines,
 * parallel speedup grids, Amdahl efficiency, and Apple Silicon MPS comparisons.
 */

const SERIAL_KERNELS = new Set(["naive-ijk", "ikj", "tiled"]);
const PARALLEL_KERNELS = new Set(["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"]);
const ACCELERATED_KERNELS = new Set(["mps"]);

const COLORS = {
  "naive-ijk": "#e74c3c",
  "ikj": "#e67e22",
  "tiled": "#f39c12",
  "rayon-ikj": "#38bdf8",
  "rayon-tiled": "#2563eb",
  "static-ikj": "#a855f7",
  "static-tiled": "#d946ef",
  "mps": "#2ecc71",
  "ideal": "#94a3b8"
};

const SIZES = [...new Set(RAW_RECORDS.map(r => r.n))].sort((a, b) => a - b);
const THREADS = [...new Set(RAW_RECORDS.map(r => r.threads))].sort((a, b) => a - b);

function getRecord(kernel, n, threads) {
  return RAW_RECORDS.find(r => r.kernel === kernel && r.n === n && r.threads === threads);
}

function getSpeedup(kernel, n, threads) {
  const base = getRecord(kernel, n, 1);
  const curr = getRecord(kernel, n, threads);
  if (base && curr && curr.elapsed_ms > 0) {
    return base.elapsed_ms / curr.elapsed_ms;
  }
  return null;
}

// Tab Switching Navigation
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.getAttribute('onclick').includes(tabId));
  if (targetBtn) targetBtn.classList.add('active');

  const targetContent = document.getElementById(tabId);
  if (targetContent) targetContent.classList.add('active');

  window.dispatchEvent(new Event('resize'));
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
    if (targetContent) {
      targetContent.querySelectorAll('.js-plotly-plot').forEach(el => {
        Plotly.Plots.resize(el);
      });
    }
  }, 40);
}

// 1. Parallel Speedup Grid Chart
function renderParallelGrid() {
  const gridSizes = SIZES.filter(s => s >= 128);
  const cols = 3;
  const rows = Math.ceil(gridSizes.length / cols);

  const subplots = [];
  const titles = [];
  for (let r = 0; r < rows; r++) {
    const rowLayout = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < gridSizes.length) {
        rowLayout.push(`xy${idx === 0 ? '' : idx + 1}`);
        titles.push(`Matrix N = ${gridSizes[idx]} × ${gridSizes[idx]}`);
      } else {
        rowLayout.push(null);
      }
    }
    subplots.push(rowLayout);
  }

  const data = [];
  const maxThread = Math.max(...THREADS);

  gridSizes.forEach((n, idx) => {
    const axisSuffix = idx === 0 ? '' : (idx + 1);
    const xaxis = `x${axisSuffix}`;
    const yaxis = `y${axisSuffix}`;

    // Ideal linear scaling line
    data.push({
      x: [1, maxThread],
      y: [1, maxThread],
      mode: 'lines',
      line: { dash: 'dot', width: 1.5, color: COLORS.ideal },
      name: 'Ideal Linear (y=x)',
      xaxis: xaxis,
      yaxis: yaxis,
      showlegend: idx === 0,
      hoverinfo: 'none'
    });

    // Parallel kernels
    ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach(k => {
      const xVals = [];
      const yVals = [];
      const textVals = [];

      THREADS.forEach(t => {
        const sp = getSpeedup(k, n, t);
        const rec = getRecord(k, n, t);
        if (sp !== null && rec) {
          xVals.push(t);
          yVals.push(sp);
          textVals.push(`<b>${k}</b><br>N: ${n}<br>Threads: ${t}<br>Speedup: ${sp.toFixed(2)}x<br>Time: ${rec.elapsed_ms.toFixed(3)} ms<br>GFLOPS: ${rec.gflops.toFixed(1)}`);
        }
      });

      if (xVals.length > 0) {
        data.push({
          x: xVals,
          y: yVals,
          mode: 'lines+markers',
          line: { color: COLORS[k], width: 2.5 },
          marker: { size: 6 },
          name: k,
          xaxis: xaxis,
          yaxis: yaxis,
          showlegend: idx === 0,
          text: textVals,
          hoverinfo: 'text'
        });
      }
    });

    // MPS callout trace if exists
    const mpsRec = getRecord("mps", n, 1);
    if (mpsRec) {
      data.push({
        x: [maxThread],
        y: [maxThread * 0.95],
        mode: 'text',
        text: [`<b>MPS: ${mpsRec.gflops.toFixed(0)} GFLOPS</b>`],
        textposition: 'bottom right',
        textfont: { size: 10, color: COLORS.mps },
        xaxis: xaxis,
        yaxis: yaxis,
        showlegend: false,
        hoverinfo: 'none'
      });
    }
  });

  const layout = {
    grid: { rows: rows, columns: cols, pattern: 'independent' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 40, b: 40, l: 50, r: 30 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8' },
    legend: { orientation: 'h', x: 0, y: 1.05, font: { color: '#e2e8f0' } },
  };

  gridSizes.forEach((n, idx) => {
    const axisSuffix = idx === 0 ? '' : (idx + 1);
    layout[`xaxis${axisSuffix}`] = {
      title: 'Threads',
      gridcolor: '#222b35',
      zeroline: false,
      tickmode: 'array',
      tickvals: THREADS
    };
    layout[`yaxis${axisSuffix}`] = {
      title: 'Speedup (x)',
      gridcolor: '#222b35',
      zeroline: false,
      rangemode: 'tozero'
    };
  });

  Plotly.newPlot('chart-parallel-grid', data, layout, { responsive: true });
}

// 2. Parallel Efficiency Chart
function renderParallelEfficiency() {
  const targetSizes = [512, 1024, 2048].filter(s => SIZES.includes(s));
  const data = [];

  // 100% threshold line
  data.push({
    x: [1, Math.max(...THREADS)],
    y: [100, 100],
    mode: 'lines',
    line: { dash: 'dash', color: '#64748b', width: 1.5 },
    name: '100% Linear Efficiency',
    hoverinfo: 'none'
  });

  targetSizes.forEach(n => {
    ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach(k => {
      const xVals = [];
      const yVals = [];
      const textVals = [];

      THREADS.forEach(t => {
        const sp = getSpeedup(k, n, t);
        if (sp !== null) {
          const eff = (sp / t) * 100;
          xVals.push(t);
          yVals.push(eff);
          textVals.push(`<b>${k} (N=${n})</b><br>Threads: ${t}<br>Efficiency: ${eff.toFixed(1)}%<br>Speedup: ${sp.toFixed(2)}x`);
        }
      });

      if (xVals.length > 0) {
        data.push({
          x: xVals,
          y: yVals,
          mode: 'lines+markers',
          name: `${k} (N=${n})`,
          marker: { size: 7 },
          text: textVals,
          hoverinfo: 'text'
        });
      }
    });
  });

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 30, b: 60, l: 60, r: 30 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8' },
    xaxis: { title: 'Worker Threads', gridcolor: '#222b35', tickvals: THREADS },
    yaxis: { title: 'Parallel Efficiency (%)', gridcolor: '#222b35', rangemode: 'tozero' },
    legend: { orientation: 'h', x: 0, y: 1.1, font: { color: '#e2e8f0' } }
  };

  Plotly.newPlot('chart-parallel-efficiency', data, layout, { responsive: true });
}

// 3. Serial Baseline Chart
function renderSerialBaseline() {
  const data = [];
  ["naive-ijk", "ikj", "tiled"].forEach(k => {
    const xVals = [];
    const yVals = [];
    const textVals = [];

    SIZES.forEach(n => {
      const rec = getRecord(k, n, 1);
      if (rec) {
        xVals.push(`N=${n}`);
        yVals.push(rec.gflops);
        textVals.push(`<b>${k}</b><br>N: ${n}<br>GFLOPS: ${rec.gflops.toFixed(2)}<br>Time: ${rec.elapsed_ms.toFixed(2)} ms`);
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        type: 'bar',
        name: k,
        marker: { color: COLORS[k] },
        text: textVals,
        hoverinfo: 'text'
      });
    }
  });

  const layout = {
    barmode: 'group',
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 30, b: 60, l: 60, r: 30 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8' },
    xaxis: { title: 'Matrix Dimension (N)', gridcolor: '#222b35' },
    yaxis: { title: 'Throughput (GFLOPS)', gridcolor: '#222b35', rangemode: 'tozero' },
    legend: { orientation: 'h', x: 0, y: 1.1, font: { color: '#e2e8f0' } }
  };

  Plotly.newPlot('chart-serial-baseline', data, layout, { responsive: true });
}

// 4. Peak Landscape Chart
function renderPeakLandscape() {
  const data = [];
  const kernelsToPlot = [
    { k: "naive-ijk", name: "Naive (1T)", style: "dash" },
    { k: "ikj", name: "Contiguous ikj (1T)", style: "solid" },
    { k: "rayon-ikj", name: "Rayon ikj (Peak Threads)", style: "solid" },
    { k: "rayon-tiled", name: "Rayon Tiled (Peak Threads)", style: "solid" },
    { k: "static-ikj", name: "Static ikj (Peak Threads)", style: "solid" },
    { k: "static-tiled", name: "Static Tiled (Peak Threads)", style: "solid" },
    { k: "mps", name: "Apple Silicon MPS (GPU/AMX)", style: "solid" },
  ];

  kernelsToPlot.forEach(item => {
    const xVals = [];
    const yVals = [];
    const textVals = [];

    SIZES.forEach(n => {
      const matches = RAW_RECORDS.filter(r => r.kernel === item.k && r.n === n);
      if (matches.length > 0) {
        const peak = matches.reduce((max, r) => r.gflops > max.gflops ? r : max, matches[0]);
        xVals.push(n);
        yVals.push(peak.gflops);
        textVals.push(`<b>${item.name}</b><br>N: ${n}<br>Peak GFLOPS: ${peak.gflops.toFixed(1)}<br>Threads: ${peak.threads}<br>Time: ${peak.elapsed_ms.toFixed(2)} ms`);
      }
    });

    if (xVals.length > 0) {
      data.push({
        x: xVals,
        y: yVals,
        mode: 'lines+markers',
        name: item.name,
        line: {
          color: COLORS[item.k] || '#ffffff',
          width: 3,
          dash: item.style === 'dash' ? 'dash' : 'solid'
        },
        marker: { size: 7 },
        text: textVals,
        hoverinfo: 'text'
      });
    }
  });

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 30, b: 60, l: 70, r: 30 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8' },
    xaxis: { title: 'Matrix Dimension (N)', type: 'log', gridcolor: '#222b35', tickvals: SIZES },
    yaxis: { title: 'Peak Throughput (GFLOPS, Log Scale)', type: 'log', gridcolor: '#222b35' },
    legend: { orientation: 'h', x: 0, y: 1.1, font: { color: '#e2e8f0' } }
  };

  Plotly.newPlot('chart-peak-landscape', data, layout, { responsive: true });
}

// 5. Scheduler Shootout Charts
function renderSchedulerComparison(containerId, rayonKernel, staticKernel, label) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data = [];
  let targetSizes = [512, 1024, 2048].filter(s => SIZES.includes(s));
  if (targetSizes.length === 0) {
    targetSizes = SIZES.slice(-3);
  }

  targetSizes.forEach(n => {
    const xVals = [];
    const yVals = [];
    const textVals = [];

    THREADS.forEach(t => {
      const rayonRec = getRecord(rayonKernel, n, t);
      const staticRec = getRecord(staticKernel, n, t);
      if (rayonRec && staticRec && staticRec.elapsed_ms > 0 && rayonRec.elapsed_ms > 0) {
        const ratio = staticRec.elapsed_ms / rayonRec.elapsed_ms;
        xVals.push(t);
        yVals.push(ratio);
        textVals.push(
          `<b>${label} (N=${n}, Threads=${t})</b><br>` +
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
        mode: 'lines+markers',
        name: `N = ${n}`,
        marker: { size: 7 },
        text: textVals,
        hoverinfo: 'text'
      });
    }
  });

  if (data.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 320px; color: #94a3b8; text-align: center;">
        <p style="font-size: 15px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
          No benchmark records found for ${staticKernel}
        </p>
        <p style="font-size: 13px; color: #64748b; max-width: 480px;">
          Run benchmarks with <code>--kernel ${rayonKernel},${staticKernel}</code> to generate scheduler shootout comparison curves.
        </p>
      </div>`;
    return;
  }

  data.push({
    x: [1, Math.max(...THREADS)],
    y: [1.0, 1.0],
    mode: 'lines',
    line: { dash: 'dash', color: '#94a3b8', width: 1.5 },
    name: 'Parity (1.0x)',
    hoverinfo: 'none'
  });

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 30, b: 50, l: 55, r: 20 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8', size: 11 },
    xaxis: { title: 'Worker Threads', gridcolor: '#222b35', tickvals: THREADS },
    yaxis: { title: 'Speed Ratio (Static / Rayon Time)', gridcolor: '#222b35' },
    legend: { orientation: 'h', x: 0, y: 1.15, font: { color: '#e2e8f0', size: 11 } }
  };

  Plotly.newPlot(containerId, data, layout, { responsive: true });
}

function renderSchedulerShootout() {
  renderSchedulerComparison('chart-scheduler', 'rayon-ikj', 'static-ikj', 'Contiguous ikj');
  renderSchedulerComparison('chart-scheduler-tiled', 'rayon-tiled', 'static-tiled', '2D Cache-Tiled');
}

// 6. MPS Gap Chart
function renderMpsGap() {
  const xVals = [];
  const yVals = [];
  const textVals = [];

  SIZES.forEach(n => {
    const mpsRec = getRecord("mps", n, 1);
    const cpuMatches = RAW_RECORDS.filter(r => PARALLEL_KERNELS.has(r.kernel) && r.n === n);
    if (mpsRec && cpuMatches.length > 0) {
      const bestCpu = cpuMatches.reduce((max, r) => r.gflops > max.gflops ? r : max, cpuMatches[0]);
      const ratio = bestCpu.elapsed_ms / mpsRec.elapsed_ms;
      xVals.push(n);
      yVals.push(ratio);
      textVals.push(`<b>Matrix N = ${n}</b><br>MPS: ${mpsRec.gflops.toFixed(1)} GFLOPS (${mpsRec.elapsed_ms.toFixed(2)} ms)<br>Best CPU (${bestCpu.kernel}, ${bestCpu.threads}T): ${bestCpu.gflops.toFixed(1)} GFLOPS (${bestCpu.elapsed_ms.toFixed(2)} ms)<br><b>MPS Speedup: ${ratio.toFixed(2)}x</b>`);
    }
  });

  const data = [
    {
      x: [SIZES[0], SIZES[SIZES.length - 1]],
      y: [1.0, 1.0],
      mode: 'lines',
      line: { dash: 'dash', color: '#e2e8f0', width: 1.5 },
      name: '1.0x Parity Threshold',
      hoverinfo: 'none'
    },
    {
      x: xVals,
      y: yVals,
      mode: 'lines+markers+text',
      line: { color: COLORS.mps, width: 3 },
      marker: { size: 8, color: COLORS.mps },
      text: yVals.map(v => `${v.toFixed(1)}x`),
      textposition: 'top center',
      textfont: { color: '#86efac', size: 11, weight: 'bold' },
      hovertext: textVals,
      hoverinfo: 'text',
      name: 'MPS Speedup vs Best CPU'
    }
  ];

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#161d24',
    margin: { t: 30, b: 60, l: 70, r: 30 },
    font: { family: '-apple-system, BlinkMacSystemFont, Segoe UI', color: '#94a3b8' },
    xaxis: { title: 'Matrix Dimension (N)', type: 'log', gridcolor: '#222b35', tickvals: SIZES },
    yaxis: { title: 'Speedup Factor (MPS / Best CPU)', gridcolor: '#222b35', rangemode: 'tozero' },
    legend: { orientation: 'h', x: 0, y: 1.1, font: { color: '#e2e8f0' } }
  };

  Plotly.newPlot('chart-mps-gap', data, layout, { responsive: true });
}

// 7. Interactive Sortable Data Table
let tableRecords = [];
let currentSortField = "gflops";
let currentSortDir = "desc";

function getCategory(kernel) {
  if (PARALLEL_KERNELS.has(kernel)) return "parallel";
  if (ACCELERATED_KERNELS.has(kernel)) return "mps";
  return "serial";
}

function initTableData() {
  tableRecords = RAW_RECORDS.map(r => {
    const sp = getSpeedup(r.kernel, r.n, r.threads);
    return {
      ...r,
      category: getCategory(r.kernel),
      speedup: sp !== null ? sp : 0
    };
  });
}

function sortTableBy(field) {
  if (currentSortField === field) {
    currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
  } else {
    currentSortField = field;
    const isText = field === "kernel" || field === "category" || field === "precision";
    currentSortDir = isText ? "asc" : "desc";
  }
  updateSortUI();
  renderTable();
}

function toggleSortDirection() {
  currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
  updateSortUI();
  renderTable();
}

function applyTableSort() {
  const select = document.getElementById("sortField");
  if (select) {
    currentSortField = select.value;
    const isText = currentSortField === "kernel" || currentSortField === "category" || currentSortField === "precision";
    currentSortDir = isText ? "asc" : "desc";
    updateSortUI();
    renderTable();
  }
}

function updateSortUI() {
  const select = document.getElementById("sortField");
  if (select) select.value = currentSortField;

  const icon = document.getElementById("sortDirIcon");
  if (icon) {
    icon.innerHTML = currentSortDir === "asc" ? "Asc &#x25B2;" : "Desc &#x25BC;";
  }

  document.querySelectorAll("#benchmarkTable th.sortable").forEach(th => {
    th.classList.remove("sorted-active");
    const span = th.querySelector(".sort-icon");
    if (span) span.innerHTML = "";
  });

  const activeTh = document.querySelector(`#benchmarkTable th[data-col="${currentSortField}"]`);
  if (activeTh) {
    activeTh.classList.add("sorted-active");
    const span = activeTh.querySelector(".sort-icon");
    if (span) {
      span.innerHTML = currentSortDir === "asc" ? "&#x25B2;" : "&#x25BC;";
    }
  }
}

function renderTable() {
  const tbody = document.querySelector("#benchmarkTable tbody");
  if (!tbody) return;

  const query = (document.getElementById("tableSearch")?.value || "").toLowerCase().trim();

  const sorted = [...tableRecords].sort((a, b) => {
    const valA = a[currentSortField];
    const valB = b[currentSortField];

    if (typeof valA === "string" || typeof valB === "string") {
      const cmp = String(valA || "").localeCompare(String(valB || ""));
      return currentSortDir === "asc" ? cmp : -cmp;
    }
    const numA = Number(valA) || 0;
    const numB = Number(valB) || 0;
    return currentSortDir === "asc" ? numA - numB : numB - numA;
  });

  tbody.innerHTML = "";

  sorted.forEach(r => {
    const rowText = `${r.kernel} ${r.category} ${r.n} ${r.threads} ${r.precision} ${r.elapsed_ms} ${r.gflops}`.toLowerCase();
    if (query && !rowText.includes(query)) return;

    const tr = document.createElement("tr");
    let catBadge = '<span class="badge badge-serial">Serial</span>';
    if (r.category === "parallel") catBadge = '<span class="badge badge-parallel">Parallel</span>';
    else if (r.category === "mps") catBadge = '<span class="badge badge-mps">MPS</span>';

    const spText = r.speedup > 0 ? `${r.speedup.toFixed(2)}x` : "-";

    tr.innerHTML = `
      <td style="font-weight:600; color:#f8fafc;">${r.kernel}</td>
      <td style="text-align:left;">${catBadge}</td>
      <td>${r.n}</td>
      <td>${r.threads}</td>
      <td>${r.precision}</td>
      <td>${r.elapsed_ms.toFixed(3)}</td>
      <td style="font-weight:600; color:#38bdf8;">${r.gflops.toFixed(2)}</td>
      <td>${spText}</td>
    `;
    tbody.appendChild(tr);
  });
}

function filterTable() {
  renderTable();
}

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  renderParallelGrid();
  renderParallelEfficiency();
  renderSerialBaseline();
  renderPeakLandscape();
  renderSchedulerShootout();
  renderMpsGap();
  initTableData();
  updateSortUI();
  renderTable();
});
