// 鼠标轨迹采样器：只保留活动手势的有限点集，空闲时不注册任何高频处理。
(function () {
  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  class PathSampler {
    constructor({ sampleDistancePx = 4, maxPoints = 512 } = {}) {
      this.sampleDistancePx = sampleDistancePx;
      this.maxPoints = maxPoints;
      this.points = [];
    }

    reset(point) {
      this.points = [{ x: point.x, y: point.y, t: point.t ?? Date.now() }];
      return this.points.slice();
    }

    add(point) {
      if (this.points.length === 0) return this.reset(point);
      const last = this.points[this.points.length - 1];
      if (distance(last, point) < this.sampleDistancePx) return false;
      if (this.points.length < this.maxPoints) {
        this.points.push({ x: point.x, y: point.y, t: point.t ?? Date.now() });
      }
      return true;
    }

    clear() {
      this.points.length = 0;
    }

    getPoints() {
      return this.points.slice();
    }
  }

  globalThis.BrowserToolboxPathSampler = Object.freeze({ PathSampler, distance });
})();
