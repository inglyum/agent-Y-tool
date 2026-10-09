"""Protezione SSRF per tutte le richieste in uscita del crawler e dell'acquisizione URL.

Regole: solo http/https, porte 80/443, niente credenziali nell'URL, l'host deve risolvere SOLO a indirizzi
pubblici (niente localhost, reti private, link-local, metadata cloud). Il controllo si applica a ogni
richiesta, compresi i redirect. Limite noto: un DNS che cambia risposta tra controllo e connessione
(DNS rebinding) non è escluso al 100%; in produzione conviene anche un egress firewall.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Callable
from urllib.parse import urlsplit

import httpx


class BlockedURL(ValueError):
    pass


Resolver = Callable[[str, int], list[str]]


def system_resolver(host: str, port: int) -> list[str]:
    return list({ai[4][0] for ai in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})


class NetGuard:
    def __init__(self, resolver: Resolver = system_resolver):
        self.resolver = resolver

    def check(self, url: str) -> None:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https"):
            raise BlockedURL(f"Schema non consentito: {parts.scheme or '-'}")
        if parts.username or parts.password:
            raise BlockedURL("Credenziali nell'URL non consentite")
        host = parts.hostname
        if not host:
            raise BlockedURL("URL senza host")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in (80, 443):
            raise BlockedURL(f"Porta non consentita: {port}")
        try:
            ipaddress.ip_address(host)
            addrs = [host]
        except ValueError:
            try:
                addrs = self.resolver(host, port)
            except OSError as e:
                raise BlockedURL(f"Host non risolvibile: {host}") from e
        for a in addrs:
            ip = ipaddress.ip_address(a.split("%")[0])
            if not ip.is_global or ip.is_multicast:
                raise BlockedURL(f"Indirizzo non pubblico bloccato: {host} → {a}")

    def client(self, user_agent: str, transport: httpx.BaseTransport | None = None, timeout: float = 30) -> httpx.Client:
        def hook(request: httpx.Request) -> None:
            self.check(str(request.url))
        return httpx.Client(timeout=timeout, follow_redirects=True, max_redirects=5, transport=transport,
                            headers={"User-Agent": user_agent}, event_hooks={"request": [hook]})
