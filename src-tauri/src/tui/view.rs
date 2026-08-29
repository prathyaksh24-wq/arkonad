use super::{
    app::{App, Screen, PETS, STARTUP_SURFACES, THEMES},
    pets::{self, SpriteColors},
};
use crate::catalog::{CatalogCategory, CatalogEntry};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph, Row, Table, TableState, Wrap},
    Frame,
};

#[derive(Clone, Copy)]
pub struct Palette {
    pub text: Color,
    pub info: Color,
    pub background: Color,
    pub dim: Color,
    pub accent: Color,
    pub border: Color,
    pub ok: Color,
    pub error: Color,
}
impl Palette {
    pub fn named(name: &str) -> Self {
        match name {
            "phosphor" | "carbon" => Self {
                text: Color::Rgb(190, 255, 205),
                info: Color::Rgb(140, 255, 190),
                background: Color::Rgb(6, 12, 8),
                dim: Color::Rgb(70, 140, 90),
                accent: Color::Rgb(0, 255, 140),
                border: Color::Rgb(0, 110, 60),
                ok: Color::Rgb(0, 255, 140),
                error: Color::Rgb(255, 80, 80),
            },
            "ember" => Self {
                text: Color::Rgb(242, 229, 213),
                info: Color::Rgb(255, 178, 107),
                background: Color::Rgb(23, 19, 16),
                dim: Color::Rgb(138, 122, 106),
                accent: Color::Rgb(255, 122, 61),
                border: Color::Rgb(90, 70, 54),
                ok: Color::Rgb(163, 190, 140),
                error: Color::Rgb(224, 108, 117),
            },
            "gruvbox" => Self {
                text: Color::Rgb(235, 219, 178),
                info: Color::Rgb(184, 187, 38),
                background: Color::Rgb(40, 40, 40),
                dim: Color::Rgb(146, 131, 116),
                accent: Color::Rgb(250, 189, 47),
                border: Color::Rgb(102, 92, 84),
                ok: Color::Rgb(184, 187, 38),
                error: Color::Rgb(204, 36, 29),
            },
            "dracula" | "midnight" => Self {
                text: Color::Rgb(248, 248, 242),
                info: Color::Rgb(139, 233, 253),
                background: Color::Rgb(40, 42, 54),
                dim: Color::Rgb(98, 114, 164),
                accent: Color::Rgb(189, 147, 249),
                border: Color::Rgb(68, 71, 90),
                ok: Color::Rgb(80, 250, 123),
                error: Color::Rgb(255, 85, 85),
            },
            "google84" => Self {
                text: Color::Rgb(235, 235, 235),
                info: Color::Rgb(66, 133, 244),
                background: Color::Black,
                dim: Color::Rgb(120, 120, 120),
                accent: Color::Rgb(52, 168, 83),
                border: Color::Rgb(60, 60, 60),
                ok: Color::Rgb(52, 168, 83),
                error: Color::Rgb(234, 67, 53),
            },
            _ => Self {
                text: Color::Rgb(255, 220, 160),
                info: Color::Rgb(255, 220, 120),
                background: Color::Black,
                dim: Color::Rgb(150, 110, 60),
                accent: Color::Rgb(255, 176, 0),
                border: Color::Rgb(120, 85, 20),
                ok: Color::Rgb(180, 255, 140),
                error: Color::Rgb(255, 90, 80),
            },
        }
    }
    fn base(self) -> Style {
        Style::default().fg(self.text).bg(self.background)
    }
    fn selected(self) -> Style {
        self.base()
            .add_modifier(Modifier::REVERSED | Modifier::BOLD)
    }
}

