use arkonad::{
    settings::{SettingsRuntime, SettingsSaveRequest},
    storage::DataDirectory,
};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-data")
            .join(format!(
                "settings-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn native_settings_roundtrip_keeps_other_settings_and_sibling_state() {
    let scratch = Scratch::new();
    let data = DataDirectory(scratch.0.clone());
    let runtime = SettingsRuntime::default();
    let saved = runtime.load(&data);
    assert_eq!(saved.status, "default");
    let mut document = saved.settings;
    let shell = document.default_shell_profile_id.clone();
    document.theme = "phosphor".into();
    document.pet = "gengar".into();
    fs::write(scratch.0.join("receipts.json"), b"preserved").unwrap();
    runtime
        .save(&data, SettingsSaveRequest { settings: document })
        .unwrap();
    let loaded = SettingsRuntime::default().load(&data);
    assert_eq!(loaded.status, "ready");
    assert_eq!(loaded.settings.theme, "phosphor");
    assert_eq!(loaded.settings.pet, "gengar");
    assert_eq!(loaded.settings.default_shell_profile_id, shell);
    assert_eq!(
        fs::read(scratch.0.join("receipts.json")).unwrap(),
        b"preserved"
    );
}

#[test]
fn corrupt_settings_load_is_read_only() {
    let scratch = Scratch::new();
    let path = scratch.0.join("settings.json");
    fs::write(&path, b"not json: keep me").unwrap();
    let result = SettingsRuntime::default().load(&DataDirectory(scratch.0.clone()));
    assert_eq!(result.status, "invalid");
    assert_eq!(fs::read(path).unwrap(), b"not json: keep me");
}
