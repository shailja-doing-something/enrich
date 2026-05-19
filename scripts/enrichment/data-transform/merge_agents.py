"""
merge_agents.py

Usage: python3 merge_agents.py [--web agents.csv] [--zillow agents_zillow.csv]

At least one of --web or --zillow must be provided.
Output: agents_merged.csv written to the current working directory.
  Columns: First Name, Last Name, Email, Phone Number, Job Title,
           Associated Company, team_id, source

Deduplicates on Email (case-insensitive). Zillow rows take precedence over web rows
on duplicates (web runs first in the merge order so zillow overwrites).
"""

import argparse
import csv
import os
import sys


FIELDNAMES = ["First Name", "Last Name", "Email", "Phone Number",
              "Job Title", "Associated Company", "team_id", "source"]


def read_csv(path: str) -> list[dict]:
    if not path or not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", default="")
    parser.add_argument("--zillow", default="")
    args = parser.parse_args()

    if not args.web and not args.zillow:
        print("Error: at least one of --web or --zillow must be provided", file=sys.stderr)
        sys.exit(1)

    web_rows = read_csv(args.web)
    zillow_rows = read_csv(args.zillow)

    # Deduplicate by email; zillow wins over web
    seen: dict[str, dict] = {}
    for row in web_rows:
        email = (row.get("Email") or "").strip().lower()
        if email:
            seen[email] = row
    for row in zillow_rows:
        email = (row.get("Email") or "").strip().lower()
        if email:
            seen[email] = row

    merged = list(seen.values())

    output_path = os.path.join(os.getcwd(), "agents_merged.csv")
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(merged)

    print(f"Merged {len(merged)} agents to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
