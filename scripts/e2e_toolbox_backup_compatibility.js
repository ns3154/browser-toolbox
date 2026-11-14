// SPDX-License-Identifier: GPL-3.0-or-later
// 在隔离配置中检查工具箱备份入口的版本转换与无法表达规则提示，不使用系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_BACKUP_COMPAT_REPORT");
const screenshotPath = Deno.env.get("BROWSER_TOOLBOX_BACKUP_SCREENSHOT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-backup-compat-" });
const report = {
  status: "running",
  source: "synthetic",
  checks: [],
  pageErrors: [],
  consoleErrors: [],
};
const secret = "synthetic-private-rule-value";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await wait(30);
  }
  throw new Error(label);
}
let browser;

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  const launch = () =>
    puppeteer.launch({
      executablePath,
      headless: true,
      protocolTimeout: 20000,
      defaultViewport: { width: 1280, height: 900 },
      userDataDir: path.join(temporary, "profile"),
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      ],
    });
  browser = await launch();
  report.chrome = await browser.version();
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const id = new URL(target.url()).host;
  const worker = await target.worker();
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "后台配置写入器未就绪",
  );
  const syntheticPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await worker.evaluate(async (encoded) => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const current = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const png = `data:image/png;base64,${encoded}`;
    await chrome.storage.local.set({ [id]: png });
    const toolbox = structuredClone(current.toolboxSource.value);
    toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
    await writer.commit({ toolbox, baseline: { toolbox: current.toolboxSource.value } });
  }, syntheticPng);
  const page = await browser.newPage();
  page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") report.consoleErrors.push(entry.text());
  });
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html#backupAbout`);
  await page.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
  await page.waitForSelector("#import-settings", { visible: true, timeout: 15000 });
  await page.bringToFront();
  assert(page.url().endsWith("/pages/mouse_options.html#backupAbout"), "设置入口地址不符");
  assert(await page.title() && await page.$("#browser-toolbox-title"), "设置页为空");
  let input = await page.$("#import-settings");
  const readSync = () => page.evaluate(() => chrome.storage.sync.get(null));
  const initialKeyboard = await page.evaluate(() => Settings.getSettings());
  let firstBackupKey, exportedBackup, pointerFile;
  let sequence = 0;

  const upload = async (payload, accept) => {
    const file = path.join(temporary, `synthetic-${++sequence}.json`);
    const raw = JSON.stringify(payload);
    await Deno.writeTextFile(file, raw);
    await page.$eval("#import-settings", (element) => {
      globalThis.__browserToolboxImportStarted = false;
      element.addEventListener("change", () => globalThis.__browserToolboxImportStarted = true, {
        once: true,
      });
    });
    console.log(`文件 ${sequence}：监听已设置`);
    const uploadPending = input.uploadFile(file).then(() => null, (failure) => failure);
    const result = await until(async () => {
      const state = await page.evaluate(() => ({
        started: globalThis.__browserToolboxImportStarted === true,
        open: Boolean(document.querySelector("#import-preview-dialog")?.open),
        finished: !document.querySelector("#import-settings").value &&
          !document.querySelector(".browser-toolbox-main").hasAttribute("inert"),
      }));
      return state.started && (state.open ? "preview" : state.finished ? "finished" : null);
    }, "导入没有返回预览或错误");
    console.log(`文件 ${sequence}：${result}`);
    let preview = "";
    if (result === "preview") {
      preview = await page.$eval("#import-preview-dialog", (element) => element.textContent);
      console.log(`文件 ${sequence}：准备${accept ? "确认" : "取消"}`);
      await page.bringToFront();
      await page.click(accept ? "#import-preview-confirm" : "#import-preview-cancel");
      console.log(`文件 ${sequence}：按钮已触发`);
      await until(() =>
        page.evaluate(() =>
          !document.querySelector("#import-settings").value &&
          !document.querySelector(".browser-toolbox-main").hasAttribute("inert")
        ), "导入未结束");
    }
    console.log(`文件 ${sequence}：等待文件事件`);
    const uploadFailure = await uploadPending;
    if (uploadFailure) throw uploadFailure;
    assert(await Deno.readTextFile(file) === raw, "原始备份文件被修改");
    return {
      preview,
      error: await page.$eval("#settings-error", (element) => element.textContent),
    };
  };

  const download = async (filename, selector) => {
    const directory = await Deno.makeTempDir({ dir: temporary, prefix: "download-" });
    const cdp = await browser.target().createCDPSession();
    let guid, progress;
    cdp.on("Browser.downloadWillBegin", (event) => {
      if (event.suggestedFilename === filename) guid = event.guid;
    });
    cdp.on("Browser.downloadProgress", (event) => {
      if (event.guid === guid) progress = event;
    });
    try {
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: directory,
        eventsEnabled: true,
      });
      await page.bringToFront();
      await page.click(selector);
      await until(() => {
        assert(progress?.state !== "canceled", "下载被取消");
        return progress?.state === "completed";
      }, "下载未完成");
      const file = path.join(directory, filename);
      const bytes = await Deno.readFile(file);
      assert(bytes.length === progress.receivedBytes, "下载字节数不一致");
      return { file, bytes };
    } finally {
      await cdp.detach();
    }
  };

  const check = async (name, task) => {
    console.log(`开始：${name}`);
    try {
      await task();
      report.checks.push({ name, status: "passed" });
    } catch (failure) {
      report.checks.push({ name, status: "failed", error: failure.message });
    }
    console.log(`结束：${name}`);
  };

  await check("旧版新标签地址迁移后再导入", async () => {
    const result = await upload({
      settingsVersion: "2.3",
      scrollStepSize: 77,
      newTabUrl: "https://example.invalid/old-new-tab",
      unrelatedHistory: secret,
    }, true);
    const after = await readSync();
    assert(result.preview && result.preview.includes("unrelatedHistory"), "预览缺少忽略字段");
    assert(!result.preview.includes(secret), "预览包含未知字段正文");
    assert(after.scrollStepSize === 77, "已识别字段没有导入");
    assert(
      after.newTabDestination === "customUrl" &&
        after.newTabCustomUrl === "https://example.invalid/old-new-tab",
      "旧版新标签地址没有转换",
    );
  });

  await check("导入前备份可查看并导出，文件不包含本地指针图片", async () => {
    await page.waitForFunction(() =>
      document.querySelector("#import-backup-select")?.value &&
      !document.querySelector("#import-backup-export")?.disabled, { polling: 50, timeout: 15000 });
    firstBackupKey = await page.$eval("#import-backup-select", (element) => element.value);
    const stored = await page.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      firstBackupKey,
    );
    assert(
      stored?.snapshot?.keyboard?.scrollStepSize === initialKeyboard.scrollStepSize,
      "本地备份没有保存导入前的设置",
    );
    assert(
      stored.cursorAsset?.present && stored.cursorAsset.value.startsWith("data:image/png;base64,"),
      "本地备份没有保存指针图片",
    );
    if (screenshotPath) {
      await page.bringToFront();
      await page.screenshot({ path: screenshotPath });
    }
    const { bytes } = await download("browser-toolbox-before-import.json", "#import-backup-export");
    const raw = new TextDecoder().decode(bytes);
    exportedBackup = JSON.parse(raw);
    assert(
      exportedBackup.keyboardSettings.values.scrollStepSize === initialKeyboard.scrollStepSize,
      "导出的不是导入前键盘配置",
    );
    assert(!raw.includes("data:image/png;base64,"), "导出包含本地指针图片");
    const notice = await page.$eval("#import-backup-status", (element) => element.textContent);
    assert(
      notice === await page.evaluate(() => BrowserToolboxI18n.message("importBackupExported")),
      "导出后没有提示本地图片不包含在文件中",
    );
  });
  await check("恢复差异预览只展示字段和资源状态，不修改存储", async () => {
    const syncBefore = await readSync();
    const localBefore = await page.evaluate(() => chrome.storage.local.get(null));
    await page.bringToFront();
    await page.click("#import-backup-preview");
    await page.waitForFunction(
      () =>
        document.querySelector("#import-backup-status").textContent.includes(
          BrowserToolboxI18n.message("importBackupPreviewIntro"),
        ),
      { polling: 50, timeout: 15000 },
    );
    const notice = await page.$eval("#import-backup-status", (element) => element.textContent);
    assert(notice.includes("scrollStepSize"), "预览没有列出不同的键盘字段");
    assert(
      !notice.includes("example.invalid") && !notice.includes(syntheticPng),
      "预览泄露配置正文或指针数据",
    );
    assert(equal(syncBefore, await readSync()), "恢复预览修改了同步设置");
    assert(
      equal(localBefore, await page.evaluate(() => chrome.storage.local.get(null))),
      "恢复预览修改了本机存储",
    );
  });
  await check("可单独导出备份中的指针原图并完整解码", async () => {
    assert(
      !await page.$eval("#import-backup-export-cursor", (element) => element.disabled),
      "有指针资源的备份没有开放导出",
    );
    const { file, bytes } = await download(
      "browser-toolbox-pointer.png",
      "#import-backup-export-cursor",
    );
    pointerFile = file;
    const expected = Uint8Array.from(atob(syntheticPng), (value) => value.charCodeAt(0));
    assert(equal([...bytes], [...expected]), "导出的指针文件与本机备份不一致");
    const decoded = await page.evaluate(async (data) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(data)], { type: "image/png" }),
      );
      const size = [image.width, image.height];
      image.close();
      return size;
    }, [...bytes]);
    assert(equal(decoded, [1, 1]), "测试指针图片无法完整解码");
  });
  await check("窄窗口中备份选择和导出控件可见且不横向溢出", async () => {
    await page.setViewport({ width: 600, height: 900 });
    try {
      await page.$eval(
        "#import-backup-select",
        (element) => element.scrollIntoView({ block: "center" }),
      );
      const dimensions = await page.evaluate(() => {
        const select = document.querySelector("#import-backup-select").getBoundingClientRect();
        const button = document.querySelector("#import-backup-export").getBoundingClientRect();
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          select: { left: select.left, right: select.right },
          button: { left: button.left, right: button.right },
        };
      });
      assert(dimensions.scrollWidth <= dimensions.width + 1, "页面出现横向溢出");
      assert(
        dimensions.select.left >= 0 && dimensions.select.right <= dimensions.width &&
          dimensions.button.left >= 0 && dimensions.button.right <= dimensions.width,
        "备份选择或导出控件超出视口",
      );
      if (screenshotPath) {
        await page.screenshot({ path: screenshotPath.replace(/\.png$/, "-窄屏.png") });
      }
    } finally {
      await page.setViewport({ width: 1280, height: 900 });
    }
  });
  await check("动作页无法导入、读取或导出导入前备份", async () => {
    const other = await browser.newPage();
    try {
      await other.goto(`chrome-extension://${id}/pages/action.html`);
      const responses = await other.evaluate(async (key) => {
        const send = (action, input = {}) =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action,
            input,
          });
        return [
          await send("list-import-backups"),
          await send("export-import-backup", { key }),
          await send("preview-import-restore", { key }),
          await send("export-import-cursor", { key }),
          await send("import", { legacyPatch: { scrollStepSize: 97 } }),
        ];
      }, firstBackupKey);
      assert(
        responses.every((item) => !item.ok && item.code === "PERMISSION_DENIED"),
        "非设置页面可访问备份",
      );
    } finally {
      await other.close();
      await page.bringToFront();
    }
    const keyboardPage = await browser.newPage();
    try {
      await keyboardPage.goto(`chrome-extension://${id}/pages/options.html`);
      const response = await keyboardPage.evaluate((key) =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "export-import-cursor",
          input: { key },
        }), firstBackupKey);
      assert(!response.ok && response.code === "PERMISSION_DENIED", "键盘设置页可读取本机图片正文");
    } finally {
      await keyboardPage.close();
      await page.bringToFront();
    }
  });

  const unsupported = [{
    pattern: "https://example.invalid/*",
    passKeys: "",
    enabled: false,
    futurePolicy: secret,
  }];
  const rejectsRule = async (payload) => {
    const sync = await readSync();
    const result = await upload(payload, false);
    assert(!result.preview, "不可表达的规则进入了可确认导入");
    assert(result.error.includes("enabled"), "错误没有提示无法表达的字段路径");
    assert(!result.error.includes(secret), "错误包含规则字段的值");
    assert(equal(sync, await readSync()), "拒绝导入时修改了配置");
  };
  await check(
    "旧备份中的额外规则字段阻止导入",
    () => rejectsRule({ settingsVersion: "2.4.2", exclusionRules: unsupported }),
  );
  await check("工具箱键盘字段中的额外规则字段阻止导入", () =>
    rejectsRule({
      format: "browser-toolbox-settings",
      formatVersion: 1,
      settings: { schemaVersion: 9 },
      keyboardSettings: { formatVersion: 1, values: { exclusionRules: unsupported } },
    }));
  await check("旧工具箱备份的规则额外字段阻止导入", () =>
    rejectsRule({
      format: "browser-toolbox-settings",
      formatVersion: 1,
      settings: { schemaVersion: 9, exclusionRules: unsupported },
    }));
  await check("没有键盘分区的旧工具箱备份恢复明确保存的规则", async () => {
    const rules = [{ pattern: "https://example.invalid/kept/*", passKeys: "" }];
    const result = await upload({
      format: "browser-toolbox-settings",
      formatVersion: 1,
      settings: { schemaVersion: 9, exclusionRules: rules },
    }, true);
    assert(result.preview, "有效备份没有显示确认预览");
    assert(equal((await readSync()).exclusionRules, rules), "明确保存的排除规则没有恢复");
  });
  await check("导出文件可经预览恢复，原本地指针副本仍在备份中", async () => {
    assert(exportedBackup && firstBackupKey, "缺少先前导出的备份");
    const result = await upload(exportedBackup, true);
    assert(result.preview, "恢复前没有显示确认预览");
    const restored = await page.evaluate(() => Settings.getSettings());
    assert(restored.scrollStepSize === initialKeyboard.scrollStepSize, "导出文件未恢复之前的设置");
    const local = await page.evaluate(async (key) => {
      const value = (await chrome.storage.local.get(key))[key];
      return {
        assetPresent: value?.cursorAsset?.present === true,
        asset: value?.cursorAsset?.value,
      };
    }, firstBackupKey);
    assert(
      local.assetPresent && local.asset.startsWith("data:image/png;base64,"),
      "后续导入破坏了本地备份中的指针图片",
    );
  });
  await check("导出的指针可在外观设置重新选择并保存", async () => {
    assert(pointerFile, "缺少先前导出的指针文件");
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html#appearance`);
    await page.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
    await page.waitForSelector("#cursor-file", { visible: true, timeout: 15000 });
    await page.bringToFront();
    await (await page.$("#cursor-file")).uploadFile(pointerFile);
    await page.waitForFunction(() =>
      !document.querySelector("#cursor-preview").hidden &&
      !document.querySelector("#save-settings").disabled, { polling: 50, timeout: 15000 });
    await page.click("#save-settings");
    await page.waitForFunction(
      () =>
        document.querySelector("#save-status").textContent === BrowserToolboxI18n.message("saved"),
      { polling: 50, timeout: 15000 },
    );
    const restored = await page.evaluate(async (encoded) => {
      const snapshot = await BrowserToolboxConfigurationClientInstance.read();
      const cursor = snapshot.toolboxSource.value.cursor;
      const asset = cursor.localAssetId &&
        (await chrome.storage.local.get(cursor.localAssetId))[cursor.localAssetId];
      return { enabled: cursor.enabled, matches: asset === `data:image/png;base64,${encoded}` };
    }, syntheticPng);
    assert(restored.enabled && restored.matches, "重新选择后指针未保存或内容不一致");
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html#backupAbout`);
    await page.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
    await page.waitForSelector("#import-settings", { visible: true, timeout: 15000 });
    await page.bringToFront();
    input = await page.$("#import-settings");
  });
  await check("本机备份含不可表达字段时导出保留原值并提示", async () => {
    const beforeList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const existing = new Set(beforeList.map((item) => item.key));
    const activeTarget = await browser.waitForTarget((item) =>
      item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
    );
    const activeWorker = await activeTarget.worker();
    await activeWorker.evaluate(async () => {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      const before = await writer.read();
      await writer.commit({
        legacyPatch: {
          exclusionRules: [{ pattern: "https://example.invalid/*", passKeys: "", enabled: false }],
        },
        baseline: { keyboard: before.keyboard },
      });
    });
    await page.reload();
    await page.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
    await page.bringToFront();
    input = await page.$("#import-settings");
    const imported = await upload({ settingsVersion: "2.4.2", scrollStepSize: 85 }, true);
    assert(imported.preview, "有效备份没有显示确认预览");
    const afterList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const newEntry = afterList.find((item) => !existing.has(item.key));
    assert(newEntry?.status === "valid", "没有保存包含额外字段的导入前备份");
    await page.waitForFunction(
      (key) =>
        [...document.querySelector("#import-backup-select").options].some((item) =>
          item.value === key
        ),
      { polling: 50, timeout: 15000 },
      newEntry.key,
    );
    await page.select("#import-backup-select", newEntry.key);
    const downloads = path.join(temporary, "downloads-unsupported");
    await Deno.mkdir(downloads);
    const cdp = await browser.target().createCDPSession();
    let guid, progress;
    cdp.on("Browser.downloadWillBegin", (event) => guid = event.guid);
    cdp.on("Browser.downloadProgress", (event) => {
      if (event.guid === guid) progress = event;
    });
    let raw;
    try {
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
      });
      await page.bringToFront();
      await page.click("#import-backup-export");
      await until(() => progress?.state === "completed", "兼容限制备份下载未完成");
      raw = await Deno.readTextFile(path.join(downloads, "browser-toolbox-before-import.json"));
    } finally {
      await cdp.detach();
    }
    const exported = JSON.parse(raw);
    assert(
      exported.keyboardSettings.values.exclusionRules[0].enabled === false,
      "导出丢失无法表达的规则字段",
    );
    const notice = await page.$eval("#import-backup-status", (element) => element.textContent);
    assert(notice.includes("exclusionRules[0].enabled"), "导出没有说明无法表达的字段");
    const rejected = await upload(exported, false);
    assert(!rejected.preview && rejected.error.includes("enabled"), "不可表达的备份被静默导入");
  });
  await check("损坏的本地指针资源在备份列表提示并保留原始内容", async () => {
    const beforeList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const existing = new Set(beforeList.map((item) => item.key));
    const activeTarget = await browser.waitForTarget((item) =>
      item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
    );
    const activeWorker = await activeTarget.worker();
    await activeWorker.evaluate(async () => {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      const before = await writer.read();
      const id = "browserToolboxCursor-abcdefgh";
      await chrome.storage.local.set({ [id]: "data:image/png;base64,bm90LWEtcG5n" });
      const toolbox = structuredClone(before.toolboxSource.value);
      toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
      await writer.commit({ toolbox, baseline: { toolbox: before.toolboxSource.value } });
    });
    await page.reload();
    await page.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
    await page.bringToFront();
    input = await page.$("#import-settings");
    assert(
      (await upload({ settingsVersion: "2.4.2", scrollStepSize: 86 }, true)).preview,
      "有效备份没有显示预览",
    );
    const afterList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const entry = afterList.find((item) => !existing.has(item.key));
    assert(entry?.cursorAssetInvalid === true, "没有标记损坏的本地指针资源");
    await page.waitForFunction(
      (key) =>
        [...document.querySelector("#import-backup-select").options].some((item) =>
          item.value === key &&
          item.textContent.includes(BrowserToolboxI18n.message("importBackupAssetInvalid"))
        ),
      { polling: 50, timeout: 15000 },
      entry.key,
    );
    const retained = await page.evaluate(async (key) => {
      const backup = (await chrome.storage.local.get(key))[key];
      return backup.cursorAsset.value === "data:image/png;base64,bm90LWEtcG5n";
    }, entry.key);
    assert(retained, "本机备份没有保留损坏的原资源");
    await page.select("#import-backup-select", entry.key);
    await page.click("#import-backup-preview");
    await page.waitForFunction(
      () =>
        document.querySelector("#import-backup-status").textContent.includes(
          BrowserToolboxI18n.message("importBackupCursorInvalid"),
        ),
      { polling: 50, timeout: 15000 },
    );
    const original = await download(
      "browser-toolbox-pointer-original.bin",
      "#import-backup-export-cursor",
    );
    assert(new TextDecoder().decode(original.bytes) === "not-a-png", "损坏资源的原始字节未被保留");
    const notice = await page.$eval("#import-backup-status", (element) => element.textContent);
    assert(
      notice ===
        await page.evaluate(() => BrowserToolboxI18n.message("importBackupCursorExportedInvalid")),
      "损坏资源导出后没有提示限制",
    );
  });
  await check("无法解码的资源不触发下载，原备份仍保留", async () => {
    const beforeList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const existing = new Set(beforeList.map((item) => item.key));
    await page.evaluate(() =>
      chrome.storage.local.set({
        "browserToolboxCursor-abcdefgh": "data:image/png;base64,!!!!",
      })
    );
    assert(
      (await upload({ settingsVersion: "2.4.2", scrollStepSize: 87 }, true)).preview,
      "有效设置备份没有显示预览",
    );
    const afterList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const entry = afterList.find((item) => !existing.has(item.key));
    assert(entry?.cursorAssetInvalid === true, "没有标记不可解码的本地资源");
    await page.waitForFunction(
      (key) =>
        [...document.querySelector("#import-backup-select").options].some((item) =>
          item.value === key
        ),
      { polling: 50, timeout: 15000 },
      entry.key,
    );
    await page.select("#import-backup-select", entry.key);
    const cdp = await browser.target().createCDPSession();
    let started = false;
    cdp.on("Browser.downloadWillBegin", () => started = true);
    try {
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: temporary,
        eventsEnabled: true,
      });
      await page.click("#import-backup-export-cursor");
      await page.waitForFunction(
        () =>
          document.querySelector("#import-backup-status").textContent ===
            BrowserToolboxI18n.message("importBackupCursorDecodeFailed"),
        { polling: 50, timeout: 15000 },
      );
      assert(!started, "不可解码资源意外触发下载");
    } finally {
      await cdp.detach();
    }
    assert(
      await page.evaluate(async (key) => {
        const backup = (await chrome.storage.local.get(key))[key];
        return backup.cursorAsset.value === "data:image/png;base64,!!!!";
      }, entry.key),
      "不可解码的原始资源未保留",
    );
  });
  await check("导入前备份落盘后终止后台，重启仍可查看且业务设置不变", async () => {
    const syncBefore = await readSync();
    const beforeList = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const existing = new Set(beforeList.map((item) => item.key));
    const activeTarget = await browser.waitForTarget((item) =>
      item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
    );
    const activeWorker = await activeTarget.worker();
    await activeWorker.evaluate(async () => {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      const before = await writer.read();
      writer.afterStep = (step) => {
        if (step === "import-backup") {
          globalThis.__browserToolboxImportBackupBarrier = true;
          return new Promise(() => {});
        }
      };
      globalThis.__browserToolboxPendingImport = writer.importConfiguration({
        legacyPatch: { scrollStepSize: 96 },
        baseline: { keyboard: before.keyboard },
      });
      globalThis.__browserToolboxPendingImport.catch(() => {});
    });
    await until(
      () => activeWorker.evaluate(() => globalThis.__browserToolboxImportBackupBarrier === true),
      "后台未到达导入前备份中断点",
    );
    const keys = await page.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)).filter((key) =>
        key.startsWith(BrowserToolboxConfigurationStore.IMPORT_BACKUP_PREFIX)
      )
    );
    const savedKey = keys.find((key) => !existing.has(key));
    assert(
      savedKey && keys.filter((key) => !existing.has(key)).length === 1,
      "中断前未找到唯一新增备份",
    );
    const cdp = await browser.target().createCDPSession();
    try {
      const targetInfo = (await cdp.send("Target.getTargets")).targetInfos.find((item) =>
        item.type === "service_worker" &&
        item.url === `chrome-extension://${id}/background_scripts/main.js`
      );
      assert(targetInfo, "未找到准备中断的后台");
      assert(
        (await cdp.send("Target.closeTarget", { targetId: targetInfo.targetId })).success,
        "后台终止失败",
      );
    } finally {
      await cdp.detach();
    }
    await browser.close();
    browser = null;
    browser = await launch();
    const restarted = await browser.newPage();
    await restarted.goto(`chrome-extension://${id}/pages/mouse_options.html#backupAbout`);
    await restarted.waitForSelector('main[data-settings-ready="true"]', { timeout: 15000 });
    const state = await restarted.evaluate(async (key) => {
      const items = await BrowserToolboxConfigurationClientInstance.request("list-import-backups");
      const sync = await chrome.storage.sync.get(null);
      return { item: items.find((item) => item.key === key), sync };
    }, savedKey);
    assert(state.item?.status === "valid", "重启后无法验证导入前备份");
    assert(equal(state.sync, syncBefore), "后台中断改变了业务设置");
    assert(state.sync.scrollStepSize !== 96, "中断前的导入意外生效");
  });
  assert(
    report.pageErrors.length === 0 && report.consoleErrors.length === 0,
    "设置页出现 JavaScript 或控制台错误",
  );
  if (report.checks.some((item) => item.status === "failed")) throw new Error("备份兼容检查失败");
  report.status = "passed";
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  await Deno.remove(temporary, { recursive: true });
}
console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") Deno.exit(1);
