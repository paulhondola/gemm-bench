//! A kernel's knobs as the benchmark records them: one row of the `params`
//! table per knob, with where its value came from.

/// Where a param's value comes from: the `params.source` column.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Source {
    /// Requested on the command line: a sweep coordinate.
    Swept,
    /// Worked out at run time from n, threads, precision, the host or the GPU.
    Derived,
    /// A compile-time constant of the kernel.
    Fixed,
}

impl Source {
    /// The value stored in `params.source`.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::Swept => "swept",
            Self::Derived => "derived",
            Self::Fixed => "fixed",
        }
    }
}

/// One knob value a kernel actually ran with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Param {
    pub name: &'static str,
    pub value: usize,
    pub source: Source,
}

impl Param {
    #[must_use]
    pub fn swept(name: &'static str, value: usize) -> Self {
        Self {
            name,
            value,
            source: Source::Swept,
        }
    }

    #[must_use]
    pub fn derived(name: &'static str, value: usize) -> Self {
        Self {
            name,
            value,
            source: Source::Derived,
        }
    }

    #[must_use]
    pub fn fixed(name: &'static str, value: usize) -> Self {
        Self {
            name,
            value,
            source: Source::Fixed,
        }
    }
}
