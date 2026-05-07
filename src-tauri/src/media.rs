use std::{
    cmp::Reverse,
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use encoding_rs::{EUC_KR, WINDOWS_1252};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Window};

type CommandResult<T> = Result<T, String>;

const MAX_RECENT_FILES: usize = 12;
const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "vtt"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMediaItem {
    path: String,
    display_name: String,
    last_opened_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCandidate {
    path: String,
    display_name: String,
    format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMedia {
    path: String,
    display_name: String,
    recent_files: Vec<RecentMediaItem>,
    subtitles: Vec<SubtitleCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlePayload {
    path: String,
    display_name: String,
    format: String,
    vtt: String,
    detected_encoding: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentStore {
    items: Vec<RecentMediaItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    language: String,
    is_first_run: bool,
    data_dir: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    language: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum SubtitleFormat {
    Srt,
    Ass,
    Vtt,
}

impl SubtitleFormat {
    fn as_label(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Ass => "ass",
            Self::Vtt => "vtt",
        }
    }
}

#[tauri::command]
pub fn list_recent_files<R: Runtime>(app: AppHandle<R>) -> CommandResult<Vec<RecentMediaItem>> {
    let items = load_recent_items(&app)?;
    persist_recent_items(&app, &items)?;
    Ok(items)
}

#[tauri::command]
pub fn prepare_media<R: Runtime>(app: AppHandle<R>, path: String) -> CommandResult<PreparedMedia> {
    let media_path = normalize_existing_file(&path)?;
    app.asset_protocol_scope()
        .allow_file(&media_path)
        .map_err(|error| error.to_string())?;

    let display_name = file_display_name(&media_path);
    let normalized_path = display_path(&media_path);
    let subtitles = detect_subtitles(&media_path)?;
    let recent_files = upsert_recent_item(
        &app,
        RecentMediaItem {
            path: normalized_path.clone(),
            display_name: display_name.clone(),
            last_opened_at: unix_timestamp_ms(),
        },
    )?;

    Ok(PreparedMedia {
        path: normalized_path,
        display_name,
        recent_files,
        subtitles,
    })
}

#[tauri::command]
pub fn load_subtitle(path: String) -> CommandResult<SubtitlePayload> {
    let subtitle_path = normalize_existing_file(&path)?;
    let raw = fs::read(&subtitle_path).map_err(|error| error.to_string())?;
    let (decoded_text, detected_encoding) = decode_subtitle_bytes(&raw);
    let format = detect_subtitle_format(&subtitle_path, &decoded_text);
    let vtt = match format {
        SubtitleFormat::Ass => ass_to_vtt(&decoded_text)?,
        SubtitleFormat::Srt | SubtitleFormat::Vtt => text_cues_to_vtt(&decoded_text)?,
    };

    Ok(SubtitlePayload {
        path: display_path(&subtitle_path),
        display_name: file_display_name(&subtitle_path),
        format: format.as_label().to_string(),
        vtt,
        detected_encoding,
    })
}

#[tauri::command]
pub fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> CommandResult<AppSettings> {
    load_app_settings(&app)
}

#[tauri::command]
pub fn set_app_language<R: Runtime>(
    app: AppHandle<R>,
    language: String,
) -> CommandResult<AppSettings> {
    let language = normalize_language(&language)?;
    persist_app_settings(
        &app,
        &PersistedSettings {
            language: Some(language),
        },
    )?;
    load_app_settings(&app)
}

#[tauri::command]
pub fn set_window_title(window: Window, title: String) -> CommandResult<()> {
    window.set_title(&title).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_window(window: Window) -> CommandResult<()> {
    crate::mpv::shutdown_mpv();
    window.close().map_err(|error| error.to_string())
}

fn portable_data_dir() -> CommandResult<PathBuf> {
    let exe_path = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "실행 파일 위치를 확인하지 못했습니다.".to_string())?;
    let directory = exe_dir.join("MyPlayerData");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn recent_store_path() -> CommandResult<PathBuf> {
    let directory = portable_data_dir()?;
    Ok(directory.join("recent-media.json"))
}

fn settings_path() -> CommandResult<PathBuf> {
    let directory = portable_data_dir()?;
    Ok(directory.join("settings.json"))
}

fn load_app_settings<R: Runtime>(_app: &AppHandle<R>) -> CommandResult<AppSettings> {
    let data_dir = portable_data_dir()?;
    let settings_path = data_dir.join("settings.json");
    let is_first_run = !settings_path.exists();

    let persisted = if settings_path.exists() {
        let raw = fs::read(&settings_path).map_err(|error| error.to_string())?;
        serde_json::from_slice::<PersistedSettings>(&raw).unwrap_or_default()
    } else {
        PersistedSettings::default()
    };

    Ok(AppSettings {
        language: persisted.language.unwrap_or_else(|| "ko".to_string()),
        is_first_run,
        data_dir: display_path(&data_dir),
    })
}

fn persist_app_settings<R: Runtime>(
    _app: &AppHandle<R>,
    settings: &PersistedSettings,
) -> CommandResult<()> {
    let path = settings_path()?;
    let json = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn normalize_language(language: &str) -> CommandResult<String> {
    match language {
        "ko" | "en" => Ok(language.to_string()),
        _ => Err("지원하지 않는 언어입니다.".to_string()),
    }
}

fn load_recent_items<R: Runtime>(app: &AppHandle<R>) -> CommandResult<Vec<RecentMediaItem>> {
    let _ = app;
    let store_path = recent_store_path()?;
    if !store_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read(&store_path).map_err(|error| error.to_string())?;
    let mut store = serde_json::from_slice::<RecentStore>(&raw).unwrap_or_default();

    store.items.retain(|item| Path::new(&item.path).is_file());
    store.items.sort_by_key(|item| Reverse(item.last_opened_at));
    store.items.truncate(MAX_RECENT_FILES);

    Ok(store.items)
}

fn persist_recent_items<R: Runtime>(
    app: &AppHandle<R>,
    items: &[RecentMediaItem],
) -> CommandResult<()> {
    let _ = app;
    let store_path = recent_store_path()?;
    let store = RecentStore {
        items: items.to_vec(),
    };
    let json = serde_json::to_vec_pretty(&store).map_err(|error| error.to_string())?;
    fs::write(store_path, json).map_err(|error| error.to_string())
}

fn upsert_recent_item<R: Runtime>(
    app: &AppHandle<R>,
    entry: RecentMediaItem,
) -> CommandResult<Vec<RecentMediaItem>> {
    let mut items = load_recent_items(app)?;
    items.retain(|item| item.path != entry.path);
    items.insert(0, entry);
    items.truncate(MAX_RECENT_FILES);
    persist_recent_items(app, &items)?;
    Ok(items)
}

pub fn normalize_existing_file(input: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(input);
    if !path.exists() {
        return Err("선택한 파일을 찾을 수 없습니다.".to_string());
    }

    if !path.is_file() {
        return Err("파일만 열 수 있습니다.".to_string());
    }

    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    Ok(strip_extended_prefix(canonical))
}

fn strip_extended_prefix(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();

    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }

    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    path
}

fn detect_subtitles(media_path: &Path) -> CommandResult<Vec<SubtitleCandidate>> {
    let Some(parent) = media_path.parent() else {
        return Ok(Vec::new());
    };

    let media_stem = media_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();

    let mut scored = Vec::new();
    let mut all_subtitles = Vec::new();

    for entry in fs::read_dir(parent).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !path.is_file() || !is_supported_subtitle(&path) {
            continue;
        }

        let candidate = SubtitleCandidate {
            path: display_path(&path),
            display_name: file_display_name(&path),
            format: subtitle_extension_label(&path),
        };

        let subtitle_stem = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let score = subtitle_match_score(&media_stem, &subtitle_stem);

        all_subtitles.push(candidate.clone());
        if score >= 45 {
            scored.push((candidate, score));
        }
    }

    if scored.is_empty() {
        if all_subtitles.len() == 1 {
            return Ok(all_subtitles);
        }
        return Ok(Vec::new());
    }

    scored.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.display_name.cmp(&right.0.display_name))
    });

    Ok(scored.into_iter().map(|(candidate, _)| candidate).collect())
}

fn subtitle_match_score(media_name: &str, subtitle_name: &str) -> i32 {
    let raw_media = media_name.to_ascii_lowercase();
    let raw_subtitle = subtitle_name.to_ascii_lowercase();
    if raw_media == raw_subtitle {
        return 160;
    }

    let normalized_media = normalize_for_matching(&raw_media);
    let normalized_subtitle = normalize_for_matching(&raw_subtitle);
    if normalized_media.is_empty() || normalized_subtitle.is_empty() {
        return 0;
    }

    if normalized_media == normalized_subtitle {
        return 140;
    }

    let mut score = 0;

    if raw_subtitle.contains(&raw_media) || raw_media.contains(&raw_subtitle) {
        score += 70;
    }

    if normalized_subtitle.contains(&normalized_media)
        || normalized_media.contains(&normalized_subtitle)
    {
        score += 55;
    }

    if shares_significant_token(&normalized_media, &normalized_subtitle) {
        score += 24;
    }

    score + (common_prefix_ratio(&normalized_media, &normalized_subtitle) * 48.0).round() as i32
}

fn normalize_for_matching(value: &str) -> String {
    static BRACKET_RE: OnceLock<Regex> = OnceLock::new();
    static SEPARATOR_RE: OnceLock<Regex> = OnceLock::new();
    static NOISE_RE: OnceLock<Regex> = OnceLock::new();

    let bracket_re =
        BRACKET_RE.get_or_init(|| Regex::new(r"[\[\(].*?[\]\)]").expect("valid bracket regex"));
    let separator_re =
        SEPARATOR_RE.get_or_init(|| Regex::new(r"[._-]+").expect("valid separator regex"));
    let noise_re = NOISE_RE.get_or_init(|| {
    Regex::new(
      r"\b(?:2160p|1080p|720p|480p|bluray|brrip|bdrip|webrip|webdl|web-dl|hdr|uhd|x264|x265|h264|h265|hevc|aac|dts|proper|repack|release|sub|subs|subtitle|ko|kor|kr|korean|eng|english)\b",
    )
    .expect("valid noise regex")
  });

    let without_brackets = bracket_re.replace_all(value, " ");
    let separated = separator_re.replace_all(&without_brackets, " ");
    let without_noise = noise_re.replace_all(&separated, " ");

    without_noise
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn shares_significant_token(left: &str, right: &str) -> bool {
    left.split_whitespace().any(|left_token| {
        left_token.len() > 2
            && right
                .split_whitespace()
                .any(|right_token| right_token == left_token)
    })
}

fn common_prefix_ratio(left: &str, right: &str) -> f32 {
    let max_len = left.len().max(right.len());
    if max_len == 0 {
        return 0.0;
    }

    let shared = left
        .chars()
        .zip(right.chars())
        .take_while(|(left_char, right_char)| left_char == right_char)
        .count();

    shared as f32 / max_len as f32
}

fn is_supported_subtitle(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SUBTITLE_EXTENSIONS
                .iter()
                .any(|supported| supported.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

fn subtitle_extension_label(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "ssa" => "ass".to_string(),
        extension => extension.to_string(),
    }
}

fn decode_subtitle_bytes(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "utf-8 bom".to_string(),
        );
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (decode_utf16(&bytes[2..], true), "utf-16 le".to_string());
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (decode_utf16(&bytes[2..], false), "utf-16 be".to_string());
    }

    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return (text, "utf-8".to_string());
    }

    let (decoded_kr, _, had_errors_kr) = EUC_KR.decode(bytes);
    if !had_errors_kr {
        return (decoded_kr.into_owned(), "euc-kr / cp949".to_string());
    }

    let (decoded_fallback, _, _) = WINDOWS_1252.decode(bytes);
    (
        decoded_fallback.into_owned(),
        "windows-1252 fallback".to_string(),
    )
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let mut units = Vec::with_capacity(bytes.len() / 2);

    for chunk in bytes.chunks_exact(2) {
        let value = if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        };
        units.push(value);
    }

    String::from_utf16_lossy(&units)
}

