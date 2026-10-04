//! Windows: `ver`, the registry and `GetLogicalProcessorInformationEx`. Only
//! the four lookups and the Win32 call are Windows-only; the parsers compile
//! everywhere, so their tests run on every platform.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap},
};

use super::{Cache, CacheKind, CacheMap, CoreTier, group_caches};
#[cfg(target_os = "windows")]
use crate::context::command_output;

#[cfg(target_os = "windows")]
pub(super) fn os() -> Option<String> {
    command_output("cmd", &["/C", "ver"]).and_then(|text| parse_ver(&text))
}

#[cfg(target_os = "windows")]
pub(super) fn cpu() -> Option<String> {
    command_output(
        "reg",
        &[
            "query",
            r"HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            "/v",
            "ProcessorNameString",
        ],
    )
    .and_then(|text| parse_reg_cpu_name(&text))
}

/// The first display adapter in `(Get-CimInstance Win32_VideoController).Name`, which
/// prints one name per line. CIM lists only adapters that are present; the
/// registry's display class also keeps removed ones.
#[cfg(target_os = "windows")]
pub(super) fn gpu() -> Option<(String, Option<usize>)> {
    // Windows PowerShell's fixed install path first, since some hosts have it
    // off PATH; then whatever PATH offers.
    let installed = std::env::var("SystemRoot")
        .map(|root| format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe"))
        .unwrap_or_default();
    [installed.as_str(), "powershell", "pwsh"]
        .into_iter()
        .filter(|program| !program.is_empty())
        .find_map(|program| {
            command_output(
                program,
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "(Get-CimInstance Win32_VideoController).Name",
                ],
            )
        })
        .and_then(|text| parse_cim_gpu(&text))
        .map(|name| (name, None))
}

#[cfg(target_os = "windows")]
pub(super) fn topology() -> (Vec<CoreTier>, Vec<Cache>) {
    processor_information()
        .map(|buffer| windows_topology(&buffer))
        .unwrap_or_default()
}

/// `GetLogicalProcessorInformationEx(RelationAll)`'s buffer: asked once for
/// the length it needs, then filled.
#[cfg(target_os = "windows")]
fn processor_information() -> Option<Vec<u8>> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalProcessorInformationEx(
            relationship: u32,
            buffer: *mut u8,
            length: *mut u32,
        ) -> i32;
    }
    const RELATION_ALL: u32 = 0xffff;
    let mut length = 0u32;
    // SAFETY: a null buffer with length 0 only reports the length needed.
    unsafe { GetLogicalProcessorInformationEx(RELATION_ALL, std::ptr::null_mut(), &mut length) };
    let mut buffer = vec![0u8; usize::try_from(length).ok()?];
    // SAFETY: `buffer` holds `length` writable bytes, and the call writes at most that many.
    let filled =
        unsafe { GetLogicalProcessorInformationEx(RELATION_ALL, buffer.as_mut_ptr(), &mut length) };
    (filled != 0).then_some(buffer)
}

/// `ver`'s `Microsoft Windows [Version 10.0.22631.4317]` → `Windows
/// 10.0.22631.4317`. Windows 11 still reports 10.0: its builds start at 22000.
fn parse_ver(ver: &str) -> Option<String> {
    let (_, bracketed) = ver.split_once('[')?;
    let (inside, _) = bracketed.split_once(']')?;
    inside
        .split_whitespace()
        .last()
        .map(|build| format!("Windows {build}"))
}

/// `reg query`'s `ProcessorNameString    REG_SZ    <name>` line, unless blank.
/// Intel pads the name with trailing spaces.
fn parse_reg_cpu_name(reg: &str) -> Option<String> {
    reg.lines()
        .find_map(|line| {
            line.trim_start()
                .strip_prefix("ProcessorNameString")?
                .trim_start()
                .strip_prefix("REG_SZ")
        })
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

/// The first adapter in `(Get-CimInstance Win32_VideoController).Name`, which
/// prints one name per line. CIM lists only adapters that are present; the
/// registry's display class also keeps removed ones.
fn parse_cim_gpu(names: &str) -> Option<String> {
    names
        .lines()
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_owned)
}

