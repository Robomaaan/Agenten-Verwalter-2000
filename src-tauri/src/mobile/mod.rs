use std::fs;
use std::io::{self, ErrorKind, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tauri::{AppHandle, Event, Listener, Manager};

use crate::agents::event::QuestionAnswer;
use crate::artifacts::server::content_type;
use crate::error::CommandError;
use crate::filesystem::workspace::data_dir;
use crate::mcp_access::http::{self, Head, Reply, text_reply};
use crate::sessions::registry::{
    CHAT_ENTRY_EVENT, PROJECT_CHANGED_EVENT, SESSION_CHANGED_EVENT, SessionRegistry,
};

pub const PORT: u16 = 47800;
const KEY_FILE: &str = "handy-schluessel.txt";
const COOKIE_NAME: &str = "verwalter_handy";
const COOKIE_MAX_AGE_SECONDS: u32 = 365 * 24 * 60 * 60;
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const KEEPALIVE: Duration = Duration::from_secs(20);
const DEFAULT_HISTORY_PAGE: u32 = 50;
const APPLICATION_JSON: &str = "application/json";
const PAGE: &str = "mobile.html";
const PAGE_CSP: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
const LOGIN_PATH: &str = "/api/login";
const EVENTS_PATH: &str = "/api/events";
const FORWARDED_EVENTS: [(&str, &str); 3] = [
    (CHAT_ENTRY_EVENT, "chat"),
    (SESSION_CHANGED_EVENT, "session"),
    (PROJECT_CHANGED_EVENT, "project"),
];

pub fn start(app: AppHandle) -> io::Result<()> {
    let key = load_or_create_key(&app)?;
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, PORT)))?;
    let subscribers = Arc::new(Subscribers::default());
    for (core_event, name) in FORWARDED_EVENTS {
        let subscribers = Arc::clone(&subscribers);
        app.listen_any(core_event, move |event: Event| {
            subscribers.broadcast(&format!("event: {name}\ndata: {}\n\n", event.payload()));
        });
    }
    let server = Arc::new(Server {
        app,
        key,
        subscribers,
    });
    thread::Builder::new()
        .name("mobile".to_owned())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let server = Arc::clone(&server);
                let _ = thread::Builder::new()
                    .name("mobile-request".to_owned())
                    .spawn(move || server.serve(stream));
            }
        })?;
    Ok(())
}

