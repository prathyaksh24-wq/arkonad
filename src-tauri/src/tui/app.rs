use crate::catalog::{CatalogCategory, CatalogEntry};
use crate::installer::{
    InstallPlan, InstallRequest, ManagementOperation, ManagementPlan, ManagementRequest,
    PrerequisiteAvailability,
};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::widgets::TableState;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    Home,
    Onboarding,
    Store,
    Apps,
    Agents,
    Files,
    Git,
    Status,
    Pets,
    Settings,
}
impl Screen {
    pub fn title(self) -> &'static str {
        match self {
            Self::Home => "WELCOME",
            Self::Onboarding => "SETUP",
            Self::Store => "STORE",
            Self::Apps => "MY APPS",
            Self::Agents => "AGENTS",
            Self::Files => "FILE TOOLS",
            Self::Git => "GIT TOOLS",
            Self::Status => "STATUS",
            Self::Pets => "PETS",
            Self::Settings => "SETTINGS",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "home" => Some(Self::Home),
            "onboard" | "onboarding" => Some(Self::Onboarding),
            "store" => Some(Self::Store),
            "apps" => Some(Self::Apps),
            "agents" => Some(Self::Agents),
            "files" => Some(Self::Files),
            "git" => Some(Self::Git),
            "status" => Some(Self::Status),
            "pets" => Some(Self::Pets),
            "settings" => Some(Self::Settings),
            _ => None,
        }
    }
}

pub const THEMES: &[&str] = &[
    "amber", "phosphor", "ember", "gruvbox", "dracula", "google84",
];
pub const PETS: &[&str] = &["none", "gengar", "snorlax"];
pub const STARTUP_SURFACES: &[(&str, &str)] = &[
    ("launchpad", "Arkonad command prompt"),
    ("terminal", "Your normal interactive shell"),
    ("store", "Arkonad Store"),
];
pub const LANDING_COMMANDS: &[(&str, &str)] = &[
    ("/store", "browse terminal software"),
    ("/apps", "open tools already found"),
    ("/agents", "launch a coding agent TUI"),
    ("/term", "hand off to your real shell"),
    ("/status", "inspect this terminal session"),
    ("/theme", "change the color scheme"),
    ("/pets", "choose a terminal companion"),
    ("/onboard", "run guided setup again"),
    ("/help", "show keys and commands"),
];

#[derive(Clone, Debug)]
pub enum Action {
    None,
    Quit,
    Shell,
    Launch(String),
    Refresh,
    InstallPlan(String),
    Install(InstallRequest),
    ManagePlan(String, ManagementOperation),
    Manage(ManagementRequest),
    SaveTheme(String),
    SavePet(String),
    SaveSetup {
        startup_surface: String,
        theme: String,
        pet: String,
    },
    SaveShell,
}

#[derive(Clone, Debug)]
pub struct Review {
    pub title: String,
    pub body: String,
    pub choices: Vec<(String, Action)>,
    pub selected: usize,
    pub scroll: u16,
}

