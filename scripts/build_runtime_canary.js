// SPDX-License-Identifier: GPL-3.0-or-later
// 明确调用才生成独立输入 Canary；不修改默认 manifest、源码编译标志或 dist 交付。
import * as path from "@std/path";
import { commandOutput, isRuntimeFile, readManifest } from "./release_artifacts.js";

const compileFlags = [
  "CANARY",
  "FIND_CANARY",
  "VISUAL_CANARY",
  "HINTS_CANARY",
  "VOMNIBAR_CANARY",
  "MARKS_CANARY",
  "UI_CANARY",
  "PAGES_CANARY",
];

function requireSingle(text, needle, label) {
  if (text.split(needle).length !== 2) {
    throw new Error(`隔离构建入口异常：${label}`);
  }
}

export function assertCanaryManifest(manifest) {
  const scripts = manifest.content_scripts?.[0]?.js;
  if (!Array.isArray(scripts)) throw new Error("隔离构建缺少内容脚本清单");
  const anchors = [
    "lib/settings.js",
    "lib/browser_toolbox/compat_runtime.js",
    "content_scripts/vimium_frontend.js",
  ];
  for (const item of anchors) {
    if (scripts.filter((script) => script === item).length !== 1) {
      throw new Error(`隔离构建内容脚本入口异常：${item}`);
    }
  }
  if (
    !(scripts.indexOf(anchors[0]) < scripts.indexOf(anchors[1]) &&
      scripts.indexOf(anchors[1]) < scripts.indexOf(anchors[2]))
  ) {
    throw new Error("隔离构建内容脚本入口顺序异常");
  }
  for (
    const item of [
      "content_scripts/browser_toolbox/input_runtime.js",
      "content_scripts/browser_toolbox/find_runtime.js",
      "content_scripts/browser_toolbox/visual_runtime.js",
      "content_scripts/browser_toolbox/hints_runtime.js",
      "content_scripts/browser_toolbox/vomnibar_runtime.js",
      "content_scripts/browser_toolbox/marks_runtime.js",
      "content_scripts/browser_toolbox/ui_runtime.js",
      "content_scripts/browser_toolbox/new_tab_runtime.js",
    ]
  ) {
    if (scripts.includes(item)) throw new Error(`隔离构建入口已存在：${item}`);
  }
}

async function checkCanaryInputs(root, runtimeSource, { ui, settings }) {
  const manifest = await readManifest(root);
  assertCanaryManifest(manifest);
  const read = (file) => Deno.readTextFile(path.join(runtimeSource, file));
  const [plan, page, background] = await Promise.all([
    read("lib/browser_toolbox/runtime_plan.js"),
    read("pages/all_content_scripts.js"),
    read("background_scripts/main.js"),
  ]);
  for (const flag of compileFlags) {
    const declarations =
      plan.match(new RegExp(`\\bconst\\s+COMPILED_${flag}\\b`, "g")) || [];
    if (declarations.length !== 1) {
      throw new Error(`隔离构建编译开关声明异常：${flag}`);
    }
    requireSingle(plan, `const COMPILED_${flag} = false;`, `编译开关 ${flag}`);
  }
  for (
    const anchor of [
      'import "../lib/settings.js";',
      'import "../lib/browser_toolbox/compat_runtime.js";\n',
      'import "../content_scripts/vimium_frontend.js";',
    ]
  ) requireSingle(page, anchor, anchor);
  if (
    !(page.indexOf('import "../lib/settings.js";') <
        page.indexOf('import "../lib/browser_toolbox/compat_runtime.js";') &&
      page.indexOf('import "../lib/browser_toolbox/compat_runtime.js";') <
        page.indexOf('import "../content_scripts/vimium_frontend.js";'))
  ) {
    throw new Error("隔离构建页面入口顺序异常");
  }
  for (
    const service of [
      "hints_coordinator",
      "completion_service",
      "marks_service",
      "frame_focus_service",
      "new_tab_service",
    ]
  ) {
    if (background.includes(`import "./browser_toolbox/${service}.js";`)) {
      throw new Error(`隔离构建后台入口已存在：${service}`);
    }
  }
  if (ui) {
    requireSingle(
      await read("pages/help_dialog_page.html"),
      'src="help_dialog_page.js"',
      "帮助页面",
    );
  }
  if (settings) {
    for (
      const name of ["options", "command_listing", "doc_search_completion"]
    ) {
      requireSingle(
        await read(`pages/${name}.html`),
        `src="${name}.js"`,
        `设置页面 ${name}`,
      );
    }
  }
  return manifest;
}

