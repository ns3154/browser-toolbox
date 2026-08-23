// 使用 Shadow DOM 绘制轨迹，避免网页 CSS 污染扩展 UI。
(function () {
  class GestureOverlay {
    constructor(doc = globalThis.document) {
      this.document = doc;
      this.host = null;
      this.svg = null;
      this.path = null;
      this.hud = null;
    }

    ensure() {
      if (this.host || !this.document?.documentElement) return;
      this.host = this.document.createElement("div");
      this.host.className = "okm-gesture-host";
      const shadow = this.host.attachShadow({ mode: "closed" });
      const style = this.document.createElement("style");
      style.textContent =
        ".okm-root{position:fixed;inset:0;z-index:2147483646;pointer-events:none}.okm-svg{width:100%;height:100%}.okm-path{fill:none;stroke:#4f8cff;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 2px #000)}.okm-hud{position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:6px 10px;border-radius:6px;background:rgba(20,20,20,.86);color:#fff;font:13px system-ui,sans-serif;white-space:pre;display:none}";
      const root = this.document.createElement("div");
      root.className = "okm-root";
      this.svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.classList.add("okm-svg");
      this.path = this.document.createElementNS("http://www.w3.org/2000/svg", "path");
      this.path.classList.add("okm-path");
      this.svg.appendChild(this.path);
      this.hud = this.document.createElement("div");
      this.hud.className = "okm-hud";
      root.append(this.svg, this.hud);
      shadow.append(style, root);
      this.document.documentElement.appendChild(this.host);
    }

    show() {
      this.ensure();
      if (this.host) this.host.style.display = "block";
    }

    draw(points) {
      this.ensure();
      if (!this.path || points.length === 0) return;
      this.path.setAttribute(
        "d",
        points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "),
      );
    }

    setHud(text, visible = true) {
      this.ensure();
      if (!this.hud) return;
      this.hud.textContent = text;
      this.hud.style.display = visible ? "block" : "none";
    }

    hide() {
      if (this.host) this.host.style.display = "none";
      if (this.path) this.path.setAttribute("d", "");
      if (this.hud) this.hud.textContent = "";
    }

    destroy() {
      this.host?.remove();
      this.host =
        this.svg =
        this.path =
        this.hud =
          null;
    }
  }

  globalThis.OpenKeyMouseGestureOverlay = GestureOverlay;
})();
