// SPDX-License-Identifier: GPL-3.0-or-later
// 框架列表中的原生文档身份固定在本次选择中，导航替换后的同 frameId 不能接收焦点。
export class FrameFocusService {
  constructor({ api, authority, allowsPlan }) {
    Object.assign(this, { api, authority, allowsPlan });
  }
  async focusOwner(identity, sender) {
    const owner = await this.authority.verify(identity, sender);
    if (owner.component || !this.allowsPlan(owner.planVersion)) {
      throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" });
    }
    return owner;
  }
  async captureFocus(frameId, identity, sender) {
    const owner = await this.focusOwner(identity, sender);
    if (!Number.isInteger(frameId) || frameId < 0) {
      throw Object.assign(new Error("INVALID_FRAME_ID"), { code: "INVALID_FRAME_ID" });
    }
    const target = await this.authority.target(sender.tab.id, frameId);
    if (target.planVersion !== owner.planVersion || target.incognito !== owner.incognito) {
      throw Object.assign(new Error("RUNTIME_PLAN_MISMATCH"), { code: "RUNTIME_PLAN_MISMATCH" });
    }
    await this.focusOwner(identity, sender);
    return { ...target, frameId, tabId: sender.tab.id };
  }
  async restoreFocus(target, identity, sender) {
    const owner = await this.focusOwner(identity, sender);
    if (
      !target || target.tabId !== sender.tab.id || !Number.isInteger(target.frameId) ||
      target.frameId < 0 || target.planVersion !== owner.planVersion ||
      target.incognito !== owner.incognito
    ) throw Object.assign(new Error("STALE_DOCUMENT"), { code: "STALE_DOCUMENT" });
    const current = await this.authority.target(sender.tab.id, target.frameId);
    if (
      ["documentId", "runtimeEpoch", "planVersion", "incognito"].some((key) =>
        current[key] !== target[key]
      )
    ) throw Object.assign(new Error("STALE_DOCUMENT"), { code: "STALE_DOCUMENT" });
    await this.focusOwner(identity, sender);
    // 再次导航仍只能投递到捕获的文档；同文档新代次由收件端在执行前拒绝。
    return this.send(sender.tab.id, target, { handler: "focusFrame", forceFocusThisFrame: true });
  }
  async next({ count = 1, tabId, executionGuard }, sender) {
    const source = await this.authority.compatible(sender);
    if (!this.allowsPlan(source.planVersion)) throw new Error("RUNTIME_PLAN_MISMATCH");
    const guard = async () => {
      await executionGuard?.();
      const current = await this.authority.compatible(sender);
      if (
        current.documentId !== source.documentId || current.runtimeEpoch !== source.runtimeEpoch ||
        current.planVersion !== source.planVersion || current.incognito !== source.incognito
      ) {
        throw new Error("STALE_DOCUMENT");
      }
    };
    await guard();
    const frames = await this.authority.frames(tabId);
    const responses = await Promise.all(frames.map(async (frame) => {
      try {
        const identity = await this.authority.target(tabId, frame.frameId);
        if (
          identity.documentId !== frame.documentId || identity.planVersion !== source.planVersion
        ) return null;
        const status = await this.send(tabId, identity, { handler: "getFocusStatus" });
        return status ? { frameId: frame.frameId, identity, status } : null;
      } catch (_) {
        return null;
      }
    }));
    await guard();
    const focused = responses.find((row) => row?.status.focused);
    if (!focused) return;
    const available = responses.filter((row) => row?.status.focusable);
    if (!available.length) return;
    const index = available.findIndex((row) => row.frameId === focused.frameId);
    const target = available[(index + (count ?? 1)) % available.length];
    if (!target || target.frameId === focused.frameId) return;
    const current = await this.authority.target(tabId, target.frameId);
    if (
      current.documentId !== target.identity.documentId ||
      current.runtimeEpoch !== target.identity.runtimeEpoch ||
      current.planVersion !== target.identity.planVersion ||
      current.incognito !== target.identity.incognito
    ) {
      throw new Error("STALE_DOCUMENT");
    }
    await guard();
    return this.send(tabId, target.identity, { handler: "focusFrame", highlight: true });
  }
  send(tabId, identity, message) {
    return this.api.tabs.sendMessage(
      tabId,
      BrowserToolboxMessageProtocol.envelope(
        "lifecycle",
        "relay",
        { message },
        identity,
      ),
      { documentId: identity.documentId },
    );
  }
}
globalThis.BrowserToolboxFrameFocusService = FrameFocusService;
