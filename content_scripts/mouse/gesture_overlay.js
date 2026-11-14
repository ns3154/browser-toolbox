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
      this.canvas = null;
      this.ctx = null;
      this.canvasWidth = 0;
      this.canvasHeight = 0;
      this.canvasDpr = 0;
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
      this.lastCommandLabel = "";
      this.lastCancelLabel = "";
      this.lastTrackTier = "";
      this.gestureHudShown = false;
      this.cancelHovered = false;
      this.cancelRect = null;
      this.resizeListener = null;
      this.theme = globalThis.BrowserToolboxTheme?.resolveTheme?.(
        doc?.documentElement?.dataset?.btTheme,
      ) || "sage-mist";
    }

    setTheme(theme) {
      this.theme = globalThis.BrowserToolboxTheme?.resolveTheme?.(theme) || "sage-mist";
      if (this.root?.dataset) this.root.dataset.btTheme = this.theme;
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
          --bt-ov-bg: #f3f7f4;
          --bt-ov-border: #c8d8ce;
          --bt-ov-sep: #d4e2d9;
          --bt-ov-text: #1b2e24;
          --bt-ov-muted: #5a7063;
          --bt-ov-track: #88a093;
          --bt-ov-accent: #15803d;
          --bt-ov-shadow: 0 8px 24px rgba(20, 40, 30, .10), 0 1px 3px rgba(20, 40, 30, .06);
          --bt-ov-cancel-bg: #fff7ed;
          --bt-ov-cancel-border: #fdba74;
          --bt-ov-cancel-text: #9a3412;
          --bt-ov-cancel-track: rgba(154, 52, 18, .55);
          --bt-ov-cancel-pill-bg: #9a3412;
          --bt-ov-cancel-pill-text: #fff7ed;
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          pointer-events: none;
          color-scheme: light dark;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }
        .browser-toolbox-root[data-bt-theme="cobalt"] {
          --bt-ov-bg: #ffffff;
          --bt-ov-border: #d4def0;
          --bt-ov-sep: #e6ebf5;
          --bt-ov-text: #182032;
          --bt-ov-muted: #535d73;
          --bt-ov-track: #94a3b8;
          --bt-ov-accent: #2d58f5;
          --bt-ov-shadow: 0 8px 24px rgba(15, 23, 42, .12), 0 1px 3px rgba(15, 23, 42, .06);
        }
        .browser-toolbox-root[data-bt-theme="paper-ink"] {
          --bt-ov-bg: #faf8f5;
          --bt-ov-border: #dfd6c8;
          --bt-ov-sep: #eae3d8;
          --bt-ov-text: #1f1b16;
          --bt-ov-muted: #6f665a;
          --bt-ov-track: #a39887;
          --bt-ov-accent: #b45309;
          --bt-ov-shadow: 0 8px 24px rgba(41, 31, 20, .12), 0 1px 3px rgba(41, 31, 20, .06);
          --bt-ov-cancel-bg: #fef2f2;
          --bt-ov-cancel-border: #fca5a5;
          --bt-ov-cancel-text: #991b1b;
          --bt-ov-cancel-track: rgba(153, 27, 27, .55);
          --bt-ov-cancel-pill-bg: #991b1b;
          --bt-ov-cancel-pill-text: #fef2f2;
        }
        .browser-toolbox-root[data-bt-theme="slate"] {
          --bt-ov-bg: #ffffff;
          --bt-ov-border: #d4d4d8;
          --bt-ov-sep: #e4e4e7;
          --bt-ov-text: #18181b;
          --bt-ov-muted: #63636e;
          --bt-ov-track: #9f9fa9;
          --bt-ov-accent: #18181b;
          --bt-ov-shadow: 0 8px 24px rgba(15, 23, 42, .12), 0 1px 3px rgba(15, 23, 42, .06);
        }
        @media (prefers-color-scheme: dark) {
          .browser-toolbox-root {
            --bt-ov-bg: #141e19;
            --bt-ov-border: #2b3f34;
            --bt-ov-sep: #24362c;
            --bt-ov-text: #e2ece6;
            --bt-ov-muted: #8ca496;
            --bt-ov-track: #6f8a7b;
            --bt-ov-accent: #4ade80;
            --bt-ov-shadow: 0 10px 28px rgba(0, 0, 0, .42), 0 1px 4px rgba(0, 0, 0, .28);
            --bt-ov-cancel-bg: #2e160d;
            --bt-ov-cancel-border: #9a3412;
            --bt-ov-cancel-text: #fed7aa;
            --bt-ov-cancel-track: rgba(254, 215, 170, .55);
            --bt-ov-cancel-pill-bg: #c2410c;
            --bt-ov-cancel-pill-text: #fff7ed;
          }
          .browser-toolbox-root[data-bt-theme="cobalt"] {
            --bt-ov-bg: #141b2b;
            --bt-ov-border: #2a3956;
            --bt-ov-sep: #232e44;
            --bt-ov-text: #ebf0f9;
            --bt-ov-muted: #98a6bf;
            --bt-ov-track: #64748b;
            --bt-ov-accent: #5b82ff;
          }
          .browser-toolbox-root[data-bt-theme="paper-ink"] {
            --bt-ov-bg: #191714;
            --bt-ov-border: #352f27;
            --bt-ov-sep: #2b2620;
            --bt-ov-text: #f3efe8;
            --bt-ov-muted: #a69d8f;
            --bt-ov-track: #857b6d;
            --bt-ov-accent: #f5b963;
            --bt-ov-cancel-bg: #311214;
            --bt-ov-cancel-border: #991b1b;
            --bt-ov-cancel-text: #fecaca;
            --bt-ov-cancel-track: rgba(254, 202, 202, .55);
            --bt-ov-cancel-pill-bg: #b91c1c;
            --bt-ov-cancel-pill-text: #fef2f2;
          }
          .browser-toolbox-root[data-bt-theme="slate"] {
            --bt-ov-bg: #18181c;
            --bt-ov-border: #313138;
            --bt-ov-sep: #27272e;
            --bt-ov-text: #f4f4f6;
            --bt-ov-muted: #9f9fa9;
            --bt-ov-track: #71717a;
            --bt-ov-accent: #f4f4f6;
          }
        }
        .browser-toolbox-backdrop {
          position: absolute;
          inset: 0;
          background: transparent;
        }
        .browser-toolbox-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          contain: strict;
          pointer-events: none;
        }
        .browser-toolbox-stage {
          position: fixed;
          top: 24px;
          left: 50%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          max-width: calc(100vw - 24px);
          transform: translateX(-50%);
          will-change: transform;
        }
        .browser-toolbox-hud {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          width: auto;
          max-width: calc(100vw - 32px);
          min-height: 38px;
          padding: 7px 16px;
          overflow: hidden;
          border: 1px solid var(--bt-ov-border);
          border-radius: 999px;
          background: var(--bt-ov-bg);
          color: var(--bt-ov-text);
          box-shadow: var(--bt-ov-shadow);
          contain: layout style;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .browser-toolbox-hud[data-mode="text"] {
          min-width: 72px;
          padding: 7px 15px;
        }
        .browser-toolbox-stage.is-cancel-hovered .browser-toolbox-hud {
          border-color: var(--bt-ov-cancel-border);
          background: var(--bt-ov-cancel-bg);
          color: var(--bt-ov-cancel-text);
        }
        .browser-toolbox-gesture-body {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 11px;
          min-width: 0;
        }
        .browser-toolbox-track {
          --browser-toolbox-icon-size: 16px;
          --browser-toolbox-tile-gap: 4px;
          position: relative;
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          gap: var(--browser-toolbox-tile-gap);
          width: max-content;
          min-height: 22px;
        }
        .browser-toolbox-track.is-dense {
          --browser-toolbox-icon-size: 14px;
          --browser-toolbox-tile-gap: 3px;
        }
        .browser-toolbox-track.is-compact {
          --browser-toolbox-icon-size: 12px;
          --browser-toolbox-tile-gap: 2px;
        }
        .browser-toolbox-direction {
          box-sizing: border-box;
          display: inline-grid;
          place-items: center;
          width: calc(var(--browser-toolbox-icon-size) + 2px);
          height: 22px;
          color: var(--bt-ov-track);
        }
        .browser-toolbox-direction.is-current {
          color: var(--bt-ov-accent);
        }
        .browser-toolbox-stage.is-cancel-hovered .browser-toolbox-direction {
          color: var(--bt-ov-cancel-track);
        }
        .browser-toolbox-stage.is-cancel-hovered .browser-toolbox-direction.is-current {
          color: var(--bt-ov-cancel-text);
        }
        .browser-toolbox-direction-icon {
          width: var(--browser-toolbox-icon-size);
          height: var(--browser-toolbox-icon-size);
        }
        .browser-toolbox-status {
          box-sizing: border-box;
          display: none;
          align-items: center;
          min-width: 0;
          max-width: min(360px, 54vw);
          padding-left: 11px;
          border-left: 1px solid var(--bt-ov-sep);
          color: inherit;
          font-size: 13.5px;
          font-weight: 500;
          line-height: 1.25;
          letter-spacing: .01em;
          white-space: nowrap;
        }
        .browser-toolbox-status > span {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .browser-toolbox-status.is-visible { display: inline-flex; }
        .browser-toolbox-stage.is-cancel-hovered .browser-toolbox-status {
          border-left-color: var(--bt-ov-cancel-border);
        }
        .browser-toolbox-text-body {
          color: inherit;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.25;
          white-space: pre;
        }
        .browser-toolbox-cancel {
          display: none;
          align-items: center;
          justify-content: center;
        }
        .browser-toolbox-cancel.is-visible { display: flex; }
        .browser-toolbox-cancel-target {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          height: 28px;
          padding: 0 12px;
          border: 1px solid var(--bt-ov-border);
          border-radius: 999px;
          background: var(--bt-ov-bg);
          color: var(--bt-ov-muted);
          box-shadow: var(--bt-ov-shadow);
          transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
        }
        .browser-toolbox-cancel.is-hovered .browser-toolbox-cancel-target {
          transform: scale(1.04);
          border-color: var(--bt-ov-cancel-pill-bg);
          background: var(--bt-ov-cancel-pill-bg);
          color: var(--bt-ov-cancel-pill-text);
          box-shadow: 0 6px 16px rgba(154, 52, 18, .22);
        }
        .browser-toolbox-cancel-icon {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
        }
        .browser-toolbox-cancel-label {
          font-size: 12px;
          font-weight: 500;
          line-height: 1;
          letter-spacing: .01em;
          white-space: nowrap;
        }
        @media (max-width: 420px) {
          .browser-toolbox-stage { top: 16px; }
          .browser-toolbox-hud { padding: 7px 14px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .browser-toolbox-hud,
          .browser-toolbox-cancel-target { transition: none; }
        }
        @media (forced-colors: active) {
          .browser-toolbox-backdrop { background: transparent; }
          .browser-toolbox-hud,
          .browser-toolbox-cancel-target {
            border: 2px solid CanvasText;
            background: Canvas;
            color: CanvasText;
            box-shadow: none;
            forced-color-adjust: none;
          }
          .browser-toolbox-direction.is-current { color: Highlight; }
          .browser-toolbox-cancel.is-hovered .browser-toolbox-cancel-target { border-color: Highlight; }
        }
      `;

      this.root = this.document.createElement("div");
      this.root.className = "browser-toolbox-root";
      if (this.root.dataset) this.root.dataset.btTheme = this.theme;
      this.backdrop = this.document.createElement("div");
      this.backdrop.className = "browser-toolbox-backdrop";
      this.backdrop.hidden = true;

      this.canvas = this.document.createElement("canvas");
      this.canvas.className = "browser-toolbox-canvas";
      this.ctx = this.canvas.getContext?.("2d") || null;

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
      this.statusLabel = this.document.createElement("span");
      this.statusRow.append(this.statusLabel);
      this.gestureBody.append(this.directionTrack, this.statusRow);

      this.textBody = this.document.createElement("div");
      this.textBody.className = "browser-toolbox-text-body";
      this.textBody.hidden = true;
      this.hud.append(this.gestureBody, this.textBody);

      this.cancel = this.document.createElement("div");
      this.cancel.className = "browser-toolbox-cancel";
      this.cancelTarget = this.document.createElement("div");
      this.cancelTarget.className = "browser-toolbox-cancel-target";
      this.cancelLabel = this.document.createElement("span");
      this.cancelLabel.className = "browser-toolbox-cancel-label";
      this.cancelTarget.append(
        svgIcon(this.document, "M7 7 17 17 M17 7 7 17", "browser-toolbox-cancel-icon"),
        this.cancelLabel,
      );
      this.cancel.append(this.cancelTarget);

      this.stage.append(this.hud, this.cancel);
      this.root.append(this.backdrop, this.canvas, this.stage);
      shadow.append(style, this.root);
      this.document.documentElement.appendChild(this.host);
      if (!this.resizeListener) {
        this.resizeListener = () => {
          this.cancelRect = null;
          this.canvasWidth = 0;
          this.canvasHeight = 0;
        };
        globalThis.addEventListener?.("resize", this.resizeListener, { passive: true });
      }
    }

    ensureCanvasSize() {
      if (!this.canvas) return;
      const width = this.document.documentElement?.clientWidth || globalThis.innerWidth || 0;
      const height = this.document.documentElement?.clientHeight || globalThis.innerHeight || 0;
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
      if (width <= 0 || height <= 0) return;
      if (width === this.canvasWidth && height === this.canvasHeight && dpr === this.canvasDpr) {
        return;
      }
      this.canvasWidth = width;
      this.canvasHeight = height;
      this.canvasDpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      if (!this.ctx) this.ctx = this.canvas.getContext?.("2d") || null;
    }

    clearCanvas() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    show() {
      this.ensure();
      this.ensureCanvasSize();
      if (this.host && this.host.style.display !== "block") this.host.style.display = "block";
    }

    draw(points) {
      this.ensure();
      this.ensureCanvasSize();
      if (!this.ctx || !Array.isArray(points) || points.length === 0) return;
      const dpr = this.canvasDpr || 1;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      if (points.length === 1) {
        ctx.lineTo(points[0].x + 0.01, points[0].y);
      } else if (points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
      } else {
        // 使用二次贝塞尔中点插值平滑折线拐角，减少高速移动时的锯齿感。
        for (let index = 1; index < points.length - 1; index += 1) {
          const current = points[index];
          const next = points[index + 1];
          ctx.quadraticCurveTo(
            current.x,
            current.y,
            (current.x + next.x) / 2,
            (current.y + next.y) / 2,
          );
        }
        const last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);
      }

      const palette = globalThis.BrowserToolboxTheme?.getPalette?.(this.theme);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = palette?.trailHalo || "rgba(255, 255, 255, .78)";
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.strokeStyle = palette?.trail || "#1f7a5c";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    renderDirections(pattern) {
      const directions = (pattern || []).filter((direction) =>
        Object.hasOwn(DIRECTION_ROTATIONS, direction)
      );
      const key = directions.join(">");
      if (key === this.lastGesturePattern) return;
      this.lastGesturePattern = key;
      const tier = directions.length >= 7 ? "compact" : directions.length >= 5 ? "dense" : "normal";
      if (tier !== this.lastTrackTier) {
        this.lastTrackTier = tier;
        this.cancelRect = null;
      }
      this.directionTrack.replaceChildren();
      this.directionTrack.classList.toggle("is-dense", tier === "dense");
      this.directionTrack.classList.toggle("is-compact", tier === "compact");

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
      const wasVisible = this.cancel.classList.contains("is-visible");
      if (reserveHud && !wasVisible) {
        // 取消目标在激活阶段保持同一坐标；HUD 只预留布局，尚未形成方向前不提前露出。
        this.hud.dataset.mode = "gesture";
        this.hud.hidden = false;
        this.hud.style.visibility = "hidden";
        this.hud.setAttribute("aria-hidden", "true");
        this.backdrop.hidden = true;
        this.cancelRect = null;
      }
      const nextLabel = label || message("cancel", "Cancel");
      if (nextLabel !== this.lastCancelLabel) {
        this.lastCancelLabel = nextLabel;
        this.cancelLabel.textContent = nextLabel;
        this.cancel.setAttribute("aria-label", nextLabel);
      }
      if (!wasVisible) {
        this.cancel.classList.add("is-visible");
        this.cancelRect = null;
      }
      this.setCancelHover(hovered);
      this.show();
    }

    setGesture(pattern, commandLabel = "", { cancelLabel = "", cancelHovered = false } = {}) {
      this.ensure();
      if (!this.hud || !Array.isArray(pattern) || pattern.length === 0) return;
      if (!this.gestureHudShown) {
        this.gestureHudShown = true;
        this.hud.dataset.mode = "gesture";
        this.hud.hidden = false;
        this.hud.style.visibility = "visible";
        this.hud.setAttribute("aria-hidden", "false");
        this.gestureBody.hidden = false;
        this.textBody.hidden = true;
        this.backdrop.hidden = false;
        this.cancelRect = null;
      }
      this.renderDirections(pattern);
      if (commandLabel !== this.lastCommandLabel) {
        this.lastCommandLabel = commandLabel;
        this.statusLabel.textContent = commandLabel;
        this.statusRow.classList.toggle("is-visible", Boolean(commandLabel));
        this.statusRow.setAttribute("aria-hidden", commandLabel ? "false" : "true");
      }
      this.showCancel({ label: cancelLabel, hovered: cancelHovered, reserveHud: false });
    }

    setHud(text, visible = true) {
      this.ensure();
      if (!this.hud) return;
      this.gestureHudShown = false;
      this.lastCommandLabel = "";
      this.cancelRect = null;
      this.hud.dataset.mode = "text";
      this.hud.hidden = !visible;
      this.hud.style.visibility = "visible";
      this.hud.setAttribute("aria-hidden", visible ? "false" : "true");
      this.gestureBody.hidden = true;
      this.textBody.hidden = false;
      this.textBody.textContent = text;
      this.backdrop.hidden = true;
      this.cancel.classList.remove("is-visible", "is-hovered");
      this.stage?.classList.remove("is-cancel-hovered");
      this.cancelHovered = false;
      if (visible) this.show();
    }

    setCancelHover(hovered) {
      const next = Boolean(hovered);
      if (next === this.cancelHovered && this.cancelTarget?.dataset.hovered === String(next)) {
        return;
      }
      this.cancelHovered = next;
      this.stage?.classList.toggle("is-cancel-hovered", next);
      this.cancel?.classList.toggle("is-hovered", next);
      if (this.cancelTarget) this.cancelTarget.dataset.hovered = next ? "true" : "false";
    }

    isCancelPoint(point, padding = 14) {
      if (!point || !this.cancelTarget || !this.cancel?.classList.contains("is-visible")) {
        return false;
      }
      // 缓存可见期内的取消按钮包围盒，避免每次 pointermove 都触发强制同步回流。
      let rect = this.cancelRect;
      if (!rect) {
        rect = this.cancelTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) this.cancelRect = rect;
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      return point.x >= rect.left - padding && point.x <= rect.right + padding &&
        point.y >= rect.top - padding && point.y <= rect.bottom + padding;
    }

    hide() {
      if (this.host) this.host.style.display = "none";
      this.clearCanvas();
      if (this.backdrop) this.backdrop.hidden = true;
      if (this.hud) {
        this.hud.hidden = true;
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
      this.stage?.classList.remove("is-cancel-hovered");
      this.lastGesturePattern = "";
      this.lastCommandLabel = "";
      this.lastCancelLabel = "";
      this.lastTrackTier = "";
      this.gestureHudShown = false;
      this.cancelHovered = false;
      this.cancelRect = null;
      this.directionTrack?.replaceChildren();
    }

    destroy() {
      if (this.resizeListener) {
        globalThis.removeEventListener?.("resize", this.resizeListener);
        this.resizeListener = null;
      }
      this.host?.remove();
      this.host =
        this.root =
        this.backdrop =
        this.canvas =
        this.ctx =
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
      this.canvasWidth = 0;
      this.canvasHeight = 0;
      this.canvasDpr = 0;
      this.lastGesturePattern = "";
      this.lastCommandLabel = "";
      this.lastCancelLabel = "";
      this.lastTrackTier = "";
      this.gestureHudShown = false;
      this.cancelHovered = false;
      this.cancelRect = null;
    }
  }

  globalThis.BrowserToolboxGestureOverlay = GestureOverlay;
})();
