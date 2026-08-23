use std::collections::HashMap;
use std::env;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

const OUTPUT_QUEUE_CAPACITY: usize = 64;
const OUTPUT_CHUNK_SIZE: usize = 16 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProcessRequest {
    pub executable: String,
    pub arguments: Vec<String>,
    pub shell: Option<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub shell: String,
    #[serde(default)]
    pub shell_path: Option<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExited {
    pub id: String,
}

struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Box<dyn Child + Send>>,
}

impl PtySession {
    fn spawn(
        shell: &ShellProfile,
        cwd: &Path,
        size: PtySize,
    ) -> io::Result<(Self, Box<dyn Read + Send>)> {
        let mut command = CommandBuilder::new(&shell.executable);

        if shell.is_powershell {
            command.arg("-NoLogo");
        }

        command.cwd(cwd);
        Self::spawn_command(command, size)
    }

    fn spawn_command(
        command: CommandBuilder,
        size: PtySize,
    ) -> io::Result<(Self, Box<dyn Read + Send>)> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| io::Error::other(error.to_string()))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| io::Error::other(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| io::Error::other(error.to_string()))?;

        Ok((
            Self {
                writer: Mutex::new(writer),
                master: Mutex::new(Some(pair.master)),
                child: Mutex::new(child),
            },
            reader,
        ))
    }

    fn spawn_launch(
        request: &LaunchProcessRequest,
        size: PtySize,
    ) -> io::Result<(Self, Box<dyn Read + Send>)> {
        if request.executable.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "launch executable is empty",
            ));
        }
        if request.executable.chars().any(char::is_control)
            || request
                .arguments
                .iter()
                .any(|argument| argument.chars().any(char::is_control))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "launch command contains control characters",
            ));
        }

        let mut command = if let Some(shell) = request.shell.as_deref() {
            let mut command = CommandBuilder::new(shell);
            if is_cmd_shell(shell) {
                command.arg("/d");
                command.arg("/c");
                command.arg(build_cmd_command_line(
                    &request.executable,
                    &request.arguments,
                ));
            } else if is_powershell(shell) {
                command.args(["-NoLogo", "-NoProfile", "-Command"]);
                command.arg(build_powershell_command_line(
                    &request.executable,
                    &request.arguments,
                ));
            } else {
                command.args([
                    "-lc",
                    &build_posix_command_line(&request.executable, &request.arguments),
                ]);
            }
            command
        } else {
            let mut command = CommandBuilder::new(&request.executable);
            command.args(&request.arguments);
            command
        };

        command.cwd(Path::new(&request.cwd));
        Self::spawn_command(command, size)
    }

    fn write(&self, data: &[u8]) -> io::Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| io::Error::other("session writer lock poisoned"))?;
        writer.write_all(data)?;
        writer.flush()
    }

    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| io::Error::other("session master lock poisoned"))?;
        let master = master
            .as_ref()
            .ok_or_else(|| io::Error::other("session master is closed"))?;
        master
            .resize(PtySize {
                cols: cols.max(1),
                rows: rows.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| io::Error::other(error.to_string()))
    }

    fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        if let Ok(mut master) = self.master.lock() {
            master.take();
        }
    }

    fn wait(&self) -> io::Result<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| io::Error::other("session child lock poisoned"))?;
        child.wait().map(|_| ())
    }

    fn is_running(&self) -> io::Result<bool> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| io::Error::other("session child lock poisoned"))?;
        Ok(child.try_wait()?.is_none())
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

struct ManagedSession {
    pty: PtySession,
}

impl ManagedSession {
    fn write(&self, data: &[u8]) -> io::Result<()> {
        self.pty.write(data)
    }

    fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        self.pty.resize(cols, rows)
    }

    fn kill(&self) {
        self.pty.kill();
    }
}

#[derive(Default)]
pub struct SessionManager {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, Arc<ManagedSession>>>,
}

