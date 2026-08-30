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

const secretFilePattern = /(?:^|\.)(?:env|pem|key|p12)$/i;
async function findSecretFiles(directory, relativeDirectory = ".") {
  const secretFiles = [];
  for await (const entry of Deno.readDir(directory)) {
    if ([".git", "dist", "node_modules", "local-development"].includes(entry.name)) continue;
    const filePath = `${directory}/${entry.name}`;
    const relativePath = relativeDirectory === "."
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory) {
      secretFiles.push(...await findSecretFiles(filePath, relativePath));
    } else if (entry.isFile && secretFilePattern.test(entry.name)) {
      secretFiles.push(relativePath);
    }
  }
  return secretFiles;
}

for (const file of await findSecretFiles(".")) {
  errors.push(`疑似秘密文件: ${file}`);
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
const technicalRenameAudit = await new Deno.Command("deno", {
  args: ["run", "-A", "scripts/audit_technical_rename.js"],
}).output();
if (!technicalRenameAudit.success) {
  console.error(new TextDecoder().decode(technicalRenameAudit.stderr));
  Deno.exit(technicalRenameAudit.code || 1);
}
console.log(`发布检查通过：BrowserToolbox ${manifest.version}`);

if (Deno.args.includes("--package")) {
  async function removeExistingArchive(filePath) {
    try {
      await Deno.remove(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  await Deno.mkdir("dist", { recursive: true });
  const zipName = `dist/browser-toolbox-${manifest.version}.zip`;
  // 归档目标可能来自旧的排除规则；先删除精确目标，避免旧条目影响可复现性。
  await removeExistingArchive(zipName);
  const runtimeResult = await new Deno.Command("zip", {
    args: [
      "-r",
      "-X",
      "-q",
      "--filesync",
      zipName,
      ".",
      "-x",
      "./.git",
      "./.git/*",
      "./dist",
      "./dist/*",
      "./tests",
      "./tests/*",
      "./test_harnesses",
      "./test_harnesses/*",
      "./*.md",
      "./make.js",
      "./deno.json",
      "./deno.lock",
      "./docs",
      "./docs/*",
      "./local-development",
      "./local-development/*",
      "./scripts",
      "./scripts/*",
      ".*",
      "./.*",
    ],
  }).output();
  if (!runtimeResult.success) {
    console.error(new TextDecoder().decode(runtimeResult.stderr));
    Deno.exit(runtimeResult.code || 1);
  }
  console.log(`已生成运行时包: ${zipName}`);

  const sourceZipName = `dist/browser-toolbox-source-${manifest.version}.zip`;
  await removeExistingArchive(sourceZipName);
  const sourceExcludes = [
    "./.git",
    "./.git/*",
    "./dist",
    "./dist/*",
    "./node_modules",
    "./node_modules/*",
    // 本机开发设计、竞品截图、UI 设计稿和 Bug 记录不得进入源码包。
    "./local-development",
    "./local-development/*",
    "./.DS_Store",
    "./**/.DS_Store",
  ];
  const sourceResult = await new Deno.Command("zip", {
    args: [
      "-r",
      "-X",
      "-q",
      "--filesync",
      sourceZipName,
      ".",
      "-x",
      ...sourceExcludes,
    ],
  }).output();
  if (!sourceResult.success) {
    console.error(new TextDecoder().decode(sourceResult.stderr));
    Deno.exit(sourceResult.code || 1);
  }
  console.log(`已生成源码包: ${sourceZipName}`);
}