/// `N` bytes at `at`, or `None` past the end.
fn bytes_at<const N: usize>(record: &[u8], at: usize) -> Option<[u8; N]> {
    record.get(at..)?.first_chunk().copied()
}

/// The logical CPUs in the `GROUP_AFFINITY` at `at`: bit i of its mask is
/// CPU i of its processor group, 64 to a group.
fn group_cpus(record: &[u8], at: usize) -> Option<Vec<usize>> {
    let mask = u64::from_le_bytes(bytes_at(record, at)?);
    let group = usize::from(u16::from_le_bytes(bytes_at(record, at + 8)?));
    let cpus: Vec<usize> = (0..64)
        .filter(|&bit| (mask >> bit) & 1 == 1)
        .map(|bit| group * 64 + bit)
        .collect();
    (!cpus.is_empty()).then_some(cpus)
}

/// Core tiers and caches from `GetLogicalProcessorInformationEx(RelationAll)`:
/// back-to-back `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` records, read at
/// their x64 offsets. A core record is one physical core, its SMT siblings in
/// its mask; a higher `EfficiencyClass` is a faster core. Windows names no
/// tiers, so `name` stays `None`.
// ponytail: reads only each record's first GROUP_AFFINITY, so a cache or core
// spanning processor groups (over 64 logical CPUs) loses the rest; read all
// GroupCount masks if such a host shows up.
fn windows_topology(buffer: &[u8]) -> (Vec<CoreTier>, Vec<Cache>) {
    const RELATION_PROCESSOR_CORE: u32 = 0;
    const RELATION_CACHE: u32 = 2;
    // (efficiency class, logical CPUs) per physical core.
    let mut cores: Vec<(u8, Vec<usize>)> = Vec::new();
    let mut seen = CacheMap::new();
    let mut rest = buffer;
    while let Some(size) = bytes_at(rest, 4).map(u32::from_le_bytes) {
        let size = size as usize;
        let Some(record) = rest.get(..size).filter(|_| size >= 8) else {
            break;
        };
        rest = &rest[size..];
        match bytes_at(record, 0).map(u32::from_le_bytes) {
            Some(RELATION_PROCESSOR_CORE) => {
                if let (Some([class]), Some(cpus)) = (bytes_at(record, 9), group_cpus(record, 32)) {
                    cores.push((class, cpus));
                }
            }
            Some(RELATION_CACHE) => {
                let kind = match bytes_at(record, 16).map(u32::from_le_bytes) {
                    Some(0) => CacheKind::Unified,
                    Some(1) => CacheKind::Instruction,
                    Some(2) => CacheKind::Data,
                    _ => continue, // a trace cache
                };
                if let (Some([level]), Some(line), Some(size), Some(cpus)) = (
                    bytes_at(record, 8),
                    bytes_at(record, 10).map(u16::from_le_bytes),
                    bytes_at(record, 12).map(u32::from_le_bytes),
                    group_cpus(record, 40),
                ) && (1..=4).contains(&level)
                    && size > 0
                {
                    seen.insert(
                        (usize::from(level), kind, cpus),
                        (size as usize, (line > 0).then_some(usize::from(line))),
                    );
                }
            }
            _ => {}
        }
    }

    // Fastest first: a higher efficiency class is a faster core.
    let mut by_class: BTreeMap<Reverse<u8>, (usize, Vec<usize>)> = BTreeMap::new();
    for (class, cpus) in cores {
        let (count, logical) = by_class.entry(Reverse(class)).or_default();
        *count += 1;
        logical.extend(cpus);
    }
    let tier_of: HashMap<usize, usize> = by_class
        .values()
        .enumerate()
        .flat_map(|(tier, (_, cpus))| cpus.iter().map(move |&cpu| (cpu, tier)))
        .collect();
    let tiers = by_class
        .into_values()
        .enumerate()
        .map(|(tier, (core_count, cpus))| CoreTier {
            tier,
            name: None,
            cores: core_count,
            logical_cpus: cpus.len(),
        })
        .collect();
    (tiers, group_caches(seen, &tier_of))
}

