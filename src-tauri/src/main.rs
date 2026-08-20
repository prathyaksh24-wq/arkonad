mod pty;

use pty::SessionManager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            pty::create_session,
            pty::write_session,
            pty::resize_session,
            pty::close_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkonad");
}