impl Review {
    pub fn information(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
            choices: vec![],
            selected: 0,
            scroll: 0,
        }
    }
    pub fn install(plan: InstallPlan) -> Self {
        let mut body = format!("{}\nPublisher: {}\nSource: {}\nMethod: {}\nPrivileges: {:?}\nData: {}\nRollback: {}\n\n",
            plan.tool_name, plan.publisher, plan.package_source, plan.method_label, plan.privileges, plan.data_expectations, plan.rollback_limits);
        let mut choices = vec![];
        for step in &plan.prerequisites {
            body.push_str(&format!(
                "{}: {:?}\n{}\nSource: {}\nCommand: {}\nPrivileges: {:?}\nRollback: {}\n\n",
                step.label,
                step.availability,
                step.description,
                step.source.as_deref().unwrap_or("not declared"),
                display_command(step.command.as_deref()),
                step.privileges,
                step.rollback_limits
            ));
            if step.availability != PrerequisiteAvailability::Ready && step.command.is_some() {
                choices.push((
                    step.label.clone(),
                    Action::Install(InstallRequest {
                        manifest_id: plan.manifest_id.clone(),
                        method_id: Some(plan.method_id.clone()),
                        step_id: step.id.clone(),
                        confirmed: true,
                    }),
                ));
            }
        }
        body.push_str(&format!(
            "Install command: {}\n",
            display_command(plan.command.as_deref())
        ));
        if plan.supported && plan.prerequisites_ready {
            choices.push((
                format!("Install {}", plan.tool_name),
                Action::Install(InstallRequest {
                    manifest_id: plan.manifest_id,
                    method_id: Some(plan.method_id),
                    step_id: "application".into(),
                    confirmed: true,
                }),
            ));
        } else if let Some(note) = plan.manual_instructions {
            body.push_str(&note);
        } else {
            body.push_str("Complete the missing prerequisites, then review installation again.");
        }
        Self {
            title: "REVIEW INSTALL".into(),
            body,
            choices,
            selected: 0,
            scroll: 0,
        }
    }
    pub fn management(plan: ManagementPlan) -> Self {
        let body = format!("{} / {:?}\nSource: {}\nOwnership: {}\nPrivileges: {:?}\nCommand: {}\nData: {}\nRollback: {}\n\n{}",
            plan.tool_name, plan.operation, plan.source, plan.ownership, plan.privileges,
            display_command(plan.command.as_deref()), plan.data_expectations, plan.rollback_limits,
            plan.manual_instructions.as_deref().unwrap_or("This runs only after you press Y."));
        let choices = if plan.supported {
            vec![(
                format!("{:?} {}", plan.operation, plan.tool_name),
                Action::Manage(ManagementRequest {
                    manifest_id: plan.manifest_id,
                    operation: plan.operation,
                    method_id: plan.method_id,
                    confirmed: true,
                }),
            )]
        } else {
            vec![]
        };
        Self {
            title: "REVIEW APP CHANGE".into(),
            body,
            choices,
            selected: 0,
            scroll: 0,
        }
    }
}

