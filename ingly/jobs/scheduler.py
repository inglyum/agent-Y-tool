"""Coda di job persistente su SQLite: lease/lock, retry con backoff, dead-letter, timeout, pianificazioni."""
from __future__ import annotations

import json
import os
import socket
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from datetime import timedelta
from typing import Callable

from ..audit import audit, log
from ..db import Database, now_iso, parse_iso, utcnow

Handler = Callable[[dict], dict | None]
BACKOFF_BASE_S = 30
BACKOFF_MAX_S = 6 * 3600


class RetryLater(Exception):
    """Il handler chiede un nuovo tentativo dopo `delay_s` senza contarlo come errore definitivo."""

    def __init__(self, msg: str, delay_s: int):
        super().__init__(msg)
        self.delay_s = delay_s


class JobQueue:
    def __init__(self, db: Database, worker_id: str | None = None, lease_s: int = 300, timeout_s: int = 240):
        self.db = db
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.lease_s = lease_s
        self.timeout_s = timeout_s
        self.handlers: dict[str, Handler] = {}

    def register(self, name: str, fn: Handler) -> None:
        self.handlers[name] = fn

    def enqueue(self, name: str, payload: dict | None = None, dedupe_key: str | None = None,
                delay_s: int = 0, max_attempts: int = 5) -> int | None:
        """Ritorna l'id del job o None se un job con la stessa dedupe_key è già in coda/in esecuzione."""
        now = now_iso()
        with self.db.tx() as c:
            if dedupe_key:
                ex = c.execute("SELECT id, status FROM jobs WHERE dedupe_key=?", (dedupe_key,)).fetchone()
                if ex and ex["status"] in ("queued", "running"):
                    return None
                if ex:  # job concluso con la stessa chiave: lo liberiamo per riusarla
                    c.execute("UPDATE jobs SET dedupe_key=NULL WHERE id=?", (ex["id"],))
            return c.execute("""INSERT INTO jobs (name,payload,dedupe_key,status,attempts,max_attempts,run_after,created_at,updated_at)
                                VALUES (?,?,?,'queued',0,?,?,?,?)""",
                             (name, json.dumps(payload or {}), dedupe_key, max_attempts, now_iso(timedelta(seconds=delay_s)),
                              now, now)).lastrowid

    def claim(self) -> dict | None:
        now = now_iso()
        with self.db.tx() as c:
            # job con lease scaduto (worker morto o timeout): tornano disponibili
            c.execute("""UPDATE jobs SET status='queued', locked_by=NULL, lease_until=NULL, updated_at=?,
                         last_error=COALESCE(last_error,'') || ' [lease scaduto]'
                         WHERE status='running' AND lease_until < ?""", (now, now))
            row = c.execute("""SELECT * FROM jobs WHERE status='queued' AND run_after <= ? ORDER BY run_after, id LIMIT 1""",
                            (now,)).fetchone()
            if not row:
                return None
            c.execute("""UPDATE jobs SET status='running', locked_by=?, lease_until=?, attempts=attempts+1, updated_at=?
                         WHERE id=?""", (self.worker_id, now_iso(timedelta(seconds=self.lease_s)), now, row["id"]))
            job = dict(row)
            job["attempts"] += 1
            return job

    def _finish(self, job: dict, status: str, error: str | None, duration_ms: int, run_after: str | None = None):
        self.db.run("""UPDATE jobs SET status=?, last_error=?, duration_ms=?, locked_by=NULL, lease_until=NULL,
                       run_after=COALESCE(?, run_after), updated_at=? WHERE id=? AND locked_by=?""",
                    (status, error, duration_ms, run_after, now_iso(), job["id"], self.worker_id))

    def run_one(self) -> dict | None:
        job = self.claim()
        if not job:
            return None
        fn = self.handlers.get(job["name"])
        t0 = time.monotonic()
        if not fn:
            self._finish(job, "dead", f"Nessun handler per {job['name']}", 0)
            return {"id": job["id"], "status": "dead"}
        try:
            ex = ThreadPoolExecutor(max_workers=1)
            try:
                result = ex.submit(fn, json.loads(job["payload"])).result(timeout=self.timeout_s)
            finally:
                ex.shutdown(wait=False)  # su timeout non restiamo bloccati sul thread del handler
            self._finish(job, "done", None, int((time.monotonic() - t0) * 1000))
            return {"id": job["id"], "status": "done", "result": result}
        except RetryLater as e:
            status = "queued" if job["attempts"] < job["max_attempts"] else "dead"
            self._finish(job, status, str(e), int((time.monotonic() - t0) * 1000),
                         now_iso(timedelta(seconds=e.delay_s)) if status == "queued" else None)
            return {"id": job["id"], "status": status, "error": str(e)}
        except FutTimeout:
            err = f"Timeout dopo {self.timeout_s}s"
        except Exception as e:  # noqa: BLE001 — registriamo ogni errore del handler
            err = f"{type(e).__name__}: {e}"
            log.warning("job failed", extra={"data": {"job": job["name"], "id": job["id"], "error": err,
                                                      "trace": traceback.format_exc(limit=3)}})
            if getattr(e, "retryable", True) is False:
                self._finish(job, "dead", err, int((time.monotonic() - t0) * 1000))
                audit(self.db, f"job:{job['name']}", "job.dead", "job", job["id"], {"error": err})
                return {"id": job["id"], "status": "dead", "error": err}
        dur = int((time.monotonic() - t0) * 1000)
        if job["attempts"] >= job["max_attempts"]:
            self._finish(job, "dead", err, dur)
            audit(self.db, f"job:{job['name']}", "job.dead", "job", job["id"], {"error": err})
            return {"id": job["id"], "status": "dead", "error": err}
        delay = min(BACKOFF_BASE_S * 2 ** (job["attempts"] - 1), BACKOFF_MAX_S)
        self._finish(job, "queued", err, dur, now_iso(timedelta(seconds=delay)))
        return {"id": job["id"], "status": "retry", "error": err, "retry_in_s": delay}

    def run_until_empty(self, max_jobs: int = 1000) -> list[dict]:
        out = []
        for _ in range(max_jobs):
            r = self.run_one()
            if r is None:
                break
            out.append(r)
        return out

    # ---------- pianificazioni ----------
    def set_schedule(self, name: str, interval_minutes: int, payload: dict | None = None, enabled: bool = True) -> None:
        if interval_minutes < 1:
            raise ValueError("Intervallo minimo 1 minuto")
        self.db.run("""INSERT INTO job_schedules (name,interval_minutes,enabled,payload) VALUES (?,?,?,?)
                       ON CONFLICT(name) DO UPDATE SET interval_minutes=excluded.interval_minutes, enabled=excluded.enabled,
                       payload=excluded.payload""", (name, interval_minutes, int(enabled), json.dumps(payload or {})))

    def tick_schedules(self) -> list[str]:
        """Accoda i job pianificati scaduti. Il nome schedule può avere forma 'handler@chiave'."""
        enq = []
        for s in self.db.all("SELECT * FROM job_schedules WHERE enabled=1"):
            last = parse_iso(s["last_enqueued_at"])
            if last and (utcnow() - last).total_seconds() < s["interval_minutes"] * 60:
                continue
            handler = s["name"].split("@", 1)[0]
            if self.enqueue(handler, json.loads(s["payload"]), dedupe_key=f"schedule:{s['name']}"):
                enq.append(s["name"])
            self.db.run("UPDATE job_schedules SET last_enqueued_at=? WHERE name=?", (now_iso(), s["name"]))
        return enq

    def stats(self) -> dict:
        rows = self.db.all("SELECT name, status, COUNT(*) AS n, AVG(duration_ms) AS avg_ms FROM jobs GROUP BY name, status")
        return {"by_name_status": rows,
                "dead": self.db.all("SELECT id,name,last_error,updated_at FROM jobs WHERE status='dead' ORDER BY id DESC LIMIT 50")}

    def requeue_dead(self, job_id: int) -> bool:
        return bool(self.db.run("UPDATE jobs SET status='queued', attempts=0, run_after=?, updated_at=? WHERE id=? AND status='dead'",
                                (now_iso(), now_iso(), job_id)))

    def run_forever(self, poll_s: float = 5.0, stop: Callable[[], bool] = lambda: False) -> None:
        log.info("worker started", extra={"data": {"worker": self.worker_id}})
        while not stop():
            self.tick_schedules()
            if self.run_one() is None:
                time.sleep(poll_s)
