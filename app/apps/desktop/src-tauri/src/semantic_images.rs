// SPDX-License-Identifier: Apache-2.0
//! Derived, vault-confined image vectors and note references.
use super::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
    time::UNIX_EPOCH,
};

pub(super) const VERSION: &str = "embeddinggemma-2@031f0d4/Q8_0/mmproj-Q8@90e7b023/llama.cpp-v0.7.0/mixed-mean/ctx2048/image0.25.10/triangle/rgb1024-white/gif0/pixels24m/bytes32m/d768";
const MAX_BYTES: u64 = 32_000_000;
const MAX_PIXELS: u64 = 24_000_000;

fn is_image(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif"))
}

fn references(body: &str) -> Vec<String> {
    static WIKI: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"!\[\[([^\]\r\n]+)\]\]").unwrap());
    static MD: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"!\[[^\]\r\n]*\]\(").unwrap());
    let mut out: Vec<String> =
        WIKI.captures_iter(body).map(|c| c[1].split('|').next().unwrap_or("").to_string()).collect();
    for m in MD.find_iter(body) {
        let tail = body[m.end()..].trim_start();
        if let Some(angled) = tail.strip_prefix('<') {
            if let Some(end) = angled.find('>') {
                out.push(angled[..end].to_string());
            }
            continue;
        }
        let mut path = String::new();
        let mut depth = 1;
        let mut escaped = false;
        for ch in tail.chars() {
            if escaped {
                path.push(ch);
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '(' {
                depth += 1;
            }
            if ch == ')' {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            if ch.is_whitespace() && depth == 1 {
                break;
            }
            path.push(ch);
        }
        if !path.is_empty() {
            out.push(path);
        }
    }
    out
}

fn unescape(raw: &str) -> Option<String> {
    let mut out = Vec::new();
    let mut bytes = raw.split('#').next()?.trim().as_bytes().iter().copied();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let a = (bytes.next()? as char).to_digit(16)?;
            let b = (bytes.next()? as char).to_digit(16)?;
            out.push((a * 16 + b) as u8);
        } else {
            out.push(b);
        }
    }
    String::from_utf8(out).ok()
}

fn resolve(root: &Path, note: &str, raw: &str, files: &[String]) -> Option<String> {
    let raw = unescape(raw)?.replace('\\', "/");
    if raw.is_empty() || raw.contains(':') || raw.starts_with("//") || raw.contains('\0') {
        return None;
    }
    if raw.split('/').any(|s| s.eq_ignore_ascii_case(".context")) {
        return None;
    }
    let note_dir = Path::new(note).parent().unwrap_or(Path::new(""));
    let relative = raw.trim_start_matches('/');
    let mut choices = if raw.starts_with('/') {
        vec![root.join(relative)]
    } else {
        vec![root.join(note_dir).join(relative), root.join(relative)]
    };
    if !relative.contains('/') {
        let matches: Vec<_> = files
            .iter()
            .filter(|p| {
                Path::new(p).file_name().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(relative))
            })
            .collect();
        if matches.len() == 1 {
            choices.push(root.join(matches[0]));
        }
    }
    for choice in choices {
        let Ok(path) = choice.canonicalize() else { continue };
        let Ok(rel) = path.strip_prefix(root) else { continue };
        if rel.components().any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".context")) {
            continue;
        }
        let rel = rel.to_str()?.replace('\\', "/");
        if path.is_file() && is_image(&rel) {
            // macOS realpath preserves the caller's casing; keep the index's spelling.
            return Some(files.iter().find(|p| p.to_lowercase() == rel.to_lowercase()).cloned().unwrap_or(rel));
        }
    }
    None
}

fn stamp(path: &Path) -> AppResult<String> {
    let meta = std::fs::metadata(path)?;
    Ok(format!("{}:{}", meta.len(), meta.modified()?.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()))
}

pub(super) fn decode(bytes: &[u8]) -> AppResult<image::RgbImage> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::new("image exceeds 32 MB"));
    }
    let reader =
        image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| AppError::new(e.to_string()))?;
    let (width, height) = reader.into_dimensions().map_err(|e| AppError::new(e.to_string()))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(AppError::new("image exceeds 24 million pixels"));
    }
    let mut reader =
        image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| AppError::new(e.to_string()))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128_000_000);
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    reader.limits(limits);
    // ImageReader decodes the first GIF frame; animated frames never enter the model.
    let image = reader.decode().map_err(|e| AppError::new(e.to_string()))?;
    let image = if width > 1024 || height > 1024 {
        image.resize(1024, 1024, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let rgba = image.to_rgba8();
    Ok(image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y).0;
        image::Rgb([0, 1, 2].map(|i| ((u32::from(p[i]) * u32::from(p[3]) + 255 * (255 - u32::from(p[3]))) / 255) as u8))
    }))
}

