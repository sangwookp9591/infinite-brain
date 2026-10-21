// SPDX-License-Identifier: Apache-2.0
fn main() {
    println!("cargo:rustc-link-search=native={}/build", std::env::var("CARGO_MANIFEST_DIR").unwrap());
    println!("cargo:rustc-link-lib=static=ib_zig");
    println!("cargo:rustc-link-lib=framework=Metal");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rerun-if-changed=build/libib_zig.a");
}
