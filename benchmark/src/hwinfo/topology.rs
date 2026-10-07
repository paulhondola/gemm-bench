use std::collections::{BTreeMap, HashMap};

use super::types::{Cache, CacheKind};

/// Each distinct cache: (level, kind, the CPUs it serves) → (size, line).
pub(crate) type CacheMap = BTreeMap<(usize, CacheKind, Vec<usize>), (usize, Option<usize>)>;

/// Groups distinct caches into (tier, level, kind, size, sharing) with an
/// instance count. A cache whose CPUs span tiers gets no tier.
pub(crate) fn group_caches(seen: CacheMap, tier_of: &HashMap<usize, usize>) -> Vec<Cache> {
    let mut grouped = BTreeMap::new();
    for ((level, kind, shared), (size, line)) in seen {
        let tier = tier_of
            .get(&shared[0])
            .copied()
            .filter(|&tier| shared.iter().all(|cpu| tier_of.get(cpu) == Some(&tier)));
        grouped
            .entry((tier, level, kind, size, shared.len()))
            .or_insert((line, 0))
            .1 += 1;
    }
    grouped
        .into_iter()
        .map(
            |((tier, level, kind, size_bytes, shared_by), (line_bytes, instances))| Cache {
                tier,
                level,
                kind,
                size_bytes,
                line_bytes,
                shared_by,
                instances,
            },
        )
        .collect()
}
