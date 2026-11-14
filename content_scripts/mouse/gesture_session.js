// 轨迹手势状态机。PENDING 阶段不执行命令；菜单是否抑制由控制器按浏览器事件顺序处理。
(function () {
  const samplerApi = globalThis.BrowserToolboxPathSampler;
  const quantizer = globalThis.BrowserToolboxDirectionQuantizer;

  class GestureSession {
    constructor(options = {}) {
      this.options = Object.assign({
        activationDistancePx: 10,
        sampleDistancePx: 4,
        minimumSegmentDistancePx: 18,
        turnHysteresisDegrees: 18,
        maxSegments: 8,
        maxDurationMs: 2500,
        directionMode: "4-way",
      }, options);
      this.sampler = new samplerApi.PathSampler({
        sampleDistancePx: this.options.sampleDistancePx,
        maxPoints: 512,
      });
      this.state = "IDLE";
      this.startedAt = 0;
      this.lastEventAt = 0;
      this.maxDistancePx = 0;
      this.lastPattern = [];
    }

    start(point, now = point.t ?? Date.now()) {
      this.state = "PENDING";
      this.startedAt = now;
      this.lastEventAt = now;
      this.maxDistancePx = 0;
      this.lastPattern = [];
      this.sampler.reset(Object.assign({ t: now }, point));
      return this.snapshot(false, now);
    }

    addSample(point, now = point.t ?? Date.now()) {
      if (this.state !== "PENDING" && this.state !== "ACTIVE") return false;
      this.lastEventAt = now;
      if (now - this.startedAt > this.options.maxDurationMs) {
        this.cancel("timeout");
        return false;
      }
      this.sampler.add(Object.assign({ t: now }, point));
      const points = this.sampler.getPoints();
      const totalDistance = samplerApi.distance(points[0], points.at(-1));
      if (totalDistance > this.maxDistancePx) this.maxDistancePx = totalDistance;
      const activated = this.state === "PENDING" &&
        totalDistance >= this.options.activationDistancePx;
      // 位移跨过激活阈值时从 PENDING 迁入 ACTIVE，后续移动才产生方向和视觉轨迹。
      if (activated) this.state = "ACTIVE";
      return activated;
    }

    move(point, now = point.t ?? Date.now()) {
      if (this.state !== "PENDING" && this.state !== "ACTIVE") return this.snapshot(false, now);
      const activated = this.addSample(point, now);
      if (this.state === "ACTIVE") {
        this.lastPattern = quantizer.quantizePoints(this.sampler.getPoints(), this.options);
      }
      return this.snapshot(activated, now);
    }

    moveBatch(samples, fallbackNow = Date.now()) {
      if (
        !Array.isArray(samples) || samples.length === 0 ||
        (this.state !== "PENDING" && this.state !== "ACTIVE")
      ) {
        return this.snapshot(false, fallbackNow);
      }
      let activated = false;
      let latestNow = fallbackNow;
      for (const sample of samples) {
        const sampleNow = sample.t ?? fallbackNow;
        latestNow = sampleNow;
        if (this.addSample(sample, sampleNow)) activated = true;
        if (this.state === "CANCELLED") break;
      }
      if (this.state === "ACTIVE") {
        this.lastPattern = quantizer.quantizePoints(this.sampler.getPoints(), this.options);
      }
      return this.snapshot(activated, latestNow);
    }

    contextMenu(point, now = point.t ?? Date.now()) {
      if (this.state !== "PENDING") return this.snapshot(false, now);
      // contextmenu 可能先于最后一个 pointermove 到达；用事件坐标补做一次阈值判断。
      const result = this.move(point, now);
      if (result.state === "ACTIVE" || result.state === "CANCELLED") return result;
      this.state = "NATIVE_CONTEXT_MENU";
      this.lastPattern = [];
      this.sampler.clear();
      return this.snapshot(false, now);
    }

    end(now = Date.now()) {
      // 没有新的 pointermove 时也要在抬键瞬间复核超时，避免已过期的 ACTIVE 会话执行命令。
      if (
        (this.state === "PENDING" || this.state === "ACTIVE") &&
        now - this.startedAt > this.options.maxDurationMs
      ) {
        this.cancel("timeout");
      }
      this.lastEventAt = now;
      const result = this.snapshot(false, now);
      if (this.state === "ACTIVE") this.state = "COMPLETED";
      else if (this.state === "PENDING") {
        this.state = "NATIVE_CONTEXT_MENU";
        this.lastPattern = [];
        this.sampler.clear();
      }
      return Object.assign(result, { state: this.state });
    }

    cancel(reason = "cancelled") {
      this.state = "CANCELLED";
      this.cancelReason = reason;
      this.lastPattern = [];
      this.sampler.clear();
      return this.snapshot(false, this.lastEventAt || Date.now());
    }

    isActive() {
      return this.state === "ACTIVE";
    }

    snapshot(activated, now = this.lastEventAt || Date.now()) {
      return {
        state: this.state,
        activated,
        pattern: this.lastPattern.slice(),
        points: this.sampler.getPoints(),
        maxDistancePx: this.maxDistancePx,
        durationMs: this.startedAt ? Math.max(0, now - this.startedAt) : 0,
      };
    }
  }

  globalThis.BrowserToolboxGestureSession = GestureSession;
})();
