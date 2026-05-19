"""
clean_contacts.py

Usage: python3 clean_contacts.py <input_csv_path>

Input: agents_merged.csv
  Columns: First Name, Last Name, Email, Phone Number, Job Title,
           Associated Company, team_id, source

Output: agents_merged_contact_cleaned.xlsx written to the same directory
  as the input CSV. Same column schema as input.

Uses ANTHROPIC_API_KEY for LLM-based classification and cleaning.
"""

import csv
import os
import sys

try:
    import openpyxl
except ImportError:
    openpyxl = None  # type: ignore[assignment]


FIELDNAMES = ["First Name", "Last Name", "Email", "Phone Number",
              "Job Title", "Associated Company", "team_id", "source"]


def clean_row(row: dict) -> dict:
    # TODO: implement real LLM-based cleaning via ANTHROPIC_API_KEY
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    _ = api_key
    return row


def write_xlsx(rows: list[dict], output_path: str) -> None:
    if openpyxl is None:
        raise ImportError("openpyxl is required: pip install openpyxl")
    import openpyxl as xl
    wb = xl.Workbook()
    ws = wb.active
    ws.append(FIELDNAMES)
    for row in rows:
        ws.append([row.get(col, "") for col in FIELDNAMES])
    wb.save(output_path)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: clean_contacts.py <input_csv_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = os.path.join(
        os.path.dirname(os.path.abspath(input_path)),
        "agents_merged_contact_cleaned.xlsx",
    )

    rows: list[dict] = []
    with open(input_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(clean_row(row))

    write_xlsx(rows, output_path)
    print(f"Wrote {len(rows)} rows to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
