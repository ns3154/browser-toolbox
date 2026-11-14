// SPDX-License-Identifier: GPL-3.0-or-later
// 每次提示都是文档代次内的短会话；退出先释放模式，再执行一次选中动作。
(function () {
  const modeNames = [
    "curr-tab",
    "bg-tab",
    "fg-tab",
    "queue",
    "link",
    "incognito",
    "download",
    "copy-link-text",
    "hover",
    "focus",
  ];
  const indicators = [
    "Open link in current tab",
    "Open link in new tab",
    "Open link in new tab and switch to it",
    "Open multiple links in new tabs",
    "Copy link URL to Clipboard",
    "Open link in incognito window",
    "Download link URL",
    "Copy link text",
    "Hover link",
    "Focus link",
  ];
  const modes = modeNames.map((name, modeIndex) =>
    Object.freeze({ name, modeIndex, indicator: indicators[modeIndex] })
  );
  let Session;
  function sessionType() {
    return Session ||= class Session {
      constructor(controller, descriptors, modeIndex) {
        this.controller = controller;
        this.modeIndex = modeIndex;
        this.mode = modes[modeIndex];
        this.tabCount = 0;
        this.deactivating = false;
        this.hintMarkers = descriptors.map((hintDescriptor, index) => {
          const localHint = hintDescriptor.frameId === controller.frame()
            ? controller.localHints[hintDescriptor.localIndex]
            : null;
          const marker = {
            hintDescriptor,
            localHint,
            linkText: hintDescriptor.linkText,
            stableSortCount: index + 1,
            isLocalMarker() {
              return !!this.localHint;
            },
          };
          if (localHint) {
            marker.element = DomUtils.createElement("div");
            marker.element.className = "vimium-reset internal-vimium-hint-marker vimiumHintMarker";
            Object.assign(marker.element.style, {
              left: `${localHint.rect.left}px`,
              top: `${localHint.rect.top}px`,
            });
          }
          return marker;
        });
        this.markerMatcher = new BrowserToolboxHintsMatcher.Matcher(
          Settings.get("filterLinkHints"),
          Settings.get("linkHintCharacters"),
          Settings.get("linkHintNumbers"),
          (marker) => this.caption(marker),
        );
        this.markerMatcher.initialize(this.hintMarkers);
        this.inputMatcher = new BrowserToolboxHintsMatcher.Matcher(
          this.markerMatcher.filtered,
          Settings.get("linkHintCharacters"),
          Settings.get("linkHintNumbers"),
        );
        this.hintMode = new Mode();
        this.hintMode.init({
          name: `hint/${this.mode.name}`,
          singleton: "link-hints-mode",
          indicator: false,
          suppressAllKeyboardEvents: true,
          suppressTrailingKeyEvents: true,
          exitOnEscape: true,
          exitOnClick: true,
          keydown: (event) => this.key(event),
        });
        this.hintMode.onExit((event) => {
          if (!this.deactivating && event) controller.cancelInteractions();
        });
        this.renderHints();
        this.setIndicator();
      }
      caption(marker) {
        if (!marker.element) return;
        let text = marker.linkText || "";
        if (text.length > 35) text = text.slice(0, 33) + "...";
        const caption =
          (this.markerMatcher.filtered ? marker.hintString : marker.hintString.toUpperCase()) +
          (this.markerMatcher.filtered && marker.localHint.showLinkText ? ": " + text : "");
        marker.element.replaceChildren(...[...caption].map((character) => {
          const span = DomUtils.createElement("span");
          span.className = "vimium-reset";
          span.textContent = character;
          return span;
        }));
      }
      renderHints() {
        const container = this.containerEl = DomUtils.createElement("div");
        container.id = "vimium-hint-marker-container";
        container.className = "vimium-reset";
        document.documentElement.appendChild(container);
        for (const marker of this.hintMarkers) {
          if (marker.element) container.appendChild(marker.element);
        }
        if (container.showPopover) {
          container.popover = "manual";
          container.showPopover();
          Object.assign(container.style, {
            top: 0,
            left: 0,
            position: "absolute",
            display: "block",
            width: "100%",
            height: "100%",
            overflow: "visible",
          });
        }
      }
      setIndicator() {
        if (!windowIsFocused()) return;
        const text = this.markerMatcher.linkTextKeystrokeQueue.join("");
        this.hintMode.setIndicator(this.mode.indicator + (text ? `: "${text}"` : "") + ".");
      }
      setOpenLinkMode(mode, propagate = true) {
        this.modeIndex = mode.modeIndex;
        this.mode = mode;
        if (propagate) this.controller.send("setOpenLinkMode", { modeIndex: this.modeIndex });
        else this.setIndicator();
      }
      key(event) {
        if (event.repeat) return handlerStack.suppressEvent;
        if (
          !this.markerMatcher.filtered && ["Control", "Shift"].includes(event.key) &&
          this.modeIndex < 4
        ) {
          const previous = this.mode;
          const index = event.key === "Shift"
            ? this.modeIndex === 0 ? 1 : 0
            : this.modeIndex === 2
            ? 1
            : 2;
          this.setOpenLinkMode(modes[index]);
          const key = event.key;
          this.hintMode.push({
            keyup: (release) => {
              if (release.key === key) {
                handlerStack.remove();
                this.setOpenLinkMode(previous);
              }
              return true;
            },
          });
        } else if (KeyboardUtils.isBackspace(event)) {
          if (!this.inputMatcher.popKeyChar()) this.hintMode.exit(event);
          else {
            this.tabCount = 0;
            this.sync();
          }
        } else if (event.key === "Enter") {
          if (this.markerMatcher.activeHintMarker) this.controller.send("activateActiveHintMarker");
        } else if (event.key === "Tab") {
          this.tabCount += event.shiftKey ? -1 : 1;
          this.sync();
        } else if (event.key === " " && this.markerMatcher.shouldRotateHints(event)) {
          this.controller.send("rotateHints");
        } else {
          let character = KeyboardUtils.getKeyChar(event);
          if (!this.markerMatcher.filtered) character = character?.toLowerCase();
          if (character === "space") character = " ";
          if (character?.length === 1) {
            this.tabCount = 0;
            this.inputMatcher.pushKeyChar(character);
            this.sync();
          } else if (character) return handlerStack.suppressPropagation;
        }
        return handlerStack.suppressEvent;
      }
      sync() {
        this.inputSequence = (this.inputSequence || 0) + 1;
        this.controller.send("updateKeyState", {
          inputSequence: this.inputSequence,
          hintKeystrokeQueue: this.inputMatcher.hintKeystrokeQueue,
          linkTextKeystrokeQueue: this.inputMatcher.linkTextKeystrokeQueue,
          tabCount: this.tabCount,
        });
      }
      updateKeyState(
        { hintKeystrokeQueue, linkTextKeystrokeQueue = [], tabCount, sourceFrameId, inputSequence },
      ) {
        if (this.selected) return;
        if (sourceFrameId !== this.controller.frame()) {
          this.inputMatcher.hintKeystrokeQueue = [...hintKeystrokeQueue];
          this.inputMatcher.linkTextKeystrokeQueue = [...linkTextKeystrokeQueue];
        }
        this.markerMatcher.hintKeystrokeQueue = [...hintKeystrokeQueue];
        this.markerMatcher.linkTextKeystrokeQueue = [...linkTextKeystrokeQueue];
        const result = this.markerMatcher.match(this.hintMarkers, tabCount);
        if (sourceFrameId !== this.controller.frame() || inputSequence === this.inputSequence) {
          this.inputMatcher.hintKeystrokeQueue = [...this.markerMatcher.hintKeystrokeQueue];
          this.inputMatcher.linkTextKeystrokeQueue = [...this.markerMatcher.linkTextKeystrokeQueue];
        }
        if (!result.linksMatched.length) return this.controller.cancelInteractions();
        if (result.linksMatched.length === 1) {
          return this.activateLink(result.linksMatched[0], result.userMightOverType);
        }
        const visible = new Set(result.linksMatched);
        for (const marker of this.hintMarkers) {
          if (!marker.element) continue;
          marker.element.style.display = visible.has(marker) ? "" : "none";
          if (!visible.has(marker)) continue;
          [...marker.element.children].forEach((span, index) =>
            span.classList.toggle("matchingCharacter", index < hintKeystrokeQueue.length)
          );
        }
        this.setIndicator();
      }
      rotateHints() {
        const visible = this.hintMarkers.filter((marker) =>
          marker.element && marker.element.style.display !== "none"
        );
        for (const marker of visible) marker.markerRect ||= marker.element.getBoundingClientRect();
        const parent = new Map(), groups = new Map();
        let roots = [];
        visible.forEach((marker, index) => {
          const touched = new Set(
            visible.slice(0, index).filter((earlier) =>
              Rect.intersects(earlier.markerRect, marker.markerRect)
            ).map((earlier) => parent.get(earlier)),
          );
          const joined = roots.filter((root) => touched.has(root));
          const root = joined[0] || marker;
          if (!joined.length) {
            roots.push(root);
            groups.set(root, []);
          }
          const members = groups.get(root);
          members.push(marker);
          parent.set(marker, root);
          for (const other of joined.slice(1)) {
            const merged = groups.get(other);
            members.push(...merged);
            for (const item of merged) parent.set(item, root);
            groups.delete(other);
          }
          roots = roots.filter((item) => item === root || !touched.has(item));
        });
        const remaining = this.hintMarkers.filter((marker) => !parent.has(marker));
        this.hintMarkers = roots.flatMap((root) => {
          const group = groups.get(root);
          return group.length > 1 ? [group.at(-1), ...group.slice(0, -1)] : group;
        }).concat(remaining);
        for (const marker of this.hintMarkers) {
          if (marker.element) this.containerEl?.appendChild(marker.element);
        }
      }
      activateLink(marker, protectTyping = false) {
        if (!marker || this.selected || !this.controller.live()) return;
        this.selected = marker;
        this.deactivateMode();
        if (marker.localHint) {
          this.controller.action = () => this.controller.act(marker.localHint, this.modeIndex);
          const offset = DomUtils.getViewportTopLeft();
          const flashes = [...marker.localHint.element.getClientRects()].map((rect) =>
            DomUtils.addFlashRect(Rect.translate(rect, offset.left, offset.top))
          );
          const owner = protectTyping
            ? this.controller.sessionResources
            : this.controller.resources;
          const remove = owner.add(
            () => flashes.forEach((flash) => DomUtils.removeElement(flash)),
            "overlay",
          );
          if (!protectTyping) this.controller.resources.timeout(remove, 400);
        }
        if (protectTyping) {
          if (windowIsFocused()) this.controller.protectTyping();
        } else if (marker.localHint) this.controller.send("exit", { isSuccess: true });
      }
      removeHintMarkers() {
        this.containerEl?.remove();
        this.containerEl = null;
      }
      deactivateMode() {
        this.deactivating = true;
        this.removeHintMarkers();
        this.hintMode?.exit();
      }
    };
  }
  class Controller {
    constructor(parentResources, context, enabled = () => true) {
      this.context = context;
      this.enabled = enabled;
      this.epoch = BrowserToolboxRuntimeHostInstance.runtimeEpoch;
      this.resources = new BrowserToolboxRuntime.ResourceScope();
      this.closed = false;
      parentResources.add(() => this.destroy());
    }
    live() {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      return !this.closed && this.enabled() && BrowserToolboxHintsControllerInstance === this &&
        host?.state === "active" && !host.suspended && !host.maintenancePaused &&
        host.runtimeEpoch === this.epoch && host.context.documentId === this.context.documentId;
    }
    frame() {
      return this.context.frameId;
    }
    commands() {
      return {
        "LinkHints.activateMode": (count, request) =>
          this.activate(
            count,
            ({ "copy-text": 7, hover: 8, focus: 9 })[request.registryEntry.options.action] ?? 0,
          ),
        "LinkHints.activateModeToOpenInNewTab": (count) => this.activate(count, 1),
        "LinkHints.activateModeToOpenInNewForegroundTab": (count) => this.activate(count, 2),
        "LinkHints.activateModeToCopyLinkUrl": (count) => this.activate(count, 4),
        "LinkHints.activateModeWithQueue": () => this.activate(1, 3),
        "LinkHints.activateModeToOpenIncognito": (count) => this.activate(count, 5),
        "LinkHints.activateModeToDownloadLink": (count) => this.activate(count, 6),
      };
    }
    activate(count = 1, modeIndex = 0) {
      count ??= 1;
      if (!this.live() || count <= 0 && modeIndex !== 3) return;
      // 公共入口只是路由，保留诊断探针与兼容调用者，不运行旧提示实现。
      HintCoordinator.prepareToActivateMode(modes[modeIndex], (success) => {
        if (success) this.resources.timeout(() => this.activate(count - 1, modeIndex), 0);
      });
    }
    prepareToActivateMode(mode, callback = () => {}) {
      if (!this.live()) return;
      this.cancelInteractions();
      const modeIndex = mode.modeIndex ?? modeNames.indexOf(mode.name);
      if (modeIndex < 0) return;
      const id = this.runtimeInteractionId = crypto.randomUUID();
      this.sessionResources = new BrowserToolboxRuntime.ResourceScope();
      this.onExit = callback;
      this.cachedKeys = [];
      const waiting = this.cacheAllKeydownEvents = new Mode();
      waiting.init({
        name: "link-hints/suppress-keyboard-events",
        singleton: "link-hints-mode",
        indicator: "Collecting hints...",
        suppressAllKeyboardEvents: true,
        exitOnEscape: true,
        keydown: (event) => {
          if (this.cachedKeys.length < 256) this.cachedKeys.push(event);
        },
      });
      waiting.onExit(() => {
        if (!this.activating && this.runtimeInteractionId === id) this.cancelInteractions();
      });
      // 后台协调器收集窗口为 3000ms；本地兜底必须晚于后台窗口，避免多 frame 收集尚未超时就提前清空会话。
      this.sessionResources.timeout(() => {
        if (this.cacheAllKeydownEvents === waiting) this.cancelInteractions();
      }, 3500);
      BrowserToolboxFrameRuntimeBridgeInstance.hints("prepare", {
        modeIndex,
        interactionId: id,
        isExtensionPage: location.protocol.endsWith("extension:"),
        requestedByHelpDialog: globalThis.isVimiumHelpDialog === true,
      }).then((reply) => {
        if (this.runtimeInteractionId === id && !reply?.ok) this.cancelInteractions();
      }).catch(() => {
        if (this.runtimeInteractionId === id) this.cancelInteractions();
      });
    }
    getHintDescriptors({ interactionId, originatingFrameId, modeIndex, requestedByHelpDialog }) {
      if (
        !this.live() ||
        originatingFrameId === this.frame() && this.runtimeInteractionId !== interactionId
      ) return [];
      if (this.runtimeInteractionId && this.runtimeInteractionId !== interactionId) {
        this.finish(false);
      }
      this.runtimeInteractionId = interactionId;
      this.sessionResources ||= new BrowserToolboxRuntime.ResourceScope();
      const scroll = globalThis.BrowserToolboxScrollControllerInstance;
      if (scroll?.animations.size) {
        const resources = this.sessionResources;
        return new Promise((resolve) => {
          let completed = false;
          let unsubscribe = () => {};
          const remove = resources.add(() => {
            unsubscribe();
            resolve(completed);
          });
          unsubscribe = scroll.onIdle((success) => {
            completed = success;
            remove();
          });
        }).then((completed) => {
          if (
            !completed || !this.live() || this.runtimeInteractionId !== interactionId ||
            this.sessionResources !== resources
          ) return [];
          return this.collectDescriptors(modeIndex, requestedByHelpDialog);
        });
      }
      return this.collectDescriptors(modeIndex, requestedByHelpDialog);
    }
    collectDescriptors(modeIndex, requestedByHelpDialog) {
      this.localHints = DomUtils.isReady() && !DomUtils.windowIsTooSmall() &&
          (!requestedByHelpDialog || globalThis.isVimiumHelpDialog)
        ? (this.scanner ||= new BrowserToolboxHintsScanner.Scanner()).collect(
          [4, 5].includes(modeIndex),
        )
        : [];
      return this.localHintDescriptors = this.localHints.map((hint, localIndex) => ({
        frameId: this.frame(),
        localIndex,
        linkText: hint.linkText,
      }));
    }
    activateMode({ interactionId, frameIdToHintDescriptors, modeIndex }) {
      if (!this.live() || this.runtimeInteractionId !== interactionId) return;
      const grouped = {
        ...frameIdToHintDescriptors,
        [this.frame()]: this.localHintDescriptors || [],
      };
      const descriptors = Object.keys(grouped).sort().flatMap((key) => grouped[key]);
      this.activating = true;
      this.cacheAllKeydownEvents?.exit();
      this.cacheAllKeydownEvents = null;
      this.activating = false;
      if (!descriptors.length) {
        HUD.show("No links to select.", 2000);
        this.cancelInteractions();
        return;
      }
      try {
        this.linkHintsMode = new (sessionType())(this, descriptors, modeIndex);
      } catch (_) {
        this.cancelInteractions();
        return;
      }
      const buffered = this.cachedKeys || [];
      this.cachedKeys = [];
      if (Settings.get("filterLinkHints")) {
        for (const event of buffered) {
          if (this.linkHintsMode?.hintMode.modeIsActive) this.linkHintsMode.key(event);
        }
      }
    }
    willHandleMessage(type) {
      return ["getHintDescriptors", "activateMode", "exit", "mouseOutOfLastClickedElement"]
        .includes(type) || !!this.linkHintsMode;
    }
    updateKeyState(request) {
      this.linkHintsMode?.updateKeyState(request);
    }
    rotateHints() {
      this.linkHintsMode?.rotateHints();
    }
    setOpenLinkMode({ modeIndex }) {
      if (modes[modeIndex]) this.linkHintsMode?.setOpenLinkMode(modes[modeIndex], false);
    }
    activateActiveHintMarker() {
      this.linkHintsMode?.activateLink(this.linkHintsMode.markerMatcher.activeHintMarker);
    }
    getLocalHint(descriptor) {
      return this.localHints?.[descriptor.localIndex];
    }
    send(messageType, data = {}) {
      const id = this.runtimeInteractionId;
      if (!id) return;
      const work = BrowserToolboxFrameRuntimeBridgeInstance.hints("broadcast", {
        ...data,
        messageType,
        interactionId: id,
      });
      work.then((reply) => {
        if (this.runtimeInteractionId === id && !reply?.ok) this.failedMessage(id, messageType);
      })
        .catch(() => {
          if (this.runtimeInteractionId === id) this.failedMessage(id, messageType);
        });
      return work;
    }
    failedMessage(id, messageType) {
      this.finish(false);
      if (messageType !== "exit") {
        BrowserToolboxFrameRuntimeBridgeInstance.hints("broadcast", {
          messageType: "exit",
          interactionId: id,
          isSuccess: false,
        }).catch(() => {});
      }
    }
    protectTyping() {
      const mode = this.blocker = new Mode();
      const explicitEnter = Settings.get("waitForEnterForFilteredHints");
      let removeTimer;
      const success = () => this.send("exit", { isSuccess: true });
      const reset = () => {
        removeTimer?.();
        const timer = setTimeout(success, 200);
        removeTimer = this.sessionResources.add(() => clearTimeout(timer), "timer");
      };
      mode.init({
        name: explicitEnter ? "hint/wait-for-enter" : "hint/typing-protector",
        singleton: "link-hints-mode",
        suppressAllKeyboardEvents: true,
        indicator: explicitEnter ? "Hit <Enter> to proceed..." : false,
        keydown: (event) => {
          if (KeyboardUtils.isEscape(event)) this.cancelInteractions();
          else if (explicitEnter && event.key === "Enter") success();
          else if (!explicitEnter) reset();
        },
        keypress: () => {
          if (!explicitEnter) reset();
        },
      });
      if (!explicitEnter) reset();
    }
    async act(hint, index) {
      if (!this.live() || !hint.element.isConnected) return;
      const element = hint.element;
      if (hint.reason === "Frame.") {
        this.resources.timeout(() => focusThisFrame({ highlight: true }), 0);
        return;
      }
      if (hint.reason === "Scroll.") {
        return BrowserToolboxScrollControllerInstance.track("DOMActivate", { target: element });
      }
      if (hint.reason === "Open.") {
        element.open = !element.open;
        return;
      }
      if (DomUtils.isSelectable(element)) {
        globalThis.focus();
        return DomUtils.simulateSelect(element);
      }
      if (["input", "select", "object", "embed"].includes(element.localName)) element.focus();
      this.lastClickedElementRef = new WeakRef(element);
      if ([4, 7].includes(index)) {
        let value = index === 4 ? element.href?.replace(/^mailto:/, "") : element.textContent;
        if (!value) return HUD.show(index === 4 ? "No link to yank." : "No text to yank.", 2000);
        const result = await BrowserToolboxVisualControllerInstance.copy(value);
        if (!this.live()) return;
        if (!result.ok) return HUD.show("Unable to copy to the clipboard.", 2500);
        if (value.length > 28) value = value.slice(0, 26) + "....";
        return HUD.show(`Yanked ${value}`, 2000);
      }
      if (index === 5) {
        return chrome.runtime.sendMessage({ handler: "openUrlInIncognito", url: element.href });
      }
      if (index === 9) return element.focus();
      if (index === 8) {
        const hover = new Mode();
        hover.init({ name: "hover-mode", singleton: "hover-mode", exitOnEscape: true });
        DomUtils.simulateHover(element);
        hover.onExit(() => DomUtils.simulateUnhover(element));
        const remove = this.resources.add(() => hover.exit(), "mode");
        hover.onExit(remove);
        return;
      }
      const mac = KeyboardUtils.platform === "Mac";
      const modifiers = index === 6
        ? { altKey: true, ctrlKey: false, metaKey: false }
        : [1, 2, 3].includes(index)
        ? { metaKey: mac, ctrlKey: !mac, ...(index === 2 ? { shiftKey: true } : {}) }
        : undefined;
      DomUtils.simulateClick(element, modifiers);
    }
    exit({ isSuccess }) {
      this.finish(isSuccess === true);
    }
    finish(success) {
      const callback = this.onExit, action = this.action;
      this.runtimeInteractionId = null;
      this.onExit = this.action = null;
      this.linkHintsMode?.deactivateMode();
      this.linkHintsMode = null;
      this.blocker?.exit();
      this.blocker = null;
      this.cacheAllKeydownEvents?.exit();
      this.cacheAllKeydownEvents = null;
      this.sessionResources?.dispose();
      this.sessionResources = null;
      this.cachedKeys = [];
      this.localHints = this.localHintDescriptors = null;
      if (success && this.live()) Promise.resolve(action?.()).catch(() => {});
      if (this.live()) callback?.(success);
    }
    cancelInteractions() {
      this.send("exit", { isSuccess: false });
      this.finish(false);
    }
    mouseOutOfLastClickedElement() {
      const element = this.lastClickedElementRef?.deref();
      if (element) DomUtils.simulateMouseEvent("mouseout", element, null);
      this.lastClickedElementRef = null;
    }
    destroy() {
      if (this.closed) return;
      this.cancelInteractions();
      this.closed = true;
      this.resources.dispose();
    }
  }
  globalThis.BrowserToolboxHintsRuntime = Object.freeze({
    Controller,
    get Session() {
      return sessionType();
    },
    modes,
  });
})();
