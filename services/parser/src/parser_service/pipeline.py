from __future__ import annotations

import base64
import binascii
import re
import zlib
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - parser keeps legacy fallback path when pypdf is unavailable.
    PdfReader = None

DATE_TOKEN_PATTERN = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?"
    r"|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)?)\b"
)
POINTS_LABEL_PATTERN = re.compile(
    r"(?i)\b(?:points?|demerits?|merits?)\b\s*[:=]?\s*([+-]?\d{1,3})\b"
)
NARRATIVE_POINTS_PATTERN = re.compile(
    r"(?i)\b(?:earned|buyback|buy[- ]back|only|got|given)\b[^.]{0,80}\b([+-]?\d{1,3})\s+"
    r"(?:demerit|merit|point)s?\b"
)
GENERIC_POINT_PATTERN = re.compile(r"\b([+-]?\d{1,3})\b")
PAGE_PATTERN = re.compile(r"(?i)\bpage\s+\d+\b")
STREAM_PATTERN = re.compile(rb"stream\r?\n(?P<payload>.*?)\r?\nendstream", re.DOTALL)
LEVEL_ANCHOR_PATTERN = re.compile(r"(?i)\blevel\s+\d+\s*:")
SECTION_ANCHOR_PATTERN = re.compile(
    r"(?i)\b(?:discipline\s+logs?|detentions?|teacher\s+intervention|verbal\s+warnings?)\b"
)
HARD_BREAK_PATTERN = re.compile(r"(?i)\b(?:total\s+points|detentions?)\b")
DATE_LINE_PATTERN = re.compile(r"(?i)^date\s*:")

LABEL_GUARD = (
    r"(?:student(?:\s+name)?|date(?:[\s/]*time)?|time|points?|demerits?|merits?|"
    r"reason|violation|teacher|staff|author|recorded\s+by|entered\s+by|"
    r"comment|comments|note|notes|details?|description|resolution|level)"
)

FIELD_LOW_CONFIDENCE_THRESHOLD = 0.75
RECORD_LOW_CONFIDENCE_THRESHOLD = 0.85


@dataclass
class ExtractedField:
    value: str
    confidence: float


def parse_document(content_base64: str) -> tuple[list[dict[str, object]], list[str]]:
    pdf_bytes = _decode_base64(content_base64)
    extracted_text, extraction_warnings = extract_pdf_text(pdf_bytes)

    warnings = list(extraction_warnings)
    if not extracted_text.strip():
        warnings.append("no_text_extracted")
        return [], _unique(warnings)

    candidates = segment_incident_candidates(extracted_text)
    if not candidates:
        warnings.append("no_candidate_rows_detected")
        return [], _unique(warnings)

    records: list[dict[str, object]] = []
    for candidate in candidates:
        parsed = parse_candidate(candidate)
        if parsed is None:
            continue
        records.append(parsed)

    if not records:
        warnings.append("no_incident_rows_detected")

    warnings.append(f"candidates_scanned:{len(candidates)}")
    warnings.append(f"records_emitted:{len(records)}")
    return records, _unique(warnings)


def _decode_base64(content_base64: str) -> bytes:
    try:
        decoded = base64.b64decode(content_base64, validate=True)
    except binascii.Error as error:
        raise ValueError("Invalid base64 payload for PDF content.") from error

    if not decoded:
        raise ValueError("PDF payload is empty.")
    return decoded


def extract_pdf_text(pdf_bytes: bytes) -> tuple[str, list[str]]:
    warnings: list[str] = []
    pypdf_fragments, pypdf_warnings = _extract_text_with_pypdf(pdf_bytes)
    warnings.extend(pypdf_warnings)
    if pypdf_fragments:
        normalized = [_normalize_whitespace(fragment) for fragment in pypdf_fragments if fragment.strip()]
        return "\n".join(_dedupe_consecutive(normalized)), _unique(warnings)

    fragments: list[str] = []

    if b"%PDF" in pdf_bytes[:1024]:
        for payload in _iter_pdf_payloads(pdf_bytes):
            for fragment in _iter_literal_text(payload):
                if _is_likely_text_fragment(fragment):
                    fragments.append(fragment)
    else:
        warnings.append("payload_missing_pdf_header")

    if not fragments:
        warnings.append("text_extraction_fallback_used")
        fallback_text = _extract_printable_text(pdf_bytes)
        fragments.extend([line for line in fallback_text.splitlines() if line.strip()])

    normalized = [_normalize_whitespace(fragment) for fragment in fragments if fragment.strip()]
    return "\n".join(_dedupe_consecutive(normalized)), _unique(warnings)


