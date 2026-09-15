/**
 * Reactive Dashboard State and Data Accessors
 */

import type { PrecisionFilter, SortDirection, SortField, TableRecord } from "./types";

export let activePrecision: PrecisionFilter = "all";

export function setActivePrecision(prec: PrecisionFilter): void {
  activePrecision = prec;
}

export let tableRecords: TableRecord[] = [];

export function setTableRecords(records: TableRecord[]): void {
  tableRecords = records;
}

export let currentSortField: SortField = "gflops";

export function setCurrentSortField(field: SortField): void {
  currentSortField = field;
}

export let currentSortDir: SortDirection = "desc";

export function setCurrentSortDir(dir: SortDirection): void {
  currentSortDir = dir;
}

// Lazy or dynamic dimensions derived from RAW_RECORDS
export function getSizes(): number[] {
  if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
  return [...new Set(RAW_RECORDS.map((r) => r.n))].sort((a, b) => a - b);
}

export function getThreads(): number[] {
  if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
  return [...new Set(RAW_RECORDS.map((r) => r.threads))].sort((a, b) => a - b);
}

export function getPrecisions(): string[] {
  if (typeof RAW_RECORDS === "undefined" || !RAW_RECORDS) return [];
  return [...new Set(RAW_RECORDS.map((r) => r.precision))].sort();
}
