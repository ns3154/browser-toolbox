// Service Worker 中的短生命周期手势会话。这里只保存方向和 requestId，不保存鼠标坐标。
/**
 * Service Worker 保存的短生命周期手势状态。
 * @typedef {Object} BrowserToolboxGestureSession
 * @property {number} frameId 来源 frame。
 * @property {string} requestId 请求 ID。
 * @property {Array<string>} directions 去重后的方向序列。
 * @property {number} startedAt 开始时间戳。
 * @property {number} maxDurationMs 最大持续时间。
 */
(function () {
  const DEFAULT_MAX_DURATION_MS = 2500;

  function normalizeMaxDuration(value) {
    return Number.isFinite(value) && value >= 100 && value <= 10000
      ? value
      : DEFAULT_MAX_DURATION_MS;
  }

  class GestureFrameCoordinator {
    constructor() {
      this.sessions = new Map();
    }

    /**
     * 开始一个 frame 手势会话。
     * @param {number} tabId 标签页 ID。
     * @param {number} frameId frame ID。
     * @param {string} requestId 请求 ID。
     * @param {number} [maxDurationMs] 最大持续时间。
     * @returns {boolean} 是否创建成功。
     */
    start(tabId, frameId, requestId, maxDurationMs = DEFAULT_MAX_DURATION_MS) {
      if (tabId == null || frameId == null || typeof requestId !== "string") return false;
      this.sessions.set(tabId, {
        frameId,
        requestId,
        directions: [],
        startedAt: Date.now(),
        maxDurationMs: normalizeMaxDuration(maxDurationMs),
      });
      return true;
    }

    /**
     * 追加一个方向并检查会话上限。
     * @param {number} tabId 标签页 ID。
     * @param {number} frameId frame ID。
     * @param {string} requestId 请求 ID。
     * @param {string} direction 方向摘要。
     * @returns {boolean} 会话是否仍有效。
     */
    update(tabId, frameId, requestId, direction) {
      const session = this.sessions.get(tabId);
      if (!session || session.frameId !== frameId || session.requestId !== requestId) return false;
      if (session.directions.at(-1) !== direction) session.directions.push(direction);
      if (session.directions.length > 8) {
        // 方向摘要超过协议上限时立即取消，不能留下可继续通过活动状态校验的会话。
        this.sessions.delete(tabId);
        return false;
      }
      return true;
    }

    isActive(tabId, frameId, requestId) {
      const session = this.sessions.get(tabId);
      return Boolean(
        session && session.frameId === frameId && session.requestId === requestId &&
          Date.now() - session.startedAt <= session.maxDurationMs,
      );
    }

    /**
     * 完成并移除指定手势会话。
     * @param {number} tabId 标签页 ID。
     * @param {number} frameId frame ID。
     * @param {string} requestId 请求 ID。
     * @returns {BrowserToolboxGestureSession|null} 会话或空值。
     */
    finish(tabId, frameId, requestId) {
      const session = this.sessions.get(tabId);
      if (!session || session.frameId !== frameId || session.requestId !== requestId) return null;
      this.sessions.delete(tabId);
      return session;
    }

    cancel(tabId, requestId) {
      const session = this.sessions.get(tabId);
      if (session?.requestId === requestId) this.sessions.delete(tabId);
    }

    clearTab(tabId) {
      this.sessions.delete(tabId);
    }
  }

  globalThis.BrowserToolboxGestureFrameCoordinator = GestureFrameCoordinator;
  globalThis.BrowserToolboxGestureFrameCoordinatorInstance ||= new GestureFrameCoordinator();
})();