def _extract_text_with_pypdf(pdf_bytes: bytes) -> tuple[list[str], list[str]]:
    warnings: list[str] = []
    if PdfReader is None:
        return [], warnings

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
    except Exception:
        warnings.append("pypdf_open_failed")
        return [], warnings

    fragments: list[str] = []
    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
        except Exception:
            warnings.append("pypdf_page_extract_failed")
            continue
        for line in page_text.splitlines():
            normalized = _normalize_whitespace(line)
            if normalized and _is_likely_text_fragment(normalized):
                fragments.append(normalized)

    if not fragments:
        warnings.append("pypdf_no_text")
    return fragments, _unique(warnings)


def _iter_pdf_payloads(pdf_bytes: bytes) -> list[bytes]:
    payloads: list[bytes] = []
    seen: set[bytes] = set()

    for match in STREAM_PATTERN.finditer(pdf_bytes):
        raw = match.group("payload").strip(b"\r\n")
        if raw and raw not in seen:
            seen.add(raw)
            payloads.append(raw)

        for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
            try:
                uncompressed = zlib.decompress(raw, wbits=wbits)
            except zlib.error:
                continue
            normalized = uncompressed.strip(b"\r\n")
            if normalized and normalized not in seen:
                seen.add(normalized)
                payloads.append(normalized)

    return payloads


def _iter_literal_text(payload: bytes) -> list[str]:
    values: list[str] = []
    for literal in _iter_pdf_literal_bytes(payload):
        decoded = _decode_pdf_text(literal)
        normalized = _normalize_whitespace(decoded)
        if normalized:
            values.append(normalized)
    return values


def _iter_pdf_literal_bytes(payload: bytes) -> list[bytes]:
    values: list[bytes] = []
    index = 0
    limit = len(payload)

    while index < limit:
        if payload[index] != 0x28:  # "("
            index += 1
            continue

        index += 1
        depth = 1
        buffer = bytearray()

        while index < limit and depth > 0:
            current = payload[index]

            if current == 0x5C:  # "\"
                index += 1
                if index >= limit:
                    break
                escaped = payload[index]
                if escaped in (ord("n"), ord("r"), ord("t"), ord("b"), ord("f")):
                    mapping = {
                        ord("n"): b"\n",
                        ord("r"): b"\r",
                        ord("t"): b"\t",
                        ord("b"): b"\b",
                        ord("f"): b"\f",
                    }
                    buffer.extend(mapping[escaped])
                elif escaped in (0x28, 0x29, 0x5C):
                    buffer.append(escaped)
                elif escaped in (0x0D, 0x0A):
                    if escaped == 0x0D and index + 1 < limit and payload[index + 1] == 0x0A:
                        index += 1
                elif 0x30 <= escaped <= 0x37:
                    octal_digits = [escaped]
                    for _ in range(2):
                        if index + 1 < limit and 0x30 <= payload[index + 1] <= 0x37:
                            index += 1
                            octal_digits.append(payload[index])
                        else:
                            break
                    buffer.append(int(bytes(octal_digits), 8))
                else:
                    buffer.append(escaped)
            elif current == 0x28:
                depth += 1
                buffer.append(current)
            elif current == 0x29:
                depth -= 1
                if depth > 0:
                    buffer.append(current)
            else:
                buffer.append(current)

            index += 1

        if buffer:
            values.append(bytes(buffer))

    return values


