**What it shows.** For the kernel chosen with the kernel pill, at the selected tile size and depth block, speedup divided by thread count, as a percentage, at every matrix size at once: one line per size, from light (small N) to dark (large N).

**How to read it.** 100% means every added thread paid for itself in full; 50% means the threads bought half of what they could. Efficiency usually falls as threads are added, and fastest for the smallest matrices, where each thread's share of the work is too small to outweigh the cost of coordinating them.

**Caveats.** Speedup is measured against the same kernel on one thread at the same size, so a size without a one-thread run isn't drawn. Every size is plotted, so the N pill doesn't apply here. A result above 100% is possible — splitting the rows can make each thread's share fit in cache — and the axis extends to show it rather than cutting it off.