impl SessionManager {
    pub(crate) fn create(
        &self,
        request: CreateSessionRequest,
        app: AppHandle,
        output: Channel<Vec<u8>>,
    ) -> Result<SessionInfo, String> {
        let shell = resolve_shell(request.shell.as_deref())?;
        let cwd = resolve_cwd(request.cwd.as_deref())?;
        let size = PtySize {
            cols: request.cols.max(1),
            rows: request.rows.max(1),
            pixel_width: 0,
            pixel_height: 0,
        };
        let (pty, reader) = PtySession::spawn(&shell, &cwd, size)
            .map_err(|error| format!("could not start {}: {error}", shell.label))?;
        let session = Arc::new(ManagedSession { pty });
        let id = format!("session-{}", self.next_id.fetch_add(1, Ordering::Relaxed));

        self.sessions
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?
            .insert(id.clone(), Arc::clone(&session));

        spawn_output_bridge(id.clone(), session, reader, output, app);

        Ok(SessionInfo {
            id,
            shell: shell.label,
            shell_path: Some(shell.executable),
            cwd: cwd.to_string_lossy().into_owned(),
        })
    }

    pub(crate) fn create_launch(
        &self,
        request: LaunchProcessRequest,
        app: AppHandle,
        output: Channel<Vec<u8>>,
    ) -> Result<SessionInfo, String> {
        let cwd = resolve_cwd(Some(&request.cwd))?;
        let size = PtySize {
            cols: 120,
            rows: 40,
            pixel_width: 0,
            pixel_height: 0,
        };
        let (pty, reader) = PtySession::spawn_launch(&request, size)
            .map_err(|error| format!("could not start {}: {error}", request.executable))?;
        let session = Arc::new(ManagedSession { pty });
        let id = format!("session-{}", self.next_id.fetch_add(1, Ordering::Relaxed));

        self.sessions
            .lock()
            .map_err(|_| "session registry lock is unavailable".to_owned())?
            .insert(id.clone(), Arc::clone(&session));

        spawn_output_bridge(id.clone(), session, reader, output, app);

        let shell_path = request.shell.clone();
        Ok(SessionInfo {
            id,
            shell: request
                .shell
                .unwrap_or_else(|| "direct executable".to_owned()),
            shell_path,
            cwd: cwd.to_string_lossy().into_owned(),
        })
    }

    fn get(&self, id: &str) -> Result<Arc<ManagedSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| format!("unknown session: {id}"))
    }

    pub(crate) fn is_running(&self, id: &str) -> bool {
        self.get(id)
            .and_then(|session| session.pty.is_running().map_err(|error| error.to_string()))
            .unwrap_or(false)
    }

    pub(crate) fn close(&self, id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?
            .remove(id)
            .ok_or_else(|| format!("unknown session: {id}"))?;
        session.kill();
        Ok(())
    }
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for session in sessions.values() {
                session.kill();
            }
            sessions.clear();
        }
    }
}

