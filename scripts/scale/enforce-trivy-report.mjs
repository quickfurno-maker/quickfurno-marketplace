#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: enforce-trivy-report.mjs <trivy-report.json>");
  process.exit(64);
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const findings = [];

for (const result of report.Results ?? []) {
  for (const vuln of result.Vulnerabilities ?? []) {
    const severity = String(vuln.Severity ?? "").toUpperCase();
    if (severity !== "HIGH" && severity !== "CRITICAL") continue;
    findings.push({
      target: result.Target ?? "unknown",
      id: vuln.VulnerabilityID ?? "unknown",
      package: vuln.PkgName ?? "unknown",
      installed: vuln.InstalledVersion ?? "unknown",
      fixed: vuln.FixedVersion ?? "unknown",
      severity,
      title: vuln.Title ?? "",
    });
  }
}

if (findings.length) {
  console.error("Fixable HIGH/CRITICAL vulnerabilities detected:");
  for (const f of findings) {
    console.error(
      [
        f.severity,
        f.id,
        f.package,
        "installed=" + f.installed,
        "fixed=" + f.fixed,
        "target=" + f.target,
      ].join(" | "),
    );
  }
  process.exit(1);
}

console.log("Trivy policy PASS: no fixable HIGH/CRITICAL vulnerabilities");
