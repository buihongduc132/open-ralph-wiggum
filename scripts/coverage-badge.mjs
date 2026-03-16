#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const envThreshold = process.env.COVERAGE_THRESHOLD;
const rawThreshold = envThreshold && envThreshold.trim() !== "" ? envThreshold : "80";
const threshold = Number(rawThreshold);
const badgeDir = join(process.cwd(), ".github", "badges");
const badgePath = join(badgeDir, "unit-coverage.svg");

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error(`Invalid COVERAGE_THRESHOLD: ${rawThreshold}. Expected a number between 0 and 100.`);
  process.exit(1);
}

const result = spawnSync("bun", ["test", "--coverage"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const cleanOutput = output.replace(/\x1B\[[0-9;]*m/g, "");
const summaryMatch = cleanOutput.match(/All files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)/);
if (!summaryMatch) {
  console.error("Failed to parse coverage summary from bun test --coverage output.");
  process.exit(1);
}

const funcs = Number(summaryMatch[1]);
const lines = Number(summaryMatch[2]);
const displayValue = `${lines.toFixed(0)}%`;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badgeColor(percent) {
  if (percent >= 90) return "#2ea043";
  if (percent >= 80) return "#3fb950";
  if (percent >= 70) return "#9a6700";
  return "#cf222e";
}

function textWidth(text) {
  return Math.max(40, text.length * 7 + 10);
}

function createBadge(label, value, color) {
  const labelWidth = textWidth(label);
  const valueWidth = textWidth(value);
  const width = labelWidth + valueWidth;
  const labelX = Math.floor(labelWidth / 2);
  const valueX = labelWidth + Math.floor(valueWidth / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#ffffff" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="round">
    <rect width="${width}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="${labelWidth}" height="20" fill="#24292f"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#smooth)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="15">${escapeXml(label)}</text>
    <text x="${valueX}" y="15">${escapeXml(value)}</text>
  </g>
</svg>
`;
}

mkdirSync(badgeDir, { recursive: true });
writeFileSync(badgePath, createBadge("unit coverage", displayValue, badgeColor(lines)));

console.log(`Coverage summary: ${lines.toFixed(2)}% lines, ${funcs.toFixed(2)}% funcs`);
console.log(`Coverage badge written to ${badgePath}`);

if (lines < threshold || funcs < threshold) {
  console.error(`Coverage gate failed. Required at least ${threshold}% for lines and funcs.`);
  process.exit(1);
}
