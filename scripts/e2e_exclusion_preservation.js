// SPDX-License-Identifier: GPL-3.0-or-later
// 在独立合成配置中验证旧规则字段保留、导出和设置页并发保存，不使用系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";
import { buildInputCanary } from "./build_runtime_canary.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_EXCLUSION_REPORT");
const screenshotPath = Deno.env.get("BROWSER_TOOLBOX_EXCLUSION_SCREENSHOT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-exclusion-preservation-" });
const report = { status: "running", source: "synthetic", checks: [], pageErrors: [] };
let browser;
let canaryRoot;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, reason) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(30);
  }
  throw new Error(reason);
};
const check = (plan, name, condition) => {
  report.checks.push({ plan, name, status: condition ? "passed" : "failed" });
};
async function observeSaves(page) {
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.__syntheticSaveResponses = [];
    globalThis.__syntheticImportResponses = [];
    chrome.runtime.sendMessage = (...args) => {
      const request = args[0];
      const result = send(...args);
      if (
        request?.handler === "browserToolbox.configuration" &&
        ["commit", "import"].includes(request.action)
      ) {
        Promise.resolve(result).then((response) => {
          const target = request.action === "commit"
            ? globalThis.__syntheticSaveResponses
            : globalThis.__syntheticImportResponses;
          target.push({ ok: response?.ok, code: response?.code });
        });
      }
      return result;
    };
  });
}
async function waitForSave(page) {
  await page.waitForFunction(() => globalThis.__syntheticSaveResponses?.length > 0, {
    polling: 50,
  });
}

