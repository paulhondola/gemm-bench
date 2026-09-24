use std::ops::{Add, AddAssign, Mul};

/// A numeric element type the kernels can multiply.
///
/// `Default` supplies zero for clearing outputs and starting sums. `EPSILON`
/// and the conversions let callers build inputs and compare results
/// independently of precision.
pub trait Element:
    Copy + Default + Send + Sync + Add<Output = Self> + Mul<Output = Self> + AddAssign + 'static
{
    /// Machine epsilon of the element type, widened to `f64`. Zero for
    /// integers, whose products are exact in any summation order.
    const EPSILON: f64;

    /// Builds an input value from `numerator / denominator`. Integers keep
    /// only the numerator, since the fraction would truncate to zero.
    fn from_ratio(numerator: usize, denominator: usize) -> Self;

    fn to_f64(self) -> f64;
}

macro_rules! impl_element {
    (float: $($float:ty),*) => {
        $(
            impl Element for $float {
                const EPSILON: f64 = <$float>::EPSILON as f64;

                fn from_ratio(numerator: usize, denominator: usize) -> Self {
                    (numerator as f64 / denominator as f64) as $float
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }
        )*
    };
    (int: $($int:ty),*) => {
        $(
            impl Element for $int {
                const EPSILON: f64 = 0.0;

                // ponytail: no overflow check; benchmark outputs peak at 616·n,
                // far inside i32 for any n that fits in memory.
                fn from_ratio(numerator: usize, _denominator: usize) -> Self {
                    numerator as $int
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }
        )*
    };
}

impl_element!(float: f16, f32, f64);
impl_element!(int: i32, i64);
