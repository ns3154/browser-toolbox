// SPDX-License-Identifier: GPL-3.0-or-later
// 纯函数对照与后台取消测试补充原生 CFT，不能替代原生命中、点击或多 frame 验收。
import "../test_helper.js";
import "../../../lib/keyboard_utils.js";
import "../../../lib/settings.js";
import "../../../content_scripts/link_hints.js";
import "../../../lib/browser_toolbox/runtime_plan.js";
import "../../../content_scripts/browser_toolbox/hints_matcher.js";
import "../../../background_scripts/browser_toolbox/hints_coordinator.js";

const { Matcher, alphabetCodes, numericCode } = BrowserToolboxHintsMatcher;
context("独立提示匹配冻结对照", () => {
  should("默认包拒绝方案 5 和单独替换提示的模块混合", () => {
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_HINTS_CANARY);
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.HINTS_CANARY_PLAN),
    );
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical({
        ...BrowserToolboxRuntimePlans.COMPAT_PLAN,
        moduleImplementations: {
          ...BrowserToolboxRuntimePlans.COMPAT_PLAN.moduleImplementations,
          hints: "browser-toolbox",
        },
      }),
    );
  });
  should("独立叶节点索引覆盖短码、变长码和自定义重复字符", () => {
    for (const characters of ["asdfghjkl", "ab", "abc", "aba", "asdf<>[]", "中あa", "a😀"]) {
      stub(Settings, "get", () => characters);
      const old = new AlphabetHints();
      for (const count of [0, 1, 2, 3, 8, 9, 10, 19, 80, 1000]) {
        assert.equal(old.hintStrings(count), alphabetCodes(count, characters));
      }
    }
  });
  should("过滤评分、稳定排序、Tab、回退和数字前缀与冻结实现相同", () => {
    for (const digits of ["0123456789", "AB", "13579"]) {
      stub(Settings, "get", () => digits);
      const old = new FilterHints();
      const own = new Matcher(true, "asdf", digits);
      for (const number of [1, 2, 10, 99, 1000]) {
        assert.equal(old.generateHintString(number), numericCode(number, digits));
      }
      const markers = () =>
        [
          "alpha",
          "alphabet",
          "beta alpha",
          "alpha beta",
          "",
          "中文目标",
          "Älpha",
          "beta",
          "alpha alpha",
        ].map((linkText, index) => ({
          linkText,
          stableSortCount: index + 1,
          id: index,
          isLocalMarker: () => false,
        }));
      const oldMarkers = markers(), ownMarkers = markers();
      for (const state of ["", "a", "alpha", "alpha b", "alpha bx", "zzzz", "中文", "beta"]) {
        for (const tabCount of [0, 1, -1, 8, -8]) {
          old.hintKeystrokeQueue = own.hintKeystrokeQueue = [];
          old.linkTextKeystrokeQueue = [...state];
          own.linkTextKeystrokeQueue = [...state];
          const expected = old.getMatchingHints(oldMarkers, tabCount),
            actual = own.match(ownMarkers, tabCount);
          assert.equal(
            expected.linksMatched.map((marker) => [marker.id, marker.hintString]),
            actual.linksMatched.map((marker) => [marker.id, marker.hintString]),
          );
          assert.equal(old.activeHintMarker?.id, own.activeHintMarker?.id);
          assert.equal(old.linkTextKeystrokeQueue, own.linkTextKeystrokeQueue);
        }
      }
      for (const character of "alpha AB- 19") {
        old.pushKeyChar(character);
        own.pushKeyChar(character);
      }
      assert.equal(old.hintKeystrokeQueue, own.hintKeystrokeQueue);
      assert.equal(old.linkTextKeystrokeQueue, own.linkTextKeystrokeQueue);
    }
  });
});

