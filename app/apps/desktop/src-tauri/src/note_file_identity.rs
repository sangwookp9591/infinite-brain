// SPDX-License-Identifier: Apache-2.0

//! A rename retains the filesystem's object identity; a copy does not.
//! Creation time protects against recycling a deleted file's inode/file ID.
//! Unsupported filesystems fail closed rather than falling back to hashes.

use std::path::Path;

#[cfg(unix)]
pub(super) fn identity(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let created = metadata
        .created()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(format!(
        "unix:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        created.as_secs(),
        created.subsec_nanos()
    ))
}

#[cfg(windows)]
pub(super) fn identity(path: &Path) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    // FILE_ID_INFO: the full 128-bit ID also works on ReFS.
    #[repr(C)]
    #[derive(Default)]
    struct Information {
        volume: u64,
        id: [u8; 16],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            handle: *mut std::ffi::c_void,
            class: i32,
            information: *mut std::ffi::c_void,
            size: u32,
        ) -> i32;
    }
    if !std::fs::symlink_metadata(path).ok()?.is_file() {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let created = file
        .metadata()
        .ok()?
        .created()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    let mut info = Information::default();
    // SAFETY: the file owns a live handle and Information matches the Win32 ABI.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            18,
            (&mut info as *mut Information).cast(),
            std::mem::size_of::<Information>() as u32,
        )
    } == 0
        || info.id == [0; 16]
        || created.is_zero()
    {
        return None;
    }
    Some(format!(
        "windows:{}:{:02x?}:{}:{}",
        info.volume,
        info.id,
        created.as_secs(),
        created.subsec_nanos()
    ))
}

#[cfg(not(any(unix, windows)))]
pub(super) fn identity(_: &Path) -> Option<String> {
    None
}
