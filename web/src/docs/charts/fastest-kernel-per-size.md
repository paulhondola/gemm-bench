**What it shows.** For every matrix size, the single fastest kernel at the selected precision, chosen over every kernel, thread count, tile size and depth block. Each cell names the winner and its GOP/s, and is coloured by the winner's family.

**How to read it.** Read it left to right to see where the winner changes. Small matrices tend to favour kernels with little fixed cost per call; large ones, the kernels with the most raw throughput.

**Caveats.** Clicking a family in the legend hides its cells; it doesn't hand those sizes to the runner-up.
