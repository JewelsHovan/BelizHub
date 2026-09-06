import csv
import http.client
import io
import json
import socket
import subprocess
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transcripts import parse_transcript
from store import Store, SAMPLE
from server import Server


class TranscriptTests(unittest.TestCase):
    def test_plain_text_has_stable_paragraph_sources_without_invented_times(self):
        segments, warnings = parse_transcript(
            "BRCA1 is not BRCA2.\n\n0.05 mM, only under these conditions.", "notes.txt"
        )
        self.assertEqual([p["id"] for p in segments], ["p1", "p2"])
        self.assertTrue(all(p["start"] is None for p in segments))
        self.assertIn("0.05 mM", segments[1]["text"])
        self.assertIn("not audio timestamps", warnings[0])

    def test_vtt_and_srt_preserve_real_offsets_and_wording(self):
        segments, _ = parse_transcript(SAMPLE, "notes.vtt")
        self.assertEqual(len(segments), 6)
        self.assertEqual(segments[-1]["end"], 130)
        segments, _ = parse_transcript(
            "\ufeff1\r\n01:02:03,250 --> 01:02:06,500\r\nDo not replace 2.5 µM.\r\n",
            "notes.SRT",
        )
        self.assertEqual(segments[0]["start"], 3723.25)
        self.assertEqual(segments[0]["text"], "Do not replace 2.5 µM.")

    def test_vtt_comments_identifiers_settings_and_metadata(self):
        segments, _ = parse_transcript(
            "WEBVTT\nKind: captions\nLanguage: en\n\nNOTE explanation\nskip me\n\nslide-1\n00:00.500 --> 00:10.000 align:start\nHello.\n\nSTYLE\n::cue { color: blue; }",
            "a.vtt",
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["start"], 0.5)

    def test_malformed_cue_aborts_instead_of_silently_truncating(self):
        with self.assertRaisesRegex(ValueError, "no partial import"):
            parse_transcript(
                "1\n00:00:01,000 --> 00:00:02,000\nGood.\n\n2\n00:00:bad --> 00:00:04,000\nLost ending.",
                "a.srt",
            )

    def test_gap_and_start_warnings_do_not_claim_complete_coverage(self):
        _, warnings = parse_transcript(
            "1\n00:01:00,000 --> 00:01:10,000\nA\n\n2\n00:02:00,000 --> 00:02:10,000\nB",
            "a.srt",
        )
        self.assertTrue(any("Gap" in w for w in warnings))
        self.assertTrue(any("first cue" in w for w in warnings))
        self.assertIn("Coverage is not verified", warnings[-1])

    def test_three_hour_transcript_preserves_beginning_middle_and_end(self):
        def stamp(seconds):
            return f"{seconds // 3600:02}:{seconds // 60 % 60:02}:{seconds % 60:02},000"

        raw = "\n\n".join(
            f"{i + 1}\n{stamp(i * 6)} --> {stamp((i + 1) * 6)}\nScientific passage {i + 1}: not 0.5 mM."
            for i in range(1800)
        )
        segments, _ = parse_transcript(raw, "three-hours.srt")
        self.assertEqual(len(segments), 1800)
        self.assertIn("passage 1:", segments[0]["text"])
        self.assertIn("passage 901:", segments[900]["text"])
        self.assertEqual(segments[-1]["end"], 10800)

    def test_invalid_inputs(self):
        for raw, filename in [
            ("", "a.txt"),
            ("hello", "a.pdf"),
            ("\x00hello", "a.txt"),
            ("hello\ufffd", "a.txt"),
            ("WEBVTT", "a.vtt"),
            ("1\n00:61:00,000 --> 00:62:00,000\nA", "a.srt"),
            ("1\n00:00:05,000 --> 00:00:01,000\nA", "a.srt"),
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_transcript(raw, filename)

    def test_out_of_order_cues_rejected_but_overlapping_captions_allowed(self):
        with self.assertRaisesRegex(ValueError, "out of time order"):
            parse_transcript(
                "1\n00:00:05,000 --> 00:00:09,000\nA\n\n2\n00:00:04,000 --> 00:00:08,000\nB",
                "a.srt",
            )
        segments, _ = parse_transcript(
            "1\n00:00:05,000 --> 00:00:09,000\nA\n\n2\n00:00:06,000 --> 00:00:08,000\nB",
            "a.srt",
        )
        self.assertEqual(len(segments), 2)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.data = {
            "title": "Controls",
            "course": "Biotech",
            "date": "2026-09-05",
            "filename": "notes.txt",
            "transcript": "One original passage.\n\nAnother source.",
        }
        self.doc = self.store.create(self.data)
        self.id = self.doc["id"]

    def tearDown(self):
        self.temp.cleanup()

    def test_persistence_and_original_transcript_unchanged(self):
        self.store.patch(
            self.id,
            {"brief": "My summary", "position": {"segment_id": "p2", "seconds": 42.5}},
        )
        self.store.add(
            self.id,
            "notes",
            {
                "source_id": "p2",
                "text": "Maybe this term is wrong.",
                "kind": "Needs checking",
            },
        )
        recovered = Store(self.temp.name).get(self.id)
        self.assertEqual(recovered["transcript"], self.data["transcript"])
        self.assertEqual(recovered["brief"], "My summary")
        self.assertEqual(recovered["position"]["seconds"], 42.5)
        self.assertEqual(recovered["notes"][0]["kind"], "Needs checking")

    def test_all_source_links_require_a_real_passage(self):
        for collection in ("notes", "markers", "questions"):
            with (
                self.subTest(collection=collection),
                self.assertRaisesRegex(ValueError, "existing source"),
            ):
                self.store.add(
                    self.id, collection, {"source_id": "p999", "text": "test"}
                )
        self.assertEqual(self.store.get(self.id)["notes"], [])

    def test_validates_dates_positions_and_payload_types(self):
        with self.assertRaises(ValueError):
            self.store.create({**self.data, "date": "2026-02-31"})
        for seconds in (float("nan"), float("inf"), -1, True, "3"):
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                self.store.patch(
                    self.id, {"position": {"segment_id": "p1", "seconds": seconds}}
                )
        with self.assertRaises(ValueError):
            self.store.patch(self.id, {"transcript": "Do not overwrite the original"})

    def test_edit_note_keeps_identity_and_original(self):
        doc = self.store.add(
            self.id, "notes", {"source_id": "p1", "text": "First thought"}
        )
        note = doc["notes"][0]
        doc = self.store.edit_note(
            self.id,
            note["id"],
            {"source_id": "p2", "text": "Revised thought", "kind": "My explanation"},
        )
        self.assertEqual(doc["notes"][0]["id"], note["id"])
        self.assertEqual(doc["notes"][0]["source_id"], "p2")
        self.assertEqual(doc["transcript"], self.data["transcript"])

    def test_markers_are_deduplicated_and_removable(self):
        for _ in range(2):
            doc = self.store.add(
                self.id, "markers", {"source_id": "p1", "label": "Lost here"}
            )
        self.assertEqual(len(doc["markers"]), 1)
        doc = self.store.remove_item(self.id, "markers", doc["markers"][0]["id"])
        self.assertEqual(doc["markers"], [])

    def test_unchecked_question_cannot_be_scheduled(self):
        doc = self.store.add(
            self.id,
            "questions",
            {"source_id": "p1", "prompt": "Why?", "answer": "Because."},
        )
        q = doc["questions"][0]
        self.assertFalse(q["checked"])
        with self.assertRaisesRegex(ValueError, "Check the answer"):
            self.store.question(self.id, q["id"], {"rating": "got-it"}, review=True)
        self.store.question(self.id, q["id"], {"checked": True})
        doc = self.store.question(
            self.id,
            q["id"],
            {"rating": "got-it", "attempt": "My own attempt"},
            review=True,
        )
        self.assertTrue(doc["questions"][0]["due"])
        self.assertEqual(doc["questions"][0]["history"][0]["attempt"], "My own attempt")
        self.assertEqual(self.store.list()[0]["due"], 0)
        self.store.question(self.id, q["id"], {"checked": False})
        self.assertFalse(self.store.get(self.id)["questions"][0]["checked"])

    def test_concurrent_changes_do_not_overwrite_other_collections(self):
        errors = []

        def add(i):
            try:
                self.store.add(
                    self.id, "notes", {"source_id": "p1", "text": f"Note {i}"}
                )
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=add, args=(i,)) for i in range(12)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertFalse(errors)
        self.assertEqual(len(self.store.get(self.id)["notes"]), 12)

    def test_export_is_portable_and_csv_cells_are_not_formulas(self):
        self.store.add(
            self.id,
            "questions",
            {
                "source_id": "p1",
                "prompt": '=HYPERLINK("bad")',
                "answer": "A, with commas",
            },
        )
        self.store.add(self.id, "notes", {"source_id": "p2", "text": "An explanation"})
        file_id = "a" * 32
        (self.store.media / file_id).write_bytes(b"RIFF test recording")
        self.store.attach(self.id, file_id, "audio", "original.wav", "audio/wav", 19)
        out = io.BytesIO()
        self.store.export(self.id, out)
        with zipfile.ZipFile(out) as archive:
            self.assertEqual(
                archive.read("transcript.txt").decode(), self.data["transcript"]
            )
            self.assertIn("paragraph 2", archive.read("notes.md").decode())
            self.assertIn("attachments/audio.wav", archive.namelist())
            rows = list(csv.reader(io.StringIO(archive.read("questions.csv").decode())))
            self.assertTrue(rows[1][0].startswith("'="))
            self.assertEqual(rows[1][1], "A, with commas")
            self.assertEqual(json.loads(archive.read("lecture.json"))["id"], self.id)

    def test_delete_removes_attachments_and_database_rows(self):
        file_id = "b" * 32
        (self.store.media / file_id).write_bytes(b"test")
        self.store.attach(self.id, file_id, "audio", "a.mp3", "audio/mpeg", 4)
        self.store.delete(self.id)
        self.assertFalse((self.store.media / file_id).exists())
        with self.assertRaises(KeyError):
            self.store.get(self.id)
        with self.assertRaises(KeyError):
            self.store.file(file_id)

    def test_sample_is_explicit_and_has_three_source_checked_questions(self):
        doc = self.store.sample()
        self.assertTrue(doc["sample"])
        self.assertIn("not a recording", doc["brief"])
        self.assertEqual(len(doc["questions"]), 3)
        sources = {p["id"] for p in doc["segments"]}
        self.assertTrue(all(q["source_id"] in sources for q in doc["questions"]))


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.store = Store(cls.temp.name)
        cls.server = Server(0, cls.store)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, method="GET", data=None, body=None, headers=None):
        h = {"X-Beliz-Request": "local"}
        if data is not None:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body, headers=h)
        response = conn.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        conn.close()
        return result

    def sample(self):
        status, _, body = self.request("/api/sample", "POST", data={})
        self.assertEqual(status, 201)
        return json.loads(body)

    def test_loopback_binding_and_security_headers(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        status, headers, _ = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_rebinding_cross_origin_and_form_posts_blocked(self):
        for headers in (
            {"Host": "attacker.test"},
            {"Origin": "https://attacker.test"},
            {"X-Beliz-Request": ""},
            {"Origin": "null"},
        ):
            with self.subTest(headers=headers):
                status, _, _ = self.request(
                    "/api/sample", "POST", data={}, headers=headers
                )
                self.assertEqual(status, 403)
        status, _, _ = self.request(
            "/api/lectures",
            headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors"},
        )
        self.assertEqual(status, 403)

    def test_unknown_paths_cannot_read_private_files_or_repository(self):
        for path in (
            "/server.py",
            "/store.py",
            "/.git/config",
            "/../lecture-desk/server.py",
            "/assets/../lecture-desk/store.py",
            "/pcr-explained/../../lecture-desk/store.py",
            "/lectures.sqlite3",
        ):
            with self.subTest(path=path):
                self.assertIn(self.request(path)[0], (403, 404))

    def test_upload_seek_replace_export_and_delete(self):
        doc = self.sample()
        base = f"/api/lectures/{doc['id']}"
        body = b"RIFF" + bytes(range(100))
        status, _, raw = self.request(
            base + "/files?kind=audio&name=lecture.wav", "PUT", body=body
        )
        self.assertEqual(status, 200)
        file_id = json.loads(raw)["files"][0]["id"]
        status, headers, part = self.request(
            "/api/files/" + file_id, headers={"Range": "bytes=4-9"}
        )
        self.assertEqual((status, part), (206, bytes(range(6))))
        self.assertEqual(headers["Content-Range"], f"bytes 4-9/{len(body)}")
        status, _, part = self.request(
            "/api/files/" + file_id, headers={"Range": "bytes=-3"}
        )
        self.assertEqual((status, part), (206, body[-3:]))
        self.assertEqual(
            self.request("/api/files/" + file_id, headers={"Range": "bytes=500-"})[0],
            416,
        )
        self.assertEqual(self.request("/api/files/" + file_id, "HEAD")[2], b"")
        status, _, archive = self.request(base + "/export")
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            self.assertEqual(z.read("attachments/audio.wav"), body)
        self.request(base + "/files?kind=audio&name=new.wav", "PUT", body=b"new")
        self.assertEqual(self.request("/api/files/" + file_id)[0], 404)
        self.assertFalse((self.store.media / file_id).exists())
        self.assertEqual(self.request(base, "DELETE")[0], 200)
        self.assertEqual(self.request(base)[0], 404)

    def test_invalid_attachment_preserves_the_lecture_for_retry(self):
        doc = self.sample()
        base = f"/api/lectures/{doc['id']}"
        for query, body in [
            ("kind=slides&name=a.pdf", b"not a PDF"),
            ("kind=audio&name=../../escape.mp3", b"evil"),
            ("kind=audio&name=a.html", b"<script>"),
        ]:
            self.assertEqual(
                self.request(base + "/files?" + query, "PUT", body=body)[0], 400
            )
        recovered = json.loads(self.request(base)[2])
        self.assertEqual(recovered["files"], [])
        self.assertEqual(len(recovered["segments"]), 6)
        self.assertFalse(list(self.store.media.glob(".upload-*")))
        self.assertEqual(
            self.request(
                base + "/files?kind=slides&name=slides.pdf",
                "PUT",
                body=b"%PDF-1.4\nexample",
            )[0],
            200,
        )

    def test_malformed_import_leaves_no_partial_lecture(self):
        before = len(self.store.list())
        status, _, _ = self.request(
            "/api/lectures",
            "POST",
            data={
                "title": "Bad",
                "course": "Bad",
                "date": "2026-09-05",
                "filename": "bad.srt",
                "transcript": "not a cue",
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(len(self.store.list()), before)

    def test_interrupted_attachment_upload_is_cleaned_up_and_retryable(self):
        doc = self.sample()
        path = f"/api/lectures/{doc['id']}/files?kind=audio&name=interrupted.wav"
        con = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        con.request(
            "PUT",
            path,
            body=b"four",
            headers={"X-Beliz-Request": "local", "Content-Length": "100"},
        )
        con.sock.shutdown(socket.SHUT_WR)
        response = con.getresponse()
        self.assertEqual(response.status, 400)
        self.assertIn("interrupted", response.read().decode())
        con.close()
        self.assertEqual(self.store.get(doc["id"])["files"], [])
        self.assertFalse(list(self.store.media.glob(".upload-*")))
        self.assertEqual(self.request(path, "PUT", body=b"new recording")[0], 200)

    def test_cli_refuses_repository_storage_before_creating_any_files(self):
        repo = Path(__file__).resolve().parents[2]
        target = repo / ".prohibited-test-data"
        self.assertFalse(target.exists())
        result = subprocess.run(
            [
                sys.executable,
                str(repo / "lecture-desk/server.py"),
                "--data-dir",
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("outside this repository", result.stderr)
        self.assertFalse(target.exists())

    def test_upload_size_limit_and_json_types(self):
        self.assertEqual(
            self.request(
                "/api/lectures",
                "POST",
                body=b"[]",
                headers={"Content-Type": "application/json"},
            )[0],
            400,
        )
        self.assertEqual(
            self.request(
                "/api/lectures",
                "POST",
                body=b"",
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(10 * 1024 * 1024),
                },
            )[0],
            413,
        )
        self.assertEqual(
            self.request(
                "/api/lectures",
                "POST",
                body=b"{}",
                headers={"Content-Type": "text/plain"},
            )[0],
            415,
        )


if __name__ == "__main__":
    unittest.main()
