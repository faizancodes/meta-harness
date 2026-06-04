import type { DoctorReport } from "@metaharness/core";

export function renderDoctor(report: DoctorReport): string {
  const lines = ["metaharness Doctor"];
  for (const provider of report.providers) {
    lines.push(`${provider.registered ? "ok" : "missing"} ${provider.provider}`);
  }
  return lines.join("\n");
}