fn detect_subtitle_format(path: &Path, decoded_text: &str) -> SubtitleFormat {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "ass" | "ssa" => SubtitleFormat::Ass,
        "vtt" => SubtitleFormat::Vtt,
        "srt" => SubtitleFormat::Srt,
        _ => {
            let normalized = normalize_newlines(decoded_text);
            let trimmed = normalized.trim_start();
            if trimmed.starts_with("WEBVTT") {
                SubtitleFormat::Vtt
            } else if trimmed.contains("[Script Info]") || trimmed.contains("[Events]") {
                SubtitleFormat::Ass
            } else {
                SubtitleFormat::Srt
            }
        }
    }
}

fn text_cues_to_vtt(text: &str) -> CommandResult<String> {
    let normalized = normalize_newlines(text);
    let mut cue_index = 1;
    let mut output = String::from("WEBVTT\n\n");

    for block in normalized.split("\n\n") {
        let lines = block
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();

        if lines.is_empty() {
            continue;
        }

        let timing_index = if lines.first().is_some_and(|line| line.contains("-->")) {
            0
        } else if lines.get(1).is_some_and(|line| line.contains("-->")) {
            1
        } else {
            continue;
        };

        let Some((start, end)) = parse_arrow_timing(lines[timing_index]) else {
            continue;
        };

        let body = lines
            .iter()
            .skip(timing_index + 1)
            .copied()
            .collect::<Vec<_>>()
            .join("\n");
        if body.trim().is_empty() {
            continue;
        }

        output.push_str(&format!(
            "{cue_index}\n{} --> {}\n{}\n\n",
            format_vtt_timestamp(start),
            format_vtt_timestamp(end),
            body.trim()
        ));
        cue_index += 1;
    }

    if cue_index == 1 {
        return Err("인식 가능한 자막 큐를 찾지 못했습니다.".to_string());
    }

    Ok(output)
}

