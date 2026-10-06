/// The enabled subset of the features that change how the kernels compile,
/// sorted. Only names rustc knows: an unknown one trips `unexpected_cfgs`.
pub(crate) fn target_features() -> String {
    #[cfg(target_arch = "aarch64")]
    let known = [
        ("bf16", cfg!(target_feature = "bf16")),
        ("dotprod", cfg!(target_feature = "dotprod")),
        ("fp16", cfg!(target_feature = "fp16")),
        ("i8mm", cfg!(target_feature = "i8mm")),
        ("neon", cfg!(target_feature = "neon")),
        ("sme", cfg!(target_feature = "sme")),
        ("sve", cfg!(target_feature = "sve")),
        ("sve2", cfg!(target_feature = "sve2")),
    ];
    #[cfg(target_arch = "x86_64")]
    let known = [
        ("avx", cfg!(target_feature = "avx")),
        ("avx2", cfg!(target_feature = "avx2")),
        ("avx512f", cfg!(target_feature = "avx512f")),
        ("avx512fp16", cfg!(target_feature = "avx512fp16")),
        ("f16c", cfg!(target_feature = "f16c")),
        ("fma", cfg!(target_feature = "fma")),
        ("sse4.2", cfg!(target_feature = "sse4.2")),
    ];
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    let known: [(&str, bool); 0] = [];
    known
        .iter()
        .filter(|&&(_, enabled)| enabled)
        .map(|&(name, _)| name)
        .collect::<Vec<_>>()
        .join(" ")
}
