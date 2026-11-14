// SPDX-License-Identifier: GPL-3.0-or-later
// 仅由提示 Canary 注入；后台保留短期身份，不持久化页面文字或匹配输入。
(function () {
  const fail = (code) => Object.assign(new Error(code), { code });
  const same = (a, b) =>
    a?.documentId === b?.documentId && a?.runtimeEpoch === b?.runtimeEpoch &&
    a?.planVersion === b?.planVersion && a?.incognito === b?.incognito;
  class Coordinator {
    constructor(
      { frames, target, send, paused = () => false, allowsPlan = (version) => version === 5, now = Date.now, limit = 256, timeout = 3000 },
    ) {
      Object.assign(this, { frames, target, send, paused, allowsPlan, now, limit, timeout });
      this.sessions = new Map();
    }
    async check(session) {
      if (this.sessions.get(session.tabId) !== session || this.paused(session.tabId)) {
        throw fail("STALE_RUNTIME");
      }
      if (this.now() - session.started > 300000) throw fail("INTERACTION_EXPIRED");
      await Promise.all([...session.members].map(async ([frameId, identity]) => {
        if (!same(await this.target(session.tabId, frameId), identity)) {
          throw fail("STALE_DOCUMENT");
        }
      }));
      if (this.sessions.get(session.tabId) !== session || this.paused(session.tabId)) {
        throw fail("STALE_RUNTIME");
      }
    }
    async deliver(session, frameId, message) {
      const identity = session.members.get(frameId);
      if (!same(await this.target(session.tabId, frameId), identity)) throw fail("STALE_DOCUMENT");
      const reply = await this.send(session.tabId, frameId, {
        ...message,
        interactionId: session.id,
      }, identity);
      if (reply?.ok === false) throw fail(reply.code || "HINTS_UNAVAILABLE");
      return reply;
    }
    async cancelTab(tabId) {
      const session = this.sessions.get(tabId);
      if (!session) return;
      this.sessions.delete(tabId);
      clearTimeout(session.timer);
      session.cancel?.();
      await Promise.all(
        [...session.members.keys()].map((frameId) =>
          this.deliver(session, frameId, { messageType: "exit", isSuccess: false }).catch(() => {})
        ),
      );
    }
    releaseDocument(identity, sender) {
      const session = this.sessions.get(sender.tab?.id);
      const member = session?.members.get(sender.frameId);
      if (
        identity?.documentId === sender.documentId &&
        this.allowsPlan(member?.planVersion) &&
        same(member, { ...identity, planVersion: identity.planVersion ?? member.planVersion })
      ) return this.cancelTab(sender.tab.id);
    }
    async prepare(input, sender, authority) {
      const tabId = sender.tab.id;
      if (this.paused(tabId)) return { ok: false, code: "STALE_RUNTIME" };
      if (!this.allowsPlan(authority.planVersion)) return { ok: false, code: "RUNTIME_PLAN_MISMATCH" };
      await this.cancelTab(tabId);
      const session = {
        tabId,
        id: input.interactionId,
        owner: sender.frameId,
        started: this.now(),
        members: new Map(),
        queue: Promise.resolve(),
      };
      if (this.sessions.size >= this.limit) await this.cancelTab(this.sessions.keys().next().value);
      this.sessions.set(tabId, session);
      session.cancelled = new Promise((resolve) => session.cancel = resolve);
      try {
        const frames = await this.frames(tabId);
        if (!frames.includes(sender.frameId)) frames.push(sender.frameId);
        await Promise.all(frames.map(async (frameId) => {
          const identity = await this.target(tabId, frameId);
          if (identity.planVersion !== authority.planVersion || !this.allowsPlan(identity.planVersion)) {
            throw fail("RUNTIME_PLAN_MISMATCH");
          }
          session.members.set(frameId, identity);
        }));
        if (!same(session.members.get(sender.frameId), authority)) throw fail("STALE_RUNTIME");
        await this.check(session);
        const descriptors = {};
        const timer = new Promise((_, reject) => {
          session.timer = setTimeout(() => reject(fail("HINTS_TIMEOUT")), this.timeout);
        });
        await Promise.race([
          Promise.all([...session.members.keys()].map(async (frameId) => {
            const reply = await this.deliver(session, frameId, {
              messageType: "getHintDescriptors",
              modeIndex: input.modeIndex,
              originatingFrameId: sender.frameId,
              requestedByHelpDialog: input.requestedByHelpDialog === true,
            });
            if (
              !Array.isArray(reply) ||
              !reply.every((item, index) =>
                item.frameId === frameId && item.localIndex === index &&
                (item.linkText == null || typeof item.linkText === "string")
              )
            ) throw fail("INVALID_HINT_DESCRIPTORS");
            descriptors[frameId] = reply;
          })),
          timer,
          session.cancelled.then(() => {
            throw fail("STALE_RUNTIME");
          }),
        ]);
        clearTimeout(session.timer);
        session.timer = null;
        await this.check(session);
        const activation = Promise.all([...session.members.keys()].map((frameId) => {
          const outgoing = { ...descriptors };
          delete outgoing[frameId];
          return this.deliver(session, frameId, {
            messageType: "activateMode",
            modeIndex: input.modeIndex,
            frameId,
            originatingFrameId: sender.frameId,
            frameIdToHintDescriptors: outgoing,
          });
        }));
        session.queue = activation.then(() => {});
        await activation;
        if (this.sessions.get(tabId) === session) session.active = true;
        return { ok: true, code: "INTERACTION_OPENED" };
      } catch (error) {
        clearTimeout(session.timer);
        if (this.sessions.get(tabId) === session) await this.cancelTab(tabId);
        return { ok: false, code: error.code || "HINTS_UNAVAILABLE" };
      }
    }
    valid(input) {
      switch (input.messageType) {
        case "exit":
          return typeof input.isSuccess === "boolean";
        case "setOpenLinkMode":
          return Number.isInteger(input.modeIndex) && input.modeIndex >= 0 && input.modeIndex < 10;
        case "updateKeyState":
          return [input.hintKeystrokeQueue, input.linkTextKeystrokeQueue || []].every((queue) =>
            Array.isArray(queue) && queue.length <= 256 &&
            queue.every((key) => typeof key === "string" && key.length === 1)
          ) &&
            Number.isSafeInteger(input.tabCount) && Math.abs(input.tabCount) <= 1000000;
        case "rotateHints":
        case "activateActiveHintMarker":
        case "mouseOutOfLastClickedElement":
          return true;
        default:
          return false;
      }
    }
    async cancelAfterRestart(input, sender, authority) {
      const tabId = sender.tab.id;
      try {
        if (!this.allowsPlan(authority.planVersion) || this.paused(tabId) || !same(await this.target(tabId, sender.frameId), authority)) {
          throw fail("STALE_RUNTIME");
        }
        const frames = await this.frames(tabId);
        if (!frames.includes(sender.frameId)) frames.push(sender.frameId);
        const members = new Map();
        await Promise.all(frames.map(async (frameId) => {
          try {
            const identity = await this.target(tabId, frameId);
            if (identity.planVersion === authority.planVersion && this.allowsPlan(identity.planVersion)) members.set(frameId, identity);
          } catch (_) { /* 新建或已销毁的 frame 不接收旧会话取消。 */ }
        }));
        const session = { tabId, id: input.interactionId, members };
        await Promise.all(
          [...members.keys()].map((frameId) =>
            this.deliver(session, frameId, { messageType: "exit", isSuccess: false }).catch(
              () => {},
            )
          ),
        );
        return { ok: true, code: "INTERACTION_CANCELLED" };
      } catch (error) {
        return { ok: false, code: error.code || "HINTS_UNAVAILABLE" };
      }
    }
    broadcast(input, sender, authority) {
      const session = this.sessions.get(sender.tab.id);
      if (!this.valid(input)) return Promise.resolve({ ok: false, code: "INVALID_HINT_ACTION" });
      if (!session && input.messageType === "exit" && !input.isSuccess) {
        return this.cancelAfterRestart(input, sender, authority);
      }
      if (
        !session || session.id !== input.interactionId ||
        !same(session.members.get(sender.frameId), authority)
      ) {
        return Promise.resolve({ ok: false, code: "STALE_INTERACTION" });
      }
      const action = session.queue.then(async () => {
        try {
          await this.check(session);
          if (input.messageType === "exit") {
            if (input.isSuccess && !session.active) throw fail("STALE_INTERACTION");
            this.sessions.delete(session.tabId);
            clearTimeout(session.timer);
          } else if (!session.active) throw fail("STALE_INTERACTION");
          await Promise.all(
            [...session.members.keys()].map((frameId) =>
              this.deliver(session, frameId, { ...input, sourceFrameId: sender.frameId })
            ),
          );
          return { ok: true, code: "HINTS_DELIVERED" };
        } catch (error) {
          if (this.sessions.get(session.tabId) === session) await this.cancelTab(session.tabId);
          return { ok: false, code: error.code || "HINTS_UNAVAILABLE" };
        }
      });
      session.queue = action.then(() => {});
      return action;
    }
  }
  globalThis.BrowserToolboxHintsCoordinator = Object.freeze({ Coordinator });
})();
