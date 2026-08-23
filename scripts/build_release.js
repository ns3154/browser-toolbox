// 可复现发布检查和可选打包入口。默认只检查，不写入发布目录。
import JSON5 from "npm:json5";

const manifest = JSON5.parse(await Deno.readTextFile("manifest.json"));
const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push("版本号格式错误");
if (manifest.name !== "__MSG_extensionName__") errors.push("manifest.name 未使用国际化消息键");
if ((manifest.permissions || []).includes("notifications")) {
  errors.push("不应恢复 notifications 权限");
}
if ((manifest.permissions || []).includes("downloads")) errors.push("downloads 权限需要单独 ADR");
for await (const entry of Deno.readDir(".")) {
  if (!entry.isFile) continue;
  if (/\.pem$|\.key$|\.p12$|\.env$/.test(entry.name)) errors.push(`疑似秘密文件: ${entry.name}`);
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  Deno.exit(1);
}

const command = new Deno.Command("deno", { args: ["run", "-A", "scripts/audit_permissions.js"] });
const permissionAudit = await command.output();
if (!permissionAudit.success) {
  console.error(new TextDecoder().decode(permissionAudit.stderr));
  Deno.exit(permissionAudit.code || 1);
}
const networkAudit = await new Deno.Command("deno", {
  args: ["run", "-A", "scripts/audit_network_usage.js"],
}).output();
if (!networkAudit.success) {
  console.error(new TextDecoder().decode(networkAudit.stderr));
  Deno.exit(networkAudit.code || 1);
}
console.log(`发布检查通过：OpenKeyMouse ${manifest.version}`);

if (Deno.args.includes("--package")) {
  const outputDir = "dist/open-key-mouse";
  await Deno.mkdir(outputDir, { recursive: true });
  const zipName = `dist/open-key-mouse-${manifest.version}.zip`;
  const result = await new Deno.Command("zip", {
    args: [
      "-r",
      "-X",
      "-q",
      zipName,
      ".",
      "-x",
      "./.git/*",
      "./dist/*",
      "./tests/*",
      "./test_harnesses/*",
      "./*.md",
      "./make.js",
      "./deno.json",
      "./deno.lock",
      // 这些审计日志会记录当前归档的哈希；保留在 Git，但排除以避免源码包自引用哈希。
      "./docs/baseline.md",
      "./docs/codex-progress.md",
      "./docs/release-checklist.md",
    ],
  }).output();
  if (!result.success) {
    console.error(new TextDecoder().decode(result.stderr));
    Deno.exit(result.code || 1);
  }
  console.log(`已生成发布包: ${zipName}`);
}
