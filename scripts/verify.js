// 所有阶段均实际执行并记录状态；局部检查中的跳过项目不会写成通过。
import * as path from "@std/path";
import { buildArtifacts, commandOutput } from "./release_artifacts.js";
import puppeteer from "npm:puppeteer";

const root = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
Deno.chdir(root);
const skipE2e = Deno.args.includes("--skip-e2e");
const reportIndex = Deno.args.indexOf("--report");
if (
  reportIndex >= 0 && (!Deno.args[reportIndex + 1] || Deno.args[reportIndex + 1].startsWith("--"))
) {
  throw new Error("--report 后必须提供 JSON 报告路径");
}
for (let index = 0; index < Deno.args.length; index++) {
  if (Deno.args[index] === "--report") {
    index++;
    continue;
  }
  if (Deno.args[index] !== "--skip-e2e") throw new Error(`未知参数：${Deno.args[index]}`);
}
const reportFile = reportIndex >= 0 ? path.resolve(Deno.args[reportIndex + 1]) : null;
const report = {
  commit: (await commandOutput("git", ["rev-parse", "HEAD"])).trim(),
  dirty: Boolean((await commandOutput("git", ["status", "--porcelain"])).trim()),
  startedAt: new Date().toISOString(),
  browser: null,
  status: "running",
  stages: [],
};
const executable = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();

async function stage(name, action) {
  console.log(`\n验证阶段：${name}`);
  const start = performance.now();
  try {
    await action();
    report.stages.push({
      name,
      status: "passed",
      durationMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    console.error(`${name} 失败：${error.message}`);
    report.stages.push({
      name,
      status: "failed",
      durationMs: Math.round(performance.now() - start),
      error: error.message,
    });
  }
}

async function run(args, env = {}, timeoutMs = 600000) {
  const child = new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    env: { PUPPETEER_EXECUTABLE_PATH: executable, ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let timedOut = false;
  let forceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch (_) { /* 子进程可能已自行结束。 */ }
    forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) { /* 子进程已经退出。 */ }
    }, 5000);
  }, timeoutMs);
  const status = await child.status.finally(() => {
    clearTimeout(timer);
    clearTimeout(forceTimer);
  });
  if (timedOut) throw new Error(`阶段超过 ${timeoutMs / 1000} 秒，已停止子进程：${args.join(" ")}`);
  if (!status.success) throw new Error(`deno ${args.join(" ")} 退出码 ${status.code}`);
}

await stage("浏览器环境", async () => {
  report.browser = { executable, version: (await commandOutput(executable, ["--version"])).trim() };
  console.log(report.browser.version);
});
for (
  const [name, args] of [
    ["单元测试", ["run", "-A", "make.js", "test-unit"]],
    ["DOM 测试", ["run", "-A", "make.js", "test-dom"]],
    ["BrowserToolbox 适配测试", ["test", "-A", "tests/browser_toolbox/"]],
    ["构建归档测试", ["test", "-A", "tests/build_tests/"]],
    ["本地化一致性", ["run", "--allow-read", "scripts/sync_i18n.js", "--check"]],
    ["静态发布审计", ["run", "-A", "scripts/build_release.js"]],
    ["性能回归", ["run", "-A", "scripts/benchmark_browser_toolbox.js"]],
  ]
) {
  await stage(name, () => run(args));
}

const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-verify-" });
try {
  let artifacts;
  await stage("产物构建与归档校验", async () => {
    artifacts = await buildArtifacts({ root, output: temporary });
    report.artifacts = artifacts;
  });
  for (
    const [name, script] of [
      ["快捷工具 E2E", "scripts/e2e_quick_tools.js"],
      ["BrowserToolbox E2E", "scripts/e2e_browser_toolbox.js"],
    ]
  ) {
    if (skipE2e || !artifacts || !report.browser) {
      report.stages.push({
        name,
        status: "skipped",
        reason: skipE2e ? "用户指定 --skip-e2e" : "浏览器或产物准备失败",
      });
    } else {
      await stage(name, () =>
        run(["run", "-A", script], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: path.join(temporary, "browser-toolbox"),
          BROWSER_TOOLBOX_E2E_HEADLESS: "true",
          // 完整门禁始终创建隔离浏览器，不继承日常或人工验收的 CDP 会话。
          BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
          BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
        }));
    }
  }
} finally {
  await Deno.remove(temporary, { recursive: true });
}
report.finishedAt = new Date().toISOString();
const failed = report.stages.some((entry) => entry.status === "failed");
const skipped = report.stages.some((entry) => entry.status === "skipped");
report.status = failed ? "failed" : skipped ? "partial" : "passed";
for (const entry of report.stages) {
  console.log(
    `${entry.status.toUpperCase()} ${entry.name}${entry.reason ? `：${entry.reason}` : ""}`,
  );
}
if (reportFile) {
  await Deno.mkdir(path.dirname(reportFile), { recursive: true });
  await Deno.writeTextFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`验证报告：${reportFile}`);
}
console.log(
  failed
    ? "验证失败。"
    : skipped
    ? "局部检查结束；存在未执行阶段，不能视为完整门禁通过。"
    : "完整自动化门禁通过；人工平台、屏幕阅读器和商店状态需独立验收。",
);
if (failed) Deno.exit(1);
