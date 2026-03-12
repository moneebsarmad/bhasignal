import {
  fetchSycamoreDisciplineRange,
  fetchSycamoreStudents,
  getSycamoreClientConfigFromEnv
} from "../lib/sycamore-client";

function parseDateArg(): string {
  const flag = process.argv.find((arg) => arg.startsWith("--date="));
  const value = flag?.slice("--date=".length).trim() || process.env.SYCAMORE_PROBE_DATE?.trim();
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const config = getSycamoreClientConfigFromEnv();
  const date = parseDateArg();

  console.log(`Sycamore base URL: ${config.baseUrl}`);
  console.log(`School ID: ${config.schoolId}`);
  console.log(`Probe date: ${date}`);

  const [students, discipline] = await Promise.all([
    fetchSycamoreStudents(config),
    fetchSycamoreDisciplineRange(
      {
        startDate: date,
        endDate: date
      },
      config
    )
  ]);

  console.log(`Students fetched: ${students.length}`);
  console.log(`Discipline rows fetched: ${discipline.records.length}`);
  console.log(`Warnings: ${discipline.warnings.length > 0 ? discipline.warnings.join(", ") : "none"}`);

  if (students[0]) {
    console.log(`Sample student keys: ${Object.keys(students[0]).join(", ")}`);
  }
  if (discipline.records[0]) {
    console.log(`Sample discipline keys: ${Object.keys(discipline.records[0]).join(", ")}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Sycamore probe failed: ${message}`);
  process.exitCode = 1;
});
