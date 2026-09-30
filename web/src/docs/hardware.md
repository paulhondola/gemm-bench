The published runs come from one machine: a **MacBook Pro 16-inch (2021)** with an **Apple M1 Pro** chip and **16 GB** of unified memory, running macOS 26 or later (the `accelerate-bnns` kernel needs it).

| Part | Details | Source |
| :--- | :--- | :--- |
| CPU | 10 cores: 8 performance (P) cores in two clusters of 4, and 2 efficiency cores | The owner; clusters: [AnandTech](https://www.anandtech.com/show/17024/apple-m1-max-performance-review) |
| P-core clock | 3.228 GHz with one core active; 3.036 GHz with all 4 cores of a cluster busy | [AnandTech](https://www.anandtech.com/show/17024/apple-m1-max-performance-review) |
| P-core SIMD | 4 FMA pipes, each a 128-bit NEON unit: 8 `f16`, 4 `f32` or 2 `f64` lanes | [Dougall Johnson](https://dougallj.github.io/applecpu/firestorm.html) |
| AMX | A matrix coprocessor driven by instructions the CPU issues. Apple doesn't document them; its supported route is the Accelerate library, and it publishes no peak | [corsix/amx](https://github.com/corsix/amx) |
| GPU | 16 cores × 128 ALUs at 1.296 GHz, 256 KB L2; `f16` runs at the `f32` rate | [Philip Turner](https://github.com/philipturner/metal-benchmarks) |
| Memory | 16 GB, shared by the CPU and GPU | The owner |

The table below sets each engine's theoretical peak, from `data/peaks.csv`, against the fastest result in the runs at any size. The 8 P-core peak doesn't count the efficiency cores, so a best result that used 10 threads reads slightly high against it.
