mod commands;
mod db;
mod frontmatter;
mod links;
mod state;
mod vault;

use state::AppState;
use tauri::Manager;
use vault::Vault;

// A setup failure (can't resolve the app data dir, can't create its
// subdirectories, can't open either SQLite file — disk full, permissions,
// a corrupted db file left over from a bad shutdown) used to panic via
// .expect(), which for a bundled GUI app just means the process
// disappears with no visible explanation: there's no terminal attached
// for the user to see the panic message in. Show a native dialog with
// the real error first, so at least there's something actionable to
// screenshot/report, then exit deliberately rather than let the panic
// unwind produce a generic OS-level crash report instead.
fn fatal_setup_error(what: &str, err: impl std::fmt::Display) -> ! {
    let message = format!("pkm couldn't start: failed to {what}.\n\n{err}");
    rfd::MessageDialog::new()
        .set_title("pkm failed to start")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Error)
        .show();
    std::process::exit(1);
}

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
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|e| fatal_setup_error("locate the app data directory", e));
            let vault_dir = app_dir.join("vault");
            // Separate directory from the index cache on purpose — see the
            // comment on db::open_state.
            let index_path = app_dir.join("index-cache").join("index.sqlite");
            let state_path = app_dir.join("state").join("state.sqlite");
            for dir in [index_path.parent(), state_path.parent()].into_iter().flatten() {
                if let Err(e) = std::fs::create_dir_all(dir) {
                    fatal_setup_error(&format!("create {}", dir.display()), e);
                }
            }

            let vault = Vault::new(vault_dir);
            let conn = db::open_index(&index_path)
                .unwrap_or_else(|e| fatal_setup_error("open the search index database", e));
            let state_conn = db::open_state(&state_path)
                .unwrap_or_else(|e| fatal_setup_error("open the app state database", e));

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
                state_conn: std::sync::Mutex::new(state_conn),
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
