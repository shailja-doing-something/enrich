#!/usr/bin/env python3
"""
find_website.py — Stage 1 of company enrichment pipeline.

Input  (stdin): JSON { team_name, brokerage, location }
Output (stdout): JSON { website: str }  — empty string if not found

Env vars available:
  ANTHROPIC_API_KEY
  OXYLABS_USERNAME
  OXYLABS_PASSWORD
"""
import sys
import json

def find_website(team_name: str, brokerage: str, location: str) -> str:
    # TODO: implement website discovery
    # Suggested approach: use Anthropic API to generate candidate URLs,
    # then use Oxylabs to verify reachability.
    return ""

if __name__ == "__main__":
    data = json.load(sys.stdin)
    website = find_website(
        team_name=data.get("team_name", ""),
        brokerage=data.get("brokerage", ""),
        location=data.get("location", ""),
    )
    print(json.dumps({"website": website}))
