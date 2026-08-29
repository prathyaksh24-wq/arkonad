fn main() {
    if let Err(error) = arkonad::tui::run(std::env::args().skip(1).collect()) {
        eprintln!("Arkonad: {error}");
        std::process::exit(1);
    }
}
