use super::types::{CacheKind, Machine};

impl Machine {
    /// The block printed before a run: what this machine is, and what it
    /// didn't report.
    pub(crate) fn summary(&self) -> String {
        let mut out = format!(
            "Machine\n  OS        {} ({})\n  CPU       {}, {} logical CPUs available\n",
            self.os, self.arch, self.cpu, self.available_parallelism
        );
        if self.tiers.is_empty() {
            out.push_str("    cores not reported\n");
        }
        for tier in &self.tiers {
            let name = tier
                .name
                .as_deref()
                .map_or_else(String::new, |n| format!(" {n}"));
            out.push_str(&format!(
                "    tier {}{name}: {} core{}, {} thread{}\n",
                tier.tier,
                tier.cores,
                plural(tier.cores),
                tier.logical_cpus,
                plural(tier.logical_cpus)
            ));
            self.push_caches(&mut out, "      ", Some(tier.tier));
        }
        if self.caches.is_empty() {
            out.push_str("    caches not reported\n");
        }
        self.push_caches(&mut out, "    all tiers: ", None);
        out.push_str(&match (&self.gpu, self.gpu_cores) {
            (Some(name), Some(cores)) => format!("  GPU       {name}, {cores} cores\n"),
            (Some(name), None) => format!("  GPU       {name}\n"),
            (None, _) => "  GPU       not detected\n".to_owned(),
        });
        out.push_str(&format!("  Features  {}\n", self.target_features));
        out
    }

    /// One line of the caches serving `tier` (`None`: shared across tiers), if any.
    fn push_caches(&self, out: &mut String, prefix: &str, tier: Option<usize>) {
        let caches: Vec<String> = self
            .caches
            .iter()
            .filter(|cache| cache.tier == tier)
            .map(|cache| {
                let kind = match cache.kind {
                    CacheKind::Data => "d",
                    CacheKind::Instruction => "i",
                    CacheKind::Unified => "",
                };
                let shared = if cache.shared_by > 1 {
                    format!(" (shared by {})", cache.shared_by)
                } else {
                    String::new()
                };
                format!(
                    "L{}{kind} {} x{}{shared}",
                    cache.level,
                    byte_size(cache.size_bytes),
                    cache.instances
                )
            })
            .collect();
        if !caches.is_empty() {
            out.push_str(&format!("{prefix}{}\n", caches.join(", ")));
        }
    }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

/// `131072` → `128 KiB`; sizes that aren't a whole KiB stay in bytes.
fn byte_size(bytes: usize) -> String {
    match bytes {
        b if b % (1 << 20) == 0 => format!("{} MiB", b >> 20),
        b if b % (1 << 10) == 0 => format!("{} KiB", b >> 10),
        b => format!("{b} B"),
    }
}
