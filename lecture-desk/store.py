"""Small, transactional local store. No model calls or remote storage."""

import csv
import io
import json
import math
import sqlite3
import uuid
import zipfile
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from transcripts import parse_transcript


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


def text(value, label, limit=20000, required=True):
    if (
        not isinstance(value, str)
        or len(value) > limit
        or (required and not value.strip())
    ):
        raise ValueError(
            f"{label} must be {'non-empty ' if required else ''}text, up to {limit:,} characters."
        )
    return value.strip()


class Store:
    def __init__(self, directory):
        self.directory = Path(directory).expanduser().resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.media = self.directory / "media"
        self.media.mkdir(exist_ok=True, mode=0o700)
        self.db = self.directory / "lectures.sqlite3"
        with self.connect() as con:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS lectures (id TEXT PRIMARY KEY, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY, lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
                    UNIQUE(lecture_id, kind));
            """)
        self.db.chmod(0o600)

    @contextmanager
    def connect(self):
        con = sqlite3.connect(self.db, timeout=20)
        try:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("PRAGMA secure_delete=ON")
            with con:
                yield con
        finally:
            con.close()

    def _get(self, con, identifier):
        row = con.execute(
            "SELECT document FROM lectures WHERE id=?", (identifier,)
        ).fetchone()
        if not row:
            raise KeyError("Lecture not found.")
        doc = json.loads(row["document"])
        doc["files"] = [
            dict(row)
            for row in con.execute(
                "SELECT * FROM files WHERE lecture_id=?", (identifier,)
            )
        ]
        return doc

    def get(self, identifier):
        with self.connect() as con:
            return self._get(con, identifier)

    def list(self):
        with self.connect() as con:
            docs = [
                json.loads(row[0])
                for row in con.execute("SELECT document FROM lectures")
            ]
        fields = ("id", "title", "course", "date", "updated_at", "position", "sample")
        return sorted(
            [
                {
                    **{key: d[key] for key in fields},
                    "passages": len(d["segments"]),
                    "markers": len(d["markers"]),
                    "notes": len(d["notes"]),
                    "due": sum(
                        q["checked"] and (not q["due"] or q["due"] <= now())
                        for q in d["questions"]
                    ),
                }
                for d in docs
            ],
            key=lambda d: d["updated_at"],
            reverse=True,
        )

    def create(self, data):
        title = text(data.get("title"), "Title", 200)
        course = text(data.get("course"), "Course", 160)
        day = text(data.get("date"), "Date", 10)
        try:
            if date.fromisoformat(day).isoformat() != day:
                raise ValueError()
        except ValueError:
            raise ValueError("Use a valid lecture date (YYYY-MM-DD).")
        filename = text(data.get("filename"), "Transcript filename", 250)
        raw = data.get("transcript")
        segments, warnings = parse_transcript(raw, filename)
        identifier = uid()
        doc = dict(
            id=identifier,
            title=title,
            course=course,
            date=day,
            filename=Path(filename).name,
            transcript=raw,
            segments=segments,
            warnings=warnings,
            brief="",
            notes=[],
            markers=[],
            questions=[],
            sample=False,
            created_at=now(),
            updated_at=now(),
            position={"segment_id": segments[0]["id"], "seconds": 0},
        )
        with self.connect() as con:
            con.execute(
                "INSERT INTO lectures VALUES (?,?)", (identifier, json.dumps(doc))
            )
        return self.get(identifier)

    def mutate(self, identifier, operation):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            doc = self._get(con, identifier)
            operation(doc)
            doc.pop("files", None)
            doc["updated_at"] = now()
            con.execute(
                "UPDATE lectures SET document=? WHERE id=?",
                (json.dumps(doc), identifier),
            )
        return self.get(identifier)

    @staticmethod
    def source(doc, source_id):
        if source_id not in {s["id"] for s in doc["segments"]}:
            raise ValueError("Choose an existing source passage from this lecture.")
        return source_id

    def patch(self, identifier, data):
        def apply(doc):
            if set(data) - {"brief", "position"}:
                raise ValueError("Unsupported lecture field.")
            if "brief" in data:
                doc["brief"] = text(data["brief"], "Brief", required=False)
            if "position" in data:
                pos = data["position"]
                if not isinstance(pos, dict):
                    raise ValueError("Invalid playback position.")
                self.source(doc, pos.get("segment_id"))
                seconds = pos.get("seconds")
                if (
                    isinstance(seconds, bool)
                    or not isinstance(seconds, (int, float))
                    or not math.isfinite(seconds)
                    or not 0 <= seconds <= 604800
                ):
                    raise ValueError(
                        "Playback position must be a valid number of seconds."
                    )
                doc["position"] = {"segment_id": pos["segment_id"], "seconds": seconds}

        return self.mutate(identifier, apply)

    def add(self, identifier, collection, data):
        def apply(doc):
            source = self.source(doc, data.get("source_id"))
            item = {"id": uid(), "source_id": source}
            if collection == "notes":
                item.update(
                    text=text(data.get("text"), "Note"),
                    kind=data.get("kind", "My explanation"),
                )
                if item["kind"] not in (
                    "My explanation",
                    "Needs checking",
                    "Ask the instructor",
                ):
                    raise ValueError("Choose a supported note type.")
            elif collection == "markers":
                label = data.get("label")
                if label not in ("Lost here", "Important", "Ask about this"):
                    raise ValueError("Choose a supported marker.")
                if any(
                    m["source_id"] == source and m["label"] == label
                    for m in doc["markers"]
                ):
                    return
                item["label"] = label
            elif collection == "questions":
                item.update(
                    prompt=text(data.get("prompt"), "Question", 2000),
                    answer=text(data.get("answer"), "Answer", 5000),
                    hint=text(data.get("hint", ""), "Hint", 1000, False),
                    checked=False,
                    due=None,
                    history=[],
                )
            else:
                raise ValueError("Unsupported collection.")
            doc[collection].append(item)

        return self.mutate(identifier, apply)

    def edit_note(self, identifier, note_id, data):
        def apply(doc):
            item = next((n for n in doc["notes"] if n["id"] == note_id), None)
            if not item:
                raise KeyError("Note not found.")
            source = self.source(doc, data.get("source_id"))
            kind = data.get("kind")
            if kind not in ("My explanation", "Needs checking", "Ask the instructor"):
                raise ValueError("Choose a supported note type.")
            item.update(
                text=text(data.get("text"), "Note"), source_id=source, kind=kind
            )

        return self.mutate(identifier, apply)

    def remove_item(self, identifier, collection, item_id):
        def apply(doc):
            if collection not in ("notes", "markers", "questions"):
                raise ValueError("Unsupported collection.")
            if not any(i["id"] == item_id for i in doc[collection]):
                raise KeyError("Item not found.")
            doc[collection] = [i for i in doc[collection] if i["id"] != item_id]

        return self.mutate(identifier, apply)

    def question(self, identifier, question_id, data, review=False):
        def apply(doc):
            item = next((q for q in doc["questions"] if q["id"] == question_id), None)
            if not item:
                raise KeyError("Question not found.")
            if review:
                if not item["checked"]:
                    raise ValueError(
                        "Check the answer against its source before scheduling it."
                    )
                rating = data.get("rating")
                if rating not in ("again", "got-it"):
                    raise ValueError("Choose a recall rating.")
                attempt = text(data.get("attempt", ""), "Attempt", 10000, False)
                # A transparent starting schedule, not an adaptive or clinical claim.
                streak = 0
                for previous in reversed(item["history"]):
                    if previous["rating"] != "got-it":
                        break
                    streak += 1
                days = (1, 3, 7)[min(streak, 2)] if rating == "got-it" else 1
                item["due"] = (
                    datetime.now(timezone.utc) + timedelta(days=days)
                ).isoformat()
                item["history"].append(
                    {"at": now(), "rating": rating, "attempt": attempt}
                )
            else:
                if type(data.get("checked")) is not bool:
                    raise ValueError("Review state must be true or false.")
                item["checked"] = data["checked"]

        return self.mutate(identifier, apply)

    def attach(self, identifier, file_id, kind, name, mime, size):
        old = None
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            self._get(con, identifier)
            row = con.execute(
                "SELECT id FROM files WHERE lecture_id=? AND kind=?", (identifier, kind)
            ).fetchone()
            old = row["id"] if row else None
            con.execute(
                "DELETE FROM files WHERE lecture_id=? AND kind=?", (identifier, kind)
            )
            con.execute(
                "INSERT INTO files VALUES (?,?,?,?,?,?)",
                (file_id, identifier, kind, name, mime, size),
            )
        if old:
            (self.media / old).unlink(missing_ok=True)
        return self.get(identifier)

    def file(self, identifier):
        with self.connect() as con:
            row = con.execute(
                "SELECT * FROM files WHERE id=?", (identifier,)
            ).fetchone()
        if not row:
            raise KeyError("Attachment not found.")
        return dict(row), self.media / identifier

    def delete(self, identifier):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            doc = self._get(con, identifier)
            # Remove files before committing the row deletion. Report filesystem failures.
            for attachment in doc["files"]:
                (self.media / attachment["id"]).unlink(missing_ok=True)
            con.execute("DELETE FROM lectures WHERE id=?", (identifier,))

    def export(self, identifier, target):
        doc = self.get(identifier)
        sources = {s["id"]: s for s in doc["segments"]}

        def ref(source_id):
            s = sources[source_id]
            return (
                f"{source_id} ({s['start']}–{s['end']} seconds)"
                if s["start"] is not None
                else f"paragraph {source_id[1:]}"
            )

        notes = [
            f"# {doc['title']}",
            f"{doc['course']} · {doc['date']}",
            "\n## My brief",
            doc["brief"],
            "\n## My source-linked notes",
        ]
        for note in doc["notes"]:
            notes += [
                f"\n### {note['kind']} · {ref(note['source_id'])}",
                note["text"],
                f"> {sources[note['source_id']]['text']}",
            ]
        notes += ["\n## Import checks", *doc["warnings"]]
        cards = io.StringIO()
        writer = csv.writer(cards)
        writer.writerow(["Question", "Answer", "Source", "Hint", "Checked"])

        def safe_cell(value):
            value = str(value)
            return (
                "'" + value
                if value.lstrip().startswith(("=", "+", "-", "@"))
                else value
            )

        for q in doc["questions"]:
            writer.writerow(
                [
                    safe_cell(v)
                    for v in (
                        q["prompt"],
                        q["answer"],
                        f"{doc['title']} / {ref(q['source_id'])}",
                        q["hint"],
                        q["checked"],
                    )
                ]
            )
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "lecture.json", json.dumps(doc, ensure_ascii=False, indent=2)
            )
            archive.writestr("notes.md", "\n\n".join(notes))
            archive.writestr("questions.csv", cards.getvalue())
            archive.writestr(
                "transcript" + Path(doc["filename"]).suffix.lower(), doc["transcript"]
            )
            archive.writestr(
                "README.txt",
                "Personal study export. Contains original transcript, notes, sources, practice history and attached files. Keep private. This portable archive is not a one-click restore format; back up the app data folder to restore the full workspace.\n",
            )
            for f in doc["files"]:
                archive.write(
                    self.media / f["id"],
                    f"attachments/{f['kind']}{Path(f['name']).suffix.lower()}",
                )

    def sample(self):
        doc = self.create(
            {
                "title": "What makes a PCR result trustworthy?",
                "course": "Getting started · sample",
                "date": date.today().isoformat(),
                "filename": "sample.vtt",
                "transcript": SAMPLE,
            }
        )

        def populate(d):
            d["sample"] = True
            d["brief"] = (
                "A short, authored example—not a recording or McGill course material. Try selecting a passage, marking a question, and explaining why each control matters. Then test yourself with the three sample questions."
            )
            d["notes"] = [
                {
                    "id": uid(),
                    "source_id": "p2",
                    "kind": "My explanation",
                    "text": "A no-template control helps reveal contamination. An unexpected signal is a reason to investigate, not a result to ignore.",
                }
            ]
            d["questions"] = [
                dict(
                    id=uid(),
                    source_id=s,
                    prompt=p,
                    answer=a,
                    hint=h,
                    checked=True,
                    due=None,
                    history=[],
                )
                for s, p, a, h in [
                    (
                        "p2",
                        "What does a no-template control help detect?",
                        "Contamination contributing a signal when no template was intentionally added.",
                        "Think about what should be absent.",
                    ),
                    (
                        "p3",
                        "Why include a no-RT control when studying RNA?",
                        "It helps assess whether DNA, rather than reverse-transcribed RNA, contributes to the PCR signal.",
                        "Which preparation step is left out?",
                    ),
                    (
                        "p4",
                        "A sample has no signal. Why is that not enough to conclude the target is absent?",
                        "An assay or preparation failure can also produce no signal. Controls and the assay limitations are needed for interpretation.",
                        "Could the process itself have failed?",
                    ),
                ]
            ]

        return self.mutate(doc["id"], populate)


SAMPLE = """WEBVTT

00:00.000 --> 00:20.000
This is a short authored practice transcript, not a real lecture. The question is: what makes a PCR result trustworthy? Controls help distinguish a biological result from problems in the assay.

00:20.000 --> 00:42.000
A no-template control contains the reaction components but no intentionally added template. Unexpected amplification can indicate contamination; the signal needs investigation in the context of the assay.

00:42.000 --> 01:05.000
In an RNA study, a no-reverse-transcriptase control leaves out reverse transcriptase. It helps assess whether DNA contributes to the subsequent PCR signal rather than the signal coming only from reverse-transcribed RNA.

01:05.000 --> 01:30.000
A positive control helps establish that an assay can produce the expected signal under the conditions tested. No signal in a sample alone does not prove absence of a target; preparation failure and assay limitations also matter.

01:30.000 --> 01:55.000
Before interpreting a result, describe what each control tests and what it does not test. Distinguish the observed signal from your explanation of it. Use the approved course protocol for operational laboratory work.

01:55.000 --> 02:10.000
Try explaining the difference between a no-template control and a no-RT control without looking. Then open the original passage to check your reasoning. This sample has no accompanying recording or slides.
"""