#[cfg(test)]
mod tests {
    use super::{
        Cache, CacheKind, CoreTier, parse_cim_gpu, parse_reg_cpu_name, parse_ver, windows_topology,
    };

    /// `ver` is localized ("[Version …]", "[version …]"), so only the build counts.
    #[test]
    fn ver_names_the_build_in_any_locale() {
        assert_eq!(
            parse_ver("Microsoft Windows [Version 10.0.22631.4317]").as_deref(),
            Some("Windows 10.0.22631.4317")
        );
        assert_eq!(
            parse_ver("Microsoft Windows [version 10.0.26100.2033]").as_deref(),
            Some("Windows 10.0.26100.2033")
        );
        assert_eq!(parse_ver("Microsoft Windows"), None);
    }

    #[test]
    fn reg_names_the_cpu() {
        let reg = "\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0\r\n    ProcessorNameString    REG_SZ    AMD Ryzen 5 7535HS with Radeon Graphics        \r\n";
        assert_eq!(
            parse_reg_cpu_name(reg).as_deref(),
            Some("AMD Ryzen 5 7535HS with Radeon Graphics")
        );
        assert_eq!(
            parse_reg_cpu_name("    ProcessorNameString    REG_SZ    \r\n"),
            None
        );
        assert_eq!(
            parse_reg_cpu_name(
                "ERROR: The system was unable to find the specified registry key or value."
            ),
            None
        );
    }

    /// `PROCESSOR_CACHE_TYPE` values.
    const UNIFIED: u32 = 0;
    const INSTRUCTION: u32 = 1;
    const DATA: u32 = 2;

    /// A `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` record for a core
    /// (relationship 0) or package (3), x64 layout: EfficiencyClass at 9,
    /// GroupCount at 30, GroupMask at 32.
    fn processor_record(relationship: u32, class: u8, mask: u64) -> Vec<u8> {
        let mut record = vec![0; 48];
        record[0..4].copy_from_slice(&relationship.to_le_bytes());
        record[4..8].copy_from_slice(&48u32.to_le_bytes());
        record[9] = class;
        record[30..32].copy_from_slice(&1u16.to_le_bytes());
        record[32..40].copy_from_slice(&mask.to_le_bytes());
        record
    }

    /// A cache record (relationship 2), x64 layout: Level at 8, LineSize at
    /// 10, CacheSize at 12, Type at 16, GroupCount at 38, GroupMask at 40.
    fn cache_record(level: u8, kind: u32, size: u32, mask: u64) -> Vec<u8> {
        let mut record = vec![0; 56];
        record[0..4].copy_from_slice(&2u32.to_le_bytes());
        record[4..8].copy_from_slice(&56u32.to_le_bytes());
        record[8] = level;
        record[10..12].copy_from_slice(&64u16.to_le_bytes());
        record[12..16].copy_from_slice(&size.to_le_bytes());
        record[16..20].copy_from_slice(&kind.to_le_bytes());
        record[38..40].copy_from_slice(&1u16.to_le_bytes());
        record[40..48].copy_from_slice(&mask.to_le_bytes());
        record
    }

    /// A cache with the fixtures' 64-byte lines.
    fn cache64(
        tier: Option<usize>,
        level: usize,
        kind: CacheKind,
        size_bytes: usize,
        shared_by: usize,
        instances: usize,
    ) -> Cache {
        Cache {
            tier,
            level,
            kind,
            size_bytes,
            line_bytes: Some(64),
            shared_by,
            instances,
        }
    }

