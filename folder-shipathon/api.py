# api.py
"""
MANTHA — api.py
FastAPI wrapper. Accepts a text query from the Gmail extension,
resolves the right data file from the local folder, runs the
full pipeline, and returns a draft reply + base64 PDF report.
"""

import os
import base64
import logging
import tempfile
import traceback
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipeline_runner import run_pipeline

# ── If your team already has a file-resolver function, import it here:
# from fetcher import resolve_file_for_query   ← swap in if it exists

log = logging.getLogger("mantha_api")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  [api]  %(levelname)s — %(message)s")

app = FastAPI(title="MANTHA API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── IMPORTANT: Set this to your local data folder path ────────
DATA_FOLDER = os.environ.get("MANTHA_DATA_FOLDER", "./data")


# ── Request shape from the Gmail extension ────────────────────
class EmailRequest(BaseModel):
    query:   str        # the email body text
    context: dict       # subject, sender, thread etc.


# ── Health check ──────────────────────────────────────────────
@app.get("/health")
async def health():
    files = list_data_files()
    return {
        "status":      "ok",
        "data_folder": DATA_FOLDER,
        "files_found": len(files),
        "files":       files,
    }


# ── Main endpoint ─────────────────────────────────────────────
@app.post("/process")
async def process(req: EmailRequest):
    try:
        log.info("Query received: %s", req.query[:120])

        # ── Step 1: Find the right file for this query ────────
        filepath = resolve_file_for_query(req.query, req.context)

        if not filepath:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No matching data file found for this query in '{DATA_FOLDER}'. "
                    f"Available files: {list_data_files()}"
                )
            )

        log.info("Resolved file: %s", filepath)

        # ── Step 2: Run pipeline into a temp output folder ────
        tmp_dir    = tempfile.mkdtemp()
        tmp_pdf    = os.path.join(tmp_dir, "mantha_report.pdf")
        tmp_plots  = os.path.join(tmp_dir, "plots")

        try:
            success = run_pipeline(
                filepath=filepath,
                recipients=[],        # extension handles reply
                output_pdf=tmp_pdf,
                output_plots=tmp_plots,
                send_email=False,     # never auto-send from API
            )

            if not success:
                raise HTTPException(
                    status_code=500,
                    detail="Pipeline failed — check server logs."
                )

            # ── Step 3: Read the generated PDF ────────────────
            if not os.path.exists(tmp_pdf):
                raise HTTPException(
                    status_code=500,
                    detail="PDF was not generated."
                )

            with open(tmp_pdf, "rb") as f:
                pdf_b64 = base64.b64encode(f.read()).decode("utf-8")

            # ── Step 4: Build reply draft ──────────────────────
            draft = build_reply_draft(
                query=req.query,
                context=req.context,
                resolved_file=os.path.basename(filepath),
            )

            return JSONResponse(content={
                "success":    True,
                "draft":      draft,
                "report_pdf": pdf_b64,
                "filename":   f"MANTHA_Report_{Path(filepath).stem}.pdf",
                "source_file": os.path.basename(filepath),
            })

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# FILE RESOLVER
# ═══════════════════════════════════════════════════════════════

def resolve_file_for_query(query: str, context: dict) -> str | None:
    """
    Finds the most relevant data file in DATA_FOLDER for a given query.

    Priority order:
      1. If your team has a resolve_file_for_query() in fetcher.py — use that.
      2. Keyword match: query words against filenames.
      3. Subject line match: email subject against filenames.
      4. Fallback: most recently modified file in the folder.

    Swap out this whole function once your team's logic is ready.
    """

    # ── Option 1: Use your team's existing resolver if it exists ──
    # Uncomment this block if fetcher.py has a resolve function:
    #
    # try:
    #     from fetcher import resolve_file_for_query as team_resolver
    #     return team_resolver(query, DATA_FOLDER)
    # except ImportError:
    #     pass

    # ── Option 2: Keyword match against filenames ──────────────
    files = list_data_files(full_path=True)
    if not files:
        return None

    query_words = set(query.lower().split())
    subject     = context.get("subject", "").lower()
    subject_words = set(subject.split())
    search_terms  = query_words | subject_words

    scored = []
    for fp in files:
        name  = Path(fp).stem.lower().replace("_", " ").replace("-", " ")
        score = sum(1 for word in search_terms if word in name)
        scored.append((score, fp))

    scored.sort(key=lambda x: x[0], reverse=True)

    # If any file scored > 0, return the best match
    best_score, best_file = scored[0]
    if best_score > 0:
        log.info("File matched by keyword (score=%d): %s", best_score, best_file)
        return best_file

    # ── Option 3: Fallback — most recently modified file ───────
    files_by_mtime = sorted(files, key=os.path.getmtime, reverse=True)
    log.warning("No keyword match found — falling back to most recent file: %s", files_by_mtime[0])
    return files_by_mtime[0]


def list_data_files(full_path: bool = False) -> list[str]:
    """Return all CSV/Excel files in DATA_FOLDER."""
    supported = {".csv", ".xlsx", ".xls", ".tsv"}
    folder = Path(DATA_FOLDER)

    if not folder.exists():
        log.warning("DATA_FOLDER does not exist: %s", DATA_FOLDER)
        return []

    files = [
        str(f) if full_path else f.name
        for f in folder.iterdir()
        if f.suffix.lower() in supported
    ]
    return files


# ═══════════════════════════════════════════════════════════════
# DRAFT BUILDER
# ═══════════════════════════════════════════════════════════════

def build_reply_draft(query: str, context: dict, resolved_file: str) -> str:
    sender  = context.get("sender", "")
    name    = sender.split("<")[0].strip() or "there"
    subject = context.get("subject", "your query")

    return (
        f"Hi {name},\n\n"
        f"Thank you for your message regarding \"{subject}\".\n\n"
        f"I've run your query through our data pipeline and pulled the relevant "
        f"analysis from {resolved_file}. Please find the full report attached — "
        f"it includes data breakdowns, visualisations, and key insights.\n\n"
        f"Let me know if you'd like a different cut of the data or have any follow-up questions.\n\n"
        f"Best regards"
    )