context("独立提示后台身份与取消", () => {
  let coordinator, identities, sent, sender, authority, input;
  setup(() => {
    authority = {
      documentId: "synthetic-document",
      runtimeEpoch: 1,
      planVersion: 5,
      incognito: false,
    };
    identities = new Map([[0, authority], [2, { ...authority, documentId: "synthetic-child" }]]);
    sender = { tab: { id: 11 }, frameId: 0, documentId: authority.documentId };
    sent = [];
    coordinator = new BrowserToolboxHintsCoordinator.Coordinator({
      frames: async () => [0, 2],
      target: async (_, id) => identities.get(id),
      send: async (_, frameId, message) => {
        sent.push({ frameId, ...message });
        return message.messageType === "getHintDescriptors"
          ? [{ frameId, localIndex: 0, linkText: "synthetic alpha" }]
          : { ok: true };
      },
    });
    input = { interactionId: crypto.randomUUID(), modeIndex: 0 };
  });
  should("收集和激活仅发给同方案的原生文档", async () => {
    assert.isTrue((await coordinator.prepare(input, sender, authority)).ok);
    assert.equal([0, 2, 0, 2], sent.map((item) => item.frameId));
    assert.equal(["2"], Object.keys(sent[2].frameIdToHintDescriptors));
    assert.equal(["0"], Object.keys(sent[3].frameIdToHintDescriptors));
    const reply = await coordinator.broadcast(
      { ...input, messageType: "exit", isSuccess: true },
      sender,
      authority,
    );
    assert.isTrue(reply.ok);
    assert.equal(0, coordinator.sessions.size);
    assert.equal(
      "STALE_INTERACTION",
      (await coordinator.broadcast(
        { ...input, messageType: "exit", isSuccess: true },
        sender,
        authority,
      )).code,
    );
  });
  should("混合方案不激活，导航后取消全会话且不向新文档发动作", async () => {
    identities.set(2, { ...identities.get(2), planVersion: 4 });
    assert.equal(
      "RUNTIME_PLAN_MISMATCH",
      (await coordinator.prepare(input, sender, authority)).code,
    );
    assert.equal(0, sent.filter((item) => item.messageType === "activateMode").length);
    identities.set(2, { ...identities.get(2), planVersion: 5 });
    await coordinator.prepare(input, sender, authority);
    identities.set(2, { ...identities.get(2), documentId: "replacement-child" });
    sent.length = 0;
    assert.equal(
      "STALE_DOCUMENT",
      (await coordinator.broadcast({ ...input, messageType: "rotateHints" }, sender, authority))
        .code,
    );
    assert.equal(0, sent.filter((item) => item.frameId === 2).length);
    assert.equal(0, coordinator.sessions.size);
  });
  should("源文档注销及非法队列拒绝重复激活", async () => {
    await coordinator.prepare(input, sender, authority);
    assert.equal(
      "INVALID_HINT_ACTION",
      (await coordinator.broadcast({ ...input, messageType: "activateMode" }, sender, authority))
        .code,
    );
    assert.equal(
      "INVALID_HINT_ACTION",
      (await coordinator.broadcast(
        { ...input, messageType: "updateKeyState", hintKeystrokeQueue: ["ab"], tabCount: 0 },
        sender,
        authority,
      )).code,
    );
    await coordinator.releaseDocument(authority, sender);
    assert.equal(0, coordinator.sessions.size);
    assert.isTrue(sent.slice(-2).every((item) => item.messageType === "exit" && !item.isSuccess));
  });
  should("准备中取消使迟到扫描无效", async () => {
    let release;
    coordinator.send = async (_, frameId, message) =>
      message.messageType === "getHintDescriptors"
        ? await new Promise((resolve) => {
          if (frameId === 0) release = () => resolve([]);
          else resolve([]);
        })
        : { ok: true };
    const pending = coordinator.prepare(input, sender, authority);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    await coordinator.cancelTab(sender.tab.id);
    release();
    assert.equal("STALE_RUNTIME", (await pending).code);
    assert.equal(0, coordinator.sessions.size);
  });
  should("worker 丢失会话只允许负向取消，不能重放选中动作", async () => {
    assert.equal(
      "STALE_INTERACTION",
      (await coordinator.broadcast(
        { ...input, messageType: "exit", isSuccess: true },
        sender,
        authority,
      )).code,
    );
    assert.equal(
      "INTERACTION_CANCELLED",
      (await coordinator.broadcast(
        { ...input, messageType: "exit", isSuccess: false },
        sender,
        authority,
      )).code,
    );
    assert.equal(0, coordinator.sessions.size);
    assert.isTrue(sent.every((item) => item.messageType === "exit" && item.isSuccess === false));
    assert.equal(
      "STALE_RUNTIME",
      (await coordinator.broadcast({ ...input, messageType: "exit", isSuccess: false }, sender, {
        ...authority,
        runtimeEpoch: 2,
      })).code,
    );
  });
  should("仅固定定义可扩展到方案6，不能按请求或跨方案框架放行", async () => {
    authority.planVersion = 6;
    identities.set(2, { ...identities.get(2), planVersion: 6 });
    assert.equal("RUNTIME_PLAN_MISMATCH", (await coordinator.prepare(input, sender, authority)).code);
    coordinator.allowsPlan = (version) => [5, 6].includes(version);
    assert.isTrue((await coordinator.prepare(input, sender, authority)).ok);
    const { planVersion: _, ...unregister } = authority;
    await coordinator.releaseDocument(unregister, sender);
    assert.equal(0, coordinator.sessions.size);
    identities.set(2, { ...identities.get(2), planVersion: 5 });
    sent.length = 0;
    assert.equal("RUNTIME_PLAN_MISMATCH", (await coordinator.prepare(input, sender, authority)).code);
    assert.equal(0, sent.filter((item) => item.messageType === "activateMode").length);
    sent.length = 0;
    assert.isTrue((await coordinator.broadcast({ ...input, messageType: "exit", isSuccess: false }, sender, authority)).ok);
    assert.equal([0], sent.map((item) => item.frameId));
  });
});