/// Ein neuer Schlüssel nur, wenn es noch keinen gibt: jeder andere Lesefehler meldete das Handy sonst ab.
fn load_or_create_key(app: &AppHandle) -> io::Result<String> {
    let dir = data_dir(app).map_err(|error: CommandError| io::Error::other(error.to_string()))?;
    let file = dir.join(KEY_FILE);
    match fs::read_to_string(&file) {
        Ok(existing) if !existing.trim().is_empty() => return Ok(existing.trim().to_owned()),
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let key = uuid::Uuid::new_v4().simple().to_string();
    fs::create_dir_all(&dir)?;
    fs::write(&file, &key)?;
    Ok(key)
}

#[derive(Default)]
struct Subscribers(Mutex<Vec<Sender<String>>>);

impl Subscribers {
    fn broadcast(&self, message: &str) {
        self.lock()
            .retain(|sender: &Sender<String>| sender.send(message.to_owned()).is_ok());
    }

    fn subscribe(&self) -> Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        self.lock().push(sender);
        receiver
    }

    fn lock(&self) -> MutexGuard<'_, Vec<Sender<String>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Deserialize)]
struct LoginInput {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInput {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendInput {
    session_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerInput {
    session_id: String,
    request_id: String,
    answer: QuestionAnswer,
}

struct Server {
    app: AppHandle,
    key: String,
    subscribers: Arc<Subscribers>,
}

impl Server {
    fn serve(&self, mut stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
        let Some(head) = http::read_head(&mut stream) else {
            let _ = http::write_reply(&mut stream, &text_reply(400, "Bad Request", "Ungültig"));
            return;
        };
        let path = head
            .path
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .to_owned();
        if head.method == "GET" && path == EVENTS_PATH && self.is_signed_in(&head) {
            self.stream_events(stream);
            return;
        }
        let (reply, body_unread) = self.answer(&mut stream, head, &path);
        let _ = http::write_reply(&mut stream, &reply);
        if body_unread {
            http::drain(&mut stream);
        }
    }

    /// Der zweite Wert sagt, ob ein Körper ungelesen blieb (wie im MCP-Zugang).
    fn answer(&self, stream: &mut TcpStream, head: Head, path: &str) -> (Reply, bool) {
        let is_post = head.method == "POST";
        if !path.starts_with("/api/") {
            return match head.method.as_str() {
                "GET" => (self.asset(path), false),
                _ => (text_reply(405, "Method Not Allowed", "Nur GET"), true),
            };
        }
        if path != LOGIN_PATH && !self.is_signed_in(&head) {
            return (text_reply(401, "Unauthorized", "Nicht angemeldet"), is_post);
        }
        let registry = self.app.state::<SessionRegistry>();
        let method = head.method.clone();
        match (method.as_str(), path) {
            ("GET", "/api/projects") => (result_reply(Ok(registry.list_projects())), false),
            ("GET", "/api/sessions") => (result_reply(Ok(registry.list())), false),
            ("GET", "/api/chat") => {
                let query = head.path.split_once('?').map_or("", |(_, query)| query);
                let Some(session_id) = query_param(query, "session") else {
                    return (text_reply(400, "Bad Request", "session fehlt"), false);
                };
                let number = |name: &str| -> Option<u32> {
                    query_param(query, name).and_then(|value: &str| value.parse().ok())
                };
                let limit = number("limit").unwrap_or(DEFAULT_HISTORY_PAGE);
                let page = registry.history(session_id, number("before"), limit);
                (result_reply(page), false)
            }
            ("POST", _) => self.post(stream, head, path),
            _ => (text_reply(404, "Not Found", "Nicht gefunden"), false),
        }
    }

    fn post(&self, stream: &mut TcpStream, head: Head, path: &str) -> (Reply, bool) {
        let body = match http::read_json_body(stream, head) {
            Ok(body) => body,
            Err(reply) => return (reply, true),
        };
        let app = &self.app;
        let registry = app.state::<SessionRegistry>();
        let registry = registry.inner();
        let reply = match path {
            LOGIN_PATH => self.login(&body),
            "/api/send" => run(&body, |input: SendInput| {
                registry.send(app, &input.session_id, &input.text, &[], &[])
            }),
            "/api/answer" => run(&body, |input: AnswerInput| {
                registry.answer(app, &input.session_id, &input.request_id, &input.answer)
            }),
            "/api/pause" => run(&body, |input: SessionInput| {
                registry.pause(app, &input.session_id)
            }),
            "/api/resume" => run(&body, |input: SessionInput| {
                registry.resume(app, &input.session_id)
            }),
            _ => text_reply(404, "Not Found", "Nicht gefunden"),
        };
        (reply, false)
    }

    fn login(&self, body: &[u8]) -> Reply {
        match serde_json::from_slice::<LoginInput>(body) {
            Ok(input) if input.key.trim() == self.key => Reply {
                status: 204,
                reason: "No Content",
                content_type: APPLICATION_JSON,
                body: Vec::new(),
                headers: vec![(
                    "Set-Cookie",
                    format!(
                        "{COOKIE_NAME}={}; Path=/; Max-Age={COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict",
                        self.key
                    ),
                )],
            },
            Ok(_) => text_reply(401, "Unauthorized", "Falscher Schlüssel"),
            Err(_) => text_reply(400, "Bad Request", "key fehlt"),
        }
    }

    fn is_signed_in(&self, head: &Head) -> bool {
        head.header("cookie").is_some_and(|cookies: &str| {
            cookies.split(';').any(|pair: &str| {
                pair.trim().split_once('=') == Some((COOKIE_NAME, self.key.as_str()))
            })
        })
    }

    fn asset(&self, path: &str) -> Reply {
        let name = match path.trim_start_matches('/') {
            "" => PAGE,
            other => other,
        };
        // Im Dev-Lauf liest der Asset-Resolver `dist/<name>` von der Platte; `..` und Laufwerke lösen dort nichts auf.
        if name.contains("..") || name.contains(['\\', ':']) {
            return text_reply(404, "Not Found", "Nicht gefunden");
        }
        match self.app.asset_resolver().get(name.to_owned()) {
            Some(asset) => Reply {
                status: 200,
                reason: "OK",
                content_type: content_type(Path::new(name)),
                body: asset.bytes().to_vec(),
                headers: vec![("Content-Security-Policy", PAGE_CSP.to_owned())],
            },
            None => text_reply(404, "Not Found", "Nicht gefunden"),
        }
    }

    fn stream_events(&self, mut stream: TcpStream) {
        // Ein Handy, das nicht mehr liest, hielte den Thread sonst für immer in `write_all`.
        let _ = stream.set_write_timeout(Some(KEEPALIVE));
        let receiver = self.subscribers.subscribe();
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\n\
                    X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n: verbunden\n\n";
        if write_flushed(&mut stream, head).is_err() {
            return;
        }
        loop {
            let message = match receiver.recv_timeout(KEEPALIVE) {
                Ok(message) => message,
                Err(RecvTimeoutError::Timeout) => ": ping\n\n".to_owned(),
                Err(RecvTimeoutError::Disconnected) => return,
            };
            if write_flushed(&mut stream, &message).is_err() {
                return;
            }
        }
    }
}

fn run<T: DeserializeOwned>(
    body: &[u8],
    action: impl FnOnce(T) -> Result<(), CommandError>,
) -> Reply {
    match serde_json::from_slice::<T>(body) {
        Ok(input) => result_reply(action(input)),
        Err(error) => text_reply(400, "Bad Request", &error.to_string()),
    }
}

fn write_flushed(stream: &mut TcpStream, text: &str) -> io::Result<()> {
    stream.write_all(text.as_bytes())?;
    stream.flush()
}

/// Ohne Prozent-Dekodierung: Session-IDs und Zahlen kommen unverändert an.
fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|pair: &str| pair.split_once('='))
        .find(|(key, _): &(&str, &str)| *key == name)
        .map(|(_, value): (&str, &str)| value)
}

fn result_reply<T: Serialize>(result: Result<T, CommandError>) -> Reply {
    let (status, reason, body) = match &result {
        Ok(value) => (200, "OK", serde_json::to_vec(value)),
        Err(error) => (409, "Conflict", serde_json::to_vec(error)),
    };
    match body {
        Ok(body) => Reply {
            status,
            reason,
            content_type: APPLICATION_JSON,
            body,
            headers: Vec::new(),
        },
        Err(error) => text_reply(500, "Internal Server Error", &error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::query_param;

    #[test]
    fn query_param_finds_value_by_name() {
        assert_eq!(query_param("session=abc&before=12", "before"), Some("12"));
        assert_eq!(query_param("session=abc", "before"), None);
        assert_eq!(query_param("", "session"), None);
    }
}
