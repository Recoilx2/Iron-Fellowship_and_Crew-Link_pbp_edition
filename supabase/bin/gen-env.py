#!/usr/bin/env python3
"""Generate a per-copy env file for the Supabase stack from .env.example.

Fills every blank secret with a fresh random value and points the copy at its
own gateway port. The output file is git-ignored and must never be committed.

Usage:
    python3 bin/gen-env.py --copy ironsworn --port 8000 [--out .env.ironsworn]
    python3 bin/gen-env.py --copy starforged --port 8001 [--out .env.starforged]
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EXAMPLE = os.path.join(os.path.dirname(HERE), ".env.example")

COPY_PORTS = {"ironsworn": "8000", "starforged": "8001"}
SITE_PORTS = {"ironsworn": "8080", "starforged": "8081"}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def mint_jwt(secret: str, role: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(time.time())
    payload = b64url(
        json.dumps(
            {"role": role, "iss": "supabase", "iat": now, "exp": now + 10 * 365 * 24 * 3600},
            separators=(",", ":"),
        ).encode()
    )
    sig = b64url(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def fresh_secrets() -> dict:
    jwt_secret = secrets.token_urlsafe(36)  # ~48 chars, well over the 32 minimum
    # GM assistant LLM keys (GM_ASSISTANT_ENDPOINT/API_KEY/ALLOWED_MODELS) are
    # intentionally not generated: they stay blank until the operator fills
    # them, and the assistant reports "not set up" until then (spec #10).
    return {
        "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
        "JWT_SECRET": jwt_secret,
        "ANON_KEY": mint_jwt(jwt_secret, "anon"),
        "SERVICE_ROLE_KEY": mint_jwt(jwt_secret, "service_role"),
        "SECRET_KEY_BASE": secrets.token_urlsafe(48),
        # Exactly 32 chars: realtime requires 32 bytes for AES-256-GCM.
        "REALTIME_DB_ENC_KEY_GCM": secrets.token_hex(16),
        "S3_PROTOCOL_ACCESS_KEY_ID": secrets.token_hex(16),
        "S3_PROTOCOL_ACCESS_KEY_SECRET": secrets.token_hex(32),
        "PG_META_CRYPTO_KEY": secrets.token_urlsafe(32),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a per-copy Supabase env file.")
    parser.add_argument("--copy", required=True, help="Copy name, e.g. ironsworn or starforged.")
    parser.add_argument("--port", help="Gateway host port (defaults: 8000/8001 for the two game systems).")
    parser.add_argument("--site-port", help="Site host port (defaults: 8080/8081 for the two game systems).")
    parser.add_argument("--out", help="Output path (default: .env.<copy> next to .env.example).")
    args = parser.parse_args()

    port = args.port or COPY_PORTS.get(args.copy, "8000")
    site_port = args.site_port or SITE_PORTS.get(args.copy, "8080")
    out = args.out or os.path.join(os.path.dirname(EXAMPLE), f".env.{args.copy}")

    lines = open(EXAMPLE).read().splitlines(keepends=False)
    values = fresh_secrets()
    values.update(
        {
            "ENV_FILE": os.path.basename(out),
            "GAME_SYSTEM": args.copy,
            "API_GW_HTTP_PORT": port,
            "SUPABASE_PUBLIC_URL": f"http://localhost:{port}",
            "API_EXTERNAL_URL": f"http://localhost:{port}/auth/v1",
            "SITE_HTTP_PORT": site_port,
            "SITE_URL": f"http://localhost:{site_port}",
        }
    )

    filled = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            filled.append(line)
            continue
        key, current = line.split("=", 1)
        key = key.strip()
        if key in values:
            filled.append(f"{key}={values[key]}")
        elif current.strip() == "" and key not in values:
            # A blank we do not generate (optional asymmetric keys): keep the
            # example's default so legacy API key mode stays on.
            filled.append(line)
        else:
            filled.append(line)

    # Storage's own upload ceiling (FILE_SIZE_LIMIT, bytes) derives from the
    # one image size setting CHAT_IMAGE_MAX_MB (ticket #118), so the bucket
    # cap (apply.sh, every start), the client cap (site build) and Storage
    # follow it together on every deploy.
    image_max_mb = 10
    for line in filled:
        if line.startswith("CHAT_IMAGE_MAX_MB="):
            raw = line.split("=", 1)[1].strip()
            if raw.isdigit() and int(raw) > 0:
                image_max_mb = int(raw)
    derived_limit = f"FILE_SIZE_LIMIT={image_max_mb * 1024 * 1024}"
    for i, line in enumerate(filled):
        if line.startswith("FILE_SIZE_LIMIT="):
            filled[i] = derived_limit
            break
    else:
        for i, line in enumerate(filled):
            if line.startswith("CHAT_IMAGE_MAX_MB="):
                filled.insert(i + 1, derived_limit)
                break
        else:
            filled.append(derived_limit)

    with open(out, "w") as fh:
        fh.write("\n".join(filled) + "\n")

    missing = [k for k, v in values.items() if not v]
    if missing:
        print(f"gen-env: refusing to write, blank values for: {', '.join(missing)}", file=sys.stderr)
        return 1
    print(f"gen-env: wrote {out} (keep it secret, never commit it)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
