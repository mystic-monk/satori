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

// A brand-new vault (first run, or "switch vault" pointed at a fresh
// location) opens completely empty otherwise — no notes, no guidance.
// Seeds the bundled starter/tutorial content in exactly once, only when
// the vault has zero real note files — never on top of real content, so
// this can't clobber anything once the vault's actually being used.
// Mirrors server/vault.ts's seedStarterVaultIfEmpty for the web/Node
// deployment; `starter_dir` is the resolved bundled resource path (see
// tauri.conf.json's bundle.resources and lib.rs's setup).
pub fn seed_starter_vault_if_empty(vault: &Vault, starter_dir: &std::path::Path) {
    if !starter_dir.exists() || !vault.list_note_files().is_empty() {
        return;
    }
    if let Err(e) = copy_dir_recursive(starter_dir, &vault.dir) {
        log::warn!("failed to seed starter vault content from {}: {e}", starter_dir.display());
    }
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Same manually-scoped temp dir pattern as import.rs's tests — no
    // tempfile dependency in this crate yet.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "satori-vault-test-{label}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn seeds_an_empty_vault_from_starter_content() {
        let starter = TempDir::new("starter");
        fs::write(starter.0.join("welcome.md"), "---\ntitle: Welcome\n---\nHi.\n").unwrap();
        fs::create_dir_all(starter.0.join("tutorial")).unwrap();
        fs::write(starter.0.join("tutorial/formatting.md"), "---\ntitle: Formatting\n---\nBody.\n").unwrap();

        let vault_dir = TempDir::new("vault");
        let vault = Vault::new(vault_dir.0.clone());
        assert!(vault.list_note_files().is_empty());

        seed_starter_vault_if_empty(&vault, &starter.0);

        let mut files = vault.list_note_files();
        files.sort();
        assert_eq!(files, vec!["tutorial/formatting.md".to_string(), "welcome.md".to_string()]);
        assert_eq!(vault.read_raw("welcome.md").unwrap(), "---\ntitle: Welcome\n---\nHi.\n");
    }

    #[test]
    fn never_reseeds_or_clobbers_a_vault_that_already_has_notes() {
        let starter = TempDir::new("starter2");
        fs::write(starter.0.join("welcome.md"), "---\ntitle: Welcome\n---\nHi.\n").unwrap();

        let vault_dir = TempDir::new("vault2");
        let vault = Vault::new(vault_dir.0.clone());
        vault.write_raw("my-note.md", "---\ntitle: Mine\n---\nReal content.\n").unwrap();

        seed_starter_vault_if_empty(&vault, &starter.0);

        assert_eq!(vault.list_note_files(), vec!["my-note.md".to_string()]);
    }

    #[test]
    fn does_nothing_when_the_starter_dir_does_not_exist() {
        let vault_dir = TempDir::new("vault3");
        let vault = Vault::new(vault_dir.0.clone());
        let missing = std::env::temp_dir().join("satori-vault-test-nonexistent-starter");
        seed_starter_vault_if_empty(&vault, &missing);
        assert!(vault.list_note_files().is_empty());
    }
}
