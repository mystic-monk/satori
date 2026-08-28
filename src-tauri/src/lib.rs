mod commands;
mod db;
mod frontmatter;
mod links;
mod state;
mod vault;

use state::AppState;
use tauri::Manager;
use vault::Vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // App data dir (e.g. ~/Library/Application Support/dev.pkm.app on
            // macOS) rather than cwd — this app launches from a bundled .app,
            // not a project checkout, so there's no meaningful "cwd" to put a
            // vault/ next to the way the Node deployment does.
            let app_dir = app.path().app_data_dir()?;
            let vault_dir = app_dir.join("vault");
            let db_path = app_dir.join("index.sqlite");

            let vault = Vault::new(vault_dir);
            let conn = db::open(&db_path).expect("failed to open sqlite index");

            // Same bootstrap rule as server/index.ts: the SQLite index is a
            // cache, rebuild it if it's empty but the vault has notes.
            let has_notes = db::list_notes_from_index(&conn, None)
                .map(|n| !n.is_empty())
                .unwrap_or(false);
            if !has_notes && !vault.list_note_files().is_empty() {
                let _ = db::rebuild_index(&conn, &vault);
            }

            app.manage(AppState {
                vault,
                conn: std::sync::Mutex::new(conn),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_notes,
            commands::list_types,
            commands::get_links,
            commands::get_backlinks,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::delete_note,
            commands::search_notes,
            commands::reindex,
            commands::create_share,
            commands::list_shares,
            commands::revoke_share,
            commands::resolve_role,
            commands::get_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
