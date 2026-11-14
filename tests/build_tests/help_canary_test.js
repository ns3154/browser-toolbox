// SPDX-License-Identifier: GPL-3.0-or-later
// 检查实际隔离产物与默认入口，防止帮助迁移暗中改变公开包或权限。
import * as path from "@std/path";
import { assertCanaryManifest, buildInputCanary } from "../../scripts/build_runtime_canary.js";
import { buildArtifacts, readManifest } from "../../scripts/release_artifacts.js";

Deno.test("帮助独立入口仅写入UI隔离包，默认入口和权限保持", async () => {
  const root = Deno.cwd();
  const original = await Deno.readTextFile("pages/help_dialog_page.html");
  const plan = await Deno.readTextFile("lib/browser_toolbox/runtime_plan.js");
  const result = await buildInputCanary(root, root, { ui: true });
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    const read = (name) => Deno.readTextFile(path.join(result.extensionPath, name));
    const manifest = JSON.parse(await read("manifest.json"));
    const source = await readManifest(root);
    assert(
      JSON.stringify(manifest.permissions) === JSON.stringify(source.permissions),
      "隔离包扩大权限",
    );
    assert(
      (await read("pages/help_dialog_page.html")).includes('src="browser_toolbox/page_entry.js"'),
      "帮助仍使用旧启动入口",
    );
    const boot = await read("pages/browser_toolbox/page_runtime.js");
    assert(!boot.includes('import "../all_content_scripts.js"'), "页面隐式启动旧页面承载");
    assert(
      boot.includes('import "../../content_scripts/browser_toolbox/input_runtime.js"'),
      "页面缺少独立键盘引擎",
    );
    assert(
      boot.match(/import "..\/..\/content_scripts\/vimium_frontend.js"/g)?.length === 1,
      "页面宿主重复或缺失",
    );
    assert(
      (await read("pages/help_dialog_page.js")).includes('import "./all_content_scripts.js"'),
      "兼容页面算法被覆盖",
    );
    assert(
      original === await Deno.readTextFile("pages/help_dialog_page.html"),
      "修改了默认帮助入口",
    );
    assert(
      plan === await Deno.readTextFile("lib/browser_toolbox/runtime_plan.js"),
      "修改了默认编译开关",
    );
  } finally {
    await Deno.remove(path.dirname(result.extensionPath), { recursive: true });
  }
});

Deno.test("方案 9 整组编译且默认权限与公开入口保持", async () => {
  const root = Deno.cwd();
  const canary = await buildInputCanary(root, root, { pages: true });
  const read = (name) => Deno.readTextFile(path.join(canary.extensionPath, name));
  try {
    const source = await readManifest(root);
    const manifest = JSON.parse(await read("manifest.json"));
    manifest.name = source.name;
    manifest.content_scripts[0].js = source.content_scripts[0].js;
    if (JSON.stringify(manifest) !== JSON.stringify(source)) {
      throw new Error("隔离构建改动了权限或公开入口");
    }
    const plan = await read("lib/browser_toolbox/runtime_plan.js");
    const flags = [...plan.matchAll(/const COMPILED_[A-Z_]+ = (true|false);/g)];
    if (
      canary.planVersion !== 9 || flags.length !== 8 || flags.some((flag) => flag[1] !== "true") ||
      !canary.settingsPages || !["help", "settingsPages", "newTab"].every((key) => canary.enabledModules.includes(key))
    ) throw new Error("方案 9 缺少整组依赖");
    for (const page of ["options", "command_listing", "doc_search_completion"]) {
      if (!(await read(`pages/${page}.html`)).includes('src="browser_toolbox/owned_page_entry.js"')) {
        throw new Error(`${page} 未启用受控启动入口`);
      }
    }
    if (
      !(await read("pages/help_dialog_page.html")).includes('src="browser_toolbox/page_entry.js"') ||
      !(await read("background_scripts/main.js")).includes('import "./browser_toolbox/new_tab_service.js"') ||
      !(await read("pages/browser_toolbox/page_runtime.js")).includes('import "../../content_scripts/browser_toolbox/new_tab_runtime.js"')
    ) throw new Error("方案 9 缺少帮助或新标签入口");
  } finally {
    await Deno.remove(path.dirname(canary.extensionPath), { recursive: true });
  }
});

