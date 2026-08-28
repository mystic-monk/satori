use std::fs;
use std::path::PathBuf;
use walkdir::WalkDir;

/// Plain markdown files on disk — the source of truth, same as
/// server/vault.ts in the web deployment. No canonicalization/existence
/// check is needed for the path-escape guard since it's a lexical check
/// (mirrors the Node version, which is also lexical, not requiring the
/// target to already exist — matters for brand-new notes/subdirectories).
pub struct Vault {
    pub dir: PathBuf,
}

impl Vault {
    pub fn new(dir: PathBuf) -> Self {
        fs::create_dir_all(&dir).ok();
        Vault { dir }
    }

    fn to_abs(&self, rel_path: &str) -> Result<PathBuf, String> {
        if rel_path.contains("..") {
            return Err("path escapes vault".into());
        }
        Ok(self.dir.join(rel_path))
    }

    pub fn list_note_files(&self) -> Vec<String> {
        WalkDir::new(&self.dir)
            .into_iter()
            .filter_entry(|e| {
                e.file_name()
                    .to_str()
                    .map(|s| !s.starts_with('.'))
                    .unwrap_or(true)
            })
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().is_file()
                    && e.path().extension().and_then(|s| s.to_str()) == Some("md")
            })
            .filter_map(|e| {
                e.path()
                    .strip_prefix(&self.dir)
                    .ok()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
            })
            .collect()
    }

    pub fn read_raw(&self, rel_path: &str) -> Result<String, String> {
        fs::read_to_string(self.to_abs(rel_path)?).map_err(|e| e.to_string())
    }

    pub fn write_raw(&self, rel_path: &str, raw: &str) -> Result<(), String> {
        let abs = self.to_abs(rel_path)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(abs, raw).map_err(|e| e.to_string())
    }

    pub fn delete(&self, rel_path: &str) -> Result<(), String> {
        fs::remove_file(self.to_abs(rel_path)?).map_err(|e| e.to_string())
    }

    pub fn mtime_ms(&self, rel_path: &str) -> Result<f64, String> {
        let meta = fs::metadata(self.to_abs(rel_path)?).map_err(|e| e.to_string())?;
        let modified = meta.modified().map_err(|e| e.to_string())?;
        let dur = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?;
        Ok(dur.as_millis() as f64)
    }
}
