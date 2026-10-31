use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[cfg(not(target_os = "android"))]
use piratetok_live_rs::TikTokLive;
#[cfg(not(target_os = "android"))]
use piratetok_live_rs::structs::TikTokLiveEvent;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

pub struct TikTokListenerState {
    pub stop_signal: Arc<AtomicBool>,
}

impl Default for TikTokListenerState {
    fn default() -> Self {
        Self {
            stop_signal: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn start_tiktok_listener(
    app: AppHandle,
    username: String,
    state: State<'_, TikTokListenerState>,
) -> Result<String, String> {
    let clean_user = username.trim_start_matches('@').trim().to_string();
    if clean_user.is_empty() {
        return Err("Username TikTok tidak boleh kosong".into());
    }

    // Stop previous listener if currently running
    state.stop_signal.store(true, Ordering::SeqCst);
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Reset signal for new listener
    let stop_signal = Arc::new(AtomicBool::new(false));
    state.stop_signal.store(false, Ordering::SeqCst);
    let stop_flag = stop_signal.clone();

    let app_handle = app.clone();

    tokio::spawn(async move {
        let _ = app_handle.emit("tiktok-status", serde_json::json!({
            "status": "connecting",
            "message": format!("Menyambungkan langsung ke live @{}...", clean_user)
        }));

        let stream_res = TikTokLive::builder(&clean_user).connect().await;
        let mut stream = match stream_res {
            Ok(s) => {
                let _ = app_handle.emit("tiktok-status", serde_json::json!({
                    "status": "connected",
                    "message": format!("Terhubung langsung ke @{}", clean_user)
                }));
                s
            }
            Err(e) => {
                let _ = app_handle.emit("tiktok-status", serde_json::json!({
                    "status": "error",
                    "message": format!("Gagal: {}", e)
                }));
                return;
            }
        };

        while !stop_flag.load(Ordering::SeqCst) {
            match stream.next_event().await {
                Ok(event) => match event {
                    TikTokLiveEvent::Chat(msg) => {
                        let nickname = msg.user.as_ref().map_or("Penonton", |u| u.nickname.as_str());
                        let _ = app_handle.emit("tiktok-chat", serde_json::json!({
                            "uniqueId": nickname,
                            "nickname": nickname,
                            "comment": msg.comment,
                            "timestamp": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64
                        }));
                    }
                    TikTokLiveEvent::Gift(gift) => {
                        let nickname = gift.user.as_ref().map_or("Penonton", |u| u.nickname.as_str());
                        let gift_name = gift.gift_details.as_ref().map_or("Gift Cantik", |g| g.gift_name.as_str());
                        let repeat_count = gift.repeat_count;
                        let diamond_count = gift.diamond_total();

                        let _ = app_handle.emit("tiktok-gift", serde_json::json!({
                            "uniqueId": nickname,
                            "nickname": nickname,
                            "giftName": gift_name,
                            "repeatCount": repeat_count,
                            "diamondCount": diamond_count
                        }));
                    }
                    TikTokLiveEvent::Like(like) => {
                        let _ = app_handle.emit("tiktok-like", serde_json::json!({
                            "totalLikes": like.total_like_count
                        }));
                    }
                    TikTokLiveEvent::Disconnected => {
                        let _ = app_handle.emit("tiktok-status", serde_json::json!({
                            "status": "disconnected",
                            "message": "Live streaming terputus atau berakhir"
                        }));
                        break;
                    }
                    _ => {}
                },
                Err(_) => {
                    if stop_flag.load(Ordering::SeqCst) {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }
    });

    Ok("OK".into())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn start_tiktok_listener(
    _app: AppHandle,
    _username: String,
    _state: State<'_, TikTokListenerState>,
) -> Result<String, String> {
    Err("PENGATURAN_FALLBACK_WS".into())
}

#[tauri::command]
async fn stop_tiktok_listener(state: State<'_, TikTokListenerState>) -> Result<String, String> {
    state.stop_signal.store(true, Ordering::SeqCst);
    Ok("OK".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TikTokListenerState::default())
        .invoke_handler(tauri::generate_handler![
            start_tiktok_listener,
            stop_tiktok_listener
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