fn ass_to_vtt(text: &str) -> CommandResult<String> {
    let normalized = normalize_newlines(text);
    let mut in_events = false;
    let mut format_fields = Vec::new();
    let mut cue_index = 1;
    let mut output = String::from("WEBVTT\n\n");

    for line in normalized.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.starts_with('[') {
            in_events = trimmed.eq_ignore_ascii_case("[Events]");
            continue;
        }

        if !in_events {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("Format:") {
            format_fields = rest
                .split(',')
                .map(|field| field.trim().to_ascii_lowercase())
                .collect::<Vec<_>>();
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("Dialogue:") {
            if format_fields.is_empty() {
                format_fields = [
                    "layer", "start", "end", "style", "name", "marginl", "marginr", "marginv",
                    "effect", "text",
                ]
                .into_iter()
                .map(str::to_string)
                .collect();
            }

            let Some((start, end, body)) = parse_ass_dialogue(rest, &format_fields) else {
                continue;
            };

            output.push_str(&format!(
                "{cue_index}\n{} --> {}\n{}\n\n",
                format_vtt_timestamp(start),
                format_vtt_timestamp(end),
                body
            ));
            cue_index += 1;
        }
    }

    if cue_index == 1 {
        return Err("ASS 자막에서 인식 가능한 대사를 찾지 못했습니다.".to_string());
    }

    Ok(output)
}

fn parse_ass_dialogue(line: &str, format_fields: &[String]) -> Option<(u64, u64, String)> {
    let values = line
        .trim()
        .splitn(format_fields.len(), ',')
        .map(str::trim)
        .collect::<Vec<_>>();
    if values.len() < format_fields.len() {
        return None;
    }

    let start_index = format_fields.iter().position(|field| field == "start")?;
    let end_index = format_fields.iter().position(|field| field == "end")?;
    let text_index = format_fields.iter().position(|field| field == "text")?;

    let start = parse_ass_timestamp(values.get(start_index).copied()?)?;
    let end = parse_ass_timestamp(values.get(end_index).copied()?)?;
    let body = sanitize_ass_text(values.get(text_index).copied()?);
    if body.is_empty() || end <= start {
        return None;
    }

    Some((start, end, body))
}

fn sanitize_ass_text(value: &str) -> String {
    static ASS_TAG_RE: OnceLock<Regex> = OnceLock::new();
    let tag_re = ASS_TAG_RE.get_or_init(|| Regex::new(r"\{[^}]*\}").expect("valid ass regex"));

    tag_re
        .replace_all(value, "")
        .replace("\\N", "\n")
        .replace("\\n", "\n")
        .replace("\\h", " ")
        .trim()
        .to_string()
}

fn parse_arrow_timing(line: &str) -> Option<(u64, u64)> {
    let (start, end) = line.split_once("-->")?;
    let start_ms = parse_general_timestamp(start)?;
    let end_time = end.split_whitespace().next().unwrap_or_default();
    let end_ms = parse_general_timestamp(end_time)?;
    if end_ms <= start_ms {
        return None;
    }

    Some((start_ms, end_ms))
}

fn parse_general_timestamp(raw: &str) -> Option<u64> {
    let sanitized = raw.trim().replace(',', ".");
    let parts = sanitized.split(':').collect::<Vec<_>>();

    let (hours, minutes, seconds_part) = match parts.as_slice() {
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            *seconds,
        ),
        [minutes, seconds] => (0, minutes.parse::<u64>().ok()?, *seconds),
        _ => return None,
    };

    let (seconds, fraction) = seconds_part.split_once('.').unwrap_or((seconds_part, "0"));
    let seconds = seconds.parse::<u64>().ok()?;
    let millis = fraction_to_millis(fraction)?;

    Some((((hours * 60) + minutes) * 60 + seconds) * 1000 + millis)
}

