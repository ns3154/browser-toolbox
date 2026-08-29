// 审计技术标识迁移边界：旧标识只能出现在兼容迁移、兼容 fixture/测试和历史记录中。

const LEGACY_MARKERS = Object.freeze([
  /openkeymouse/i,
  /open-key-mouse/i,
  /open_key_mouse/i,
]);

const ALLOWED_FILES = new Set([
  "background_scripts/browser_toolbox/settings_migrations.js",
  "background_scripts/browser_toolbox/settings_storage.js",
  "docs/adr/001-fork-vimium.md",
  "docs/adr/004-storage-split.md",
  "docs/baseline.md",
  "docs/codex-progress.md",
  "docs/feature-parity-matrix.md",
  "docs/release-checklist.md",
  "lib/browser_toolbox/settings_validator.js",
  "scripts/audit_technical_rename.js",
  "scripts/e2e_browser_toolbox.js",
  "tests/unit_tests/browser_toolbox/i18n_test.js",
  "tests/unit_tests/browser_toolbox/settings_application_service_test.js",
  "tests/unit_tests/browser_toolbox/settings_migrations_test.js",
  "tests/unit_tests/browser_toolbox/settings_repository_test.js",
  "tests/unit_tests/browser_toolbox/settings_storage_test.js",
]);

function isAllowed(file) {
  return ALLOWED_FILES.has(file);
}

async function collectFiles(directory, result = []) {
  for await (const entry of Deno.readDir(directory)) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory) await collectFiles(path, result);
    else if (entry.isFile) result.push(path);
  }
  return result;
}

const findings = [];
for (const file of await collectFiles(".")) {
  if (isAllowed(file)) continue;
  const lines = (await Deno.readTextFile(file)).split("\n");
  lines.forEach((line, index) => {
    if (LEGACY_MARKERS.some((marker) => marker.test(line))) {
      findings.push(`${file}:${index + 1}`);
    }
  });
}

if (findings.length > 0) {
  console.error("技术标识审计失败：旧 OpenKeyMouse 标识出现在非兼容或非历史文件中：");
  console.error(findings.join("\n"));
  Deno.exit(1);
}

console.log("技术标识审计通过：旧标识仅存在于兼容层、兼容 fixture/测试和历史记录。");
