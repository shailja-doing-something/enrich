#!/usr/bin/env python3
"""
find_website.py — Stage 1 of company enrichment pipeline.

Input  (stdin): JSON { team_name, brokerage, location }
Output (stdout): JSON { website: str }  — empty string if not found

Approach:
  1. Oxylabs SERP API — Google search for the team name + brokerage
  2. OpenRouter (Claude Haiku) — selects the best URL from top results
"""
import sys
import json
import os
import re
import base64
import urllib.request
import urllib.error

OXYLABS_URL = "https://realtime.oxylabs.io/v1/queries"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _oxylabs_post(payload):
    username = os.environ["OXYLABS_USERNAME"]
    password = os.environ["OXYLABS_PASSWORD"]
    creds = base64.b64encode(f"{username}:{password}".encode()).decode()
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        OXYLABS_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {creds}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def search_google(query):
    """Return up to 5 organic result URLs via Oxylabs SERP."""
    try:
        result = _oxylabs_post({
            "source": "google_search",
            "query": query,
            "pages": 1,
            "limit": 5,
            "parse": True,
        })
        organic = (
            result.get("results", [{}])[0]
            .get("content", {})
            .get("results", {})
            .get("organic", [])
        )
        return [r["url"] for r in organic if r.get("url")]
    except Exception as e:
        print(f"Oxylabs SERP error: {e}", file=sys.stderr)
        return []


def pick_with_claude(team_name, brokerage, location, candidates):
    """Ask Claude (via OpenRouter) to select the best URL from candidates."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return candidates[0] if candidates else ""

    candidate_list = "\n".join(f"- {u}" for u in candidates)
    prompt = (
        f"Real estate team: {team_name}\n"
        f"Brokerage: {brokerage}\n"
        f"Location: {location}\n\n"
        f"Which of these URLs is the team's official website?\n"
        f"{candidate_list}\n\n"
        "Reply with ONLY the URL, or \"none\" if none match."
    )
    data = json.dumps({
        "model": "anthropic/claude-haiku",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100,
        "temperature": 0,
    }).encode()
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        answer = result["choices"][0]["message"]["content"].strip()
        if answer.lower() == "none":
            return ""
        urls = re.findall(r"https?://[^\s<>\"{}|\\^`\[\]]+", answer)
        return urls[0].rstrip(".,)") if urls else ""
    except Exception as e:
        print(f"OpenRouter error: {e}", file=sys.stderr)
        # Fall back to top result rather than returning nothing
        return candidates[0] if candidates else ""


def find_website(team_name, brokerage, location):
    if not team_name:
        return ""

    query = f'"{team_name}" {brokerage} {location} real estate team'
    candidates = search_google(query)

    if not candidates:
        return ""
    if len(candidates) == 1:
        return candidates[0]

    return pick_with_claude(team_name, brokerage, location, candidates[:5])


if __name__ == "__main__":
    data = json.load(sys.stdin)
    website = find_website(
        team_name=data.get("team_name", ""),
        brokerage=data.get("brokerage", ""),
        location=data.get("location", ""),
    )
    print(json.dumps({"website": website}))