fn parse_ass_timestamp(raw: &str) -> Option<u64> {
    let sanitized = raw.trim();
    let parts = sanitized.split(':').collect::<Vec<_>>();
    let [hours, minutes, seconds_part] = parts.as_slice() else {
        return None;
    };

    let (seconds, fraction) = seconds_part.split_once('.').unwrap_or((seconds_part, "0"));
    let hours = hours.parse::<u64>().ok()?;
    let minutes = minutes.parse::<u64>().ok()?;
    let seconds = seconds.parse::<u64>().ok()?;
    let centiseconds = fraction
        .chars()
        .take(2)
        .collect::<String>()
        .parse::<u64>()
        .ok()?;

    Some((((hours * 60) + minutes) * 60 + seconds) * 1000 + centiseconds * 10)
}

fn fraction_to_millis(raw: &str) -> Option<u64> {
    let digits = raw.chars().take(3).collect::<String>();
    if digits.is_empty() || !digits.chars().all(|char| char.is_ascii_digit()) {
        return Some(0);
    }

    let mut padded = digits;
    while padded.len() < 3 {
        padded.push('0');
    }

    padded.parse::<u64>().ok()
}

fn format_vtt_timestamp(milliseconds: u64) -> String {
    let hours = milliseconds / 3_600_000;
    let minutes = (milliseconds % 3_600_000) / 60_000;
    let seconds = (milliseconds % 60_000) / 1000;
    let millis = milliseconds % 1000;

    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn file_display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(path))
}

pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
