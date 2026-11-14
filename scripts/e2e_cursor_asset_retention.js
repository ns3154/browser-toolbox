// SPDX-License-Identifier: GPL-3.0-or-later
// 使用独立合成浏览器复现指针资源删除竞态和提交响应丢失，不访问系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_CURSOR_RETENTION_REPORT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-cursor-retention-" });
const report = { status: "running", source: "synthetic", checks: [], pageErrors: [] };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl = `data:image/png;base64,${png}`;
const originalId = "browserToolboxCursor-12345678";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function until(predicate, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error(label);
}
let browser;
let page;
try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  const imagePath = path.join(temporary, "synthetic.png");
  await Deno.writeFile(imagePath, Uint8Array.from(atob(png), (value) => value.charCodeAt(0)));
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 30000,
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
  report.chrome = await browser.version();
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const worker = await target.worker();
  const extensionId = new URL(target.url()).host;
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "后台未启动",
  );
  const other = await browser.newPage();
  await other.goto(`chrome-extension://${extensionId}/pages/mouse_options.html#appearance`);
  await other.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50 },
  );

  const seed = async () => {
    await worker.evaluate(async ({ id, asset }) => {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      const current = await writer.read();
      await chrome.storage.local.set({ [id]: asset });
      const toolbox = structuredClone(current.toolboxSource.value);
      toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
      await writer.commit({ toolbox, baseline: { toolbox: current.toolboxSource.value } });
    }, { id: originalId, asset: dataUrl });
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
    await page.goto(`chrome-extension://${extensionId}/pages/mouse_options.html#appearance`);
    await page.bringToFront();
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.settingsReady === "true",
      { polling: 50 },
    );
    await until(
      () => page.$eval("#cursor-enabled", (element) => element.checked),
      "合成指针未加载",
    );
  };
  const uploadPointer = async () => {
    await (await page.$("#cursor-file")).uploadFile(imagePath);
    await until(
      () => page.$eval("#save-settings", (element) => !element.disabled),
      "指针选择未成为草稿",
    );
  };
  const save = async () => {
    await page.$eval("#save-settings", (element) => element.click());
    await until(() =>
      page.evaluate(() => {
        const main = document.querySelector(".browser-toolbox-main");
        return !main.hasAttribute("inert") &&
          (document.querySelector("#settings-error").textContent ||
            document.querySelector("#save-status").textContent);
      }), "保存未结束");
  };
  const currentCursor = async () => {
    return await worker.evaluate(async () => {
      const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
      const current = await writer.read();
      const id = current.toolboxSource.value.cursor.localAssetId;
      return {
        id,
        cursor: current.toolboxSource.value.cursor,
        value: id ? (await chrome.storage.local.get(id))[id] : null,
      };
    });
  };
  const oldAsset = async () => {
    return await page.evaluate(async (id) => (await chrome.storage.local.get(id))[id], originalId);
  };
  const check = async (name, task) => {
    console.log(`开始：${name}`);
    try {
      await task();
      report.checks.push({ name, status: "passed" });
      console.log(`通过：${name}`);
    } catch (failure) {
      report.checks.push({ name, status: "failed", error: failure.message });
      console.error(`失败：${name}: ${failure.message}`);
    }
  };
  const restoreOriginalFromOther = async () => {
    return await other.evaluate(async (id) => {
      const client = globalThis.BrowserToolboxConfigurationClientInstance;
      const current = await client.read();
      const toolbox = structuredClone(current.toolboxSource.value);
      toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
      const result = await client.commit({
        toolbox,
        baseline: { toolbox: current.toolboxSource.value },
      });
      return result.toolboxSource.value.cursor.localAssetId;
    }, originalId);
  };

  const reviewOriginalCursor = async () => {
    await page.$eval("#local-cursor-refresh", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-select", (element) => element.options.length > 0),
      "图片列表未加载",
    );
    while (
      !await page.$eval(
        "#local-cursor-select",
        (element, key) => [...element.options].some((option) => option.value === key),
        originalId,
      )
    ) {
      assert(
        await page.$eval("#local-cursor-more", (element) => !element.hidden),
        "原图片不在列表",
      );
      const previousCount = await page.$eval(
        "#local-cursor-select",
        (element) => element.options.length,
      );
      await page.$eval("#local-cursor-more", (element) => element.click());
      await until(
        () =>
          page.$eval(
            "#local-cursor-select",
            (element, count) => element.options.length > count,
            previousCount,
          ),
        "加载图片后续页面失败",
      );
    }
    await page.$eval("#local-cursor-select", (element, key) => {
      element.value = key;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, originalId);
    await page.$eval("#local-cursor-view", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-export", (element) => !element.disabled),
      "图片未查看",
    );
    assert(
      await page.$eval("#local-cursor-preview", (element) => !element.hidden),
      "图片未成功解码",
    );
  };

  const createPointerBackup = async (asset = dataUrl) => {
    await seed();
    await page.evaluate(({ id, value }) => chrome.storage.local.set({ [id]: value }), {
      id: originalId,
      value: asset,
    });
    const previous = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const payload = await page.evaluate(() =>
      BrowserToolboxSettingsMigrations.createExportPayload(
        structuredClone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS),
      )
    );
    const file = path.join(temporary, `synthetic-backup-${crypto.randomUUID()}.json`);
    await Deno.writeTextFile(file, JSON.stringify(payload));
    await (await page.$("#import-settings")).uploadFile(file);
    await page.waitForFunction(() => document.querySelector("#import-preview-dialog")?.open, {
      polling: 50,
    });
    await page.$eval("#import-preview-confirm", (element) => element.click());
    await until(() =>
      page.evaluate(() =>
        !document.querySelector("#import-preview-dialog")?.open &&
        !document.querySelector(".browser-toolbox-main").hasAttribute("inert")
      ), "备份准备导入未完成");
    const backups = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const backup = backups.find((item) => !previous.some((old) => old.key === item.key));
    assert(backup?.status === "valid" && backup.cursorAssetPresent, "未创建包含图片的备份");
    await until(
      () => page.$eval("#import-backup-refresh", (element) => !element.disabled),
      "备份列表仍在刷新",
    );
    await page.$eval("#import-backup-refresh", (element) => element.click());
    await until(
      () =>
        page.evaluate((key) =>
          !document.querySelector("#import-backup-refresh").disabled &&
          [...document.querySelector("#import-backup-select").options].some((option) =>
            option.value === key
          ), backup.key),
      "备份未列出或刷新未结束",
    );
    await page.$eval("#import-backup-select", (element, key) => {
      element.value = key;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, backup.key);
    await page.$eval('button[data-section="backupAbout"]', (element) => element.click());
    return backup.key;
  };

  await check("后台提交成功但页面丢失响应时保留新指针", async () => {
    await seed();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__syntheticLostAck = false;
      chrome.runtime.sendMessage = async (...args) => {
        const result = await original(...args);
        if (
          !globalThis.__syntheticLostAck && args[0]?.handler === "browserToolbox.configuration" &&
          args[0]?.action === "commit" && result?.ok
        ) {
          globalThis.__syntheticLostAck = true;
          throw new Error("合成：提交成功后响应丢失");
        }
        return result;
      };
    });
    await uploadPointer();
    await save();
    assert(await page.evaluate(() => globalThis.__syntheticLostAck), "未注入提交后的响应丢失");
    const current = await currentCursor();
    assert(current.id && current.id !== originalId, "后台未实际提交新指针");
    assert(current.value === dataUrl, "已提交的新指针资源被错误删除");
    assert(await oldAsset() === dataUrl, "旧指针资源被错误删除");
  });

  await check("保存后另一页面重新引用旧指针时保留原资源", async () => {
    await seed();
    let intervened = false;
    await page.exposeFunction("__syntheticConcurrentReference", async () => {
      intervened = true;
      assert(await restoreOriginalFromOther() === originalId, "并发页面未引用旧资源");
    });
    const hooked = await page.evaluate((id) => {
      const area = chrome.storage.local;
      const remove = area.remove.bind(area);
      area.remove = async (keys) => {
        if ((Array.isArray(keys) ? keys : [keys]).includes(id)) {
          await globalThis.__syntheticConcurrentReference();
        }
        return await remove(keys);
      };
      return area.remove !== remove;
    }, originalId);
    assert(hooked, "不能建立合成删除屏障");
    await uploadPointer();
    await save();
    if (!intervened) assert(await restoreOriginalFromOther() === originalId, "无法再次引用旧资源");
    const current = await currentCursor();
    report.concurrentBarrierTriggered = intervened;
    assert(current.id === originalId, "当前配置未引用原指针");
    assert(
      current.value === dataUrl && await oldAsset() === dataUrl,
      "另一个页面正在使用的旧指针被删除",
    );
  });

  await check("禁用指针后保留原始图片", async () => {
    await seed();
    await page.$eval("#reset-cursor", (element) => element.click());
    await save();
    const current = await currentCursor();
    assert(current.id === null && !current.cursor.enabled, "指针未禁用");
    assert(await oldAsset() === dataUrl, "禁用后旧资源被删除");
  });

  await check("恢复默认设置后保留原始图片", async () => {
    await seed();
    await page.evaluate(() =>
      globalThis.confirm = (text) => {
        globalThis.__syntheticRestorePrompt = text;
        return true;
      }
    );
    await page.$eval("#restore-defaults", (element) => element.click());
    await until(
      () =>
        page.evaluate(() =>
          !document.querySelector(".browser-toolbox-main").hasAttribute("inert") &&
          Boolean(document.querySelector("#save-status").textContent)
        ),
      "恢复默认未完成",
    );
    const current = await currentCursor();
    assert(current.id === null && !current.cursor.enabled, "默认设置未禁用指针");
    assert(await oldAsset() === dataUrl, "恢复默认后旧资源被删除");
    assert(
      await page.evaluate(() => globalThis.__syntheticRestorePrompt.includes("旧指针图片仍会保留")),
      "恢复默认确认缺少资源保留说明",
    );
  });

  await check("导入设置后保留图片和导入前备份", async () => {
    await seed();
    const payload = await page.evaluate(() =>
      globalThis.BrowserToolboxSettingsMigrations.createExportPayload(
        structuredClone(globalThis.BrowserToolboxSettingsSchema.DEFAULT_SETTINGS),
      )
    );
    const file = path.join(temporary, "synthetic-settings.json");
    await Deno.writeTextFile(file, JSON.stringify(payload));
    await (await page.$("#import-settings")).uploadFile(file);
    await page.waitForFunction(() => document.querySelector("#import-preview-dialog")?.open, {
      polling: 50,
    });
    await page.$eval("#import-preview-confirm", (element) => element.click());
    await until(() =>
      page.evaluate(() =>
        !document.querySelector("#import-preview-dialog")?.open &&
        !document.querySelector(".browser-toolbox-main").hasAttribute("inert")
      ), "导入未完成");
    const current = await currentCursor();
    assert(current.id === null && !current.cursor.enabled, "导入未禁用本机指针");
    assert(await oldAsset() === dataUrl, "导入后旧资源被删除");
    const backups = await page.evaluate(() =>
      globalThis.BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    assert(backups.some((item) => item.cursorAssetPresent), "导入前图片备份缺失");
  });

  await check("备份图片进入草稿并经原保存队列恢复", async () => {
    const key = await createPointerBackup();
    assert(
      await page.$eval("#import-backup-use-cursor", (element) => !element.disabled),
      "无法选择备份图片",
    );
    const expectedHud = await page.$eval("#global-show-hud", (element) => {
      element.checked = !element.checked;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.checked;
    });
    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    await page.$eval("#import-backup-use-cursor", (element) => element.click());
    await until(
      () =>
        page.evaluate(() =>
          Boolean(document.querySelector("#dirty-status").textContent) &&
          !document.querySelector('[data-panel="appearance"]').hidden &&
          !document.querySelector(".browser-toolbox-main").hasAttribute("inert")
        ),
      "备份图片未进入草稿",
    );
    assert(
      await page.$eval('[data-panel="appearance"]', (element) => !element.hidden),
      "未显示指针草稿",
    );
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(JSON.stringify(before) === JSON.stringify(after), "备份图片放入草稿时写入存储");
    assert((await currentCursor()).id === null, "保存前已启用备份图片");
    await save();
    const current = await currentCursor();
    assert(
      current.id && current.id !== originalId && current.value === dataUrl,
      "备份图片未通过原保存流程恢复",
    );
    const savedHud = await worker.evaluate(async () =>
      (await BrowserToolboxConfigurationWriterInstance.read()).toolboxSource.value.general.showHud
    );
    assert(savedHud === expectedHud, "复用备份图片丢失其他未保存设置");
    assert(await oldAsset() === dataUrl, "原图片被修改或删除");
    assert(
      await page.evaluate(
        async (key) => Object.hasOwn(await chrome.storage.local.get(key), key),
        key,
      ),
      "原备份被删除",
    );
  });

  await check("损坏的备份图片不能放入草稿，原数据保留", async () => {
    const truncated = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const key = await createPointerBackup(truncated);
    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(
      await page.$eval("#import-backup-use-cursor", (element) => !element.disabled),
      "损坏备份图片入口未开放",
    );
    await page.$eval("#import-backup-use-cursor", (element) => element.click());
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("importBackupCursorUseInvalid")
    );
    try {
      await until(
        () =>
          page.$eval(
            "#import-backup-status",
            (element, expected) => element.textContent === expected,
            expected,
          ),
        "无效图片未返回提示",
      );
    } catch (failure) {
      const state = await page.evaluate(() => ({
        status: document.querySelector("#import-backup-status")?.textContent,
        disabled: document.querySelector("#import-backup-use-cursor")?.disabled,
        inert: document.querySelector(".browser-toolbox-main")?.hasAttribute("inert"),
        dirty: document.querySelector("#dirty-status")?.textContent,
      }));
      throw new Error(`${failure.message}: ${JSON.stringify(state)}`);
    }
    assert(
      !await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "无效备份图片改变了草稿",
    );
    assert((await currentCursor()).id === null, "无效图片改变了配置");
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(JSON.stringify(before) === JSON.stringify(after), "无效备份图片改变了存储");
    assert(await oldAsset() === truncated, "无效图片原始值丢失");
    assert(Object.hasOwn(after.local, key), "无效图片的备份丢失");
  });

  await check("等待备份图片期间切换分区，不抢回用户导航", async () => {
    await createPointerBackup();
    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (...args) => {
        const result = await original(...args);
        if (
          args[0]?.handler === "browserToolbox.configuration" &&
          args[0]?.action === "export-import-cursor"
        ) {
          globalThis.__syntheticBackupReady = true;
          await new Promise((resolve) => globalThis.__releaseSyntheticBackup = resolve);
        }
        return result;
      };
    });
    await page.$eval("#import-backup-use-cursor", (element) => element.click());
    await until(
      () => page.evaluate(() => Boolean(globalThis.__syntheticBackupReady)),
      "备份读取屏障未建立",
    );
    await page.$eval('button[data-section="privacy"]', (element) => element.click());
    await page.evaluate(() => globalThis.__releaseSyntheticBackup());
    await until(
      () =>
        page.evaluate(() =>
          !document.querySelector(".browser-toolbox-main").hasAttribute("inert") &&
          Boolean(document.querySelector("#dirty-status").textContent)
        ),
      "备份图片草稿未完成",
    );
    assert(
      await page.$eval('[data-panel="privacy"]', (element) => !element.hidden),
      "异步完成后抢回用户导航",
    );
    assert((await currentCursor()).id === null, "保存前配置已改变");
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(JSON.stringify(before) === JSON.stringify(after), "导航期间生成草稿修改了存储");
  });

  await check("读取备份图片无响应时恢复界面且不更改存储", async () => {
    await createPointerBackup();
    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        if (
          args[0]?.handler === "browserToolbox.configuration" &&
          args[0]?.action === "export-import-cursor"
        ) return new Promise(() => {});
        return original(...args);
      };
    });
    await page.$eval("#import-backup-use-cursor", (element) => element.click());
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("importBackupCursorUseFailed")
    );
    await until(
      () =>
        page.$eval(
          "#import-backup-status",
          (element, expected) => element.textContent === expected,
          expected,
        ),
      "读取超时未提示",
    );
    assert(
      !await page.$eval(".browser-toolbox-main", (element) => element.hasAttribute("inert")),
      "超时后界面仍被锁住",
    );
    assert(
      !await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "超时错误生成草稿",
    );
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(JSON.stringify(before) === JSON.stringify(after), "超时读取改变了存储");
  });

  await check("备份图片解码无响应时恢复界面并保留备份", async () => {
    const key = await createPointerBackup();
    const before = await page.evaluate(() => chrome.storage.local.get(null));
    await page.evaluate(() => Image.prototype.decode = () => new Promise(() => {}));
    await page.$eval("#import-backup-use-cursor", (element) => element.click());
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("importBackupCursorUseInvalid")
    );
    await until(
      () =>
        page.$eval(
          "#import-backup-status",
          (element, expected) => element.textContent === expected,
          expected,
        ),
      "解码超时未提示",
    );
    assert(
      !await page.$eval(".browser-toolbox-main", (element) => element.hasAttribute("inert")),
      "解码超时后界面仍被锁住",
    );
    assert(
      !await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "解码超时错误生成草稿",
    );
    const after = await page.evaluate(() => chrome.storage.local.get(null));
    assert(
      JSON.stringify(before) === JSON.stringify(after) && Object.hasOwn(after, key),
      "解码超时改变或删除备份",
    );
  });

  await check("无图片的备份不能启用图片草稿入口", async () => {
    await seed();
    await page.$eval("#reset-cursor", (element) => element.click());
    await save();
    const previous = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const payload = await page.evaluate(() =>
      BrowserToolboxSettingsMigrations.createExportPayload(
        structuredClone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS),
      )
    );
    const file = path.join(temporary, "synthetic-no-pointer.json");
    await Deno.writeTextFile(file, JSON.stringify(payload));
    await (await page.$("#import-settings")).uploadFile(file);
    await page.waitForFunction(() => document.querySelector("#import-preview-dialog")?.open, {
      polling: 50,
    });
    await page.$eval("#import-preview-confirm", (element) => element.click());
    await until(() =>
      page.evaluate(() =>
        !document.querySelector("#import-preview-dialog")?.open &&
        !document.querySelector(".browser-toolbox-main").hasAttribute("inert")
      ), "无图片备份导入未完成");
    const backups = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-import-backups")
    );
    const backup = backups.find((item) => !previous.some((old) => old.key === item.key));
    assert(backup?.status === "valid" && !backup.cursorAssetPresent, "备份不应包含指针图片");
    await until(
      () => page.$eval("#import-backup-refresh", (element) => !element.disabled),
      "备份列表仍在刷新",
    );
    await page.$eval("#import-backup-refresh", (element) => element.click());
    await until(
      () =>
        page.evaluate((key) =>
          !document.querySelector("#import-backup-refresh").disabled &&
          [...document.querySelector("#import-backup-select").options].some((option) =>
            option.value === key
          ), backup.key),
      "无图片备份未列出",
    );
    await page.$eval("#import-backup-select", (element, key) => {
      element.value = key;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, backup.key);
    assert(
      await page.$eval("#import-backup-use-cursor", (element) => element.disabled),
      "没有图片时仍能生成图片草稿",
    );
    assert(await oldAsset() === dataUrl, "旧资源未保留");
  });

  await check("设置校验失败时不先写入新的指针图片", async () => {
    await seed();
    await page.evaluate(() => {
      const area = chrome.storage.local;
      const set = area.set.bind(area);
      globalThis.__syntheticCursorWrites = 0;
      area.set = async (items) => {
        if (Object.keys(items).some((key) => key.startsWith("browserToolboxCursor-"))) {
          globalThis.__syntheticCursorWrites++;
        }
        return await set(items);
      };
    });
    await uploadPointer();
    await page.$eval("#cursor-hotspot-x", (element) => {
      element.value = "200";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await save();
    assert(
      await page.$eval("#settings-error", (element) => Boolean(element.textContent)),
      "无效热点未被拒绝",
    );
    assert(
      await page.evaluate(() => globalThis.__syntheticCursorWrites) === 0,
      "无效配置仍先写入指针资源",
    );
    assert(await oldAsset() === dataUrl, "无效保存改变了已有资源");
  });

  await check("资源写入后配置请求失败时保留两份图片", async () => {
    await seed();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (...args) => {
        if (args[0]?.handler === "browserToolbox.configuration" && args[0]?.action === "commit") {
          throw new Error("合成：请求未发送");
        }
        return await original(...args);
      };
    });
    const before = await page.evaluate(() => chrome.storage.local.getKeys());
    await uploadPointer();
    await save();
    const retained = await page.evaluate(async (before) => {
      const keys = (await chrome.storage.local.getKeys()).filter((key) =>
        key.startsWith("browserToolboxCursor-") && !before.includes(key)
      );
      const values = await chrome.storage.local.get(keys);
      return keys.map((key) => values[key]);
    }, before);
    const current = await currentCursor();
    assert(current.id === originalId && current.value === dataUrl, "失败时原配置或原图片被改动");
    assert(retained.length === 1 && retained[0] === dataUrl, "失败后新资源未保留");
    assert(
      await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "失败后草稿丢失",
    );
  });

  await check("已存在相同资源键时拒绝覆盖原值", async () => {
    await seed();
    const uuid = "11111111-1111-4111-8111-111111111111";
    const key = `browserToolboxCursor-${uuid}`;
    await page.evaluate(async ({ key, uuid }) => {
      await chrome.storage.local.set({ [key]: "synthetic-existing-value" });
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: () => uuid,
        configurable: true,
      });
    }, { key, uuid });
    await uploadPointer();
    await save();
    const stored = await page.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      key,
    );
    assert(stored === "synthetic-existing-value", "已存在资源被覆盖");
    assert((await currentCursor()).id === originalId, "碰撞后仍写入配置");
    assert(
      await page.$eval("#settings-error", (element) => Boolean(element.textContent)),
      "未提示资源冲突",
    );
  });

  await check("本机空间不足时保留旧数据并提示", async () => {
    await seed();
    await page.evaluate(() => {
      const area = chrome.storage.local;
      const set = area.set.bind(area);
      area.set = async (items) => {
        if (Object.keys(items).some((key) => key.startsWith("browserToolboxCursor-"))) {
          throw new Error("QUOTA_BYTES quota exceeded");
        }
        return await set(items);
      };
    });
    await uploadPointer();
    await save();
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("configurationLocalQuota")
    );
    assert(
      await page.$eval("#settings-error", (element) => element.textContent) === expected,
      "缺少空间不足提示",
    );
    const current = await currentCursor();
    assert(current.id === originalId && current.value === dataUrl, "空间不足时旧配置或图片改变");
  });

  await check("本机图片分页、查看及导出已查看的快照", async () => {
    await seed();
    await page.evaluate(async (asset) => {
      const items = {};
      for (let index = 0; index < 105; index++) {
        items[`browserToolboxCursor-${String(index).padStart(8, "0")}`] = asset;
      }
      items.syntheticUnrelated = "synthetic-private";
      await chrome.storage.local.set(items);
    }, dataUrl);
    const before = await page.evaluate(() => chrome.storage.local.get(null));
    const listed = await page.evaluate(() =>
      BrowserToolboxConfigurationClientInstance.request("list-local-cursors")
    );
    assert(listed.keys.length === 100 && listed.next, "首页未限制和分页");
    assert(!JSON.stringify(listed).includes("synthetic-private"), "列表泄露无关存储内容");
    const dirty = await page.$eval("#dirty-status", (element) => element.textContent);
    await page.$eval("#local-cursor-refresh", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-select", (element) => element.options.length === 100),
      "图片首页未加载",
    );
    assert(await page.$eval("#local-cursor-more", (element) => !element.hidden), "缺少下一页入口");
    await page.$eval("#local-cursor-more", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-select", (element) => element.options.length > 100),
      "未加载后续图片",
    );
    await page.$eval("#local-cursor-select", (element, id) => {
      element.value = id;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, originalId);
    await page.$eval("#local-cursor-view", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-export", (element) => !element.disabled),
      "图片未完成查看",
    );
    assert(
      await page.$eval(
        "#local-cursor-preview",
        (element) => !element.hidden && element.naturalWidth === 1,
      ),
      "图片未正确解码显示",
    );
    assert(
      dirty === await page.$eval("#dirty-status", (element) => element.textContent),
      "图片查看误改了设置草稿",
    );
    const after = await page.evaluate(() => chrome.storage.local.get(null));
    assert(JSON.stringify(before) === JSON.stringify(after), "读取图片改写了本机存储");
    await page.evaluate(
      (id) => chrome.storage.local.set({ [id]: "data:image/png;base64,AAAA" }),
      originalId,
    );
    const directory = path.join(temporary, "preview-download");
    await Deno.mkdir(directory);
    const session = await page.target().createCDPSession();
    await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
    await page.$eval("#local-cursor-export", (element) => element.click());
    const file = path.join(directory, "browser-toolbox-local-pointer.png");
    await until(async () => {
      try {
        return (await Deno.stat(file)).isFile;
      } catch (_) {
        return false;
      }
    }, "图片文件未下载");
    const bytes = await Deno.readFile(file);
    assert(btoa(String.fromCharCode(...bytes)) === png, "导出的不是刚查看的图片");
    await session.detach();
    await page.evaluate(({ id, asset }) => chrome.storage.local.set({ [id]: asset }), {
      id: originalId,
      asset: dataUrl,
    });
  });

  await check("无法解码的图片保留并导出原始字节", async () => {
    await seed();
    const key = "browserToolboxCursor-zzzzzzzz";
    const truncated = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    await page.evaluate(({ key, truncated }) =>
      chrome.storage.local.set({
        [key]: `data:image/png;base64,${truncated}`,
      }), { key, truncated });
    await page.$eval("#local-cursor-refresh", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-select", (element) => element.options.length === 100),
      "损坏图片首页未加载",
    );
    await page.$eval("#local-cursor-more", (element) => element.click());
    await until(
      () =>
        page.$eval(
          "#local-cursor-select",
          (element, key) => [...element.options].some((option) => option.value === key),
          key,
        ),
      "损坏图片未列出",
    );
    await page.$eval("#local-cursor-select", (element, key) => {
      element.value = key;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, key);
    await page.$eval("#local-cursor-view", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-export", (element) => !element.disabled),
      "损坏图片未提供原始导出",
    );
    assert(
      await page.$eval("#local-cursor-preview", (element) => element.hidden),
      "损坏图片被误当作可预览",
    );
    assert(
      await page.$eval("#local-cursor-use", (element) => element.disabled),
      "无法解码的图片可以放入设置草稿",
    );
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("localCursorOriginalOnly")
    );
    assert(
      await page.$eval("#local-cursor-status", (element) => element.textContent) === expected,
      "缺少损坏说明",
    );
    const directory = path.join(temporary, "invalid-download");
    await Deno.mkdir(directory);
    const session = await page.target().createCDPSession();
    await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
    await page.$eval("#local-cursor-export", (element) => element.click());
    const file = path.join(directory, "browser-toolbox-local-pointer-original.bin");
    await until(async () => {
      try {
        return (await Deno.stat(file)).isFile;
      } catch (_) {
        return false;
      }
    }, "原始字节未下载");
    const bytes = await Deno.readFile(file);
    assert(btoa(String.fromCharCode(...bytes)) === truncated, "原始字节发生变化");
    assert(
      await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key) ===
        `data:image/png;base64,${truncated}`,
      "原始记录被改动",
    );
    await session.detach();
  });

  await check("使用已查看图片只修改草稿，保存时使用查看快照", async () => {
    await seed();
    await reviewOriginalCursor();
    assert(
      await page.$eval("#local-cursor-use", (element) => !element.disabled),
      "可预览图片不能放入草稿",
    );
    await page.evaluate(
      (key) => chrome.storage.local.set({ [key]: "data:image/png;base64,AAAA" }),
      originalId,
    );
    const before = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    await page.$eval("#local-cursor-use", (element) => element.click());
    assert(
      await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "未标记未保存草稿",
    );
    assert(await page.$eval("#cursor-enabled", (element) => element.checked), "未启用指针草稿");
    const after = await page.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert(JSON.stringify(before) === JSON.stringify(after), "放入草稿时提前写入存储");
    assert((await currentCursor()).id === originalId, "保存前配置已经变化");
    await save();
    const current = await currentCursor();
    assert(current.id && current.id !== originalId, "保存后没有生成新的本机资源");
    assert(current.value === dataUrl, "保存的不是用户刚查看的快照");
    assert(await oldAsset() === "data:image/png;base64,AAAA", "原图片的后续变化被覆盖");
  });

  await check("放弃图片草稿后保留原配置且不生成资源", async () => {
    await seed();
    await reviewOriginalCursor();
    const before = await page.evaluate(() => chrome.storage.local.get(null));
    await page.$eval("#local-cursor-use", (element) => element.click());
    assert(
      await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "图片草稿未标记",
    );
    await page.$eval("#discard-changes", (element) => element.click());
    await until(
      () => page.$eval("#dirty-status", (element) => !element.textContent),
      "放弃草稿未完成",
    );
    assert(
      JSON.stringify(before) === JSON.stringify(
        await page.evaluate(() => chrome.storage.local.get(null)),
      ),
      "放弃草稿改动了本机存储",
    );
    const current = await currentCursor();
    assert(current.id === originalId && current.value === dataUrl, "放弃草稿后原指针改变");
  });

  await check("复用图片保留其他未保存设置，切换选择会清除旧预览", async () => {
    await seed();
    await page.$eval("#cursor-hotspot-x", (element) => {
      element.value = "7";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await reviewOriginalCursor();
    await page.$eval("#local-cursor-use", (element) => element.click());
    assert(
      await page.$eval("#cursor-hotspot-x", (element) => element.value) === "7",
      "复用图片改动其他草稿",
    );
    await save();
    const current = await currentCursor();
    assert(current.cursor.hotspotX === 7 && current.value === dataUrl, "保存时丢失其他草稿或图片");
    await page.$eval("#local-cursor-select", (element) => {
      const option = [...element.options].find((item) => item.value !== element.value);
      if (!option) throw new Error("合成测试缺少另一图片");
      element.value = option.value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert(
      await page.$eval("#local-cursor-use", (element) => element.disabled),
      "更换图片后仍能使用旧预览",
    );
  });

  await check("其他顶层页面及子页面不能读取本机图片", async () => {
    await seed();
    const untrusted = await browser.newPage();
    await untrusted.goto(`chrome-extension://${extensionId}/pages/options.html`);
    const actions = ["list-local-cursors", "read-local-cursor"];
    const denied = await untrusted.evaluate(
      async ({ actions, key }) =>
        await Promise.all(actions.map((action) =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action,
            input: { key },
          })
        )),
      { actions, key: originalId },
    );
    assert(denied.every((item) => item?.code === "PERMISSION_DENIED"), "其他设置页获得图片访问权");
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "synthetic-cursor-frame";
      frame.src = chrome.runtime.getURL("pages/mouse_options.html");
      document.body.append(frame);
    });
    const frame = await (await page.$("#synthetic-cursor-frame")).contentFrame();
    await frame.waitForSelector("#local-cursor-refresh");
    const frameDenied = await frame.evaluate(
      async ({ actions, key }) =>
        await Promise.all(actions.map((action) =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action,
            input: { key },
          })
        )),
      { actions, key: originalId },
    );
    assert(frameDenied.every((item) => item?.code === "PERMISSION_DENIED"), "子页面获得图片访问权");
    await untrusted.close();
  });

  await check("图片解码没有返回时限时结束并保留原始导出", async () => {
    await seed();
    await page.$eval("#local-cursor-refresh", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-select", (element) => element.options.length > 0),
      "图片列表未加载",
    );
    if (!await page.$eval("#local-cursor-more", (element) => element.hidden)) {
      await page.$eval("#local-cursor-more", (element) => element.click());
      await until(
        () =>
          page.$eval(
            "#local-cursor-select",
            (element, key) => [...element.options].some((option) => option.value === key),
            originalId,
          ),
        "原图片未列出",
      );
    }
    await page.$eval("#local-cursor-select", (element, key) => {
      element.value = key;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, originalId);
    await page.evaluate(() => {
      Image.prototype.decode = () => new Promise(() => {});
    });
    const started = Date.now();
    await page.$eval("#local-cursor-view", (element) => element.click());
    await until(
      () => page.$eval("#local-cursor-export", (element) => !element.disabled),
      "图片解码超时后未恢复操作",
    );
    assert(Date.now() - started < 10000, "解码等待没有及时结束");
    assert(
      await page.$eval("#local-cursor-preview", (element) => element.hidden),
      "未完成解码却展示成功",
    );
    const expected = await page.evaluate(() =>
      BrowserToolboxI18n.message("localCursorOriginalOnly")
    );
    assert(
      await page.$eval("#local-cursor-status", (element) => element.textContent) === expected,
      "超时未提示原始导出",
    );
    assert(await oldAsset() === dataUrl, "超时改变了本机图片");
  });

  await check("窄屏说明资源保留和清理限制", async () => {
    await seed();
    await page.setViewport({ width: 320, height: 800 });
    const details = await page.evaluate(() => ({
      text: document.querySelector('[data-i18n="cursorRetentionNote"]')?.textContent,
      button: document.querySelector("#reset-cursor")?.textContent,
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      overflow: [...document.querySelectorAll("body *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > innerWidth + 1;
      }).map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: typeof element.className === "string" ? element.className : "",
        right: Math.round(element.getBoundingClientRect().right),
      })).slice(0, 20),
    }));
    report.narrowLayout = details;
    assert(Boolean(details.text) && Boolean(details.button), "缺少保留或停用说明");
    assert(details.width <= details.viewport, "320px 指针设置横向溢出");
    const widths = await page.evaluate(() => {
      const result = {};
      for (const locale of ["en", "es", "ja", "zh_CN", "zh_TW"]) {
        BrowserToolboxI18n.setLocale(locale);
        BrowserToolboxI18n.apply(document);
        result[locale] = document.documentElement.scrollWidth;
      }
      return result;
    });
    report.narrowLanguageWidths = widths;
    assert(Object.values(widths).every((width) => width <= 320), "部分语言在 320px 横向溢出");
  });

  await check("五种语言备份页面在窄屏不横向溢出", async () => {
    await seed();
    await page.setViewport({ width: 320, height: 800 });
    await page.$eval('button[data-section="backupAbout"]', (element) => element.click());
    const widths = await page.evaluate(() => {
      const result = {};
      for (const locale of ["en", "es", "ja", "zh_CN", "zh_TW"]) {
        BrowserToolboxI18n.setLocale(locale);
        BrowserToolboxI18n.apply(document);
        result[locale] = document.documentElement.scrollWidth;
      }
      return result;
    });
    report.backupNarrowWidths = widths;
    assert(
      Object.values(widths).every((width) => width <= 320),
      "部分语言的备份页在 320px 横向溢出",
    );
  });

  await check("配置冲突期间可准备图片草稿，但保存仍受保护", async () => {
    await seed();
    await page.evaluate(() =>
      chrome.storage.sync.set({ keyMappings: "map synthetic-conflict scrollUp" })
    );
    await until(
      () => worker.evaluate(() => globalThis.BrowserToolboxConfigurationWriterInstance.dirty),
      "未观察到合成配置冲突",
    );
    const conflict = await worker.evaluate(() =>
      globalThis.BrowserToolboxConfigurationWriterInstance.preview()
    );
    assert(conflict.code === "CONFIGURATION_EXTERNAL_CONFLICT", "合成配置冲突未成立");
    const beforeKeys = await page.evaluate(() => chrome.storage.local.getKeys());
    const records = beforeKeys.filter((key) =>
      key.startsWith("browserToolboxKeyboardTransition:m2-observation:")
    );
    assert(records.length > 0, "未保存冲突观察");
    await reviewOriginalCursor();
    await page.$eval("#local-cursor-use", (element) => element.click());
    await save();
    assert(
      await page.$eval("#settings-error", (element) => Boolean(element.textContent)),
      "冲突期间保存没有被阻止",
    );
    assert(
      await page.$eval("#dirty-status", (element) => Boolean(element.textContent)),
      "冲突后草稿丢失",
    );
    const current = await currentCursor();
    assert(current.id === originalId && current.value === dataUrl, "冲突期间覆盖了原配置或图片");
    const state = await page.evaluate(async () => ({
      keys: await chrome.storage.local.getKeys(),
      sync: await chrome.storage.sync.get("keyMappings"),
    }));
    assert(records.every((key) => state.keys.includes(key)), "冲突观察被删除");
    assert(state.sync.keyMappings === "map synthetic-conflict scrollUp", "外部配置被覆盖");
  });
  if (report.pageErrors.length) throw new Error(`设置页错误：${report.pageErrors.join("; ")}`);
  report.status = report.checks.every((entry) => entry.status === "passed") ? "passed" : "failed";
  if (report.status !== "passed") Deno.exitCode = 1;
} catch (failure) {
  report.status = "failed";
  report.error = failure?.stack || String(failure);
  console.error(report.error);
  Deno.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await Deno.remove(temporary, { recursive: true }).catch(() => {});
}
