// 设置页手势画布：只输出方向序列，不把像素坐标写入配置。
(function () {
  class GestureEditor {
    constructor(canvas, onPattern) {
      this.canvas = canvas;
      this.onPattern = onPattern;
      this.points = [];
      this.drawing = false;
      this.ctx = canvas?.getContext?.("2d");
      canvas?.addEventListener("pointerdown", (event) => this.start(event));
      canvas?.addEventListener("pointermove", (event) => this.move(event));
      canvas?.addEventListener("pointerup", () => this.end());
      canvas?.addEventListener("pointercancel", () => this.end());
      canvas?.addEventListener("pointerleave", () => this.end());
    }

    pointFromEvent(event) {
      if (!this.canvas) return { x: event.offsetX, y: event.offsetY };
      const scaleX = this.canvas.clientWidth > 0 ? this.canvas.width / this.canvas.clientWidth : 1;
      const scaleY = this.canvas.clientHeight > 0
        ? this.canvas.height / this.canvas.clientHeight
        : 1;
      return { x: event.offsetX * scaleX, y: event.offsetY * scaleY };
    }

    start(event) {
      this.drawing = true;
      this.points = [this.pointFromEvent(event)];
      this.canvas.setPointerCapture?.(event.pointerId);
      this.draw();
    }

    move(event) {
      if (!this.drawing) return;
      this.points.push(this.pointFromEvent(event));
      this.draw();
      const pattern = globalThis.BrowserToolboxDirectionQuantizer.quantizePoints(this.points, {
        directionMode: "4-way",
        minimumSegmentDistancePx: 12,
        sampleDistancePx: 2,
        maxSegments: 8,
      });
      this.onPattern?.(pattern);
    }

    end() {
      this.drawing = false;
    }

    clear() {
      this.points = [];
      this.draw();
      this.onPattern?.([]);
    }

    // 在画板上静态预览已绑定手势的圆角矢量轨迹，不触发用户录制回调
    showPattern(pattern) {
      const normalized = globalThis.BrowserToolboxDirectionQuantizer?.normalizePattern?.(pattern) ||
        [];
      if (normalized.length === 0 || !this.canvas) {
        this.points = [];
        this.draw();
        return;
      }
      const vectors = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
      const raw = [[0, 0]];
      for (const dir of normalized) {
        const [dx, dy] = vectors[dir] || [0, 0];
        const prev = raw[raw.length - 1];
        raw.push([prev[0] + dx, prev[1] + dy]);
      }
      const xs = raw.map((point) => point[0]);
      const ys = raw.map((point) => point[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      const padX = 56;
      const padY = 44;
      const scale = Math.min(
        (this.canvas.width - padX * 2) / spanX,
        (this.canvas.height - padY * 2) / spanY,
      );
      const offsetX = (this.canvas.width - (maxX + minX) * scale) / 2;
      const offsetY = (this.canvas.height - (maxY + minY) * scale) / 2;
      this.points = raw.map(([x, y]) => ({
        x: x * scale + offsetX,
        y: y * scale + offsetY,
      }));
      this.draw();
    }

    draw() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.points.length < 2) return;
      const ctx = this.ctx;
      const computed = globalThis.getComputedStyle?.(this.canvas);
      const accent = computed?.getPropertyValue?.("--bt-accent")?.trim() || "#15803d";
      const softHalo = computed?.getPropertyValue?.("--bt-accent-soft")?.trim() ||
        "rgba(21, 128, 61, 0.2)";
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (const point of this.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      // 绘制起点圆点与终点方向箭头
      const start = this.points[0];
      const end = this.points[this.points.length - 1];
      const prev = this.points[this.points.length - 2];
      ctx.fillStyle = softHalo;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
      if (Number.isFinite(angle)) {
        const head = 9;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - head * Math.cos(angle - Math.PI / 6),
          end.y - head * Math.sin(angle - Math.PI / 6),
        );
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
          end.x - head * Math.cos(angle + Math.PI / 6),
          end.y - head * Math.sin(angle + Math.PI / 6),
        );
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  globalThis.BrowserToolboxGestureEditor = GestureEditor;
})();