pub fn display_command(argv: Option<&[String]>) -> String {
    argv.map(|args| {
        args.iter()
            .map(|arg| {
                if arg.contains(char::is_whitespace) {
                    format!("{arg:?}")
                } else {
                    arg.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    })
    .unwrap_or_else(|| "publisher instructions only".into())
}

pub struct App {
    pub screen: Screen,
    pub entries: Vec<CatalogEntry>,
    pub table: TableState,
    pub menu: usize,
    pub landing_input: String,
    pub landing_selected: usize,
    pub query: String,
    pub editing_query: bool,
    pub palette: Option<String>,
    pub review: Option<Review>,
    pub busy: bool,
    pub notice: String,
    pub theme: String,
    pub pet: String,
    pub tick_ms: u128,
    pub onboarding_step: usize,
    pub onboarding_choice: usize,
    pub setup_startup: String,
    pub setup_theme: String,
    pub setup_pet: String,
    pub cwd: PathBuf,
    pub shell_label: String,
}

impl App {
    pub fn new(screen: Screen, cwd: PathBuf, theme: String) -> Self {
        Self {
            screen,
            entries: vec![],
            table: TableState::default().with_selected(0),
            menu: 0,
            landing_input: String::new(),
            landing_selected: 0,
            query: String::new(),
            editing_query: false,
            palette: None,
            review: None,
            busy: false,
            notice: "Checking tools on PATH...".into(),
            theme,
            pet: "none".into(),
            tick_ms: 0,
            onboarding_step: 0,
            onboarding_choice: 0,
            setup_startup: "launchpad".into(),
            setup_theme: "amber".into(),
            setup_pet: "none".into(),
            cwd,
            shell_label: "System default".into(),
        }
    }
    pub fn visible(&self) -> Vec<&CatalogEntry> {
        let tokens = self.query.to_lowercase();
        self.entries
            .iter()
            .filter(|entry| {
                let category = match self.screen {
                    Screen::Apps => entry.detection.is_some(),
                    Screen::Agents => entry.manifest.category == CatalogCategory::Agent,
                    Screen::Files => entry.manifest.category == CatalogCategory::Productivity,
                    Screen::Git => entry.manifest.category == CatalogCategory::Git,
                    _ => true,
                };
                let text = format!(
                    "{} {} {} {}",
                    entry.manifest.id,
                    entry.manifest.name,
                    entry.manifest.summary,
                    entry.manifest.publisher
                )
                .to_lowercase();
                category && tokens.split_whitespace().all(|word| text.contains(word))
            })
            .collect()
    }
    pub fn selected(&self) -> Option<&CatalogEntry> {
        self.visible()
            .get(self.table.selected().unwrap_or(0))
            .copied()
    }
    pub fn navigate(&mut self, screen: Screen) {
        self.screen = screen;
        self.query.clear();
        self.editing_query = false;
        self.menu = 0;
        self.table = TableState::default().with_selected(0);
        if screen == Screen::Onboarding {
            self.onboarding_step = 0;
            self.onboarding_choice = 0;
            self.setup_theme = self.theme.clone();
            self.setup_pet = self.pet.clone();
        }
    }

    pub fn landing_matches(&self) -> Vec<&'static (&'static str, &'static str)> {
        if !self.landing_input.starts_with('/') {
            return vec![];
        }
        LANDING_COMMANDS
            .iter()
            .filter(|(command, _)| command.starts_with(&self.landing_input))
            .collect()
    }

    fn help(&mut self) {
        self.review = Some(Review::information(
            "KEYS / COMMANDS",
            "Landing: type / to see commands; Tab completes; arrows select.\nStore: arrows or j/k move; / searches; i reviews install; u/x/a review app changes.\nTerminal: /term gives the whole terminal to your real shell. Exit returns here.\n\n/store  /apps  /agents  /term  /status  /theme  /pets  /onboard\n\nArkonad never restyles a launched tool. Install, update, adoption, and removal still require a separate Y confirmation.",
        ));
    }

    fn landing_key(&mut self, key: KeyEvent) -> Action {
        let count = self.landing_matches().len();
        match key.code {
            KeyCode::Esc if !self.landing_input.is_empty() => {
                self.landing_input.clear();
                self.landing_selected = 0;
            }
            KeyCode::Esc | KeyCode::Char('q') if self.landing_input.is_empty() && !self.busy => {
                return Action::Quit
            }
            KeyCode::Backspace => {
                self.landing_input.pop();
                self.landing_selected = 0;
            }
            KeyCode::Down => {
                self.landing_selected = (self.landing_selected + 1).min(count.saturating_sub(1))
            }
            KeyCode::Up => self.landing_selected = self.landing_selected.saturating_sub(1),
            KeyCode::Tab if count > 0 => {
                self.landing_input = self.landing_matches()[self.landing_selected.min(count - 1)]
                    .0
                    .to_owned();
            }
            KeyCode::Enter if !self.busy => {
                let command = if count > 0 {
                    self.landing_matches()[self.landing_selected.min(count - 1)]
                        .0
                        .to_owned()
                } else {
                    self.landing_input.clone()
                };
                self.landing_input.clear();
                self.landing_selected = 0;
                if command.trim().is_empty() {
                    return Action::None;
                }
                return self.command(&command);
            }
            KeyCode::Char('?') if self.landing_input.is_empty() => self.help(),
            KeyCode::Char(ch) if !ch.is_control() => {
                self.landing_input.push(ch);
                self.landing_selected = 0;
            }
            _ => {}
        }
        Action::None
    }

    fn onboarding_key(&mut self, key: KeyEvent) -> Action {
        let len = match self.onboarding_step {
            1 => STARTUP_SURFACES.len(),
            2 => THEMES.len(),
            3 => PETS.len(),
            _ => 1,
        };
        match key.code {
            KeyCode::Esc if self.onboarding_step > 0 => {
                if self.onboarding_step == 2 {
                    self.theme = self.setup_theme.clone();
                }
                self.onboarding_step -= 1;
                self.onboarding_choice = 0;
            }
            KeyCode::Esc | KeyCode::Char('q') => {
                self.theme = self.setup_theme.clone();
                self.navigate(Screen::Home)
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.onboarding_choice = (self.onboarding_choice + 1).min(len.saturating_sub(1));
                if self.onboarding_step == 2 {
                    self.theme = THEMES[self.onboarding_choice].into();
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                self.onboarding_choice = self.onboarding_choice.saturating_sub(1);
                if self.onboarding_step == 2 {
                    self.theme = THEMES[self.onboarding_choice].into();
                }
            }
            KeyCode::Enter => {
                match self.onboarding_step {
                    0 => {}
                    1 => self.setup_startup = STARTUP_SURFACES[self.onboarding_choice].0.into(),
                    2 => {
                        self.setup_theme = THEMES[self.onboarding_choice].into();
                        self.theme = self.setup_theme.clone();
                    }
                    3 => self.setup_pet = PETS[self.onboarding_choice].into(),
                    _ => {
                        let action = Action::SaveSetup {
                            startup_surface: self.setup_startup.clone(),
                            theme: self.setup_theme.clone(),
                            pet: self.setup_pet.clone(),
                        };
                        self.navigate(Screen::Home);
                        return action;
                    }
                }
                self.onboarding_step += 1;
                self.onboarding_choice = match self.onboarding_step {
                    1 => STARTUP_SURFACES
                        .iter()
                        .position(|(id, _)| *id == self.setup_startup)
                        .unwrap_or(0),
                    2 => THEMES
                        .iter()
                        .position(|theme| *theme == self.setup_theme)
                        .unwrap_or(0),
                    3 => PETS
                        .iter()
                        .position(|pet| *pet == self.setup_pet)
                        .unwrap_or(0),
                    _ => 0,
                };
            }
            _ => {}
        }
        Action::None
    }

    fn pets_key(&mut self, key: KeyEvent) -> Action {
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => self.navigate(Screen::Home),
            KeyCode::Down | KeyCode::Char('j') => {
                self.menu = (self.menu + 1).min(PETS.len().saturating_sub(1))
            }
            KeyCode::Up | KeyCode::Char('k') => self.menu = self.menu.saturating_sub(1),
            KeyCode::Enter => return Action::SavePet(PETS[self.menu].into()),
            _ => {}
        }
        Action::None
    }

    pub fn key(&mut self, key: KeyEvent) -> Action {
        if key.kind == KeyEventKind::Release {
            return Action::None;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            if self.busy {
                self.notice =
                    "An app operation is still running; wait for its result before quitting."
                        .into();
                return Action::None;
            }
            return Action::Quit;
        }
        if let Some(review) = &mut self.review {
            match key.code {
                KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('n') => self.review = None,
                KeyCode::Down | KeyCode::Char('j') => {
                    review.scroll = review.scroll.saturating_add(1)
                }
                KeyCode::Up | KeyCode::Char('k') => review.scroll = review.scroll.saturating_sub(1),
                KeyCode::PageDown => review.scroll = review.scroll.saturating_add(8),
                KeyCode::PageUp => review.scroll = review.scroll.saturating_sub(8),
                KeyCode::Tab if !review.choices.is_empty() => {
                    review.selected = (review.selected + 1) % review.choices.len()
                }
                KeyCode::Char('y') if !self.busy && !review.choices.is_empty() => {
                    let action = review.choices[review.selected].1.clone();
                    self.review = None;
                    return action;
                }
                _ => {}
            }
            return Action::None;
        }
        if let Some(input) = &mut self.palette {
            match key.code {
                KeyCode::Esc => self.palette = None,
                KeyCode::Backspace => {
                    input.pop();
                }
                KeyCode::Char(ch) if !ch.is_control() => input.push(ch),
                KeyCode::Enter => {
                    let input = self.palette.take().unwrap();
                    return self.command(&input);
                }
                _ => {}
            }
            return Action::None;
        }
        if self.screen == Screen::Home {
            return self.landing_key(key);
        }
        if self.screen == Screen::Onboarding {
            return self.onboarding_key(key);
        }
        if self.screen == Screen::Pets {
            return self.pets_key(key);
        }
        if self.screen == Screen::Status {
            return match key.code {
                KeyCode::Char('r') if !self.busy => Action::Refresh,
                KeyCode::Esc | KeyCode::Char('q') => {
                    self.navigate(Screen::Home);
                    Action::None
                }
                _ => Action::None,
            };
        }
        if self.editing_query {
            match key.code {
                KeyCode::Esc | KeyCode::Enter => self.editing_query = false,
                KeyCode::Backspace => {
                    self.query.pop();
                    self.table.select(Some(0));
                }
                KeyCode::Char(ch) if !ch.is_control() => {
                    self.query.push(ch);
                    self.table.select(Some(0));
                }
                _ => {}
            }
            return Action::None;
        }
        if key.code == KeyCode::Char(':')
            || (key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('p'))
        {
            self.palette = Some(String::new());
            return Action::None;
        }
        let len = match self.screen {
            Screen::Settings => THEMES.len() + 2,
            _ => self.visible().len(),
        };
        let selected = match self.screen {
            Screen::Settings => self.menu,
            _ => self.table.selected().unwrap_or(0),
        };
        let next = match key.code {
            KeyCode::Down | KeyCode::Char('j') => Some((selected + 1).min(len.saturating_sub(1))),
            KeyCode::Up | KeyCode::Char('k') => Some(selected.saturating_sub(1)),
            KeyCode::PageDown => Some((selected + 10).min(len.saturating_sub(1))),
            KeyCode::PageUp => Some(selected.saturating_sub(10)),
            KeyCode::Home => Some(0),
            KeyCode::End => Some(len.saturating_sub(1)),
            _ => None,
        };
        if let Some(next) = next {
            self.menu = next;
            self.table.select(Some(next));
            return Action::None;
        }
        match key.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                if !self.query.is_empty() {
                    self.query.clear();
                    self.table.select(Some(0));
                } else {
                    self.navigate(Screen::Home);
                }
            }
            KeyCode::Char('/') if !matches!(self.screen, Screen::Home | Screen::Settings) => {
                self.editing_query = true
            }
            KeyCode::Char('r') if !self.busy => return Action::Refresh,
            KeyCode::Char('s') if !self.busy => return Action::Shell,
            KeyCode::Char('?') => self.help(),
            KeyCode::Enter if !self.busy => {
                if self.screen == Screen::Settings {
                    if self.menu < THEMES.len() {
                        return Action::SaveTheme(THEMES[self.menu].into());
                    }
                    if self.menu == THEMES.len() {
                        return Action::SavePet(
                            PETS[(PETS.iter().position(|pet| *pet == self.pet).unwrap_or(0) + 1)
                                % PETS.len()]
                            .into(),
                        );
                    }
                    return Action::SaveShell;
                } else if let Some(entry) = self.selected() {
                    return if entry.detection.is_some() {
                        Action::Launch(entry.manifest.id.clone())
                    } else {
                        Action::InstallPlan(entry.manifest.id.clone())
                    };
                }
            }
            KeyCode::Char('i' | 'u' | 'x' | 'a' | 'v')
                if !self.busy && self.screen != Screen::Settings =>
            {
                if let Some(entry) = self.selected() {
                    let id = entry.manifest.id.clone();
                    match key.code {
                        KeyCode::Char('i') => return Action::InstallPlan(id),
                        KeyCode::Char('u') => {
                            return Action::ManagePlan(id, ManagementOperation::Update)
                        }
                        KeyCode::Char('x') => {
                            return Action::ManagePlan(id, ManagementOperation::Uninstall)
                        }
                        KeyCode::Char('a') => {
                            return Action::ManagePlan(id, ManagementOperation::Adopt)
                        }
                        _ => {
                            self.review = Some(Review::information(
                                "PUBLISHER / DATA",
                                format!(
                                    "{}\n{}\n\n{}\n\nNetwork: {}\n\nData locations:\n{}",
                                    entry.manifest.name,
                                    entry.manifest.source.url,
                                    entry.manifest.summary,
                                    entry.manifest.network_expectations.summary,
                                    entry
                                        .manifest
                                        .data_locations
                                        .iter()
                                        .map(|d| format!("{}: {}", d.kind, d.path))
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                ),
                            ))
                        }
                    }
                }
            }
            _ => {}
        }
        Action::None
    }
    pub fn command(&mut self, input: &str) -> Action {
        let input = input.trim();
        let input = input.strip_prefix('/').unwrap_or(input);
        if let Some(screen) = Screen::parse(input) {
            self.navigate(screen);
            return Action::None;
        }
        if self.busy {
            self.notice = "Wait for the current operation to finish.".into();
            return Action::None;
        }
        match input {
            "shell" | "terminal" | "term" => Action::Shell,
            "theme" => {
                self.navigate(Screen::Settings);
                Action::None
            }
            "help" => {
                self.help();
                Action::None
            }
            "quit" => Action::Quit,
            _ if input.starts_with("open ") => Action::Launch(input[5..].trim().into()),
            _ if input.starts_with("cd ") => {
                let path = self.cwd.join(input[3..].trim());
                match path.canonicalize().and_then(|path| {
                    if path.is_dir() {
                        Ok(path)
                    } else {
                        Err(std::io::Error::other("not a directory"))
                    }
                }) {
                    Ok(path) => {
                        self.cwd = path;
                        self.notice = "Working directory changed.".into();
                    }
                    Err(_) => {
                        self.notice = "That directory does not exist or cannot be opened.".into()
                    }
                }
                Action::None
            }
            _ => {
                self.notice = "Arkonad commands begin with /. Use /term for shell commands.".into();
                Action::None
            }
        }
    }
}
