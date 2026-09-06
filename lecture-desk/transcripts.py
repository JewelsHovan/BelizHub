"""Lossless originals live in storage; this module creates stable source passages."""

import re
from pathlib import Path

TIMING = re.compile(
    r"^((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$"
)


def seconds(value):
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        parts.insert(0, "0")
    hours, minutes, secs = int(parts[0]), int(parts[1]), float(parts[2])
    if minutes >= 60 or secs >= 60:
        raise ValueError("A transcript timestamp has invalid minutes or seconds.")
    return hours * 3600 + minutes * 60 + secs


def parse_transcript(raw, filename):
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Add a transcript with at least one passage.")
    if len(raw.encode("utf-8")) > 5 * 1024 * 1024:
        raise ValueError("Transcripts must be smaller than 5 MB.")
    if "\x00" in raw or "\ufffd" in raw:
        raise ValueError(
            "This transcript is not readable UTF-8 text. Export it as UTF-8 and try again."
        )
    extension = Path(filename).suffix.lower()
    if extension not in (".txt", ".srt", ".vtt"):
        raise ValueError("Choose a .txt, .srt, or .vtt transcript.")
    text = raw.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip()
    passages, warnings = [], []
    if extension == ".txt":
        for block in re.split(r"\n\s*\n", text):
            passages.append(
                {
                    "id": f"p{len(passages) + 1}",
                    "start": None,
                    "end": None,
                    "text": block.strip(),
                }
            )
        warnings.append(
            "Plain text: source links use paragraphs, not audio timestamps."
        )
    else:
        if extension == ".vtt":
            if not re.match(r"^WEBVTT(?:\s|$)", text):
                raise ValueError("A VTT transcript must start with WEBVTT.")
            text = re.sub(
                r"^WEBVTT[^\n]*(?:\n[^\n]+)*?(?=\n\s*\n|$)", "", text, count=1
            ).strip()
        for index, block in enumerate(re.split(r"\n\s*\n", text), 1):
            if not block.strip():
                continue
            if extension == ".vtt" and re.match(
                r"^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))", block
            ):
                continue
            lines = block.splitlines()
            timing_index = 0 if "-->" in lines[0] else 1
            match = (
                TIMING.match(lines[timing_index]) if len(lines) > timing_index else None
            )
            if not match:
                raise ValueError(
                    f"Cannot read timing in cue {index}. Fix the cue or import a plain-text version; no partial import was saved."
                )
            start, end = seconds(match[1]), seconds(match[2])
            content = "\n".join(lines[timing_index + 1 :]).strip()
            if end <= start or not content:
                raise ValueError(
                    f"Cue {index} needs text and an end time after its start. No partial import was saved."
                )
            if passages and start < passages[-1]["start"]:
                raise ValueError(
                    f"Cue {index} is out of time order. Sort the transcript and try again."
                )
            if passages and start > passages[-1]["end"] + 30:
                warnings.append(
                    f"Gap before cue {len(passages) + 1}: {round(start - passages[-1]['end'])} seconds. Check the recording; it may be intentional."
                )
            passages.append(
                {
                    "id": f"p{len(passages) + 1}",
                    "start": start,
                    "end": end,
                    "text": content,
                }
            )
        if not passages:
            raise ValueError("No readable transcript cues were found.")
        if passages[0]["start"] > 30:
            warnings.append(
                "The first cue starts more than 30 seconds in. Check the beginning of the recording."
            )
    if len(passages) > 20000:
        raise ValueError(
            "This transcript has more than 20,000 passages. Split it into lecture sections."
        )
    warnings.append(
        "Coverage is not verified. Compare the beginning, middle, and end with the original; figures and scientific terms need checking."
    )
    return passages, warnings
