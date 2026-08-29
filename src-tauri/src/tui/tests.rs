use super::*;
use crate::catalog::Detection;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{backend::TestBackend, Terminal};

fn app() -> App {
    let mut app = App::new(
        Screen::Store,
        std::env::current_dir().unwrap(),
        "amber".into(),
    );
    app.entries = CatalogRuntime::builtins().list(None, None).unwrap();
    app.notice.clear();
    app
}
fn key(app: &mut App, code: KeyCode) -> Action {
    app.key(KeyEvent::new(code, KeyModifiers::NONE))
}
fn text(app: &mut App, w: u16, h: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
    terminal.draw(|frame| view::draw(frame, app)).unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}

#[test]
fn catalog_has_all_entries_and_filters_without_running_tools() {
    let mut app = app();
    assert_eq!(app.entries.len(), 36);
    key(&mut app, KeyCode::Char('/'));
    for ch in "opencode".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    assert_eq!(app.visible().len(), 1);
    assert_eq!(app.selected().unwrap().manifest.id, "opencode");
    key(&mut app, KeyCode::Esc);
    assert!(!app.editing_query);
    key(&mut app, KeyCode::Esc);
    assert_eq!(app.visible().len(), 36);
}

#[test]
fn enter_routes_installed_tools_to_handoff_and_missing_tools_to_review() {
    let mut app = app();
    assert!(matches!(
        key(&mut app, KeyCode::Enter),
        Action::InstallPlan(_)
    ));
    app.entries[0].detection = Some(Detection {
        manifest_id: app.entries[0].manifest.id.clone(),
        command: "fake".into(),
        path: "fake".into(),
        source: "test".into(),
        version: None,
    });
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::Launch(_)));
    app.navigate(Screen::Apps);
    assert_eq!(app.visible().len(), 1);
}

#[test]
fn manual_recipes_cannot_be_executed_and_cancel_never_changes_apps() {
    let mut app = app();
    let plan = InstallRuntime::build_plan(
        &app.entries
            .iter()
            .find(|e| e.manifest.id == "codex")
            .unwrap()
            .manifest,
        None,
    )
    .unwrap();
    let review = Review::install(plan);
    assert!(review.choices.is_empty());
    app.review = Some(review);
    assert!(matches!(key(&mut app, KeyCode::Char('y')), Action::None));
    assert!(matches!(key(&mut app, KeyCode::Esc), Action::None));
    assert!(app.review.is_none());
}

#[test]
fn destructive_actions_require_y_not_enter() {
    let mut app = app();
    app.review = Some(Review {
        title: "REVIEW".into(),
        body: "Confirm".into(),
        choices: vec![(
            "uninstall".into(),
            Action::Manage(crate::installer::ManagementRequest {
                manifest_id: "fake".into(),
                operation: crate::installer::ManagementOperation::Uninstall,
                method_id: None,
                confirmed: true,
            }),
        )],
        selected: 0,
        scroll: 0,
    });
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::None));
    assert!(matches!(
        key(&mut app, KeyCode::Char('y')),
        Action::Manage(_)
    ));
}

#[test]
fn busy_state_prevents_duplicate_operations_and_exit() {
    let mut app = app();
    app.busy = true;
    assert!(matches!(key(&mut app, KeyCode::Char('i')), Action::None));
    assert!(matches!(
        app.key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
        Action::None
    ));
    assert!(matches!(app.command("quit"), Action::None));
}

#[test]
fn navigation_and_empty_lists_remain_safe_after_filtering() {
    let mut app = app();
    app.query = "no-such-tool".into();
    key(&mut app, KeyCode::End);
    key(&mut app, KeyCode::Down);
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::None));
    assert!(text(&mut app, 80, 24).contains("No tools match"));
    assert!(matches!(app.command("rm -rf anything"), Action::None));
    app.command("home");
    assert_eq!(app.screen, Screen::Home);
    for ch in "/term".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::Shell));
}

