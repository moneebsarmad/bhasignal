import { StudentsClient } from "./StudentsClient";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function StudentsPage({
  searchParams
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const mode = readParam(searchParams?.mode);
  const detailTab = readParam(searchParams?.detailTab);

  return (
    <StudentsClient
      initialFilters={{
        search: readParam(searchParams?.search).trim(),
        grade: readParam(searchParams?.grade).trim(),
        sourceType: "sycamore_api"
      }}
      initialMode={
        mode === "directory" || mode === "interventions" || mode === "case_file" || mode === "risk"
          ? mode
          : undefined
      }
      initialSelectedStudentId={readParam(searchParams?.studentId).trim() || undefined}
      initialDetailTab={
        detailTab === "overview" ||
        detailTab === "incidents" ||
        detailTab === "interventions" ||
        detailTab === "notifications" ||
        detailTab === "audit"
          ? detailTab
          : undefined
      }
    />
  );
}
