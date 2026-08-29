//! Deterministic cells from the actual renderer, for visual QA without a browser.
use arkonad::{
    catalog::CatalogRuntime,
    tui::{
        app::{App, Screen},
        view,
    },
};
use ratatui::{backend::TestBackend, Terminal};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let width = args.first().map(|s| s.parse()).transpose()?.unwrap_or(120);
    let height = args.get(1).map(|s| s.parse()).transpose()?.unwrap_or(40);
    let screen = args
        .get(2)
        .and_then(|s| Screen::parse(s))
        .unwrap_or(Screen::Store);
    let mut app = App::new(screen, std::env::current_dir()?, "amber".into());
    app.entries = CatalogRuntime::builtins().list(None, None)?;
    app.table.select(Some(2));
    if screen == Screen::Pets {
        app.menu = 1;
        app.pet = "gengar".into();
        app.tick_ms = 400;
    }
    app.notice = "Preview: detection not run".into();
    let mut terminal = Terminal::new(TestBackend::new(width, height))?;
    terminal.draw(|frame| view::draw(frame, &mut app))?;
    let buffer = terminal.backend().buffer();
    let cells=buffer.content.iter().map(|cell|serde_json::json!({
        "text":cell.symbol(),"fg":format!("{:?}",cell.fg),"bg":format!("{:?}",cell.bg),"reversed":cell.modifier.contains(ratatui::style::Modifier::REVERSED)
    })).collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::json!({"width":width,"height":height,"cells":cells})
    );
    Ok(())
}
