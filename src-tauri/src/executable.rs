use std::env;
use std::path::{Path, PathBuf};

pub fn resolve(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    let path = Path::new(value);
    if path.components().count() > 1 {
        return executable_file(path).then(|| path.to_string_lossy().into_owned());
    }

    let search_path = env::var_os("PATH")?;
    for directory in env::split_paths(&search_path) {
        for candidate in command_candidates(&directory, value) {
            if executable_file(&candidate) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn command_candidates(directory: &Path, value: &str) -> Vec<PathBuf> {
    let direct = directory.join(value);
    #[cfg(windows)]
    {
        if Path::new(value).extension().is_some() {
            return vec![direct];
        }
        let extensions = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
        extensions
            .split(';')
            .map(str::trim)
            .filter(|extension| !extension.is_empty())
            .map(|extension| directory.join(format!("{value}{extension}")))
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![direct]
    }
}

fn executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_known_shell_without_spawning_a_lookup_process() {
        let shell = if cfg!(windows) { "cmd.exe" } else { "sh" };
        let resolved = resolve(shell).expect("the system shell should resolve from PATH");
        assert!(Path::new(&resolved).is_file());
    }

    #[cfg(windows)]
    #[test]
    fn windows_does_not_select_the_extensionless_npm_unix_shim() {
        let directory = Path::new("D:/tools with spaces");
        let candidates = command_candidates(directory, "codex");
        assert!(!candidates.contains(&directory.join("codex")));
        assert!(candidates
            .iter()
            .any(|p| p.extension().unwrap().eq_ignore_ascii_case("cmd")));
        assert_eq!(
            command_candidates(directory, "codex.cmd"),
            vec![directory.join("codex.cmd")]
        );
    }
}