#[test]
fn landing_is_command_first_and_never_executes_plain_shell_text() {
    let mut app = app();
    app.navigate(Screen::Home);
    for ch in "/st".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    assert_eq!(app.landing_matches()[0].0, "/store");
    key(&mut app, KeyCode::Tab);
    assert_eq!(app.landing_input, "/store");
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::None));
    assert_eq!(app.screen, Screen::Store);

    app.navigate(Screen::Home);
    for ch in "git status".chars() {
        key(&mut app, KeyCode::Char(ch));
    }
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::None));
    assert!(app.notice.contains("begin with /"));
}

#[test]
fn onboarding_saves_only_preferences_and_uses_real_catalog_results() {
    let mut app = app();
    app.navigate(Screen::Onboarding);
    assert!(text(&mut app, 80, 24).contains("36 catalog tools"));
    for _ in 0..4 {
        key(&mut app, KeyCode::Enter);
    }
    assert_eq!(app.onboarding_step, 4);
    let action = key(&mut app, KeyCode::Enter);
    assert!(matches!(
        action,
        Action::SaveSetup {
            startup_surface,
            theme,
            pet
        } if startup_surface == "launchpad" && theme == "amber" && pet == "none"
    ));
    assert_eq!(app.screen, Screen::Home);
}

#[test]
fn pets_are_optional_local_preferences() {
    let mut app = app();
    app.navigate(Screen::Pets);
    key(&mut app, KeyCode::Down);
    assert!(text(&mut app, 80, 24).contains("GENGAR"));
    assert!(matches!(key(&mut app, KeyCode::Enter), Action::SavePet(pet) if pet == "gengar"));
}

#[test]
fn every_screen_and_dialog_render_in_small_and_large_terminals() {
    for (w, h) in [
        (120, 40),
        (86, 24),
        (80, 24),
        (50, 18),
        (38, 12),
        (20, 8),
        (1, 1),
    ] {
        for screen in [
            Screen::Home,
            Screen::Onboarding,
            Screen::Store,
            Screen::Apps,
            Screen::Agents,
            Screen::Files,
            Screen::Git,
            Screen::Status,
            Screen::Pets,
            Screen::Settings,
        ] {
            let mut app = app();
            app.navigate(screen);
            text(&mut app, w, h);
            app.review = Some(Review::information("REVIEW", "long text\n".repeat(200)));
            text(&mut app, w, h);
            app.review = None;
            app.palette = Some("store".into());
            text(&mut app, w, h);
        }
    }
}

#[test]
fn store_matches_original_option_two_structure() {
    let mut app = app();
    let rendered = text(&mut app, 120, 40);
    for label in [
        "ARKONAD", "STORE", "QUERY>", "NAME", "TYPE", "STATE", "SOURCE", "ACTION", "INSTALL",
        "FIND", "BACK",
    ] {
        assert!(rendered.contains(label), "{label} absent");
    }
    assert!(!rendered.contains("PETS"));
    assert_eq!(
        view::Palette::named("amber").background,
        ratatui::style::Color::Black
    );
}

#[test]
fn cli_rejects_bad_arguments_and_preserves_explicit_directory() {
    assert!(Options::parse(&["--theme".into(), "unknown".into()]).is_err());
    assert!(Options::parse(&["open".into()]).is_err());
    assert!(Options::parse(&["nonsense".into()]).is_err());
    let options = Options::parse(&["store".into(), "--cwd".into(), ".".into()]).unwrap();
    assert_eq!(options.screen, Screen::Store);
    assert!(options.cwd.is_absolute());
}

#[test]
fn terminal_control_sequences_in_metadata_are_removed() {
    let rendered = view::clean("safe\u{1b}[2J\u{7}\r\t\ntext");
    assert!(!rendered.contains('\u{1b}'));
    assert!(!rendered.contains('\u{7}'));
    assert!(rendered.contains('\n'));
}

#[test]
fn short_terminal_keeps_the_selected_home_and_settings_row_visible() {
    let mut app = app();
    app.navigate(Screen::Home);
    app.landing_input = "/st".into();
    assert!(text(&mut app, 50, 16).contains("/store"));
    app.navigate(Screen::Settings);
    app.menu = THEMES.len() + 1;
    assert!(text(&mut app, 50, 16).contains("Default shell"));
}
