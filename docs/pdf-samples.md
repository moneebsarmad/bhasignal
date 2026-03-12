# PDF Samples

Use this file to provide real sample rows from your PDF export and the exact expected parsed output.

Guidelines:
- Add 10-20 cases.
- Include both easy and difficult cases.
- Include some rows that should be ignored (`shouldCreateRow: false`).
- If needed, anonymize names.
- Keep the raw text exactly as it appears after copy/paste from the PDF (or as close as possible).

---

## Case 001

### Raw PDF text
Student: Jane Doe | Date: 02/11/2026 08:15 AM | Points: 3 | Reason: Disrespect | Teacher: Ms Smith | Comment: Talking during instruction

### Expected output
```json
{
  "studentReference": "Jane Doe",
  "occurredAt": "2026-02-11T08:15:00Z",
  "points": 3,
  "reason": "Disrespect",
  "teacherName": "Ms Smith",
  "comment": "Talking during instruction",
  "shouldCreateRow": true,
  "shouldRequireReview": false
}
```

### Notes
Normal, labeled row.

---

## Case 002

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 003

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 004

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 005

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 006

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 007

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 008

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 009

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": true,
  "shouldRequireReview": true
}
```

### Notes
[describe any rule, ambiguity, or special handling]

---

## Case 010

### Raw PDF text
[paste raw text]

### Expected output
```json
{
  "studentReference": "",
  "occurredAt": "",
  "points": 0,
  "reason": "",
  "teacherName": "",
  "comment": "",
  "shouldCreateRow": false,
  "shouldRequireReview": false
}
```

### Notes
Noise/header/footer/example of text that should be ignored.
