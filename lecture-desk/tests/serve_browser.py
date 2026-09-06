"""Disposable local and assembled Pages servers for browser tests; never uses real study data."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import REPO, Server
from store import Store


class QuietStatic(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


with tempfile.TemporaryDirectory(prefix="beliz-browser-") as directory:
    root = Path(directory)
    site = root / "public" / "BelizHub"
    site.mkdir(parents=True)
    shutil.copy(REPO / "index.html", site / "index.html")
    shutil.copytree(REPO / "assets", site / "assets")
    if (REPO / "pcr-explained/dist").exists():
        shutil.copytree(REPO / "pcr-explained/dist", site / "pcr-explained")
    desk = Server(4318, Store(root / "private"))
    public = ThreadingHTTPServer(
        ("127.0.0.1", 4319), partial(QuietStatic, directory=str(root / "public"))
    )
    threading.Thread(target=public.serve_forever, daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        desk.serve_forever()
    finally:
        desk.server_close()
        public.shutdown()
        public.server_close()
