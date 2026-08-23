mod agent;
mod catalog;
mod frame;
mod installer;
mod launcher;
mod pty;
mod workspace;

use agent::AgentSupervisorRuntime;
use catalog::CatalogRuntime;
use frame::FrameRuntime;
use installer::InstallRuntime;
use launcher::LaunchRuntime;
use pty::SessionManager;
use workspace::WorkspaceRuntime;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AgentSupervisorRuntime::default())
        .manage(CatalogRuntime::builtins())
        .manage(InstallRuntime::default())
        .manage(LaunchRuntime::default())
        .manage(FrameRuntime::default())
        .manage(SessionManager::default())
        .manage(WorkspaceRuntime::default())
        .invoke_handler(tauri::generate_handler![
            agent::agent_supervision_snapshot,
            agent::agent_supervision_register,
            agent::agent_supervision_observe_output,
            agent::agent_supervision_bind_workspace,
            agent::agent_supervision_provider_event,
            agent::agent_supervision_process_exited,
            agent::agent_follow_up_submit,
            agent::agent_follow_up_deliver,
            agent::agent_attention_acknowledge,
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
            frame::frame_snapshot,
            frame::frame_create_tab,
            frame::frame_create_split,
            frame::frame_attach_session,
            frame::frame_activate_tab,
            frame::frame_set_tab_title,
            frame::frame_focus_pane,
            frame::frame_focus_move,
            frame::frame_resize_split,
            frame::frame_close_focused,
            frame::frame_close_tab,
            frame::frame_reset,
            pty::create_session,
            pty::write_session,
            pty::resize_session,
            pty::close_session,
            workspace::workspace_save,
            workspace::workspace_load,
            workspace::workspace_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkonad");
}