fn spawn_output_bridge(
    id: String,
    session: Arc<ManagedSession>,
    mut reader: Box<dyn Read + Send>,
    output: Channel<Vec<u8>>,
    app: AppHandle,
) {
    let (sender, receiver) = sync_channel::<Vec<u8>>(OUTPUT_QUEUE_CAPACITY);
    let reader_session = Arc::clone(&session);
    let reader_thread = thread::Builder::new()
        .name(format!("arkonad-{id}-reader"))
        .spawn(move || {
            let mut buffer = vec![0_u8; OUTPUT_CHUNK_SIZE];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if sender.send(buffer[..size].to_vec()).is_err() {
                            reader_session.kill();
                            break;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        });

    let Some(reader_thread) = reader_thread.ok() else {
        return;
    };

    let _ = thread::Builder::new()
        .name(format!("arkonad-{id}-output"))
        .spawn(move || {
            for chunk in receiver {
                if output.send(chunk).is_err() {
                    session.kill();
                    break;
                }
            }

            let _ = reader_thread.join();
            let _ = session.pty.wait();
            let _ = app.emit("session-exited", SessionExited { id });
        });
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_session(
    state: State<'_, SessionManager>,
    app: AppHandle,
    request: CreateSessionRequest,
    on_output: Channel<Vec<u8>>,
) -> Result<SessionInfo, String> {
    state.create(request, app, on_output)
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_session(
    state: State<'_, SessionManager>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .get(&id)?
        .write(&data)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn resize_session(
    state: State<'_, SessionManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .get(&id)?
        .resize(cols, rows)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn close_session(state: State<'_, SessionManager>, id: String) -> Result<(), String> {
    state.close(&id)
}

#[derive(Debug, Clone)]
struct ShellProfile {
    executable: String,
    label: String,
    is_powershell: bool,
}

fn resolve_shell(requested: Option<&str>) -> Result<ShellProfile, String> {
    let requested = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| env::var("ARKONAD_SHELL").ok());

    if let Some(executable) = requested.as_deref() {
        if !command_exists(executable) {
            return Err(format!("configured shell was not found: {executable}"));
        }
        return Ok(ShellProfile {
            is_powershell: is_powershell(executable),
            label: executable.to_string(),
            executable: executable.to_string(),
        });
    }

    let candidates = if cfg!(windows) {
        vec![
            ("pwsh.exe", "PowerShell 7"),
            ("powershell.exe", "Windows PowerShell"),
            ("cmd.exe", "Command Prompt"),
        ]
    } else {
        vec![("$SHELL", "Shell")]
    };

    for (executable, label) in candidates {
        let executable = if executable == "$SHELL" {
            env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        } else {
            executable.to_string()
        };
        if command_exists(&executable) {
            return Ok(ShellProfile {
                is_powershell: is_powershell(&executable),
                executable,
                label: label.to_string(),
            });
        }
    }

    Err("no supported shell was found".to_string())
}

fn resolve_cwd(requested: Option<&str>) -> Result<PathBuf, String> {
    let cwd = match requested.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => env::current_dir()
            .map_err(|error| format!("could not determine working directory: {error}"))?,
    };

    if !cwd.is_dir() {
        return Err(format!(
            "working directory does not exist: {}",
            cwd.display()
        ));
    }

    Ok(cwd)
}

fn is_powershell(executable: &str) -> bool {
    Path::new(executable)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.eq_ignore_ascii_case("pwsh") || stem.eq_ignore_ascii_case("powershell"))
        .unwrap_or(false)
}

fn is_cmd_shell(executable: &str) -> bool {
    Path::new(executable)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.eq_ignore_ascii_case("cmd"))
        .unwrap_or(false)
}

fn build_cmd_command_line(executable: &str, arguments: &[String]) -> String {
    std::iter::once(executable)
        .chain(arguments.iter().map(String::as_str))
        .map(quote_cmd_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_cmd_argument(value: &str) -> String {
    if value.is_empty() || value.chars().any(char::is_whitespace) || value.contains('"') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_owned()
    }
}

fn build_powershell_command_line(executable: &str, arguments: &[String]) -> String {
    std::iter::once(executable)
        .chain(arguments.iter().map(String::as_str))
        .map(quote_powershell_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_powershell_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn build_posix_command_line(executable: &str, arguments: &[String]) -> String {
    std::iter::once(executable)
        .chain(arguments.iter().map(String::as_str))
        .map(quote_posix_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_posix_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn command_exists(command: &str) -> bool {
    if Path::new(command).components().count() > 1 {
        return Path::new(command).is_file();
    }

    #[cfg(windows)]
    let lookup = "where.exe";
    #[cfg(not(windows))]
    let lookup = "which";

    std::process::Command::new(lookup)
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    fn powershell() -> Option<String> {
        if command_exists("pwsh.exe") {
            Some("pwsh.exe".to_string())
        } else if command_exists("powershell.exe") {
            Some("powershell.exe".to_string())
        } else {
            None
        }
    }

    fn test_session(command: &str) -> Option<(PtySession, Box<dyn Read + Send>)> {
        let shell = powershell()?;
        let mut builder = CommandBuilder::new(shell);
        builder.args(["-NoLogo", "-NoProfile", "-Command", command]);
        builder.cwd(&env::current_dir().ok()?);
        PtySession::spawn_command(
            builder,
            PtySize {
                cols: 80,
                rows: 24,
                pixel_width: 0,
                pixel_height: 0,
            },
        )
        .ok()
    }

    fn read_until_marker(
        session: &PtySession,
        mut reader: Box<dyn Read + Send>,
        marker: &str,
    ) -> Vec<u8> {
        let (sender, receiver) = channel::<io::Result<Vec<u8>>>();
        let reader_thread = thread::spawn(move || {
            let mut buffer = vec![0_u8; OUTPUT_CHUNK_SIZE];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if sender.send(Ok(buffer[..size].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut output = Vec::new();
        let mut found = false;
        while Instant::now() < deadline {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(chunk)) => {
                    if chunk.windows(4).any(|window| window == b"\x1b[6n") {
                        session
                            .write(b"\x1b[1;1R")
                            .expect("terminal query response should reach the shell");
                    }
                    output.extend_from_slice(&chunk);
                    if String::from_utf8_lossy(&output).contains(marker) {
                        found = true;
                        break;
                    }
                }
                Ok(Err(error)) => panic!("PTY reader failed: {error}"),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        session.kill();
        session.wait().expect("test child should be reapable");
        reader_thread.join().expect("reader thread should stop");
        assert!(
            found,
            "timed out waiting for marker {marker:?}; output was {:?}",
            String::from_utf8_lossy(&output)
        );
        output
    }

    #[test]
    fn default_shell_prefers_power_shell_when_available() {
        let Ok(shell) = resolve_shell(None) else {
            return;
        };

        if command_exists("pwsh.exe") {
            assert_eq!(shell.label, "PowerShell 7");
        } else if command_exists("powershell.exe") {
            assert_eq!(shell.label, "Windows PowerShell");
        }
    }

    #[test]
    fn pty_can_resize_and_accept_utf8_input() {
        let Some((session, reader)) = test_session(
            "[Console]::InputEncoding = [Text.UTF8Encoding]::new(); [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $value = [Console]::ReadLine(); [Console]::WriteLine('ARKONAD:' + $value); exit",
        ) else {
            return;
        };

        session.resize(120, 40).expect("resize should reach ConPTY");
        session
            .write("こんにちは\r\n".as_bytes())
            .expect("input should reach shell");
        let output = read_until_marker(&session, reader, "ARKONAD:こんにちは");
        assert!(String::from_utf8_lossy(&output).contains("ARKONAD:こんにちは"));
    }

    #[test]
    fn pty_preserves_large_output_until_process_exit() {
        let Some((session, reader)) = test_session(
            "1..10000 | ForEach-Object { 'arkonad-output' }; Write-Output 'ARKONAD-END'; exit",
        ) else {
            return;
        };

        let output = read_until_marker(&session, reader, "ARKONAD-END");
        assert!(output.len() > 100_000);
        assert!(String::from_utf8_lossy(&output).contains("arkonad-output"));
    }

    #[test]
    fn pty_can_be_killed_without_leaking_the_child_tree() {
        let Some((session, _reader)) = test_session("Start-Sleep -Seconds 30") else {
            return;
        };

        session.kill();
        session.wait().expect("killed child should be reapable");
    }

    #[test]
    fn pty_launches_a_declared_executable_directly() {
        let Some(shell_name) = powershell() else {
            return;
        };
        let Some(shell) = Command::new("where.exe")
            .arg(&shell_name)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or_default()
                    .trim()
                    .to_owned()
            })
            .filter(|path| !path.is_empty())
        else {
            return;
        };
        let request = LaunchProcessRequest {
            executable: shell,
            arguments: vec![
                "-NoLogo".to_owned(),
                "-NoProfile".to_owned(),
                "-Command".to_owned(),
                "Write-Output 'ARKONAD-LAUNCH'".to_owned(),
            ],
            shell: None,
            cwd: env::current_dir()
                .expect("test working directory should be available")
                .to_string_lossy()
                .into_owned(),
        };
        let (session, reader) = PtySession::spawn_launch(
            &request,
            PtySize {
                cols: 80,
                rows: 24,
                pixel_width: 0,
                pixel_height: 0,
            },
        )
        .expect("declared executable should start in the PTY");

        let output = read_until_marker(&session, reader, "ARKONAD-LAUNCH");
        assert!(String::from_utf8_lossy(&output).contains("ARKONAD-LAUNCH"));
    }
}
