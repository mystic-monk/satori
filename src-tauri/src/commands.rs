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
