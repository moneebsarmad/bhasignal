from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from parser_service.pipeline import parse_document

app = FastAPI(title="Signal Parser Service", version="0.3.0")


class ParseRequest(BaseModel):
    file_name: str = Field(..., min_length=1)
    content_base64: str = Field(..., min_length=1)


class ParsedField(BaseModel):
    value: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class ParseRecord(BaseModel):
    student: ParsedField
    occurred_at: ParsedField
    writeup_date: ParsedField
    points: ParsedField
    reason: ParsedField
    violation: ParsedField
    violation_raw: ParsedField
    level: ParsedField
    teacher: ParsedField
    author_name: ParsedField
    author_name_raw: ParsedField
    comment: ParsedField
    description: ParsedField
    resolution: ParsedField
    source_snippet: str
    record_confidence: float = Field(..., ge=0.0, le=1.0)
    warnings: list[str]


class ParseResponse(BaseModel):
    parser_version: str
    parsed_at: str
    records: list[ParseRecord]
    warnings: list[str]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse", response_model=ParseResponse)
def parse_pdf(request: ParseRequest) -> ParseResponse:
    now = datetime.now(timezone.utc).isoformat()
    try:
        records, warnings = parse_document(request.content_base64)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return ParseResponse(
        parser_version="0.3.0",
        parsed_at=now,
        records=records,
        warnings=warnings,
    )
