use crate::vault::Vault;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Serialize, Default)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

// Only .md/.txt/.json are handled — anything else (images, PDFs, random
// config files a real folder tends to have) is silently skipped rather
// than guessed at. Confirmed with the user before building this: copy
// (never move — originals stay untouched), .txt gets minimal frontmatter
// wrapped around it verbatim, .json is only imported when it looks like
// an Excalidraw scene (matching this app's own canvas-note format) —
// anything else JSON-shaped is left alone rather than dumped into a note
// as raw JSON nobody asked for.
fn looks_like_excalidraw_scene(json: &Value) -> bool {
    json.get("elements").is_some() && json.get("appState").is_some()
}

fn title_from_filename(stem: &str) -> String {
    stem.replace(['_', '-'], " ")
}

// Never overwrites an existing note — appends -1, -2, ... until a free
// name is found. Imported content always lands under an "imported/"
// subfolder (mirroring the source's own subfolder structure), isolating
// collision risk to that subfolder rather than risking a clash with the
// vault's existing organization.
fn unique_dest(vault: &Vault, dir: &str, stem: &str) -> String {
    let mut candidate = format!("{dir}/{stem}.md");
    let mut n = 1;
    while vault.dir.join(&candidate).exists() {
        candidate = format!("{dir}/{stem}-{n}.md");
        n += 1;
    }
    candidate
}

pub fn import_folder(vault: &Vault, source: &Path) -> ImportSummary {
    let mut summary = ImportSummary::default();

    for entry in walkdir::WalkDir::new(source)
        .into_iter()
        .filter_entry(|e| e.file_name().to_str().map(|s| !s.starts_with('.')).unwrap_or(true))
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(source) else {
            summary.skipped += 1;
            continue;
        };
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("untitled");
        let parent_rel = rel.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let dest_dir = if parent_rel.is_empty() {
            "imported".to_string()
        } else {
            format!("imported/{parent_rel}")
        };

        let content = match ext.as_str() {
            "md" => std::fs::read_to_string(path).map_err(|e| e.to_string()),
            "txt" => std::fs::read_to_string(path).map(|body| {
                format!("---\ntitle: {}\ntags: []\n---\n\n{}\n", title_from_filename(stem), body)
            }).map_err(|e| e.to_string()),
            "json" => {
                let parsed = std::fs::read_to_string(path)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok());
                match parsed {
                    Some(json) if looks_like_excalidraw_scene(&json) => {
                        let pretty = serde_json::to_string_pretty(&json).unwrap_or_default();
                        Ok(format!("---\ntitle: {}\ntype: canvas\n---\n{}\n", title_from_filename(stem), pretty))
                    }
                    _ => {
                        summary.skipped += 1;
                        continue;
                    }
                }
            }
            _ => {
                summary.skipped += 1;
                continue;
            }
        };

        match content {
            Ok(raw) => {
                let dest = unique_dest(vault, &dest_dir, stem);
                match vault.write_raw(&dest, &raw) {
                    Ok(()) => summary.imported += 1,
                    Err(e) => summary.errors.push(format!("{}: {e}", path.display())),
                }
            }
            Err(e) => summary.errors.push(format!("{}: {e}", path.display())),
        }
    }

    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // No tempfile dependency yet in this crate — a manually-scoped temp
    // dir (unique per test via the thread name, cleaned up on drop) is
    // enough for these and doesn't add one just for tests.
    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "satori-import-test-{label}-{}-{:?}",
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

    fn setup() -> (TempDir, TempDir, Vault) {
        let source = TempDir::new("source");
        let vault_dir = TempDir::new("vault");
        let vault = Vault::new(vault_dir.0.clone());
        (source, vault_dir, vault)
    }

    #[test]
    fn imports_markdown_as_is() {
        let (source, _vault_dir, vault) = setup();
        fs::write(source.0.join("note.md"), "---\ntitle: Existing\n---\nbody").unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 1);
        assert_eq!(summary.skipped, 0);
        let content = fs::read_to_string(vault.dir.join("imported/note.md")).unwrap();
        assert_eq!(content, "---\ntitle: Existing\n---\nbody");
    }

    #[test]
    fn wraps_txt_with_frontmatter() {
        let (source, _vault_dir, vault) = setup();
        fs::write(source.0.join("my_notes.txt"), "plain text content").unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 1);
        let content = fs::read_to_string(vault.dir.join("imported/my_notes.md")).unwrap();
        assert!(content.contains("title: my notes"));
        assert!(content.contains("plain text content"));
    }

    #[test]
    fn imports_excalidraw_shaped_json_as_canvas() {
        let (source, _vault_dir, vault) = setup();
        fs::write(source.0.join("drawing.json"), r#"{"elements":[],"appState":{}}"#).unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 1);
        let content = fs::read_to_string(vault.dir.join("imported/drawing.md")).unwrap();
        assert!(content.contains("type: canvas"));
        assert!(content.contains("\"elements\""));
    }

    #[test]
    fn skips_non_excalidraw_json_and_unknown_extensions() {
        let (source, _vault_dir, vault) = setup();
        fs::write(source.0.join("config.json"), r#"{"setting":true}"#).unwrap();
        fs::write(source.0.join("image.png"), "not really a png").unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 0);
        assert_eq!(summary.skipped, 2);
    }

    #[test]
    fn never_overwrites_an_existing_note() {
        let (source, _vault_dir, vault) = setup();
        fs::create_dir_all(vault.dir.join("imported")).unwrap();
        fs::write(vault.dir.join("imported/note.md"), "already here").unwrap();
        fs::write(source.0.join("note.md"), "new content").unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 1);
        assert_eq!(fs::read_to_string(vault.dir.join("imported/note.md")).unwrap(), "already here");
        assert_eq!(fs::read_to_string(vault.dir.join("imported/note-1.md")).unwrap(), "new content");
    }

    #[test]
    fn preserves_source_subfolder_structure() {
        let (source, _vault_dir, vault) = setup();
        fs::create_dir_all(source.0.join("projects")).unwrap();
        fs::write(source.0.join("projects/plan.md"), "content").unwrap();
        let summary = import_folder(&vault, &source.0);
        assert_eq!(summary.imported, 1);
        assert!(vault.dir.join("imported/projects/plan.md").exists());
    }
}