Deno.test("隔离构建遇到编译开关或页面入口漂移时拒绝生成", async () => {
  const root = Deno.cwd();
  const temporary = await Deno.makeTempDir({
    prefix: "browser-toolbox-canary-anchors-",
  });
  try {
    await buildArtifacts({ root, output: temporary });
    const source = path.join(temporary, "browser-toolbox");
    const plan = path.join(source, "lib/browser_toolbox/runtime_plan.js");
    const page = path.join(source, "pages/all_content_scripts.js");
    const originalPlan = await Deno.readTextFile(plan);
    const originalPage = await Deno.readTextFile(page);
    for (
      const scenario of [
        "missing-flag",
        "duplicate-flag",
        "mixed-flags",
        "missing-page-anchor",
        "page-order",
      ]
    ) {
      if (scenario === "missing-flag") {
        await Deno.writeTextFile(
          plan,
          originalPlan.replace("const COMPILED_MARKS_CANARY = false;", ""),
        );
      }
      if (scenario === "duplicate-flag") {
        await Deno.writeTextFile(
          plan,
          originalPlan + "\nconst COMPILED_MARKS_CANARY = false;\n",
        );
      }
      if (scenario === "mixed-flags") {
        await Deno.writeTextFile(
          plan,
          originalPlan + "\nconst COMPILED_MARKS_CANARY = true;\n",
        );
      }
      if (scenario === "missing-page-anchor") {
        await Deno.writeTextFile(
          page,
          originalPage.replace(
            'import "../content_scripts/vimium_frontend.js";',
            "",
          ),
        );
      }
      if (scenario === "page-order") {
        const anchor = 'import "../lib/browser_toolbox/compat_runtime.js";\n';
        const settings = 'import "../lib/settings.js";';
        await Deno.writeTextFile(
          page,
          originalPage.replace(anchor, "").replace(settings, anchor + settings),
        );
      }
      let built;
      let rejected = false;
      try {
        built = await buildInputCanary(root, source, { pages: true });
      } catch (_) {
        rejected = true;
      } finally {
        if (built) {
          await Deno.remove(path.dirname(built.extensionPath), {
            recursive: true,
          });
        }
      }
      if (!rejected) throw new Error(`入口漂移未被拒绝：${scenario}`);
      await Deno.writeTextFile(plan, originalPlan);
      await Deno.writeTextFile(page, originalPage);
    }
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});

Deno.test("隔离构建拒绝缺失、重复和顺序错误的内容脚本锚点", async () => {
  const original = await readManifest(Deno.cwd());
  for (
    const scenario of ["missing", "duplicate", "order", "already-injected"]
  ) {
    const manifest = structuredClone(original);
    const scripts = manifest.content_scripts[0].js;
    const compat = "lib/browser_toolbox/compat_runtime.js";
    const position = scripts.indexOf(compat);
    if (scenario === "missing") scripts.splice(position, 1);
    if (scenario === "duplicate") scripts.push(compat);
    if (scenario === "order") {
      scripts.splice(position, 1);
      scripts.unshift(compat);
    }
    if (scenario === "already-injected") {
      scripts.push(
        "content_scripts/browser_toolbox/input_runtime.js",
      );
    }
    let rejected = false;
    try {
      assertCanaryManifest(manifest);
    } catch (_) {
      rejected = true;
    }
    if (!rejected) throw new Error(`异常清单未被拒绝：${scenario}`);
  }
});

Deno.test("所有已登记依赖组在隔离包中成套接入且默认源码不变", async () => {
  const root = Deno.cwd();
  const originalPlan = await Deno.readTextFile(
    "lib/browser_toolbox/runtime_plan.js",
  );
  const originalManifest = await readManifest(root);
  const cases = [
    [{}, 2, 1],
    [{ find: true }, 3, 2],
    [{ visual: true }, 4, 3],
    [{ hints: true }, 5, 4],
    [{ vomnibar: true }, 6, 5],
    [{ marks: true }, 7, 6],
    [{ ui: true }, 8, 7],
    [{ settings: true }, 8, 7],
    [{ pages: true }, 9, 8],
  ];
  const flagNames = [
    "CANARY",
    "FIND_CANARY",
    "VISUAL_CANARY",
    "HINTS_CANARY",
    "VOMNIBAR_CANARY",
    "MARKS_CANARY",
    "UI_CANARY",
    "PAGES_CANARY",
  ];
  const modules = [
    [2, "content_scripts/browser_toolbox/scroll_controller.js"],
    [2, "content_scripts/browser_toolbox/input_runtime.js"],
    [3, "lib/browser_toolbox/find_history.js"],
    [3, "content_scripts/browser_toolbox/find_runtime.js"],
    [4, "lib/browser_toolbox/visual_word_characters.js"],
    [4, "content_scripts/browser_toolbox/visual_runtime.js"],
    [5, "content_scripts/browser_toolbox/hints_scanner.js"],
    [5, "content_scripts/browser_toolbox/hints_matcher.js"],
    [5, "content_scripts/browser_toolbox/hints_runtime.js"],
    [6, "content_scripts/browser_toolbox/vomnibar_runtime.js"],
    [7, "lib/browser_toolbox/marks_compat_storage.js"],
    [7, "content_scripts/browser_toolbox/marks_runtime.js"],
    [8, "content_scripts/browser_toolbox/help_runtime.js"],
    [8, "content_scripts/browser_toolbox/ui_component.js"],
    [8, "content_scripts/browser_toolbox/frame_focus.js"],
    [8, "content_scripts/browser_toolbox/hud_runtime.js"],
    [8, "content_scripts/browser_toolbox/ui_runtime.js"],
    [9, "content_scripts/browser_toolbox/new_tab_runtime.js"],
  ];
  const services = [
    [5, "hints_coordinator"],
    [6, "completion_service"],
    [7, "marks_service"],
    [8, "frame_focus_service"],
    [9, "new_tab_service"],
  ];
  for (const [options, version, count] of cases) {
    const built = await buildInputCanary(root, root, options);
    try {
      const read = (file) =>
        Deno.readTextFile(path.join(built.extensionPath, file));
      const manifest = JSON.parse(await read("manifest.json"));
      const scripts = manifest.content_scripts[0].js;
      const settings = scripts.indexOf("lib/settings.js");
      const compat = scripts.indexOf("lib/browser_toolbox/compat_runtime.js");
      const frontend = scripts.indexOf("content_scripts/vimium_frontend.js");
      const input = scripts.indexOf(
        "content_scripts/browser_toolbox/input_runtime.js",
      );
      const flags = [
        ...(await read("lib/browser_toolbox/runtime_plan.js")).matchAll(
          /const COMPILED_([A-Z_]+) = (true|false);/g,
        ),
      ];
      if (
        built.planVersion !== version || flags.length !== 8 ||
        flags.some((flag, position) =>
          flag[1] !== flagNames[position] ||
          flag[2] !== String(position < count)
        ) ||
        compat !== settings + 1 || !(compat < input && input < frontend) ||
        new Set(scripts).size !== scripts.length ||
        JSON.stringify(manifest.permissions) !==
          JSON.stringify(originalManifest.permissions)
      ) {
        throw new Error(`依赖组接入不完整：${JSON.stringify(options)}`);
      }
      const pageScripts = await read("pages/all_content_scripts.js");
      for (const [minimum, module] of modules) {
        const occurrences = scripts.filter((item) => item === module).length;
        const imports = pageScripts.split(`import "../${module}";`).length - 1;
        if (
          occurrences !== Number(version >= minimum) ||
          imports !== Number(version >= minimum)
        ) {
          throw new Error(`依赖组脚本不一致：${version} ${module}`);
        }
      }
      const background = await read("background_scripts/main.js");
      for (const [minimum, service] of services) {
        const imports =
          background.split(`import "./browser_toolbox/${service}.js";`).length -
          1;
        if (imports !== Number(version >= minimum)) {
          throw new Error(`依赖组后台入口不一致：${version} ${service}`);
        }
      }
      for (
        const name of ["options", "command_listing", "doc_search_completion"]
      ) {
        const html = await read(`pages/${name}.html`);
        const independent = html.includes(
          'src="browser_toolbox/owned_page_entry.js"',
        );
        if (independent !== Boolean(options.settings || options.pages)) {
          throw new Error(`设置页入口不一致：${version} ${name}`);
        }
      }
    } finally {
      await Deno.remove(path.dirname(built.extensionPath), { recursive: true });
    }
  }
  if (
    originalPlan !==
      await Deno.readTextFile("lib/browser_toolbox/runtime_plan.js")
  ) {
    throw new Error("隔离构建改变了默认源码开关");
  }
});
