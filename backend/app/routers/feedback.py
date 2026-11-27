"""Feedback API router: file a Jira issue from the app's feedback form (SCRUM-179, SCRUM-219)."""

import logging
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from backend.app import config
from backend.app.net import client_ip
from backend.app.services import feedback_attachments, feedback_limiter, jira_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

MAX_SUBJECT = 50
MAX_COMMENTS = 1000
MAX_EMAIL = 254
MAX_USER_AGENT = 200
# Text parts of a multipart body are tiny; the files carry the weight and get their own caps.
MAX_FORM_FIELDS = 20
MAX_FORM_PART_BYTES = 1024 * 1024
MULTIPART = "multipart/form-data"
FEEDBACK_FIELDS = (
    "type",
    "subject",
    "comments",
    "contact_email",
    "app_version",
    "timezone",
    "user_agent",
    "map_zoom",
)

_TAGS = re.compile(r"<[^>]*>")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EMAIL = re.compile(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+")

limiter = feedback_limiter.FeedbackLimiter(config.FEEDBACK_MAX_PER_HOUR, config.FEEDBACK_GLOBAL_MAX_PER_HOUR)


def clean_text(value: object, single_line: bool = False) -> object:
    """Plain text only: HTML tags and control characters removed, then trimmed."""
    if not isinstance(value, str):
        return value
    text = _CONTROL.sub("", _TAGS.sub("", value.replace("\r\n", "\n").replace("\r", "\n")))
    if single_line:
        text = " ".join(text.split())
    return text.strip()


class FeedbackRequest(BaseModel):
    type: Literal["bug", "new feature", "comment"]
    subject: str = Field(..., min_length=1, max_length=MAX_SUBJECT)
    comments: str = Field(..., min_length=1, max_length=MAX_COMMENTS)
    contact_email: str | None = Field(None, max_length=MAX_EMAIL)
    # Informational breadcrumbs from the browser; never used for routing or access.
    app_version: str = Field("", max_length=50)
    timezone: str = Field("", max_length=64)
    user_agent: str = Field("", max_length=1000)
    # The map zoom the report was made at, when the browser knew one (SCRUM-320).
    map_zoom: int | None = Field(None, ge=0, le=30)

    @field_validator("subject", mode="before")
    @classmethod
    def _subject(cls, value: object) -> object:
        return clean_text(value, single_line=True)

    @field_validator("comments", mode="before")
    @classmethod
    def _comments(cls, value: object) -> object:
        return clean_text(value)

    @field_validator("contact_email", mode="before")
    @classmethod
    def _email(cls, value: object) -> object:
        cleaned = clean_text(value, single_line=True)
        return cleaned or None

    @field_validator("contact_email")
    @classmethod
    def _email_format(cls, value: str | None) -> str | None:
        if value is not None and not _EMAIL.fullmatch(value):
            raise ValueError("not a valid email address")
        return value

    @field_validator("app_version", "timezone", "user_agent", mode="before")
    @classmethod
    def _breadcrumb(cls, value: object) -> object:
        return clean_text(value, single_line=True)


class FeedbackResponse(BaseModel):
    issue_key: str
    issue_url: str
    # Only present when the issue was filed but its files could not be attached (SCRUM-219).
    attachments_failed: bool | None = None


def _client_ip(request: Request) -> str:
    """The address the limiter keys on, proxy-aware (SCRUM-270)."""
    return client_ip(request)


def _invalid(exc: ValidationError) -> JSONResponse:
    """Field names and messages only: the submitted text is never echoed or logged."""
    errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": errors})


async def _read_body(request: Request) -> bytes:
    """The JSON request body, rejected with 413 as soon as it passes the size cap."""
    limit = config.FEEDBACK_MAX_BODY_BYTES
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="Request body too large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="Request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def _capped_stream(request: Request):
    """The request body, refused with 413 as soon as it passes the multipart cap.

    The `Content-Length` check below already catches an honest client; this counter is the
    backstop for a chunked body, which declares no length at all.
    """
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > config.FEEDBACK_MAX_REQUEST_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail={"code": "feedback_request_too_large"})
        yield chunk