async function testPlan(plan, extension) {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(temporary, `profile-${plan}`),
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
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const worker = await target.worker();
  const id = new URL(target.url()).host;
  report.chrome = await browser.version();
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "后台配置写入器尚未就绪",
  );
  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      baseline: { keyboard: baseline.keyboard },
      legacyPatch: {
        exclusionRules: [
          {
            pattern: "https://protected.invalid/*",
            passKeys: "j",
            futurePolicy: { enabled: false },
          },
          { pattern: "https://normal.invalid/*", passKeys: "k" },
        ],
      },
    });
  });
  const page = await browser.newPage();
  page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });
  await page.goto(`chrome-extension://${id}/pages/options.html`);
  await page.bringToFront();
  const ready = () =>
    page.waitForFunction(
      (version) =>
        globalThis.BrowserToolboxRuntimeHostInstance?.state === "active" &&
        globalThis.BrowserToolboxRuntimeHostInstance?.plan?.planVersion === version &&
        document.querySelector('[name="settingsVersion"]')?.value === "2.4.2" &&
        document.querySelectorAll("#exclusion-rules tr.rule").length === 2,
      { polling: 50, timeout: 20000 },
      plan,
    );
  await ready();

  const initial = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll("#exclusion-rules tr.rule")];
    const protectedRow = rows[0];
    const link = document.querySelector("#download-backup");
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    link.click();
    const exported = JSON.parse(await (await fetch(link.href)).text());
    return {
      protected: protectedRow.querySelector('[name="pattern"]').readOnly &&
        protectedRow.querySelector('[name="passKeys"]').readOnly &&
        protectedRow.querySelector(".remove").disabled,
      warning: Boolean(protectedRow.querySelector(".exclusion-preserved-warning")?.textContent),
      normalEditable: !rows[1].querySelector('[name="pattern"]').readOnly &&
        !rows[1].querySelector(".remove").disabled,
      exportPreserved: exported.exclusionRules?.[0]?.futurePolicy?.enabled === false,
    };
  });
  check(
    plan,
    "未知规则字段导出保留且受保护，普通规则可编辑",
    Object.values(initial).every(Boolean),
  );
  if (screenshotPath && plan === 1) await page.screenshot({ path: screenshotPath, fullPage: true });

  const downloads = path.join(temporary, `downloads-${plan}`);
  await Deno.mkdir(downloads);
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  const previousMapping = await page.evaluate(() => {
    const field = document.querySelector('[name="keyMappings"]');
    const previous = field.value;
    field.value = "map b scrollUp";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return previous;
  });
  await page.focus("#download-backup");
  await page.keyboard.press("Enter");
  let keyboardExport;
  await until(async () => {
    try {
      keyboardExport = JSON.parse(
        await Deno.readTextFile(path.join(downloads, "vimium-options.json")),
      );
      return true;
    } catch (_) {
      return false;
    }
  }, "键盘触发没有下载备份");
  check(
    plan,
    "键盘触发备份导出包含当前表单和未知规则字段",
    keyboardExport.keyMappings === "map b scrollUp" &&
      keyboardExport.exclusionRules?.[0]?.futurePolicy?.enabled === false,
  );
  await page.evaluate((previous) => {
    const field = document.querySelector('[name="keyMappings"]');
    field.value = previous;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, previousMapping);
  await cdp.detach();

  await observeSaves(page);
  await page.evaluate(() => {
    const row = document.querySelector("#exclusion-rules tr.rule");
    row.querySelector('[name="pattern"]').value = "";
    const field = document.querySelector('[name="smoothScroll"]');
    field.checked = !field.checked;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#save");
  await waitForSave(page);
  await until(
    async () => await page.$eval("#save", (button) => button.disabled),
    "保存其他设置没有完成",
  );
  const saved = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  check(
    plan,
    "保存其他设置时未知规则字段和原始匹配式保留",
    saved.exclusionRules[0]?.futurePolicy?.enabled === false &&
      saved.exclusionRules[0]?.pattern === "https://protected.invalid/*" &&
      saved.exclusionRules[1]?.pattern === "https://normal.invalid/*",
  );

  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      baseline: { keyboard: baseline.keyboard },
      legacyPatch: {
        exclusionRules: [
          {
            pattern: "https://protected.invalid/*",
            passKeys: "j",
            futurePolicy: { enabled: false },
          },
          { pattern: "https://normal.invalid/*", passKeys: "k" },
        ],
      },
    });
  });
  await page.reload();
  await page.bringToFront();
  await ready();
  await observeSaves(page);
  await page.evaluate(() => {
    const field = document.querySelector('[name="scrollStepSize"]');
    field.value = "85";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      legacyPatch: { scrollStepSize: 88 },
      baseline: { keyboard: baseline.keyboard },
    });
  });
  if (plan === 1) {
    await page.waitForFunction(() => Settings.get("scrollStepSize") === 88, { polling: 50 });
  }
  await page.click("#save");
  await waitForSave(page);
  const preferred = await page.evaluate(() => ({
    response: globalThis.__syntheticSaveResponses.at(-1),
    draft: document.querySelector('[name="scrollStepSize"]').value,
  }));
  const afterSave = await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const keyboard = (await writer.read()).keyboard;
    const archives = (await writer.listCompatibilityConflictObservations()).filter((item) => item.status === "field-archive");
    const records = await Promise.all(archives.map((item) => writer.exportCompatibilityConflictObservation(item.key)));
    return { keyboard, records };
  });
  check(
    plan,
    "同字段以本次保存为准，保留未知规则并归档原字段",
    preferred.response?.ok === true && preferred.draft === "85" &&
      afterSave.keyboard.scrollStepSize === 85 &&
      afterSave.keyboard.exclusionRules[0]?.futurePolicy?.enabled === false &&
      afterSave.records.some((item) => item.fields.some((field) =>
        field.path === "/keyboard/scrollStepSize" && field.committed.value === 88)),
  );
  if (plan === 1) {
    const maintenance = await browser.newPage();
    await maintenance.goto(`chrome-extension://${id}/pages/mouse_options.html#general`);
    await maintenance.waitForFunction(() => document.querySelector("main")?.dataset.settingsReady === "true",
      { polling: 50, timeout: 30000 });
    await maintenance.$eval("#conflict-observation-refresh", (button) => {
      button.closest("details").open = true;
      button.click();
    });
    await maintenance.waitForFunction(() =>
      document.querySelector('#conflict-observation-select option[data-status="field-archive"]'),
      { polling: 50, timeout: 15000 });
    const key = await maintenance.$eval('#conflict-observation-select option[data-status="field-archive"]',
      (option) => option.value);
    await maintenance.select("#conflict-observation-select", key);
    const controls = await maintenance.evaluate(() => ({
      exportEnabled: !document.querySelector("#conflict-observation-export").disabled,
      reviewDisabled: document.querySelector("#conflict-observation-review").disabled,
      label: document.querySelector("#conflict-observation-select").selectedOptions[0].textContent,
    }));
    const maintenanceCdp = await maintenance.target().createCDPSession();
    await maintenanceCdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    await maintenance.$eval("#conflict-observation-export", (button) => button.click());
    const archiveFile = path.join(downloads, "browser-toolbox-saved-conflict-observation.json");
    await until(async () => {
      try { return (await Deno.stat(archiveFile)).isFile; } catch (_) { return false; }
    }, "字段归档未导出");
    const archiveData = JSON.parse(await Deno.readTextFile(archiveFile));
    check(plan, "维护页明确区分字段归档，并可导出原值", controls.exportEnabled && controls.reviewDisabled &&
      controls.label && archiveData.kind === "m2-field-archive" &&
      archiveData.fields.some((field) => field.committed.value === 88) &&
      !JSON.stringify(archiveData).includes("futurePolicy"));

    const hudBefore = await maintenance.$eval("#global-show-hud", (element) => element.checked);
    await maintenance.evaluate(() => chrome.storage.sync.set({ keyMappings: "map external scrollUp" }));
    const marker = await maintenance.evaluate(() => BrowserToolboxConfigurationClientInstance.request("preview"));
    if (marker.code !== "CONFIGURATION_EXTERNAL_CONFLICT" || marker.captureStatus !== "unsupported") {
      throw new Error("未建立未知规则的阻断标记");
    }
    await maintenance.$eval("#global-show-hud", (element) => element.click());
    await until(() => maintenance.$eval("#save-settings", (element) => !element.disabled), "维护页未记录用户修改");
    await maintenance.$eval("#save-settings", (element) => element.click());
    await until(async () => {
      const current = await maintenance.evaluate(() => BrowserToolboxConfigurationClientInstance.read());
      return current.keyboard.keyMappings === "map external scrollUp" &&
        current.keyboard.exclusionRules[0]?.futurePolicy?.enabled === false &&
        current.toolboxSource.value.general.showHud !== hudBefore;
    }, "未知规则不变时，用户的无关设置仍无法保存");
    const resolved = await maintenance.evaluate(() => BrowserToolboxConfigurationClientInstance.request("preview"));
    check(plan, "未知规则不变时可保存其他设置并保留最新外部字段", resolved.code === null);
    await maintenance.close();
  }

  await page.reload();
  await page.bringToFront();
  await ready();
  await observeSaves(page);
  await page.evaluate(() => {
    const field = document.querySelector('[name="keyMappings"]');
    field.value = "map t scrollDown";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      legacyPatch: { scrollStepSize: 92 },
      baseline: { keyboard: baseline.keyboard },
    });
  });
  if (plan === 1) {
    await page.waitForFunction(() => Settings.get("scrollStepSize") === 92, { polling: 50 });
  }
  await page.click("#save");
  await waitForSave(page);
  await until(
    async () => await page.$eval("#save", (button) => button.disabled),
    "非冲突保存没有完成",
  );
  const merged = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  const displayed = await page.$eval('[name="scrollStepSize"]', (element) => element.value);
  check(
    plan,
    "不同字段并发保存保留双方修改并刷新表单",
    merged.scrollStepSize === 92 && merged.keyMappings === "map t scrollDown" && displayed === "92",
  );

  if (plan === 1) {
    await page.reload();
    await page.bringToFront();
    await ready();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__holdSyntheticCommit = true;
      chrome.runtime.sendMessage = (...args) => {
        const request = args[0];
        const result = send(...args);
        if (
          request?.handler !== "browserToolbox.configuration" || request.action !== "commit" ||
          !globalThis.__holdSyntheticCommit
        ) return result;
        return Promise.resolve(result).then((response) =>
          new Promise((resolve) => {
            globalThis.__syntheticCommitArrived = true;
            globalThis.__releaseSyntheticCommit = () => resolve(response);
          })
        );
      };
      const field = document.querySelector('[name="scrollStepSize"]');
      field.value = "100";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.click("#save");
    await page.waitForFunction(() => globalThis.__syntheticCommitArrived, { polling: 50 });
    await page.evaluate(() => {
      const field = document.querySelector('[name="keyMappings"]');
      field.value = "map u scrollUp";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      globalThis.__holdSyntheticCommit = false;
      globalThis.__releaseSyntheticCommit();
    });
    await page.waitForFunction(() => !document.querySelector("#save").disabled, { polling: 50 });
    const retainedDraft = await page.$eval('[name="keyMappings"]', (element) => element.value);
    await page.click("#save");
    await until(async () => {
      const state = await worker.evaluate(async () =>
        (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
      );
      return state.keyMappings === "map u scrollUp" && state.scrollStepSize === 100;
    }, "保存期间的新输入未能继续保存");
    check(plan, "保存期间继续输入不会被重绘或误标为已保存", retainedDraft === "map u scrollUp");
  }

  await page.reload();
  await page.bringToFront();
  await ready();
  await observeSaves(page);
  await page.evaluate(() => {
    const field = document.querySelector('[name="keyMappings"]');
    field.value = "map v scrollDown";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    const rules = structuredClone(baseline.keyboard.exclusionRules);
    rules[1].futureFlag = { enabled: false };
    await writer.commit({
      legacyPatch: { exclusionRules: rules },
      baseline: { keyboard: baseline.keyboard },
    });
  });
  if (plan === 1) {
    await page.waitForFunction(
      () => Settings.get("exclusionRules")[1]?.futureFlag?.enabled === false,
      { polling: 50 },
    );
  }
  await page.click("#save");
  await waitForSave(page);
  await page.waitForFunction(() =>
    document.querySelectorAll("#exclusion-rules tr.rule")[1]
      ?.querySelector('[name="pattern"]')?.readOnly, { polling: 50 });
  const retained = await worker.evaluate(async () => ({
    keyboard: (await BrowserToolboxConfigurationWriterInstance.read()).keyboard,
    sync: await chrome.storage.sync.get("exclusionRules"),
  }));
  check(
    plan,
    "并发新增的规则附加字段在其他字段保存后保留并提示",
    retained.keyboard.exclusionRules[1]?.futureFlag?.enabled === false &&
      retained.sync.exclusionRules?.[1]?.futureFlag?.enabled === false &&
      retained.keyboard.keyMappings === "map v scrollDown",
  );

  const replacePath = path.join(temporary, `replace-${plan}.json`);
  await Deno.writeTextFile(
    replacePath,
    JSON.stringify({
      settingsVersion: "2.4.2",
      exclusionRules: [{ pattern: "https://replacement.invalid/*", passKeys: "" }],
    }),
  );
  const dialogCount = dialogs.length;
  const warningText = await page.evaluate(() =>
    BrowserToolboxI18n.message("configurationExistingRulesProtected")
  );
  await (await page.$("#upload-backup")).uploadFile(replacePath);
  await page.waitForFunction(() => globalThis.__syntheticImportResponses.length === 1, {
    polling: 50,
  });
  const blockedImport = await page.evaluate(() => globalThis.__syntheticImportResponses[0]);
  await until(
    async () =>
      plan === 1
        ? dialogs.slice(dialogCount).some((item) =>
          item.type === "alert" &&
          item.message.includes(warningText)
        )
        : await page.evaluate(() =>
          document.querySelector("#browser-toolbox-options-status")?.textContent
            .includes(BrowserToolboxI18n.message("configurationExistingRulesProtected"))
        ),
    "替换规则被阻止后没有显示提示",
  );
  const afterBlockedImport = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  check(
    plan,
    "导入不会替换当前带附加字段的规则且会提示",
    blockedImport?.ok === false &&
      blockedImport?.code === "CONFIGURATION_EXISTING_RULES_UNSUPPORTED" &&
      afterBlockedImport.exclusionRules[0]?.futurePolicy?.enabled === false &&
      afterBlockedImport.exclusionRules[1]?.futureFlag?.enabled === false,
  );

  const otherPath = path.join(temporary, `other-${plan}.json`);
  await Deno.writeTextFile(
    otherPath,
    JSON.stringify({ settingsVersion: "2.4.2", scrollStepSize: 103 }),
  );
  await (await page.$("#upload-backup")).uploadFile(otherPath);
  await page.waitForFunction(() => globalThis.__syntheticImportResponses.length === 2, {
    polling: 50,
  });
  const otherImport = await page.evaluate(() => globalThis.__syntheticImportResponses[1]);
  const afterOtherImport = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  check(
    plan,
    "不含规则的旧备份仍可导入且保留现有附加字段",
    otherImport?.ok === true && afterOtherImport.scrollStepSize === 103 &&
      afterOtherImport.exclusionRules[0]?.futurePolicy?.enabled === false &&
      afterOtherImport.exclusionRules[1]?.futureFlag?.enabled === false,
  );

  await page.reload();
  await page.bringToFront();
  await ready();
  await observeSaves(page);
  await page.evaluate(() => {
    const field = document.querySelector('[name="keyMappings"]');
    field.value = "map y scrollUp";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const draftPath = path.join(temporary, `draft-${plan}.json`);
  await Deno.writeTextFile(
    draftPath,
    JSON.stringify({ settingsVersion: "2.4.2", scrollStepSize: 106 }),
  );
  await (await page.$("#upload-backup")).uploadFile(draftPath);
  await page.waitForFunction(() =>
    globalThis.__syntheticImportResponses.length === 1 &&
    !document.querySelector("#upload-backup").value, { polling: 50 });
  const draftAfterImport = await page.evaluate(() => ({
    value: document.querySelector('[name="keyMappings"]').value,
    enabled: !document.querySelector("#save").disabled,
  }));
  let mergedDraft = false;
  if (draftAfterImport.value === "map y scrollUp" && draftAfterImport.enabled) {
    await page.click("#save");
    await waitForSave(page);
    const state = await worker.evaluate(async () =>
      (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
    );
    mergedDraft = state.keyMappings === "map y scrollUp" && state.scrollStepSize === 106;
  }
  check(plan, "导入其他字段时保留原有草稿并可安全合并", mergedDraft);

  await page.reload();
  await page.bringToFront();
  await ready();
  await observeSaves(page);
  await page.evaluate(() => {
    const field = document.querySelector('[name="scrollStepSize"]');
    field.value = "107";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const samePath = path.join(temporary, `draft-conflict-${plan}.json`);
  await Deno.writeTextFile(
    samePath,
    JSON.stringify({ settingsVersion: "2.4.2", scrollStepSize: 108 }),
  );
  await (await page.$("#upload-backup")).uploadFile(samePath);
  await page.waitForFunction(() =>
    globalThis.__syntheticImportResponses.length === 1 &&
    !document.querySelector("#upload-backup").value, { polling: 50 });
  const sameDraft = await page.evaluate(() => ({
    value: document.querySelector('[name="scrollStepSize"]').value,
    enabled: !document.querySelector("#save").disabled,
  }));
  let importPreferred = false;
  if (sameDraft.value === "107" && sameDraft.enabled) {
    await page.click("#save");
    await waitForSave(page);
    const response = await page.evaluate(() => globalThis.__syntheticSaveResponses.at(-1));
    const value = await worker.evaluate(async () =>
      (await BrowserToolboxConfigurationWriterInstance.read()).keyboard.scrollStepSize
    );
    importPreferred = response?.ok === true && value === 107;
  }
  check(plan, "导入后保存草稿时以用户修改为准", importPreferred);

  if (plan === 1) {
    await page.reload();
    await page.bringToFront();
    await ready();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__holdSyntheticImport = true;
      chrome.runtime.sendMessage = (...args) => {
        const request = args[0];
        const result = send(...args);
        if (
          request?.handler !== "browserToolbox.configuration" || request.action !== "import" ||
          !globalThis.__holdSyntheticImport
        ) return result;
        return Promise.resolve(result).then((response) =>
          new Promise((resolve) => {
            globalThis.__syntheticImportArrived = true;
            globalThis.__releaseSyntheticImport = () => resolve(response);
          })
        );
      };
    });
    const pendingPath = path.join(temporary, "import-pending.json");
    await Deno.writeTextFile(
      pendingPath,
      JSON.stringify({ settingsVersion: "2.4.2", scrollStepSize: 109 }),
    );
    await (await page.$("#upload-backup")).uploadFile(pendingPath);
    await page.waitForFunction(() => globalThis.__syntheticImportArrived, { polling: 50 });
    const guarded = await page.evaluate(() => {
      const field = document.querySelector('[name="keyMappings"]');
      field.value = "map q scrollUp";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      const result = {
        saveDisabled: document.querySelector("#save").disabled,
        uploadDisabled: document.querySelector("#upload-backup").disabled,
        warnsOnExit: Boolean(globalThis.onbeforeunload?.()),
      };
      globalThis.__holdSyntheticImport = false;
      globalThis.__releaseSyntheticImport();
      return result;
    });
    await page.waitForFunction(() =>
      !document.querySelector("#upload-backup").value &&
      !document.querySelector("#save").disabled, { polling: 50 });
    const draft = await page.$eval('[name="keyMappings"]', (element) => element.value);
    await page.click("#save");
    await until(async () => {
      const state = await worker.evaluate(async () =>
        (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
      );
      return state.keyMappings === "map q scrollUp" && state.scrollStepSize === 109;
    }, "导入期间的草稿未能保存");
    check(
      plan,
      "导入进行时继续输入保留草稿且离开页面会提示",
      Object.values(guarded).every(Boolean) && draft === "map q scrollUp",
    );
  } else {
    await page.reload();
    await page.bringToFront();
    await ready();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        const result = send(...args);
        if (
          args[0]?.handler !== "browserToolbox.configuration" || args[0].action !== "import"
        ) return result;
        return Promise.resolve(result).then((response) =>
          new Promise((resolve) => {
            globalThis.__syntheticImportArrived = true;
            globalThis.__releaseSyntheticImport = () => resolve(response);
          })
        );
      };
    });
    const pendingPath = path.join(temporary, "canary-import-pending.json");
    await Deno.writeTextFile(
      pendingPath,
      JSON.stringify({ settingsVersion: "2.4.2", scrollStepSize: 109 }),
    );
    await (await page.$("#upload-backup")).uploadFile(pendingPath);
    await page.waitForFunction(() => globalThis.__syntheticImportArrived, { polling: 50 });
    const guarded = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      globalThis.dispatchEvent(event);
      const result = event.defaultPrevented &&
        document.querySelector("#settings-grid-container").inert;
      globalThis.__releaseSyntheticImport();
      return result;
    });
    await page.waitForFunction(() => !document.querySelector("#settings-grid-container").inert, {
      polling: 50,
    });
    check(plan, "无草稿导入进行时离开页面会提示", guarded);
  }
  await browser.close();
  browser = null;
}