pub fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect()
}
fn border(palette: Palette) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Plain)
        .border_style(Style::default().fg(palette.border))
        .style(palette.base())
}
pub fn kind(category: &CatalogCategory) -> &'static str {
    match category {
        CatalogCategory::Agent => "agent",
        CatalogCategory::Productivity => "file / productivity",
        CatalogCategory::Git => "git client",
    }
}
pub fn state(entry: &CatalogEntry) -> &'static str {
    if entry.detection.is_some() {
        "ready"
    } else if cfg!(windows)
        && entry.manifest.install_methods.iter().any(|method| {
            method.kind == "winget"
                && method.command.is_some()
                && method.verification_command.is_some()
        })
    {
        "install"
    } else {
        "source only"
    }
}

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let palette = Palette::named(&app.theme);
    frame.render_widget(Block::default().style(palette.base()), area);
    if area.width < 38 || area.height < 16 {
        frame.render_widget(
            Paragraph::new("ARKONAD\nEnlarge terminal to 38 x 16.\nCtrl+C quits.")
                .style(palette.base()),
            area,
        );
        return;
    }
    if matches!(
        app.screen,
        Screen::Home | Screen::Onboarding | Screen::Status | Screen::Pets
    ) {
        match app.screen {
            Screen::Home => home(frame, app, area, palette),
            Screen::Onboarding => onboarding(frame, app, area, palette),
            Screen::Status => status(frame, app, area, palette),
            Screen::Pets => pets_screen(frame, app, area, palette),
            _ => unreachable!(),
        }
        overlays(frame, app, area, palette);
        return;
    }
    let regions = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(3),
        Constraint::Min(1),
        Constraint::Length(1),
        Constraint::Length(3),
    ])
    .split(area);
    let header = border(palette);
    let inner = header.inner(regions[0]);
    frame.render_widget(header, regions[0]);
    let head = Layout::horizontal([
        Constraint::Min(1),
        Constraint::Length(if area.width >= 70 { 27 } else { 0 }),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(format!(
            " ARKONAD {} / {}",
            env!("CARGO_PKG_VERSION"),
            app.screen.title()
        ))
        .style(palette.base().add_modifier(Modifier::BOLD)),
        head[0],
    );
    frame.render_widget(
        Paragraph::new(format!(
            "{} tools / {} found",
            app.entries.len(),
            app.entries.iter().filter(|e| e.detection.is_some()).count()
        ))
        .alignment(ratatui::layout::Alignment::Right),
        head[1],
    );

    let query = if app.screen == Screen::Settings {
        format!(" DIR> {}", clean(&app.cwd.display().to_string()))
    } else {
        format!(
            " QUERY> {}{}",
            clean(&app.query),
            if app.editing_query { "_" } else { "" }
        )
    };
    frame.render_widget(Paragraph::new(query).block(border(palette)), regions[1]);
    match app.screen {
        Screen::Settings => settings(frame, app, regions[2], palette),
        _ => catalog(frame, app, regions[2], palette),
    }
    frame.render_widget(
        Paragraph::new(clean(&format!(
            " {}{}",
            if app.busy { "working / " } else { "" },
            app.notice
        )))
        .style(Style::default().fg(palette.info)),
        regions[3],
    );
    let keys = if app.screen == Screen::Settings && area.width < 90 {
        " ↑↓ move  enter apply  esc back  ?"
    } else if area.width < 50 {
        " ↑↓ move  enter open  esc back  ?"
    } else if area.width < 90 {
        " j/k move  enter open  / find  esc back  ? keys"
    } else if app.screen == Screen::Settings {
        " [↑↓] SELECT    [ENTER] APPLY    [:] COMMANDS    [ESC] BACK"
    } else {
        " [↑↓] SELECT   [ENTER] OPEN   [I] INSTALL   [/] FIND   [ESC] BACK   [?] KEYS"
    };
    frame.render_widget(Paragraph::new(keys).block(border(palette)), regions[4]);
    overlays(frame, app, area, palette);
}

fn overlays(frame: &mut Frame, app: &mut App, area: Rect, palette: Palette) {
    if let Some(input) = &app.palette {
        let modal = centered(area, 80, 9);
        frame.render_widget(Clear, modal);
        frame.render_widget(Paragraph::new(format!("\n : {}_\n\n home  store  apps  agents  files  git  status  pets  settings\n shell   open <id>   cd <path>   quit\n\n Enter run / Esc cancel", clean(input)))
            .wrap(Wrap { trim: false }).block(border(palette).title(" COMMANDS ")), modal);
    }
    if let Some(review) = &mut app.review {
        let modal = centered(
            area,
            area.width.saturating_sub(6),
            area.height.saturating_sub(4),
        );
        frame.render_widget(Clear, modal);
        let block = border(palette).title(format!(" {} ", review.title));
        let inner = block.inner(modal);
        frame.render_widget(block, modal);
        let sections = Layout::vertical([Constraint::Min(1), Constraint::Length(2)]).split(inner);
        let lines = clean(&review.body);
        let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false });
        let max_scroll = paragraph
            .line_count(sections[0].width)
            .saturating_sub(sections[0].height as usize)
            .min(u16::MAX as usize) as u16;
        review.scroll = review.scroll.min(max_scroll);
        frame.render_widget(paragraph.scroll((review.scroll, 0)), sections[0]);
        let footer = review
            .choices
            .get(review.selected)
            .map(|(label, _)| {
                format!(" [Y] {label}   [Tab] next step\n ↑↓ scroll  PgUp/PgDn  Esc cancel")
            })
            .unwrap_or_else(|| " ↑↓ scroll  PgUp/PgDn\n Esc back".into());
        frame.render_widget(
            Paragraph::new(footer).style(palette.base().add_modifier(Modifier::BOLD)),
            sections[1],
        );
    }
}

