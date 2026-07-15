"""TeamBox: server locale con API e database SQLite, senza dipendenze esterne."""
import json
import sqlite3
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).parent
DB = ROOT / "teambox.db"

def connection():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db

def seed():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS channels (
          id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, author TEXT NOT NULL,
          initials TEXT NOT NULL, color TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(channel_id) REFERENCES channels(id)
        );
        """)
        if not db.execute("SELECT 1 FROM channels LIMIT 1").fetchone():
            now = datetime.now().isoformat()
            channels = [
              ("generale", "Comunicazioni e aggiornamenti per tutto il team", now),
              ("progetto", "Tutto quello che riguarda il progetto in corso", now),
              ("design", "Idee, feedback e risorse per il design", now),
            ]
            db.executemany("INSERT INTO channels (slug, description, created_at) VALUES (?, ?, ?)", channels)
            general = db.execute("SELECT id FROM channels WHERE slug='generale'").fetchone()[0]
            db.executemany("""INSERT INTO messages (channel_id, author, initials, color, body, created_at)
                VALUES (?, ?, ?, ?, ?, ?)""", [
              (general, "Anna Bianchi", "A", "coral", "Buongiorno a tutti! Ho appena condiviso l’agenda della settimana. Fatemi sapere se ci sono punti da aggiungere ✨", now),
              (general, "Luca Rinaldi", "L", "blue", "Perfetto, grazie Anna! Per oggi mi concentro sulla revisione delle nuove schermate.", now),
            ])

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def payload(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            return json.loads(self.rfile.read(length) or "{}")
        except json.JSONDecodeError:
            return {}

    def reply(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(encoded))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/channels":
            with connection() as db:
                rows = db.execute("SELECT slug, description FROM channels ORDER BY id").fetchall()
            return self.reply([dict(row) for row in rows])
        if path.startswith("/api/channels/") and path.endswith("/messages"):
            slug = path.split("/")[3]
            with connection() as db:
                channel = db.execute("SELECT id, slug, description FROM channels WHERE slug=?", (slug,)).fetchone()
                if not channel: return self.reply({"error": "Canale non trovato"}, 404)
                rows = db.execute("SELECT id, author, initials, color, body, created_at FROM messages WHERE channel_id=? ORDER BY id", (channel["id"],)).fetchall()
            return self.reply({"channel": dict(channel), "messages": [dict(row) for row in rows]})
        return super().do_GET()

    def do_POST(self):
        path, data = urlparse(self.path).path, self.payload()
        if path == "/api/channels":
            slug = data.get("slug", "").strip().lower()
            description = data.get("description", "").strip() or "Un nuovo spazio per il team"
            if not slug or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug):
                return self.reply({"error": "Nome canale non valido"}, 400)
            try:
                with connection() as db:
                    db.execute("INSERT INTO channels (slug, description, created_at) VALUES (?, ?, ?)", (slug, description, datetime.now().isoformat()))
                return self.reply({"slug": slug, "description": description}, 201)
            except sqlite3.IntegrityError:
                return self.reply({"error": "Questo canale esiste già"}, 409)
        if path.startswith("/api/channels/") and path.endswith("/messages"):
            slug = path.split("/")[3]
            body = data.get("body", "").strip()
            author = data.get("author", "Ospite").strip()[:40] or "Ospite"
            if not body: return self.reply({"error": "Messaggio vuoto"}, 400)
            with connection() as db:
                channel = db.execute("SELECT id FROM channels WHERE slug=?", (slug,)).fetchone()
                if not channel: return self.reply({"error": "Canale non trovato"}, 404)
                values = (channel[0], author, author[0].upper(), "violet", body[:4000], datetime.now().isoformat())
                cursor = db.execute("INSERT INTO messages (channel_id, author, initials, color, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", values)
            return self.reply({"id": cursor.lastrowid}, 201)
        return self.reply({"error": "Risorsa non trovata"}, 404)

if __name__ == "__main__":
    seed()
    print("TeamBox è pronto su http://localhost:8000")
    ThreadingHTTPServer(("", 8000), Handler).serve_forever()
