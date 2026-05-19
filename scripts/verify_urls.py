#!/usr/bin/env python3
"""
verify_urls.py — Stage 3 of company enrichment pipeline.

Input  (stdin): JSON { website: str }
Output (stdout): JSON { valid: bool, error: str | null }

Approach:
  Oxylabs Universal Scraper fetches the URL through a residential proxy.
  Returns valid=True when the page responds with HTTP 200.
"""
import sys
import json
import os
import base64
import urllib.request
import urllib.error

OXYLABS_URL = "https://realtime.oxylabs.io/v1/queries"


def verify_url(website):
    if not website:
        return False, "empty URL"

    username = os.environ["OXYLABS_USERNAME"]
    password = os.environ["OXYLABS_PASSWORD"]
    creds = base64.b64encode(f"{username}:{password}".encode()).decode()

    data = json.dumps({
        "source": "universal",
        "url": website,
    }).encode()

    req = urllib.request.Request(
        OXYLABS_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {creds}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        results = result.get("results", [])
        if not results:
            return False, "no results returned"
        status_code = results[0].get("status_code", 0)
        if status_code == 200:
            return True, None
        return False, f"HTTP {status_code}"
    except urllib.error.HTTPError as e:
        # Oxylabs itself returned an error (bad auth, quota, etc.)
        body = ""
        try:
            body = e.read().decode()
        except Exception:
            pass
        return False, f"Oxylabs HTTP {e.code}: {body[:200]}"
    except Exception as e:
        return False, str(e)


if __name__ == "__main__":
    data = json.load(sys.stdin)
    valid, error = verify_url(website=data.get("website", ""))
    print(json.dumps({"valid": valid, "error": error}))