async function testToolbox(extension) {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(temporary, "profile-toolbox"),
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
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const worker = await target.worker();
  const id = new URL(target.url()).host;
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "工具箱后台配置写入器尚未就绪",
  );
  await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      baseline: { keyboard: baseline.keyboard },
      legacyPatch: {
        exclusionRules: [{
          pattern: "https://protected.invalid/*",
          passKeys: "j",
          futurePolicy: { enabled: false },
        }],
      },
    });
  });
  const page = await browser.newPage();
  page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html#backupAbout`);
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    {
      polling: 50,
    },
  );
  await observeSaves(page);
  async function upload(name, body) {
    const file = path.join(temporary, name);
    await Deno.writeTextFile(file, JSON.stringify(body));
    const input = await page.$("#import-settings");
    const pending = input.uploadFile(file);
    await page.waitForFunction(() => document.querySelector("#import-preview-dialog")?.open, {
      polling: 50,
    });
    await page.bringToFront();
    await page.click("#import-preview-confirm");
    await pending;
  }
  await upload("toolbox-replace.json", {
    settingsVersion: "2.4.2",
    exclusionRules: [{ pattern: "https://replacement.invalid/*", passKeys: "" }],
  });
  await page.waitForFunction(() => globalThis.__syntheticImportResponses.length === 1, {
    polling: 50,
  });
  await page.waitForFunction(() =>
    document.querySelector("#settings-error")?.textContent.includes(
      BrowserToolboxI18n.message("configurationExistingRulesProtected"),
    ), { polling: 50 });
  const blocked = await page.evaluate(() => globalThis.__syntheticImportResponses[0]);
  const afterBlocked = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  check(
    "toolbox",
    "工具箱导入不能替换当前带附加字段的规则且会提示",
    blocked?.ok === false && blocked?.code === "CONFIGURATION_EXISTING_RULES_UNSUPPORTED" &&
      afterBlocked.exclusionRules[0]?.futurePolicy?.enabled === false,
  );
  await until(
    async () => await page.$eval(".browser-toolbox-main", (element) => !element.inert),
    "工具箱导入失败后未解除忙碌状态",
  );
  await upload("toolbox-other.json", { settingsVersion: "2.4.2", scrollStepSize: 104 });
  await page.waitForFunction(() => globalThis.__syntheticImportResponses.length === 2, {
    polling: 50,
  });
  const accepted = await page.evaluate(() => globalThis.__syntheticImportResponses[1]);
  const afterAccepted = await worker.evaluate(async () =>
    (await BrowserToolboxConfigurationWriterInstance.read()).keyboard
  );
  check(
    "toolbox",
    "工具箱仍可导入其他字段且保留原规则",
    accepted?.ok === true && afterAccepted.scrollStepSize === 104 &&
      afterAccepted.exclusionRules[0]?.futurePolicy?.enabled === false,
  );
  await browser.close();
  browser = null;
}

try {
  const built = path.join(temporary, "build");
  await buildArtifacts({ output: built });
  const canary = await buildInputCanary(Deno.cwd(), Deno.cwd(), { pages: true });
  canaryRoot = path.dirname(canary.extensionPath);
  await testPlan(1, path.join(built, "browser-toolbox"));
  await testPlan(9, canary.extensionPath);
  await testToolbox(path.join(built, "browser-toolbox"));
  if (report.checks.some((item) => item.status !== "passed") || report.pageErrors.length) {
    throw new Error("存在未通过的规则保留或并发保存检查");
  }
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  throw failure;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  if (canaryRoot) await Deno.remove(canaryRoot, { recursive: true });
  await Deno.remove(temporary, { recursive: true });
}
