/**
 * Performance Dashboard Application Entry Point
 * ===============================================
 * Bootstraps client-side Plotly charts, reactive precision filters,
 * and attaches public handlers to `window` for HTML compatibility.
 */

import { renderSerialBaseline } from "./charts/baseline";
import { renderParallelEfficiency } from "./charts/efficiency";
import { renderParallelGrid } from "./charts/grid";
import { renderPeakLandscape } from "./charts/landscape";
import { renderMpsGap } from "./charts/mps";
import {
  initPrecisionControls,
  renderPrecisionComparison,
  renderPrecisionEnvelopeChart,
  renderPrecisionSpeedupChart,
  renderPrecisionSummaryTable,
  renderPrecisionThroughputChart,
} from "./charts/precision";
import { renderSchedulerComparison, renderSchedulerShootout } from "./charts/scheduler";
import { updateKpisForPrecision } from "./metrics";
import { activePrecision, setActivePrecision } from "./state";
import {
  applyTableSort,
  exportTableToCSV,
  filterTable,
  getCategory,
  getFilteredTableRecords,
  initTableData,
  renderTable,
  sortTableBy,
  toggleSortDirection,
  updateSortUI,
} from "./table";
import { switchTab } from "./tabs";
import type { PrecisionFilter } from "./types";

// Global Precision Filter Pill Selection
export function selectGlobalPrecision(prec: PrecisionFilter): void {
  setActivePrecision(prec);
  document.querySelectorAll("#precisionPills .pill-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.prec === prec);
  });

  const badge = document.getElementById("gridActivePrecisionBadge");
  if (badge) {
    badge.textContent =
      prec === "all"
        ? "Showing: All Precisions (Default f32 for single-precision views)"
        : `Showing: ${prec.toUpperCase()} Precision`;
  }

  updateKpisForPrecision(prec);

  renderParallelGrid();
  renderParallelEfficiency();
  renderSerialBaseline();
  renderPeakLandscape();
  renderSchedulerShootout();
  renderMpsGap();

  const tablePrec = document.getElementById("tablePrecFilter") as HTMLSelectElement | null;
  if (tablePrec) {
    tablePrec.value = prec;
    renderTable();
  }
}

// Attach public APIs to `window` for inline HTML event bindings
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
  exportTableToCSV,
});

function initDashboard(): void {
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
