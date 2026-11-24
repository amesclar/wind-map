"""Feedback API router: file a Jira issue from the app's feedback form (SCRUM-179)."""

import logging
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator

from backend.app import config
from backend.app.services import feedback_limiter, jira_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

MAX_SUBJECT = 50
MAX_COMMENTS = 1000
MAX_EMAIL = 254
MAX_USER_AGENT = 200

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


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _read_body(request: Request) -> bytes:
    """The request body, rejected with 413 as soon as it passes the size cap."""
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


@router.post("", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def submit_feedback(request: Request):
    if not config.feedback_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "feedback_unavailable"})
    body = await _read_body(request)
    try:
        data = FeedbackRequest.model_validate_json(body)
    except ValidationError as exc:
        # Field names and messages only: the submitted text is never echoed or logged.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": errors})
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
    )
    try:
        return await jira_service.create_feedback_issue(data.subject, description, data.type)
    except jira_service.JiraError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail={"code": "feedback_failed"}) from exc
