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
const maxDescriptionLength = 132;

async function auditDescriptions() {
  for await (const entry of Deno.readDir("_locales")) {
    if (!entry.isDirectory) continue;
    const file = `_locales/${entry.name}/messages.json`;
    let messages;
    try {
      messages = JSON.parse(await Deno.readTextFile(file));
    } catch (error) {
      errors.push(`本地化消息无法解析: ${file} (${error.message})`);
      continue;
    }
    const description = messages.extensionDescription?.message;
    if (typeof description !== "string") {
      errors.push(`缺少扩展说明本地化消息: ${file}`);
    } else if (Array.from(description).length > maxDescriptionLength) {
      errors.push(
        `扩展说明超过 Chrome Web Store ${maxDescriptionLength} 字符限制: ${file}`,
      );
    }
  }

  const i18nSource = await Deno.readTextFile("lib/i18n.js");
  // 兼容生成目录中的带引号键名，同时继续检查实际内置英文说明。
  const fallbackMatch = i18nSource.match(
    /(?:"extensionDescription"|extensionDescription):\s*"([^"]+)"/,
  );
  if (!fallbackMatch) {
    errors.push("缺少英文扩展说明 fallback");
  } else if (Array.from(fallbackMatch[1]).length > maxDescriptionLength) {
    errors.push(`英文扩展说明 fallback 超过 ${maxDescriptionLength} 字符限制`);
  }
}

await auditDescriptions();

for (const permission of manifest.permissions || []) {
  if (forbiddenPermissions.has(permission)) errors.push(`禁止权限: ${permission}`);
}
if (!(manifest.host_permissions || []).includes("<all_urls>")) {
  errors.push("缺少基线 host_permissions <all_urls>");
}
if (manifest.default_locale !== "en") errors.push("default_locale 必须为 en");
const expectedExtensionPagesCsp = "script-src 'self'; object-src 'self'";
if (manifest.content_security_policy?.extension_pages !== expectedExtensionPagesCsp) {
  errors.push(`扩展页面 CSP 必须明确为: ${expectedExtensionPagesCsp}`);
}
const primaryContentScript = manifest.content_scripts?.[0];
if (!(primaryContentScript?.matches || []).includes("<all_urls>")) {
  errors.push("内容脚本必须覆盖基线 matches <all_urls>");
}
if (primaryContentScript?.run_at !== "document_start") {
  errors.push("内容脚本 run_at 必须为 document_start");
}
if (primaryContentScript?.all_frames !== true) errors.push("内容脚本必须启用 all_frames");
if (primaryContentScript?.match_about_blank !== true) {
  errors.push("内容脚本必须启用 match_about_blank");
}

const contentScripts = manifest.content_scripts?.[0]?.js || [];
const requiredOrder = [
  "lib/browser_toolbox/value_utils.js",
  "lib/browser_toolbox/tools/tool_contract.js",
  "lib/browser_toolbox/tools/tool_registry.js",
  "lib/browser_toolbox/tools/tool_registry_validator.js",
  "lib/browser_toolbox/tools/document_formatters.js",
  "content_scripts/document_formatter/document_formatter.js",
  "lib/browser_toolbox/command_invocation.js",
  "lib/browser_toolbox/message_protocol.js",
  "lib/browser_toolbox/settings_schema.js",
  "lib/browser_toolbox/regex_safety.js",
  "lib/browser_toolbox/module_registry.js",
  "lib/browser_toolbox/settings_policy.js",
  "background_scripts/browser_toolbox/settings_migrations.js",
  "background_scripts/browser_toolbox/settings_storage.js",
  "background_scripts/browser_toolbox/vimium_settings_adapter.js",
  "background_scripts/browser_toolbox/settings_repository.js",
  "lib/browser_toolbox/settings_runtime_client.js",
  "content_scripts/mouse/path_sampler.js",
  "content_scripts/mouse/mouse_controller.js",
];
let previous = -1;
for (const file of requiredOrder) {
  const current = contentScripts.indexOf(file);
  if (current < 0 || current <= previous) errors.push(`内容脚本加载顺序缺失或错误: ${file}`);
  previous = current;
}

const pageDependencyOrder = [
  "pages/action.js",
  "pages/tab_list.js",
];
for (const file of pageDependencyOrder) {
  const source = await Deno.readTextFile(file);
  const safetyIndex = source.indexOf("../lib/browser_toolbox/regex_safety.js");
  const validatorIndex = source.indexOf("../lib/browser_toolbox/settings_validator.js");
  if (safetyIndex < 0 || validatorIndex < 0 || safetyIndex > validatorIndex) {
    errors.push(`扩展页面安全依赖顺序缺失或错误: ${file}`);
  }
}

// Browser Toolbox 集成页只能通过适配层访问 Vimium 设置，避免重新引入全局耦合。
for (const file of ["pages/action.js", "pages/mouse_options.js"]) {
  const source = await Deno.readTextFile(file);
  if (!source.includes("BrowserToolboxVimiumSettingsAdapterInstance")) {
    errors.push(`Browser Toolbox 集成页缺少 Vimium 设置适配层: ${file}`);
  }
  if (/\bSettings\b/.test(source)) {
    errors.push(`Browser Toolbox 集成页直接依赖全局 Settings: ${file}`);
  }
}

for (const file of pageDependencyOrder) {
  const source = await Deno.readTextFile(file);
  const adapterIndex = source.indexOf(
    "../background_scripts/browser_toolbox/vimium_settings_adapter.js",
  );
  const repositoryIndex = source.indexOf(
    "../background_scripts/browser_toolbox/settings_repository.js",
  );
  if (adapterIndex < 0 || repositoryIndex < 0 || adapterIndex > repositoryIndex) {
    errors.push(`扩展页面 Vimium 设置依赖顺序缺失或错误: ${file}`);
  }
}

const sourceFiles = [];
async function collectSourceFiles(directory) {
  for await (const entry of Deno.readDir(directory)) {
    if (
      entry.name === ".git" || entry.name === "dist" || entry.name === "node_modules" ||
      entry.name === "local-development"
    ) continue;
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
const forbiddenDynamicCode = /(^|[^$A-Za-z0-9_])eval\s*\(|new\s+Function\s*\(/;
const inlineScript = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/i;
const packagedMarkdownLink = /\b(?:href|src)\s*=\s*["'][^"']+\.md(?:[?#][^"']*)?["']/i;
for (const file of sourceFiles) {
  const text = await Deno.readTextFile(file);
  if (forbiddenRemoteScript.test(text)) errors.push(`发现远程脚本: ${file}`);
  if (forbiddenDynamicCode.test(text)) errors.push(`发现禁止的动态代码执行: ${file}`);
  if (file.startsWith("pages/") && inlineScript.test(text)) {
    errors.push(`扩展页面不得使用内联脚本: ${file}`);
  }
  if (file.startsWith("pages/") && packagedMarkdownLink.test(text)) {
    errors.push(`扩展页面链接了不会进入运行时包的 Markdown: ${file}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  Deno.exit(1);
}
console.log(
  `权限审计通过：${manifest.permissions?.length || 0} 项权限，未发现禁止权限或远程脚本。`,
);
