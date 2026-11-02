"""Bureau's JobSpy sidecar: one JSON request in, one JSON document out.

    python -m jobspy_cli --json '{"sites":["indeed"],"search_term":"python developer","location":"Remote"}'
    python -m jobspy_cli --check

Guest / public search only. Nothing here logs in anywhere. Each site is scraped
separately so one blocked site (LinkedIn rate-limits early) never sinks the
others; per-site failures come back in "errors". The process always exits 0 with
a JSON document on stdout unless the input itself is unusable (exit 2) or the
jobspy package is missing (exit 3, still with JSON).
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import sys
import time
from typing import Any

SUPPORTED_SITES = ("linkedin", "indeed", "glassdoor", "google", "zip_recruiter", "bayt", "naukri")
# JobSpy's own documented ceiling is ~1000 per search; keep requests well below it.
MAX_RESULTS = 200
FIELDS = (
    "id", "site", "job_url", "job_url_direct", "title", "company", "company_url", "company_url_direct",
    "location", "date_posted", "job_type", "is_remote", "interval", "min_amount", "max_amount", "currency",
    "salary_source", "description", "emails", "job_level", "job_function", "company_industry",
)


def emit(doc: dict[str, Any], code: int = 0) -> None:
    sys.stdout.write(json.dumps(doc, default=_default, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(code)


def _default(value: Any) -> Any:
    if isinstance(value, (_dt.date, _dt.datetime)):
        return value.isoformat()
    return str(value)


def clean(value: Any) -> Any:
    """pandas hands back NaN/NaT/numpy scalars; JSON wants None and plain types."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item") and not isinstance(value, (list, dict, str)):
        try:
            value = value.item()
        except Exception:  # noqa: BLE001
            pass
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (_dt.date, _dt.datetime)):
        return value.isoformat()
    if type(value).__name__ in ("NaTType",):
        return None
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    return value


def parse_request(raw: str) -> dict[str, Any]:
    req = json.loads(raw)
    if not isinstance(req, dict):
        raise ValueError("request must be a JSON object")
    sites = [s for s in req.get("sites", []) if s in SUPPORTED_SITES]
    if not sites:
        raise ValueError(f"no supported sites requested (supported: {', '.join(SUPPORTED_SITES)})")
    term = str(req.get("search_term", "")).strip()
    if not term:
        raise ValueError("search_term is required")
    return {
        "sites": sites,
        "search_term": term[:200],
        "google_search_term": str(req.get("google_search_term") or f"{term} jobs {req.get('location') or ''}".strip())[:300],
        "location": str(req.get("location") or "")[:120] or None,
        "results_wanted": max(1, min(int(req.get("results_wanted", 50)), MAX_RESULTS)),
        "hours_old": int(req["hours_old"]) if req.get("hours_old") else None,
        "is_remote": bool(req.get("is_remote", False)),
        "country_indeed": str(req.get("country_indeed") or "USA"),
        "proxies": [str(p) for p in req.get("proxies", [])][:20] or None,
        "linkedin_fetch_description": bool(req.get("linkedin_fetch_description", False)),
        "pause_seconds": max(0.0, min(float(req.get("pause_seconds", 2.0)), 30.0)),
    }


def scrape(req: dict[str, Any]) -> dict[str, Any]:
    try:
        from jobspy import scrape_jobs  # type: ignore
    except Exception as err:  # noqa: BLE001
        emit({"ok": False, "unavailable": True, "error": f"python-jobspy is not installed: {err}", "jobs": [], "errors": []}, 3)

    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    counts: dict[str, int] = {}
    for i, site in enumerate(req["sites"]):
        if i and req["pause_seconds"]:
            time.sleep(req["pause_seconds"])
        kwargs: dict[str, Any] = {
            "site_name": [site],
            "search_term": req["search_term"],
            "results_wanted": req["results_wanted"],
            "country_indeed": req["country_indeed"],
            "description_format": "markdown",
            "verbose": 0,
        }
        if req["location"]:
            kwargs["location"] = req["location"]
        if site == "google":
            kwargs["google_search_term"] = req["google_search_term"]
        # JobSpy allows only one of hours_old / is_remote filters on some sites (Indeed); prefer freshness.
        if req["hours_old"]:
            kwargs["hours_old"] = req["hours_old"]
        elif req["is_remote"]:
            kwargs["is_remote"] = True
        if req["proxies"]:
            kwargs["proxies"] = req["proxies"]
        if site == "linkedin":
            kwargs["linkedin_fetch_description"] = req["linkedin_fetch_description"]
        started = time.time()
        try:
            frame = scrape_jobs(**kwargs)
            rows = frame.to_dict(orient="records") if frame is not None else []
        except Exception as err:  # noqa: BLE001
            errors.append({"site": site, "error": f"{type(err).__name__}: {str(err)[:300]}"})
            counts[site] = 0
            continue
        counts[site] = len(rows)
        for row in rows:
            jobs.append({k: clean(row.get(k)) for k in FIELDS if k in row} | {"site": row.get("site") or site})
        sys.stderr.write(f"{site}: {len(rows)} rows in {time.time() - started:.1f}s\n")
    return {"ok": True, "jobs": jobs, "errors": errors, "counts": counts}


def check() -> None:
    try:
        import jobspy  # type: ignore  # noqa: F401
        from importlib.metadata import version

        emit({"ok": True, "python": sys.version.split()[0], "jobspy": version("python-jobspy"), "sites": list(SUPPORTED_SITES)})
    except Exception as err:  # noqa: BLE001
        emit({"ok": False, "unavailable": True, "python": sys.version.split()[0], "error": str(err)}, 3)


def main() -> None:
    parser = argparse.ArgumentParser(prog="jobspy_cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", help="request as a JSON object; '-' reads it from stdin")
    parser.add_argument("--check", action="store_true", help="report whether python-jobspy is importable")
    args = parser.parse_args()
    if args.check:
        check()
    raw = sys.stdin.read() if args.json in (None, "-") else args.json
    try:
        req = parse_request(raw)
    except Exception as err:  # noqa: BLE001
        emit({"ok": False, "error": f"bad request: {err}", "jobs": [], "errors": []}, 2)
    emit(scrape(req))


if __name__ == "__main__":
    main()