pub(super) fn clear(ix: &Index) -> AppResult<()> {
    ix.conn().execute("DELETE FROM image_vectors", [])?;
    ix.conn().execute("DELETE FROM image_notes", [])?;
    Ok(())
}

pub(super) fn prune(ix: &Index, keep: bool) -> AppResult<usize> {
    if !keep {
        let count = ix.conn().execute("DELETE FROM image_vectors", [])?;
        ix.conn().execute("DELETE FROM image_notes", [])?;
        return Ok(count);
    }
    let mut count = ix.conn().execute("DELETE FROM image_notes WHERE note_id NOT IN (SELECT id FROM notes)", [])?;
    count += ix.conn().execute("DELETE FROM image_vectors WHERE version <> ?1 OR (path NOT IN (SELECT path FROM files) AND path NOT IN (SELECT path FROM image_notes))", [VERSION])?;
    Ok(count)
}

pub(super) fn progress(ix: &Index) -> AppResult<(u64, u64)> {
    let total = ix.conn().query_row("SELECT COUNT(*) FROM (SELECT path FROM files WHERE lower(ext) IN ('png','jpg','jpeg','webp','gif') UNION SELECT path FROM image_notes)", [], |r| r.get(0))?;
    let done = ix.conn().query_row("SELECT COUNT(*) FROM image_vectors WHERE version = ?1", [VERSION], |r| r.get(0))?;
    Ok((done, total))
}

pub(super) fn reconcile(index: &Arc<Mutex<Index>>, model: &Path, projector: &Path) -> AppResult<bool> {
    let (root, files, notes, prior, old_refs) = {
        let ix = index.lock().unwrap();
        let root = ix
            .db_path()
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| AppError::new("image index has no vault root"))?
            .canonicalize()?;
        let files = ix
            .conn()
            .prepare("SELECT path FROM files WHERE lower(ext) IN ('png','jpg','jpeg','webp','gif')")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let notes = ix
            .conn()
            .prepare("SELECT n.id, n.path, COALESCE(f.body,'') FROM notes n LEFT JOIN notes_fts f ON f.rowid=n.rowid")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let prior = ix
            .conn()
            .prepare("SELECT path, stamp FROM image_vectors WHERE version=?1")?
            .query_map([VERSION], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let old_refs = ix
            .conn()
            .prepare("SELECT path, note_id FROM image_notes")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<BTreeSet<_>, _>>()?;
        (root, files, notes, prior, old_refs)
    };
    let mut paths = BTreeSet::new();
    for file in &files {
        if let Some(path) = resolve(&root, "", file, &[]) {
            paths.insert(path);
        }
    }
    let mut refs = BTreeSet::new();
    for (id, path, body) in notes {
        for raw in references(&body) {
            if let Some(image) = resolve(&root, &path, &raw, &files) {
                paths.insert(image.clone());
                refs.insert((image, id.clone()));
            }
        }
    }
    let mut changed = refs != old_refs || prior.keys().any(|p| !paths.contains(p));
    {
        let ix = index.lock().unwrap();
        let tx = ix.conn().unchecked_transaction()?;
        if !engine::images_accepting() { return Ok(false); }
        if refs != old_refs {
            tx.execute("DELETE FROM image_notes", [])?;
            for (path, id) in &refs {
                tx.execute(
                    "INSERT OR IGNORE INTO image_notes(path,note_id) SELECT ?1,id FROM notes WHERE id=?2",
                    rusqlite::params![path, id],
                )?;
            }
        }
        for path in prior.keys().filter(|p| !paths.contains(*p)) {
            tx.execute("DELETE FROM image_vectors WHERE path=?1", [path])?;
        }
        tx.commit()?;
    }
    let mut processed = 0;
    for path in paths {
        let abs = root.join(&path);
        let Ok(current) = stamp(&abs) else { continue };
        if prior.get(&path) == Some(&current) {
            continue;
        }
        if processed >= BATCH_NOTES {
            break;
        }
        processed += 1;
        let decoded = (|| -> AppResult<(String, image::RgbImage)> {
            if std::fs::metadata(&abs)?.len() > MAX_BYTES {
                return Err(AppError::new("image exceeds 32 MB"));
            }
            // Take at most the cap plus one even if a file grows between metadata and read.
            use std::io::Read;
            let mut bytes = Vec::new();
            std::fs::File::open(&abs)?.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
            let pixels = decode(&bytes)?;
            Ok((format!("{:x}", Sha256::digest(&bytes)), pixels))
        })();
        let (sha, vector) = match decoded {
            Ok((sha, pixels)) => (sha, engine::embed_image(model, projector, pixels)?),
            Err(_) => (String::new(), Vec::new()),
        };
        if stamp(&abs).ok().as_deref() != Some(current.as_str()) {
            continue;
        }
        let ix = index.lock().unwrap();
        if !engine::images_accepting() { break; }
        ix.conn().execute("INSERT INTO image_vectors(path,stamp,sha256,version,vec) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(path) DO UPDATE SET stamp=excluded.stamp,sha256=excluded.sha256,version=excluded.version,vec=excluded.vec",
            rusqlite::params![path,current,sha,VERSION,to_blob(&vector)])?;
        changed = true;
    }
    if changed {
        invalidate_cache();
    }
    if processed < BATCH_NOTES {
        engine::unload_images();
    }
    Ok(changed)
}

