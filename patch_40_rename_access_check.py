"""
patch_40_rename_access_check.py — move the allowlist check endpoint out of
the /auth/* namespace so the prod Caddy proxy routes it to the backend.

In prod, Caddy routes /api/auth/* to the FRONTEND (for NextAuth) and only
other /api/* to the backend. The check-access endpoint lives on the
backend but was mounted at /auth/check-access → in prod the frontend
signIn fetch to /api/auth/check-access hits the FRONTEND, not the backend
→ 404 → fail-closed → nobody can log in. (Locally there's no proxy split,
so it worked.)

Fix: rename backend /auth/check-access -> /access-check (outside the
/auth/* namespace). Frontend fetches /access-check → /api/access-check →
Caddy handle_path /api/* strips the prefix → backend /access-check. Works
in prod and locally.

Two files: rfp-backend/api.py, rfp-frontend/src/auth.ts

Run from repo root:
  ./venv/bin/python3 patch_40_rename_access_check.py
"""
from pathlib import Path

# 1. Backend endpoint path
ip = Path("rfp-backend/api.py")
src = ip.read_text()
old = '@app.get("/auth/check-access")'
new = '@app.get("/access-check")'
assert src.count(old) == 1, "check-access route decorator anchor not found"
src = src.replace(old, new)
ip.write_text(src)
print(f"\u2714 patched {ip}")

# 2. Frontend fetch URL
ap = Path("rfp-frontend/src/auth.ts")
src = ap.read_text()
old = "`${process.env.NEXT_PUBLIC_API_URL}/auth/check-access?email=${encodeURIComponent(email)}`"
new = "`${process.env.NEXT_PUBLIC_API_URL}/access-check?email=${encodeURIComponent(email)}`"
assert src.count(old) == 1, "signIn check-access fetch anchor not found"
src = src.replace(old, new)
ap.write_text(src)
print(f"\u2714 patched {ap}")
