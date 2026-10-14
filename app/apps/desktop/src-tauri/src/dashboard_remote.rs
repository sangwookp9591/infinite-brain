// SPDX-License-Identifier: Apache-2.0
//! Remote pages use an inline native child webview, with no Baalda capabilities.
//! This respects frame-ancestors instead of proxying or modifying provider HTML.
use crate::error::{AppError, AppResult};
use tauri::{Manager, WebviewUrl, Webview, webview::WebviewBuilder, LogicalPosition, LogicalSize};

fn provider_url(value: &str) -> AppResult<tauri::Url> {
    let url = tauri::Url::parse(value).map_err(|_| AppError("Invalid dashboard link".into()))?;
    let host = url.host_str().unwrap_or_default();
    let provider = ["claude.ai", "claude.site", "chatgpt.com", "openai.com"]
        .iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    if value.len() > 4096 || url.scheme() != "https" || !url.username().is_empty()
        || url.password().is_some() || !provider || url.port().is_some_and(|p| p != 443) {
        return Err(AppError("Use an HTTPS dashboard link from a supported provider".into()));
    }
    Ok(url)
}

#[derive(serde::Deserialize)]
pub struct Bounds { x: f64, y: f64, width: f64, height: f64 }
impl Bounds {
    fn validate(&self) -> AppResult<()> {
        if [self.x, self.y, self.width, self.height].iter().any(|v| !v.is_finite())
            || self.x < 0.0 || self.y < 0.0 || self.width < 1.0 || self.height < 1.0
            || self.width > 20000.0 || self.height > 20000.0 {
            return Err(AppError("Invalid dashboard bounds".into()));
        }
        Ok(())
    }
}
fn authorize(view: &Webview) -> AppResult<()> {
    if view.label() != "main" { return Err(AppError("Only the main webview can control dashboards".into())); }
    Ok(())
}
fn child(view: &Webview, label: &str) -> AppResult<Option<Webview>> {
    authorize(view)?;
    if !label.starts_with("dashboard-link-") { return Err(AppError("Invalid dashboard viewer".into())); }
    Ok(view.app_handle().get_webview(label).filter(|v| v.window().label() == view.window().label()))
}

// Async is required by WebView2: child creation must not block the UI thread.
#[tauri::command]
pub async fn mount_dashboard_link(webview: Webview, url: String, bounds: Bounds, on_load: tauri::ipc::Channel<()>) -> AppResult<String> {
    authorize(&webview)?;
    bounds.validate()?;
    let url = provider_url(&url)?;
    let label = format!("dashboard-link-{}", uuid::Uuid::new_v4());
    let viewer = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { let _ = on_load.send(()); }
        })
        // No remote IPC capabilities or vault bridge. Keep provider protections.
        .on_navigation(|url| {
            provider_url(url.as_str()).is_ok() || (url.scheme() == "https"
                && url.username().is_empty() && url.password().is_none()
                && matches!(url.host_str(), Some("accounts.google.com" | "appleid.apple.com")))
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    webview.window().add_child(viewer,
        LogicalPosition::new(-20000.0, -20000.0), LogicalSize::new(bounds.width, bounds.height))?;
    Ok(label)
}
#[tauri::command]
pub async fn update_dashboard_link(webview: Webview, label: String, bounds: Bounds, visible: bool) -> AppResult<()> {
    bounds.validate()?;
    if let Some(viewer) = child(&webview, &label)? {
        if visible {
            viewer.set_bounds(tauri::Rect { position: LogicalPosition::new(bounds.x, bounds.y).into(), size: LogicalSize::new(bounds.width, bounds.height).into() })?;
            viewer.show()?;
        } else { viewer.hide()?; }
    }
    Ok(())
}
#[tauri::command]
pub async fn unmount_dashboard_link(webview: Webview, label: String) -> AppResult<()> {
    if let Some(viewer) = child(&webview, &label)? { viewer.close()?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_provider_links_and_preserves_share_parameters() {
        let url = "https://claude.ai/artifact/example?sk=example-share-key";
        assert_eq!(provider_url(url).unwrap().as_str(), url);
        assert!(provider_url("https://demo.claude.site").is_ok());
    }
    #[test]
    fn rejects_local_urls_credentials_and_provider_lookalikes() {
        for url in ["file:///etc/passwd", "http://claude.ai", "https://claude.ai.evil.com", "https://evilclaude.ai", "https://user:pass@claude.ai", "https://localhost", "baalda-view://localhost", "https://claude.ai:8443"] {
            assert!(provider_url(url).is_err(), "{url}");
        }
    }
}
