/**
 * 8. Interactive Sortable Data Table & CSV Export
 */

import { ACCELERATED_KERNELS, PARALLEL_KERNELS } from "./constants";
import { getSpeedup } from "./metrics";
import {
  activePrecision,
  currentSortDir,
  currentSortField,
  setCurrentSortDir,
  setCurrentSortField,
  setTableRecords,
  tableRecords,
} from "./state";
import type { KernelCategory, SortField, TableRecord } from "./types";

export function getCategory(kernel: string): KernelCategory {
  if (PARALLEL_KERNELS.has(kernel)) return "parallel";
  if (ACCELERATED_KERNELS.has(kernel)) return "mps";
  return "serial";
}

export function initTableData(): void {
  if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return;

  const records: TableRecord[] = RAW_RECORDS.map((r) => {
    const sp = getSpeedup(r.kernel, r.n, r.threads, r.precision);
    return {
      ...r,
      category: getCategory(r.kernel),
      speedup: sp !== null ? sp : 0,
    };
  });
  setTableRecords(records);
}

export function sortTableBy(field: SortField): void {
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

export function toggleSortDirection(): void {
  setCurrentSortDir(currentSortDir === "asc" ? "desc" : "asc");
  updateSortUI();
  renderTable();
}

export function applyTableSort(): void {
  const select = document.getElementById("sortField") as HTMLSelectElement | null;
  if (select) {
    const field = select.value as SortField;
    setCurrentSortField(field);
    const isText = field === "kernel" || field === "category" || field === "precision";
    setCurrentSortDir(isText ? "asc" : "desc");
    updateSortUI();
    renderTable();
  }
}

export function updateSortUI(): void {
  const select = document.getElementById("sortField") as HTMLSelectElement | null;
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

export function getFilteredTableRecords(): TableRecord[] {
  const searchInput = document.getElementById("tableSearch") as HTMLInputElement | null;
  const precFilterEl = document.getElementById("tablePrecFilter") as HTMLSelectElement | null;
  const catFilterEl = document.getElementById("tableCatFilter") as HTMLSelectElement | null;

  const query = (searchInput?.value || "").toLowerCase().trim();
  const precFilter = precFilterEl?.value || "all";
  const catFilter = catFilterEl?.value || "all";

  return tableRecords.filter((r) => {
    if (precFilter !== "all" && r.precision !== precFilter) return false;
    if (catFilter !== "all" && r.category !== catFilter) return false;
    if (query) {
      const rowText =
        `${r.kernel} ${r.category} ${r.n} ${r.threads} ${r.precision} ${r.elapsed_ms} ${r.gflops}`.toLowerCase();
      if (!rowText.includes(query)) return false;
    }
    return true;
  });
}

export function renderTable(): void {
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

export function filterTable(): void {
  renderTable();
}

export function exportTableToCSV(): void {
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
    "speedup_vs_t1",
  ];
  const rows = records.map((r) => [
    r.kernel,
    r.category,
    r.n,
    r.threads,
    r.precision,
    r.elapsed_ms.toFixed(4),
    r.gflops.toFixed(2),
    r.speedup > 0 ? r.speedup.toFixed(2) : "",
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
