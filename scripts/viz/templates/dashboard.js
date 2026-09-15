"use strict";
(() => {
  // src/constants.ts
  var PARALLEL_KERNELS = /* @__PURE__ */ new Set([
    "rayon-ikj",
    "rayon-tiled",
    "static-ikj",
    "static-tiled"
  ]);
  var ACCELERATED_KERNELS = /* @__PURE__ */ new Set(["mps"]);
  var COLORS = {
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
  var PRECISION_COLORS = {
    f16: "#d946ef",
    // Fuchsia
    f32: "#38bdf8",
    // Cyan / Sky blue
    f64: "#f59e0b"
    // Amber
  };

  // src/state.ts
  var activePrecision = "all";
  function setActivePrecision(prec) {
    activePrecision = prec;
  }
  var tableRecords = [];
  function setTableRecords(records) {
    tableRecords = records;
  }
  var currentSortField = "gflops";
  function setCurrentSortField(field) {
    currentSortField = field;
  }
  var currentSortDir = "desc";
  function setCurrentSortDir(dir) {
    currentSortDir = dir;
  }
  function getSizes() {
    if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
    return [...new Set(RAW_RECORDS.map((r) => r.n))].sort((a, b) => a - b);
  }
  function getThreads() {
    if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
    return [...new Set(RAW_RECORDS.map((r) => r.threads))].sort((a, b) => a - b);
  }
  function getPrecisions() {
    if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
    return [...new Set(RAW_RECORDS.map((r) => r.precision))].sort();
  }

  // src/metrics.ts
  function getRecord(kernel, n, threads, precision) {
    const targetPrec = precision || (activePrecision === "all" ? "f32" : activePrecision);
    return RAW_RECORDS.find(
      (r) => r.kernel === kernel && r.n === n && r.threads === threads && r.precision === targetPrec
    );
  }
  function getSpeedup(kernel, n, threads, precision) {
    const base = getRecord(kernel, n, 1, precision);
    const curr = getRecord(kernel, n, threads, precision);
    if (base && curr && curr.elapsed_ms > 0) {
      return base.elapsed_ms / curr.elapsed_ms;
    }
    return null;
  }
  function updateKpisForPrecision(prec) {
    const records = prec === "all" ? RAW_RECORDS : RAW_RECORDS.filter((r) => r.precision === prec);
    if (records.length === 0) return;
    const mpsRecords = records.filter((r) => r.kernel === "mps");
    const mpsVal = document.getElementById("kpi-mps-val");
    const mpsMeta = document.getElementById("kpi-mps-meta");
    if (mpsRecords.length > 0) {
      const bestMps = mpsRecords.reduce(
        (max, r) => r.gflops > max.gflops ? r : max,
        mpsRecords[0]
      );
      if (mpsVal) mpsVal.innerHTML = `${Math.round(bestMps.gflops).toLocaleString()} <span>GFLOPS</span>`;
      if (mpsMeta) mpsMeta.textContent = `Apple Silicon MPS (${bestMps.precision})`;
    } else {
      if (mpsVal) mpsVal.innerHTML = "N/A";
      if (mpsMeta) mpsMeta.textContent = `MPS not supported in ${prec}`;
    }
    const cpuRecords = records.filter((r) => !ACCELERATED_KERNELS.has(r.kernel));
    const cpuVal = document.getElementById("kpi-cpu-val");
    const cpuMeta = document.getElementById("kpi-cpu-meta");
    if (cpuRecords.length > 0) {
      const bestCpu = cpuRecords.reduce(
        (max, r) => r.gflops > max.gflops ? r : max,
        cpuRecords[0]
      );
      if (cpuVal) cpuVal.innerHTML = `${Math.round(bestCpu.gflops).toLocaleString()} <span>GFLOPS</span>`;
      if (cpuMeta) cpuMeta.textContent = `${bestCpu.kernel} (${bestCpu.precision}) @ ${bestCpu.threads}T`;
    }
    let maxSp = 1;
    const sizes = getSizes();
    const threads = getThreads();
    const precisions = getPrecisions();
    PARALLEL_KERNELS.forEach((k) => {
      sizes.forEach((n) => {
        threads.forEach((t) => {
          const precsToTest = prec === "all" ? precisions : [prec];
          precsToTest.forEach((p) => {
            const sp = getSpeedup(k, n, t, p);
            if (sp && sp > maxSp) maxSp = sp;
          });
        });
      });
    });
    const parVal = document.getElementById("kpi-parallel-val");
    if (parVal) parVal.textContent = `${maxSp.toFixed(2)}x`;
    let maxCacheSp = 1;
    sizes.forEach((n) => {
      const precsToTest = prec === "all" ? precisions : [prec];
      precsToTest.forEach((p) => {
        const naive = getRecord("naive-ijk", n, 1, p);
        const ikj = getRecord("ikj", n, 1, p);
        if (naive && ikj && ikj.elapsed_ms > 0) {
          const sp = naive.elapsed_ms / ikj.elapsed_ms;
          if (sp > maxCacheSp) maxCacheSp = sp;
        }
      });
    });
    const cacheVal = document.getElementById("kpi-cache-val");
    if (cacheVal) cacheVal.textContent = `${maxCacheSp.toFixed(1)}x`;
    let maxF16Sp = 1;
    [
      "naive-ijk",
      "ikj",
      "tiled",
      "rayon-ikj",
      "rayon-tiled",
      "static-ikj",
      "static-tiled",
      "mps"
    ].forEach((k) => {
      sizes.forEach((n) => {
        threads.forEach((t) => {
          const f32Rec = getRecord(k, n, t, "f32");
          const f16Rec = getRecord(k, n, t, "f16");
          if (f32Rec && f16Rec && f16Rec.elapsed_ms > 0) {
            const sp = f32Rec.elapsed_ms / f16Rec.elapsed_ms;
            if (sp > maxF16Sp) maxF16Sp = sp;
          }
        });
      });
    });
    const f16Val = document.getElementById("kpi-f16-val");
    if (f16Val) f16Val.textContent = `${maxF16Sp.toFixed(2)}x`;
  }

  // src/charts/baseline.ts
  function renderSerialBaseline() {
    const sizes = getSizes();
    if (sizes.length === 0) return;
    const data = [];
    const precToUse = activePrecision === "all" ? "f32" : activePrecision;
    ["naive-ijk", "ikj", "tiled"].forEach((k) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
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
          hoverinfo: "text"
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
      legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } }
    };
    const el = document.getElementById("chart-serial-baseline");
    if (el) {
      Plotly.newPlot("chart-serial-baseline", data, layout, { responsive: true });
    }
  }

  // src/charts/efficiency.ts
  function renderParallelEfficiency() {
    const sizes = getSizes();
    const threads = getThreads();
    if (sizes.length === 0 || threads.length === 0) return;
    const targetSizes = [512, 1024, 2048, 4096].filter((s) => sizes.includes(s));
    const data = [];
    const precToUse = activePrecision === "all" ? "f32" : activePrecision;
    data.push({
      x: [1, Math.max(...threads)],
      y: [100, 100],
      mode: "lines",
      line: { dash: "dash", color: "#64748b", width: 1.5 },
      name: "100% Linear Efficiency",
      hoverinfo: "none"
    });
    targetSizes.forEach((n) => {
      ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach((k) => {
        const xVals = [];
        const yVals = [];
        const textVals = [];
        threads.forEach((t) => {
          const sp = getSpeedup(k, n, t, precToUse);
          if (sp !== null) {
            const eff = sp / t * 100;
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
            hoverinfo: "text"
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
      legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } }
    };
    const el = document.getElementById("chart-parallel-efficiency");
    if (el) {
      Plotly.newPlot("chart-parallel-efficiency", data, layout, { responsive: true });
    }
  }

  // src/charts/grid.ts
  function renderParallelGrid() {
    const sizes = getSizes();
    const threads = getThreads();
    const gridSizes = sizes.filter((s) => s >= 128);
    if (gridSizes.length === 0 || threads.length === 0) return;
    const cols = 3;
    const rows = Math.ceil(gridSizes.length / cols);
    const data = [];
    const maxThread = Math.max(...threads);
    const precToUse = activePrecision === "all" ? "f32" : activePrecision;
    gridSizes.forEach((n, idx) => {
      const axisSuffix = idx === 0 ? "" : idx + 1;
      const xaxis = `x${axisSuffix}`;
      const yaxis = `y${axisSuffix}`;
      data.push({
        x: [1, maxThread],
        y: [1, maxThread],
        mode: "lines",
        line: { dash: "dot", width: 1.5, color: COLORS.ideal },
        name: "Ideal Linear (y=x)",
        xaxis,
        yaxis,
        showlegend: idx === 0,
        hoverinfo: "none"
      });
      ["rayon-ikj", "rayon-tiled", "static-ikj", "static-tiled"].forEach((k) => {
        const xVals = [];
        const yVals = [];
        const textVals = [];
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
            xaxis,
            yaxis,
            showlegend: idx === 0,
            text: textVals,
            hoverinfo: "text"
          });
        }
      });
      const mpsRec = getRecord("mps", n, 1, precToUse);
      if (mpsRec) {
        data.push({
          x: [maxThread],
          y: [maxThread * 0.95],
          mode: "text",
          text: [`<b>MPS: ${mpsRec.gflops.toFixed(0)} GFLOPS</b>`],
          textposition: "bottom right",
          textfont: { size: 10, color: COLORS.mps },
          xaxis,
          yaxis,
          showlegend: false,
          hoverinfo: "none"
        });
      }
    });
    const layout = {
      grid: { rows, columns: cols, pattern: "independent" },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#161d24",
      margin: { t: 40, b: 40, l: 50, r: 30 },
      font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
      legend: { orientation: "h", x: 0, y: 1.05, font: { color: "#e2e8f0" } }
    };
    gridSizes.forEach((_n, idx) => {
      const axisSuffix = idx === 0 ? "" : idx + 1;
      layout[`xaxis${axisSuffix}`] = {
        title: "Threads",
        gridcolor: "#222b35",
        zeroline: false,
        tickmode: "array",
        tickvals: threads
      };
      layout[`yaxis${axisSuffix}`] = {
        title: "Speedup (x)",
        gridcolor: "#222b35",
        zeroline: false,
        rangemode: "tozero"
      };
    });
    const el = document.getElementById("chart-parallel-grid");
    if (el) {
      Plotly.newPlot("chart-parallel-grid", data, layout, { responsive: true });
    }
  }

  // src/charts/landscape.ts
  function renderPeakLandscape() {
    const sizes = getSizes();
    if (sizes.length === 0) return;
    const data = [];
    const precToUse = activePrecision === "all" ? null : activePrecision;
    const kernelsToPlot = [
      { k: "naive-ijk", name: "Naive (1T)", style: "dash" },
      { k: "ikj", name: "Contiguous ikj (1T)", style: "solid" },
      { k: "rayon-ikj", name: "Rayon ikj (Peak Threads)", style: "solid" },
      { k: "rayon-tiled", name: "Rayon Tiled (Peak Threads)", style: "solid" },
      { k: "static-ikj", name: "Static ikj (Peak Threads)", style: "solid" },
      { k: "static-tiled", name: "Static Tiled (Peak Threads)", style: "solid" },
      { k: "mps", name: "Apple Silicon MPS (GPU/AMX)", style: "solid" }
    ];
    kernelsToPlot.forEach((item) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
      sizes.forEach((n) => {
        const matches = RAW_RECORDS.filter(
          (r) => r.kernel === item.k && r.n === n && (precToUse === null || r.precision === precToUse)
        );
        if (matches.length > 0) {
          const peak = matches.reduce((max, r) => r.gflops > max.gflops ? r : max, matches[0]);
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
            dash: item.style === "dash" ? "dash" : "solid"
          },
          marker: { size: 7 },
          text: textVals,
          hoverinfo: "text"
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
      legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } }
    };
    const el = document.getElementById("chart-peak-landscape");
    if (el) {
      Plotly.newPlot("chart-peak-landscape", data, layout, { responsive: true });
    }
  }

  // src/charts/mps.ts
  function renderMpsGap() {
    const sizes = getSizes();
    const precisions = getPrecisions();
    if (sizes.length === 0) return;
    const precisionsToShow = activePrecision === "all" ? ["f16", "f32"].filter((p) => precisions.includes(p)) : [activePrecision].filter((p) => p === "f16" || p === "f32");
    const data = [
      {
        x: [sizes[0], sizes[sizes.length - 1]],
        y: [1, 1],
        mode: "lines",
        line: { dash: "dash", color: "#e2e8f0", width: 1.5 },
        name: "1.0x Parity Threshold",
        hoverinfo: "none"
      }
    ];
    precisionsToShow.forEach((p) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
      sizes.forEach((n) => {
        const mpsRec = RAW_RECORDS.find((r) => r.kernel === "mps" && r.n === n && r.precision === p);
        const cpuMatches = RAW_RECORDS.filter(
          (r) => PARALLEL_KERNELS.has(r.kernel) && r.n === n && r.precision === p
        );
        if (mpsRec && cpuMatches.length > 0) {
          const bestCpu = cpuMatches.reduce(
            (max, r) => r.gflops > max.gflops ? r : max,
            cpuMatches[0]
          );
          const ratio = bestCpu.elapsed_ms / mpsRec.elapsed_ms;
          xVals.push(n);
          yVals.push(ratio);
          textVals.push(
            `<b>Matrix N = ${n} (${p})</b><br>MPS: ${mpsRec.gflops.toFixed(1)} GFLOPS (${mpsRec.elapsed_ms.toFixed(2)} ms)<br>Best CPU (${bestCpu.kernel}, ${bestCpu.threads}T): ${bestCpu.gflops.toFixed(1)} GFLOPS (${bestCpu.elapsed_ms.toFixed(2)} ms)<br><b>MPS Speedup: ${ratio.toFixed(2)}x</b>`
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
          name: `MPS Speedup vs Best CPU (${p})`
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
        rangemode: "tozero"
      },
      legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } }
    };
    const el = document.getElementById("chart-mps-gap");
    if (el) {
      Plotly.newPlot("chart-mps-gap", data, layout, { responsive: true });
    }
  }

  // src/charts/precision.ts
  function initPrecisionControls() {
    const select = document.getElementById("precisionSizeSelect");
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
      opt.textContent = `N = ${n} \xD7 ${n}`;
      if (n === 2048 || n === 1024) opt.selected = true;
      select.appendChild(opt);
    });
    if (currentVal) {
      select.value = currentVal;
    }
  }
  function renderPrecisionThroughputChart() {
    const select = document.getElementById("precisionSizeSelect");
    const selectedSize = select ? select.value : "peak";
    const kernels = [
      "naive-ijk",
      "ikj",
      "tiled",
      "rayon-ikj",
      "rayon-tiled",
      "static-ikj",
      "static-tiled",
      "mps"
    ];
    const precisions = getPrecisions();
    const precisionsToPlot = ["f16", "f32", "f64"].filter((p) => precisions.includes(p));
    const data = [];
    precisionsToPlot.forEach((p) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
      kernels.forEach((k) => {
        let rec = null;
        if (selectedSize === "peak") {
          const matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === p);
          if (matches.length > 0) {
            rec = matches.reduce((max, r) => r.gflops > max.gflops ? r : max, matches[0]);
          }
        } else {
          const nVal = parseInt(selectedSize, 10);
          const matches = RAW_RECORDS.filter(
            (r) => r.kernel === k && r.n === nVal && r.precision === p
          );
          if (matches.length > 0) {
            rec = matches.reduce((max, r) => r.gflops > max.gflops ? r : max, matches[0]);
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
          hoverinfo: "text"
        });
      }
    });
    const subtitleText = selectedSize === "peak" ? "Peak Configuration across Matrix Sizes" : `Matrix Dimension N = ${selectedSize} \xD7 ${selectedSize}`;
    const layout = {
      barmode: "group",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#161d24",
      margin: { t: 40, b: 60, l: 60, r: 30 },
      font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8" },
      xaxis: { title: `Kernel (${subtitleText})`, gridcolor: "#222b35" },
      yaxis: { title: "Throughput (GFLOPS)", gridcolor: "#222b35", rangemode: "tozero" },
      legend: { orientation: "h", x: 0, y: 1.1, font: { color: "#e2e8f0" } }
    };
    const el = document.getElementById("chart-precision-bars");
    if (el) {
      Plotly.newPlot("chart-precision-bars", data, layout, { responsive: true });
    }
  }
  function renderPrecisionSpeedupChart() {
    const sizes = getSizes();
    if (sizes.length === 0) return;
    const data = [];
    data.push({
      x: [sizes[0], sizes[sizes.length - 1]],
      y: [1, 1],
      mode: "lines",
      line: { dash: "dash", color: "#64748b", width: 1.5 },
      name: "1.0x Parity (f32)",
      hoverinfo: "none"
    });
    data.push({
      x: [sizes[0], sizes[sizes.length - 1]],
      y: [2, 2],
      mode: "lines",
      line: { dash: "dot", color: "#94a3b8", width: 1.5 },
      name: "2.0x Theoretical Vector Packing",
      hoverinfo: "none"
    });
    const kernelsToCompare = [
      { k: "rayon-ikj", name: "Rayon ikj (f16 vs f32)", color: "#38bdf8", isF16: true },
      { k: "rayon-tiled", name: "Rayon Tiled (f16 vs f32)", color: "#818cf8", isF16: true },
      { k: "mps", name: "Apple MPS (f16 vs f32)", color: "#2ecc71", isF16: true },
      { k: "rayon-ikj", name: "Rayon ikj (f64 vs f32)", color: "#f59e0b", isF16: false },
      { k: "rayon-tiled", name: "Rayon Tiled (f64 vs f32)", color: "#ea580c", isF16: false }
    ];
    kernelsToCompare.forEach((item) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
      sizes.forEach((n) => {
        const f32Matches = RAW_RECORDS.filter(
          (r) => r.kernel === item.k && r.n === n && r.precision === "f32"
        );
        const targetMatches = RAW_RECORDS.filter(
          (r) => r.kernel === item.k && r.n === n && r.precision === (item.isF16 ? "f16" : "f64")
        );
        if (f32Matches.length > 0 && targetMatches.length > 0) {
          const peakF32 = f32Matches.reduce(
            (max, r) => r.gflops > max.gflops ? r : max,
            f32Matches[0]
          );
          const peakTarget = targetMatches.reduce(
            (max, r) => r.gflops > max.gflops ? r : max,
            targetMatches[0]
          );
          if (peakTarget.elapsed_ms > 0 && peakF32.elapsed_ms > 0) {
            const ratio = peakF32.elapsed_ms / peakTarget.elapsed_ms;
            xVals.push(n);
            yVals.push(ratio);
            textVals.push(
              `<b>${item.name}</b><br>Matrix N: ${n}<br>Ratio: ${ratio.toFixed(2)}x<br>f32 Time: ${peakF32.elapsed_ms.toFixed(2)} ms (${peakF32.gflops.toFixed(1)} GFLOPS)<br>${item.isF16 ? "f16" : "f64"} Time: ${peakTarget.elapsed_ms.toFixed(2)} ms (${peakTarget.gflops.toFixed(1)} GFLOPS)`
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
            dash: item.isF16 ? "solid" : "dash"
          },
          marker: { size: 6 },
          text: textVals,
          hoverinfo: "text"
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
        rangemode: "tozero"
      },
      legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 10 } }
    };
    const el = document.getElementById("chart-precision-speedup");
    if (el) {
      Plotly.newPlot("chart-precision-speedup", data, layout, { responsive: true });
    }
  }
  function renderPrecisionEnvelopeChart() {
    const sizes = getSizes();
    const precisions = getPrecisions();
    if (sizes.length === 0) return;
    const data = [];
    precisions.forEach((p) => {
      const cpuX = [];
      const cpuY = [];
      const cpuText = [];
      const mpsX = [];
      const mpsY = [];
      const mpsText = [];
      sizes.forEach((n) => {
        const cpuMatches = RAW_RECORDS.filter(
          (r) => !ACCELERATED_KERNELS.has(r.kernel) && r.n === n && r.precision === p
        );
        if (cpuMatches.length > 0) {
          const peakCpu = cpuMatches.reduce(
            (max, r) => r.gflops > max.gflops ? r : max,
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
          hoverinfo: "text"
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
            dash: p === "f16" ? "solid" : "dot"
          },
          marker: { size: 7 },
          text: mpsText,
          hoverinfo: "text"
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
      legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 10 } }
    };
    const el = document.getElementById("chart-precision-envelope");
    if (el) {
      Plotly.newPlot("chart-precision-envelope", data, layout, { responsive: true });
    }
  }
  function renderPrecisionSummaryTable() {
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
      "mps"
    ];
    kernels.forEach((k) => {
      const f16Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f16");
      const f32Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f32");
      const f64Matches = RAW_RECORDS.filter((r) => r.kernel === k && r.precision === "f64");
      const peakF16 = f16Matches.length > 0 ? f16Matches.reduce((max, r) => r.gflops > max.gflops ? r : max, f16Matches[0]) : null;
      const peakF32 = f32Matches.length > 0 ? f32Matches.reduce((max, r) => r.gflops > max.gflops ? r : max, f32Matches[0]) : null;
      const peakF64 = f64Matches.length > 0 ? f64Matches.reduce((max, r) => r.gflops > max.gflops ? r : max, f64Matches[0]) : null;
      let catBadge = '<span class="badge badge-serial">Serial</span>';
      if (PARALLEL_KERNELS.has(k)) {
        catBadge = '<span class="badge badge-parallel">Parallel</span>';
      } else if (ACCELERATED_KERNELS.has(k)) {
        catBadge = '<span class="badge badge-mps">MPS</span>';
      }
      const f16Sp = peakF16 && peakF32 && peakF32.gflops > 0 ? `${(peakF16.gflops / peakF32.gflops).toFixed(2)}x` : "\u2014";
      const f64Pen = peakF64 && peakF32 && peakF32.gflops > 0 ? `${(peakF64.gflops / peakF32.gflops).toFixed(2)}x` : "\u2014";
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td style="font-weight:600; color:#f8fafc;">${k}</td>
      <td style="text-align:left;">${catBadge}</td>
      <td style="font-weight:600; color:#e879f9;">${peakF16 ? peakF16.gflops.toFixed(1) : "\u2014"}</td>
      <td style="font-weight:600; color:#38bdf8;">${peakF32 ? peakF32.gflops.toFixed(1) : "\u2014"}</td>
      <td style="font-weight:600; color:#fbbf24;">${peakF64 ? peakF64.gflops.toFixed(1) : "\u2014"}</td>
      <td style="font-weight:600; color:#86efac;">${f16Sp}</td>
      <td style="color:#cbd5e1;">${f64Pen}</td>
      <td style="color:#94a3b8; font-size:12px;">f16: 32MB | f32: 64MB | f64: 128MB</td>
    `;
      tbody.appendChild(tr);
    });
  }
  function renderPrecisionComparison() {
    initPrecisionControls();
    renderPrecisionThroughputChart();
    renderPrecisionSpeedupChart();
    renderPrecisionEnvelopeChart();
    renderPrecisionSummaryTable();
  }

  // src/charts/scheduler.ts
  function renderSchedulerComparison(containerId, rayonKernel, staticKernel, label) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const sizes = getSizes();
    const threads = getThreads();
    if (sizes.length === 0 || threads.length === 0) return;
    const data = [];
    const precToUse = activePrecision === "all" ? "f32" : activePrecision;
    let targetSizes = [512, 1024, 2048, 4096].filter((s) => sizes.includes(s));
    if (targetSizes.length === 0) {
      targetSizes = sizes.slice(-3);
    }
    targetSizes.forEach((n) => {
      const xVals = [];
      const yVals = [];
      const textVals = [];
      threads.forEach((t) => {
        const rayonRec = getRecord(rayonKernel, n, t, precToUse);
        const staticRec = getRecord(staticKernel, n, t, precToUse);
        if (rayonRec && staticRec && staticRec.elapsed_ms > 0 && rayonRec.elapsed_ms > 0) {
          const ratio = staticRec.elapsed_ms / rayonRec.elapsed_ms;
          xVals.push(t);
          yVals.push(ratio);
          textVals.push(
            `<b>${label} (${precToUse}, N=${n}, Threads=${t})</b><br>Rayon Time: ${rayonRec.elapsed_ms.toFixed(2)} ms (${rayonRec.gflops.toFixed(1)} GFLOPS)<br>Static Time: ${staticRec.elapsed_ms.toFixed(2)} ms (${staticRec.gflops.toFixed(1)} GFLOPS)<br>Speed Ratio (Static / Rayon): ${ratio.toFixed(2)}x`
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
          hoverinfo: "text"
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
      y: [1, 1],
      mode: "lines",
      line: { dash: "dash", color: "#94a3b8", width: 1.5 },
      name: "Parity (1.0x)",
      hoverinfo: "none"
    });
    const layout = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#161d24",
      margin: { t: 30, b: 50, l: 55, r: 20 },
      font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI", color: "#94a3b8", size: 11 },
      xaxis: { title: "Worker Threads", gridcolor: "#222b35", tickvals: threads },
      yaxis: { title: "Speed Ratio (Static / Rayon Time)", gridcolor: "#222b35" },
      legend: { orientation: "h", x: 0, y: 1.15, font: { color: "#e2e8f0", size: 11 } }
    };
    Plotly.newPlot(containerId, data, layout, { responsive: true });
  }
  function renderSchedulerShootout() {
    renderSchedulerComparison("chart-scheduler", "rayon-ikj", "static-ikj", "Contiguous ikj");
    renderSchedulerComparison(
      "chart-scheduler-tiled",
      "rayon-tiled",
      "static-tiled",
      "2D Cache-Tiled"
    );
  }

  // src/table.ts
  function getCategory(kernel) {
    if (PARALLEL_KERNELS.has(kernel)) return "parallel";
    if (ACCELERATED_KERNELS.has(kernel)) return "mps";
    return "serial";
  }
  function initTableData() {
    if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return;
    const records = RAW_RECORDS.map((r) => {
      const sp = getSpeedup(r.kernel, r.n, r.threads, r.precision);
      return {
        ...r,
        category: getCategory(r.kernel),
        speedup: sp !== null ? sp : 0
      };
    });
    setTableRecords(records);
  }
  function sortTableBy(field) {
    if (currentSortField === field) {
      setCurrentSortDir(currentSortDir === "asc" ? "desc" : "asc");
    } else {
      setCurrentSortField(field);
      const isText = field === "kernel" || field === "category" || field === "precision";
      setCurrentSortDir(isText ? "asc" : "desc");
    }
    updateSortUI();
    renderTable();
  }
  function toggleSortDirection() {
    setCurrentSortDir(currentSortDir === "asc" ? "desc" : "asc");
    updateSortUI();
    renderTable();
  }
  function applyTableSort() {
    const select = document.getElementById("sortField");
    if (select) {
      const field = select.value;
      setCurrentSortField(field);
      const isText = field === "kernel" || field === "category" || field === "precision";
      setCurrentSortDir(isText ? "asc" : "desc");
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
    document.querySelectorAll("#benchmarkTable th.sortable").forEach((th) => {
      th.classList.remove("sorted-active");
      const span = th.querySelector(".sort-icon");
      if (span) span.innerHTML = "";
    });
    const activeTh = document.querySelector(
      `#benchmarkTable th[data-col="${currentSortField}"]`
    );
    if (activeTh) {
      activeTh.classList.add("sorted-active");
      const span = activeTh.querySelector(".sort-icon");
      if (span) {
        span.innerHTML = currentSortDir === "asc" ? "&#x25B2;" : "&#x25BC;";
      }
    }
  }
  function getFilteredTableRecords() {
    const searchInput = document.getElementById("tableSearch");
    const precFilterEl = document.getElementById("tablePrecFilter");
    const catFilterEl = document.getElementById("tableCatFilter");
    const query = (searchInput?.value || "").toLowerCase().trim();
    const precFilter = precFilterEl?.value || "all";
    const catFilter = catFilterEl?.value || "all";
    return tableRecords.filter((r) => {
      if (precFilter !== "all" && r.precision !== precFilter) return false;
      if (catFilter !== "all" && r.category !== catFilter) return false;
      if (query) {
        const rowText = `${r.kernel} ${r.category} ${r.n} ${r.threads} ${r.precision} ${r.elapsed_ms} ${r.gflops}`.toLowerCase();
        if (!rowText.includes(query)) return false;
      }
      return true;
    });
  }
  function renderTable() {
    const tbody = document.querySelector("#benchmarkTable tbody");
    if (!tbody) return;
    const filtered = getFilteredTableRecords();
    const sorted = [...filtered].sort((a, b) => {
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
    sorted.forEach((r) => {
      const tr = document.createElement("tr");
      let catBadge = '<span class="badge badge-serial">Serial</span>';
      if (r.category === "parallel") catBadge = '<span class="badge badge-parallel">Parallel</span>';
      else if (r.category === "mps") catBadge = '<span class="badge badge-mps">MPS</span>';
      const precBadge = `<span class="badge badge-${r.precision}">${r.precision}</span>`;
      const spText = r.speedup > 0 ? `${r.speedup.toFixed(2)}x` : "-";
      tr.innerHTML = `
      <td style="font-weight:600; color:#f8fafc;">${r.kernel}</td>
      <td style="text-align:left;">${catBadge}</td>
      <td>${r.n}</td>
      <td>${r.threads}</td>
      <td>${precBadge}</td>
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
  function exportTableToCSV() {
    const records = getFilteredTableRecords();
    if (records.length === 0) {
      alert("No records to export with current filters.");
      return;
    }
    const headers = [
      "kernel",
      "category",
      "n",
      "threads",
      "precision",
      "elapsed_ms",
      "gflops",
      "speedup_vs_t1"
    ];
    const rows = records.map((r) => [
      r.kernel,
      r.category,
      r.n,
      r.threads,
      r.precision,
      r.elapsed_ms.toFixed(4),
      r.gflops.toFixed(2),
      r.speedup > 0 ? r.speedup.toFixed(2) : ""
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `rayon_gemm_benchmarks_${activePrecision}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // src/tabs.ts
  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
    const targetBtn = Array.from(document.querySelectorAll(".tab-btn")).find((btn) => {
      const attr = btn.getAttribute("onclick");
      return attr && attr.includes(tabId);
    });
    if (targetBtn) targetBtn.classList.add("active");
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add("active");
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      if (targetContent) {
        targetContent.querySelectorAll(".js-plotly-plot").forEach((el) => {
          Plotly.Plots.resize(el);
        });
      }
    }, 40);
  }

  // src/main.ts
  function selectGlobalPrecision(prec) {
    setActivePrecision(prec);
    document.querySelectorAll("#precisionPills .pill-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.prec === prec);
    });
    const badge = document.getElementById("gridActivePrecisionBadge");
    if (badge) {
      badge.textContent = prec === "all" ? "Showing: All Precisions (Default f32 for single-precision views)" : `Showing: ${prec.toUpperCase()} Precision`;
    }
    updateKpisForPrecision(prec);
    renderParallelGrid();
    renderParallelEfficiency();
    renderSerialBaseline();
    renderPeakLandscape();
    renderSchedulerShootout();
    renderMpsGap();
    const tablePrec = document.getElementById("tablePrecFilter");
    if (tablePrec) {
      tablePrec.value = prec;
      renderTable();
    }
  }
  Object.assign(window, {
    switchTab,
    selectGlobalPrecision,
    renderPrecisionThroughputChart,
    renderParallelGrid,
    renderParallelEfficiency,
    renderSerialBaseline,
    renderPeakLandscape,
    renderSchedulerShootout,
    renderMpsGap,
    renderPrecisionComparison,
    renderPrecisionSpeedupChart,
    renderPrecisionEnvelopeChart,
    renderPrecisionSummaryTable,
    sortTableBy,
    toggleSortDirection,
    applyTableSort,
    filterTable,
    exportTableToCSV
  });
  function initDashboard() {
    initTableData();
    renderParallelGrid();
    renderPrecisionComparison();
    renderParallelEfficiency();
    renderSerialBaseline();
    renderPeakLandscape();
    renderSchedulerShootout();
    renderMpsGap();
    updateSortUI();
    renderTable();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
  } else {
    initDashboard();
  }
})();
