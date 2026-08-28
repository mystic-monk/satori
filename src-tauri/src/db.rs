use crate::{frontmatter, links, vault::Vault};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

// Rebuildable cache (notes/notes_fts/links) — the markdown files in the
// vault remain the source of truth, this can be deleted and rebuilt via
// the reindex command at any time.
pub fn open_index(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            tags TEXT NOT NULL,
            type TEXT,
            properties TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            path UNINDEXED, title, body, tokenize = 'porter unicode61'
        );
        CREATE TABLE IF NOT EXISTS links (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            embed INTEGER NOT NULL,
            UNIQUE(source, target, embed)
        );
        CREATE INDEX IF NOT EXISTS links_source ON links(source);
        CREATE INDEX IF NOT EXISTS links_target ON links(target);
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

// Genuine app state (shares/history) — no representation in the plaintext
// vault, so it can't be rebuilt the way the index can. Deliberately a
// separate database file from open_index's cache: deleting the index to
// rebuild it must never silently discard sharing config or history.
pub fn open_state(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS shares (
            token TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            role TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS shares_path ON shares(path);
        CREATE TABLE IF NOT EXISTS history (
            path TEXT NOT NULL,
            at REAL NOT NULL,
            authors TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS history_path ON history(path);
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

struct NoteMeta {
    path: String,
    title: String,
    tags: Vec<String>,
    note_type: Option<String>,
    properties: Map<String, Value>,
    updated_at: f64,
}

fn fallback_title(rel_path: &str) -> String {
    std::path::Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel_path.to_string())
}

fn parse_note_meta(vault: &Vault, rel_path: &str) -> Result<(NoteMeta, String), String> {
    let raw = vault.read_raw(rel_path)?;
    let parsed = frontmatter::parse(&raw);
    let updated_at = vault.mtime_ms(rel_path)?;
    let title = parsed
        .data
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback_title(rel_path));
    let tags = parsed
        .data
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let note_type = parsed
        .data
        .get("type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let meta = NoteMeta {
        path: rel_path.to_string(),
        title,
        tags,
        note_type,
        properties: parsed.data,
        updated_at,
    };
    Ok((meta, parsed.body))
}

fn delete_from_index(conn: &Connection, rel_path: &str) -> Result<(), String> {
    conn.execute("DELETE FROM notes WHERE path = ?1", params![rel_path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes_fts WHERE path = ?1", params![rel_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_into_index(conn: &Connection, vault: &Vault, rel_path: &str) -> Result<(), String> {
    let (meta, body) = parse_note_meta(vault, rel_path)?;
    let tags_json = serde_json::to_string(&meta.tags).map_err(|e| e.to_string())?;
    let props_json = serde_json::to_string(&meta.properties).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notes (path, title, tags, type, properties, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![meta.path, meta.title, tags_json, meta.note_type, props_json, meta.updated_at],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notes_fts (path, title, body) VALUES (?1, ?2, ?3)",
        params![meta.path, meta.title, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn build_resolution_maps(all: &[NoteListItem]) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut by_clean_path = HashMap::new();
    let mut by_title = HashMap::new();
    for n in all {
        by_clean_path.insert(n.path.trim_end_matches(".md").to_string(), n.path.clone());
        by_title.insert(n.title.to_lowercase(), n.path.clone());
    }
    (by_clean_path, by_title)
}

fn resolve_ref(
    reference: &str,
    by_clean_path: &HashMap<String, String>,
    by_title: &HashMap<String, String>,
) -> Option<String> {
    let clean = reference.trim_end_matches(".md");
    by_clean_path
        .get(clean)
        .or_else(|| by_title.get(&reference.to_lowercase()))
        .cloned()
}

// Full rebuild: every note's [[refs]] can resolve by title, so a title
// change anywhere can change how OTHER notes' links resolve — this is the
// only case that genuinely needs the whole vault re-read. Same tradeoff as
// server/db.ts: O(n) in note count and vault size, only called on note
// creation or rename, not on every save.
fn rebuild_links(conn: &Connection, vault: &Vault) -> Result<(), String> {
    let all = list_notes_from_index(conn, None)?;
    let (by_clean_path, by_title) = build_resolution_maps(&all);

    conn.execute("DELETE FROM links", [])
        .map_err(|e| e.to_string())?;
    for note in &all {
        let raw = match vault.read_raw(&note.path) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let parsed = frontmatter::parse(&raw);
        for link_ref in links::extract_wikilink_refs(&parsed.body) {
            if let Some(target_path) = resolve_ref(&link_ref.reference, &by_clean_path, &by_title) {
                if target_path != note.path {
                    conn.execute(
                        "INSERT OR IGNORE INTO links (source, target, embed) VALUES (?1, ?2, ?3)",
                        params![note.path, target_path, link_ref.embed as i32],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

// Common case: only this note's body changed, title didn't. Only its own
// outgoing links can have changed, so this reads exactly one file
// regardless of vault size, instead of rebuild_links()'s full rescan.
fn update_outgoing_links(conn: &Connection, vault: &Vault, rel_path: &str) -> Result<(), String> {
    let all = list_notes_from_index(conn, None)?;
    let (by_clean_path, by_title) = build_resolution_maps(&all);
    let raw = match vault.read_raw(rel_path) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    let parsed = frontmatter::parse(&raw);

    conn.execute("DELETE FROM links WHERE source = ?1", params![rel_path])
        .map_err(|e| e.to_string())?;
    for link_ref in links::extract_wikilink_refs(&parsed.body) {
        if let Some(target_path) = resolve_ref(&link_ref.reference, &by_clean_path, &by_title) {
            if target_path != rel_path {
                conn.execute(
                    "INSERT OR IGNORE INTO links (source, target, embed) VALUES (?1, ?2, ?3)",
                    params![rel_path, target_path, link_ref.embed as i32],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn get_title(conn: &Connection, rel_path: &str) -> Option<String> {
    conn.query_row(
        "SELECT title FROM notes WHERE path = ?1",
        params![rel_path],
        |r| r.get(0),
    )
    .ok()
}

pub fn upsert_note_index(conn: &Connection, vault: &Vault, rel_path: &str) -> Result<(), String> {
    let old_title = get_title(conn, rel_path);
    delete_from_index(conn, rel_path)?;
    insert_into_index(conn, vault, rel_path)?;
    // A brand-new note (old_title is None) needs the full rebuild too: it
    // may be the resolution target for [[refs]] in notes that already
    // exist and previously pointed at nothing.
    if old_title != get_title(conn, rel_path) {
        rebuild_links(conn, vault)?;
    } else {
        update_outgoing_links(conn, vault, rel_path)?;
    }
    Ok(())
}

pub fn remove_note_index(conn: &Connection, rel_path: &str) -> Result<(), String> {
    delete_from_index(conn, rel_path)?;
    // This note's own outgoing links disappear with it; any other note's
    // link that targeted it becomes a dangling row pointing at a path no
    // longer in `notes` — harmless for get_backlinks() (joins against
    // notes), but get_all_links() (the graph) returns raw rows, so clean
    // up both directions explicitly rather than leaving stale edges.
    conn.execute(
        "DELETE FROM links WHERE source = ?1 OR target = ?1",
        params![rel_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rebuild_index(conn: &Connection, vault: &Vault) -> Result<usize, String> {
    let files = vault.list_note_files();
    conn.execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes_fts", [])
        .map_err(|e| e.to_string())?;
    for f in &files {
        insert_into_index(conn, vault, f)?;
    }
    rebuild_links(conn, vault)?;
    Ok(files.len())
}

#[derive(Serialize, Clone)]
pub struct NoteListItem {
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: f64,
}

pub fn list_notes_from_index(
    conn: &Connection,
    type_filter: Option<&str>,
) -> Result<Vec<NoteListItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT path, title, tags, type, updated_at FROM notes \
             WHERE (?1 IS NULL OR type = ?1) ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![type_filter], |row| {
            let tags_json: String = row.get(2)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            Ok(NoteListItem {
                path: row.get(0)?,
                title: row.get(1)?,
                tags,
                note_type: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct TypeCount {
    #[serde(rename = "type")]
    pub type_name: String,
    pub count: i64,
}

pub fn list_types(conn: &Connection) -> Result<Vec<TypeCount>, String> {
    let mut stmt = conn
        .prepare("SELECT type, COUNT(*) as count FROM notes WHERE type IS NOT NULL GROUP BY type ORDER BY type")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TypeCount {
                type_name: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct Share {
    pub token: String,
    pub path: String,
    pub role: String,
    pub label: String,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
}

pub fn create_share(
    conn: &Connection,
    path: &str,
    role: &str,
    label: &str,
) -> Result<Share, String> {
    let token = uuid::Uuid::new_v4().simple().to_string();
    let created_at = chrono::Utc::now().timestamp_millis() as f64;
    conn.execute(
        "INSERT INTO shares (token, path, role, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![token, path, role, label, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(Share {
        token,
        path: path.to_string(),
        role: role.to_string(),
        label: label.to_string(),
        created_at,
    })
}

pub fn list_shares(conn: &Connection, path: &str) -> Result<Vec<Share>, String> {
    let mut stmt = conn
        .prepare("SELECT token, path, role, label, created_at FROM shares WHERE path = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![path], |row| {
            Ok(Share {
                token: row.get(0)?,
                path: row.get(1)?,
                role: row.get(2)?,
                label: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn revoke_share(conn: &Connection, token: &str) -> Result<(), String> {
    conn.execute("DELETE FROM shares WHERE token = ?1", params![token])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Unrecognized/absent tokens fall back to "owner" (full access) — matches
// server/db.ts exactly. The token system is an additive restriction the
// owner opts into per note, not a primary auth mechanism; the local app
// itself must always keep working with no token at all.
pub fn resolve_share_role(
    conn: &Connection,
    path: &str,
    token: Option<&str>,
) -> Result<String, String> {
    let Some(t) = token else {
        return Ok("owner".to_string());
    };
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT role FROM shares WHERE token = ?1 AND path = ?2",
        params![t, path],
        |r| r.get(0),
    );
    match result {
        Ok(role) => Ok(role),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok("owner".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
pub struct HistoryEntry {
    pub at: f64,
    pub authors: Vec<String>,
}

pub fn get_history(conn: &Connection, path: &str) -> Result<Vec<HistoryEntry>, String> {
    let mut stmt = conn
        .prepare("SELECT at, authors FROM history WHERE path = ?1 ORDER BY at DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![path], |row| {
            let authors_json: String = row.get(1)?;
            let authors: Vec<String> = serde_json::from_str(&authors_json).unwrap_or_default();
            Ok(HistoryEntry {
                at: row.get(0)?,
                authors,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BacklinkItem {
    pub path: String,
    pub title: String,
    pub embed: bool,
}

pub fn get_backlinks(conn: &Connection, path: &str) -> Result<Vec<BacklinkItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT n.path, n.title, l.embed FROM links l \
             JOIN notes n ON n.path = l.source WHERE l.target = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![path], |row| {
            let embed: i64 = row.get(2)?;
            Ok(BacklinkItem {
                path: row.get(0)?,
                title: row.get(1)?,
                embed: embed != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct LinkEdge {
    pub source: String,
    pub target: String,
    pub embed: bool,
}

pub fn get_all_links(conn: &Connection) -> Result<Vec<LinkEdge>, String> {
    let mut stmt = conn
        .prepare("SELECT source, target, embed FROM links")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let embed: i64 = row.get(2)?;
            Ok(LinkEdge {
                source: row.get(0)?,
                target: row.get(1)?,
                embed: embed != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

// FTS5 MATCH syntax treats *, ", :, ( ) as special. Strip them and turn each
// remaining token into a prefix match so partial words work as-you-type —
// same as server/db.ts's sanitizeFtsQuery.
fn sanitize_fts_query(q: &str) -> String {
    let cleaned: String = q
        .chars()
        .map(|c| if "\"*:()".contains(c) { ' ' } else { c })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return String::new();
    }
    cleaned
        .split_whitespace()
        .map(|t| format!("{}*", t))
        .collect::<Vec<_>>()
        .join(" ")
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

const MARK_START: &str = "PKMARK-START";
const MARK_END: &str = "PKMARK-END";

// snippet() wraps matches in plain-text sentinels rather than real tags so
// the whole snippet can be HTML-escaped first — note bodies are untrusted
// user text — before the sentinels are swapped for a real <mark> element.
fn markify(snippet: &str) -> String {
    escape_html(snippet)
        .replace(&escape_html(MARK_START), "<mark>")
        .replace(&escape_html(MARK_END), "</mark>")
}

pub fn search_notes(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, String> {
    let fts = sanitize_fts_query(query);
    if fts.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT path, title, snippet(notes_fts, 2, ?1, ?2, '…', 12) as snippet \
             FROM notes_fts WHERE notes_fts MATCH ?3 ORDER BY bm25(notes_fts) LIMIT 50",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![MARK_START, MARK_END, fts], |row| {
            let snippet: String = row.get(2)?;
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
                snippet: markify(&snippet),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
