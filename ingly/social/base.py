"""Interfaccia comune dei connettori social."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class ConnectorError(RuntimeError):
    retryable = False


class TokenExpired(ConnectorError):
    pass


class PermissionMissing(ConnectorError):
    pass


class RateLimited(ConnectorError):
    retryable = True

    def __init__(self, msg: str, retry_after_s: int = 900):
        super().__init__(msg)
        self.retry_after_s = retry_after_s


class TransientError(ConnectorError):
    retryable = True


class NotSupported(ConnectorError):
    pass


@dataclass
class Capabilities:
    read_posts: bool = False
    read_comments: bool = False
    reply_comment: bool = False
    reply_post: bool = False
    send_private_message: bool = False
    webhooks: bool = False
    notes: list[str] = field(default_factory=list)


@dataclass
class IncomingItem:
    external_id: str
    kind: str                       # post | comment | message
    text: str
    parent_external_id: str | None = None
    author_ref: str | None = None
    author_name: str | None = None
    permalink: str | None = None
    created_at: str | None = None


class Connector(Protocol):
    platform: str

    def capabilities(self) -> Capabilities: ...
    def fetch_new(self, source: dict, since: str | None) -> list[IncomingItem]: ...
    def reply(self, item: dict, text: str) -> str: ...