pub(super) fn result(ix: &Index, path: &str) -> AppResult<Option<SearchResult>> {
    let db = ix.db_path();
    let Some(root) = db.parent().and_then(Path::parent) else { return Ok(None) };
    let Ok(root) = root.canonicalize() else { return Ok(None) };
    if resolve(&root, "", path, &[]).as_deref() != Some(path) {
        return Ok(None);
    }
    let note: Option<(String,String)> = ix.conn().query_row(
        "SELECT n.path,COALESCE(n.title,'') FROM image_notes r JOIN notes n ON n.id=r.note_id WHERE r.path=?1 ORDER BY n.path LIMIT 1",
        [path], |r| Ok((r.get(0)?,r.get(1)?))).ok();
    let id: String = ix
        .conn()
        .query_row("SELECT id FROM files WHERE path=?1", [path], |r| r.get(0))
        .unwrap_or_else(|_| format!("image:{path}"));
    let (open_path, title) = note.unwrap_or_else(|| (path.to_string(), String::new()));
    Ok(Some(SearchResult {
        id,
        path: open_path,
        title,
        snippet: String::new(),
        kind: "image".into(),
        ext: crate::index::ext_of(path),
        image_path: Some(path.into()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_markdown_and_wiki_image_paths() {
        assert_eq!(
            references("![](a(b).png) ![x](<space name.png> \"title\") ![[other.png|100]]"),
            ["other.png", "a(b).png", "space name.png"]
        );
    }
    #[test]
    fn confines_references_to_user_images() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::create_dir_all(root.join(".context")).unwrap();
        std::fs::write(root.join("a b.PNG"), b"fixture").unwrap();
        std::fs::write(root.join("Image.PNG"), b"fixture").unwrap();
        std::fs::write(root.join(".context/secret.png"), b"fixture").unwrap();
        assert_eq!(resolve(&root, "notes/n.md", "../a%20b.PNG", &[]), Some("a b.PNG".into()));
        assert_eq!(resolve(&root, "", "image.png", &["Image.PNG".into()]), Some("Image.PNG".into()));
        for raw in
            ["../../outside.png", "/.context/secret.png", "https://example.com/a.png", "data:image/png;base64,AAAA"]
        {
            assert_eq!(resolve(&root, "notes/n.md", raw, &[]), None);
        }
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::fs::write(outside.path().join("x.png"), b"fixture").unwrap();
            std::os::unix::fs::symlink(outside.path().join("x.png"), root.join("escape.png")).unwrap();
            assert_eq!(resolve(&root, "", "escape.png", &[]), None);
        }
    }
    #[test]
    fn decodes_bounded_rgb_and_first_gif_frame() {
        use image::{Frame, ImageFormat, Rgba, RgbaImage};
        let source = image::DynamicImage::ImageRgba8(RgbaImage::from_pixel(2048, 32, Rgba([0, 0, 0, 0])));
        let mut bytes = Cursor::new(Vec::new());
        source.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let decoded = decode(bytes.get_ref()).unwrap();
        assert_eq!(decoded.dimensions(), (1024, 16));
        assert_eq!(decoded.get_pixel(0, 0).0, [255; 3]);
        assert!(decode(b"not an image").is_err());
        let mut gif = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
            encoder.encode_frame(Frame::new(RgbaImage::from_pixel(8, 8, Rgba([255, 0, 0, 255])))).unwrap();
            encoder.encode_frame(Frame::new(RgbaImage::from_pixel(8, 8, Rgba([0, 0, 255, 255])))).unwrap();
        }
        assert_eq!(decode(&gif).unwrap().get_pixel(0, 0).0, [255, 0, 0]);
    }
    #[test]
    fn rejects_a_valid_png_header_bomb_before_decoding_pixels() {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1).write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let mut bytes = bytes.into_inner();
        bytes[16..20].copy_from_slice(&50_000u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&50_000u32.to_be_bytes());
        let mut crc = 0xffff_ffffu32;
        for byte in &bytes[12..29] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
            }
        }
        bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
        assert!(decode(&bytes).unwrap_err().to_string().contains("24 million pixels"));
        assert!(decode(&vec![0; MAX_BYTES as usize + 1]).unwrap_err().to_string().contains("32 MB"));
    }
}
