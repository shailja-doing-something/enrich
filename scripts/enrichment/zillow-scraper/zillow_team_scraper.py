"""
zillow_team_scraper.py

Usage: python3 zillow_team_scraper.py <input_csv_path>

Input CSV columns: team_id, team_name, zillow_url
Output: agents_zillow.csv written to the same directory as the input CSV.
  Columns: First Name, Last Name, Email, Phone Number, Job Title,
           Associated Company, team_id, source

Reads OXYLABS_USERNAME, OXYLABS_PASSWORD from env.
"""

import csv
import os
import sys


FIELDNAMES = ["First Name", "Last Name", "Email", "Phone Number",
              "Job Title", "Associated Company", "team_id", "source"]


def scrape_zillow_team(team_id: str, team_name: str, zillow_url: str) -> list[dict]:
    # TODO: implement real Zillow scraping via Oxylabs
    ox_user = os.environ.get("OXYLABS_USERNAME", "")
    ox_pass = os.environ.get("OXYLABS_PASSWORD", "")
    _ = (ox_user, ox_pass, zillow_url)
    return []


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: zillow_team_scraper.py <input_csv_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = os.path.join(os.path.dirname(input_path), "agents_zillow.csv")

    all_agents: list[dict] = []
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            team_id = row.get("team_id", "").strip()
            team_name = row.get("team_name", "").strip()
            zillow_url = row.get("zillow_url", "").strip()
            agents = scrape_zillow_team(team_id, team_name, zillow_url)
            for agent in agents:
                agent.setdefault("team_id", team_id)
                agent.setdefault("Associated Company", team_name)
                agent.setdefault("source", "zillow")
            all_agents.extend(agents)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_agents)

    print(f"Wrote {len(all_agents)} agents to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
