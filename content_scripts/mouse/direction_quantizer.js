// 将屏幕坐标向量量化为稳定的四向方向。
(function () {
  const DIRECTIONS = ["U", "D", "L", "R"];
  const DIRECTION_ARROWS = Object.freeze({
    U: "↑",
    D: "↓",
    L: "←",
    R: "→",
  });
  const ARROW_DIRECTIONS = Object.freeze(
    Object.fromEntries(
      Object.entries(DIRECTION_ARROWS).map(([direction, arrow]) => [
        arrow,
        direction,
      ]),
    ),
  );
  function quantize(dx, dy, _mode = "4-way", previous = null, turnHysteresisDegrees = 0) {
    if (dx === 0 && dy === 0) return DIRECTIONS.includes(previous) ? previous : null;
    // 保留 mode 参数以兼容旧调用方，所有新轨迹按四向主轴量化，并在同向 45° 附近施加角度迟滞以抑制抖动。
    const hysteresis = Number.isFinite(turnHysteresisDegrees)
      ? Math.max(0, Math.min(44, turnHysteresisDegrees))
      : 0;
    if (hysteresis > 0 && DIRECTIONS.includes(previous)) {
      const ratio = Math.tan(((45 + hysteresis / 2) * Math.PI) / 180);
      if ((previous === "R" && dx > 0) || (previous === "L" && dx < 0)) {
        if (Math.abs(dy) <= Math.abs(dx) * ratio) return previous;
      } else if ((previous === "D" && dy > 0) || (previous === "U" && dy < 0)) {
        if (Math.abs(dx) <= Math.abs(dy) * ratio) return previous;
      }
    }
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "L" : "R") : (dy < 0 ? "U" : "D");
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
  });
})();
