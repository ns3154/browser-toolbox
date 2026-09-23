#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys
// Usage: ./make.js command. Use -l to list commands.
// This is a set of tasks for building and testing Browser Toolbox in development.
import * as fs from "@std/fs";
import * as path from "@std/path";
import { abort, desc, run, task } from "https://deno.land/x/drake@v1.5.1/mod.ts";
import puppeteer from "npm:puppeteer";
// We use a vendored version of shoulda, rather than jsr:@philc/shoulda, because shoulda.js is used
// in dom_tests.js which is loaded by Puppeteer, which doesn't have access to Deno's module system.
import * as shoulda from "./tests/vendor/shoulda.js";
import { DOMParser } from "@b-fuze/deno-dom";
import * as fileServer from "@std/http/file-server";
import { createFirefoxManifest, readManifest } from "./scripts/release_artifacts.js";

const projectPath = new URL(".", import.meta.url).pathname;

async function shell(procName, argsArray = []) {
  // NOTE(philc): Does drake's `sh` function work on Windows? If so, that can replace this function.
  if (Deno.build.os == "windows") {
    // if win32, prefix arguments with "/c {original command}"
    // e.g. "mkdir c:\git\vimium" becomes "cmd.exe /c mkdir c:\git\vimium"
    argsArray.unshift("/c", procName);
    procName = "cmd.exe";
  }
  const p = Deno.run({ cmd: [procName].concat(argsArray) });
  const status = await p.status();
  if (!status.success) {
    throw new Error(`${procName} ${argsArray} exited with status ${status.code}`);
  }
}

async function parseManifestFile() {
  return await readManifest(projectPath);
}

async function runUnitTests() {
  // 递归导入所有单元测试，确保新增模块可以按目录组织而不被测试入口遗漏。
  const dir = path.join(projectPath, "tests/unit_tests");
  const files = [];
  const collect = (directory) => {
    for (const entry of Deno.readDirSync(directory)) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory) collect(file);
      else if (entry.name.endsWith("_test.js")) files.push(file);
    }
  };
  collect(dir);
  for (const file of files.sort()) {
    await import(file);
  }

  return await shoulda.run();
}

function setupPuppeteerPageForTests(page) {
  // The "console" event emitted has arguments which are promises. To obtain the values to be
  // printed, we must resolve those promises. However, if many console messages are emitted at once,
  // resolving the promises often causes the console.log messages to be printed out of order. Here,
  // we use a queue to strictly enforce that the messages appear in the order in which they were
  // logged.
  const messageQueue = [];
  let processing = false;
  const processMessageQueue = async () => {
    while (messageQueue.length > 0) {
      const values = await Promise.all(messageQueue.shift());
      console.log(...values);
    }
    processing = false;
  };
  page.on("console", async (msg) => {
    const values = msg.args().map((a) => a.jsonValue());
    messageQueue.push(values);
    if (!processing) {
      processing = true;
      processMessageQueue();
    }
  });

  page.on("error", (err) => {
    // NOTE(philc): As far as I can tell, this handler never gets executed.
    console.error(err);
  });
  // pageerror catches the same events that window.onerror would, like JavaScript parsing errors.
  page.on("pageerror", (error) => {
    // This is an arbitrary field we're writing to the page object.
    page.receivedErrorOutput = true;
    // Whatever type error is, it requires toString() to print the message.
    console.log(error.toString());
  });
  page.on("requestfailed", (request) => {
    console.log(`${request.failure().errorText} ${request.url()}`);
  });
}

// Navigates the Puppeteer `page` to `url` and invokes shoulda.run().
async function runPuppeteerTest(page, url) {
  page.goto(url);
  await page.waitForNavigation({ waitUntil: "load" });
  const success = await page.evaluate(async () => {
    return await shoulda.run();
  });
  return success;
}

desc("Download and parse list of top-level domains (TLDs)");
task("fetch-tlds", [], async () => {
  const suffixListUrl = "https://www.iana.org/domains/root/db";
  const response = await fetch(suffixListUrl);
  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, "text/html");
  const els = doc.querySelectorAll("span.domain.tld");
  // Each span contains a TLD, e.g. ".com". Trim off the leading period.
  const domains = Array.from(els).map((el) => el.textContent.slice(1));
  const str = domains.join("\n");
  await Deno.writeTextFile("./resources/tlds.txt", str);
});

