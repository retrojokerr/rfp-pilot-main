"""
bootstrap_credentials.py — recreate credentials.json from a base64 env var.

In deployment, the Google service-account file is NOT on disk or in the
image. Instead it lives as a Doppler secret GOOGLE_CREDENTIALS_B64. This
module decodes it to credentials.json at import time, so the rest of the
code (ingest.py) works unchanged.

Local dev: if credentials.json already exists, this does nothing.
"""

import os
import base64
from pathlib import Path

CREDS_PATH = Path(os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json"))


def ensure_credentials() -> None:
    # Already present (local dev) — leave it alone
    if CREDS_PATH.exists():
        return

    b64 = os.getenv("GOOGLE_CREDENTIALS_B64", "").strip()
    if not b64:
        # No secret and no file — Drive sync will fail loudly when used,
        # which is the correct behaviour rather than silently breaking.
        print("  [credentials] No credentials.json and no GOOGLE_CREDENTIALS_B64 set")
        return

    try:
        decoded = base64.b64decode(b64)
        CREDS_PATH.write_bytes(decoded)
        CREDS_PATH.chmod(0o600)
        print(f"  [credentials] Wrote {CREDS_PATH} from GOOGLE_CREDENTIALS_B64")
    except Exception as e:
        print(f"  [credentials] Failed to decode GOOGLE_CREDENTIALS_B64: {e}")


# Run on import
ensure_credentials()