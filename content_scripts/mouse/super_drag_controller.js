// 超级拖拽控制器只在移动超过阈值后接管 Pointer 事件。
(function () {
  const classifier = globalThis.OpenKeyMouseDragContextClassifier;
  const Session = globalThis.OpenKeyMouseGestureSession;
  const recognizer = globalThis.OpenKeyMouseGestureRecognizer;

  class SuperDragController {
    constructor(settings = {}) {
      this.settings = settings;
      this.context = null;
      this.session = null;
      this.active = false;
    }

    updateSettings(settings) {
      this.settings = settings || {};
    }

    pointerDown(event, selectedText, dataTransfer) {
      if (!this.settings.enabled || event.button !== 0) return false;
      if (event.altKey && this.settings.nativeBypassModifier === "Alt") return false;
      const context = classifier.classify(
        event.target,
        selectedText,
        dataTransfer,
        event.composedPath?.(),
      );
      if (context.type === "UNSUPPORTED_NATIVE_DRAG") return false;
      this.context = context;
      this.session = new Session({
        activationDistancePx: this.settings.activationDistancePx || 10,
        sampleDistancePx: this.settings.sampleDistancePx || 4,
        minimumSegmentDistancePx: this.settings.minimumSegmentDistancePx || 18,
        directionMode: this.settings.directionMode || "4-way",
        maxSegments: this.settings.maxSegments || 8,
      });
      this.session.start({ x: event.clientX, y: event.clientY }, event.timeStamp || Date.now());
      this.active = false;
      return true;
    }

    pointerMove(event) {
      if (!this.session) return null;
      const result = this.session.move(
        { x: event.clientX, y: event.clientY },
        event.timeStamp || Date.now(),
      );
      this.active = this.session.isActive();
      return result;
    }

    pointerUp() {
      if (!this.session) return null;
      const result = this.session.end();
      const bindingResult = recognizer.find(
        result.pattern,
        this.settings.bindings,
        this.context.type,
      );
      const output = {
        active: this.active,
        context: this.context,
        pattern: result.pattern,
        binding: bindingResult.exact,
      };
      this.clear();
      return output;
    }

    cancel() {
      this.session?.cancel();
      this.clear();
    }

    clear() {
      this.context = null;
      this.session = null;
      this.active = false;
    }
  }

  globalThis.OpenKeyMouseSuperDragController = SuperDragController;
})();
