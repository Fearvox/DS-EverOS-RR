#!/usr/bin/env bun
// TypeScript test runner for all microservices

import { $ } from "bun";

const services = ["auth", "users", "products", "orders", "payments", "notifications", "analytics", "search"];

console.log("=========================================");
console.log("  Microservice Test Suite (Bun)");
console.log("=========================================\n");

let totalPass = 0;
let totalFail = 0;
const results: Array<{ service: string; pass: number; fail: number; time: string }> = [];

for (const svc of services) {
  const start = performance.now();
  const proc = await $`bun test services/${svc}/`.quiet().nothrow();
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  const output = proc.stdout.toString() + proc.stderr.toString();

  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);
  const pass = passMatch ? parseInt(passMatch[1]) : 0;
  const fail = failMatch ? parseInt(failMatch[1]) : 0;

  totalPass += pass;
  totalFail += fail;
  results.push({ service: svc, pass, fail, time: elapsed });

  const status = fail > 0 ? "FAIL" : "PASS";
  console.log(`  [${status}] ${svc.padEnd(15)} ${pass} pass, ${fail} fail (${elapsed}s)`);
}

// Integration tests
const intStart = performance.now();
const intProc = await $`bun test services/integration/`.quiet().nothrow();
const intElapsed = ((performance.now() - intStart) / 1000).toFixed(2);
const intOutput = intProc.stdout.toString() + intProc.stderr.toString();
const intPass = intOutput.match(/(\d+) pass/);
const intFail = intOutput.match(/(\d+) fail/);
const ip = intPass ? parseInt(intPass[1]) : 0;
const iff = intFail ? parseInt(intFail[1]) : 0;
totalPass += ip;
totalFail += iff;
console.log(`  [${iff > 0 ? "FAIL" : "PASS"}] ${"integration".padEnd(15)} ${ip} pass, ${iff} fail (${intElapsed}s)`);

console.log("\n=========================================");
console.log(`  TOTAL: ${totalPass} pass, ${totalFail} fail`);
console.log("=========================================");

if (totalFail > 0) process.exit(1);
