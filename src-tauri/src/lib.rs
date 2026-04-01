use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use arboard::Clipboard;
use base64::Engine;
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEV_FRONTEND_URL: &str = "http://127.0.0.1:5174";
const DEV_SERVER_ORIGIN: &str = "http://127.0.0.1:3211";

#[derive(Default)]
struct DesktopSidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[derive(Deserialize)]
struct SidecarReadyEvent {
    #[serde(rename = "type")]
    event_type: String,
    origin: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardImagePayload {
    png_base64: String,
    width: usize,
    height: usize,
}

#[derive(Clone, Copy)]
struct ClipboardMimeType {
    name: &'static str,
    image_format: ImageFormat,
}

const LINUX_CLIPBOARD_IMAGE_MIME_TYPES: [ClipboardMimeType; 6] = [
    ClipboardMimeType {
        name: "image/png",
        image_format: ImageFormat::Png,
    },
    ClipboardMimeType {
        name: "image/jpeg",
        image_format: ImageFormat::Jpeg,
    },
    ClipboardMimeType {
        name: "image/jpg",
        image_format: ImageFormat::Jpeg,
    },
    ClipboardMimeType {
        name: "image/webp",
        image_format: ImageFormat::WebP,
    },
    ClipboardMimeType {
        name: "image/gif",
        image_format: ImageFormat::Gif,
    },
    ClipboardMimeType {
        name: "image/bmp",
        image_format: ImageFormat::Bmp,
    },
];

fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

fn make_init_script(server_origin: &str) -> String {
    format!(
        "window.__KANNA_SERVER_ORIGIN__ = {};",
        serde_json::to_string(server_origin).expect("failed to serialize server origin")
    )
}

fn create_main_window<R: Runtime>(
    app: &AppHandle<R>,
    url: WebviewUrl,
    server_origin: &str,
) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "main", url)
        .title("Kanna")
        .inner_size(1400.0, 920.0)
        .min_inner_size(960.0, 640.0)
        .initialization_script(&make_init_script(server_origin))
        .build()?;

    Ok(())
}

fn store_sidecar_child<R: Runtime>(app: &AppHandle<R>, child: CommandChild) -> Result<(), String> {
    let state = app.state::<DesktopSidecarState>();
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Failed to lock sidecar state".to_string())?;
    *guard = Some(child);
    Ok(())
}

fn take_sidecar_child<R: Runtime>(app: &AppHandle<R>) -> Option<CommandChild> {
    let state = app.state::<DesktopSidecarState>();
    let mut guard = state.child.lock().ok()?;
    guard.take()
}

fn kill_sidecar<R: Runtime>(app: &AppHandle<R>) {
    if let Some(child) = take_sidecar_child(app) {
        let _ = child.kill();
    }
}

fn parse_ready_event(line: &str) -> Option<SidecarReadyEvent> {
    let parsed = serde_json::from_str::<SidecarReadyEvent>(line).ok()?;
    if parsed.event_type == "ready" {
        Some(parsed)
    } else {
        None
    }
}

fn is_client_dist_dir(path: &Path) -> bool {
    path.join("index.html").is_file()
}

fn find_client_dist_dir_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor.join("dist").join("client");
        if is_client_dist_dir(&candidate) {
            return Some(candidate);
        }
    }

    None
}

fn resolve_client_dist_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_dist = resource_dir.join("dist").join("client");
        if is_client_dist_dir(&bundled_dist) {
            return Some(bundled_dist);
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            if let Some(found) = find_client_dist_dir_from(parent) {
                return Some(found);
            }
        }
    }

    None
}

fn encode_dynamic_image_as_payload(image: DynamicImage) -> Result<ClipboardImagePayload, String> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|error| error.to_string())?;

    Ok(ClipboardImagePayload {
        png_base64: base64::engine::general_purpose::STANDARD.encode(png.into_inner()),
        width,
        height,
    })
}

#[cfg(target_os = "linux")]
fn parse_clipboard_mime_types(stdout: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(target_os = "linux")]
fn available_linux_clipboard_image_mime_types() -> Vec<ClipboardMimeType> {
    let mut available = Vec::new();

    if let Ok(output) = Command::new("wl-paste").arg("--list-types").output() {
        if output.status.success() {
            let mime_types = parse_clipboard_mime_types(&output.stdout);
            for supported in LINUX_CLIPBOARD_IMAGE_MIME_TYPES {
                if mime_types.iter().any(|mime| mime == supported.name) {
                    available.push(supported);
                }
            }
        }
    }

    if available.is_empty() {
        if let Ok(output) = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "TARGETS", "-o"])
            .output()
        {
            if output.status.success() {
                let mime_types = parse_clipboard_mime_types(&output.stdout);
                for supported in LINUX_CLIPBOARD_IMAGE_MIME_TYPES {
                    if mime_types.iter().any(|mime| mime == supported.name) {
                        available.push(supported);
                    }
                }
            }
        }
    }

    available
}

