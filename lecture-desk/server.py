#!/usr/bin/env python3
"""Run: python3 lecture-desk/server.py. Python 3.10+, no third-party packages."""

import argparse
import json
import mimetypes
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

from store import Store, uid

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MAX_JSON = 8 * 1024 * 1024
MAX_FILE = 500 * 1024 * 1024
AUDIO = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
}
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"


class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, store):
        self.store = store
        super().__init__(("127.0.0.1", port), Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "BelizDesk"

    def setup(self):
        super().setup()
        self.connection.settimeout(120)

    def log_message(self, *_):
        # Do not write lecture identifiers, search strings or source material to logs.
        pass

    def headers_out(self, status, mime, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        policy = CSP
        if urlsplit(self.path).path.startswith("/pcr-explained/"):
            policy = (
                CSP.replace(
                    "style-src 'self'",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                )
                .replace("font-src 'self'", "font-src 'self' https://fonts.gstatic.com")
                .replace(
                    "img-src 'self' data:", "img-src 'self' data: https://i.ytimg.com"
                )
                .replace(
                    "frame-src 'self'",
                    "frame-src 'self' https://www.youtube-nocookie.com",
                )
            )
        self.send_header("Content-Security-Policy", policy)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def json_out(self, value, status=200):
        payload = json.dumps(value, ensure_ascii=False).encode()
        self.headers_out(status, "application/json; charset=utf-8", len(payload))
        if self.command != "HEAD":
            self.wfile.write(payload)

    def guard(self):
        port = self.server.server_port
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed:
            raise RequestError(403, "Open Lecture Desk using its localhost address.")
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            raise RequestError(403, "Requests from other websites are not allowed.")
        if (
            self.command not in ("GET", "HEAD")
            and self.headers.get("X-Beliz-Request") != "local"
        ):
            raise RequestError(403, "This change must come from Lecture Desk.")
        if (
            self.headers.get("Sec-Fetch-Site") == "cross-site"
            and self.headers.get("Sec-Fetch-Mode") != "navigate"
        ):
            raise RequestError(403, "Cross-site access is not allowed.")

    def length(self, maximum):
        if self.headers.get("Transfer-Encoding"):
            raise RequestError(400, "Chunked uploads are not supported.")
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0:
            raise RequestError(411, "A content length is required.")
        if length > maximum:
            raise RequestError(
                413, f"File is too large. Limit: {maximum // (1024 * 1024)} MB."
            )
        return length

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            raise RequestError(415, "Expected JSON.")
        length = self.length(MAX_JSON)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise RequestError(400, "The upload was interrupted. Nothing was saved.")
        try:
            value = json.loads(
                raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError())
            )
        except (ValueError, UnicodeDecodeError):
            raise RequestError(400, "Could not read the request. Try again.")
        if not isinstance(value, dict):
            raise RequestError(400, "Expected a JSON object.")
        return value

    def send_file(self, path, mime=None, extra=None, ranges=False):
        if not path.is_file():
            raise KeyError("File not found.")
        with path.open("rb") as stream:
            size = os.fstat(stream.fileno()).st_size
            start, end, status = 0, size - 1, 200
            extra = dict(extra or {})
            if ranges:
                extra["Accept-Ranges"] = "bytes"
                value = self.headers.get("Range")
                if value:
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
                    if not match or not any(match.groups()) or size == 0:
                        self.headers_out(
                            416, "text/plain", 0, {"Content-Range": f"bytes */{size}"}
                        )
                        return
                    a, b = match.groups()
                    if a:
                        start, end = int(a), min(int(b) if b else size - 1, size - 1)
                    else:
                        start = max(0, size - int(b))
                    if start > end or start >= size:
                        self.headers_out(
                            416, "text/plain", 0, {"Content-Range": f"bytes */{size}"}
                        )
                        return
                    status = 206
                    extra["Content-Range"] = f"bytes {start}-{end}/{size}"
            length = max(0, end - start + 1)
            self.headers_out(
                status,
                mime or mimetypes.guess_type(path)[0] or "application/octet-stream",
                length,
                extra,
            )
            if self.command == "HEAD":
                return
            stream.seek(start)
            remaining = length
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def upload(self, identifier, query):
        store = self.server.store
        store.get(identifier)
        kind = query.get("kind", [""])[0]
        name = query.get("name", [""])[0]
        if (
            not name
            or len(name) > 250
            or any(c in name for c in ("/", "\\", "\x00", "\r", "\n"))
        ):
            raise ValueError(
                "Use a filename without path separators or control characters."
            )
        suffix = Path(name).suffix.lower()
        mime = (
            "application/pdf"
            if kind == "slides" and suffix == ".pdf"
            else AUDIO.get(suffix)
            if kind == "audio"
            else None
        )
        if not mime:
            raise ValueError(
                "Slides must be PDF. Audio: MP3, M4A, WAV, OGG, WebM, or FLAC."
            )
        remaining = self.length(MAX_FILE)
        size = remaining
        if not size:
            raise ValueError("The attachment is empty.")
        identifier_file = uid()
        final = store.media / identifier_file
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=store.media, prefix=".upload-", delete=False
            ) as stream:
                temporary = Path(stream.name)
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError(
                            "The attachment was interrupted. The lecture is saved; retry the attachment."
                        )
                    stream.write(chunk)
                    remaining -= len(chunk)
            if kind == "slides":
                with temporary.open("rb") as stream:
                    if not stream.read(1024).lstrip().startswith(b"%PDF-"):
                        raise ValueError(
                            "This file does not look like a PDF. Export the slide deck as PDF and retry."
                        )
            temporary.replace(final)
            doc = store.attach(identifier, identifier_file, kind, name, mime, size)
            self.json_out(doc)
        except Exception:
            # Once registered, an attachment must not be removed on a disconnected response.
            try:
                store.file(identifier_file)
            except KeyError:
                final.unlink(missing_ok=True)
            raise
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def route(self):
        self.guard()
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        method = self.command
        store = self.server.store
        if path == "/api/lectures":
            if method == "GET":
                return self.json_out(store.list())
            if method == "POST":
                return self.json_out(store.create(self.read_json()), 201)
        if path == "/api/sample" and method == "POST":
            self.read_json()
            return self.json_out(store.sample(), 201)
        match = re.fullmatch(r"/api/lectures/([a-f0-9]{32})(?:/(.*))?", path)
        if match:
            identifier, rest = match.groups()
            if not rest:
                if method == "GET":
                    return self.json_out(store.get(identifier))
                if method == "PATCH":
                    return self.json_out(store.patch(identifier, self.read_json()))
                if method == "DELETE":
                    store.delete(identifier)
                    return self.json_out({"deleted": True})
            if rest == "files" and method == "PUT":
                return self.upload(identifier, query)
            if rest == "export" and method == "GET":
                # Disk-backed temporary archive keeps long recordings out of RAM.
                with tempfile.TemporaryDirectory(
                    dir=store.directory, prefix=".export-"
                ) as directory:
                    target = Path(directory) / "lecture.zip"
                    store.export(identifier, target)
                    return self.send_file(
                        target,
                        "application/zip",
                        {
                            "Content-Disposition": 'attachment; filename="beliz-lecture.zip"'
                        },
                    )
            if rest in ("notes", "markers", "questions") and method == "POST":
                return self.json_out(store.add(identifier, rest, self.read_json()), 201)
            item = re.fullmatch(
                r"(notes|markers|questions)/([a-f0-9]{32})(/review)?", rest or ""
            )
            if item:
                collection, item_id, review = item.groups()
                if method == "DELETE" and not review:
                    return self.json_out(
                        store.remove_item(identifier, collection, item_id)
                    )
                if collection == "notes" and method == "PATCH" and not review:
                    return self.json_out(
                        store.edit_note(identifier, item_id, self.read_json())
                    )
                if collection == "questions" and (
                    (method == "PATCH" and not review) or (method == "POST" and review)
                ):
                    return self.json_out(
                        store.question(
                            identifier, item_id, self.read_json(), bool(review)
                        )
                    )
        attachment = re.fullmatch(r"/api/files/([a-f0-9]{32})", path)
        if attachment and method in ("GET", "HEAD"):
            info, file_path = store.file(attachment[1])
            disposition = "attachment" if "download" in query else "inline"
            return self.send_file(
                file_path,
                info["mime"],
                {
                    "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(info['name'])}"
                },
                ranges=True,
            )
        if path.startswith("/api/"):
            raise RequestError(404, "This endpoint does not exist.")
        if method not in ("GET", "HEAD"):
            raise RequestError(405, "Method not allowed.")
        if path in ("/", "/index.html"):
            return self.send_file(
                ROOT / "static/index.html", "text/html; charset=utf-8"
            )
        # Explicit allowlists, never serve the repository or data directory.
        if path in ("/app.js", "/styles.css"):
            return self.send_file(ROOT / "static" / path[1:])
        if path == "/assets/hub.css" or re.fullmatch(
            r"/assets/fonts/(fraunces-(400|600)|plex-(400|500|600))\.ttf", path
        ):
            return self.send_file(REPO / path[1:])
        if path.startswith("/pcr-explained/"):
            base = (REPO / "pcr-explained/dist").resolve()
            relative = path.removeprefix("/pcr-explained/") or "index.html"
            file_path = (base / relative).resolve()
            if base not in file_path.parents:
                raise RequestError(403, "Access denied.")
            if not file_path.is_file() and relative == "index.html":
                return self.send_file(
                    ROOT / "static/build-lab.html", "text/html; charset=utf-8"
                )
            # The existing visual lab uses inline style attributes for interactive diagrams.
            return self.send_file(file_path)
        raise KeyError("Page not found.")

    def handle_request(self):
        try:
            self.route()
        except RequestError as error:
            self.json_out({"error": error.message}, error.status)
        except KeyError as error:
            self.json_out({"error": error.args[0]}, 404)
        except (ValueError, TypeError) as error:
            self.json_out({"error": str(error) or "Invalid request."}, 400)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self.json_out(
                {
                    "error": "Could not finish saving or reading local data. Check disk space and folder permissions, then retry."
                },
                500,
            )

    do_GET = do_HEAD = do_POST = do_PATCH = do_PUT = do_DELETE = do_OPTIONS = (
        handle_request
    )


def main():
    parser = argparse.ArgumentParser(
        description="Beliz Lecture Desk: private, local study workspace"
    )
    parser.add_argument("--port", type=int, default=4317)
    parser.add_argument(
        "--data-dir",
        default=os.environ.get(
            "BELIZ_DATA_DIR", str(Path.home() / ".local/share/beliz-hub")
        ),
    )
    args = parser.parse_args()
    os.umask(0o077)
    directory = Path(args.data_dir).expanduser().resolve()
    if directory == REPO or REPO in directory.parents:
        parser.error(
            "Keep private study data outside this repository. Choose another --data-dir."
        )
    store = Store(directory)
    server = Server(args.port, store)
    print(f"Beliz Lecture Desk → http://127.0.0.1:{server.server_port}", flush=True)
    print(
        f"Private data: {store.directory}\nNo cloud processing. Press Ctrl+C to stop.",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
