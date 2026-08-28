mod commands;
mod db;
mod frontmatter;
mod links;
mod state;
mod vault;

use state::AppState;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use vault::Vault;

#[derive(serde::Serialize, serde::Deserialize)]
struct VaultConfig {
    vault_path: std::path::PathBuf,
}

fn save_vault_config(config_path: &std::path::Path, vault_path: &std::path::Path) {
    let cfg = VaultConfig { vault_path: vault_path.to_path_buf() };
    if let Ok(json) = serde_json::to_string_pretty(&cfg) {
        let _ = std::fs::write(config_path, json);
    }
}

// Shared by the "Open a Different Vault…" menu item and the switch_vault
// command (commands.rs) — the sidebar's vault header can trigger this
// directly instead of only being reachable through the native menu. Same
// "picked folder is a location, not the vault itself" rule as
// resolve_vault_dir's first-run path — see that function's comment for why.
pub(crate) fn switch_vault_dialog(app_handle: &tauri::AppHandle) {
    let Some(location) = rfd::FileDialog::new()
        .set_title("Choose a location for your Satori vault")
        .pick_folder()
    else {
        return;
    };
    let vault_path = location.join("Satori Vault");
    if let Ok(config_dir) = app_handle.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&config_dir);
        save_vault_config(&config_dir.join("vault-config.json"), &vault_path);
    }
    app_handle.restart();
}

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
    let message = format!("Satori couldn't start: failed to {what}.\n\n{err}");
    rfd::MessageDialog::new()
        .set_title("Satori failed to start")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Error)
        .show();
    std::process::exit(1);
}

// Resolves which folder on disk is "the vault" — persisted in
// vault-config.json under app_config_dir() (deliberately separate from
// app_data_dir(), where the index cache/state/vault content itself live)
// so the choice survives across launches. Previously this was hardcoded
// to app_data_dir()/vault with no user control at all.
fn resolve_vault_dir(app: &tauri::App) -> std::path::PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|e| fatal_setup_error("locate the app config directory", e));
    std::fs::create_dir_all(&config_dir)
        .unwrap_or_else(|e| fatal_setup_error(&format!("create {}", config_dir.display()), e));
    let config_path = config_dir.join("vault-config.json");

    if let Ok(raw) = std::fs::read_to_string(&config_path) {
        if let Ok(cfg) = serde_json::from_str::<VaultConfig>(&raw) {
            if cfg.vault_path.exists() {
                return cfg.vault_path;
            }
        }
    }

    // Nothing configured yet — if the pre-this-feature hardcoded location
    // already has real notes in it, adopt it silently rather than
    // prompting someone who's already using the app.
    let legacy = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|e| fatal_setup_error("locate the app data directory", e))
        .join("vault");
    if legacy.exists() && !Vault::new(legacy.clone()).list_note_files().is_empty() {
        save_vault_config(&config_path, &legacy);
        return legacy;
    }

    // Genuine first run: block on a native folder picker before the
    // window renders. The picked folder is a *location*, not the vault
    // itself — the vault is always a dedicated "Satori Vault" subfolder
    // inside it, never the picked folder directly. Earlier this used the
    // picked folder as-is, which meant picking somewhere general like
    // ~/Desktop silently swept every unrelated .md file already there
    // (WalkDir walks recursively) into the vault — surprising and unsafe.
    // A dedicated subfolder also collapses "create new" vs. "open
    // existing" into one flow for free: if it doesn't exist yet, Vault::new
    // creates it empty (fresh); if it already exists (picking the same
    // location again), whatever's already in *that* subfolder is opened —
    // never anything else sitting alongside it.
    match rfd::FileDialog::new()
        .set_title("Choose a location for your Satori vault")
        .pick_folder()
    {
        Some(location) => {
            let vault_path = location.join("Satori Vault");
            save_vault_config(&config_path, &vault_path);
            vault_path
        }
        None => fatal_setup_error("start", "no vault location was chosen"),
    }
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

            // App data dir (e.g. ~/Library/Application Support/dev.satori.app on
            // macOS) rather than cwd — this app launches from a bundled .app,
            // not a project checkout, so there's no meaningful "cwd" to put a
            // vault/ next to the way the Node deployment does. The index
            // cache/state stay pinned to app_data_dir() regardless of which
            // vault folder the user picks (see resolve_vault_dir) — they're
            // this app's own bookkeeping, not something that lives inside a
            // user's chosen notes folder.
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|e| fatal_setup_error("locate the app data directory", e));
            let vault_dir = resolve_vault_dir(app);
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

            // Frontend-actionable items (new note, reindex, view toggles —
            // src/App.tsx already has handler functions for all of these)
            // are dispatched as events the frontend listens for; vault
            // switching and About are handled entirely here since they
            // don't need any frontend involvement.
            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&MenuItemBuilder::with_id("new_note", "New Note").accelerator("CmdOrCtrl+N").build(app)?)
                .item(&MenuItemBuilder::with_id("new_canvas", "New Canvas").build(app)?)
                .item(&MenuItemBuilder::with_id("today", "Today's Daily Note").build(app)?)
                .item(&MenuItemBuilder::with_id("reindex", "Reindex").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("switch_vault", "Open a Different Vault…").build(app)?)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").build(app)?)
                .item(&MenuItemBuilder::with_id("toggle_graph", "Toggle Graph").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("view_source", "Source").build(app)?)
                .item(&MenuItemBuilder::with_id("view_split", "Split").build(app)?)
                .item(&MenuItemBuilder::with_id("view_preview", "Preview").build(app)?)
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .about(Some(
                    AboutMetadataBuilder::new()
                        .name(Some("Satori"))
                        .version(Some(env!("CARGO_PKG_VERSION")))
                        .build(),
                ))
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| match event.id().as_ref() {
                "switch_vault" => switch_vault_dialog(app_handle),
                id @ ("new_note" | "new_canvas" | "today" | "reindex" | "toggle_sidebar" | "toggle_graph"
                | "view_source" | "view_split" | "view_preview") => {
                    let _ = app_handle.emit(&format!("menu:{}", id.replace('_', "-")), ());
                }
                _ => {}
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
            commands::get_vault_info,
            commands::switch_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
