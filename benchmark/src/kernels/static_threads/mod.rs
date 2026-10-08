mod ikj;
mod tiled;

use std::sync::Mutex;

pub use ikj::StaticIkjGemm;
pub use tiled::StaticTiledGemm;

/// Row counts per worker, as OpenMP's static schedule assigns them: every
/// worker gets `n / threads` rows and the first `n % threads` get one more.
pub(crate) fn static_row_counts(n: usize, threads: usize) -> impl Iterator<Item = usize> {
    (0..threads).map(move |worker| n / threads + usize::from(worker < n % threads))
}

/// The output split up front into one disjoint `(first_row, rows)` chunk per
/// worker, in static_row_counts order. Each mutex is locked by exactly one
/// worker, once per call, so it only hands the `&mut` chunk across threads
/// and never contends.
pub(crate) fn row_chunks<T>(
    mut remaining: &mut [T],
    n: usize,
    threads: usize,
) -> Vec<Mutex<(usize, &mut [T])>> {
    let mut first_row = 0;
    static_row_counts(n, threads)
        .map(|rows| {
            let (chunk, rest) = std::mem::take(&mut remaining).split_at_mut(rows * n);
            remaining = rest;
            let chunk_first_row = first_row;
            first_row += rows;
            Mutex::new((chunk_first_row, chunk))
        })
        .collect()
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
