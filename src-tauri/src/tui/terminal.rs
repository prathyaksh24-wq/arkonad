use std::io::{self, IsTerminal};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};

use ratatui::DefaultTerminal;

/// Owns raw mode and the alternate screen, including cleanup on errors/panics.
pub struct TerminalSession {
    pub terminal: DefaultTerminal,
}

impl TerminalSession {
    pub fn enter() -> io::Result<Self> {
        if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
            return Err(io::Error::other(
                "An interactive terminal is required. Run arkonad in PowerShell, CMD, or a terminal shell. Use --help for commands.",
            ));
        }
        Ok(Self {
            terminal: ratatui::try_init()?,
        })
    }

    pub fn handoff(&mut self, command: &mut Command) -> io::Result<io::Result<ExitStatus>> {
        ratatui::restore();
        let result = command
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status();
        // Re-enter even when spawn fails; the error belongs in the restored TUI.
        self.terminal = ratatui::try_init()?;
        self.terminal.clear()?;
        Ok(result)
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        ratatui::restore();
    }
}

pub fn command(executable: &str, args: &[String], cwd: &Path) -> Result<Command, String> {
    let resolved = crate::executable::resolve(executable).ok_or_else(|| {
        format!("{executable} was not found on PATH. Install it or refresh the Store.")
    })?;
    let mut command = Command::new(resolved);
    command.args(args).current_dir(cwd);
    Ok(command)
}

pub fn shell(cwd: &Path, preferred: Option<&str>) -> Result<Command, String> {
    if let Some(preferred) = preferred {
        return command(preferred, &[], cwd);
    }
    #[cfg(windows)]
    let candidates: Vec<String> =
        vec!["pwsh.exe".into(), "powershell.exe".into(), "cmd.exe".into()];
    #[cfg(not(windows))]
    let candidates: Vec<String> = vec![
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        "/bin/sh".into(),
    ];
    for candidate in candidates {
        if let Ok(command) = command(&candidate, &[], cwd) {
            return Ok(command);
        }
    }
    Err("No interactive shell was found. Configure a shell in Settings.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_uses_real_cwd_and_unknown_commands_fail() {
        let cwd = std::env::current_dir().unwrap();
        let shell = shell(&cwd, None).unwrap();
        assert_eq!(shell.get_current_dir(), Some(cwd.as_path()));
        assert!(command("arkonad-definitely-not-installed", &[], &cwd).is_err());
    }
    #[test]
    fn arguments_are_not_joined_into_shell_source() {
        let cwd = std::env::current_dir().unwrap();
        let exe = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let command = command(exe, &["one two".into(), "a;b".into()], &cwd).unwrap();
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["one two", "a;b"]);
    }
}
