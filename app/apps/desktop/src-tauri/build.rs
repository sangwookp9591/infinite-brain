fn main() {
    // llama.cpp's Metal backend (smart search, macOS only) checks OS versions
    // with `@available`. Under the bundle's 10.15 deployment target clang turns
    // those into calls to `___isPlatformVersionAtLeast` from compiler-rt, which
    // rustc does not link (it passes -nodefaultlibs), so the release link failed.
    // Link Xcode's own copy of that runtime; it is a fat archive for both arches.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let dir = std::process::Command::new("xcrun")
            .args(["clang", "--print-resource-dir"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .expect("smart search needs Xcode's clang: run `xcode-select --install`");
        println!("cargo:rustc-link-search=native={dir}/lib/darwin");
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
    tauri_build::build()
}
