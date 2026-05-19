"""
discover_team_urls.py

Usage: python3 discover_team_urls.py <input_csv_path>

Input CSV columns: uuid, team_name, url
Output: team_priority_urls.json written to the same directory as the input CSV.

Each entry in the JSON has the form:
  { "team_id": str, "team_name": str, "priority_urls": [str, ...] }

Fill in real discovery logic using Oxylabs / Anthropic as needed.
Reads OXYLABS_USERNAME, OXYLABS_PASSWORD, ANTHROPIC_API_KEY from env.
"""

import csv
import json
import os
import sys


def discover_priority_urls(team_id: str, team_name: str, url: str) -> list[str]:
    # TODO: implement real URL discovery
    return [url] if url else []


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: discover_team_urls.py <input_csv_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = os.path.join(os.path.dirname(input_path), "team_priority_urls.json")

    results = []
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            team_id = row.get("uuid", "").strip()
            team_name = row.get("team_name", "").strip()
            url = row.get("url", "").strip()
            priority_urls = discover_priority_urls(team_id, team_name, url)
            results.append({"team_id": team_id, "team_name": team_name, "priority_urls": priority_urls})

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"Wrote {len(results)} entries to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
