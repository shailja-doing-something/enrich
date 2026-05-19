"""
orchestrate.py

Usage: python3 orchestrate.py <team_priority_urls_json_path>

Input: team_priority_urls.json (produced by discover_team_urls.py)
  [{ "team_id": str, "team_name": str, "priority_urls": [str] }, ...]

Output: agents.csv written to the same directory as the input JSON.
  Columns: First Name, Last Name, Email, Phone Number, Job Title,
           Associated Company, team_id, source

Calls Supabase Edge Functions:
  POST {VITE_SUPABASE_URL}/functions/v1/scrape-urls-combined
  POST {VITE_SUPABASE_URL}/functions/v1/extract-team-data

Headers:
  Authorization: Bearer {VITE_SUPABASE_ANON_KEY}
  x-function-secret: {VITE_FUNCTION_SECRET}
"""

import csv
import json
import os
import sys


FIELDNAMES = ["First Name", "Last Name", "Email", "Phone Number",
              "Job Title", "Associated Company", "team_id", "source"]


def scrape_team(team_id: str, team_name: str, priority_urls: list) -> list[dict]:
    # TODO: implement real scraping via scrape-urls-combined + extract-team-data
    supabase_url = os.environ.get("VITE_SUPABASE_URL", "")
    anon_key = os.environ.get("VITE_SUPABASE_ANON_KEY", "")
    function_secret = os.environ.get("VITE_FUNCTION_SECRET", "")
    _ = (supabase_url, anon_key, function_secret, priority_urls)
    return []


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: orchestrate.py <team_priority_urls_json_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = os.path.join(os.path.dirname(input_path), "agents.csv")

    with open(input_path, encoding="utf-8") as f:
        teams = json.load(f)

    all_agents: list[dict] = []
    for team in teams:
        agents = scrape_team(
            team.get("team_id", ""),
            team.get("team_name", ""),
            team.get("priority_urls", []),
        )
        for agent in agents:
            agent.setdefault("team_id", team.get("team_id", ""))
            agent.setdefault("Associated Company", team.get("team_name", ""))
            agent.setdefault("source", "web")
        all_agents.extend(agents)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_agents)

    print(f"Wrote {len(all_agents)} agents to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
