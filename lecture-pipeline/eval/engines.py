"""Independent ASR engines, so accuracy can be cross-checked rather than assumed.

Used for BENCHMARKING ONLY. The shipped pipeline stays fully local; nothing here
is imported by pipeline/. API engines upload audio to third parties.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from lexicon import INITIAL_PROMPT


def local_turbo(path):
    import mlx_whisper
    import transcribe as T
    r = mlx_whisper.transcribe(str(path), path_or_hf_repo=T.MODEL, **T.DECODE)
    return r["text"].strip()


def openai_whisper1(path):
    from openai import OpenAI
    client = OpenAI()
    with open(path, "rb") as fh:
        r = client.audio.transcriptions.create(
            model="whisper-1", file=fh, language="en", prompt=INITIAL_PROMPT,
        )
    return r.text.strip()


def openai_gpt4o(path):
    from openai import OpenAI
    client = OpenAI()
    with open(path, "rb") as fh:
        r = client.audio.transcriptions.create(
            model="gpt-4o-transcribe", file=fh, language="en", prompt=INITIAL_PROMPT,
        )
    return r.text.strip()


def openai_gpt4o_mini(path):
    from openai import OpenAI
    client = OpenAI()
    with open(path, "rb") as fh:
        r = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe", file=fh, language="en", prompt=INITIAL_PROMPT,
        )
    return r.text.strip()


def gemini_pro(path, model="gemini-2.5-pro"):
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    data = Path(path).read_bytes()
    prompt = (
        "Transcribe this university biotechnology lecture verbatim in English. "
        "Output ONLY the transcript text, no timestamps, headings, speaker labels "
        "or commentary. Do not summarise, correct grammar, or omit filler. "
        "Spell technical vocabulary correctly. Context: " + INITIAL_PROMPT
    )
    r = client.models.generate_content(
        model=model,
        contents=[prompt, types.Part.from_bytes(data=data, mime_type="audio/wav")],
        config=types.GenerateContentConfig(temperature=0.0),
    )
    return _extract(r)


def _extract(response):
    """Pull text from either plain text parts or audio_transcription parts.

    The dedicated transcription models return the transcript in an
    `audio_transcription` part, so `.text` is empty and a naive read looks like
    a total failure rather than a different response shape.
    """
    chunks = []
    for cand in (response.candidates or []):
        for part in (getattr(cand.content, "parts", None) or []):
            if getattr(part, "text", None):
                chunks.append(part.text)
            tr = getattr(part, "audio_transcription", None)
            if tr is not None:
                chunks.append(getattr(tr, "text", None) or str(tr))
    if chunks:
        return "\n".join(c.strip() for c in chunks if c).strip()
    return (getattr(response, "text", None) or "").strip()


ENGINES = {
    "local_turbo_tuned": local_turbo,
    "openai_whisper1": openai_whisper1,
    "openai_gpt4o": openai_gpt4o,
    "openai_gpt4o_mini": openai_gpt4o_mini,
    "gemini_2.5_pro": gemini_pro,
}


# --- Current-generation engines (discovered from the live model list) ---

def openai_gpt_transcribe(path):
    from openai import OpenAI
    with open(path, "rb") as fh:
        r = OpenAI().audio.transcriptions.create(
            model="gpt-transcribe", file=fh, language="en", prompt=INITIAL_PROMPT)
    return r.text.strip()


def openai_mini_dec25(path):
    from openai import OpenAI
    with open(path, "rb") as fh:
        r = OpenAI().audio.transcriptions.create(
            model="gpt-4o-mini-transcribe-2025-12-15", file=fh,
            language="en", prompt=INITIAL_PROMPT)
    return r.text.strip()


def openai_diarize(path):
    from openai import OpenAI
    with open(path, "rb") as fh:
        r = OpenAI().audio.transcriptions.create(
            model="gpt-4o-transcribe-diarize", file=fh, language="en",
            chunking_strategy="auto")
    return (r.text or "").strip()


def gemini_transcribe(path):
    return gemini_pro(path, model="gemini-3.5-transcribe")


def gemini_38_flash(path):
    return gemini_pro(path, model="gemini-3.8-flash")


def gemini_31_pro(path):
    return gemini_pro(path, model="gemini-3.1-pro-preview")


ENGINES.update({
    "gpt-transcribe": openai_gpt_transcribe,
    "gpt4o-mini-tr-dec25": openai_mini_dec25,
    "gpt4o-tr-diarize": openai_diarize,
    "gemini-3.5-transcribe": gemini_transcribe,
    "gemini-3.8-flash": gemini_38_flash,
    "gemini-3.1-pro": gemini_31_pro,
})
