// 超级拖拽控制器只在移动超过阈值后接管 Pointer 事件。
(function () {
  const classifier = globalThis.BrowserToolboxDragContextClassifier;
  const Session = globalThis.BrowserToolboxGestureSession;
  const recognizer = globalThis.BrowserToolboxGestureRecognizer;

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

    hasBypassModifier(event) {
      const modifier = this.settings.nativeBypassModifier || "Alt";
      const keys = {
        Alt: "altKey",
        Control: "ctrlKey",
        Meta: "metaKey",
        Shift: "shiftKey",
      };
      return event?.[keys[modifier]] === true;
    }

    pointerDown(event, selectedText, dataTransfer) {
      if (!this.settings.enabled || event.button !== 0) return false;
      if (this.hasBypassModifier(event)) return false;
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

    pointerUp(now = Date.now()) {
      if (!this.session) return null;
      const result = this.session.end(now);
      const bindingResult = recognizer.find(
        result.pattern,
        this.settings.bindings,
        this.context.type,
      );
      const completed = result.state === "COMPLETED";
      const output = {
        active: completed,
        context: this.context,
        pattern: result.pattern,
        binding: completed ? bindingResult.exact : null,
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

  globalThis.BrowserToolboxSuperDragController = SuperDragController;
})();
