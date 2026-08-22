mod catalog;
mod installer;
mod launcher;
mod pty;

use catalog::CatalogRuntime;
use installer::InstallRuntime;
use launcher::LaunchRuntime;
use pty::SessionManager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(CatalogRuntime::builtins())
        .manage(InstallRuntime::default())
        .manage(LaunchRuntime::default())
        .manage(SessionManager::default())
        .invoke_handler(tauri::generate_handler![
            catalog::catalog_detect,
            catalog::catalog_list,
            installer::install_execute,
            installer::install_plan,
            installer::install_receipts,
            installer::app_management_execute,
            installer::app_management_plan,
            installer::my_apps_list,
            launcher::launchpad_list,
            launcher::launch_app,
            launcher::launchpad_set_pinned,
            launcher::custom_app_list,
            launcher::custom_app_validate,
            launcher::custom_app_save,
            launcher::custom_app_set_enabled,
            launcher::custom_app_remove,
            pty::create_session,
            pty::write_session,
            pty::resize_session,
            pty::close_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkonad");
}
