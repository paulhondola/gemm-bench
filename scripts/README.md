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
# Run CLI directly
./scripts/visualize.py --input data/full_run.csv --output-dir plots/

# Or via uv
uv run --project scripts visualize --input data/full_run.csv --output-dir plots/
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
