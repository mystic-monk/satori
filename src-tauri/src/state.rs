use crate::vault::Vault;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub vault: Vault,
    pub conn: Mutex<Connection>,
}
