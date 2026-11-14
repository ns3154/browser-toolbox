// SPDX-License-Identifier: GPL-3.0-or-later
// 仅用内存 target 模拟浏览器入口发现，不启动或连接浏览器。
import { assert, context, should } from "../../vendor/shoulda.js";
import { resolveCanaryExtensionId } from "../../../scripts/canary_browser_session.js";

const productId = "abcdefghijklmnopabcdefghijklmnop";
const anotherId = "ponmlkjihgfedcbaponmlkjihgfedcba";
const url = (id, entry) => `chrome-extension://${id}/${entry}`;
const main = (id = productId) => url(id, "background_scripts/main.js");
const onboarding = (id = productId) => url(id, "pages/onboarding.html");
const browserWith = (urls) => {
  const targets = urls.map((value) => ({ url: () => value }));
  return {
    async waitForTarget(predicate) {
      const target = targets.find(predicate);
      if (!target) throw new Error("没有匹配的产品入口");
      return target;
    },
    targets: () => targets,
  };
};
const rejects = async (action, message) => {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error.message;
  }
  assert.equal(message, failure);
};

context("CUA 待测扩展入口身份识别", () => {
  should("从合法32位ID的主worker入口识别身份", async () => {
    assert.equal(productId, await resolveCanaryExtensionId(browserWith([main()])));
  });
  should("worker休眠时从既有引导页识别身份", async () => {
    assert.equal(productId, await resolveCanaryExtensionId(browserWith([onboarding()])));
  });
  should("同一产品的worker和多个引导页去重后仍是唯一身份", async () => {
    assert.equal(
      productId,
      await resolveCanaryExtensionId(browserWith([main(), onboarding(), onboarding()])),
    );
  });
  should("忽略CUA及其他扩展的非产品入口", async () => {
    const others = [
      url(anotherId, "background.js"),
      url(anotherId, "service_worker.js"),
      url(anotherId, "pages/options.html"),
      "about:blank",
      "http://127.0.0.1/fixture",
    ];
    assert.equal(productId, await resolveCanaryExtensionId(browserWith([...others, main()])));
    await rejects(() => resolveCanaryExtensionId(browserWith(others)), "没有匹配的产品入口");
  });
  should("拒绝长度错误及a到p以外的扩展ID", async () => {
    for (
      const id of [
        "a".repeat(31),
        "a".repeat(33),
        "q".repeat(32),
        "A".repeat(32),
        "0".repeat(32),
        "a{32]",
      ]
    ) {
      await rejects(
        () => resolveCanaryExtensionId(browserWith([main(id), onboarding(id)])),
        "没有匹配的产品入口",
      );
    }
  });
  should("入口必须匹配完整协议和路径，不能接受相似文件名或后缀", async () => {
    for (
      const invalid of [
        main().replace("chrome-extension:", "https:"),
        main() + ".bak",
        onboarding() + "?probe=1",
        onboarding() + "#probe",
        url(productId, "other/background_scripts/main.js"),
      ]
    ) {
      await rejects(() => resolveCanaryExtensionId(browserWith([invalid])), "没有匹配的产品入口");
    }
  });
  should("不同合法ID同时具有产品入口时拒绝猜选", async () => {
    await rejects(
      () => resolveCanaryExtensionId(browserWith([main(), onboarding(anotherId)])),
      "待测扩展入口身份不唯一",
    );
  });
  should("没有入口和等待后入口消失时不得返回空身份", async () => {
    await rejects(() => resolveCanaryExtensionId(browserWith([])), "没有匹配的产品入口");
    const browser = browserWith([main()]);
    browser.targets = () => [];
    await rejects(() => resolveCanaryExtensionId(browser), "待测扩展入口身份不唯一");
  });
});

if (import.meta.main) {
  const { run } = await import("../../vendor/shoulda.js");
  if (!await run()) Deno.exitCode = 1;
}
