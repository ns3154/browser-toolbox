// SPDX-License-Identifier: GPL-3.0-or-later
// 原生专项共享启动层：默认保留 Puppeteer；显式队列仅把同参数的 headed CFT 交给 CUA 后台启动。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { compareCanaryBrowserArguments } from "./canary_browser_arguments.js";
import { createCanaryCloseObserver, inspectCanaryProcess } from "./canary_browser_process.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const hashBytes = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hashFile = async (filename) => hashBytes(await Deno.readFile(filename));
const hashText = (value) => hashBytes(new TextEncoder().encode(value));
async function command(executable, args) {
  const result = await new Deno.Command(executable, { args }).output();
  assert(result.success, `${executable} 失败：${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout);
}
async function readOptional(filename) {
  try {
    return await Deno.readTextFile(filename);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
async function waitFor(predicate, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(100);
  }
  throw new Error(label);
}
async function extensionHashes(directory, prefix = "") {
  const result = {};
  const entries = [...await Array.fromAsync(Deno.readDir(directory))]
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix + entry.name, filename = path.join(directory, entry.name);
    if (entry.isDirectory) Object.assign(result, await extensionHashes(filename, relative + "/"));
    else if (entry.isFile) result[relative] = await hashFile(filename);
    else throw new Error(`扩展目录含非普通文件：${relative}`);
  }
  return result;
}

async function assertNoExistingCft() {
  const processes = await command("/bin/ps", ["-ww", "-axo", "pid=,comm="]);
  const existing = processes.split("\n").filter((line) =>
    line.trim().endsWith("/Contents/MacOS/Google Chrome for Testing") ||
    line.trim().endsWith("/Contents/MacOS/BrowserToolboxCuaLauncher")
  );
  assert(
    existing.length === 0,
    `已有同 bundle CFT，须先由所属会话收尾，禁止 CUA 误绑定：${existing.join("; ")}`,
  );
}

// 位置只有显式环境参数才能改变；不因 CUA 模式自动移动原有副屏窗口。
function positionOptions(launchOptions) {
  const override = Deno.env.get("BROWSER_TOOLBOX_CFT_WINDOW_POSITION");
  const args = [...(launchOptions.args || [])];
  const index = args.findIndex((argument) => argument.startsWith("--window-position="));
  const value = override || (index < 0 ? undefined : args[index].slice(18));
  if (value !== undefined) assert(/^-?\d+,-?\d+$/.test(value), "CFT 窗口位置必须是整数 x,y");
  if (override) {
    if (index < 0) args.push(`--window-position=${override}`);
    else args[index] = `--window-position=${override}`;
  }
  const coordinates = value?.split(",").map(Number);
  return {
    options: { ...launchOptions, args },
    position: coordinates ? { left: coordinates[0], top: coordinates[1] } : undefined,
    override: override || null,
  };
}

// 与锁定 Puppeteer 的 ChromeLauncher.computeLaunchArguments 使用相同的公开默认参数和忽略规则。
export function canaryChromeArguments(options) {
  const copy = { ...options, args: [...(options.args || [])] };
  const ignored = copy.ignoreDefaultArgs;
  const args = ignored === true ? copy.args : puppeteer.defaultArgs(copy)
    .filter((argument) => !Array.isArray(ignored) || !ignored.includes(argument));
  if (!args.some((argument) => argument.startsWith("--remote-debugging-"))) {
    args.push(`--remote-debugging-port=${copy.debuggingPort || 0}`);
  }
  assert(
    args.includes(`--user-data-dir=${path.resolve(copy.userDataDir)}`),
    "缺少独立 profile 参数",
  );
  return args;
}

export async function resolveCanaryExtensionId(browser) {
  // CUA 自身可带后台扩展；只识别本产品明确入口，休眠时可用既有引导页身份。
  const matches = (target) =>
    /^chrome-extension:\/\/[a-p]{32}\/(?:background_scripts\/main\.js|pages\/onboarding\.html)$/
      .test(target.url());
  await browser.waitForTarget(matches);
  const ids = [
    ...new Set(browser.targets().filter(matches).map((target) => new URL(target.url()).host)),
  ];
  assert(ids.length === 1, "待测扩展入口身份不唯一");
  return ids[0];
}

// 仅允许同一进程接续自己已正常关闭的合成配置，用于同 ID 升级验证。
const closedProfiles = new WeakMap();
export async function launchCanaryBrowser({
  launchOptions,
  label,
  plan,
  extensionPath,
  previousSession,
}) {
  const positioned = positionOptions(launchOptions), options = positioned.options;
  if (options.headless === false && Deno.env.get("BROWSER_TOOLBOX_ALLOW_HEADED_TESTS") !== "true") {
    throw new Error("原生有头专项已停止：须先获得用户明确授权，常规测试只使用无头浏览器。");
  }
  const queue = Deno.env.get("BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE");
  if (!queue) {
    const browser = await puppeteer.launch(options), child = browser.process();
    return {
      browser,
      pid: child.pid,
      metadata: {
        mode: "puppeteer-launch",
        connection: "owned",
        headed: options.headless === false,
        windowPosition: positioned.position,
        windowPositionOverride: positioned.override,
      },
      windowPosition: positioned.position,
      windowCreateOptions: positioned.override ? positioned.position : {},
      newPage: () => browser.newPage(),
      activatePage: (page) => page.bringToFront(),
      close: () => browser.close(),
      disconnect: () => browser.disconnect(),
      terminate() {
        if (!child.killed && child.exitCode == null) child.kill("SIGTERM");
      },
    };
  }

  assert(Deno.build.os === "darwin", "CUA 后台启动当前仅支持 macOS 完整 CFT");
  assert(options.headless === false, "CUA 队列只接管原有 headed 专项，禁止改用 headless");
  assert(!options.pipe && !options.env, "CUA 会话不支持 pipe 或自定义进程环境");
  assert(
    options.userDataDir && path.isAbsolute(options.userDataDir),
    "必须使用独立绝对 profile 路径",
  );
  const previous = closedProfiles.get(previousSession);
  if (previousSession) {
    assert(
      previous?.profile === options.userDataDir && previous.extensionPath === extensionPath,
      "CUA 仅能重用本次已正常关闭的合成 profile 与扩展路径",
    );
    const portFile = path.join(options.userDataDir, "DevToolsActivePort");
    if (await readOptional(portFile)) await Deno.remove(portFile);
    closedProfiles.delete(previousSession);
  } else {
    assert(
      (await Array.fromAsync(Deno.readDir(options.userDataDir))).length === 0,
      "CUA profile 必须全新",
    );
  }
  await assertNoExistingCft();
  const sourceBinary = await Deno.realPath(options.executablePath);
  const sourceApp = path.dirname(path.dirname(path.dirname(sourceBinary)));
  const sourcePlist = path.join(sourceApp, "Contents/Info.plist");
  const sourceInfo = JSON.parse(
    await command("/usr/bin/plutil", ["-convert", "json", "-o", "-", sourcePlist]),
  );
  assert(
    sourceInfo.CFBundleExecutable === "Google Chrome for Testing",
    "只允许完整 Google Chrome for Testing",
  );
  assert(
    sourceBinary === path.join(sourceApp, "Contents/MacOS", sourceInfo.CFBundleExecutable),
    "CFT binary 路径不符",
  );
  const version = sourceInfo.CFBundleShortVersionString;
  const framework =
    `Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/${version}/Google Chrome for Testing Framework`;
  await Deno.stat(path.join(sourceApp, framework));
  const sourceBinarySha256 = await hashFile(sourceBinary),
    sourcePlistSha256 = await hashFile(sourcePlist);
  const extensionFileHashes = await extensionHashes(extensionPath);
  const extensionTreeSha256 = await hashText(JSON.stringify(extensionFileHashes));
  const temporaryRoot = await Deno.makeTempDir({ prefix: "browser-toolbox-cua-canary-" });
  const appPath = path.join(temporaryRoot, "BrowserToolbox CUA Canary.app");
  await command("/bin/cp", ["-cR", sourceApp, appPath]);
  const executablePath = path.join(appPath, "Contents/MacOS", sourceInfo.CFBundleExecutable);
  await Deno.stat(path.join(appPath, framework));
  assert(await hashFile(executablePath) === sourceBinarySha256, "CFT 副本 binary 不一致");
  const chromeArguments = canaryChromeArguments(options);
  assert(
    !chromeArguments.some((argument) => argument.startsWith("--headless")),
    "headed 参数被改变",
  );
  assert(chromeArguments.includes(`--load-extension=${extensionPath}`), "加载扩展参数不符");
  assert(
    chromeArguments.includes(`--disable-extensions-except=${extensionPath}`),
    "扩展隔离参数不符",
  );
  assert(chromeArguments.includes("--remote-debugging-port=0"), "CUA 只接受随机 loopback CDP 端口");
  const requestId = `${Date.now()}-${crypto.randomUUID()}`;
  const queuePath = path.resolve(queue);
  await Deno.mkdir(queuePath, { recursive: true });
  const pidRecord = path.join(temporaryRoot, "launcher-pid.json");
  const cancellationPath = path.join(queuePath, `${requestId}.launch.cancelled.json`);
  const expiresAt = Date.now() + 180000;
  const configuration = {
    requestId,
    label,
    plan,
    appPath,
    executablePath,
    profile: options.userDataDir,
    pidRecord,
    cancellationPath,
    expiresAt,
    sourceBinary,
    sourcePlist,
    sourceBinarySha256,
    sourcePlistSha256,
    version,
    extensionPath,
    extensionFileHashes,
    extensionTreeSha256,
    chromeArguments,
    defaultViewport: options.defaultViewport,
    windowPosition: positioned.position,
    windowPositionOverride: positioned.override,
  };
  const configurationText = JSON.stringify(configuration, null, 2) + "\n";
  const configurationSha256 = await hashText(configurationText);
  const configurationPath = path.join(temporaryRoot, "configuration.json");
  await Deno.writeTextFile(configurationPath, configurationText, { createNew: true });
  const launcherPath = path.join(appPath, "Contents/MacOS/BrowserToolboxCuaLauncher");
  const launcherSourcePath = path.join(temporaryRoot, "launcher.c");
  const recordFormat = `{"pid":%ld,"configurationSha256":"${configurationSha256}"}\n`;
  await Deno.writeTextFile(
    launcherSourcePath,
    `// 同 PID execv 继承 CUA 后台环境；不读取或保存环境内容。
#include <fcntl.h>
#include <stdio.h>
#include <time.h>
#include <unistd.h>
int main(void) {
  if (access(${
      JSON.stringify(cancellationPath)
    }, F_OK) == 0 || time(NULL) * 1000LL > ${expiresAt}LL) return 75;
  int fd = open(${JSON.stringify(pidRecord)}, O_WRONLY | O_CREAT | O_EXCL, 0600);
  if (fd < 0) return 73;
  int written = dprintf(fd, ${JSON.stringify(recordFormat)}, (long)getpid());
  if (written < 0 || close(fd) != 0) return 74;
  char *const args[] = {${
      [executablePath, ...chromeArguments].map((value) => JSON.stringify(value)).join(",")
    }, NULL};
  if (access(${JSON.stringify(cancellationPath)}, F_OK) == 0) return 75;
  execv(${JSON.stringify(executablePath)}, args);
  return 127;
}
`,
    { createNew: true },
  );
  await command("/usr/bin/clang", [
    "-Wall",
    "-Wextra",
    "-Werror",
    "-O2",
    launcherSourcePath,
    "-o",
    launcherPath,
  ]);
  await command("/usr/libexec/PlistBuddy", [
    "-c",
    "Set :CFBundleExecutable BrowserToolboxCuaLauncher",
    path.join(appPath, "Contents/Info.plist"),
  ]);
  assert(
    await hashFile(sourceBinary) === sourceBinarySha256 &&
      await hashFile(sourcePlist) === sourcePlistSha256,
    "原 CFT 被改变",
  );
  await assertNoExistingCft();
  const launchRequestPath = path.join(queuePath, `${requestId}.launch.request.json`);
  await Deno.writeTextFile(
    launchRequestPath,
    JSON.stringify(
      {
        ...configuration,
        kind: "launch",
        status: "awaiting-cua",
        configurationPath,
        configurationSha256,
        instruction: "仅由主会话 cua.getApp(appPath) 后台启动；禁止 open/activate/headless 替代",
      },
      null,
      2,
    ) + "\n",
    { createNew: true },
  );
  console.log(`等待 CUA 后台启动：${launchRequestPath}`);
  let pid, verifiedProcessStart;
  const ownedProcessState = async () => {
    const record = JSON.parse(await Deno.readTextFile(pidRecord));
    assert(
      record.configurationSha256 === configurationSha256 && Number.isSafeInteger(record.pid) &&
        record.pid > 1,
      "CUA PID 记录无效",
    );
    assert(pid === undefined || pid === record.pid, "CUA PID 记录被替换");
    pid = record.pid;
    const result = await new Deno.Command("/bin/ps", {
      args: ["-ww", "-p", String(pid), "-o", "pid=,lstart=,stat=,command="],
    }).output();
    const snapshot = {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
    const expected = { pid, launcherPath, command: [executablePath, ...chromeArguments].join(" ") };
    try {
      const current = inspectCanaryProcess(snapshot, expected, verifiedProcessStart);
      verifiedProcessStart = current.verifiedStart;
      return current.state;
    } catch (error) {
      // 只记录本轮指定 PID 的原始查询，保留退出竞态证据；不放宽身份判断或增加信号发送。
      const diagnosticPath = path.join(
        queuePath,
        `${requestId}.process-mismatch-${crypto.randomUUID()}.json`,
      );
      try {
        await Deno.writeTextFile(
          diagnosticPath,
          JSON.stringify(
            {
              requestId,
              configurationSha256,
              observedAt: new Date().toISOString(),
              error: error.message,
              verifiedProcessStart: verifiedProcessStart ?? null,
              expected,
              snapshot,
            },
            null,
            2,
          ) + "\n",
          { createNew: true },
        );
        error.message += `；原始 PID 诊断：${diagnosticPath}`;
      } catch (diagnosticError) {
        error.message += `；PID 诊断写入失败：${diagnosticError.message}`;
      }
      throw error;
    }
  };
  const verifyProcess = async () => {
    const state = await ownedProcessState();
    assert(state !== "launcher", "CUA 同 PID 仍在 launcher 阶段");
    return state === "browser";
  };
  let browser;
  try {
    const endpoint = await waitFor(async () => {
      if (!await readOptional(pidRecord)) return null;
      const activePort = await readOptional(path.join(options.userDataDir, "DevToolsActivePort"));
      if (!activePort) return null;
      assert(await verifyProcess(), "CUA browser 已退出");
      const [port, browserPath] = activePort.trim().split("\n");
      assert(
        /^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536 &&
          /^\/devtools\/browser\/[\w-]+$/.test(browserPath),
        "CDP 端口记录无效",
      );
      return `ws://127.0.0.1:${port}${browserPath}`;
    }, "CUA 后台启动等待超时；保留请求及独立 profile 供检查");
    assert(await hashFile(configurationPath) === configurationSha256, "CUA 配置记录被改变");
    assert(await hashFile(executablePath) === sourceBinarySha256, "CUA binary 被改变");
    assert(
      await hashText(JSON.stringify(await extensionHashes(extensionPath))) === extensionTreeSha256,
      "待测扩展被改变",
    );
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      defaultViewport: options.defaultViewport,
      ...(options.protocolTimeout === undefined
        ? {}
        : { protocolTimeout: options.protocolTimeout }),
      ...(options.slowMo === undefined ? {} : { slowMo: options.slowMo }),
    });
    const client = await browser.target().createCDPSession();
    let argumentComparisonPath, argumentNormalization;
    try {
      assert(await browser.version() === `Chrome/${version}`, "CUA CFT 版本不一致");
      const actualArgs = (await client.send("Browser.getBrowserCommandLine")).arguments;
      const comparison = compareCanaryBrowserArguments(
        [executablePath, ...chromeArguments],
        actualArgs,
      );
      argumentComparisonPath = path.join(
        queuePath,
        `${requestId}.launch.arguments${comparison.equal ? "" : "-mismatch"}.json`,
      );
      argumentNormalization = comparison.normalization;
      await Deno.writeTextFile(
        argumentComparisonPath,
        JSON.stringify(
          {
            requestId,
            pid,
            configurationSha256,
            scope: "仅本轮独立合成 CFT 的 CDP 启动参数；不读取进程环境；OS 原始完整 argv 检查不变",
            ...comparison,
          },
          null,
          2,
        ) + "\n",
        { createNew: true },
      );
      assert(comparison.equal, `CDP 实例启动参数不一致；严格比较诊断：${argumentComparisonPath}`);
    } catch (error) {
      browser.disconnect();
      throw error;
    } finally {
      await client.detach().catch(() => {});
    }
    const metadata = {
      mode: "cua-background",
      connection: "owned",
      headed: true,
      requestId,
      appPath,
      temporaryRoot,
      configurationPath,
      configurationSha256,
      launchRequestPath,
      browserPid: pid,
      browserWsEndpoint: endpoint,
      sourceBinarySha256,
      extensionTreeSha256,
      version,
      windowPosition: positioned.position,
      windowPositionOverride: positioned.override,
      launchArguments: chromeArguments,
      argumentComparisonPath,
      argumentNormalization,
      focusRequests: [],
    };
    await Deno.writeTextFile(
      path.join(queuePath, `${requestId}.launch.connected.json`),
      JSON.stringify(metadata, null, 2) + "\n",
      { createNew: true },
    );
    let disconnected = false, closed = false;
    const finishClose = async () => {
      if (closed) return;
      closed = true;
      await Deno.remove(temporaryRoot, { recursive: true });
      await Deno.writeTextFile(
        path.join(queuePath, `${requestId}.launch.closed.json`),
        JSON.stringify({ requestId, pid, status: "closed" }) + "\n",
        { createNew: true },
      );
    };
    const session = {
      browser,
      pid,
      metadata,
      windowPosition: positioned.position,
      windowCreateOptions: {
        focused: false,
        ...(positioned.override ? positioned.position : {}),
      },
      async newPage() {
        const session = await browser.target().createCDPSession();
        try {
          const { targetId } = await session.send("Target.createTarget", {
            url: "about:blank",
            background: true,
          });
          const target = await browser.waitForTarget((candidate) =>
            candidate._targetId === targetId
          );
          return await target.page();
        } finally {
          await session.detach();
        }
      },
      // 仅替换原有测试准备激活点；调用方不得在产品焦点归还断言之前用本方法补焦点。
      async activatePage(page, extensionPage, { requireFocus = true, tabId } = {}) {
        assert(extensionPage, "CUA 标签选择必须提供本会话扩展上下文");
        const selected = await extensionPage.evaluate(async ({ url, tabId }) => {
          const candidates = tabId === undefined
            ? (await chrome.tabs.query({})).filter((tab) => tab.url === url)
            : [await chrome.tabs.get(tabId)];
          if (candidates.length !== 1 || candidates[0].url !== url) {
            throw new Error("CUA 目标标签不唯一或 URL 不符");
          }
          const tab = await chrome.tabs.update(candidates[0].id, { active: true });
          return { tabId: tab.id, windowId: tab.windowId, url: tab.url };
        }, { url: page.url(), tabId });
        if (!requireFocus || await page.evaluate(() => document.hasFocus())) return;
        const focusId = `${requestId}-${crypto.randomUUID()}`;
        const responsePath = path.join(queuePath, `${focusId}.focus.response.json`);
        const requestPath = path.join(queuePath, `${focusId}.focus.request.json`);
        const request = {
          kind: "focus",
          requestId: focusId,
          launchRequestId: requestId,
          pid,
          appPath,
          ...selected,
          responsePath,
          title: await page.title(),
          instruction: "仅在 CUA 后台控制会话选择该标签；禁止系统激活或测试注入 window.focus",
        };
        metadata.focusRequests.push(requestPath);
        await Deno.writeTextFile(requestPath, JSON.stringify(request, null, 2) + "\n", {
          createNew: true,
        });
        console.log(`等待 CUA 后台准备焦点：${requestPath}`);
        await waitFor(async () => {
          const text = await readOptional(responsePath);
          if (!text) return false;
          const response = JSON.parse(text);
          assert(
            response.requestId === focusId && response.pid === pid &&
              response.status === "completed",
            "CUA 焦点握手未完成或身份不符",
          );
          return true;
        }, "CUA 后台准备焦点等待超时");
        await waitFor(
          () => page.evaluate(() => document.hasFocus()),
          "CUA 应答后页面仍未获得真实焦点",
          5000,
        );
      },
      async close() {
        if (disconnected || closed) return;
        if (await verifyProcess()) {
          await browser.close();
          const observeClose = createCanaryCloseObserver(
            async () => await verifyProcess() ? "browser" : "exited",
            sleep,
          );
          await waitFor(
            async () => await observeClose() === "exited",
            "CUA owned browser 关闭等待超时",
            5000,
          );
        }
        await finishClose();
        closedProfiles.set(session, { profile: options.userDataDir, extensionPath });
      },
      disconnect() {
        disconnected = true;
        browser.disconnect();
      },
      async terminate() {
        if (disconnected || closed) return;
        if (await verifyProcess()) Deno.kill(pid, "SIGTERM");
        await waitFor(
          async () => !await verifyProcess(),
          "CUA owned PID 尚未退出，保留 profile",
          5000,
        );
        await finishClose();
      },
    };
    return session;
  } catch (error) {
    // 请求发布后的失败也必须收口：取消迟到启动，仅核验后终止本次原生 PID。
    const cleanup = { requestId, status: "cancelled", error: error.message, pid: pid ?? null };
    await Deno.writeTextFile(cancellationPath, JSON.stringify(cleanup, null, 2) + "\n", {
      createNew: true,
    });
    try {
      if (await readOptional(pidRecord)) {
        const state = await waitFor(
          async () => {
            const current = await ownedProcessState();
            return current === "launcher" ? null : current;
          },
          "取消后同 PID launcher 尚未退出或完成 execv，保留证据",
          5000,
        );
        if (state === "browser" && await verifyProcess()) {
          Deno.kill(pid, "SIGTERM");
          await waitFor(
            async () => !await verifyProcess(),
            "启动失败后的 owned PID 尚未退出",
            5000,
          );
        }
      }
    } catch (cleanupError) {
      error.message += `；本次 PID 收尾未完成：${cleanupError.message}，证据 ${launchRequestPath}`;
    } finally {
      browser?.disconnect();
    }
    throw error;
  }
}
