// 审计新增模块及已接入运行时的页面；只允许逐行登记的本地资源和既有在线建议路径。
const roots = [
  "lib/browser_toolbox",
  "background_scripts/browser_toolbox",
  "content_scripts/mouse",
  "content_scripts/browser_toolbox",
  "content_scripts/document_formatter",
  // 已接入 RuntimeHost 的兼容模块纳入审计；未迁入的旧补全网络路径由 Phase 0 清单逐项登记。
  "content_scripts/vimium_frontend.js",
  "content_scripts/mode_normal.js",
  "content_scripts/mode_insert.js",
  "content_scripts/mode_find.js",
  "content_scripts/mode_visual.js",
  "content_scripts/scroller.js",
  "content_scripts/hud.js",
  "content_scripts/ui_component.js",
  "content_scripts/link_hints.js",
  "content_scripts/vomnibar.js",
  "content_scripts/marks.js",
  "pages/vomnibar_page.js",
  "pages/browser_toolbox",
  "pages/ui_component_messenger.js",
  "pages/hud_page.js",
  "pages/mouse_options.js",
  "pages/tab_list.js",
  "pages/tools",
  "vendor/yaml.js",
];
const patterns = [
  [/\bfetch\s*\(|\bfetch\s*[,;}]|\.fetcher\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\s*\(/, "sendBeacon"],
  [/\bimportScripts\s*\(/, "importScripts"],
  [/\bhttps?:\/\//, "http(s) URL"],
];
const allowed = [
  // ADR-018 保留旧搜索适配器端点；新会话发送入口仍接受原来的长度、URL和取消条件。
  { file: "background_scripts/browser_toolbox/completion_suggestions.js", text: "constructor({ fetcher = fetch, engines = adapters, now = Date.now, delay = null } = {})" },
  { file: "background_scripts/browser_toolbox/completion_suggestions.js", text: "await this.fetcher(engine.getUrl(sent), { signal: controller.signal })" },
  {
    file: "content_scripts/ui_component.js",
    text: 'fetch(chrome.runtime.getURL("content_scripts/vimium.css"))',
  },
  {
    file: "content_scripts/browser_toolbox/ui_runtime.js",
    text: 'fetch(chrome.runtime.getURL("content_scripts/vimium.css"))',
  },
  // 站点规则中的 URL 是匹配数据，不是网络调用；保持文件和文本双重精确匹配，避免放宽真正的网络审计。
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://docs.google.com/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://*.notion.so/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://stackblitz.com/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://codesandbox.io/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://codepen.io/*" },
  {
    file: "background_scripts/browser_toolbox/browser_command_adapter.js",
    text: "www.google.com/search",
  },
  { file: "lib/browser_toolbox/command_invocation.js", text: "browsertoolbox.invalid" },
  // 创建标签的参数说明沿用旧合成示例地址，不构成请求路径。
  { file: "lib/browser_toolbox/command_definitions.js", text: "https://example.com" },
  { file: "content_scripts/mouse/drag_context_classifier.js", text: "browsertoolbox.invalid" },
  { file: "content_scripts/mouse/gesture_overlay.js", text: "www.w3.org/2000/svg" },
  { file: "lib/browser_toolbox/tools/tool_icons.js", text: "www.w3.org/2000/svg" },
  { file: "content_scripts/document_formatter/document_formatter.js", text: "www.w3.org/1999/xhtml" },
  { file: "pages/mouse_options.js", text: "www.w3.org/2000/svg" },
  { file: "pages/mouse_options.js", text: "https://example.com/*" },
];
const files = [];

async function collect(root) {
  try {
    const stat = await Deno.stat(root);
    if (stat.isFile) files.push(root);
    else {
      for await (const entry of Deno.readDir(root)) await collect(`${root}/${entry.name}`);
    }
  } catch (_) {
    console.error(`无法读取审计目标: ${root}`);
    Deno.exit(1);
  }
}

for (const root of roots) await collect(root);
const findings = [];
for (const file of files) {
  const lines = (await Deno.readTextFile(file)).split("\n");
  lines.forEach((line, index) => {
    for (const [regexp, label] of patterns) {
      if (!regexp.test(line)) continue;
      // 上游解释性注释中的来源链接不发起网络请求，执行语句仍按固定清单检查。
      if (label === "http(s) URL" && /^\s*\/\//.test(line)) continue;
      const isAllowed = allowed.some((item) => item.file === file && line.includes(item.text));
      if (!isAllowed) findings.push(`${file}:${index + 1}: ${label}`);
    }
  });
}

if (findings.length > 0) {
  console.error("发现未列入白名单的新增网络调用：");
  console.error(findings.join("\n"));
  Deno.exit(1);
}
console.log(`网络审计通过：已扫描 ${files.length} 个模块文件，调用仅包含已登记的本地资源和既有在线建议。`);
