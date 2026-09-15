# Performance Visualization Frontend (`frontend`)

This directory contains the modular TypeScript source for the `rayon-gemm` performance visualization dashboard.

## Overview

The frontend source in `src/` is written in TypeScript with full type safety across benchmark records, precision variants, and Plotly chart configurations.

Building the frontend compiles and bundles the TypeScript into an IIFE asset committed to `scripts/viz/templates/dashboard.js`, ensuring that users running `./scripts/visualize.py` have **zero dependencies** on Node or Bun.

## Developer Workflows

### 1. Install Dependencies
```sh
cd frontend
bun install
```

### 2. Typecheck
```sh
bun run typecheck
```

### 3. Build & Bundle
Bundles `src/main.ts` directly into `scripts/viz/templates/dashboard.js` and updates `plots/assets/dashboard.js`:
```sh
bun run build
```

## Structure
- `src/types.ts`: Domain definitions (`BenchmarkRecord`, `Precision`, `KernelName`, etc.)
- `src/constants.ts`: Color schemes, kernel category sets
- `src/state.ts`: Dynamic dashboard state (active precision, table sorting/filtering)
- `src/metrics.ts`: Speedup lookups, KPI stat card derivations
- `src/tabs.ts`: Tab switching and Plotly resize handling
- `src/charts/`: Individual modular Plotly chart renderers
- `src/table.ts`: Interactive benchmark records table and CSV exporter
- `src/main.ts`: Bootstrap and global window binding for HTML backward compatibility
