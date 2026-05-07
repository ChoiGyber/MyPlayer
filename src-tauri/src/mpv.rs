use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::media::{display_path, normalize_existing_file};

type CommandResult<T> = Result<T, String>;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStatus {
    is_running: bool,
    is_playing: bool,
    current_time: f64,
    duration: f64,
    volume: f64,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MpvResponse {
    data: Option<Value>,
    error: String,
    request_id: Option<u64>,
}

#[derive(Debug)]
struct MpvController {
    child: Option<Child>,
    pipe_name: String,
    next_request_id: u64,
}

impl Default for MpvController {
    fn default() -> Self {
        Self {
            child: None,
            pipe_name: format!(r"\\.\pipe\myplayer-mpv-{}", std::process::id()),
            next_request_id: 1,
        }
    }
}

static MPV: OnceLock<Mutex<MpvController>> = OnceLock::new();

#[tauri::command]
pub fn mpv_open_media<R: Runtime>(app: AppHandle<R>, path: String) -> CommandResult<MpvStatus> {
    let media_path = normalize_existing_file(&path)?;
    app.asset_protocol_scope()
        .allow_file(&media_path)
        .map_err(|error| error.to_string())?;

    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["loadfile", display_path(&media_path), "replace"]))?;
    mpv.command(json!(["set_property", "pause", false]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_toggle_playback() -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["cycle", "pause"]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_restart() -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["set_property", "time-pos", 0]))?;
    mpv.command(json!(["set_property", "pause", false]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_seek_relative(seconds: f64) -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["seek", seconds, "relative", "exact"]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_seek_absolute(seconds: f64) -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["set_property", "time-pos", seconds.max(0.0)]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_set_volume(volume: f64) -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["set_property", "volume", volume.clamp(0.0, 100.0)]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_load_subtitle(path: String) -> CommandResult<MpvStatus> {
    let subtitle_path = normalize_existing_file(&path)?;
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["sub-add", display_path(&subtitle_path), "select"]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_disable_subtitle() -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.command(json!(["set_property", "sid", "no"]))?;
    mpv.status()
}

#[tauri::command]
pub fn mpv_get_status() -> CommandResult<MpvStatus> {
    let mut mpv = controller()?;
    mpv.ensure_running()?;
    mpv.status()
}

pub fn shutdown_mpv() {
    if let Some(lock) = MPV.get() {
        if let Ok(mut mpv) = lock.lock() {
            let _ = mpv.command(json!(["quit"]));
            if let Some(mut child) = mpv.child.take() {
                let _ = child.kill();
            }
        }
    }
}

fn controller() -> CommandResult<std::sync::MutexGuard<'static, MpvController>> {
    MPV.get_or_init(|| Mutex::new(MpvController::default()))
        .lock()
        .map_err(|_| "mpv controller lock failed".to_string())
}

impl MpvController {
    fn ensure_running(&mut self) -> CommandResult<()> {
        if let Some(child) = &mut self.child {
            if child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok(());
            }
        }

        let mpv_path = find_mpv_exe()?;
        self.child = None;

        let mut command = Command::new(&mpv_path);
        command
            .arg("--idle=yes")
            .arg("--force-window=yes")
            .arg("--keep-open=yes")
            .arg("--no-config")
            .arg("--osc=no")
            .arg("--terminal=no")
            .arg("--msg-level=all=no")
            .arg(format!("--input-ipc-server={}", self.pipe_name))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        self.child = Some(command.spawn().map_err(|error| {
            format!(
                "mpv를 실행하지 못했습니다: {} ({})",
                display_path(&mpv_path),
                error
            )
        })?);

        self.wait_for_ipc()
    }

    fn wait_for_ipc(&mut self) -> CommandResult<()> {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if self.command(json!(["get_property", "idle-active"])).is_ok() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(100));
        }

        Err("mpv IPC 연결 시간이 초과되었습니다.".to_string())
    }

    fn command(&mut self, command: Value) -> CommandResult<Option<Value>> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;

        let payload = json!({
            "command": command,
            "request_id": request_id,
        });

        let mut pipe = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.pipe_name)
            .map_err(|error| error.to_string())?;
        writeln!(pipe, "{payload}").map_err(|error| error.to_string())?;
        pipe.flush().map_err(|error| error.to_string())?;

        let mut reader = BufReader::new(pipe);
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader
                .read_line(&mut line)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                return Err("mpv IPC 응답이 비어 있습니다.".to_string());
            }

            let response =
                serde_json::from_str::<MpvResponse>(&line).map_err(|error| error.to_string())?;
            if response.request_id != Some(request_id) {
                continue;
            }

            if response.error != "success" {
                return Err(format!("mpv command failed: {}", response.error));
            }

            return Ok(response.data);
        }
    }

    fn get_property(&mut self, name: &str) -> CommandResult<Option<Value>> {
        self.command(json!(["get_property", name]))
    }

    fn status(&mut self) -> CommandResult<MpvStatus> {
        let pause = self
            .get_property("pause")?
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let idle = self
            .get_property("idle-active")?
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let current_time = self
            .get_property("time-pos")?
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0);
        let duration = self
            .get_property("duration")?
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0);
        let volume = self
            .get_property("volume")?
            .and_then(|value| value.as_f64())
            .unwrap_or(100.0);
        let path = self
            .get_property("path")?
            .and_then(|value| value.as_str().map(str::to_string));

        Ok(MpvStatus {
            is_running: self.child.is_some(),
            is_playing: !pause && !idle,
            current_time,
            duration,
            volume,
            path,
        })
    }
}

fn find_mpv_exe() -> CommandResult<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("MyPlayerRuntime").join("mpv").join("mpv.exe"));
            candidates.push(exe_dir.join("mpv").join("mpv.exe"));
            candidates.push(exe_dir.join("mpv.exe"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("MyPlayerRuntime")
                .join("mpv")
                .join("mpv.exe"),
        );
        candidates.push(current_dir.join("tools").join("mpv").join("mpv.exe"));
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(
        "mpv.exe를 찾지 못했습니다. 포터블 폴더의 MyPlayerRuntime\\mpv\\mpv.exe 위치에 mpv를 넣어 주세요."
            .to_string(),
    )
}