desc("Run unit tests");
task("test-unit", [], async () => {
  const success = await runUnitTests();
  if (!success) {
    abort("test-unit failed");
  }
});

function isPortAvailable(number) {
  try {
    const listener = Deno.listen({ port: number });
    listener.close();
    return true;
  } catch (error) {
    return false;
  }
}

function getAvailablePort() {
  const min = 7000;
  const max = 65535;
  let count = 0;
  const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  let port = getRandomInt(min, max);
  while (!isPortAvailable(port) && count < max - min) {
    port++;
    if (port > max) {
      port = min;
    }
    if (isPortAvailable(port)) {
      return port;
    }
    count++;
    if (count >= max - min) {
      throw new Error(`No port is available in the range ${min} - ${max}`);
    }
  }
  return port;
}

async function testDom() {
  const port = getAvailablePort();
  let served404 = false;
  const httpServer = Deno.serve({ port }, async (req) => {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.startsWith("/")) {
      path = "." + path;
    }
    if (!(await fs.exists(path))) {
      console.error("dom-tests: requested missing file (not found):", path);
      served404 = true;
      return new Response(null, { status: 404 });
    } else {
      return fileServer.serveFile(req, path);
    }
  });

  const files = ["dom_tests.html"];
  const browser = await puppeteer.launch({
    args: Deno.env.get("CI") === "true" ? ["--no-sandbox"] : [],
  });
  let success = true;
  for (const file of files) {
    const page = await browser.newPage();
    console.log("Running", file);
    setupPuppeteerPageForTests(page);
    const url = `http://localhost:${port}/tests/dom_tests/${file}?dom_tests=true`;
    const result = await runPuppeteerTest(page, url);
    success = success && result;
    if (served404) {
      console.log(`${file} failed: a background or content script requested a missing file.`);
    }
    if (page.receivedErrorOutput) {
      console.log(`${file} failed: there was a page level error.`);
      success = false;
    }
    // If we close the puppeteer page (tab) via page.close(), we can get innocuous but noisy output
    // like this:
    // net::ERR_ABORTED http://localhost:43524/pages/hud_page.html?dom_tests=true
    // There's probably a way to prevent that, but as a work around, we avoid closing the page.
    // browser.close() will close all of its owned pages.
  }
  // NOTE(philc): At one point in development, I noticed that the output from Deno would suddenly
  // pause, prior to the tests fully finishing, so closing the browser here may be racy. If it
  // occurs again, we may need to add "await delay(200)".
  await browser.close();
  await httpServer.shutdown();
  if (served404 || !success) {
    abort("test-dom failed.");
  }
}

desc("Run DOM tests");
task("test-dom", [], testDom);

desc("Run unit and DOM tests");
task("test", ["test-unit", "test-dom"]);

desc("运行浏览器工具箱性能回归测量");
task("test-performance", [], async () => {
  await shell("deno", ["run", "-A", "scripts/benchmark_browser_toolbox.js"]);
});

desc("Builds a zip file for submission to the Chrome and Firefox stores. The output is in dist/");
task("package", [], async () => {
  await shell("deno", ["run", "-A", "scripts/build_release.js", "--package"]);
});

desc("运行完整验证门禁，使用临时产物验证真实扩展");
task("verify", [], async () => {
  await shell("deno", ["run", "-A", "scripts/verify.js"]);
});

desc("Build a static version of command_listing.html, to be hosted on vimium.gihub.io");
task("write-command-listing", [], async () => {
  // Run this script in a separate shell so it doesn't pollute our JS environment.
  await shell("./build_scripts/write_command_listing_page.js", []);
});

desc("Replaces manifest.json with a Firefox-compatible version, for development");
task("write-firefox-manifest", [], async () => {
  const firefoxManifest = createFirefoxManifest(await parseManifestFile());
  await Deno.writeTextFile("./manifest.json", JSON.stringify(firefoxManifest, null, 2));
});

run();