fn catalog(frame: &mut Frame, app: &mut App, area: Rect, palette: Palette) {
    let columns = if area.width >= 86 {
        Layout::horizontal([Constraint::Percentage(65), Constraint::Percentage(35)]).split(area)
    } else {
        Layout::horizontal([Constraint::Percentage(100), Constraint::Length(0)]).split(area)
    };
    let entries = app.visible();
    let selected = app
        .table
        .selected()
        .unwrap_or(0)
        .min(entries.len().saturating_sub(1));
    let detail = entries.get(selected).map(|entry| {
        format!("\n NAME    {}\n\n TYPE    {}\n\n STATE   {}\n\n SOURCE\n {}\n\n {}\n\n ACTION\n {}\n\n [v] publisher / data\n [u] update  [x] uninstall\n [a] adopt  [s] shell", clean(&entry.manifest.name), kind(&entry.manifest.category), state(entry),
            clean(&entry.manifest.source.url), clean(&entry.manifest.summary), if entry.detection.is_some() { "Enter to open" } else { "i to review installation" })
    });
    let rows = entries
        .iter()
        .enumerate()
        .map(|(idx, entry)| {
            Row::new(vec![
                format!("{:02}.", idx + 1),
                clean(&entry.manifest.name),
                kind(&entry.manifest.category).into(),
                state(entry).into(),
            ])
        })
        .collect::<Vec<_>>();
    let widths = if columns[0].width >= 68 {
        vec![
            Constraint::Length(4),
            Constraint::Percentage(40),
            Constraint::Min(8),
            Constraint::Length(11),
        ]
    } else {
        vec![
            Constraint::Length(3),
            Constraint::Min(8),
            Constraint::Length(0),
            Constraint::Length(11),
        ]
    };
    let empty = rows.is_empty();
    drop(entries);
    app.table.select(if empty { None } else { Some(selected) });
    frame.render_stateful_widget(
        Table::new(rows, widths)
            .header(Row::new(["#", "NAME", "TYPE", "STATE"]).height(2))
            .column_spacing(1)
            .block(border(palette))
            .row_highlight_style(palette.selected()),
        columns[0],
        &mut app.table,
    );
    if empty {
        frame.render_widget(
            Paragraph::new("No tools match.\nClear search or open Store from :commands.")
                .wrap(Wrap { trim: false }),
            border(palette).inner(columns[0]),
        );
    }
    if columns[1].width > 0 {
        frame.render_widget(
            Paragraph::new(detail.unwrap_or_else(|| "Select a tool to inspect it.".into()))
                .wrap(Wrap { trim: false })
                .block(border(palette)),
            columns[1],
        );
    }
}

const LOGO: [&str; 3] = [
    "▄▀▄ █▀▄ █▄█ ▄█▄ █▀▄ ▄▄  ▄█",
    "█▀█ █▀  █ █ █ █ █ █▀█ █ █",
    "▀ ▀    ▀ ▀  ▀   ▀  ▀ ▀ ▀   ▀▀",
];

