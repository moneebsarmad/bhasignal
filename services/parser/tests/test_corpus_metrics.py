import base64
import json
from pathlib import Path

from parser_service.pipeline import parse_document


def _build_pdf(snippets: list[str]) -> bytes:
    body = "".join(f"({snippet}) Tj\n" for snippet in snippets)
    stream = f"BT\n{body}ET\n"
    return (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Length 800 >>\nstream\n"
        + stream.encode("utf-8")
        + b"endstream\nendobj\n%%EOF"
    )


def _prefix_match(actual: str, expected: str) -> bool:
    return actual == expected or actual.startswith(expected)


def test_parser_corpus_quality_metrics() -> None:
    fixture_path = Path(__file__).parent / "fixtures" / "corpus.json"
    corpus = json.loads(fixture_path.read_text(encoding="utf-8"))

    total_records = 0
    student_hits = 0
    date_hits = 0
    points_hits = 0
    emitted_records = 0

    for item in corpus:
        pdf_bytes = _build_pdf(item["snippets"])
        payload = base64.b64encode(pdf_bytes).decode("ascii")
        records, _warnings = parse_document(payload)
        expected_rows = item["expected"]

        emitted_records += len(records)
        assert len(records) >= len(expected_rows), f"Parser emitted fewer rows than expected for {item['name']}"

        for idx, expected in enumerate(expected_rows):
            row = records[idx]
            total_records += 1
            if row["student"]["value"] == expected["student"]:
                student_hits += 1
            if _prefix_match(row["occurred_at"]["value"], expected["occurred_at"]):
                date_hits += 1
            if row["points"]["value"] == expected["points"]:
                points_hits += 1

    student_accuracy = student_hits / total_records
    date_accuracy = date_hits / total_records
    points_accuracy = points_hits / total_records

    print(
        json.dumps(
            {
                "records_expected": total_records,
                "records_emitted": emitted_records,
                "student_accuracy": round(student_accuracy, 3),
                "date_accuracy": round(date_accuracy, 3),
                "points_accuracy": round(points_accuracy, 3),
            }
        )
    )

    assert student_accuracy >= 0.95
    assert date_accuracy >= 0.9
    assert points_accuracy >= 0.95
