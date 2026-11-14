// SPDX-License-Identifier: GPL-3.0-or-later
// 滚动目标、动画和按键持续状态由 Canary 自己维护，旧模块仅通过公共 Scroller 能力路由接入。
(function () {
  const axes = Object.freeze({
    x: { position: "scrollLeft", total: "scrollWidth", view: "clientWidth" },
    y: { position: "scrollTop", total: "scrollHeight", view: "clientHeight" },
  });
  const selectors = Object.freeze({
    "twitter.com": "div.permalink-container div.permalink[role=main]",
    "reddit.com": "#overlayScrollContainer",
    "new.reddit.com": "#overlayScrollContainer",
    "www.reddit.com": "#overlayScrollContainer",
    "web.telegram.org": ".MessageList",
  });
  class ScrollController {
    constructor(resources) {
      this.resources = resources;
      this.animations = new Set();
      this.idleListeners = new Set();
      this.generation = 0;
      this.init();
    }
    init() {
      this.destroy();
      this.closed = false;
    }
    reset() {
      this.activated = null;
    }
    destroy() {
      this.closed = true;
      this.generation++;
      this.held = null;
      this.lastKeyEvent = null;
      for (const animation of this.animations) animation.remove?.();
      this.animations.clear();
      this.notifyIdle(false);
      this.reset();
    }
    onIdle(callback) {
      if (this.closed || !this.animations.size) {
        callback(!this.closed);
        return () => {};
      }
      this.idleListeners.add(callback);
      return () => this.idleListeners.delete(callback);
    }
    notifyIdle(completed) {
      const listeners = [...this.idleListeners];
      this.idleListeners.clear();
      for (const listener of listeners) listener(completed);
    }
    track(type, event) {
      if (type === "keydown") {
        if (!event.repeat) this.generation++;
        this.held = event.code || event.key;
        this.lastKeyEvent = event;
      } else if (type === "keyup") {
        if ((event.code || event.key) === this.held) this.held = null;
      } else if (type === "blur" && event.target === globalThis) {
        this.held = null;
        this.generation++;
      } else if (["click", "DOMActivate"].includes(type)) {
        const target = event.composedPath?.()[0] || event.target;
        if (target?.nodeType === 1) this.activated = target;
      }
    }
    root() {
      return document.querySelector(selectors[globalThis.location?.host] || "html:not(*)") ||
        document.scrollingElement || document.body;
    }
    dimension(element, axis, amount) {
      if (typeof amount === "number") return amount;
      if (amount === "viewSize" && element === this.root()) {
        return axis === "x" ? globalThis.innerWidth : globalThis.innerHeight;
      }
      return element[amount === "max" ? axes[axis].total : axes[axis].view];
    }
    canScroll(element, axis = "y", direction = 1) {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (
        ["hidden", "clip"].includes(style.getPropertyValue(`overflow-${axis}`)) ||
        ["hidden", "collapse"].includes(style.visibility) || style.display === "none"
      ) return false;
      const { position, total, view } = axes[axis];
      const max = Math.max(0, element[total] - element[view]);
      if (!(direction < 0 ? element[position] > 0 : element[position] < max)) return false;
      // 具有溢出尺寸的行内元素和 body 不一定接受滚动；验证实际移动并恢复原位置。
      const before = element[position];
      const moved = this.move(element, axis, direction < 0 ? -1 : 1);
      if (element[position] !== before) {
        this.move(element, axis, before - element[position]);
      }
      return moved && element[position] === before;
    }
    initial() {
      const root = this.root();
      if (this.canScroll(root) || this.canScroll(root, "y", -1)) return root;
      const visit = (parent) => {
        const candidates = [...(parent?.children || [])].map((element) => ({
          element,
          rect: DomUtils.getVisibleClientRect(element),
        })).filter((item) => item.rect).sort((a, b) =>
          b.rect.width * b.rect.height - a.rect.width * a.rect.height
        );
        for (const { element } of candidates) {
          if (this.canScroll(element) || this.canScroll(element, "y", -1)) return element;
          const descendant = visit(element.shadowRoot || element);
          if (descendant) return descendant;
        }
        return null;
      };
      return visit(document.body) || root;
    }
    target(axis, amount, factor = 1, origin = null) {
      const root = this.root();
      let element = origin || this.activated;
      if (!element?.isConnected) element = this.activated = this.initial();
      while (element && element !== root) {
        const direction = Math.sign(factor * this.dimension(element, axis, amount)) || -1;
        if (this.canScroll(element, axis, direction)) return element;
        element = DomUtils.getContainingElement(element) || root;
      }
      return root;
    }
    move(element, axis, amount) {
      const before = element[axes[axis].position];
      if (element.scrollBy) {
        element.scrollBy({ [axis === "x" ? "left" : "top"]: amount, behavior: "instant" });
      } else element[axes[axis].position] += amount;
      return before !== element[axes[axis].position];
    }
    feedback(element) {
      const rect = this.activated?.getBoundingClientRect();
      if (
        rect && (rect.bottom < 0 || rect.top > globalThis.innerHeight ||
          rect.right < 0 || rect.left > globalThis.innerWidth)
      ) this.activated = element;
    }
    animate(element, axis, amount, continuous = true) {
      if (!element || !amount || this.closed) return;
      if (!Settings.get("smoothScroll")) {
        this.move(element, axis, amount);
        this.feedback(element);
        return;
      }
      if (this.lastKeyEvent?.repeat) return;
      const animation = {
        generation: this.generation,
        key: this.held,
        total: 0,
        previous: null,
        elapsed: 0,
        duration: Math.max(100, 20 * Math.log(Math.abs(amount))),
        remove: null,
      };
      this.animations.add(animation);
      const finish = () => {
        this.animations.delete(animation);
        animation.remove?.();
        this.feedback(element);
        if (!this.animations.size) this.notifyIdle(!this.closed);
      };
      const schedule = () => {
        const id = requestAnimationFrame(step);
        animation.remove = this.resources.add(() => cancelAnimationFrame(id), "animation-frame");
      };
      const step = (timestamp) => {
        animation.remove?.();
        animation.remove = null;
        if (this.closed) return finish();
        if (animation.previous == null) animation.previous = timestamp;
        const elapsed = Math.max(0, timestamp - animation.previous);
        animation.previous = timestamp;
        animation.elapsed += elapsed;
        const held = continuous && this.held && this.held === animation.key &&
          this.generation === animation.generation;
        const delta = Math.min(
          held ? Infinity : Math.max(0, Math.abs(amount) - animation.total),
          Math.ceil(Math.abs(amount) * elapsed / animation.duration),
        );
        if (delta && !this.move(element, axis, Math.sign(amount) * delta)) return finish();
        animation.total += delta;
        if (!held && animation.total >= Math.abs(amount)) return finish();
        schedule();
      };
      schedule();
    }
    scrollBy(axis, amount, factor = 1, continuous = true) {
      if (this.lastKeyEvent?.repeat && Settings.get("smoothScroll")) return;
      const target = this.target(axis, amount, factor);
      if (target) {
        this.animate(target, axis, factor * this.dimension(target, axis, amount), continuous);
      }
    }
    scrollTo(axis, position) {
      const target = this.target(axis, position);
      if (target) {
        this.animate(
          target,
          axis,
          this.dimension(target, axis, position) - target[axes[axis].position],
        );
      }
    }
    isScrollableElement(element) {
      if (!this.activated) this.activated = this.initial();
      return element !== this.activated && this.canScroll(element);
    }
    scrollIntoView(element) {
      // 原生 nearest 保留内层与外层视口，不移动已经可见的选择范围。
      element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
    commands() {
      const step = () => Settings.get("scrollStepSize");
      return {
        scrollToBottom: () => {
          Marks.setPreviousPosition();
          this.scrollTo("y", "max");
        },
        scrollToTop: (count) => {
          Marks.setPreviousPosition();
          this.scrollTo("y", (count - 1) * step());
        },
        scrollToLeft: () => this.scrollTo("x", 0),
        scrollToRight: () => this.scrollTo("x", "max"),
        scrollUp: (count) => this.scrollBy("y", -step() * count),
        scrollDown: (count) => this.scrollBy("y", step() * count),
        scrollLeft: (count) => this.scrollBy("x", -step() * count),
        scrollRight: (count) => this.scrollBy("x", step() * count),
        scrollPageUp: (count) => this.scrollBy("y", "viewSize", -count / 2),
        scrollPageDown: (count) => this.scrollBy("y", "viewSize", count / 2),
        scrollFullPageUp: (count) => this.scrollBy("y", "viewSize", -count),
        scrollFullPageDown: (count) => this.scrollBy("y", "viewSize", count),
      };
    }
  }
  globalThis.BrowserToolboxScrollController = ScrollController;
})();
