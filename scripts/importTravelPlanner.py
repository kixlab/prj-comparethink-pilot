"""Extract a participant-safe TravelPlanner validation problem.

Usage: python3 scripts/importTravelPlanner.py validation.csv validation_ref_info.jsonl COMMIT [ROW_INDEX]
Input files are the official osunlp/TravelPlanner dataset; do not commit raw datasets.
"""
import ast
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys


def extract(csv_path, reference_path, commit, row_index=0):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A full source commit is required")
    csv_bytes = Path(csv_path).read_bytes()
    reference_bytes = Path(reference_path).read_bytes()
    csv.field_size_limit(10_000_000)
    with Path(csv_path).open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    references = [json.loads(line) for line in reference_bytes.decode().splitlines() if line.strip()]
    if len(rows) != len(references) or not 0 <= row_index < len(rows):
        raise ValueError("CSV and reference rows must match, with a valid row index")
    row, reference = rows[row_index], references[row_index]
    descriptions = [section["Description"] for section in ast.literal_eval(row["reference_information"])]
    if list(reference) != descriptions:
        raise ValueError("The selected query and reference section headings do not match")
    if not reference or not row["query"].strip():
        raise ValueError("The query and travel data must be non-empty")
    forbidden = {"annotated_plan", "ground_truth_plan", "reference_plan", "solution", "answer"}
    for title, content in reference.items():
        if not isinstance(title, str) or not isinstance(content, (str, list)):
            raise ValueError("Unsupported reference section")
        if isinstance(content, list):
            for record in content:
                if not isinstance(record, dict) or forbidden.intersection(record):
                    raise ValueError("Unexpected or answer-like reference fields")
                for value in record.values():
                    if not isinstance(value, (str, int, float, bool, type(None))) or isinstance(value, float) and not math.isfinite(value):
                        raise ValueError("Unsupported reference value")
    dates = ast.literal_eval(row["date"])
    fields = {
        "org": row["org"], "dest": row["dest"], "days": int(row["days"]),
        "date": dates, "visiting_city_number": int(row["visiting_city_number"]),
        "people_number": int(row["people_number"]), "budget": int(row["budget"]),
        "level": row["level"], "local_constraint": ast.literal_eval(row["local_constraint"]),
    }
    return {
        "task_id": f"travelplanner-validation-row-{row_index}", "kind": "travelplanner", "version": "1.0.0",
        "title": "TravelPlanner itinerary task", "language": "en",
        "source": {
            "repository": "https://github.com/OSU-NLP-Group/TravelPlanner",
            "dataset": "osunlp/TravelPlanner", "path": "validation.csv", "commit": commit,
            "url": f"https://huggingface.co/datasets/osunlp/TravelPlanner/blob/{commit}/validation.csv",
            "file_sha256": hashlib.sha256(csv_bytes).hexdigest(),
            "instance_id": row_index, "identifier": "zero-based CSV row index", "split": "validation", "row_index": row_index,
            "reference_path": "validation_ref_info.jsonl",
            "reference_file_sha256": hashlib.sha256(reference_bytes).hexdigest(),
            "license": "CC-BY-4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "Jian Xie, Kai Zhang, Jiangjie Chen, Tinghui Zhu, Renze Lou, Yuandong Tian, Yanghua Xiao, and Yu Su. TravelPlanner: A Benchmark for Real-World Planning with Language Agents. ICML 2024. OSU NLP Group, osunlp/TravelPlanner dataset.",
            "changes": [
                f"Selected validation CSV row {row_index} (zero-based), with the identically indexed official JSON reference information.",
                "Preserved the original query, dates, travel options, and reference values; displayed dataset metadata as trip details.",
                "Adapted the official sole-planning setting for a human-AI chat study with manual itinerary submission.",
                "No worked example, annotated plan, reference solution, or evaluation feedback is included.",
                "This is an adapted research task, not a complete TravelPlanner tool environment or leaderboard evaluation.",
            ],
        },
        "description": "Prepare a travel itinerary that meets the request below. You may chat with the AI while working on the task.",
        "participant_instruction": "Read the travel request and the supplied travel data. You may chat with the AI freely while preparing a day-by-day itinerary. Submit your final itinerary yourself when you are finished.",
        "query": row["query"],
        "trip_details": [
            {"label": "Departure", "value": row["org"]}, {"label": "Destination", "value": row["dest"]},
            {"label": "Dates", "value": ", ".join(dates)}, {"label": "Duration", "value": f"{fields['days']} days"},
            {"label": "Travelers", "value": str(fields["people_number"])}, {"label": "Budget", "value": f"${fields['budget']:,}"},
        ],
        "reference_notice": "Use the supplied travel options for this task. The dates and prices are fixed benchmark data. All listed options are available to both you and the AI.",
        "reference_information": reference,
        "final_instruction": "Write and submit your final day-by-day itinerary, including transportation, meals, attractions, and accommodation as applicable. Use the supplied travel data and stay within the requested budget and dates. AI responses are not submitted automatically.",
        "original": {"query": row["query"], "fields": fields},
    }


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        raise SystemExit(__doc__)
    task = extract(*sys.argv[1:4], int(sys.argv[4]) if len(sys.argv) == 5 else 0)
    output = Path(__file__).resolve().parent.parent / "tasks" / f"{task['task_id']}.json"
    output.write_text(json.dumps(task, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Extracted {task['task_id']}; query and {len(task['reference_information'])} travel-data sections, no reference solution.")
