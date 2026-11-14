// SPDX-License-Identifier: GPL-3.0-or-later
// 维护入口只允许设置页调用，不返回网页 URL、标题、配置或文档关联 ID。
(function () {
  class RuntimeMaintenance {
    constructor(
      api,
      {
        plans = null,
        clearTab = null,
        frames = null,
        onFinished = () => {},
        messageTimeoutMs = 2000,
      } = {},
    ) {
      this.api = api;
      this.plans = plans;
      this.clearTab = clearTab;
      this.frames = frames || ((tabId) => api.webNavigation.getAllFrames({ tabId }));
      this.onFinished = onFinished;
      this.messageTimeoutMs = messageTimeoutMs;
      this.queue = Promise.resolve();
    }

    isSettingsSender(sender) {
      return sender?.id === this.api.runtime.id &&
        typeof sender.url === "string" &&
        sender.url.split(/[?#]/)[0] === this.api.runtime.getURL("pages/mouse_options.html") &&
        (sender.frameId == null || sender.frameId === 0);
    }

    run(action, sender) {
      const work = this.queue.then(async () => {
        try {
          return await this.runAction(action, sender);
        } finally {
          this.onFinished();
        }
      });
      this.queue = work.catch(() => {});
      return work;
    }
    async runAction(action, sender) {
      if (!this.isSettingsSender(sender) || !["inspect", "restore"].includes(action)) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }
      const summary = {
        ok: true,
        engineName: "vimium-compat",
        planVersion: 1,
        activeFrames: 0,
        failedFrames: 0,
        refreshRequiredFrames: 0,
        pendingFrames: 0,
        unavailableTabs: 0,
      };
      const contentFrames = (frames) =>
        (frames || []).filter((frame) => !/^(chrome|moz)-extension:/.test(frame.url || ""));
      const blockedTabs = new Map();
      const tabs = await this.api.tabs.query({});
      const plan = this.plans
        ? await this.plans.select(this.api)
        : { planVersion: 1, keyboardEngine: "vimium-compat" };
      if (action === "inspect") {
        summary.engineName = plan.keyboardEngine;
        summary.planVersion = plan.planVersion;
      }
      if (action === "restore" && this.plans?.COMPILED_CANARY) {
        await this.plans.restore(this.api);
        // 同一标签的 frame 全部确认停用后才恢复；未确认的标签保持等待，不能和迟到清理交叠。
        await Promise.all(
          tabs.filter((tab) => /^(https?|file):/.test(tab.url || "")).map(async (tab) => {
            try {
              await this.clearTab?.(tab.id);
              const frames = contentFrames(await this.frames(tab.id));
              const failures = new Map();
              await Promise.all(frames.map(async (frame) => {
                try {
                  const result = await this.send(tab.id, "browserToolbox.pauseRuntime", frame);
                  if (result?.initializationState !== "disabled") {
                    failures.set(frame.frameId, "refreshRequiredFrames");
                  }
                } catch (error) {
                  failures.set(
                    frame.frameId,
                    error?.code === "MAINTENANCE_MESSAGE_TIMEOUT"
                      ? "pendingFrames"
                      : "refreshRequiredFrames",
                  );
                }
              }));
              if (failures.size) blockedTabs.set(tab.id, { failures });
            } catch (_) {
              blockedTabs.set(tab.id, { allRequireRefresh: true });
            }
          }),
        );
      }
      await Promise.all(tabs.map(async (tab) => {
        // 浏览器内部页本来就不可注入，不把它们当作需要刷新的旧网页。
        if (!/^(https?|file):/.test(tab.url || "")) {
          summary.unavailableTabs++;
          return;
        }
        let frames;
        try {
          frames = contentFrames(await this.frames(tab.id));
        } catch (_) {
          summary.refreshRequiredFrames++;
          return;
        }
        const blocked = blockedTabs.get(tab.id);
        if (blocked) {
          if (blocked.allRequireRefresh) {
            summary.refreshRequiredFrames += Math.max(frames.length, 1);
          } else if (!frames.length) summary.refreshRequiredFrames++;
          else {for (const frame of frames) {
              summary[blocked.failures.get(frame.frameId) || "pendingFrames"]++;
            }}
          return;
        }
        await Promise.all(frames.map(async (frame) => {
          try {
            const result = await this.send(
              tab.id,
              action === "restore"
                ? "browserToolbox.restoreCompatibleRuntime"
                : "browserToolbox.runtimeDiagnostics",
              frame,
            );
            if (
              result?.initializationState === "active" &&
              result?.planVersion === summary.planVersion
            ) {
              summary.activeFrames++;
            } else if (result?.initializationState === "failed") summary.failedFrames++;
            else summary.refreshRequiredFrames++;
          } catch (error) {
            if (action === "restore" && error?.code === "MAINTENANCE_MESSAGE_TIMEOUT") {
              summary.pendingFrames++;
            } else summary.refreshRequiredFrames++;
          }
        }));
      }));
      return summary;
    }
    async send(tabId, handler, frame) {
      let timer;
      try {
        return await Promise.race([
          this.api.tabs.sendMessage(
            tabId,
            { handler },
            frame.documentId ? { documentId: frame.documentId } : { frameId: frame.frameId },
          ),
          new Promise((_, reject) =>
            timer = setTimeout(() =>
              reject(
                Object.assign(new Error("TIMEOUT"), { code: "MAINTENANCE_MESSAGE_TIMEOUT" }),
              ), this.messageTimeoutMs)
          ),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  globalThis.BrowserToolboxRuntimeMaintenance = RuntimeMaintenance;
})();