def _form_payload(form: FormData) -> dict[str, object]:
    return {name: form.get(name) for name in FEEDBACK_FIELDS if form.get(name) is not None}


async def _parse_multipart(request: Request) -> tuple[FeedbackRequest, list[feedback_attachments.Attachment]]:
    """Parse and validate the multipart body, closing every spooled file on the way out."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > config.FEEDBACK_MAX_REQUEST_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail={"code": "feedback_request_too_large"})
    try:
        form = await MultiPartParser(
            request.headers,
            _capped_stream(request),
            max_files=config.FEEDBACK_MAX_FILES + 1,
            max_fields=MAX_FORM_FIELDS,
            max_part_size=MAX_FORM_PART_BYTES,
        ).parse()
    except MultiPartException as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "feedback_invalid_multipart"}
        ) from exc
    try:
        uploads = form.getlist("files")
        if any(not isinstance(upload, UploadFile) for upload in uploads):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "feedback_invalid_multipart"})
        if len(uploads) > config.FEEDBACK_MAX_FILES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": "feedback_too_many_files"})
        data = FeedbackRequest.model_validate(_form_payload(form))
        attachments: list[feedback_attachments.Attachment] = []
        remaining = config.FEEDBACK_MAX_FILES_BYTES
        try:
            for upload in uploads:
                attachment = await feedback_attachments.load_attachment(upload, remaining)
                remaining -= len(attachment.content)
                attachments.append(attachment)
        except feedback_attachments.AttachmentError as exc:
            raise HTTPException(exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
        return data, attachments
    finally:
        for _, value in form.multi_items():
            if isinstance(value, UploadFile):
                await value.close()


async def _note_missing_attachments(
    issue_key: str, description: str, attachments: list[feedback_attachments.Attachment]
) -> None:
    """Say on the issue which files were lost, so a retry does not file a duplicate (SCRUM-219)."""
    names = ", ".join(attachment.name for attachment in attachments)
    count = len(attachments)
    note = (
        f"Attachments: {count} file{'s' if count != 1 else ''} were sent with this feedback "
        f"but could not be uploaded ({names})."
    )
    try:
        await jira_service.append_description_note(issue_key, description, note)
    except jira_service.JiraError as exc:
        logger.warning("Feedback attachment note could not be added: %s", type(exc).__name__)


@router.post(
    "",
    response_model=FeedbackResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
async def submit_feedback(request: Request):
    if not config.feedback_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "feedback_unavailable"})
    kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
    attachments: list[feedback_attachments.Attachment] = []
    try:
        if kind == MULTIPART:
            data, attachments = await _parse_multipart(request)
        elif kind in ("", "application/json"):
            # Kept for one release so a cached frontend still works (SCRUM-219).
            data = FeedbackRequest.model_validate_json(await _read_body(request))
        else:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail={"code": "feedback_unsupported_media_type"}
            )
    except ValidationError as exc:
        return _invalid(exc)
    retry_after = limiter.try_acquire(_client_ip(request))
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "feedback_rate_limited"},
            headers={"Retry-After": str(retry_after)},
        )
    description = jira_service.build_description(
        data.comments,
        data.type,
        data.contact_email,
        data.app_version,
        data.timezone,
        data.user_agent[:MAX_USER_AGENT],
        data.map_zoom,
    )
    try:
        issue = await jira_service.create_feedback_issue(data.subject, description, data.type)
    except jira_service.JiraError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail={"code": "feedback_failed"}) from exc
    if not attachments:
        return issue
    try:
        await jira_service.attach_files(issue["issue_key"], attachments)
    except jira_service.JiraError:
        # The issue exists, so an error would invite a retry that files a duplicate.
        await _note_missing_attachments(issue["issue_key"], description, attachments)
        return {**issue, "attachments_failed": True}
    return issue
