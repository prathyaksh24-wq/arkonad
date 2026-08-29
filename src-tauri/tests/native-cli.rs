use std::process::Command;

#[test]
fn help_and_version_do_not_need_a_terminal() {
    for flag in ["--help", "--version"] {
        let output = Command::new(env!("CARGO_BIN_EXE_arkonad"))
            .arg(flag)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(!output.stdout.is_empty());
        assert!(!output.stdout.windows(2).any(|bytes| bytes == b"\x1b["));
    }
}

#[test]
fn redirected_tui_fails_with_a_useful_message() {
    let output = Command::new(env!("CARGO_BIN_EXE_arkonad"))
        .arg("store")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("interactive terminal"));
}