fn logo(app: &App, palette: Palette) -> Vec<Line<'static>> {
    let sweep = (app.tick_ms / 55) as usize % 38;
    LOGO.iter()
        .enumerate()
        .map(|(row, text)| {
            Line::from(
                text.chars()
                    .enumerate()
                    .map(|(column, character)| {
                        let position = row * 28 + column;
                        let color = if position.abs_diff(sweep) < 2 {
                            palette.text
                        } else if position.abs_diff(sweep) < 7 {
                            palette.info
                        } else {
                            palette.accent
                        };
                        Span::styled(character.to_string(), Style::default().fg(color))
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

fn home(frame: &mut Frame, app: &App, area: Rect, palette: Palette) {
    let content = Rect::new(
        area.x + 2,
        area.y + 1,
        area.width.saturating_sub(4),
        area.height - 3,
    );
    let sections = Layout::vertical([
        Constraint::Length(5),
        Constraint::Length(1),
        Constraint::Length(3),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(content);
    frame.render_widget(Paragraph::new(logo(app, palette)), sections[0]);
    frame.render_widget(
        Paragraph::new("the app store and launchpad for terminal software")
            .style(Style::default().fg(palette.dim)),
        sections[1],
    );
    let cursor = if (app.tick_ms / 500).is_multiple_of(2) {
        "█"
    } else {
        " "
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" > ", Style::default().fg(palette.text)),
            Span::styled(clean(&app.landing_input), Style::default().fg(palette.text)),
            Span::styled(cursor, Style::default().fg(palette.accent)),
        ]))
        .block(border(palette).title(" COMMAND ")),
        sections[2],
    );
    let matches = app.landing_matches();
    let mut lines = vec![];
    if app.landing_input.is_empty() {
        lines.push(Line::from(Span::styled(
            "type / for commands",
            Style::default().fg(palette.dim),
        )));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("/term", Style::default().fg(palette.info)),
            Span::styled(" shell   ", Style::default().fg(palette.dim)),
            Span::styled("/store", Style::default().fg(palette.info)),
            Span::styled(" tools   ", Style::default().fg(palette.dim)),
            Span::styled("/agents", Style::default().fg(palette.info)),
            Span::styled(" coding agents", Style::default().fg(palette.dim)),
        ]));
    } else if !matches.is_empty() {
        for (index, (command, description)) in matches.iter().take(7).enumerate() {
            lines.push(Line::from(vec![
                Span::styled(
                    if index == app.landing_selected {
                        " > "
                    } else {
                        "   "
                    },
                    Style::default().fg(palette.accent),
                ),
                Span::styled(
                    format!("{command:<11}"),
                    if index == app.landing_selected {
                        palette.selected()
                    } else {
                        Style::default().fg(palette.text)
                    },
                ),
                Span::styled(*description, Style::default().fg(palette.dim)),
            ]));
        }
    } else {
        lines.push(Line::from(Span::styled(
            "Arkonad commands begin with /. Use /term for normal shell commands.",
            Style::default().fg(palette.dim),
        )));
    }
    frame.render_widget(Paragraph::new(lines), sections[3]);
    frame.render_widget(
        Paragraph::new(format!(
            "{}{}",
            if app.busy { "checking tools · " } else { "" },
            clean(&app.notice)
        ))
        .style(Style::default().fg(palette.info)),
        sections[4],
    );
    status_line(
        frame,
        app,
        area,
        palette,
        "[/] commands  [enter] run  [?] help  [ctrl+c] quit",
    );
}

