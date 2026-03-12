import base64

from fastapi.testclient import TestClient

from parser_service.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_parse_extracts_rows_from_pdf_like_payload() -> None:
    snippet_one = (
        "Student: Jane Doe | Date: 02/11/2026 08:15 AM | Points: 3 | "
        "Reason: Disrespect | Teacher: Mr. Adams | Comment: Talking back in class"
    )
    snippet_two = (
        "Student: John Roe | Date: 02/11/2026 10:02 AM | Points: -1 | "
        "Reason: Tardy | Teacher: Ms. Lane | Comment: Late to class"
    )
    pdf_bytes = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Length 300 >>\nstream\nBT\n"
        + f"({snippet_one}) Tj\n".encode("utf-8")
        + f"({snippet_two}) Tj\n".encode("utf-8")
        + b"ET\nendstream\nendobj\n%%EOF"
    )
    payload = {
        "file_name": "sample.pdf",
        "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
    }
    response = client.post("/parse", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["parser_version"] == "0.2.0"
    assert len(body["records"]) == 2
    first = body["records"][0]
    assert first["student"]["value"] == "Jane Doe"
    assert first["teacher"]["value"] == "Mr. Adams"
    assert first["points"]["value"] == "3"
    assert "missing_student" not in first["warnings"]


def test_parse_marks_missing_critical_fields_as_low_confidence() -> None:
    snippet = (
        "Date: 02/11/2026 | Points: 2 | Reason: Disrespect | "
        "Comment: Shouting in hallway"
    )
    pdf_bytes = (
        b"%PDF-1.4\n1 0 obj\n<< /Length 160 >>\nstream\nBT\n"
        + f"({snippet}) Tj\n".encode("utf-8")
        + b"ET\nendstream\nendobj\n%%EOF"
    )
    payload = {
        "file_name": "sample.pdf",
        "content_base64": base64.b64encode(pdf_bytes).decode("ascii"),
    }
    response = client.post("/parse", json=payload)
    assert response.status_code == 200
    record = response.json()["records"][0]
    assert "missing_student" in record["warnings"]
    assert record["record_confidence"] < 0.8


def test_parse_rejects_invalid_base64() -> None:
    payload = {"file_name": "sample.pdf", "content_base64": "!!not-base64!!"}
    response = client.post("/parse", json=payload)
    assert response.status_code == 400
