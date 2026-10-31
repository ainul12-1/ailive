use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use piratetok_live_rs::TikTokLive;
use piratetok_live_rs::structs::TikTokLiveEvent;

static LISTENER_GENERATION: AtomicU64 = AtomicU64::new(0);

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

    // Increment generation to immediately invalidate any previously running listener task
    let my_generation = LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    state.stop_signal.store(false, Ordering::SeqCst);

    let app_handle = app.clone();

    tokio::spawn(async move {
        let _ = app_handle.emit("tiktok-status", serde_json::json!({
            "status": "connecting",
            "message": format!("Menyambungkan langsung ke live @{}...", clean_user)
        }));

        let stream_res = TikTokLive::builder(&clean_user).connect().await;
        
        // If another listener was spawned while connecting, abort immediately
        if LISTENER_GENERATION.load(Ordering::SeqCst) != my_generation {
            return;
        }

        let mut stream = match stream_res {
            Ok(s) => {
                let _ = app_handle.emit("tiktok-status", serde_json::json!({
                    "status": "connected",
                    "message": format!("Terhubung langsung ke @{}", clean_user)
                }));
                s
            }
            Err(e) => {
                let err_str = e.to_string();
                let user_msg = if err_str.to_lowercase().contains("offline") || err_str.to_lowercase().contains("not found") {
                    format!("Akun @{} sedang tidak aktif LIVE saat ini.", clean_user)
                } else if err_str.to_lowercase().contains("blocked") || err_str.to_lowercase().contains("captcha") {
                    format!("TikTok mendeteksi pembatasan pada @{}. Coba beberapa saat lagi.", clean_user)
                } else {
                    format!("Gagal terhubung ke @{}: {}", clean_user, err_str)
                };
                let _ = app_handle.emit("tiktok-status", serde_json::json!({
                    "status": "error",
                    "message": user_msg
                }));
                return;
            }
        };

        while LISTENER_GENERATION.load(Ordering::SeqCst) == my_generation {
            match stream.next_event().await {
                Ok(event) => {
                    // Check generation after await
                    if LISTENER_GENERATION.load(Ordering::SeqCst) != my_generation {
                        break;
                    }

                    match event {
                        TikTokLiveEvent::Chat(msg) => {
                            let nickname = msg.user.as_ref().map_or("Penonton", |u| u.nickname.as_str());
                            let unique_id = msg.user.as_ref().map_or(nickname, |u| {
                                if !u.unique_id.is_empty() { u.unique_id.as_str() } else { nickname }
                            });
                            let msg_id = msg.common.as_ref().map(|c| c.msg_id).unwrap_or(0);

                            let _ = app_handle.emit("tiktok-chat", serde_json::json!({
                                "msgId": msg_id,
                                "uniqueId": unique_id,
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
                            let unique_id = gift.user.as_ref().map_or(nickname, |u| {
                                if !u.unique_id.is_empty() { u.unique_id.as_str() } else { nickname }
                            });
                            let gift_name = gift.gift_details.as_ref().map_or("Gift Cantik", |g| g.gift_name.as_str());
                            let repeat_count = gift.repeat_count;
                            let diamond_count = gift.diamond_total();

                            let _ = app_handle.emit("tiktok-gift", serde_json::json!({
                                "uniqueId": unique_id,
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
                        TikTokLiveEvent::Join(member) => {
                            let nickname = member.user.as_ref().map_or("Penonton", |u| u.nickname.as_str());
                            let unique_id = member.user.as_ref().map_or(nickname, |u| {
                                if !u.unique_id.is_empty() { u.unique_id.as_str() } else { nickname }
                            });
                            let _ = app_handle.emit("tiktok-join", serde_json::json!({
                                "uniqueId": unique_id,
                                "nickname": nickname,
                                "timestamp": std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64
                            }));
                        }
                        TikTokLiveEvent::Disconnected => {
                            let _ = app_handle.emit("tiktok-status", serde_json::json!({
                                "status": "disconnected",
                                "message": "Live streaming terputus atau telah berakhir"
                            }));
                            break;
                        }
                        _ => {}
                    }
                }
                Err(_) => {
                    if LISTENER_GENERATION.load(Ordering::SeqCst) != my_generation {
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }
    });

    Ok("OK".into())
}

#[tauri::command]
async fn stop_tiktok_listener(state: State<'_, TikTokListenerState>) -> Result<String, String> {
    // Invalidate listener generation so current task breaks immediately
    LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst);
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