fn onboarding(frame: &mut Frame, app: &App, area: Rect, palette: Palette) {
    let inner = Rect::new(
        area.x + 2,
        area.y + 1,
        area.width.saturating_sub(4),
        area.height - 3,
    );
    let sections = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(2),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(inner);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "ARKONAD / GUIDED SETUP",
                palette.base().add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                "five short steps; nothing is installed here",
                Style::default().fg(palette.dim),
            )),
        ]),
        sections[0],
    );
    let labels = ["SCAN", "START", "THEME", "PET", "DONE"];
    frame.render_widget(
        Paragraph::new(Line::from(
            labels
                .iter()
                .enumerate()
                .flat_map(|(index, label)| {
                    let style = if index == app.onboarding_step {
                        palette.selected()
                    } else if index < app.onboarding_step {
                        Style::default().fg(palette.ok)
                    } else {
                        Style::default().fg(palette.dim)
                    };
                    [Span::styled(format!(" {label} "), style), Span::raw("─")]
                })
                .collect::<Vec<_>>(),
        )),
        sections[1],
    );
    let mut lines = vec![];
    match app.onboarding_step {
        0 => {
            let detected = app
                .entries
                .iter()
                .filter(|entry| entry.detection.is_some())
                .collect::<Vec<_>>();
            lines.push(Line::from(Span::styled(
                format!(
                    "{} of {} catalog tools found on PATH",
                    detected.len(),
                    app.entries.len()
                ),
                Style::default().fg(palette.text),
            )));
            lines.push(Line::from(""));
            if detected.is_empty() {
                lines.push(Line::from(Span::styled(
                    "No catalog tools found yet. You can install them later from /store.",
                    Style::default().fg(palette.dim),
                )));
            } else {
                for entry in detected
                    .into_iter()
                    .take(sections[2].height.saturating_sub(3) as usize)
                {
                    lines.push(Line::from(vec![
                        Span::styled(" + ", Style::default().fg(palette.ok)),
                        Span::styled(
                            format!("{:<16}", clean(&entry.manifest.name)),
                            Style::default().fg(palette.text),
                        ),
                        Span::styled("ready", Style::default().fg(palette.dim)),
                    ]));
                }
            }
        }
        1 => selection_lines(
            &mut lines,
            STARTUP_SURFACES
                .iter()
                .map(|(id, description)| (*id, *description)),
            app.onboarding_choice,
            palette,
        ),
        2 => selection_lines(
            &mut lines,
            THEMES.iter().map(|theme| (*theme, "preview this palette")),
            app.onboarding_choice,
            palette,
        ),
        3 => selection_lines(
            &mut lines,
            PETS.iter().map(|pet| {
                (
                    *pet,
                    if *pet == "none" {
                        "no companion"
                    } else {
                        "optional animated companion"
                    },
                )
            }),
            app.onboarding_choice,
            palette,
        ),
        _ => {
            lines.push(Line::from(Span::styled(
                "Setup is ready.",
                Style::default().fg(palette.ok),
            )));
            lines.push(Line::from(""));
            lines.push(Line::from(format!(" start  {}", app.setup_startup)));
            lines.push(Line::from(format!(" theme  {}", app.setup_theme)));
            lines.push(Line::from(format!(" pet    {}", app.setup_pet)));
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "Press Enter to save and open Arkonad.",
                Style::default().fg(palette.accent),
            )));
        }
    }
    frame.render_widget(
        Paragraph::new(lines).wrap(Wrap { trim: false }),
        sections[2],
    );
    frame.render_widget(
        Paragraph::new(if app.onboarding_step == 4 {
            "enter save  ·  esc back"
        } else {
            "↑↓ choose  ·  enter next  ·  esc back"
        })
        .style(Style::default().fg(palette.dim)),
        sections[3],
    );
    status_line(
        frame,
        app,
        area,
        palette,
        "guided setup / no installs or downloads",
    );
}

fn selection_lines<'a>(
    lines: &mut Vec<Line<'a>>,
    options: impl Iterator<Item = (&'a str, &'a str)>,
    selected: usize,
    palette: Palette,
) {
    for (index, (label, description)) in options.enumerate() {
        lines.push(Line::from(vec![
            Span::styled(
                if index == selected { " > " } else { "   " },
                Style::default().fg(palette.accent),
            ),
            Span::styled(
                format!("{label:<12}"),
                if index == selected {
                    palette.selected()
                } else {
                    Style::default().fg(palette.text)
                },
            ),
            Span::styled(description, Style::default().fg(palette.dim)),
        ]));
    }
}

fn status(frame: &mut Frame, app: &App, area: Rect, palette: Palette) {
    let detected = app
        .entries
        .iter()
        .filter(|entry| entry.detection.is_some())
        .map(|entry| entry.manifest.name.as_str())
        .collect::<Vec<_>>();
    let terminal = std::env::var("TERM_PROGRAM")
        .ok()
        .or_else(|| {
            std::env::var("WT_SESSION")
                .ok()
                .map(|_| "Windows Terminal".into())
        })
        .or_else(|| std::env::var("TERM").ok())
        .unwrap_or_else(|| "unknown".into());
    let body = vec![
        Line::from(Span::styled(
            "ARKONAD / SESSION STATUS",
            palette.base().add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "────────────────────────────────────────────────────────",
            Style::default().fg(palette.border),
        )),
        status_row("os", std::env::consts::OS, palette),
        status_row("terminal", &terminal, palette),
        status_row("shell", &app.shell_label, palette),
        status_row("theme", &app.theme, palette),
        status_row("pet", &app.pet, palette),
        status_row(
            "catalog",
            &format!(
                "{} entries / {} detected",
                app.entries.len(),
                detected.len()
            ),
            palette,
        ),
        status_row("found", &detected.join("  "), palette),
        status_row("directory", &clean(&app.cwd.display().to_string()), palette),
        Line::from(""),
        Line::from(Span::styled(
            "No network state is guessed. Store actions show exact commands before approval.",
            Style::default().fg(palette.dim),
        )),
    ];
    frame.render_widget(
        Paragraph::new(body).wrap(Wrap { trim: false }),
        Rect::new(
            area.x + 2,
            area.y + 1,
            area.width.saturating_sub(4),
            area.height - 3,
        ),
    );
    status_line(frame, app, area, palette, "[r] rescan PATH  [q/esc] back");
}

