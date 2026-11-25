"""Feedback attachments (SCRUM-219): content sniffing, safe names and the size caps.

Files are identified by their bytes, never by the name the browser sent: a PNG renamed `.txt` is
still a PNG, and an SVG or HTML document named `.png` is refused. Plain text is the one type with
no signature, so there the extension has to be one of the text ones *and* the bytes have to decode
as UTF-8 without control characters or markup.
"""

import re
from dataclasses import dataclass

from starlette.datastructures import UploadFile

from backend.app import config

MAX_NAME = 100
TEXT_EXTENSIONS = frozenset({".txt", ".log", ".csv", ".json"})

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_UNSAFE = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')
_MARKUP = re.compile(r"^\s*(?:<!--|<\?xml|<!doctype|<html|<svg|<script)", re.IGNORECASE)


class AttachmentError(Exception):
    """A file violated a cap or the type allow-list; `status_code` is the HTTP answer."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Attachment:
    """One validated file, ready to be posted to Jira."""

    name: str
    content: bytes
    content_type: str


def extension_of(name: str) -> str:
    """Lower-case extension of the file's base name, or "" when it has none."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    stem, dot, ext = base.rpartition(".")
    return f".{ext.lower()}" if dot and stem else ""


def detect_type(data: bytes) -> tuple[str, str] | None:
    """The canonical `(extension, MIME type)` for a known signature, or None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif", "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    if data.startswith(b"%PDF-"):
        return ".pdf", "application/pdf"
    return None


def is_plain_text(data: bytes) -> bool:
    """UTF-8 text with no NUL or control characters, and not an HTML/SVG/XML document."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if "\x00" in text:
        return False
    if any(character < " " and character not in "\n\r\t" for character in text):
        return False
    return not _MARKUP.match(text[:512])


def sanitize_name(name: str, extension: str) -> str:
    """Base name only, no control or path characters, the detected extension, at most 100 chars."""
    base = _UNSAFE.sub("", name.replace("\\", "/").rsplit("/", 1)[-1]).strip().strip(".")
    known = extension_of(base)
    if known:
        base = base[: len(base) - len(known)]
    stem = base.strip(" .") or "attachment"
    return f"{stem[: MAX_NAME - len(extension)]}{extension}"


async def load_attachment(upload: UploadFile, remaining_bytes: int) -> Attachment:
    """Validate one uploaded file against the caps and the type allow-list."""
    content = await upload.read()
    if not content:
        raise AttachmentError(415, "feedback_attachment_type", "Empty files cannot be attached")
    if len(content) > config.FEEDBACK_MAX_FILE_BYTES:
        raise AttachmentError(413, "feedback_attachment_too_large", "Each file must be 4 MiB or smaller")
    if len(content) > remaining_bytes:
        raise AttachmentError(413, "feedback_attachments_too_large", "Files must total 12 MiB or less")
    detected = detect_type(content)
    if detected is not None:
        extension, content_type = detected
    else:
        extension = extension_of(upload.filename or "")
        if extension not in TEXT_EXTENSIONS or not is_plain_text(content):
            raise AttachmentError(
                415,
                "feedback_attachment_type",
                "Attach an image (PNG, JPEG, GIF, WebP), a PDF or a plain-text file",
            )
        content_type = "text/plain"
    return Attachment(sanitize_name(upload.filename or "", extension), content, content_type)
