import "../test_helper.js";
import "../../../content_scripts/mouse/context_menu_guard.js";

context("Context menu guard", () => {
  should("keep suppressing the menu after an active gesture is cleaned up", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.activate();
    guard.armForContextMenu();
    guard.deactivate();

    assert.isTrue(guard.shouldSuppress());
    guard.consume();
    assert.isFalse(guard.shouldSuppress());
  });

  should("not arm a second suppression after the menu was handled while active", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.activate();
    guard.consume();
    guard.armForContextMenu();
    guard.deactivate();

    assert.isFalse(guard.shouldSuppress());
  });

  should("expire a delayed suppression without affecting a later ordinary click", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.activate();
    guard.armForContextMenu(-1);
    guard.deactivate();

    assert.isFalse(guard.shouldSuppress());
  });

  should("not arm suppression before a gesture crosses its activation threshold", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.armForContextMenu();

    assert.isFalse(guard.shouldSuppress());
  });

  should("suppress the early menu while a right-button gesture is pending", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.startPendingGesture();

    assert.isTrue(guard.provisional);
    assert.isTrue(guard.shouldSuppress());
    guard.consume();
    assert.isFalse(guard.contextMenuSeen);
    assert.isTrue(guard.shouldSuppress());

    guard.activate();
    assert.isFalse(guard.provisional);
    assert.isTrue(guard.active);
    assert.isFalse(guard.contextMenuSeen);
  });

  should("allow only a nearby second right click inside the retry window", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.armNativeMenuRetry({ x: 20, y: 30 }, 600, 1000);

    assert.isTrue(guard.consumeNativeMenuRetry({ x: 28, y: 34 }, 12, 1500));
    assert.isFalse(guard.consumeNativeMenuRetry({ x: 28, y: 34 }, 12, 1501));

    guard.armNativeMenuRetry({ x: 20, y: 30 }, 600, 2000);
    assert.isFalse(guard.consumeNativeMenuRetry({ x: 40, y: 30 }, 12, 2100));

    guard.armNativeMenuRetry({ x: 20, y: 30 }, 600, 3000);
    assert.isFalse(guard.consumeNativeMenuRetry({ x: 20, y: 30 }, 12, 3601));
  });

  should("reset active and delayed suppression after a cancelled session", () => {
    const guard = new BrowserToolboxContextMenuGuard();
    guard.activate();
    guard.armForContextMenu();

    guard.reset();

    assert.isFalse(guard.active);
    assert.isFalse(guard.provisional);
    assert.isFalse(guard.pending);
    assert.isFalse(guard.shouldSuppress());
    assert.isFalse(guard.contextMenuSeen);
    assert.equal(null, guard.nativeMenuRetryPoint);
  });
});