fn status_row(label: &str, value: &str, palette: Palette) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!(" {label:<10}"), Style::default().fg(palette.dim)),
        Span::styled(value.to_owned(), Style::default().fg(palette.text)),
    ])
}

fn pets_screen(frame: &mut Frame, app: &App, area: Rect, palette: Palette) {
    let columns =
        Layout::horizontal([Constraint::Length(21), Constraint::Min(1)]).split(Rect::new(
            area.x + 2,
            area.y + 2,
            area.width.saturating_sub(4),
            area.height - 5,
        ));
    let rows = PETS.iter().enumerate().map(|(index, pet)| {
        Row::new([format!("{:02}.", index + 1), (*pet).to_owned()]).style(if index == app.menu {
            palette.selected()
        } else {
            palette.base()
        })
    });
    let mut state = TableState::default().with_selected(Some(app.menu));
    frame.render_stateful_widget(
        Table::new(rows, [Constraint::Length(4), Constraint::Min(1)])
            .block(border(palette).title(" COMPANIONS ")),
        columns[0],
        &mut state,
    );
    let selected = PETS[app.menu.min(PETS.len() - 1)];
    let mut preview = vec![
        Line::from(Span::styled(
            selected.to_uppercase(),
            Style::default().fg(palette.accent),
        )),
        Line::from(""),
    ];
    preview.extend(pets::sprite(
        selected,
        app.tick_ms,
        SpriteColors {
            background: palette.background,
            primary: if selected == "snorlax" {
                Color::Rgb(86, 140, 180)
            } else {
                palette.accent
            },
            secondary: palette.error,
            light: palette.text,
            dim: palette.dim,
        },
    ));
    preview.push(Line::from(""));
    preview.push(Line::from(Span::styled(
        if selected == "none" {
            "Arkonad stays quiet."
        } else {
            "A tiny local animation. No network, no agent."
        },
        Style::default().fg(palette.dim),
    )));
    if selected == app.pet {
        preview.push(Line::from(Span::styled(
            "active",
            Style::default().fg(palette.ok),
        )));
    }
    frame.render_widget(
        Paragraph::new(preview).block(border(palette).title(" PREVIEW ")),
        columns[1],
    );
    status_line(
        frame,
        app,
        area,
        palette,
        "[↑↓] choose  [enter] apply  [q/esc] back",
    );
}

fn status_line(frame: &mut Frame, app: &App, area: Rect, palette: Palette, keys: &str) {
    let companion = match app.pet.as_str() {
        "gengar" => "▄█▄ ^_^",
        "snorlax" => "█▀█ -_-",
        _ => "",
    };
    frame.render_widget(
        Paragraph::new(format!(" {companion:<10} · theme {} · {keys}", app.theme))
            .style(Style::default().fg(palette.dim)),
        Rect::new(area.x, area.y + area.height - 1, area.width, 1),
    );
}

fn settings(frame: &mut Frame, app: &App, area: Rect, palette: Palette) {
    let mut rows = THEMES
        .iter()
        .map(|theme| {
            (
                (*theme).to_owned(),
                if *theme == app.theme {
                    "active".to_owned()
                } else {
                    "Enter to apply".to_owned()
                },
            )
        })
        .collect::<Vec<_>>();
    rows.push(("Companion".into(), format!("{} / Enter to cycle", app.pet)));
    rows.push((
        "Default shell".into(),
        format!("{} / Enter to cycle", app.shell_label),
    ));
    let rows = rows.into_iter().enumerate().map(|(index, (label, value))| {
        Row::new(vec![format!("{:02}.", index + 1), label, value]).style(if index == app.menu {
            palette.selected()
        } else {
            palette.base()
        })
    });
    let mut state = TableState::default().with_selected(Some(app.menu));
    frame.render_stateful_widget(
        Table::new(
            rows,
            [
                Constraint::Length(4),
                Constraint::Length(18),
                Constraint::Min(0),
            ],
        )
        .header(Row::new(["#", "SETTING", "VALUE"]).height(2))
        .block(border(palette).title(" APPEARANCE / SHELL ")),
        area,
        &mut state,
    );
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let width = width.min(area.width);
    let height = height.min(area.height);
    Rect::new(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    )
}
