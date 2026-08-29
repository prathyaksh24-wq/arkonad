//! Character-cell UI. The desktop frontend is an explicit, optional build.
pub mod app;
mod pets;
mod terminal;
pub mod view;

use crate::{
    catalog::{CatalogEntry, CatalogRuntime},
    installer::{InstallOutcome, InstallPlan, InstallRuntime},
    settings::{SettingsRuntime, SettingsSaveRequest},
    storage::DataDirectory,
};
use app::{Action, App, Review, Screen, THEMES};
use crossterm::event::{self, Event};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

const HELP: &str = "Arkonad - terminal software in your terminal\n\nUsage: arkonad [home|onboard|store|apps|agents|files|git|status|pets|settings|shell]\n       arkonad open <catalog-id> [--cwd <directory>]\n       arkonad list\n\nOptions: --cwd <directory>  --theme amber|phosphor|ember|gruvbox|dracula|google84\n         --help  --version\n\nOn the landing screen, type / for commands. A child shell or TUI owns the terminal\nuntil you exit it. Install, update, and removal require a separate Y confirmation.\n";

#[derive(Debug)]
struct Options {
    screen: Screen,
    cwd: PathBuf,
    theme: Option<String>,
    launch: Option<String>,
    shell: bool,
    list: bool,
    explicit_command: bool,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut options = Self {
            screen: Screen::Home,
            cwd: std::env::current_dir().map_err(|e| e.to_string())?,
            theme: None,
            launch: None,
            shell: false,
            list: false,
            explicit_command: false,
        };
        let mut args = args.iter();
        let mut positional = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--cwd" => {
                    options.cwd = PathBuf::from(args.next().ok_or("--cwd requires a directory")?)
                }
                "--theme" => {
                    let theme = args.next().ok_or("--theme requires a name")?;
                    if !THEMES.contains(&theme.as_str()) {
                        return Err(format!("Unknown theme: {theme}"));
                    }
                    options.theme = Some(theme.clone());
                }
                value if !positional => {
                    positional = true;
                    options.explicit_command = true;
                    match value {
                        "open" => {
                            options.launch =
                                Some(args.next().ok_or("open requires a catalog id")?.clone())
                        }
                        "shell" => options.shell = true,
                        "list" => options.list = true,
                        _ => {
                            options.screen = Screen::parse(value)
                                .ok_or_else(|| format!("Unknown command: {value}. Use --help."))?
                        }
                    }
                }
                _ => return Err(format!("Unexpected argument: {arg}")),
            }
        }
        options.cwd = options
            .cwd
            .canonicalize()
            .map_err(|e| format!("Cannot open working directory: {e}"))?;
        if !options.cwd.is_dir() {
            return Err("--cwd must name a directory".into());
        }
        Ok(options)
    }
}

#[derive(Clone)]
struct Runtime {
    catalog: Arc<CatalogRuntime>,
    installer: Arc<InstallRuntime>,
    data: DataDirectory,
}
enum Reply {
    Entries(Vec<CatalogEntry>),
    Plan(Box<InstallPlan>),
    Review(Review),
    Operation(Box<InstallOutcome>, Vec<CatalogEntry>),
}
impl Runtime {
    fn job(&self, action: Action) -> Result<Reply, String> {
        match action {
            Action::Refresh => {
                self.catalog.detect()?;
                Ok(Reply::Entries(self.catalog.list(None, None)?))
            }
            Action::InstallPlan(id) => {
                let manifest = self
                    .catalog
                    .manifest(&id)
                    .ok_or_else(|| format!("Unknown catalog id: {id}"))?;
                Ok(Reply::Plan(Box::new(InstallRuntime::build_plan(
                    &manifest, None,
                )?)))
            }
            Action::Install(request) => {
                let outcome = self.installer.execute(&self.data, &self.catalog, request)?;
                self.catalog.detect()?;
                Ok(Reply::Operation(
                    Box::new(outcome),
                    self.catalog.list(None, None)?,
                ))
            }
            Action::ManagePlan(id, operation) => Ok(Reply::Review(Review::management(
                self.installer
                    .management_plan(&self.data, &self.catalog, &id, operation, None)?,
            ))),
            Action::Manage(request) => {
                let outcome =
                    self.installer
                        .execute_management(&self.data, &self.catalog, request)?;
                self.catalog.detect()?;
                Ok(Reply::Operation(
                    Box::new(outcome),
                    self.catalog.list(None, None)?,
                ))
            }
            _ => Err("This action is not a background operation".into()),
        }
    }
    fn launch(&self, id: &str, cwd: &std::path::Path) -> Result<std::process::Command, String> {
        let manifest = self
            .catalog
            .manifest(id)
            .ok_or_else(|| format!("Unknown catalog id: {id}"))?;
        let detection = self
            .catalog
            .detect()?
            .into_iter()
            .find(|d| d.manifest_id == id)
            .ok_or_else(|| {
                format!(
                    "{} was not found on PATH. Review it in Store first.",
                    manifest.name
                )
            })?;
        let profile = manifest
            .launch_profiles
            .first()
            .ok_or("This tool has no launch profile")?;
        if profile.shell.is_some() {
            return Err(
                "This profile requires an explicit shell; use the Terminal entry to launch it."
                    .into(),
            );
        }
        let cwd = profile
            .working_directory
            .as_ref()
            .map(|path| cwd.join(path))
            .unwrap_or_else(|| cwd.to_owned());
        terminal::command(&detection.path, &profile.arguments, &cwd)
    }
}

