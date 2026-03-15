import { StudentsClient } from "./StudentsClient";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function StudentsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sourceType = readParam(searchParams?.sourceType) === "manual_pdf" ? "manual_pdf" : "sycamore_api";
  const mode = readParam(searchParams?.mode);

  return (
    <StudentsClient
      initialFilters={{
        search: readParam(searchParams?.search).trim(),
        grade: readParam(searchParams?.grade).trim(),
        sourceType
      }}
      initialMode={
        mode === "directory" || mode === "interventions" || mode === "case_file" || mode === "risk"
          ? mode
          : undefined
      }
    />
  );
}
