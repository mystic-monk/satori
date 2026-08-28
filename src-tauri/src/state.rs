use crate::vault::Vault;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub vault: Vault,
    /// Rebuildable cache (notes/notes_fts/links) — see db::open_index.
    pub conn: Mutex<Connection>,
    /// Real app state (shares/history), deliberately a separate database —
    /// see db::open_state.
    pub state_conn: Mutex<Connection>,
}