export async function buildInputCanary(
  root = Deno.cwd(),
  runtimeSource = root,
  { find = false, visual = false, hints = false, vomnibar = false, marks = false, ui = false, settings = false, pages = false } = {},
) {
  settings ||= pages;
  ui ||= settings;
  marks ||= ui;
  vomnibar ||= marks;
  hints ||= vomnibar;
  visual ||= hints;
  find ||= visual;
  const manifest = await checkCanaryInputs(root, runtimeSource, { ui, settings });
  const parent = await Deno.makeTempDir({
    prefix: pages ? "browser-toolbox-pages-canary-" : ui ? "browser-toolbox-ui-canary-" : marks ? "browser-toolbox-marks-canary-" : vomnibar
      ? "browser-toolbox-vomnibar-canary-"
      : hints
      ? "browser-toolbox-hints-canary-"
      : visual
      ? "browser-toolbox-visual-canary-"
      : find
      ? "browser-toolbox-find-canary-"
      : "browser-toolbox-input-canary-",
  });
  const destination = path.join(parent, "browser-toolbox");
  const files =
    (await commandOutput("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
    }))
      .split("\0").filter(isRuntimeFile);
  for (const file of new Set(files)) {
    const source = path.join(runtimeSource, file);
    const stat = await Deno.lstat(source);
    if (!stat.isFile || stat.isSymlink) throw new Error(`不允许的构建输入：${file}`);
    const target = path.join(destination, file);
    await Deno.mkdir(path.dirname(target), { recursive: true });
    await Deno.copyFile(source, target);
  }
  const modules = [
    "content_scripts/browser_toolbox/scroll_controller.js",
    "content_scripts/browser_toolbox/input_runtime.js",
  ];
  if (find) {
    modules.push(
      "lib/browser_toolbox/find_history.js",
      "content_scripts/browser_toolbox/find_runtime.js",
    );
  }
  if (visual) {
    modules.push(
      "lib/browser_toolbox/visual_word_characters.js",
      "content_scripts/browser_toolbox/visual_runtime.js",
    );
  }
  if (hints) {
    modules.push(
      "content_scripts/browser_toolbox/hints_scanner.js",
      "content_scripts/browser_toolbox/hints_matcher.js",
      "content_scripts/browser_toolbox/hints_runtime.js",
    );
    const mainFile = path.join(destination, "background_scripts/main.js");
    const main = await Deno.readTextFile(mainFile);
    await Deno.writeTextFile(mainFile, 'import "./browser_toolbox/hints_coordinator.js";\n' + main);
    const legacyHintsFile = path.join(destination, "content_scripts/link_hints.js");
    const legacyHints = await Deno.readTextFile(legacyHintsFile);
    const router = await Deno.readTextFile(
      path.join(destination, "content_scripts/browser_toolbox/hints_compat_router.js"),
    );
    // 旧文件逐字保留在包内；隔离入口只加载路由，兼容准备阶段再加载本地旧文件。
    await Deno.writeTextFile(
      path.join(destination, "content_scripts/browser_toolbox/compat_link_hints.js"),
      legacyHints,
    );
    await Deno.writeTextFile(legacyHintsFile, router);
  }
  if (vomnibar) {
    modules.push("content_scripts/browser_toolbox/vomnibar_runtime.js");
    const mainFile = path.join(destination, "background_scripts/main.js");
    const main = await Deno.readTextFile(mainFile);
    // MV3后台不支持动态import，隔离构建静态安装完成器定义，数据会话仍在Native授权后创建。
    await Deno.writeTextFile(mainFile, 'import "./browser_toolbox/completion_service.js";\n' + main);
  }
  if (marks) {
    modules.push("lib/browser_toolbox/marks_compat_storage.js", "content_scripts/browser_toolbox/marks_runtime.js");
    const mainFile = path.join(destination, "background_scripts/main.js");
    await Deno.writeTextFile(mainFile,
      'import "./browser_toolbox/marks_service.js";\n' + await Deno.readTextFile(mainFile));
  }
  if (ui) {
    modules.push("content_scripts/browser_toolbox/help_runtime.js");
    modules.push("content_scripts/browser_toolbox/ui_component.js", "content_scripts/browser_toolbox/frame_focus.js",
      "content_scripts/browser_toolbox/hud_runtime.js", "content_scripts/browser_toolbox/ui_runtime.js");
    const mainFile = path.join(destination, "background_scripts/main.js");
    await Deno.writeTextFile(mainFile,
      'import "./browser_toolbox/frame_focus_service.js";\n' + await Deno.readTextFile(mainFile));
  }
  if (pages) {
    modules.push("content_scripts/browser_toolbox/new_tab_runtime.js");
    const mainFile = path.join(destination, "background_scripts/main.js");
    await Deno.writeTextFile(mainFile,
      'import "./browser_toolbox/new_tab_service.js";\n' + await Deno.readTextFile(mainFile));
  }
  const scripts = manifest.content_scripts[0].js;
  // 首读不依赖模式声明，提前发送现有握手和配置请求，避免回包排在首轮布局/绘制之后。
  scripts.splice(scripts.indexOf("lib/browser_toolbox/compat_runtime.js"), 1);
  scripts.splice(scripts.indexOf("lib/settings.js") + 1, 0, "lib/browser_toolbox/compat_runtime.js");
  scripts.splice(scripts.indexOf("content_scripts/vimium_frontend.js"), 0, ...modules);
  manifest.name = pages ? "浏览器工具箱页面 Canary" : ui ? "浏览器工具箱界面 Canary" : marks ? "浏览器工具箱标记 Canary" : vomnibar
    ? "浏览器工具箱导航 Canary"
    : hints
    ? "浏览器工具箱提示 Canary"
    : visual
    ? "浏览器工具箱选择 Canary"
    : find
    ? "浏览器工具箱查找 Canary"
    : "浏览器工具箱输入 Canary";
  await Deno.writeTextFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const planFile = path.join(destination, "lib/browser_toolbox/runtime_plan.js");
  const plan = await Deno.readTextFile(planFile);
  if (!plan.includes("const COMPILED_CANARY = false;")) throw new Error("默认编译标志异常");
  await Deno.writeTextFile(
    planFile,
    plan.replace("const COMPILED_CANARY = false;", "const COMPILED_CANARY = true;")
      .replace("const COMPILED_FIND_CANARY = false;", `const COMPILED_FIND_CANARY = ${find};`)
      .replace(
        "const COMPILED_VISUAL_CANARY = false;",
        `const COMPILED_VISUAL_CANARY = ${visual};`,
      ).replace(
        "const COMPILED_HINTS_CANARY = false;",
        `const COMPILED_HINTS_CANARY = ${hints};`,
      ).replace(
        "const COMPILED_VOMNIBAR_CANARY = false;",
        `const COMPILED_VOMNIBAR_CANARY = ${vomnibar};`,
      ).replace(
        "const COMPILED_MARKS_CANARY = false;",
        `const COMPILED_MARKS_CANARY = ${marks};`,
      ).replace(
        "const COMPILED_UI_CANARY = false;",
        `const COMPILED_UI_CANARY = ${ui};`,
      ).replace(
        "const COMPILED_PAGES_CANARY = false;",
        `const COMPILED_PAGES_CANARY = ${pages};`,
      ),
  );
  const pageFile = path.join(destination, "pages/all_content_scripts.js");
  const page = await Deno.readTextFile(pageFile);
  await Deno.writeTextFile(
    pageFile,
    page.replace('import "../lib/browser_toolbox/compat_runtime.js";\n', "")
      .replace('import "../lib/settings.js";', 'import "../lib/settings.js";\nimport "../lib/browser_toolbox/compat_runtime.js";')
      .replace(
      'import "../content_scripts/vimium_frontend.js";',
      modules.map((file) => `import "../${file}";`).join("\n") +
        '\nimport "../content_scripts/vimium_frontend.js";',
    ),
  );
  if (ui) {
    // 由已核对的内容脚本清单生成页面宿主依赖。
    const dependencies = (await Deno.readTextFile(pageFile))
      .split("\n").filter((line) => line.startsWith('import "'))
      .map((line) => line.replace('"../', '"../../')).join("\n");
    const runtimeFile = path.join(destination, "pages/browser_toolbox/page_runtime.js");
    await Deno.writeTextFile(runtimeFile,
      dependencies + "\n" + await Deno.readTextFile(runtimeFile));
    const helpFile = path.join(destination, "pages/help_dialog_page.html");
    await Deno.writeTextFile(helpFile, (await Deno.readTextFile(helpFile))
      .replace('src="help_dialog_page.js"', 'src="browser_toolbox/page_entry.js"'));
  }
  if (settings) {
    for (const name of ["options", "command_listing", "doc_search_completion"]) {
      const page = path.join(destination, `pages/${name}.html`);
      const html = await Deno.readTextFile(page);
      const entry = `src="${name}.js"`;
      if (!html.includes(entry)) throw new Error(`设置页面入口异常：${name}`);
      await Deno.writeTextFile(page, html.replace(entry, 'src="browser_toolbox/owned_page_entry.js"'));
    }
  }
  return {
    settingsPages: settings,
    extensionPath: destination,
    planVersion: pages ? 9 : ui ? 8 : marks ? 7 : vomnibar ? 6 : hints ? 5 : visual ? 4 : find ? 3 : 2,
    defaultSourcePlanVersion: 1,
    enabledModules: ui
      ? ["input", "scroll", "find", "findHistory", "visual", "caret", "hints", "vomnibar", "completers", "marks", "ui", "frameFocus",
        ...(pages ? ["help", "settingsPages", "newTab"] : [])]
      : marks
      ? ["input", "scroll", "find", "findHistory", "visual", "caret", "hints", "vomnibar", "completers", "marks"]
      : vomnibar
      ? ["input", "scroll", "find", "findHistory", "visual", "caret", "hints", "vomnibar", "completers"]
      : hints
      ? ["input", "scroll", "find", "findHistory", "visual", "caret", "hints"]
      : visual
      ? ["input", "scroll", "find", "findHistory", "visual", "caret"]
      : find
      ? ["input", "scroll", "find", "findHistory"]
      : ["input", "scroll"],
    compatibleModules: ui ? [] : hints
      ? ["ui"]
      : visual
      ? ["hints", "ui"]
      : find
      ? ["visual", "hints", "ui"]
      : ["find", "visual", "hints", "ui"],
  };
}

if (import.meta.main) {
  const report = await buildInputCanary(Deno.cwd(), Deno.cwd(), {
    find: Deno.args.includes("--find"),
    visual: Deno.args.includes("--visual"),
    hints: Deno.args.includes("--hints"),
    vomnibar: Deno.args.includes("--vomnibar"),
    marks: Deno.args.includes("--marks"),
    ui: Deno.args.includes("--ui"),
    settings: Deno.args.includes("--settings"),
    pages: Deno.args.includes("--pages"),
  });
  const index = Deno.args.indexOf("--report");
  if (index >= 0) {
    await Deno.writeTextFile(Deno.args[index + 1], JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report));
}