#[cfg(target_os = "linux")]
fn read_linux_clipboard_image() -> Result<Option<ClipboardImagePayload>, String> {
    for mime_type in available_linux_clipboard_image_mime_types() {
        if let Ok(output) = Command::new("wl-paste")
            .args(["--no-newline", "--type", mime_type.name])
            .output()
        {
            if output.status.success() && !output.stdout.is_empty() {
                let image =
                    image::load_from_memory_with_format(&output.stdout, mime_type.image_format)
                        .map_err(|error| error.to_string())?;
                return encode_dynamic_image_as_payload(image).map(Some);
            }
        }

        if let Ok(output) = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", mime_type.name, "-o"])
            .output()
        {
            if output.status.success() && !output.stdout.is_empty() {
                let image =
                    image::load_from_memory_with_format(&output.stdout, mime_type.image_format)
                        .map_err(|error| error.to_string())?;
                return encode_dynamic_image_as_payload(image).map(Some);
            }
        }
    }

    Ok(None)
}

async fn launch_sidecar_and_open_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let mut sidecar = app
        .shell()
        .sidecar("kanna-sidecar")
        .map_err(|error| error.to_string())?;

    if let Some(dist_dir) = resolve_client_dist_dir(&app) {
        sidecar = sidecar.env("KANNA_DESKTOP_DIST_DIR", dist_dir);
    }

    let (mut rx, child) = sidecar.spawn().map_err(|error| error.to_string())?;
    store_sidecar_child(&app, child)?;

    let mut buffered_stdout = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                buffered_stdout.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(line_break) = buffered_stdout.find('\n') {
                    let line = buffered_stdout[..line_break].trim().to_string();
                    buffered_stdout = buffered_stdout[line_break + 1..].to_string();

                    if line.is_empty() {
                        continue;
                    }

                    if let Some(ready) = parse_ready_event(&line) {
                        let url = ready
                            .origin
                            .parse::<Url>()
                            .map_err(|error| error.to_string())?;
                        let app_handle = app.clone();
                        app.run_on_main_thread(move || {
                            if let Err(error) = create_main_window(
                                &app_handle,
                                WebviewUrl::External(url),
                                &ready.origin,
                            ) {
                                eprintln!("[kanna-desktop] {error}");
                                app_handle.exit(1);
                            }
                        })
                        .map_err(|error| error.to_string())?;
                        return Ok(());
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                eprintln!("[kanna-desktop] {}", String::from_utf8_lossy(&bytes).trim());
            }
            CommandEvent::Terminated(payload) => {
                return Err(format!(
                    "Desktop sidecar exited before ready (code: {:?}, signal: {:?})",
                    payload.code, payload.signal
                ));
            }
            _ => {}
        }
    }

    Err("Desktop sidecar closed before reporting readiness.".to_string())
}

#[tauri::command]
async fn read_clipboard_image() -> Result<Option<ClipboardImagePayload>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
        let image = match clipboard.get_image() {
            Ok(image) => image,
            Err(error) => {
                #[cfg(target_os = "linux")]
                {
                    if let Some(payload) = read_linux_clipboard_image()? {
                        return Ok(Some(payload));
                    }
                }

                let message = error.to_string();
                if message.to_lowercase().contains("content not available") {
                    return Ok(None);
                }
                return Err(message);
            }
        };

        let rgba = RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        )
        .ok_or_else(|| "Clipboard image bytes could not be decoded.".to_string())?;

        encode_dynamic_image_as_payload(DynamicImage::ImageRgba8(rgba)).map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::parse_clipboard_mime_types;
    use super::ClipboardImagePayload;

    #[test]
    fn clipboard_image_payload_serializes_with_camel_case() {
        let payload = ClipboardImagePayload {
            png_base64: "abc".to_string(),
            width: 12,
            height: 34,
        };

        let json = serde_json::to_value(payload).expect("clipboard payload should serialize");
        assert_eq!(
            json.get("pngBase64").and_then(|value| value.as_str()),
            Some("abc")
        );
        assert_eq!(json.get("width").and_then(|value| value.as_u64()), Some(12));
        assert_eq!(
            json.get("height").and_then(|value| value.as_u64()),
            Some(34)
        );
        assert!(json.get("png_base64").is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_clipboard_mime_types_ignores_blank_lines() {
        let mime_types = parse_clipboard_mime_types(b"\nimage/png\ntext/plain\n \n");
        assert_eq!(mime_types, vec!["image/png", "text/plain"]);
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(DesktopSidecarState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![read_clipboard_image])
        .setup(|app| {
            if is_dev_mode() {
                create_main_window(
                    &app.handle(),
                    WebviewUrl::External(
                        DEV_FRONTEND_URL.parse().expect("invalid dev frontend url"),
                    ),
                    DEV_SERVER_ORIGIN,
                )?;
                return Ok(());
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = launch_sidecar_and_open_window(app_handle.clone()).await {
                    eprintln!("[kanna-desktop] {error}");
                    kill_sidecar(&app_handle);
                    app_handle.exit(1);
                }
            });
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Kanna desktop app");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            kill_sidecar(app_handle);
        }
    });
}
