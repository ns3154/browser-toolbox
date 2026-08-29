/**
 * 设置页草稿状态的单元测试。
 * 测试输入为已保存快照和编辑变更，输出为草稿状态转换断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../pages/settings_draft.js";

context("BrowserToolbox settings draft", () => {
  should("separate mutable edits from the saved snapshot", () => {
    const draft = new BrowserToolboxSettingsDraft.SettingsDraft({
      general: { enabled: true },
      siteRules: [],
    });
    const current = draft.getMutable();
    current.general.enabled = false;
    draft.markDirty();

    assert.isTrue(draft.isDirty);
    assert.equal({ enabled: true }, draft.savedSnapshot().general);
    assert.equal(["general"], draft.changedKeys());

    draft.reset();
    assert.isFalse(draft.isDirty);
    assert.isTrue(draft.getMutable().general.enabled);
  });

  should("mark imported values as the new saved baseline", () => {
    const draft = new BrowserToolboxSettingsDraft.SettingsDraft({ value: 1 });
    draft.replace({ value: 2 });
    assert.isTrue(draft.isDirty);
    draft.markSaved({ value: 2 });
    assert.isFalse(draft.isDirty);
    assert.equal(draft.snapshot().value, 2);
  });

  should("clear dirty state when an edit returns to the saved value", () => {
    const draft = new BrowserToolboxSettingsDraft.SettingsDraft({ value: 1 });
    draft.getMutable().value = 2;
    draft.markDirty();
    assert.isTrue(draft.isDirty);

    draft.getMutable().value = 1;
    draft.markDirty();
    assert.isFalse(draft.isDirty);
    assert.equal([], draft.changedKeys());
  });

  should("keep forced dirty state for pending resources", () => {
    const draft = new BrowserToolboxSettingsDraft.SettingsDraft({ value: 1 });
    draft.markDirty(true);

    assert.isTrue(draft.isDirty);
    assert.equal([], draft.changedKeys());

    draft.reset();
    assert.isFalse(draft.isDirty);
  });

  should("compare cyclic snapshots without blocking draft status", () => {
    const left = { value: 1 };
    left.self = left;
    const right = { value: 1 };
    right.self = right;
    assert.isTrue(BrowserToolboxSettingsDraft.equalValues(left, right));
  });
});
