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
});
