mod media;
mod mpv;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media::close_window,
            media::get_app_settings,
            media::list_recent_files,
            media::load_subtitle,
            media::prepare_media,
            media::set_app_language,
            media::set_window_title,
            mpv::mpv_disable_subtitle,
            mpv::mpv_get_status,
            mpv::mpv_load_subtitle,
            mpv::mpv_open_media,
            mpv::mpv_restart,
            mpv::mpv_seek_absolute,
            mpv::mpv_seek_relative,
            mpv::mpv_set_volume,
            mpv::mpv_toggle_playback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
