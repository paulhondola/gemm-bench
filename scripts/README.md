# Performance Visualization Subproject (`scripts`)

This directory contains the visualization engine for `rayon-gemm`, configured as a standalone Python subproject using `uv`.

## Quick Start with `uv`

### 1. Install / Sync Dependencies
```sh
cd scripts
uv sync
```

### 2. Run the Visualization CLI
From the repository root:
```sh
# Auto-discovers data/f16_full_run.csv, data/f32_full_run.csv, and data/f64_full_run.csv
./scripts/visualize.py --output-dir plots/

# Or specify benchmark input files explicitly
./scripts/visualize.py --input data/f16_full_run.csv data/f32_full_run.csv data/f64_full_run.csv --output-dir plots/

# Open dashboard in browser upon completion
./scripts/visualize.py --open
```

### 3. Run Tests
```sh
cd scripts
uv run pytest
```

### 4. Code Quality & Linting
```sh
cd scripts
uv run ruff check .
uv run ruff format --check .
```
