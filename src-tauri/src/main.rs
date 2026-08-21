mod catalog;
mod installer;
mod pty;

use catalog::CatalogRuntime;
use installer::InstallRuntime;
use pty::SessionManager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(CatalogRuntime::builtins())
        .manage(InstallRuntime::default())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            catalog::catalog_detect,
            catalog::catalog_list,
            installer::install_execute,
            installer::install_plan,
            installer::install_receipts,
            pty::create_session,
            pty::write_session,
            pty::resize_session,
            pty::close_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkonad");
}
