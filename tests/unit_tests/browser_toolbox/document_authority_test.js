// SPDX-License-Identifier: GPL-3.0-or-later
// 模拟浏览器提供的文档身份，伪造的消息字段不能改变角色或所有者。
import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/document_authority.js";
context("文档身份和组件授权", () => {
  function harness() {
    const values = {};
    const frames = new Map();
    const api = {
      runtime: {
        id: "synthetic-extension",
        getURL: (page) => `chrome-extension://synthetic-extension/${page}`,
      },
      storage: {
        session: {
          async get(key) {
            return structuredClone({ [key]: values[key] });
          },
          async set(items) {
            Object.assign(values, structuredClone(items));
          },
        },
      },
      webNavigation: {
        async getFrame({ documentId }) {
          return frames.get(documentId) || null;
        },
      },
    };
    const owner = {
      id: api.runtime.id,
      url: "https://example.invalid/fixture",
      origin: "https://example.invalid",
      documentId: "owner-document",
      frameId: 0,
      tab: { id: 7, incognito: false },
    };
    const child = {
      id: api.runtime.id,
      url: api.runtime.getURL("pages/vomnibar_page.html"),
      documentId: "child-document",
      frameId: 2,
      tab: { id: 7, incognito: false },
    };
    frames.set(owner.documentId, { documentId: owner.documentId, documentLifecycle: "active" });
    frames.set(child.documentId, {
      documentId: child.documentId,
      parentDocumentId: owner.documentId,
      documentLifecycle: "active",
    });
    return {
      api,
      values,
      frames,
      owner,
      child,
      authority: new BrowserToolboxDocumentAuthority(
        api,
        Date.now,
        [1, 2, 3].map((planVersion) => ({ planVersion })),
      ),
      identity: { documentId: owner.documentId, runtimeEpoch: 1, incognito: false },
    };
  }
  async function rejects(promise, code) {
    let failure;
    try {
      await promise;
    } catch (error) {
      failure = error;
    }
    assert.equal(code, failure?.code);
  }
  async function completeClaim(h, grant) {
    const proof = await h.authority.claim(grant, h.child);
    await h.authority.attest(proof, h.identity, h.owner);
    return h.authority.finalize(proof, h.child);
  }
  should("重复登记和迟到清理不重复写，但活动文档及代次校验不能复用旧结果", async () => {
    const h = harness();
    let writes = 0, nativeChecks = 0;
    const set = h.api.storage.session.set;
    h.api.storage.session.set = async (items) => {
      writes++;
      await set(items);
    };
    const frame = h.api.webNavigation.getFrame;
    h.api.webNavigation.getFrame = async (input) => {
      nativeChecks++;
      return frame(input);
    };
    await h.authority.register(h.owner, 1);
    await h.authority.register(h.owner, 1);
    assert.equal(1, writes);
    assert.equal(2, nativeChecks);
    h.frames.get(h.owner.documentId).documentLifecycle = "cached";
    await rejects(h.authority.register(h.owner, 1), "STALE_DOCUMENT");
    assert.equal(3, nativeChecks);
    assert.equal(1, writes);
    h.frames.get(h.owner.documentId).documentLifecycle = "active";
    await h.authority.register(h.owner, 2);
    assert.equal(2, writes);
    await h.authority.unregister(h.identity, h.owner);
    await h.authority.clearTab(999);
    assert.equal(2, writes);
    assert.equal(
      2,
      (await h.authority.verify({ ...h.identity, runtimeEpoch: 2 }, h.owner)).runtimeEpoch,
    );
    await h.authority.unregister({ ...h.identity, runtimeEpoch: 2 }, h.owner);
    assert.equal(3, writes);
    await rejects(h.authority.verify({ ...h.identity, runtimeEpoch: 2 }, h.owner), "STALE_RUNTIME");
  });
  should("BFCache 子文档缺失时必须由原生注入身份补证，同 frame 的旧文档仍拒绝", async () => {
    const h = harness();
    const restored = { ...h.owner, documentId: "restored-subdocument", frameId: 3 };
    let nativeDocument = restored.documentId;
    h.api.webNavigation.getAllFrames = async () => [{ frameId: 0 }];
    h.api.scripting = {
      executeScript: async () => [{ documentId: nativeDocument, frameId: 3, result: true }],
    };
    await h.authority.register(restored, 2);
    const identity = { ...h.identity, documentId: restored.documentId, runtimeEpoch: 2 };
    assert.equal(3, (await h.authority.verify(identity, restored)).frameId);
    assert.equal([0, 3], await h.authority.frameIds(7));
    assert.equal(restored.documentId, (await h.authority.target(7, 3)).documentId);
    await rejects(h.authority.verify({ ...identity, runtimeEpoch: 1 }, restored), "STALE_RUNTIME");
    nativeDocument = "new-subdocument";
    await rejects(h.authority.verify(identity, restored), "STALE_DOCUMENT");
    await rejects(h.authority.target(7, 3), "REFRESH_REQUIRED");
  });
  should(
    "原生返回缓存/预渲染文档时禁止用注入补证覆盖，缺失与权限拒绝不能冒充活动文档",
    async () => {
      const h = harness();
      let probes = 0;
      h.api.scripting = {
        executeScript: async () => {
          probes++;
          return [{ documentId: h.owner.documentId, frameId: 0, result: true }];
        },
      };
      for (const state of ["cached", "prerender"]) {
        h.frames.get(h.owner.documentId).documentLifecycle = state;
        await rejects(h.authority.active(h.owner), "STALE_DOCUMENT");
      }
      assert.equal(0, probes);
      h.frames.delete(h.owner.documentId);
      h.api.scripting.executeScript = async () => [];
      await rejects(h.authority.active(h.owner), "STALE_DOCUMENT");
      h.api.scripting.executeScript = async () => {
        throw new Error("synthetic-denied");
      };
      await rejects(h.authority.active(h.owner), "STALE_DOCUMENT");
      h.api.scripting.executeScript = async () => [{
        documentId: h.owner.documentId,
        frameId: 9,
        result: true,
      }];
      await rejects(h.authority.active(h.owner), "STALE_DOCUMENT");
      h.api.scripting.executeScript = async () => [{
        documentId: h.owner.documentId,
        frameId: 0,
        result: false,
      }];
      await rejects(h.authority.active(h.owner), "STALE_DOCUMENT");
    },
  );
  should("组件绑定整套方案，跨方案注册失败且回退清除旧组件", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1, 2);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const component = await completeClaim(h, grant);
    assert.equal(2, component.planVersion);
    await rejects(h.authority.register(h.child, 2, 1), "RUNTIME_PLAN_MISMATCH");
    assert.equal(2, (await h.authority.component(h.child)).planVersion);
    await h.authority.register(h.owner, 2, 1);
    await rejects(h.authority.component(h.child), "UI_NOT_AUTHORIZED");
    assert.equal(
      1,
      (await h.authority.verify({ ...h.identity, runtimeEpoch: 2 }, h.owner)).planVersion,
    );
  });
  should("文档权限只能登记当前构建方案表，旧记录里的未允许方案也被拒绝", async () => {
    const h = harness();
    const compatible = new BrowserToolboxDocumentAuthority(h.api, Date.now, [{ planVersion: 1 }]);
    await rejects(compatible.register(h.owner, 1, 3), "PERMISSION_DENIED");
    await rejects(h.authority.register(h.owner, 1, 4), "PERMISSION_DENIED");
    await h.authority.register(h.owner, 1, 3);
    const oldBuild = new BrowserToolboxDocumentAuthority(h.api, Date.now, [{ planVersion: 1 }]);
    await rejects(oldBuild.verify(h.identity, h.owner), "RUNTIME_PLAN_MISMATCH");
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    assert.equal(3, (await completeClaim(h, grant)).planVersion);
  });
  should("未来格式变更使已缓存授权失效，不能继续使用旧缓存或覆盖未知格式", async () => {
    const h = harness();
    const listeners = [];
    h.api.storage.onChanged = { addListener: (listener) => listeners.push(listener) };
    const authority = new BrowserToolboxDocumentAuthority(h.api);
    await authority.register(h.owner, 1);
    assert.equal("content", (await authority.verify(h.identity, h.owner)).role);
    const key = "browserToolboxRuntimeDocuments";
    h.values[key].formatVersion = 2;
    for (const listener of listeners) {
      listener({ [key]: { newValue: structuredClone(h.values[key]) } }, "session");
    }
    await rejects(authority.verify(h.identity, h.owner), "DOCUMENT_AUTHORITY_UNAVAILABLE");
    await rejects(authority.register(h.owner, 2), "DOCUMENT_AUTHORITY_UNAVAILABLE");
    assert.equal(2, h.values[key].formatVersion);
  });
  should("自身写入在途触发session变更事件时不清空缓存，外部修改仍使缓存失效", async () => {
    const h = harness();
    const listeners = [];
    let reads = 0;
    const rawGet = h.api.storage.session.get;
    const rawSet = h.api.storage.session.set;
    h.api.storage.onChanged = { addListener: (listener) => listeners.push(listener) };
    h.api.storage.session.get = async (key) => {
      reads++;
      return rawGet(key);
    };
    let authority;
    h.api.storage.session.set = async (items) => {
      await rawSet(items);
      for (const listener of listeners) {
        const key = "browserToolboxRuntimeDocuments";
        listener({ [key]: { newValue: structuredClone(h.values[key]) } }, "session");
      }
      // 模拟 set 尚未返回、onChanged 已先到达时并发读取文档身份。
      await authority.records();
    };
    authority = new BrowserToolboxDocumentAuthority(h.api);
    await authority.register(h.owner, 1);
    assert.equal(1, reads);
    const grant = await authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    await completeClaim({ ...h, authority }, grant);
    await authority.verify(h.identity, h.owner);
    // 自身连续写入在 set 返回前触发 onChanged 时不应反复清空缓存重读 session。
    assert.equal(1, reads);

    // 外部记录变更仍必须清空缓存并重新读取。
    const key = "browserToolboxRuntimeDocuments";
    h.values[key] = { formatVersion: 1, documents: [] };
    for (const listener of listeners) {
      listener({ [key]: { newValue: structuredClone(h.values[key]) } }, "session");
    }
    await rejects(authority.verify(h.identity, h.owner), "STALE_RUNTIME");
    assert.equal(2, reads);
  });
  should("方案 4 和 5 只有显式编译的方案表可用，组件不能注册为其他方案", async () => {
    for (const plan of [4, 5]) {
      const h = harness();
      h.authority = new BrowserToolboxDocumentAuthority(
        h.api,
        Date.now,
        [1, 2, 3, 4, 5].map((planVersion) => ({ planVersion })),
      );
      await h.authority.register(h.owner, 1, plan);
      const grant = await h.authority.authorize(
        "vomnibar",
        crypto.randomUUID(),
        h.identity,
        h.owner,
      );
      assert.equal(plan, (await completeClaim(h, grant)).planVersion);
      await rejects(h.authority.register(h.child, 1, 3), "RUNTIME_PLAN_MISMATCH");
      const oldBuild = new BrowserToolboxDocumentAuthority(h.api, Date.now, [{ planVersion: 1 }]);
      await rejects(oldBuild.verify(h.identity, h.owner), "RUNTIME_PLAN_MISMATCH");
    }
  });
  should("单次授权绑定 native 父/子文档，重放失败且秘密不进入 session", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    assert.isFalse(JSON.stringify(h.values).includes(grant.secret));
    const session = await completeClaim(h, grant);
    assert.equal(h.owner.documentId, session.ownerDocumentId);
    await rejects(h.authority.claim(grant, h.child), "INVALID_UI_GRANT");
    assert.equal(
      "vomnibar",
      (await new BrowserToolboxDocumentAuthority(h.api).component(h.child)).component,
    );
  });
  should("公开 iframe 不能自行注册/执行，错误父文档/标签/无痕不能盗用授权", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    await rejects(h.authority.register(h.child, 1), "UI_NOT_AUTHORIZED");
    await rejects(h.authority.component(h.child), "UI_NOT_AUTHORIZED");
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    await rejects(
      h.authority.claim(grant, { ...h.child, tab: { id: 8, incognito: false } }),
      "PERMISSION_DENIED",
    );
    await rejects(
      h.authority.claim(grant, { ...h.child, tab: { id: 7, incognito: true } }),
      "PERMISSION_DENIED",
    );
    h.frames.get(h.child.documentId).parentDocumentId = "different-parent";
    await rejects(h.authority.claim(grant, h.child), "INVALID_UI_OWNER");
    assert.isTrue(h.authority.grants.has(grant.grantId));
  });
  should("所有者换代、缓存状态和过期授权立即失效，不能跨文档沿用身份", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    await completeClaim(h, grant);
    await h.authority.register(h.owner, 2);
    await rejects(h.authority.component(h.child), "UI_NOT_AUTHORIZED");
    await rejects(h.authority.verify(h.identity, h.owner), "STALE_RUNTIME");
    await rejects(h.authority.register(h.owner, 1), "STALE_RUNTIME");
    h.frames.get(h.owner.documentId).documentLifecycle = "cached";
    await rejects(
      h.authority.verify({ ...h.identity, runtimeEpoch: 2 }, h.owner),
      "STALE_DOCUMENT",
    );
    await rejects(
      h.authority.verify({ ...h.identity, documentId: "forged" }, h.owner),
      "PERMISSION_DENIED",
    );
  });
  should("后台重启丢弃未使用授权，持久文档身份不能提供授权秘密", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const restarted = new BrowserToolboxDocumentAuthority(h.api);
    await rejects(restarted.claim(grant, h.child), "INVALID_UI_GRANT");
    assert.isFalse(JSON.stringify(h.values).includes("https://"));
  });
  should("未被 webNavigation 枚举的扩展 iframe 必须匹配 Runtime 的活动身份", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    h.frames.delete(h.child.documentId);
    let active = true;
    h.api.runtime.getContexts = async () =>
      active
        ? [{
          documentId: h.child.documentId,
          tabId: 7,
          frameId: 2,
          incognito: false,
          documentUrl: h.child.url,
        }]
        : [];
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const session = await completeClaim(h, grant);
    assert.equal(h.child.documentId, session.documentId);
    active = false;
    await rejects(h.authority.component(h.child), "STALE_DOCUMENT");
  });
  should("spanning无痕组件必须由原生documentId路由补证，失效文档和错配回应仍拒绝", async () => {
    const h = harness();
    h.owner.tab.incognito = h.child.tab.incognito = h.identity.incognito = true;
    h.frames.delete(h.child.documentId);
    h.api.runtime.getContexts = async () => [];
    let current = true, probes = 0, override = {};
    h.api.tabs = {
      sendMessage: async (tabId, message, options) => {
        probes++;
        assert.equal(7, tabId);
        assert.equal({ documentId: h.child.documentId }, options);
        if (!current) throw new Error("无此活动文档");
        return {
          nonce: message.nonce,
          context: {
            documentId: h.child.documentId,
            tabId: 7,
            frameId: 2,
            incognito: true,
            documentUrl: h.child.url,
            ...override,
          },
        };
      },
    };
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const session = await completeClaim(h, grant);
    assert.isTrue(session.incognito);
    assert.equal(3, probes);
    assert.equal(h.child.documentId, (await h.authority.component(h.child)).documentId);
    for (
      override of [
        { documentId: "new-document-same-frame" },
        { tabId: 8 },
        { frameId: 3 },
        { incognito: false },
        { documentUrl: h.owner.url },
      ]
    ) await rejects(h.authority.component(h.child), "STALE_DOCUMENT");
    override = {};
    current = false;
    await rejects(h.authority.component(h.child), "STALE_DOCUMENT");
    current = true;
    h.frames.get(h.owner.documentId).documentLifecycle = "cached";
    await rejects(h.authority.component(h.child), "STALE_DOCUMENT");
  });
  should("定向探测不能覆盖原生非活动结果，也不能为内容页或普通组件降级校验", async () => {
    const h = harness();
    let probes = 0;
    h.api.runtime.getContexts = async () => [];
    h.api.tabs = {
      sendMessage: async () => {
        probes++;
        return {};
      },
    };
    h.frames.delete(h.child.documentId);
    await rejects(h.authority.active(h.child), "STALE_DOCUMENT");
    h.frames.delete(h.owner.documentId);
    await rejects(
      h.authority.active({ ...h.owner, tab: { id: 7, incognito: true } }),
      "STALE_DOCUMENT",
    );
    for (const documentLifecycle of ["cached", "prerender"]) {
      h.frames.set(h.child.documentId, { documentId: h.child.documentId, documentLifecycle });
      await rejects(
        h.authority.active({ ...h.child, tab: { id: 7, incognito: true } }),
        "STALE_DOCUMENT",
      );
    }
    assert.equal(0, probes);
    h.frames.delete(h.child.documentId);
    h.api.tabs.sendMessage = async () => ({
      nonce: "stale-response",
      context: {
        documentId: h.child.documentId,
        tabId: 7,
        frameId: 2,
        incognito: true,
        documentUrl: h.child.url,
      },
    });
    await rejects(
      h.authority.active({ ...h.child, tab: { id: 7, incognito: true } }),
      "STALE_DOCUMENT",
    );
  });
  should("组件注销和 frame 导航不会累积旧所有者记录，也不能删除其他组件", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    await completeClaim(h, grant);
    await h.authority.release("unrelated", h.identity, h.owner);
    assert.equal(2, (await h.authority.records()).length);
    await h.authority.release(grant.componentId, h.identity, h.owner);
    assert.equal(1, (await h.authority.records()).length);
    const next = { ...h.owner, documentId: "navigated-document" };
    h.frames.set(next.documentId, { documentId: next.documentId, documentLifecycle: "active" });
    await h.authority.register(next, 1);
    assert.equal([next.documentId], (await h.authority.records()).map((item) => item.documentId));
    await h.authority.unregister(h.identity, h.owner);
    assert.equal(1, (await h.authority.records()).length);
  });
  should("组件在握手前释放后，一次性授权立即失效且不能删除其他组件授权", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const first = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const second = await h.authority.authorize("hud", crypto.randomUUID(), h.identity, h.owner);
    await h.authority.release(first.componentId, h.identity, h.owner);
    assert.isFalse(h.authority.grants.has(first.grantId));
    assert.isTrue(h.authority.grants.has(second.grantId));
    await rejects(h.authority.claim(first, h.child), "INVALID_UI_GRANT");
  });
  should("知道授权字符串仍不能越过父内容脚本的 native 证明，同源其他文档不能代为证明", async () => {
    const h = harness();
    await h.authority.register(h.owner, 1);
    const grant = await h.authority.authorize("vomnibar", crypto.randomUUID(), h.identity, h.owner);
    const proof = await h.authority.claim(grant, h.child);
    await rejects(h.authority.finalize(proof, h.child), "INVALID_UI_GRANT");
    const other = { ...h.owner, documentId: "other-same-origin-parent", frameId: 3 };
    h.frames.set(other.documentId, { documentId: other.documentId, documentLifecycle: "active" });
    await h.authority.register(other, 1);
    await rejects(
      h.authority.attest(proof, { ...h.identity, documentId: other.documentId }, other),
      "INVALID_UI_OWNER",
    );
    await h.authority.attest(proof, h.identity, h.owner);
    const session = await h.authority.finalize(proof, h.child);
    assert.equal(h.owner.documentId, session.ownerDocumentId);
    await rejects(h.authority.finalize(proof, h.child), "INVALID_UI_GRANT");
  });
});
