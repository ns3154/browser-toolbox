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

    start(event) {
      this.drawing = true;
      this.points = [{ x: event.offsetX, y: event.offsetY }];
      this.canvas.setPointerCapture?.(event.pointerId);
      this.draw();
    }

    move(event) {
      if (!this.drawing) return;
      this.points.push({ x: event.offsetX, y: event.offsetY });
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

    draw() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.points.length < 2) return;
      this.ctx.beginPath();
      this.ctx.moveTo(this.points[0].x, this.points[0].y);
      for (const point of this.points.slice(1)) this.ctx.lineTo(point.x, point.y);
      this.ctx.strokeStyle = "#4f8cff";
      this.ctx.lineWidth = 4;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.stroke();
    }
  }

  globalThis.BrowserToolboxGestureEditor = GestureEditor;
})();