    /// The contributor's Ryzen 5 7535HS: six SMT cores, each with its own
    /// L1d, L1i and L2, under one L3. The package record must be ignored.
    #[test]
    fn ryzen_has_one_tier_and_per_core_l1_and_l2() {
        let mut buffer = Vec::new();
        for core in 0..6 {
            let pair = 0b11u64 << (2 * core);
            buffer.extend(processor_record(0, 0, pair));
            buffer.extend(cache_record(1, DATA, 32 << 10, pair));
            buffer.extend(cache_record(1, INSTRUCTION, 32 << 10, pair));
            buffer.extend(cache_record(2, UNIFIED, 512 << 10, pair));
        }
        buffer.extend(cache_record(3, UNIFIED, 16 << 20, 0xFFF));
        buffer.extend(processor_record(3, 0, 0xFFF));
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(
            tiers,
            [CoreTier {
                tier: 0,
                name: None,
                cores: 6,
                logical_cpus: 12
            }]
        );
        assert_eq!(
            caches,
            [
                cache64(Some(0), 1, CacheKind::Data, 32 << 10, 2, 6),
                cache64(Some(0), 1, CacheKind::Instruction, 32 << 10, 2, 6),
                cache64(Some(0), 2, CacheKind::Unified, 512 << 10, 2, 6),
                cache64(Some(0), 3, CacheKind::Unified, 16 << 20, 12, 1),
            ]
        );
    }

    /// Two SMT P-cores (class 1, CPUs 0-3) and four E-cores (class 0, CPUs
    /// 4-7) sharing one L2, under an L3 across all eight.
    #[test]
    fn hybrid_puts_the_higher_efficiency_class_first() {
        let mut buffer = Vec::new();
        buffer.extend(processor_record(0, 1, 0b0011));
        buffer.extend(processor_record(0, 1, 0b1100));
        for e in 4..8 {
            buffer.extend(processor_record(0, 0, 1 << e));
        }
        buffer.extend(cache_record(2, UNIFIED, 4 << 20, 0xF0));
        buffer.extend(cache_record(3, UNIFIED, 24 << 20, 0xFF));
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(
            tiers,
            [
                CoreTier {
                    tier: 0,
                    name: None,
                    cores: 2,
                    logical_cpus: 4
                },
                CoreTier {
                    tier: 1,
                    name: None,
                    cores: 4,
                    logical_cpus: 4
                },
            ]
        );
        assert_eq!(
            caches,
            [
                cache64(None, 3, CacheKind::Unified, 24 << 20, 8, 1),
                cache64(Some(1), 2, CacheKind::Unified, 4 << 20, 4, 1),
            ]
        );
    }

    /// A record cut off by the buffer's end is dropped, and a size below the
    /// 8-byte header stops the walk instead of looping on it.
    #[test]
    fn a_cut_off_buffer_keeps_only_whole_records() {
        let mut buffer = processor_record(0, 0, 0b11);
        buffer.extend(&cache_record(1, DATA, 32 << 10, 0b11)[..20]);
        let (tiers, caches) = windows_topology(&buffer);
        assert_eq!(tiers.len(), 1);
        assert!(caches.is_empty());
        assert_eq!(windows_topology(&[0; 8]), (Vec::new(), Vec::new()));
    }

    /// One name per line, in WMI order; the first is the primary adapter.
    #[test]
    fn cim_names_the_first_adapter() {
        assert_eq!(
            parse_cim_gpu("AMD Radeon(TM) Graphics").as_deref(),
            Some("AMD Radeon(TM) Graphics")
        );
        assert_eq!(
            parse_cim_gpu("\r\nAMD Radeon(TM) Graphics\r\nNVIDIA GeForce RTX 4060 Laptop GPU\r\n")
                .as_deref(),
            Some("AMD Radeon(TM) Graphics")
        );
        assert_eq!(parse_cim_gpu(" \r\n"), None);
    }
}
