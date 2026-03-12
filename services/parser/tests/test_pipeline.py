import base64

from parser_service.pipeline import parse_candidate, parse_document, segment_incident_candidates


def _build_pdf(snippets: list[bytes]) -> bytes:
    body = b"".join(b"(" + snippet + b") Tj\n" for snippet in snippets)
    stream = b"BT\n" + body + b"ET\n"
    return (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Length 1200 >>\nstream\n"
        + stream
        + b"endstream\nendobj\n%%EOF"
    )


def test_segment_incident_candidates_skips_noise_lines() -> None:
    text = """
    Discipline Report
    Page 1 of 3
    Student: Jane Doe | Date: 02/11/2026 | Points: 3 | Reason: Disrespect
    Student: John Roe | Date: 02/12/2026 | Points: -1 | Reason: Tardy
    """
    candidates = segment_incident_candidates(text)
    assert len(candidates) == 2
    assert "Jane Doe" in candidates[0]


def test_parse_candidate_extracts_labeled_fields() -> None:
    snippet = (
        "Student: Jane Doe | Date: 02/11/2026 08:15 AM | Points: 3 | "
        "Reason: Disrespect | Teacher: Mr. Adams | Comment: Talking back in class"
    )
    parsed = parse_candidate(snippet)
    assert parsed is not None
    assert parsed["student"]["value"] == "Jane Doe"
    assert parsed["teacher"]["value"] == "Mr. Adams"
    assert parsed["author_name"]["value"] == "Mr. Adams"
    assert parsed["points"]["value"] == "3"
    assert parsed["record_confidence"] > 0.85


def test_segment_incident_candidates_handles_level_anchor_layout() -> None:
    text = """
    Rakan Abu Azab
    Discipline Logs
    Date:
    Violation:
    Level 1: Verbal warnings
    Author:
    Hussein, Nahla
    Points:
    Description:
    Unfortunately, Rakan did not follow the class rules today.
    """
    candidates = segment_incident_candidates(text)
    assert candidates
    level_candidate = next(
        (candidate for candidate in candidates if "Level 1: Verbal warnings" in candidate),
        "",
    )
    assert level_candidate
    parsed = parse_candidate(level_candidate)
    assert parsed is not None
    assert parsed["student"]["value"] == "Rakan Abu Azab"


def test_segment_incident_candidates_handles_sycamore_discipline_log_blocks() -> None:
    text = """
    Discipline Logs
    AbdulRahman Abou Shaar
    Date:08/27/25
    Violation:Level 2: Repeated offenses
    Author:Qureshi, Humza
    Points:5
    Description:
    Extremely disrespectful to teachers and other students.
    Resolution:
    Date:09/04/25
    Violation:Level 2: Horseplay/ Physical Aggression
    Author:Qureshi, Humza
    Points:5
    Description:
    While trying to get the students to settle down, he threw a pencil.
    Resolution:
    """
    candidates = segment_incident_candidates(text)
    assert len(candidates) == 2

    first = parse_candidate(candidates[0])
    second = parse_candidate(candidates[1])
    assert first is not None
    assert second is not None

    assert first["student"]["value"] == "AbdulRahman Abou Shaar"
    assert first["occurred_at"]["value"] == "2025-08-27"
    assert first["writeup_date"]["value"] == "2025-08-27"
    assert first["points"]["value"] == "5"
    assert first["reason"]["value"] == "Repeated offenses"
    assert first["violation"]["value"] == "Repeated offenses"
    assert first["violation_raw"]["value"] == "Level 2: Repeated offenses"
    assert first["level"]["value"] == "2"
    assert first["teacher"]["value"] == "Humza Qureshi"
    assert first["author_name"]["value"] == "Humza Qureshi"
    assert first["author_name_raw"]["value"] == "Qureshi, Humza"
    assert "Extremely disrespectful" in first["comment"]["value"]
    assert "Extremely disrespectful" in first["description"]["value"]
    assert first["resolution"]["value"] == ""

    assert second["student"]["value"] == "AbdulRahman Abou Shaar"
    assert second["occurred_at"]["value"] == "2025-09-04"
    assert second["points"]["value"] == "5"
    assert second["reason"]["value"] == "Horseplay/ Physical Aggression"
    assert second["violation"]["value"] == "Horseplay/ Physical Aggression"
    assert second["level"]["value"] == "2"
    assert second["teacher"]["value"] == "Humza Qureshi"


def test_parse_candidate_extracts_discipline_report_fields() -> None:
    snippet = (
        "Student: Danah Ginawi | Date: 08/15/25 | Violation: Level 2: Disruptive Behavior | "
        "Author: Bou Imajjane, Abir | Points: 3 | Description: Dana is not following any class "
        "rules she talks loudly, she disrupts the other students, and she seems to have no "
        "interest in learning Arabic. I warned her more than three times but nothing changed | "
        "Resolution:"
    )
    parsed = parse_candidate(snippet)
    assert parsed is not None
    assert parsed["student"]["value"] == "Danah Ginawi"
    assert parsed["writeup_date"]["value"] == "2025-08-15"
    assert parsed["author_name_raw"]["value"] == "Bou Imajjane, Abir"
    assert parsed["author_name"]["value"] == "Abir Bou Imajjane"
    assert parsed["teacher"]["value"] == "Abir Bou Imajjane"
    assert parsed["points"]["value"] == "3"
    assert parsed["level"]["value"] == "2"
    assert parsed["violation"]["value"] == "Disruptive Behavior"
    assert parsed["violation_raw"]["value"] == "Level 2: Disruptive Behavior"
    assert parsed["description"]["value"].startswith("Dana is not following any class rules")
    assert parsed["resolution"]["value"] == ""


def test_parse_candidate_normalizes_pipe_delimited_narrative_fields() -> None:
    snippet = (
        "Student: Danah Ginawi | Date:10/13/25 | Violation:Level 2: Disruptive Behavior | "
        "Author:Hamed, Nora | Points:2 | Description: | Danah was continuously talking while "
        "the AI instructor was teaching. | The instructor had to stop class. | "
        "Resolution:I walked over several times to tell Danah to listen."
    )
    parsed = parse_candidate(snippet)
    assert parsed is not None
    assert "|" not in parsed["description"]["value"]
    assert parsed["description"]["value"].startswith("Danah was continuously talking")
    assert parsed["resolution"]["value"] == "I walked over several times to tell Danah to listen."


def test_parse_document_decodes_utf16_pdf_literals() -> None:
    snippet = "Student: Jane Doe | Date: 02/11/2026 | Points: 3 | Reason: Disrespect"
    pdf_bytes = _build_pdf([snippet.encode("utf-16-be")])
    payload = base64.b64encode(pdf_bytes).decode("ascii")
    records, warnings = parse_document(payload)

    assert len(records) == 1
    assert records[0]["student"]["value"] == "Jane Doe"
    assert records[0]["points"]["value"] == "3"
    assert "no_candidate_rows_detected" not in warnings
