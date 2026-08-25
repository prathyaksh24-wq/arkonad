mod agent;
mod catalog;
mod frame;
mod installer;
mod integration;
mod launcher;
mod pty;
mod release;
mod repository;
mod settings;
mod task;
mod workspace;

use agent::AgentSupervisorRuntime;
use catalog::CatalogRuntime;
use frame::FrameRuntime;
use installer::InstallRuntime;
use integration::IntegrationRuntime;
use launcher::LaunchRuntime;
use pty::SessionManager;
use repository::RepositoryRuntime;
use settings::SettingsRuntime;
use task::AgentTaskRuntime;
use workspace::WorkspaceRuntime;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AgentSupervisorRuntime::default())
        .manage(CatalogRuntime::builtins())
        .manage(InstallRuntime::default())
        .manage(LaunchRuntime::default())
        .manage(FrameRuntime::default())
        .manage(IntegrationRuntime::default())
        .manage(SessionManager::default())
        .manage(RepositoryRuntime::default())
        .manage(SettingsRuntime::default())
        .manage(AgentTaskRuntime::default())
        .manage(WorkspaceRuntime::default())
        .setup(|app| {
            if let Err(error) = release::prepare(app.handle()) {
                eprintln!("Arkonad release data preparation did not complete: {error}");
            }
            Ok(())
        })
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
            integration::integration_list,
            integration::integration_inspect,
            integration::integration_create,
            integration::integration_refresh,
            integration::integration_run_profile_save,
            integration::integration_preview_start,
            integration::integration_preview_status,
            integration::integration_preview_stop,
            integration::integration_validation_record,
            integration::integration_rework_record,
            integration::integration_readiness_set,
            integration::integration_mark_published,
            integration::integration_abandon,
            integration::integration_cleanup,
            pty::create_session,
            pty::write_session,
            pty::resize_session,
            pty::close_session,
            repository::repository_snapshot,
            repository::repository_commit,
            repository::repository_push,
            repository::repository_create_draft_pr,
            repository::repository_merge_pr,
            repository::repository_cleanup_worktree,
            settings::settings_load,
            settings::settings_save,
            settings::settings_validate,
            settings::settings_import,
            settings::settings_export,
            release::release_status,
            release::release_restore_last_backup,
            task::agent_task_list,
            task::agent_task_plan,
            task::agent_task_create,
            task::agent_task_claim,
            task::agent_task_release,
            task::agent_task_handoff,
            task::agent_task_cancel,
            workspace::workspace_save,
            workspace::workspace_load,
            workspace::workspace_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arkonad");
}
