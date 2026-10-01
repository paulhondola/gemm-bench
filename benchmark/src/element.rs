use std::ops::{Add, AddAssign, Mul};
use std::simd::{Simd, StdFloat};

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

    /// One 128-bit NEON register of this type, the unit the `packed`
    /// kernels compute in.
    type Vector: Lanes<Self>;

    /// Builds an input value from `numerator / denominator`. Integers keep
    /// only the numerator, since the fraction would truncate to zero.
    fn from_ratio(numerator: usize, denominator: usize) -> Self;

    fn to_f64(self) -> f64;
}

/// A SIMD vector of `LANES` elements of `T`. Public because `Element` names
/// it; only the `packed` kernels use it.
pub trait Lanes<T>: Copy {
    const LANES: usize;

    fn splat(value: T) -> Self;

    /// Reads the first `LANES` elements of `slice`.
    fn load(slice: &[T]) -> Self;

    /// Writes the first `LANES` elements of `slice`.
    fn store(self, slice: &mut [T]);

    /// `self * b + acc`, fused (one rounding) for floats.
    fn mul_add(self, b: Self, acc: Self) -> Self;
}

/// `Lanes` for `Simd<$ty, $lanes>`; only the multiply-add differs by type.
macro_rules! impl_lanes {
    ($ty:ty, $lanes:literal, |$a:ident, $b:ident, $acc:ident| $mul_add:expr) => {
        impl Lanes<$ty> for Simd<$ty, $lanes> {
            const LANES: usize = $lanes;

            #[inline]
            fn splat(value: $ty) -> Self {
                Simd::splat(value)
            }

            #[inline]
            fn load(slice: &[$ty]) -> Self {
                Simd::from_slice(slice)
            }

            #[inline]
            fn store(self, slice: &mut [$ty]) {
                self.copy_to_slice(slice);
            }

            #[inline]
            fn mul_add(self, $b: Self, $acc: Self) -> Self {
                let $a = self;
                $mul_add
            }
        }
    };
}

macro_rules! impl_element {
    (float: $($float:ty => $lanes:literal),*) => {
        $(
            impl Element for $float {
                const EPSILON: f64 = <$float>::EPSILON as f64;
                type Vector = Simd<$float, $lanes>;

                fn from_ratio(numerator: usize, denominator: usize) -> Self {
                    (numerator as f64 / denominator as f64) as $float
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }

            impl_lanes!($float, $lanes, |a, b, acc| StdFloat::mul_add(a, b, acc));
        )*
    };
    (int: $($int:ty => $lanes:literal),*) => {
        $(
            impl Element for $int {
                const EPSILON: f64 = 0.0;
                type Vector = Simd<$int, $lanes>;

                // ponytail: no overflow check; benchmark outputs peak at 616·n,
                // far inside i32 for any n that fits in memory.
                fn from_ratio(numerator: usize, _denominator: usize) -> Self {
                    numerator as $int
                }

                fn to_f64(self) -> f64 {
                    self as f64
                }
            }

            // LLVM fuses this into `mla` for i32; NEON has no 64-bit multiply,
            // so i64 multiplies lane by lane in scalar registers.
            impl_lanes!($int, $lanes, |a, b, acc| a * b + acc);
        )*
    };
}

// One 128-bit NEON register each.
impl_element!(float: f16 => 8, f32 => 4, f64 => 2);
impl_element!(int: i32 => 4, i64 => 2);

#[cfg(test)]
mod tests {
    use super::{Element, Lanes};

    /// `Vector` is exactly one 128-bit register, and `mul_add` is lane-wise
    /// `self * b + acc`: 2 · [0, 1, 2, …] + 1 = [1, 3, 5, …].
    fn vector_is_one_register_with_lane_wise_mul_add<T: Element>() {
        let lanes = T::Vector::LANES;
        assert_eq!(lanes * size_of::<T>(), 16);

        let ramp: Vec<T> = (0..lanes).map(|i| T::from_ratio(i, 1)).collect();
        let (one, two) = (T::from_ratio(1, 1), T::from_ratio(2, 1));
        let mut out = vec![T::default(); lanes];
        T::Vector::splat(two)
            .mul_add(T::Vector::load(&ramp), T::Vector::splat(one))
            .store(&mut out);

        let out: Vec<f64> = out.into_iter().map(Element::to_f64).collect();
        let expected: Vec<f64> = (0..lanes).map(|i| (2 * i + 1) as f64).collect();
        assert_eq!(out, expected);
    }

    #[test]
    fn every_element_vector_is_one_register_with_lane_wise_mul_add() {
        vector_is_one_register_with_lane_wise_mul_add::<f16>();
        vector_is_one_register_with_lane_wise_mul_add::<f32>();
        vector_is_one_register_with_lane_wise_mul_add::<f64>();
        vector_is_one_register_with_lane_wise_mul_add::<i32>();
        vector_is_one_register_with_lane_wise_mul_add::<i64>();
    }
}