def _decode_pdf_text(raw: bytes) -> str:
    if not raw:
        return ""

    # Many Sycamore exports encode literal strings as UTF-16 (with null bytes between letters).
    if raw.startswith(b"\xfe\xff") or raw.startswith(b"\xff\xfe"):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass

    null_ratio = raw.count(b"\x00") / len(raw)
    if null_ratio >= 0.15 and len(raw) >= 4:
        decoded_utf16_be = _decode_with_fallback(raw, "utf-16-be")
        decoded_utf16_le = _decode_with_fallback(raw, "utf-16-le")
        if _text_quality_score(decoded_utf16_be) >= _text_quality_score(decoded_utf16_le):
            return decoded_utf16_be
        return decoded_utf16_le

    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="ignore")


def _extract_printable_text(payload: bytes) -> str:
    matches = re.findall(rb"[A-Za-z][A-Za-z0-9 ,.;:'\"/#()+-]{4,}", payload)
    fragments = [_normalize_whitespace(match.decode("latin-1", errors="ignore")) for match in matches]
    return "\n".join(fragment for fragment in fragments if fragment)


def segment_incident_candidates(text: str) -> list[str]:
    lines = [_normalize_whitespace(line) for line in text.splitlines()]
    lines = [line for line in lines if line and not _is_noise_line(line)]

    date_block_candidates = _segment_from_date_blocks(lines)
    if date_block_candidates and _parseable_candidate_ratio(date_block_candidates) >= 0.8:
        return _unique(date_block_candidates)

    candidates: list[str] = []
    buffer = ""

    for line in lines:
        if _is_candidate_anchor(line):
            if buffer:
                candidates.append(buffer)
            buffer = line
            continue

        if buffer and _line_has_signal(line):
            buffer = f"{buffer} | {line}"
            continue

        if buffer:
            candidates.append(buffer)
            buffer = ""

        if _line_has_signal(line):
            buffer = line

    if buffer:
        candidates.append(buffer)

    current_parseable_ratio = _parseable_candidate_ratio(candidates)
    if not candidates or current_parseable_ratio < 0.5:
        level_candidates = _segment_from_level_anchors(lines)
        level_parseable_ratio = _parseable_candidate_ratio(level_candidates)
        if level_candidates and (not candidates or level_parseable_ratio >= current_parseable_ratio):
            candidates = level_candidates

    if not candidates:
        blocks = [_normalize_whitespace(block) for block in re.split(r"\n{2,}", text)]
        candidates = [block for block in blocks if block and _line_has_signal(block)]

    return _unique(candidates)


def _parseable_candidate_ratio(candidates: list[str]) -> float:
    if not candidates:
        return 0.0

    parseable = 0
    for candidate in candidates:
        parsed = parse_candidate(candidate)
        if parsed is None:
            continue
        if (
            parsed["student"]["value"]
            or parsed["occurred_at"]["value"]
            or parsed["points"]["value"]
        ):
            parseable += 1
    return parseable / len(candidates)


def parse_candidate(snippet: str) -> dict[str, object] | None:
    normalized = _normalize_whitespace(snippet)
    if len(normalized) < 8:
        return None

    student = _extract_student(normalized)
    occurred_at = _extract_occurred_at(normalized)
    writeup_date = _to_date_only_field(occurred_at)
    points = _extract_points(normalized)
    violation_raw = _extract_reason(normalized)
    level = _extract_level(normalized, violation_raw)
    violation = _extract_violation(normalized, violation_raw)
    reason = ExtractedField(
        value=violation.value or violation_raw.value,
        confidence=max(violation.confidence, violation_raw.confidence),
    )
    author_name_raw = _extract_teacher(normalized, student.value)
    author_name = _normalize_author_field(author_name_raw)
    teacher = ExtractedField(
        value=author_name.value or author_name_raw.value,
        confidence=author_name.confidence if author_name.value else author_name_raw.confidence,
    )
    description = _extract_comment(normalized, reason.value)
    comment = description
    resolution = _extract_resolution(normalized)

    if not student.value and not occurred_at.value and not points.value:
        return None

    record_confidence = _score_record(student, occurred_at, points, reason, teacher, comment)
    warnings = _build_record_warnings(
        student=student,
        occurred_at=occurred_at,
        points=points,
        reason=reason,
        teacher=teacher,
        comment=comment,
        record_confidence=record_confidence,
    )

    return {
        "student": {"value": student.value, "confidence": student.confidence},
        "occurred_at": {"value": occurred_at.value, "confidence": occurred_at.confidence},
        "writeup_date": {"value": writeup_date.value, "confidence": writeup_date.confidence},
        "points": {"value": points.value, "confidence": points.confidence},
        "reason": {"value": reason.value, "confidence": reason.confidence},
        "violation": {"value": violation.value, "confidence": violation.confidence},
        "violation_raw": {"value": violation_raw.value, "confidence": violation_raw.confidence},
        "level": {"value": level.value, "confidence": level.confidence},
        "teacher": {"value": teacher.value, "confidence": teacher.confidence},
        "author_name": {"value": author_name.value, "confidence": author_name.confidence},
        "author_name_raw": {"value": author_name_raw.value, "confidence": author_name_raw.confidence},
        "comment": {"value": comment.value, "confidence": comment.confidence},
        "description": {"value": description.value, "confidence": description.confidence},
        "resolution": {"value": resolution.value, "confidence": resolution.confidence},
        "source_snippet": normalized,
        "record_confidence": record_confidence,
        "warnings": warnings,
    }


