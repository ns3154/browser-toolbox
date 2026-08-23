// 轨迹手势状态机。PENDING 阶段不阻止普通右键菜单，只有 ACTIVE 才接管事件。
(function () {
  const samplerApi = globalThis.OpenKeyMousePathSampler;
  const quantizer = globalThis.OpenKeyMouseDirectionQuantizer;

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
      this.lastPattern = [];
    }

    start(point, now = point.t ?? Date.now()) {
      this.state = "PENDING";
      this.startedAt = now;
      this.lastPattern = [];
      this.sampler.reset(Object.assign({ t: now }, point));
      return this.snapshot(false);
    }

    move(point, now = point.t ?? Date.now()) {
      if (this.state === "IDLE" || this.state === "CANCELLED") return this.snapshot(false);
      if (now - this.startedAt > this.options.maxDurationMs) {
        this.cancel("timeout");
        return this.snapshot(false);
      }
      this.sampler.add(Object.assign({ t: now }, point));
      const points = this.sampler.getPoints();
      const totalDistance = samplerApi.distance(points[0], points.at(-1));
      const activated = this.state === "PENDING" &&
        totalDistance >= this.options.activationDistancePx;
      if (activated) this.state = "ACTIVE";
      if (this.state === "ACTIVE") {
        this.lastPattern = quantizer.quantizePoints(points, this.options);
      }
      return this.snapshot(activated);
    }

    end() {
      const result = this.snapshot(false);
      if (this.state === "ACTIVE") this.state = "COMPLETED";
      else if (this.state === "PENDING") this.state = "NATIVE_CONTEXT_MENU";
      return Object.assign(result, { state: this.state });
    }

    cancel(reason = "cancelled") {
      this.state = "CANCELLED";
      this.cancelReason = reason;
      this.lastPattern = [];
      this.sampler.clear();
      return this.snapshot(false);
    }

    isActive() {
      return this.state === "ACTIVE";
    }

    snapshot(activated) {
      return {
        state: this.state,
        activated,
        pattern: this.lastPattern.slice(),
        points: this.sampler.getPoints(),
        durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
      };
    }
  }

  globalThis.OpenKeyMouseGestureSession = GestureSession;
})();
