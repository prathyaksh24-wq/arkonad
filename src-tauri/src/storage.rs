//! Both frontends use the same data directory and file formats.
use std::path::PathBuf;

pub trait AppData {
    fn data_directory(&self) -> Result<PathBuf, String>;
}

#[derive(Clone, Debug)]
pub struct DataDirectory(pub PathBuf);

impl DataDirectory {
    pub fn discover() -> Result<Self, String> {
        if let Some(value) = std::env::var_os("ARKONAD_DATA_DIR") {
            let path = PathBuf::from(value);
            if !path.is_absolute() {
                return Err("ARKONAD_DATA_DIR must be an absolute path".into());
            }
            return Ok(Self(path));
        }
        dirs::data_dir()
            .map(|path| Self(path.join("ai.arkonad.terminal")))
            .ok_or_else(|| "Could not locate the user data directory".into())
    }
}

impl AppData for DataDirectory {
    fn data_directory(&self) -> Result<PathBuf, String> {
        Ok(self.0.clone())
    }
}

#[cfg(feature = "desktop")]
impl AppData for tauri::AppHandle {
    fn data_directory(&self) -> Result<PathBuf, String> {
        use tauri::Manager;
        self.path()
            .app_data_dir()
            .map_err(|error| error.to_string())
    }
}
