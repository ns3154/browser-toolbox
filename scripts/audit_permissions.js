// Manifest 权限和扩展页面安全审计。该脚本只读仓库文件，不访问网络、不修改文件。
import JSON5 from "npm:json5";

const manifest = JSON5.parse(await Deno.readTextFile("manifest.json"));
const forbiddenPermissions = new Set([
  "management",
  "cookies",
  "webRequest",
  "webRequestBlocking",
  "identity",
  "nativeMessaging",
  "debugger",
  "proxy",
  "geolocation",
  "unlimitedStorage",
  "topSites",
  "idle",
]);
const errors = [];

for (const permission of manifest.permissions || []) {
  if (forbiddenPermissions.has(permission)) errors.push(`禁止权限: ${permission}`);
}
if (!(manifest.host_permissions || []).includes("<all_urls>")) {
  errors.push("缺少基线 host_permissions <all_urls>");
}
if (manifest.default_locale !== "en") errors.push("default_locale 必须为 en");
if (manifest.content_security_policy?.extension_pages?.includes("unsafe-eval")) {
  errors.push("扩展页面 CSP 不得包含 unsafe-eval");
}

const contentScripts = manifest.content_scripts?.[0]?.js || [];
const requiredOrder = [
  "lib/open_key_mouse/command_invocation.js",
  "lib/open_key_mouse/message_protocol.js",
  "lib/open_key_mouse/settings_schema.js",
  "background_scripts/open_key_mouse/settings_repository.js",
  "content_scripts/mouse/path_sampler.js",
  "content_scripts/mouse/mouse_controller.js",
];
let previous = -1;
for (const file of requiredOrder) {
  const current = contentScripts.indexOf(file);
  if (current < 0 || current <= previous) errors.push(`内容脚本加载顺序缺失或错误: ${file}`);
  previous = current;
}

const sourceFiles = [];
async function collectSourceFiles(directory) {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.name === ".git" || entry.name === "dist" || entry.name === "node_modules") continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      await collectSourceFiles(file);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".html")) {
      sourceFiles.push(file);
    }
  }
}
await collectSourceFiles(".");
const forbiddenRemoteScript = /<script[^>]+src=["']https?:\/\//i;
for (const file of sourceFiles) {
  const text = await Deno.readTextFile(file);
  if (forbiddenRemoteScript.test(text)) errors.push(`发现远程脚本: ${file}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  Deno.exit(1);
}
console.log(
  `权限审计通过：${manifest.permissions?.length || 0} 项权限，未发现禁止权限或远程脚本。`,
);
