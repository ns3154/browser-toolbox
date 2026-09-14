// 使用 Shadow DOM 绘制轨迹和手势反馈，避免网页 CSS 污染扩展 UI。
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DIRECTION_ROTATIONS = Object.freeze({
    R: 0,
    D: 90,
    L: 180,
    U: -90,
  });
  const DIRECTION_MESSAGE_KEYS = Object.freeze({
    R: "gestureDirectionRight",
    D: "gestureDirectionDown",
    L: "gestureDirectionLeft",
    U: "gestureDirectionUp",
  });

  function svgIcon(document, pathData, className) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add(className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.35");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  function message(key, fallback) {
    const i18n = globalThis.BrowserToolboxI18n;
    return i18n?.hasMessage?.(key) ? i18n.message(key) : fallback;
  }

  class GestureOverlay {
    constructor(doc = globalThis.document) {
      this.document = doc;
      this.host = null;
      this.root = null;
      this.backdrop = null;
      this.svg = null;
      this.path = null;
      this.stage = null;
      this.hud = null;
      this.gestureBody = null;
      this.directionTrack = null;
      this.statusRow = null;
      this.statusLabel = null;
      this.textBody = null;
      this.cancel = null;
      this.cancelTarget = null;
      this.cancelLabel = null;
      this.lastGesturePattern = "";
    }

    ensure() {
      if (this.host || !this.document?.documentElement) return;
      this.host = this.document.createElement("div");
      this.host.className = "browser-toolbox-gesture-host";
      this.host.style.display = "none";
      const shadow = this.host.attachShadow({ mode: "closed" });
      const style = this.document.createElement("style");
      style.textContent = `
        :host { all: initial; }
        [hidden] { display: none !important; }
        .browser-toolbox-root {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          pointer-events: none;
          color-scheme: dark;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }
        .browser-toolbox-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(11, 15, 24, .24);
        }
        .browser-toolbox-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
        }
        .browser-toolbox-path {
          fill: none;
          stroke: #5ca0ff;
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .42));
        }
        .browser-toolbox-stage {
          position: fixed;
          top: 50%;
          left: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 28px;
          width: min(452px, calc(100vw - 24px));
          transform: translate(-50%, -46%);
        }
        .browser-toolbox-hud {
          box-sizing: border-box;
          width: min(420px, calc(100vw - 32px));
          min-height: 166px;
          padding: 22px 28px 16px;
          overflow: hidden;
          border: 1px solid rgba(226, 232, 240, .36);
          border-radius: 20px;
          background: rgba(25, 29, 37, .94);
          color: #f8fafc;
          box-shadow:
            0 22px 48px rgba(2, 6, 23, .34),
            0 4px 12px rgba(2, 6, 23, .24),
            inset 0 1px 0 rgba(255, 255, 255, .08);
          backdrop-filter: blur(18px) saturate(125%);
          -webkit-backdrop-filter: blur(18px) saturate(125%);
        }
        .browser-toolbox-hud[data-mode="text"] {
          width: auto;
          min-width: 84px;
          min-height: 0;
          padding: 9px 14px;
          border-radius: 10px;
        }
        .browser-toolbox-gesture-body {
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }
        .browser-toolbox-track {
          --browser-toolbox-tile-size: 56px;
          --browser-toolbox-tile-gap: 28px;
          position: relative;
          display: flex;
          align-items: center;
          align-self: center;
          justify-content: center;
          gap: var(--browser-toolbox-tile-gap);
          width: max-content;
          min-height: var(--browser-toolbox-tile-size);
        }
        .browser-toolbox-track.is-dense {
          --browser-toolbox-tile-size: 44px;
          --browser-toolbox-tile-gap: 14px;
        }
        .browser-toolbox-track.is-compact {
          --browser-toolbox-tile-size: 36px;
          --browser-toolbox-tile-gap: 7px;
        }
        .browser-toolbox-track-line {
          position: absolute;
          top: calc(var(--browser-toolbox-tile-size) / 2 - 1.5px);
          right: calc(var(--browser-toolbox-tile-size) / 2);
          left: calc(var(--browser-toolbox-tile-size) / 2);
          height: 3px;
          border-radius: 999px;
          background: linear-gradient(90deg, #438cf5, #66aaff);
          box-shadow: 0 0 9px rgba(82, 150, 255, .58);
        }
        .browser-toolbox-direction {
          position: relative;
          z-index: 1;
          box-sizing: border-box;
          display: grid;
          place-items: center;
          width: var(--browser-toolbox-tile-size);
          height: var(--browser-toolbox-tile-size);
          border: 1px solid rgba(226, 232, 240, .34);
          border-radius: 15px;
          background: rgba(255, 255, 255, .055);
          color: #f8fafc;
          box-shadow:
            0 4px 12px rgba(0, 0, 0, .18),
            inset 0 1px 0 rgba(255, 255, 255, .06);
        }
        .browser-toolbox-track.is-dense .browser-toolbox-direction {
          border-radius: 12px;
        }
        .browser-toolbox-track.is-compact .browser-toolbox-direction {
          border-radius: 10px;
        }
        .browser-toolbox-direction.is-current {
          border-color: #5da2ff;
          background: rgba(69, 139, 241, .16);
          box-shadow:
            0 0 0 1px rgba(83, 157, 255, .28),
            0 0 20px rgba(67, 140, 245, .28),
            inset 0 1px 0 rgba(255, 255, 255, .08);
        }
        .browser-toolbox-direction-icon {
          width: 30px;
          height: 30px;
        }
        .browser-toolbox-track.is-dense .browser-toolbox-direction-icon {
          width: 24px;
          height: 24px;
        }
        .browser-toolbox-track.is-compact .browser-toolbox-direction-icon {
          width: 20px;
          height: 20px;
        }
        .browser-toolbox-status {
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 11px;
          height: 44px;
          margin-top: 16px;
          padding-top: 15px;
          visibility: hidden;
          border-top: 1px solid rgba(226, 232, 240, .18);
          color: #f8fafc;
          font-size: 17px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: .01em;
        }
        .browser-toolbox-status.is-visible { visibility: visible; }
        .browser-toolbox-status-icon {
          box-sizing: border-box;
          display: grid;
          place-items: center;
          width: 25px;
          height: 25px;
          border-radius: 50%;
          background: #4f96f5;
          color: #fff;
          box-shadow: 0 4px 12px rgba(67, 140, 245, .3);
        }
        .browser-toolbox-status-icon svg {
          width: 15px;
          height: 15px;
        }
        .browser-toolbox-text-body {
          color: #f8fafc;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.25;
          white-space: pre;
        }
        .browser-toolbox-cancel {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .browser-toolbox-cancel.is-visible { display: flex; }
        .browser-toolbox-cancel-target {
          box-sizing: border-box;
          display: grid;
          place-items: center;
          width: 64px;
          height: 64px;
          border: 1px solid rgba(255, 255, 255, .5);
          border-radius: 50%;
          background: #df6468;
          color: #fff;
          box-shadow:
            0 8px 24px rgba(122, 31, 39, .28),
            inset 0 1px 0 rgba(255, 255, 255, .25);
          transition: transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }
        .browser-toolbox-cancel.is-hovered .browser-toolbox-cancel-target {
          transform: scale(1.06);
          background: #ed5d63;
          box-shadow:
            0 0 0 12px rgba(238, 93, 99, .17),
            0 10px 28px rgba(145, 31, 42, .36),
            inset 0 1px 0 rgba(255, 255, 255, .3);
        }
        .browser-toolbox-cancel-icon {
          width: 30px;
          height: 30px;
        }
        .browser-toolbox-cancel-label {
          color: rgba(255, 255, 255, .94);
          font-size: 14px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: .03em;
          text-shadow: 0 1px 4px rgba(0, 0, 0, .55);
        }
        @media (max-width: 420px) {
          .browser-toolbox-stage { transform: translate(-50%, -46%) scale(.9); }
        }
        @media (prefers-reduced-motion: reduce) {
          .browser-toolbox-cancel-target { transition: none; }
        }
        @media (forced-colors: active) {
          .browser-toolbox-backdrop { background: transparent; }
          .browser-toolbox-hud,
          .browser-toolbox-direction,
          .browser-toolbox-cancel-target {
            border: 2px solid CanvasText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
            forced-color-adjust: none;
          }
          .browser-toolbox-track-line,
          .browser-toolbox-status-icon { background: Highlight; }
        }
      `;

      this.root = this.document.createElement("div");
      this.root.className = "browser-toolbox-root";
      this.backdrop = this.document.createElement("div");
      this.backdrop.className = "browser-toolbox-backdrop";
      this.backdrop.hidden = true;

      this.svg = this.document.createElementNS(SVG_NS, "svg");
      this.svg.classList.add("browser-toolbox-svg");
      this.path = this.document.createElementNS(SVG_NS, "path");
      this.path.classList.add("browser-toolbox-path");
      this.svg.appendChild(this.path);

      this.stage = this.document.createElement("div");
      this.stage.className = "browser-toolbox-stage";
      this.hud = this.document.createElement("div");
      this.hud.className = "browser-toolbox-hud";
      this.hud.dataset.mode = "gesture";
      this.hud.hidden = true;
      this.hud.setAttribute("role", "status");
      this.hud.setAttribute("aria-live", "polite");

      this.gestureBody = this.document.createElement("div");
      this.gestureBody.className = "browser-toolbox-gesture-body";
      this.directionTrack = this.document.createElement("div");
      this.directionTrack.className = "browser-toolbox-track";
      this.statusRow = this.document.createElement("div");
      this.statusRow.className = "browser-toolbox-status";
      this.statusRow.setAttribute("aria-hidden", "true");
      const statusIcon = this.document.createElement("span");
      statusIcon.className = "browser-toolbox-status-icon";
      statusIcon.appendChild(
        svgIcon(this.document, "M6.5 12.5 10.25 16 17.75 8.5", "browser-toolbox-check-icon"),
      );
      this.statusLabel = this.document.createElement("span");
      this.statusRow.append(statusIcon, this.statusLabel);
      this.gestureBody.append(this.directionTrack, this.statusRow);

      this.textBody = this.document.createElement("div");
      this.textBody.className = "browser-toolbox-text-body";
      this.textBody.hidden = true;
      this.hud.append(this.gestureBody, this.textBody);

      this.cancel = this.document.createElement("div");
      this.cancel.className = "browser-toolbox-cancel";
      this.cancelTarget = this.document.createElement("div");
      this.cancelTarget.className = "browser-toolbox-cancel-target";
      this.cancelTarget.appendChild(
        svgIcon(this.document, "M7 7 17 17 M17 7 7 17", "browser-toolbox-cancel-icon"),
      );
      this.cancelLabel = this.document.createElement("span");
      this.cancelLabel.className = "browser-toolbox-cancel-label";
      this.cancel.append(this.cancelTarget, this.cancelLabel);

      this.stage.append(this.hud, this.cancel);
      this.root.append(this.backdrop, this.svg, this.stage);
      shadow.append(style, this.root);
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

    renderDirections(pattern) {
      const directions = (pattern || []).filter((direction) =>
        Object.hasOwn(DIRECTION_ROTATIONS, direction)
      );
      const key = directions.join(">");
      if (key === this.lastGesturePattern) return;
      this.lastGesturePattern = key;
      this.directionTrack.replaceChildren();
      this.directionTrack.classList.toggle(
        "is-dense",
        directions.length >= 5 && directions.length < 7,
      );
      this.directionTrack.classList.toggle("is-compact", directions.length >= 7);

      if (directions.length > 1) {
        const line = this.document.createElement("span");
        line.className = "browser-toolbox-track-line";
        line.setAttribute("aria-hidden", "true");
        this.directionTrack.appendChild(line);
      }
      directions.forEach((direction, index) => {
        const tile = this.document.createElement("span");
        tile.className = "browser-toolbox-direction";
        tile.dataset.direction = direction;
        tile.classList.toggle("is-current", index === directions.length - 1);
        tile.setAttribute("role", "img");
        tile.setAttribute("aria-label", message(DIRECTION_MESSAGE_KEYS[direction], direction));
        const icon = svgIcon(
          this.document,
          "M5 12h14 M13 6l6 6-6 6",
          "browser-toolbox-direction-icon",
        );
        icon.style.transform = `rotate(${DIRECTION_ROTATIONS[direction]}deg)`;
        tile.appendChild(icon);
        this.directionTrack.appendChild(tile);
      });
    }

    showCancel({ label = "", hovered = false, reserveHud = true } = {}) {
      this.ensure();
      if (!this.cancel) return;
      if (reserveHud) {
        // 取消目标在 PENDING 和 ACTIVE 阶段保持同一坐标；HUD 只预留布局，不提前露出。
        this.hud.dataset.mode = "gesture";
        this.hud.hidden = false;
        this.hud.style.visibility = "hidden";
        this.hud.setAttribute("aria-hidden", "true");
        this.backdrop.hidden = true;
      }
      this.cancelLabel.textContent = label || message("cancel", "Cancel");
      this.cancel.classList.add("is-visible");
      this.cancel.setAttribute("aria-label", this.cancelLabel.textContent);
      this.setCancelHover(hovered);
      this.show();
    }

    setGesture(pattern, commandLabel = "", { cancelLabel = "", cancelHovered = false } = {}) {
      this.ensure();
      if (!this.hud || !Array.isArray(pattern) || pattern.length === 0) return;
      this.hud.dataset.mode = "gesture";
      this.hud.hidden = false;
      this.hud.style.visibility = "visible";
      this.hud.setAttribute("aria-hidden", "false");
      this.gestureBody.hidden = false;
      this.textBody.hidden = true;
      this.backdrop.hidden = false;
      this.renderDirections(pattern);
      this.statusLabel.textContent = commandLabel;
      this.statusRow.classList.toggle("is-visible", Boolean(commandLabel));
      this.statusRow.setAttribute("aria-hidden", commandLabel ? "false" : "true");
      this.showCancel({ label: cancelLabel, hovered: cancelHovered, reserveHud: false });
    }

    setHud(text, visible = true) {
      this.ensure();
      if (!this.hud) return;
      this.hud.dataset.mode = "text";
      this.hud.hidden = !visible;
      this.hud.style.visibility = "visible";
      this.hud.setAttribute("aria-hidden", visible ? "false" : "true");
      this.gestureBody.hidden = true;
      this.textBody.hidden = false;
      this.textBody.textContent = text;
      this.backdrop.hidden = true;
      this.cancel.classList.remove("is-visible", "is-hovered");
      if (visible) this.show();
    }

    setCancelHover(hovered) {
      this.cancel?.classList.toggle("is-hovered", Boolean(hovered));
      if (this.cancelTarget) this.cancelTarget.dataset.hovered = hovered ? "true" : "false";
    }

    isCancelPoint(point, padding = 14) {
      if (!point || !this.cancelTarget || !this.cancel?.classList.contains("is-visible")) {
        return false;
      }
      const rect = this.cancelTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return point.x >= rect.left - padding && point.x <= rect.right + padding &&
        point.y >= rect.top - padding && point.y <= rect.bottom + padding;
    }

    hide() {
      if (this.host) this.host.style.display = "none";
      if (this.path) this.path.setAttribute("d", "");
      if (this.backdrop) this.backdrop.hidden = true;
      if (this.hud) this.hud.hidden = true;
      if (this.hud) {
        this.hud.style.visibility = "visible";
        this.hud.setAttribute("aria-hidden", "true");
      }
      if (this.textBody) this.textBody.textContent = "";
      if (this.statusLabel) this.statusLabel.textContent = "";
      if (this.statusRow) {
        this.statusRow.classList.remove("is-visible");
        this.statusRow.setAttribute("aria-hidden", "true");
      }
      this.cancel?.classList.remove("is-visible", "is-hovered");
      this.lastGesturePattern = "";
      this.directionTrack?.replaceChildren();
    }

    destroy() {
      this.host?.remove();
      this.host =
        this.root =
        this.backdrop =
        this.svg =
        this.path =
        this.stage =
        this.hud =
        this.gestureBody =
        this.directionTrack =
        this.statusRow =
        this.statusLabel =
        this.textBody =
        this.cancel =
        this.cancelTarget =
        this.cancelLabel =
          null;
      this.lastGesturePattern = "";
    }
  }

  globalThis.BrowserToolboxGestureOverlay = GestureOverlay;
})();