def _extract_student(snippet: str) -> ExtractedField:
    labeled = _extract_labeled(snippet, r"student(?:\s+name)?")
    if labeled:
        confidence = 0.98 if _looks_like_name(labeled) else 0.78
        return ExtractedField(value=labeled, confidence=confidence)

    narrative_match = re.search(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\s+was\b", snippet)
    if narrative_match:
        value = _normalize_whitespace(narrative_match.group(1))
        if value and not _has_keyword(value) and value.lower() not in {"he", "she", "they", "student"}:
            return ExtractedField(value=value, confidence=0.58)

    for segment in _split_segments(snippet):
        if _looks_like_name(segment) and not _has_keyword(segment):
            return ExtractedField(value=segment, confidence=0.84)

    return ExtractedField(value="", confidence=0.0)


def _extract_occurred_at(snippet: str) -> ExtractedField:
    match = DATE_TOKEN_PATTERN.search(snippet)
    if not match:
        return ExtractedField(value="", confidence=0.0)

    token = match.group(0)
    parsed = _parse_datetime_token(token)
    if parsed:
        confidence = 0.95 if "T" in parsed else 0.9
        return ExtractedField(value=parsed, confidence=confidence)

    return ExtractedField(value=token, confidence=0.72)


def _to_date_only_field(occurred_at: ExtractedField) -> ExtractedField:
    if not occurred_at.value:
        return ExtractedField(value="", confidence=0.0)
    if "T" in occurred_at.value:
        return ExtractedField(value=occurred_at.value.split("T", 1)[0], confidence=occurred_at.confidence)
    return ExtractedField(value=occurred_at.value, confidence=occurred_at.confidence)


def _extract_points(snippet: str) -> ExtractedField:
    labeled = POINTS_LABEL_PATTERN.search(snippet)
    if labeled:
        value = _normalize_points(labeled.group(1))
        return ExtractedField(value=value, confidence=0.97)

    without_date = DATE_TOKEN_PATTERN.sub(" ", snippet)
    without_date = re.sub(r"(?i)\blevel\s+[+-]?\d+\b", " ", without_date)

    for segment in _split_segments(without_date):
        if not GENERIC_POINT_PATTERN.fullmatch(segment):
            continue
        value = _normalize_points(segment)
        try:
            numeric = abs(int(value))
        except ValueError:
            numeric = 999
        confidence = 0.78 if numeric <= 25 else 0.62
        return ExtractedField(value=value, confidence=confidence)

    narrative_match = NARRATIVE_POINTS_PATTERN.search(snippet)
    if narrative_match:
        value = _normalize_points(narrative_match.group(1))
        return ExtractedField(value=value, confidence=0.7)

    return ExtractedField(value="", confidence=0.0)


def _extract_reason(snippet: str) -> ExtractedField:
    labeled = _extract_labeled(snippet, r"reason|violation|infraction|category")
    if labeled:
        return ExtractedField(value=labeled, confidence=0.94)

    for segment in _split_segments(snippet):
        lowered = segment.lower()
        if DATE_TOKEN_PATTERN.search(segment):
            continue
        if GENERIC_POINT_PATTERN.fullmatch(segment.strip()):
            continue
        if _looks_like_name(segment):
            continue
        if SECTION_ANCHOR_PATTERN.search(segment):
            continue
        normalized_token = segment.lower().strip(" :")
        if normalized_token in {
            "discipline logs",
            "date",
            "violation",
            "author",
            "points",
            "description",
            "resolution",
        }:
            continue
        if any(token in lowered for token in ("comment", "note", "teacher", "student")):
            continue
        if len(segment) <= 80:
            return ExtractedField(value=segment, confidence=0.74)

    return ExtractedField(value="", confidence=0.0)


def _extract_level(snippet: str, violation_raw: ExtractedField) -> ExtractedField:
    labeled_level = _extract_labeled(snippet, r"level")
    if labeled_level:
        digits = re.search(r"[+-]?\d+", labeled_level)
        if digits:
            return ExtractedField(value=str(int(digits.group(0))), confidence=0.97)

    if violation_raw.value:
        match = re.search(r"(?i)\blevel\s*([+-]?\d+)\b", violation_raw.value)
        if match:
            return ExtractedField(value=str(int(match.group(1))), confidence=min(0.99, violation_raw.confidence))

    return ExtractedField(value="", confidence=0.0)


def _extract_violation(snippet: str, violation_raw: ExtractedField) -> ExtractedField:
    if violation_raw.value:
        match = re.match(r"(?i)^\s*level\s*[+-]?\d+\s*[:\-]\s*(.+)$", violation_raw.value)
        if match:
            return ExtractedField(
                value=_normalize_whitespace(match.group(1)),
                confidence=min(0.99, violation_raw.confidence),
            )
        return ExtractedField(value=violation_raw.value, confidence=violation_raw.confidence)

    labeled = _extract_labeled(snippet, r"violation|reason|infraction|category")
    if labeled:
        return ExtractedField(value=labeled, confidence=0.9)

    return ExtractedField(value="", confidence=0.0)


def _extract_teacher(snippet: str, student_name: str) -> ExtractedField:
    labeled = _extract_labeled(snippet, r"teacher|staff|author|recorded\s+by|entered\s+by")
    if labeled:
        confidence = 0.97 if _looks_like_name(labeled) else 0.72
        return ExtractedField(value=labeled, confidence=confidence)

    by_match = re.search(r"(?i)\b(?:by|teacher|staff)\b[:\s-]+([A-Za-z][A-Za-z .'-]{2,})", snippet)
    if by_match:
        value = _normalize_whitespace(by_match.group(1))
        if value and value != student_name:
            return ExtractedField(value=value, confidence=0.68)

    for segment in _split_segments(snippet):
        if segment == student_name:
            continue
        if any(title in segment.lower() for title in ("mr.", "ms.", "mrs.", "dr.", "coach")):
            return ExtractedField(value=segment, confidence=0.65)

    return ExtractedField(value="", confidence=0.0)


def _normalize_author_field(author_name_raw: ExtractedField) -> ExtractedField:
    if not author_name_raw.value:
        return ExtractedField(value="", confidence=0.0)

    normalized = _normalize_author_name(author_name_raw.value)
    confidence = author_name_raw.confidence if normalized == author_name_raw.value else max(
        0.88, min(author_name_raw.confidence, 0.98)
    )
    return ExtractedField(value=normalized, confidence=confidence)


def _extract_comment(snippet: str, reason: str) -> ExtractedField:
    labeled = _extract_labeled_value(snippet, r"comment|comments|note|notes|details?|description")
    if labeled is not None:
        if labeled == "":
            return ExtractedField(value="", confidence=1.0)
        return ExtractedField(value=labeled, confidence=0.95)

    candidates = []
    for segment in _split_segments(snippet):
        lowered = segment.lower()
        if segment == reason:
            continue
        if DATE_TOKEN_PATTERN.search(segment):
            continue
        if GENERIC_POINT_PATTERN.fullmatch(segment):
            continue
        if any(token in lowered for token in ("student", "teacher", "reason", "points", "demerit", "merit")):
            continue
        if _looks_like_name(segment):
            continue
        candidates.append(segment)

    if candidates:
        longest = max(candidates, key=len)
        confidence = 0.72 if len(longest) >= 10 else 0.58
        return ExtractedField(value=_normalize_field_text(longest), confidence=confidence)

    return ExtractedField(value="", confidence=0.2)


def _extract_resolution(snippet: str) -> ExtractedField:
    labeled = _extract_labeled_value(snippet, r"resolution")
    if labeled is None:
        return ExtractedField(value="", confidence=0.0)
    if labeled == "":
        return ExtractedField(value="", confidence=1.0)
    return ExtractedField(value=labeled, confidence=0.95)


def _extract_labeled(snippet: str, labels: str) -> str:
    extracted = _extract_labeled_value(snippet, labels)
    return extracted or ""


def _extract_labeled_value(snippet: str, labels: str) -> str | None:
    pattern = re.compile(
        rf"(?i)\b(?:{labels})\b\s*[:=]\s*(.*?)(?=(?:\s*\|\s*)?\b{LABEL_GUARD}\b\s*[:=]|$)"
    )
    match = pattern.search(snippet)
    if not match:
        return None
    return _normalize_field_text(match.group(1))


def _split_segments(snippet: str) -> list[str]:
    parts = re.split(r"\s*\|\s*|\t+| {2,}", snippet)
    return [_normalize_whitespace(part.strip(" |-")) for part in parts if _normalize_whitespace(part)]


def _parse_datetime_token(token: str) -> str | None:
    formats = [
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
        "%m/%d/%Y",
        "%m-%d-%Y %I:%M %p",
        "%m-%d-%Y %H:%M:%S",
        "%m-%d-%Y %H:%M",
        "%m-%d-%Y",
        "%m/%d/%y %I:%M %p",
        "%m/%d/%y %H:%M:%S",
        "%m/%d/%y %H:%M",
        "%m/%d/%y",
        "%m-%d-%y %I:%M %p",
        "%m-%d-%y %H:%M:%S",
        "%m-%d-%y %H:%M",
        "%m-%d-%y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ]

    normalized = token.replace("  ", " ").strip()
    for fmt in formats:
        try:
            parsed = datetime.strptime(normalized, fmt)
        except ValueError:
            continue
        if "H" in fmt or "I" in fmt:
            return parsed.strftime("%Y-%m-%dT%H:%M:%S")
        return parsed.strftime("%Y-%m-%d")

    return None


def _normalize_points(raw_points: str) -> str:
    return str(int(raw_points))


def _normalize_author_name(value: str) -> str:
    normalized = _normalize_whitespace(value)
    if not normalized or "," not in normalized:
        return normalized

    parts = [part.strip() for part in normalized.split(",") if part.strip()]
    if len(parts) < 2:
        return normalized

    last_name = parts[0]
    first_name_parts = parts[1:]
    return _normalize_whitespace(" ".join([*first_name_parts, last_name]))


def _looks_like_name(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return False
    if any(char.isdigit() for char in value):
        return False
    if any(char in stripped for char in (";", ":", "?", "!", "/")):
        return False

    tokens = re.findall(r"[A-Za-z][A-Za-z.'-]*", value)
    if not (2 <= len(tokens) <= 5):
        return False
    if not all(len(token) >= 2 for token in tokens):
        return False

    blocked = {
        "discipline",
        "logs",
        "student",
        "class",
        "level",
        "description",
        "resolution",
        "detentions",
        "intervention",
        "warning",
        "principal",
        "school",
    }
    connectors = {"al", "el", "bin", "bint", "ibn", "de", "da", "del", "van", "von", "la", "le"}

    uppercase_token_count = 0
    for token in tokens:
        lowered = token.lower().strip(".")
        if lowered in blocked:
            return False
        if token[0].isupper():
            uppercase_token_count += 1
            continue
        if lowered in connectors:
            continue
        return False

    return uppercase_token_count >= 2


def _has_keyword(value: str) -> bool:
    lowered = value.lower()
    return any(
        keyword in lowered
        for keyword in (
            "student",
            "date",
            "time",
            "point",
            "demerit",
            "merit",
            "reason",
            "violation",
            "comment",
            "teacher",
            "staff",
            "author",
            "discipline",
            "detention",
            "warning",
            "intervention",
            "monitor",
        )
    )


def _line_has_signal(line: str) -> bool:
    score = 0
    lowered = line.lower()
    if DATE_TOKEN_PATTERN.search(line):
        score += 2
    if POINTS_LABEL_PATTERN.search(line) or re.search(r"[|].*?[+-]?\d{1,2}\b", line):
        score += 1
    if any(token in lowered for token in ("demerit", "merit", "reason", "violation")):
        score += 1
    if any(token in lowered for token in ("student", "teacher", "comment", "notes")):
        score += 1
    if LEVEL_ANCHOR_PATTERN.search(line) or SECTION_ANCHOR_PATTERN.search(line):
        score += 1
    if _looks_like_name(line) and not _has_keyword(line):
        score += 1
    return score >= 2


def _is_candidate_anchor(line: str) -> bool:
    return bool(
        DATE_TOKEN_PATTERN.search(line)
        or re.search(r"(?i)^student(?:\s+name)?\s*:\s*\S+", line)
        or re.search(r"(?i)^date(?:[\s/]*time)?\s*:\s*\S+", line)
        or LEVEL_ANCHOR_PATTERN.search(line)
    )


def _is_noise_line(line: str) -> bool:
    lowered = line.lower()
    if len(line) < 3:
        return True
    if _non_ascii_ratio(line) > 0.4:
        return True
    if PAGE_PATTERN.search(lowered):
        return True
    if lowered in {"sycamore", "discipline", "discipline report"}:
        return True
    if lowered.startswith("generated on"):
        return True
    return False


def _score_record(
    student: ExtractedField,
    occurred_at: ExtractedField,
    points: ExtractedField,
    reason: ExtractedField,
    teacher: ExtractedField,
    comment: ExtractedField,
) -> float:
    weighted = (
        student.confidence * 0.25
        + occurred_at.confidence * 0.25
        + points.confidence * 0.25
        + reason.confidence * 0.15
        + teacher.confidence * 0.05
        + comment.confidence * 0.05
    )
    if not student.value or not occurred_at.value or not points.value:
        weighted = min(weighted, 0.49)
    return round(min(max(weighted, 0.0), 1.0), 2)


def _build_record_warnings(
    *,
    student: ExtractedField,
    occurred_at: ExtractedField,
    points: ExtractedField,
    reason: ExtractedField,
    teacher: ExtractedField,
    comment: ExtractedField,
    record_confidence: float,
) -> list[str]:
    warnings: list[str] = []
    fields = {
        "student": student,
        "occurred_at": occurred_at,
        "points": points,
        "reason": reason,
        "teacher": teacher,
        "comment": comment,
    }

    for field_name, field in fields.items():
        if not field.value:
            warnings.append(f"missing_{field_name}")
            continue
        if field.confidence < FIELD_LOW_CONFIDENCE_THRESHOLD:
            warnings.append(f"low_confidence_{field_name}")

    if record_confidence < RECORD_LOW_CONFIDENCE_THRESHOLD:
        warnings.append("record_low_confidence")

    return _unique(warnings)


def _is_likely_text_fragment(value: str) -> bool:
    if len(value) < 2:
        return False
    if not re.search(r"[A-Za-z]", value):
        return False
    return _text_quality_score(value) >= 0.4


def _normalize_whitespace(value: str) -> str:
    cleaned = value.replace("\x00", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_field_text(value: str) -> str:
    cleaned = _normalize_whitespace(value.replace("|", " "))
    return cleaned.strip("| ")


def _decode_with_fallback(raw: bytes, encoding: str) -> str:
    try:
        return raw.decode(encoding)
    except UnicodeDecodeError:
        return raw.decode(encoding, errors="ignore")


def _text_quality_score(value: str) -> float:
    if not value:
        return 0.0

    cleaned = value.replace("\x00", "")
    if not cleaned:
        return 0.0

    printable = sum(1 for char in cleaned if char.isprintable() and char not in "\x0b\x0c")
    alpha = sum(1 for char in cleaned if char.isalpha())
    alnum = sum(1 for char in cleaned if char.isalnum())
    high_code = sum(1 for char in cleaned if ord(char) >= 128)

    length = len(cleaned)
    printable_ratio = printable / length
    alpha_ratio = alpha / length
    alnum_ratio = alnum / length
    high_code_ratio = high_code / length

    score = printable_ratio * 0.55 + alpha_ratio * 0.3 + alnum_ratio * 0.2 - high_code_ratio * 0.25
    return max(0.0, min(score, 1.0))


def _non_ascii_ratio(value: str) -> float:
    if not value:
        return 0.0
    non_ascii = sum(1 for char in value if ord(char) > 126)
    return non_ascii / len(value)


def _segment_from_level_anchors(lines: list[str]) -> list[str]:
    if not lines:
        return []

    anchors = [idx for idx, line in enumerate(lines) if _is_level_or_section_anchor(line)]
    if not anchors:
        return []

    candidates: list[str] = []
    for position, anchor_idx in enumerate(anchors):
        start = max(anchor_idx - 2, 0)
        # Pull student context from nearby preceding lines when available.
        for probe in range(anchor_idx - 1, max(anchor_idx - 6, -1), -1):
            if _looks_like_name(lines[probe]) and not _has_keyword(lines[probe]):
                start = probe
                break

        next_anchor = anchors[position + 1] if position + 1 < len(anchors) else len(lines)
        end = min(next_anchor, anchor_idx + 16)

        snippet_lines: list[str] = []
        for line in lines[start:end]:
            if HARD_BREAK_PATTERN.search(line) and len(snippet_lines) >= 3:
                break
            if _text_quality_score(line) < 0.45:
                continue
            if _non_ascii_ratio(line) > 0.25:
                continue
            snippet_lines.append(line)

        snippet = " | ".join(_unique(snippet_lines))
        if snippet and _line_has_signal(snippet):
            candidates.append(snippet)

    return _unique(candidates)


def _segment_from_date_blocks(lines: list[str]) -> list[str]:
    if not lines:
        return []

    date_indexes = [idx for idx, line in enumerate(lines) if DATE_LINE_PATTERN.search(line)]
    if len(date_indexes) < 2:
        return []

    student_name = _infer_student_from_header(lines, date_indexes[0])
    candidates: list[str] = []

    for position, start in enumerate(date_indexes):
        end = date_indexes[position + 1] if position + 1 < len(date_indexes) else len(lines)
        block_lines = [line for line in lines[start:end] if not _is_noise_line(line)]
        if not block_lines:
            continue

        snippet = " | ".join(block_lines)
        lowered = snippet.lower()
        if "violation:" not in lowered or "points:" not in lowered:
            continue

        if student_name and not re.search(r"(?i)\bstudent(?:\s+name)?\s*:", snippet):
            snippet = f"Student: {student_name} | {snippet}"

        candidates.append(_normalize_whitespace(snippet))

    return _unique(candidates)


def _infer_student_from_header(lines: list[str], first_date_idx: int) -> str:
    search_end = min(max(first_date_idx, 1), len(lines))
    for idx in range(search_end):
        line = lines[idx]
        if not re.search(r"(?i)^discipline\s+logs?\b", line):
            continue
        for probe in range(idx + 1, min(idx + 6, search_end)):
            candidate = lines[probe]
            if _looks_like_name(candidate) and not _has_keyword(candidate):
                return candidate

    for probe in range(max(0, first_date_idx - 5), first_date_idx):
        candidate = lines[probe]
        if _looks_like_name(candidate) and not _has_keyword(candidate):
            return candidate

    return ""


def _is_level_or_section_anchor(line: str) -> bool:
    return bool(LEVEL_ANCHOR_PATTERN.search(line) or SECTION_ANCHOR_PATTERN.search(line))


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_values: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        unique_values.append(value)
    return unique_values


def _dedupe_consecutive(values: list[str]) -> list[str]:
    deduped: list[str] = []
    previous = ""
    for value in values:
        if value == previous:
            continue
        deduped.append(value)
        previous = value
    return deduped
