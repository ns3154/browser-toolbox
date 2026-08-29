// 将屏幕坐标向量量化为稳定的四向或八向方向。
(function () {
  const DIRECTIONS = ["U", "D", "L", "R", "UL", "UR", "DL", "DR"];
  const EIGHT_WAY_DIRECTIONS = ["R", "UR", "U", "UL", "L", "DL", "D", "DR"];
  const DIRECTION_ARROWS = Object.freeze({
    U: "↑",
    D: "↓",
    L: "←",
    R: "→",
    UL: "↖",
    UR: "↗",
    DL: "↙",
    DR: "↘",
  });
  const ARROW_DIRECTIONS = Object.freeze(
    Object.fromEntries(
      Object.entries(DIRECTION_ARROWS).map(([direction, arrow]) => [
        arrow,
        direction,
      ]),
    ),
  );
  const EIGHT_WAY_SECTOR_RADIANS = Math.PI / 4;
  const EIGHT_WAY_HALF_SECTOR_RADIANS = EIGHT_WAY_SECTOR_RADIANS / 2;

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
      const index = Math.round(angle / EIGHT_WAY_SECTOR_RADIANS) % 8;
      direction = EIGHT_WAY_DIRECTIONS[index];
      const previousAngle = angleOf(previous);
      if (direction !== previous && Number.isFinite(previousAngle)) {
        // 跨过普通扇区边界后继续保留上一方向一小段角度，避免手部抖动反复切换。
        // 迟滞最多限制在半个扇区以内，保证光标指向相邻方向中心时一定能完成转向。
        const requestedHysteresis = Number.isFinite(hysteresisDegrees)
          ? Math.max(0, hysteresisDegrees) * Math.PI / 180
          : 0;
        const hysteresis = Math.min(
          requestedHysteresis,
          EIGHT_WAY_HALF_SECTOR_RADIANS - Number.EPSILON,
        );
        if (
          angleDistance(angle, previousAngle) < EIGHT_WAY_HALF_SECTOR_RADIANS + hysteresis
        ) {
          return previous;
        }
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
    const result = [];
    for (const rawToken of pattern.trim().split(/[\s>·•,|/]+/).filter(Boolean)) {
      const token = rawToken.toUpperCase();
      if (DIRECTIONS.includes(token)) {
        result.push(token);
        continue;
      }
      const arrowDirections = [...rawToken].map((character) => ARROW_DIRECTIONS[character]);
      if (arrowDirections.length > 0 && arrowDirections.every(Boolean)) {
        result.push(...arrowDirections);
      }
    }
    return result;
  }

  function formatPattern(pattern, separator = " · ") {
    return normalizePattern(pattern).map((direction) => DIRECTION_ARROWS[direction]).join(
      separator,
    );
  }

  globalThis.BrowserToolboxDirectionQuantizer = Object.freeze({
    DIRECTIONS,
    DIRECTION_ARROWS,
    quantize,
    quantizePoints,
    normalizePattern,
    formatPattern,
    angleDistance,
  });
})();
