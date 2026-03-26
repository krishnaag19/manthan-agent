"""
MANTHA — Tool 1: data_fetcher.py
Reads CSV / Excel files, validates schema, and returns a clean DataFrame.
Robust fallback: logs every failure, never crashes the pipeline silently.
"""

import os
import logging
from pathlib import Path
from typing import Optional, Union

import pandas as pd

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [data_fetcher]  %(levelname)s — %(message)s",
)
log = logging.getLogger("data_fetcher")


# ── Constants ──────────────────────────────────────────────────────────────────
SUPPORTED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".tsv"}


# ── Helpers ────────────────────────────────────────────────────────────────────
def _detect_delimiter(filepath: str) -> str:
    """Sniff the delimiter for CSV / TSV files."""
    ext = Path(filepath).suffix.lower()
    if ext == ".tsv":
        return "\t"
    # Try sniffing the first 2 KB
    try:
        import csv
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            sample = f.read(2048)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except Exception:
        return ","  # sensible default


def _read_file(filepath: str, sheet_name: Optional[Union[str, int]] = 0) -> pd.DataFrame:
    """Core reader — dispatches by extension."""
    ext = Path(filepath).suffix.lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type '{ext}'. "
            f"Supported: {SUPPORTED_EXTENSIONS}"
        )

    if ext in {".xlsx", ".xls"}:
        log.info("Reading Excel file: %s  (sheet=%s)", filepath, sheet_name)
        df = pd.read_excel(filepath, sheet_name=sheet_name)
    else:
        delimiter = _detect_delimiter(filepath)
        log.info("Reading delimited file: %s  (delimiter=%r)", filepath, delimiter)
        df = pd.read_csv(filepath, delimiter=delimiter, encoding="utf-8", on_bad_lines="warn")

    return df


def _basic_validation(df: pd.DataFrame, filepath: str) -> pd.DataFrame:
    """
    Light validation pass:
    - Strips whitespace from column names
    - Drops fully empty rows / columns
    - Warns on duplicate columns
    """
    # Normalise column names
    df.columns = [str(c).strip() for c in df.columns]

    # Drop completely blank rows & columns
    before = df.shape
    df = df.dropna(how="all").reset_index(drop=True)
    df = df.loc[:, df.notna().any()]
    after = df.shape
    if before != after:
        log.warning(
            "Dropped empty rows/cols: %s → %s  (file=%s)",
            before, after, filepath,
        )

    # Duplicate column check
    dupes = [c for c in df.columns if df.columns.tolist().count(c) > 1]
    if dupes:
        log.warning("Duplicate column names detected: %s", list(set(dupes)))

    return df


# ── Public API ─────────────────────────────────────────────────────────────────
def fetch_data(
    filepath: str,
    sheet_name: Optional[Union[str, int]] = 0,
    required_columns: Optional[list[str]] = None,
) -> Optional[pd.DataFrame]:
    """
    Load a CSV / Excel file and return a validated DataFrame.

    Parameters
    ----------
    filepath        : Path to the data file.
    sheet_name      : Sheet index or name (Excel only). Default: first sheet.
    required_columns: If provided, raises ValueError when any column is missing.

    Returns
    -------
    pd.DataFrame on success, None on failure (error is logged).
    """
    try:
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")

        df = _read_file(filepath, sheet_name=sheet_name)
        df = _basic_validation(df, filepath)

        # Required-column guard
        if required_columns:
            missing = [c for c in required_columns if c not in df.columns]
            if missing:
                raise ValueError(f"Missing required columns: {missing}")

        log.info(
            "Fetch complete — shape=%s  columns=%s  file=%s",
            df.shape, df.columns.tolist(), filepath,
        )
        return df

    except (FileNotFoundError, ValueError, pd.errors.ParserError) as exc:
        log.error("fetch_data failed: %s", exc)
        return None
    except Exception as exc:
        log.exception("Unexpected error in fetch_data: %s", exc)
        return None


def fetch_multiple(
    filepaths: list[str],
    concat: bool = False,
    **kwargs,
) -> Union[dict[str, pd.DataFrame], Optional[pd.DataFrame]]:
    """
    Fetch several files at once.

    Parameters
    ----------
    filepaths : List of file paths.
    concat    : If True, pd.concat all successful DataFrames and return one.
    **kwargs  : Passed through to fetch_data().

    Returns
    -------
    dict {filepath: DataFrame}  OR  single concatenated DataFrame (if concat=True).
    """
    results: dict[str, pd.DataFrame] = {}
    for fp in filepaths:
        df = fetch_data(fp, **kwargs)
        if df is not None:
            results[fp] = df
        else:
            log.warning("Skipping failed file: %s", fp)

    if concat:
        if not results:
            log.error("No files loaded — cannot concatenate.")
            return None
        combined = pd.concat(list(results.values()), ignore_index=True)
        log.info("Concatenated %d files → shape=%s", len(results), combined.shape)
        return combined

    return results


# ── Quick smoke-test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "sample.csv"
    data = fetch_data(path)
    if data is not None:
        print(data.head())