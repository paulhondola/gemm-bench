use std::sync::Mutex;

use rayon::{ThreadPool, ThreadPoolBuildError, ThreadPoolBuilder};

use crate::Matrix;

use super::{Element, GemmKernel, assert_gemm_dimensions, ikj_rows};

/// Fixed, contiguous row chunks on a persistent thread pool.
///
/// This is the Rust counterpart to OpenMP's `schedule(static)`: worker `p`
/// always receives the same consecutive range of rows, with no work stealing.
/// The pool is built once in [`StaticIkjGemm::new`], so thread creation stays
/// outside the timed `compute` call, matching the Rayon kernels.
pub struct StaticIkjGemm {
    pool: ThreadPool,
}

impl StaticIkjGemm {
    pub fn new(threads: usize) -> Result<Self, ThreadPoolBuildError> {
        assert!(threads > 0, "thread count must be greater than zero");
        let pool = ThreadPoolBuilder::new().num_threads(threads).build()?;
        Ok(Self { pool })
    }
}

/// Row counts per worker, as OpenMP's static schedule assigns them: every
/// worker gets `n / threads` rows and the first `n % threads` get one more.
fn static_row_counts(n: usize, threads: usize) -> impl Iterator<Item = usize> {
    (0..threads).map(move |worker| n / threads + usize::from(worker < n % threads))
}

impl<T: Element> GemmKernel<T> for StaticIkjGemm {
    fn name(&self) -> &'static str {
        "static-ikj"
    }

    fn compute(&self, lhs: &Matrix<T>, rhs: &Matrix<T>, output: &mut Matrix<T>) {
        assert_gemm_dimensions(lhs, rhs, output);
        let n = lhs.cols();
        let threads = self.pool.current_num_threads();
        assert!(
            threads <= n,
            "static-ikj needs at least one row per thread: {threads} threads for {n} rows"
        );
        output.as_mut_slice().fill(T::default());

        // Split the output into one disjoint chunk per worker up front. Each
        // mutex is locked by exactly one worker, once per call, so it only
        // hands the `&mut` chunk across threads and never contends.
        let mut remaining = output.as_mut_slice();
        let mut first_row = 0;
        let chunks: Vec<Mutex<(usize, &mut [T])>> = static_row_counts(n, threads)
            .map(|rows| {
                let (chunk, rest) = std::mem::take(&mut remaining).split_at_mut(rows * n);
                remaining = rest;
                let chunk_first_row = first_row;
                first_row += rows;
                Mutex::new((chunk_first_row, chunk))
            })
            .collect();

        let (lhs_data, rhs_data) = (lhs.as_slice(), rhs.as_slice());
        self.pool.broadcast(|context| {
            let mut chunk = chunks[context.index()]
                .lock()
                .expect("each chunk is locked by exactly one worker");
            let (first_row, rows) = &mut *chunk;
            ikj_rows(lhs_data, rhs_data, rows, *first_row, n);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::static_row_counts;

    #[test]
    fn static_schedule_uses_every_thread_with_balanced_rows() {
        assert_eq!(
            static_row_counts(64, 10).collect::<Vec<_>>(),
            [7, 7, 7, 7, 6, 6, 6, 6, 6, 6]
        );
        assert_eq!(static_row_counts(64, 12).count(), 12);
        assert_eq!(static_row_counts(7, 7).collect::<Vec<_>>(), [1; 7]);
    }
}
