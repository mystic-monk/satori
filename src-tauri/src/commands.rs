use crate::{db, state::AppState};
use serde::Serialize;
use tauri::State;

fn lock_err<T>(_: std::sync::PoisonError<T>) -> String {
    "database lock poisoned".to_string()
}

#[derive(Serialize)]
pub struct NoteContent {
    pub path: String,
    pub raw: String,
}

#[tauri::command]
pub fn list_notes(
    state: State<AppState>,
    type_filter: Option<String>,
) -> Result<Vec<db::NoteListItem>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    db::list_notes_from_index(&conn, type_filter.as_deref())
}

#[tauri::command]
pub fn list_types(state: State<AppState>) -> Result<Vec<db::TypeCount>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    db::list_types(&conn)
}

#[tauri::command]
pub fn get_links(state: State<AppState>) -> Result<Vec<db::LinkEdge>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    db::get_all_links(&conn)
}

#[tauri::command]
pub fn get_backlinks(
    state: State<AppState>,
    path: String,
) -> Result<Vec<db::BacklinkItem>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    db::get_backlinks(&conn, &path)
}

#[tauri::command]
pub fn read_note(state: State<AppState>, path: String) -> Result<NoteContent, String> {
    let raw = state.vault.read_raw(&path)?;
    Ok(NoteContent { path, raw })
}

#[tauri::command]
pub fn write_note(
    state: State<AppState>,
    path: String,
    raw: String,
    author_id: Option<String>,
    author_name: String,
) -> Result<(), String> {
    state.vault.write_raw(&path, &raw)?;
    let conn = state.conn.lock().map_err(lock_err)?;
    db::upsert_note_index(&conn, &state.vault, &path)?;
    let state_conn = state.state_conn.lock().map_err(lock_err)?;
    db::log_history(
        &state_conn,
        &path,
        &[db::AuthorRef { id: author_id, name: author_name }],
    )
}

#[tauri::command]
pub fn create_note(state: State<AppState>, path: String, raw: String) -> Result<(), String> {
    state.vault.write_raw(&path, &raw)?;
    let conn = state.conn.lock().map_err(lock_err)?;
    db::upsert_note_index(&conn, &state.vault, &path)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, path: String) -> Result<(), String> {
    state.vault.delete(&path)?;
    let conn = state.conn.lock().map_err(lock_err)?;
    db::remove_note_index(&conn, &path)
}

#[tauri::command]
pub fn search_notes(state: State<AppState>, query: String) -> Result<Vec<db::SearchResult>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    db::search_notes(&conn, &query)
}

#[tauri::command]
pub fn reindex(state: State<AppState>) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    let count = db::rebuild_index(&conn, &state.vault)?;
    Ok(serde_json::json!({ "count": count }))
}

#[tauri::command]
pub fn create_share(
    state: State<AppState>,
    path: String,
    role: String,
    label: String,
) -> Result<db::Share, String> {
    let conn = state.state_conn.lock().map_err(lock_err)?;
    db::create_share(&conn, &path, &role, &label)
}

#[tauri::command]
pub fn list_shares(state: State<AppState>, path: String) -> Result<Vec<db::Share>, String> {
    let conn = state.state_conn.lock().map_err(lock_err)?;
    db::list_shares(&conn, &path)
}

#[tauri::command]
pub fn revoke_share(state: State<AppState>, token: String) -> Result<(), String> {
    let conn = state.state_conn.lock().map_err(lock_err)?;
    db::revoke_share(&conn, &token)
}

#[tauri::command]
pub fn resolve_role(
    state: State<AppState>,
    path: String,
    token: Option<String>,
) -> Result<String, String> {
    let conn = state.state_conn.lock().map_err(lock_err)?;
    db::resolve_share_role(&conn, &path, token.as_deref())
}

#[tauri::command]
pub fn get_history(state: State<AppState>, path: String) -> Result<Vec<db::HistoryEntry>, String> {
    let conn = state.state_conn.lock().map_err(lock_err)?;
    db::get_history(&conn, &path)
}

#[derive(Serialize)]
pub struct VaultInfo {
    pub name: String,
}

#[tauri::command]
pub fn get_vault_info(state: State<AppState>) -> VaultInfo {
    let name = state
        .vault
        .dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vault".to_string());
    VaultInfo { name }
}

// Reuses the exact same picker/save/restart flow as the "Open a Different
// Vault…" menu item (src-tauri/src/lib.rs) — this lets the sidebar's vault
// header trigger it directly, so switching vaults doesn't require knowing
// the native menu exists.
#[tauri::command]
pub fn switch_vault(app: tauri::AppHandle) {
    crate::switch_vault_dialog(&app);
}

// Copies (never moves — originals stay untouched) recognized files from a
// picked folder into this vault's imported/ subfolder. See
// src-tauri/src/import.rs for exactly what's handled (.md/.txt/.json) and
// why. Reindexes afterward so the frontend's next fetchNotes() picks up
// the new notes without a manual Reindex click.
#[tauri::command]
pub fn import_folder(state: State<AppState>) -> crate::import::ImportSummary {
    crate::run_import_dialog(&state)
}

// MD/HTML export (src/export.ts) used a browser-only <a download> trick
// that does nothing in Tauri's WKWebView — no download manager to catch
// it. This is the native equivalent: a real Save dialog, then a direct
// write. Returns false (not an error) if the user cancels, so the
// frontend doesn't need to treat "no file chosen" as a failure.
#[tauri::command]
pub fn save_export_file(
    default_name: String,
    content: String,
    filter_name: String,
    filter_ext: String,
) -> Result<bool, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &[filter_ext.as_str()])
        .save_file()
    else {
        return Ok(false);
    };
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

// PDF export used window.open() + win.print(), which is equally
// unreliable in a Tauri webview (no guarantee a new native window opens
// the way a browser tab would). WebviewWindow::print() triggers the real
// OS print dialog for the current window instead — on macOS that dialog
// already has "Save as PDF" built in, so this covers PDF export without
// a bundled PDF-generation dependency. src/export.ts renders the export
// content into a hidden-except-when-printing container before calling
// this, so the dialog shows the formatted export, not the whole app UI.
#[tauri::command]
pub fn print_current_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

// Parsing the .bib text itself happens in the frontend (shared/bibtex.ts)
// so there's exactly one BibTeX parser rather than one per language
// boundary — this command's only job is the native picker plus reading
// the file, the same division of labor save_export_file above already
// has for its side of the export flow.
#[tauri::command]
pub fn pick_bib_file() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("BibTeX", &["bib"])
        .pick_file()
    else {
        return Ok(None);
    };
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_due_cards(state: State<AppState>) -> Result<Vec<db::DueCard>, String> {
    let conn = state.conn.lock().map_err(lock_err)?;
    let state_conn = state.state_conn.lock().map_err(lock_err)?;
    db::get_due_cards(&conn, &state_conn)
}

#[tauri::command]
pub fn record_card_review(
    state: State<AppState>,
    path: String,
    rating: crate::srs::Rating,
) -> Result<(), String> {
    let state_conn = state.state_conn.lock().map_err(lock_err)?;
    db::record_card_review(&state_conn, &path, rating)
}