fn start_job(
    runtime: &Runtime,
    action: Action,
    tx: &mpsc::Sender<Result<Reply, String>>,
    app: &mut App,
) {
    if app.busy {
        return;
    }
    app.busy = true;
    app.notice = "Checking the selected operation...".into();
    let runtime = runtime.clone();
    let tx = tx.clone();
    std::thread::spawn(move || {
        let reply = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| runtime.job(action)))
            .unwrap_or_else(|_| {
                Err("The operation stopped unexpectedly. Check the tool before retrying.".into())
            });
        let _ = tx.send(reply);
    });
}

pub fn run(args: Vec<String>) -> Result<(), String> {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print!("{HELP}");
        return Ok(());
    }
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("arkonad {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let options = Options::parse(&args)?;
    let runtime = Runtime {
        catalog: Arc::new(CatalogRuntime::builtins()),
        installer: Arc::new(InstallRuntime::default()),
        data: DataDirectory::discover()?,
    };
    if options.list {
        runtime.catalog.detect()?;
        println!(
            "{}",
            serde_json::to_string_pretty(&runtime.catalog.list(None, None)?)
                .map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    let settings = SettingsRuntime::default();
    let saved = settings.load(&runtime.data);
    let theme = options
        .theme
        .unwrap_or_else(|| saved.settings.theme.clone());
    let startup_shell = !options.explicit_command && saved.settings.startup_surface == "terminal";
    let startup_screen = if options.explicit_command {
        options.screen
    } else {
        match saved.settings.startup_surface.as_str() {
            "store" => Screen::Store,
            "apps" => Screen::Apps,
            _ => Screen::Home,
        }
    };
    let first_run = saved.status == "default" && !options.explicit_command;
    let mut app = App::new(startup_screen, options.cwd, theme);
    app.pet = saved.settings.pet.clone();
    app.setup_startup = saved.settings.startup_surface.clone();
    app.setup_theme = app.theme.clone();
    app.setup_pet = app.pet.clone();
    if first_run {
        app.navigate(Screen::Onboarding);
    }
    app.entries = runtime.catalog.list(None, None)?;
    let mut preferred_shell = saved
        .settings
        .shell_profiles
        .iter()
        .find(|p| p.id == saved.settings.default_shell_profile_id)
        .cloned();
    app.shell_label = preferred_shell
        .as_ref()
        .map(|p| p.label.clone())
        .unwrap_or_else(|| "System default".into());
    // The parent survives Ctrl+C sent to a foreground child. In raw-mode Arkonad
    // receives Ctrl+C as a key event. Children keep their own interrupt handling.
    ctrlc::set_handler(|| {}).map_err(|e| format!("Cannot set terminal interrupt handler: {e}"))?;
    let mut session = terminal::TerminalSession::enter().map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    let mut initial = if options.shell || startup_shell {
        Some(Action::Shell)
    } else {
        options.launch.map(Action::Launch)
    };
    if initial.is_none() {
        start_job(&runtime, Action::Refresh, &tx, &mut app);
    }
    let started = Instant::now();
    loop {
        app.tick_ms = started.elapsed().as_millis();
        while let Ok(reply) = rx.try_recv() {
            app.busy = false;
            match reply {
                Ok(Reply::Entries(entries)) => {
                    app.entries = entries;
                    app.notice = "PATH checked. ? keys / : commands".into();
                }
                Ok(Reply::Plan(plan)) => {
                    app.review = Some(Review::install(*plan));
                    app.notice = "Review each command before approving it.".into();
                }
                Ok(Reply::Review(review)) => app.review = Some(review),
                Ok(Reply::Operation(outcome, entries)) => {
                    app.entries = entries;
                    app.notice = outcome.message.clone();
                    app.review = Some(Review::information(
                        outcome.state.to_uppercase(),
                        format!(
                            "{}\n\n{}\n\n{}",
                            outcome.message,
                            outcome.logs,
                            outcome.manual_recovery.unwrap_or_default()
                        ),
                    ));
                }
                Err(error) => {
                    app.notice = error.clone();
                    app.review = Some(Review::information("OPERATION ERROR", error));
                }
            }
            if saved.status == "invalid" {
                app.notice = saved.message.clone();
            }
        }
        session
            .terminal
            .draw(|frame| view::draw(frame, &mut app))
            .map_err(|e| e.to_string())?;
        let action = if let Some(action) = initial.take() {
            action
        } else if event::poll(Duration::from_millis(100)).map_err(|e| e.to_string())? {
            match event::read().map_err(|e| e.to_string())? {
                Event::Key(key) => app.key(key),
                _ => Action::None,
            }
        } else {
            Action::None
        };
        match action {
            Action::None => {}
            Action::Quit => break,
            Action::Shell | Action::Launch(_) => {
                let command = match &action {
                    Action::Shell => terminal::shell(
                        &app.cwd,
                        preferred_shell
                            .as_ref()
                            .and_then(|p| p.executable.as_deref()),
                    ),
                    Action::Launch(id) => runtime.launch(id, &app.cwd),
                    _ => unreachable!(),
                };
                match command {
                    Ok(mut command) => match session
                        .handoff(&mut command)
                        .map_err(|error| format!("Could not restore the terminal: {error}"))?
                    {
                        Ok(status) => app.notice = format!("Returned to Arkonad. Child {status}."),
                        Err(error) => app.notice = format!("Could not run the tool: {error}"),
                    },
                    Err(error) => app.review = Some(Review::information("LAUNCH", error)),
                }
                runtime.catalog.detect()?;
                app.entries = runtime.catalog.list(None, None)?;
            }
            Action::SaveTheme(_)
            | Action::SavePet(_)
            | Action::SaveSetup { .. }
            | Action::SaveShell => {
                let loaded = settings.load(&runtime.data);
                if loaded.status == "invalid" {
                    app.review = Some(Review::information(
                        "SETTINGS LEFT UNCHANGED",
                        loaded.message,
                    ));
                    continue;
                }
                let mut document = loaded.settings;
                match action {
                    Action::SaveTheme(theme) => document.theme = theme,
                    Action::SavePet(pet) => document.pet = pet,
                    Action::SaveSetup {
                        startup_surface,
                        theme,
                        pet,
                    } => {
                        document.startup_surface = startup_surface;
                        document.theme = theme;
                        document.pet = pet;
                    }
                    Action::SaveShell => {
                        let available = document
                            .shell_profiles
                            .iter()
                            .filter(|profile| {
                                profile
                                    .executable
                                    .as_deref()
                                    .is_none_or(|exe| crate::executable::resolve(exe).is_some())
                            })
                            .collect::<Vec<_>>();
                        let index = available
                            .iter()
                            .position(|profile| profile.id == document.default_shell_profile_id)
                            .unwrap_or(0);
                        if let Some(profile) = available.get((index + 1) % available.len().max(1)) {
                            document.default_shell_profile_id = profile.id.clone();
                        }
                    }
                    _ => unreachable!(),
                }
                match settings.save(&runtime.data, SettingsSaveRequest { settings: document }) {
                    Ok(document) => {
                        app.theme = document.theme;
                        app.pet = document.pet;
                        preferred_shell = document
                            .shell_profiles
                            .into_iter()
                            .find(|p| p.id == document.default_shell_profile_id);
                        app.shell_label = preferred_shell
                            .as_ref()
                            .map(|p| p.label.clone())
                            .unwrap_or_else(|| "System default".into());
                        app.notice = "Settings saved.".into();
                    }
                    Err(error) => app.notice = error,
                }
            }
            action => start_job(&runtime, action, &tx, &mut app),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
