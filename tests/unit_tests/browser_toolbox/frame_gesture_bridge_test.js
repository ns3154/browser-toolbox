/**
 * 跨 frame 手势桥接器的单元测试。
 * 测试输入为模拟指针事件，输出为 runtime 消息序列断言。
 */
import "../test_helper.js";
import "../../../content_scripts/mouse/frame_gesture_bridge.js";

context("Frame gesture bridge", () => {
  function createPort() {
    const messageListeners = [];
    const disconnectListeners = [];
    return {
      messages: [],
      disconnected: false,
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        },
      },
      onDisconnect: {
        addListener(listener) {
          disconnectListeners.push(listener);
        },
      },
      postMessage(message) {
        this.messages.push(message);
      },
      disconnect() {
        this.disconnected = true;
        for (const listener of disconnectListeners) listener();
      },
      emitMessage(message) {
        for (const listener of messageListeners) listener(message);
      },
    };
  }

  should("use one short-lived Port for the complete gesture", async () => {
    const port = createPort();
    let connectOptions;
    const runtimeApi = {
      connect(options) {
        connectOptions = options;
        return port;
      },
    };
    const bridge = new BrowserToolboxFrameGestureBridge({ runtimeApi });

    bridge.start("request-1234");
    assert.equal({ name: "browserToolbox.gesture" }, connectOptions);
    assert.equal(
      { handler: "browserToolbox.gestureStart", requestId: "request-1234" },
      port.messages[0],
    );
    port.emitMessage({ accepted: true });
    assert.isTrue(await bridge.waitUntilReady());

    bridge.update("R");
    bridge.update("R");
    bridge.update("D");
    assert.equal(3, port.messages.length);
    assert.equal(
      { handler: "browserToolbox.gestureUpdate", requestId: "request-1234", direction: "R" },
      port.messages[1],
    );
    assert.equal(
      { handler: "browserToolbox.gestureUpdate", requestId: "request-1234", direction: "D" },
      port.messages[2],
    );

    bridge.finish(["R", "D"]);
    assert.equal(
      { handler: "browserToolbox.gestureFinish", requestId: "request-1234", pattern: ["R", "D"] },
      port.messages[3],
    );
    assert.isTrue(port.disconnected);
  });

  should("clear the local session when the Service Worker disconnects", async () => {
    const port = createPort();
    const bridge = new BrowserToolboxFrameGestureBridge({ runtimeApi: { connect: () => port } });
    bridge.start("request-5678");
    const ready = bridge.waitUntilReady();
    port.disconnect();

    assert.isFalse(await ready);
    bridge.update("R");
    assert.equal(1, port.messages.length);
  });
});
