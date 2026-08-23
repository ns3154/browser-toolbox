// 将屏幕坐标向量量化为稳定的四向或八向方向。
(function () {
  const DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR"];

  function angleOf(direction) {
    return {
      R: 0,
      UR: Math.PI / 4,
      U: Math.PI / 2,
      UL: Math.PI * 3 / 4,
      L: Math.PI,
      DL: Math.PI * 5 / 4,
      D: Math.PI * 3 / 2,
      DR: Math.PI * 7 / 4,
    }[direction];
  }

  function angleDistance(a, b) {
    const distance = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(distance, Math.PI * 2 - distance);
  }

  function quantize(dx, dy, mode = "4-way", previous = null, hysteresisDegrees = 18) {
    if (dx === 0 && dy === 0) return previous;
    let direction;
    if (mode === "8-way") {
      const angle = (Math.atan2(-dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const index = Math.round(angle / (Math.PI / 4)) % 8;
      direction = ["R", "UR", "U", "UL", "L", "DL", "D", "DR"][index];
      if (previous && angleDistance(angle, angleOf(previous)) < hysteresisDegrees * Math.PI / 180) {
        return previous;
      }
    } else {
      direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "L" : "R") : (dy < 0 ? "U" : "D");
    }
    return direction;
  }

  function quantizePoints(points, {
    directionMode = "4-way",
    minimumSegmentDistancePx = 18,
    turnHysteresisDegrees = 18,
    maxSegments = 8,
  } = {}) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const result = [];
    let segmentStart = points[0];
    let previous = null;
    for (const point of points.slice(1)) {
      const dx = point.x - segmentStart.x;
      const dy = point.y - segmentStart.y;
      if (Math.hypot(dx, dy) < minimumSegmentDistancePx) continue;
      const direction = quantize(dx, dy, directionMode, previous, turnHysteresisDegrees);
      if (!direction) continue;
      segmentStart = point;
      if (direction !== previous) {
        result.push(direction);
        previous = direction;
        if (result.length >= maxSegments) break;
      }
    }
    return result;
  }

  function normalizePattern(pattern) {
    if (Array.isArray(pattern)) return pattern.filter((value) => DIRECTIONS.includes(value));
    if (typeof pattern !== "string") return [];
    return pattern.split(">").map((value) => value.trim()).filter((value) =>
      DIRECTIONS.includes(value)
    );
  }

  globalThis.OpenKeyMouseDirectionQuantizer = Object.freeze({
    DIRECTIONS,
    quantize,
    quantizePoints,
    normalizePattern,
    angleDistance,
  });
})();
