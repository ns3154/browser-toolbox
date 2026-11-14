// SPDX-License-Identifier: GPL-3.0-or-later
// 标记选择由独立控制器拥有；旧存储仅经适配器访问，后台动作只发送一次。
(function () {
  class Controller {
    constructor(resources, context, enabled, {
      page = globalThis,
      store = new BrowserToolboxMarksCompatStorage.PageStorage(page),
      send = (message) => chrome.runtime.sendMessage(message),
    } = {}) {
      Object.assign(this, { resources, context, enabled, page, store, send });
      this.epoch = BrowserToolboxRuntimeHostInstance.runtimeEpoch;
      this.generation = 0;
      resources.add(() => this.destroy());
    }
    valid() {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      return !this.closed && this.enabled() && host?.state === "active" &&
        !host.suspended && !host.maintenancePaused && host.runtimeEpoch === this.epoch &&
        host.context.documentId === this.context.documentId &&
        host.plan.moduleImplementations.marks === "browser-toolbox";
    }
    commands() {
      return {
        "Marks.activateCreateMode": (_count, request) => this.open("create", request.registryEntry),
        "Marks.activateGotoMode": (_count, request) => this.open("goto", request.registryEntry),
      };
    }
    capture() {
      return {
        scrollX: this.page.scrollX,
        scrollY: this.page.scrollY,
        hash: this.page.location.hash,
      };
    }
    remember() {
      if (this.valid()) this.store.remember(this.capture());
    }
    open(operation, entry = {}) {
      if (!this.valid()) return false;
      this.cancelInteractions();
      const generation = ++this.generation;
      const mode = this.mode = new Mode();
      // 无注册键时保持等待；Esc/失焦/销毁取消，按键配对由唯一 RuntimeHost 负责。
      mode.init({
        name: `${operation}-mark`,
        indicator: operation === "create" ? "Create mark..." : "Go to mark...",
        exitOnEscape: true,
        exitOnBlur: this.page,
        suppressAllKeyboardEvents: true,
        keydown: (event) => {
          if (!this.valid() || this.mode !== mode || generation !== this.generation) return;
          if (
            event.isComposing || event.keyCode === 229 || event.repeat ||
            ["Dead", "Process", "Unidentified"].includes(event.key) ||
            !KeyboardUtils.isPrintable(event)
          ) return;
          const name = KeyboardUtils.getKeyChar(event);
          const global = (entry.options?.swap ? !event.shiftKey : event.shiftKey) &&
            !BrowserToolboxMarksCompatStorage.previous.includes(name);
          // 先退出并释放 indicator，再执行；异步回包不能重新激活已取消的选择模式。
          this.mode = null;
          mode.exit();
          this.perform(operation, name, global, generation).catch(() => {
            if (this.valid() && generation === this.generation) {
              HUD.show(BrowserToolboxI18n.message("markUnavailable"), 1000);
            }
          });
        },
      });
      mode.onExit(() => {
        if (this.mode === mode) {
          this.mode = null;
          this.generation++;
        }
      });
      return true;
    }
    async perform(operation, name, global, generation) {
      if (!this.valid() || generation !== this.generation) return;
      if (global) {
        const identity = {
          documentId: this.context.documentId,
          runtimeEpoch: this.epoch,
          incognito: this.context.incognito === true,
        };
        const result = await this.send(BrowserToolboxMessageProtocol.envelope(
          "lifecycle",
          "marks",
          {
            operation,
            name,
            ...(operation === "create" && this.context.frameId === 0
              ? { position: this.capture() }
              : {}),
          },
          identity,
        ));
        if (!this.valid() || generation !== this.generation) return;
        if (!result?.ok) {
          HUD.show(
            result?.code === "MARK_NOT_SET"
              ? `Global mark not set '${name}'`
              : BrowserToolboxI18n.message("markUnavailable"),
            1000,
          );
          return;
        }
        HUD.show(
          operation === "create"
            ? `Created global mark "${name}".`
            : `Jumped to global mark '${name}'`,
          1000,
        );
      } else if (operation === "create") {
        this.store.write(name, this.capture());
        HUD.show(`Created local mark "${name}".`, 1000);
      } else {
        const value = this.store.read(name);
        if (!value) {
          HUD.show(`Local mark not set "${name}".`, 1000);
          return;
        }
        this.remember();
        if (value.hash && value.scrollX === 0 && value.scrollY === 0) {
          this.page.location.hash = value.hash;
        } else this.page.scrollTo(value.scrollX, value.scrollY);
        HUD.show(`Jumped to local mark "${name}".`, 1000);
      }
    }
    async restorePosition(value) {
      const epoch = this.epoch;
      await DomUtils.documentReady();
      if (
        !this.valid() || this.epoch !== epoch || this.context.frameId !== 0 ||
        !BrowserToolboxMarksCompatStorage.position(value)
      ) return false;
      this.page.focus();
      this.page.document.body?.focus();
      if (value.scrollX > 0 || value.scrollY > 0) {
        this.remember();
        this.page.scrollTo(value.scrollX, value.scrollY);
      }
      return true;
    }
    cancelInteractions() {
      this.generation++;
      const mode = this.mode;
      this.mode = null;
      mode?.exit();
    }
    destroy() {
      if (this.closed) return;
      this.closed = true;
      this.cancelInteractions();
    }
  }
  globalThis.BrowserToolboxMarksRuntime = Object.freeze({ Controller });
})();
