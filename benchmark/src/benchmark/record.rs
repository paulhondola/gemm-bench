use gemm_bench::kernels::Param;

/// One measured configuration, shared by the terminal table and the DB writer.
#[derive(Debug)]
pub(crate) struct BenchmarkRecord {
    pub(crate) kernel: String,
    pub(crate) backend: &'static str,
    pub(crate) precision: &'static str,
    pub(crate) n: usize,
    pub(crate) threads: usize,
    pub(crate) gops: f64,
    pub(crate) mean_rel_error_f64: f64,
    pub(crate) median_ms: f64,
    pub(crate) min_ms: f64,
    pub(crate) stddev_ms: f64,
    /// Median GPU execution (the command buffer's `GPUStartTime` →
    /// `GPUEndTime`) inside the round trip that `median_ms` times. `None` off Metal.
    pub(crate) gpu_ms: Option<f64>,
    /// One-time cost of building the kernel for this configuration, one sample.
    pub(crate) setup_ms: f64,
    /// The knob values the kernel ran with: the terminal table shows the swept one, the DB writer stores them all.
    pub(crate) params: Vec<Param>,
}
