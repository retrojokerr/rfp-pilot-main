import os
import json
import time
import schedule
from pathlib import Path
from dotenv import load_dotenv

from ingest import (
    get_drive_service,
    list_drive_files,
    download_file,
    ingest_file,
    qdrant,
    COLLECTION,
    GOOGLE_MIME_EXPORT
)
from qdrant_client.models import Filter, FieldCondition, MatchValue

load_dotenv()

# ── State file to track what's already ingested ─────────────
STATE_FILE = "drive_state.json"

def load_state() -> dict:
    if Path(STATE_FILE).exists():
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ── Remove deleted files from Qdrant ────────────────────────
def remove_deleted_files(service, state: dict) -> dict:
    """Remove vectors from Qdrant for files deleted from Drive."""
    current_files = {f["id"] for f in list_drive_files(service)}
    deleted_ids   = [fid for fid in state if fid not in current_files]

    for file_id in deleted_ids:
        name = state[file_id]["name"]
        print(f"[Watcher] File deleted from Drive: {name} — removing from Qdrant...")

        try:
            qdrant.delete(
                collection_name=COLLECTION,
                points_selector=Filter(
                    must=[FieldCondition(key="file_id", match=MatchValue(value=file_id))]
                )
            )
            del state[file_id]
            print(f"[Watcher] Removed vectors for: {name}")
        except Exception as e:
            print(f"[Watcher] Failed to remove {name}: {e}")

    return state


# ── Check Drive for new or modified files ───────────────────
def check_and_ingest():
    print("\n[Watcher] Checking Google Drive for changes...")

    try:
        service = get_drive_service()
        files   = list_drive_files(service)
        state   = load_state()

        # Handle deletions first
        state   = remove_deleted_files(service, state)
        updated = False

        for f in files:
            file_id   = f["id"]
            name      = f["name"]
            modified  = f["modifiedTime"]
            mime_type = f["mimeType"]
            ext       = Path(name).suffix.lower()

            is_google_type = mime_type in GOOGLE_MIME_EXPORT
            is_supported   = ext in (".pdf", ".docx", ".xlsx", ".csv")

            if not is_google_type and not is_supported:
                print(f"[Watcher] Skipping unsupported file: {name}")
                continue

            # Check if file is new or modified
            if file_id in state and state[file_id]["modifiedTime"] == modified:
                print(f"[Watcher] No change: {name}")
                continue

            # New or modified — ingest it
            status = "New" if file_id not in state else "Modified"
            print(f"[Watcher] {status} file detected: {name}")

            try:
                buf, final_name = download_file(service, file_id, name, mime_type)
                ingest_file(buf, final_name, file_id)

                state[file_id] = {
                    "name":         name,
                    "modifiedTime": modified,
                }
                updated = True
                print(f"[Watcher] Successfully ingested: {name}")

            except Exception as e:
                print(f"[Watcher] Failed to ingest {name}: {e}")

        if updated:
            save_state(state)
            print("[Watcher] State saved.")
        else:
            print("[Watcher] No changes found.")

    except Exception as e:
        print(f"[Watcher] Error checking Drive: {e}")


# ── Start watcher ────────────────────────────────────────────
def start_watcher(interval_minutes: int = 5):
    print(f"[Watcher] Starting — checking Drive every {interval_minutes} minutes...")

    # Run once immediately on startup
    check_and_ingest()

    # Then schedule every N minutes
    schedule.every(interval_minutes).minutes.do(check_and_ingest)

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    start_watcher(interval_minutes=5)