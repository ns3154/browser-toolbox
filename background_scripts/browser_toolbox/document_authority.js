// SPDX-License-Identifier: GPL-3.0-or-later
// 浏览器文档身份决定角色；组件授权秘密只留在后台内存，公开扩展 iframe 不能从 session 窃取。
(function () {
  const KEY = "browserToolboxRuntimeDocuments";
  const COMPONENTS = Object.freeze({
    hud: "pages/hud_page.html",
    vomnibar: "pages/vomnibar_page.html",
    help: "pages/help_dialog_page.html",
  });
  const OWNED_PAGES = [
    "pages/options.html",
    "pages/mouse_options.html",
    "pages/action.html",
    "pages/command_center.html",
    "pages/command_listing.html",
    "pages/doc_search_completion.html",
  ];
  const fail = (code) => Object.assign(new Error(code), { code });
  class DocumentAuthority {
    constructor(
      api,
      now = Date.now,
      plans = globalThis.BrowserToolboxRuntimePlans?.allowed || [{ planVersion: 1 }],
    ) {
      this.api = api;
      this.now = now;
      this.planVersions = new Set(plans.map((plan) => plan.planVersion));
      this.grants = new Map();
      this.queue = Promise.resolve();
      this.cachedDocuments = null;
      this.loadingRecords = null;
      this.writingDocuments = null;
      api.storage.onChanged?.addListener?.((changes, area) => {
        if (area !== "session" || !changes[KEY]) return;
        const next = changes[KEY].newValue;
        if (next?.formatVersion !== 1 || !Array.isArray(next?.documents)) {
          this.cachedDocuments = null;
          this.writingDocuments = null;
          return;
        }
        // 自身 mutate 在 set 返回前收到同批 onChanged 时直接衔接新快照，避免高频组件授权反复清空内存缓存；外部改写仍立即失效。
        const serialized = JSON.stringify(next.documents);
        if (this.writingDocuments && serialized === JSON.stringify(this.writingDocuments)) {
          this.cachedDocuments = this.writingDocuments;
          return;
        }
        if (serialized !== JSON.stringify(this.cachedDocuments)) {
          this.cachedDocuments = null;
          this.writingDocuments = null;
        }
      });
    }
    role(sender) {
      if (sender?.id !== this.api.runtime.id) return "untrusted";
      const base = sender.url?.split(/[?#]/)[0];
      if (Object.values(COMPONENTS).some((page) => base === this.api.runtime.getURL(page))) {
        return "component";
      }
      if (
        OWNED_PAGES.some((page) => base === this.api.runtime.getURL(page)) &&
        (sender.frameId == null || sender.frameId === 0)
      ) return "ownedUi";
      if (sender.tab && /^(https?|file):|^about:(blank|srcdoc)$/.test(sender.url || "")) {
        return "content";
      }
      return "untrusted";
    }
    async contentFrames(tabId) {
      if (!this.api.scripting?.executeScript) return [];
      try {
        // BFCache 后 webNavigation 可能遗漏子文档；只使用原生注入结果里的身份，不读取页面内容。
        const results = await this.api.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "ISOLATED",
          func: () => !document.prerendering && /^(https?|file|about):$/.test(location.protocol),
        });
        return results.filter((item) =>
          item.result === true &&
          typeof item.documentId === "string" && Number.isInteger(item.frameId)
        ).map(({ documentId, frameId }) => ({ documentId, frameId, documentLifecycle: "active" }));
      } catch (_) {
        return [];
      }
    }
    async frames(tabId, { probe = false } = {}) {
      const frames = await this.api.webNavigation.getAllFrames({ tabId }) || [];
      const current = new Map(frames.map((frame) => [frame.frameId, frame]));
      const missing = (await this.records()).some((record) =>
        record.tabId === tabId && !record.component && !current.has(record.frameId)
      );
      if (probe || missing) {
        for (const frame of await this.contentFrames(tabId)) current.set(frame.frameId, frame);
      }
      return [...current.values()];
    }
    async frameIds(tabId) {
      return (await this.frames(tabId)).map((frame) => frame.frameId);
    }
    async active(sender) {
      if (!sender.tab || typeof sender.documentId !== "string") {
        throw fail("DOCUMENT_ID_UNAVAILABLE");
      }
      if (
        this.role(sender) === "component" &&
        sender.tab.incognito !== true &&
        this.api.runtime.getContexts
      ) {
        // webNavigation 不枚举扩展 UI iframe；非无痕组件优先查 Runtime 上下文，避免无效 getFrame IPC。
        const contexts = await this.api.runtime.getContexts({ documentIds: [sender.documentId] });
        const context = contexts.find((item) =>
          item.documentId === sender.documentId && item.tabId === sender.tab.id &&
          (sender.frameId == null || item.frameId === sender.frameId) &&
          item.incognito === (sender.tab.incognito === true) &&
          item.documentUrl?.startsWith(this.api.runtime.getURL(""))
        );
        if (context) {
          return {
            documentId: context.documentId,
            documentLifecycle: "active",
            extensionContext: true,
          };
        }
      }
      let current = await this.api.webNavigation.getFrame({
        tabId: sender.tab.id,
        documentId: sender.documentId,
      });
      if (!current && this.api.runtime.getContexts) {
        // webNavigation 不枚举扩展 UI iframe；Runtime 的活动上下文提供同一浏览器文档/标签/frame 身份。
        const contexts = await this.api.runtime.getContexts({ documentIds: [sender.documentId] });
        const context = contexts.find((item) =>
          item.documentId === sender.documentId && item.tabId === sender.tab.id &&
          (sender.frameId == null || item.frameId === sender.frameId) &&
          (sender.tab.incognito == null || item.incognito === (sender.tab.incognito === true)) &&
          item.documentUrl?.startsWith(this.api.runtime.getURL(""))
        );
        if (context) {
          return {
            documentId: context.documentId,
            documentLifecycle: "active",
            extensionContext: true,
          };
        }
      }
      if (
        !current && sender.tab.incognito === true && this.role(sender) === "component" &&
        this.api.tabs?.sendMessage
      ) {
        // spanning后台看不到无痕扩展上下文；按原生documentId定向探测，不能由同frame的新文档代答。
        const nonce = crypto.randomUUID();
        let timer;
        try {
          const response = await Promise.race([
            this.api.tabs.sendMessage(sender.tab.id, {
              name: "BrowserToolboxProbeUiDocument",
              nonce,
              documentId: sender.documentId,
              frameId: sender.frameId,
              tabId: sender.tab.id,
            }, { documentId: sender.documentId }),
            new Promise((resolve) => timer = setTimeout(() => resolve(null), 2500)),
          ]);
          const context = response?.context;
          if (
            response?.nonce === nonce && context?.documentId === sender.documentId &&
            context.tabId === sender.tab.id && context.frameId === sender.frameId &&
            context.incognito === true && context.documentUrl === sender.url?.split(/[?#]/)[0]
          ) {
            return {
              documentId: context.documentId,
              documentLifecycle: "active",
              extensionContext: true,
            };
          }
        } catch (_) {
          /* 文档退出、重载或拒绝回应都不能作为存活证据。 */
        } finally {
          clearTimeout(timer);
        }
      }
      if (!current) {
        current = (await this.contentFrames(sender.tab.id)).find((frame) =>
          frame.documentId === sender.documentId &&
          (sender.frameId == null || frame.frameId === sender.frameId)
        );
      }
      if (
        !current || current.documentId !== sender.documentId ||
        current.documentLifecycle && current.documentLifecycle !== "active"
      ) throw fail("STALE_DOCUMENT");
      return current;
    }
    async records() {
      if (this.cachedDocuments) return this.cachedDocuments;
      if (!this.loadingRecords) {
        this.loadingRecords = this.api.storage.session.get(KEY).then((items) => {
          const value = items[KEY];
          if (value && (value.formatVersion !== 1 || !Array.isArray(value.documents))) {
            throw fail("DOCUMENT_AUTHORITY_UNAVAILABLE");
          }
          this.cachedDocuments = value?.documents || [];
          return this.cachedDocuments;
        }).finally(() => this.loadingRecords = null);
      }
      return this.loadingRecords;
    }
    mutate(action) {
      const result = this.queue.then(async () => {
        const previous = await this.records();
        const documents = structuredClone(previous);
        const value = await action(documents);
        // 重复登记与迟到清理仍执行原生校验；记录完全未变时不重复写入及广播 session。
        if (
          previous === this.cachedDocuments &&
          JSON.stringify(documents) === JSON.stringify(previous)
        ) return value;
        this.writingDocuments = documents;
        try {
          await this.api.storage.session.set({ [KEY]: { formatVersion: 1, documents } });
          if (this.writingDocuments === documents) this.cachedDocuments = documents;
        } finally {
          if (this.writingDocuments === documents) this.writingDocuments = null;
        }
        return value;
      });
      this.queue = result.catch(() => {});
      return result;
    }
    register(sender, runtimeEpoch, planVersion = 1) {
      return this.mutate(async (documents) => {
        const role = this.role(sender);
        if (
          !["content", "ownedUi", "component"].includes(role) ||
          !Number.isSafeInteger(runtimeEpoch) || runtimeEpoch < 1 ||
          !this.planVersions.has(planVersion)
        ) throw fail("PERMISSION_DENIED");
        await this.active(sender);
        // frame 导航后旧文档不再拥有执行权；缓存恢复要重新注册，不能累积已失效组件记录。
        const obsolete = documents.filter((item) =>
          item.tabId === sender.tab.id && item.frameId === sender.frameId &&
          item.documentId !== sender.documentId
        ).map((item) => item.documentId);
        for (let index = documents.length - 1; index >= 0; index--) {
          if (
            obsolete.includes(documents[index].documentId) ||
            obsolete.includes(documents[index].ownerDocumentId)
          ) documents.splice(index, 1);
        }
        let record = documents.find((item) =>
          item.documentId === sender.documentId && item.tabId === sender.tab.id
        );
        if (role === "component") {
          if (!record?.component) throw fail("UI_NOT_AUTHORIZED");
          await this.validateOwner(record);
          if ((record.planVersion || 1) !== planVersion) throw fail("RUNTIME_PLAN_MISMATCH");
        }
        if (
          record && (record.runtimeEpoch > runtimeEpoch ||
            (record.planVersion || 1) !== planVersion && record.runtimeEpoch === runtimeEpoch)
        ) {
          throw fail("STALE_RUNTIME");
        }
        if (!record) {
          if (documents.length >= 2048) throw fail("DOCUMENT_AUTHORITY_FULL");
          record = {
            documentId: sender.documentId,
            tabId: sender.tab.id,
            frameId: sender.frameId,
            incognito: sender.tab.incognito === true,
            role,
          };
          documents.push(record);
        }
        if (record.runtimeEpoch !== runtimeEpoch) {
          for (let index = documents.length - 1; index >= 0; index--) {
            if (documents[index].ownerDocumentId === record.documentId) documents.splice(index, 1);
          }
        }
        record.runtimeEpoch = runtimeEpoch;
        record.planVersion = planVersion;
        return structuredClone(record);
      });
    }
    async validateOwner(record) {
      const documents = await this.records();
      const owner = documents.find((item) =>
        item.documentId === record.ownerDocumentId && item.tabId === record.tabId
      );
      if (
        !owner || owner.runtimeEpoch !== record.ownerEpoch ||
        owner.incognito !== record.incognito ||
        (record.planVersion != null && owner.planVersion !== record.planVersion)
      ) throw fail("STALE_UI_OWNER");
      await this.active({ tab: { id: owner.tabId }, documentId: owner.documentId });
      return owner;
    }
    async verify(identity, sender) {
      if (
        this.role(sender) === "untrusted" || !identity ||
        identity.documentId !== sender.documentId ||
        identity.incognito !== (sender.tab?.incognito === true)
      ) throw fail("PERMISSION_DENIED");
      await this.active(sender);
      const record = (await this.records()).find((item) =>
        item.documentId === sender.documentId && item.tabId === sender.tab.id
      );
      if (!record || record.runtimeEpoch !== identity.runtimeEpoch) throw fail("STALE_RUNTIME");
      if (!this.planVersions.has(record.planVersion || 1)) throw fail("RUNTIME_PLAN_MISMATCH");
      if (record.component) await this.validateOwner(record);
      return record;
    }
    async authorize(component, componentId, identity, sender) {
      const owner = await this.verify(identity, sender);
      if (
        owner.component || !Object.hasOwn(COMPONENTS, component) ||
        typeof componentId !== "string" || !/^[a-f0-9-]{36}$/.test(componentId)
      ) throw fail("PERMISSION_DENIED");
      for (const [key, grant] of this.grants) {
        if (grant.expires < this.now()) this.grants.delete(key);
      }
      if (this.grants.size >= 256) throw fail("UI_AUTHORITY_FULL");
      const grantId = crypto.randomUUID();
      const secret = crypto.randomUUID();
      const grant = {
        grantId,
        secret,
        component,
        componentId,
        owner,
        ownerOrigin: sender.origin ?? new URL(sender.url).origin,
        expires: this.now() + 10000,
      };
      this.grants.set(grantId, grant);
      return { grantId, secret, component, componentId, ownerOrigin: grant.ownerOrigin };
    }
    claim(input, sender) {
      const action = async () => {
        const grant = this.grants.get(input?.grantId);
        if (
          !grant || grant.expires < this.now() || grant.pendingChild ||
          grant.secret !== input.secret || grant.componentId !== input.componentId ||
          this.role(sender) !== "component"
        ) throw fail("INVALID_UI_GRANT");
        if (
          sender.url?.split(/[?#]/)[0] !== this.api.runtime.getURL(COMPONENTS[grant.component]) ||
          sender.tab?.id !== grant.owner.tabId ||
          (sender.tab.incognito === true) !== grant.owner.incognito
        ) throw fail("PERMISSION_DENIED");
        const frame = await this.active(sender);
        if (!frame.extensionContext && frame.parentDocumentId !== grant.owner.documentId) {
          throw fail("INVALID_UI_OWNER");
        }
        await this.validateOwner({
          ownerDocumentId: grant.owner.documentId,
          ownerEpoch: grant.owner.runtimeEpoch,
          incognito: grant.owner.incognito,
          tabId: grant.owner.tabId,
        });
        // Runtime 不提供扩展 iframe 的父文档，先发挑战；只有持有创建时私有 port 的父内容脚本可以证明所属关系。
        grant.pendingChild = structuredClone({
          documentId: sender.documentId,
          frameId: sender.frameId,
          tab: { id: sender.tab.id, incognito: sender.tab.incognito === true },
          id: sender.id,
          url: sender.url,
        });
        grant.proofId = crypto.randomUUID();
        return {
          proofId: grant.proofId,
          grantId: grant.grantId,
          componentId: grant.componentId,
          ownerOrigin: grant.ownerOrigin,
        };
      };
      const result = this.queue.then(action);
      this.queue = result.catch(() => {});
      return result;
    }
    async attest(input, identity, sender) {
      const owner = await this.verify(identity, sender);
      const grant = this.grants.get(input?.grantId);
      if (
        !grant || grant.expires < this.now() || grant.proofId !== input.proofId ||
        grant.componentId !== input.componentId || !grant.pendingChild
      ) throw fail("INVALID_UI_GRANT");
      if (
        owner.component || owner.documentId !== grant.owner.documentId ||
        owner.tabId !== grant.owner.tabId || owner.runtimeEpoch !== grant.owner.runtimeEpoch ||
        owner.incognito !== grant.owner.incognito
      ) throw fail("INVALID_UI_OWNER");
      await this.active(grant.pendingChild);
      grant.attested = true;
    }
    finalize(input, sender) {
      return this.mutate(async (documents) => {
        const grant = this.grants.get(input?.grantId);
        if (
          !grant || grant.expires < this.now() || !grant.attested ||
          grant.proofId !== input.proofId ||
          grant.componentId !== input.componentId || this.role(sender) !== "component"
        ) throw fail("INVALID_UI_GRANT");
        if (
          grant.pendingChild.documentId !== sender.documentId ||
          sender.url?.split(/[?#]/)[0] !== this.api.runtime.getURL(COMPONENTS[grant.component]) ||
          sender.tab?.id !== grant.owner.tabId ||
          (sender.tab.incognito === true) !== grant.owner.incognito
        ) throw fail("PERMISSION_DENIED");
        const frame = await this.active(sender);
        if (!frame.extensionContext && frame.parentDocumentId !== grant.owner.documentId) {
          throw fail("INVALID_UI_OWNER");
        }
        const owner = documents.find((item) =>
          item.documentId === grant.owner.documentId && item.tabId === grant.owner.tabId
        );
        if (!owner || owner.runtimeEpoch !== grant.owner.runtimeEpoch) throw fail("STALE_UI_OWNER");
        await this.active({ tab: { id: owner.tabId }, documentId: owner.documentId });
        this.grants.delete(grant.grantId);
        const previous = documents.findIndex((item) =>
          item.documentId === sender.documentId && item.tabId === sender.tab.id
        );
        if (previous !== -1) throw fail("DUPLICATE_UI_GRANT");
        const record = {
          role: "component",
          component: grant.component,
          componentId: grant.componentId,
          documentId: sender.documentId,
          tabId: sender.tab.id,
          frameId: sender.frameId,
          runtimeEpoch: 1,
          planVersion: owner.planVersion || 1,
          incognito: owner.incognito,
          ownerDocumentId: owner.documentId,
          ownerFrameId: owner.frameId,
          ownerEpoch: owner.runtimeEpoch,
        };
        if (documents.length >= 2048) throw fail("DOCUMENT_AUTHORITY_FULL");
        documents.push(record);
        return { ...structuredClone(record), ownerOrigin: grant.ownerOrigin };
      });
    }
    async component(sender) {
      const record = (await this.records()).find((item) =>
        item.documentId === sender.documentId && item.tabId === sender.tab?.id && item.component
      );
      if (!record) throw fail("UI_NOT_AUTHORIZED");
      await Promise.all([this.active(sender), this.validateOwner(record)]);
      return record;
    }
    async target(tabId, frameId) {
      let frame = await this.api.webNavigation.getFrame({ tabId, frameId });
      if (!frame && this.api.runtime.getContexts) {
        const contexts = await this.api.runtime.getContexts({ tabIds: [tabId] });
        frame = contexts.find((item) =>
          item.frameId === frameId && item.tabId === tabId && item.documentId
        );
      }
      if (!frame) {
        frame = (await this.contentFrames(tabId)).find((item) => item.frameId === frameId);
      }
      if (!frame?.documentId || frame.documentLifecycle && frame.documentLifecycle !== "active") {
        throw fail("STALE_DOCUMENT");
      }
      const record = (await this.records()).find((item) =>
        item.documentId === frame.documentId && item.tabId === tabId
      );
      if (!record) throw fail("REFRESH_REQUIRED");
      if (!this.planVersions.has(record.planVersion || 1)) throw fail("RUNTIME_PLAN_MISMATCH");
      if (record.component) await this.validateOwner(record);
      return {
        documentId: record.documentId,
        runtimeEpoch: record.runtimeEpoch,
        planVersion: record.planVersion || 1,
        incognito: record.incognito,
      };
    }
    async compatible(sender) {
      if (this.role(sender) === "untrusted") throw fail("PERMISSION_DENIED");
      await this.active(sender);
      const existing = (await this.records()).find((item) =>
        item.documentId === sender.documentId && item.tabId === sender.tab.id
      );
      return existing
        ? this.verify({
          documentId: existing.documentId,
          runtimeEpoch: existing.runtimeEpoch,
          incognito: existing.incognito,
        }, sender)
        : this.register(
          sender,
          1,
          globalThis.BrowserToolboxRuntimePlans
            ? (await BrowserToolboxRuntimePlans.select(this.api)).planVersion
            : 1,
        );
    }
    async release(componentId, identity, sender) {
      const owner = await this.verify(identity, sender);
      if (owner.component) throw fail("PERMISSION_DENIED");
      return this.mutate((documents) => {
        // 组件可能在 claim/finalize 之前退出；撤销尚未消费的授权，避免迟到握手复活。
        for (const [id, grant] of this.grants) {
          if (grant.componentId === componentId && grant.owner.documentId === owner.documentId &&
            grant.owner.tabId === owner.tabId && grant.owner.runtimeEpoch === owner.runtimeEpoch &&
            grant.owner.incognito === owner.incognito) this.grants.delete(id);
        }
        for (let index = documents.length - 1; index >= 0; index--) {
          const item = documents[index];
          if (
            item.componentId === componentId && item.ownerDocumentId === owner.documentId &&
            item.ownerEpoch === owner.runtimeEpoch
          ) documents.splice(index, 1);
        }
      });
    }
    unregister(identity, sender) {
      return this.mutate(async (documents) => {
        const record = documents.find((item) =>
          item.documentId === sender.documentId && item.tabId === sender.tab?.id
        );
        if (!record || record.runtimeEpoch !== identity?.runtimeEpoch) return;
        for (let index = documents.length - 1; index >= 0; index--) {
          if (
            documents[index].documentId === record.documentId ||
            documents[index].ownerDocumentId === record.documentId
          ) documents.splice(index, 1);
        }
      });
    }
    clearTab(tabId) {
      return this.mutate((documents) => {
        for (let index = documents.length - 1; index >= 0; index--) {
          if (documents[index].tabId === tabId) documents.splice(index, 1);
        }
      });
    }
  }
  globalThis.BrowserToolboxDocumentAuthority = DocumentAuthority;
  globalThis.BrowserToolboxUIComponents = COMPONENTS;
})();
