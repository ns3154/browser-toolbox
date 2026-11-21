// SPDX-License-Identifier: GPL-3.0-or-later
// 通过持久存储跨实例恢复，故障点在真实写入后，不能用原进程的 catch 冒充恢复。
import "../test_helper.js";
import "../../../lib/settings.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_definitions.js";
import "../../../lib/browser_toolbox/tools/tool_contract.js";
import "../../../lib/browser_toolbox/tools/tool_registry.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";
import "../../../background_scripts/browser_toolbox/settings_migrations.js";
import "../../../content_scripts/mouse/cursor_controller.js";
import "../../../background_scripts/browser_toolbox/configuration_writer.js";
import {
  LegacyRollbackTransaction,
  ROLLBACK_JOURNAL_KEY,
} from "../../../background_scripts/browser_toolbox/legacy_rollback_transaction.js";
import {
  KeyboardSyncPublisher,
  SYNC_PUBLISH_JOURNAL_KEY,
} from "../../../background_scripts/browser_toolbox/keyboard_sync_publisher.js";
import { TransitionArchive } from "../../../background_scripts/browser_toolbox/transition_archive.js";
import { TransitionConflictDecisions } from "../../../background_scripts/browser_toolbox/transition_conflict_decisions.js";
import { SyncTransitionConflictDecisions } from "../../../background_scripts/browser_toolbox/sync_transition_conflict_decisions.js";

const config = BrowserToolboxConfigurationStore;
const clone = (value) => structuredClone(value);

context("配置持久提交、配额与冲突", () => {
  function harness(initial = {}) {
    const listeners = new Set();
    const writes = [];
    const controls = { fail: null };
    const storage = { onChanged: { addListener: (listener) => listeners.add(listener) } };
    for (const name of ["sync", "local", "session"]) {
      const values = clone(initial[name] || {});
      storage[name] = {
        values,
        QUOTA_BYTES: name === "sync" ? 102400 : 10 * 1024 * 1024,
        QUOTA_BYTES_PER_ITEM: 8192,
        MAX_ITEMS: 512,
        MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
        MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
        async get(keys) {
          if (controls.fail?.(name, "get", keys)) throw new Error("合成读取失败");
          if (keys === null) return clone(values);
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => Object.hasOwn(values, key)).map((key) => [key, clone(values[key])]),
          );
        },
        async getKeys() {
          if (controls.fail?.(name, "getKeys")) throw new Error("合成读取失败");
          return Object.keys(values);
        },
        async getBytesInUse(keys) {
          return Object.entries(await this.get(keys)).reduce(
            (n, [key, value]) => n + config.itemBytes(key, value),
            0,
          );
        },
        async set(items) {
          if (controls.fail?.(name, "set", items)) throw new Error("合成写入失败");
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: clone(values[key]), newValue: clone(value) };
            values[key] = clone(value);
          }
          writes.push({ name, method: "set", keys: Object.keys(items) });
          for (const listener of listeners) listener(changes, name);
        },
        async remove(keys) {
          if (controls.fail?.(name, "remove", keys)) throw new Error("合成删除失败");
          const changes = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (Object.hasOwn(values, key)) changes[key] = { oldValue: clone(values[key]) };
            delete values[key];
          }
          writes.push({ name, method: "remove", keys: Object.keys(changes) });
          for (const listener of listeners) listener(changes, name);
        },
      };
    }
    const tool = clone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS);
    tool.keyboard.keyMappings = "陈旧副本";
    tool.searchEngines = "陈旧搜索";
    storage.sync.values.browserToolboxSettings ??= tool;
    storage.sync.values.settingsVersion ??= "2.4.2";
    const notifications = [];
    const create = (options = {}) =>
      new config.ConfigurationWriter({
        storage,
        defaults: () => Settings.defaultOptions,
        migrateLegacy: (value) => Settings.migrateSettingsIfNecessary(value),
        migrateToolbox: (value) => BrowserToolboxSettingsMigrations.migrate(value),
        validateToolbox: (value) => BrowserToolboxSettingsValidator.assertValid(value),
        onCommit: (value) => notifications.push(clone(value)),
        ...options,
      });
    return { storage, writes, controls, create, notifications };
  }

  async function rejects(promise, code) {
    let caught;
    try {
      await promise;
    } catch (failure) {
      caught = failure;
    }
    assert.isTrue(Boolean(caught), "应拒绝不安全提交");
    if (code) assert.equal(code, caught.code);
    return caught;
  }

  async function installSyntheticKeyboardGeneration(h, keyboard, revision = 1) {
    const generation = await config.createGeneration(keyboard, "synthetic-remote", revision);
    generation.index.kind = "keyboard-sync";
    generation.index.sourceDigest = await config.digest(keyboard);
    Object.assign(h.storage.sync.values, clone(generation.chunks), {
      [config.KEYS.index]: clone(generation.index),
    });
    return generation;
  }

  async function rollbackFixture(options = {}) {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const latest = await writer.commit({
      legacyPatch: {
        keyMappings: Settings.defaultOptions.keyMappings,
        searchEngines: "s: https://example.invalid/new?q=%s",
        smoothScroll: false,
      },
    });
    h.storage.sync.values.keyMappings = "map old scrollUp";
    h.storage.sync.values.searchEngines = "s: https://example.invalid/old?q=%s";
    delete h.storage.sync.values.smoothScroll;
    const transaction = new LegacyRollbackTransaction({
      writer,
      authorize: () => true,
      ...options,
    });
    return { h, writer, latest, transaction };
  }

  async function publishFixture(options = {}) {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const latest = await writer.commit({
      legacyPatch: { keyMappings: "map z scrollDown", smoothScroll: false },
    });
    const publisher = new KeyboardSyncPublisher({ writer, authorize: () => true, ...options });
    return { h, writer, latest, publisher };
  }

  async function syncConflictFixture() {
    const fixture = await publishFixture();
    const { h, writer, latest, publisher } = fixture;
    await publisher.execute(await publisher.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("keyboard-sync-publish");
    const incoming = clone(latest.keyboard);
    delete incoming.settingsVersion;
    incoming.keyMappings = "map remote scrollUp";
    incoming.smoothScroll = true;
    const generation = await installSyntheticKeyboardGeneration(h, incoming, 777);
    h.storage.sync.values.unrelatedSynthetic = "synthetic-private-unrelated";
    return { ...fixture, archiveKey, incoming, generation };
  }

  should("本机指针资源按固定键名分页，只返回键名且不暴露其他数据", async () => {
    const h = harness();
    const writer = h.create();
    for (let index = 0; index < 105; index++) {
      h.storage.local.values[`browserToolboxCursor-${String(index).padStart(8, "0")}`] =
        `data:image/png;base64,${btoa(`synthetic-${index}`)}`;
    }
    h.storage.local.values["openKeyMouseCursor-abcdefgh"] = "data:image/png;base64,AA==";
    h.storage.local.values["browserToolboxCursor-invalid!key"] = "synthetic-secret";
    h.storage.local.values.syntheticOther = "synthetic-private";
    const before = clone(h.storage.local.values);
    const writes = h.writes.length;
    const first = await writer.listLocalCursorAssets();
    assert.equal(100, first.keys.length);
    assert.equal(first.keys[99], first.next);
    const second = await writer.listLocalCursorAssets(first.next);
    assert.equal(6, second.keys.length);
    assert.equal(null, second.next);
    assert.isTrue(second.keys.includes("openKeyMouseCursor-abcdefgh"));
    assert.isFalse(JSON.stringify([first, second]).includes("synthetic-private"));
    assert.equal(before, h.storage.local.values);
    assert.equal(writes, h.writes.length);
    await rejects(writer.listLocalCursorAssets("syntheticOther"), "INVALID_CONFIGURATION");
  });

  should("只读选定指针时拒绝非图片正文、超限、缺失与读取期间变化", async () => {
    const h = harness();
    const writer = h.create();
    const key = "browserToolboxCursor-12345678";
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    h.storage.local.values[key] = png;
    const result = await writer.readLocalCursorAsset(key);
    assert.equal(png, result.dataUrl);
    assert.isTrue(result.pngHeaderValid);
    await rejects(writer.readLocalCursorAsset("syntheticOther"), "INVALID_CONFIGURATION");
    h.storage.local.values[key] = "synthetic-secret";
    await rejects(writer.readLocalCursorAsset(key), "INVALID_CURSOR_ASSET");
    h.storage.local.values[key] = `data:image/png;base64,${"A".repeat(400000)}`;
    await rejects(writer.readLocalCursorAsset(key), "INVALID_CURSOR_ASSET");
    delete h.storage.local.values[key];
    await rejects(writer.readLocalCursorAsset(key), "CONFIGURATION_CURSOR_ASSET_MISSING");
    h.storage.local.values[key] = png;
    const get = h.storage.local.get;
    let reads = 0;
    h.storage.local.get = async (keys) => {
      const value = await get.call(h.storage.local, keys);
      if (keys === key && ++reads === 1) h.storage.local.values[key] = "changed";
      return value;
    };
    const writes = h.writes.length;
    await rejects(writer.readLocalCursorAsset(key), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal(writes, h.writes.length);
  });

  should("导入前备份最近提交的完整配置和本地指针资源，再通过原队列提交", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const asset = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    h.storage.local.values[id] = asset;
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
    const before = await writer.commit({
      legacyPatch: { scrollStepSize: 81, keyMappings: "map z scrollDown" },
      toolbox,
    });
    h.writes.length = 0;
    const after = await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 95 },
      baseline: { keyboard: before.keyboard },
    });
    const keys = Object.keys(h.storage.local.values).filter((key) =>
      key.startsWith(config.IMPORT_BACKUP_PREFIX)
    );
    assert.equal(1, keys.length);
    const backup = await h.create().readImportBackup(keys[0]);
    assert.equal(before.revision, backup.snapshot.revision);
    assert.equal(81, backup.snapshot.keyboard.scrollStepSize);
    assert.equal("map z scrollDown", backup.snapshot.keyboard.keyMappings);
    assert.equal(id, backup.snapshot.toolbox.cursor.localAssetId);
    assert.equal({ id, present: true, value: asset }, backup.cursorAsset);
    assert.equal(95, after.keyboard.scrollStepSize);
    const savedAt = h.writes.findIndex((item) =>
      item.name === "local" && item.keys.includes(keys[0])
    );
    const writtenAt = h.writes.findIndex((item) => item.name === "sync");
    assert.isTrue(savedAt >= 0 && writtenAt > savedAt);
    assert.equal(asset, h.storage.local.values[id]);
  });

  should("导入不能用旧规则替换当前含附加字段的规则，其他字段仍可导入", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const protectedRule = {
      pattern: "https://protected.invalid/*",
      passKeys: "j",
      futurePolicy: { enabled: false },
    };
    const before = await writer.commit({ legacyPatch: { exclusionRules: [protectedRule] } });
    const syncBefore = clone(h.storage.sync.values);
    const localBefore = clone(h.storage.local.values);
    h.writes.length = 0;
    const failure = await rejects(
      writer.importConfiguration({
        legacyPatch: { exclusionRules: [{ pattern: "https://new.invalid/*", passKeys: "" }] },
        baseline: { keyboard: before.keyboard },
      }),
      "CONFIGURATION_EXISTING_RULES_UNSUPPORTED",
    );
    assert.equal(["keyboard.exclusionRules[0].futurePolicy"], failure.conflicts);
    assert.equal(0, h.writes.length);
    assert.equal(syncBefore, h.storage.sync.values);
    assert.equal(localBefore, h.storage.local.values);
    const imported = await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 93 },
      baseline: { keyboard: before.keyboard },
    });
    assert.equal([protectedRule], imported.keyboard.exclusionRules);
    assert.equal(93, imported.keyboard.scrollStepSize);
  });

  should("导入前备份写入或读回失败时，不写入导入配置", async () => {
    for (const failureStep of ["set", "get"]) {
      const h = harness();
      const writer = h.create();
      const before = await writer.read();
      const syncBefore = clone(h.storage.sync.values);
      let backupWritten = false;
      h.controls.fail = (area, method, keys) => {
        const matched = area === "local" &&
          (method === "set" ? Object.keys(keys) : Array.isArray(keys) ? keys : [keys]).some((key) =>
            typeof key === "string" && key.startsWith(config.IMPORT_BACKUP_PREFIX)
          );
        if (matched && method === "set" && failureStep === "get") backupWritten = true;
        return matched && method === failureStep && (failureStep === "set" || backupWritten);
      };
      await rejects(writer.importConfiguration({
        legacyPatch: { scrollStepSize: 95 },
        baseline: { keyboard: before.keyboard },
      }));
      assert.equal(syncBefore, h.storage.sync.values);
      assert.equal(
        before.revision,
        h.storage.local.values[config.KEYS.state].committedIndex.revision,
      );
      if (failureStep === "get") {
        assert.isTrue(
          Object.keys(h.storage.local.values).some((key) =>
            key.startsWith(config.IMPORT_BACKUP_PREFIX)
          ),
        );
      }
    }
  });

  should("导入前备份落盘后后台中断，重启可读取备份且原设置不变", async () => {
    const h = harness();
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const writer = h.create({
      afterStep: (step) => {
        if (step === "import-backup") throw stop;
      },
    });
    const before = await writer.read();
    const syncBefore = clone(h.storage.sync.values);
    await rejects(writer.importConfiguration({
      legacyPatch: { scrollStepSize: 93 },
      baseline: { keyboard: before.keyboard },
    }));
    assert.equal(syncBefore, h.storage.sync.values);
    const restarted = h.create();
    const backups = await restarted.listImportBackups();
    assert.equal(1, backups.length);
    assert.equal("valid", backups[0].status);
    assert.equal(before.revision, backups[0].revision);
    assert.equal(before.keyboard, (await restarted.read()).keyboard);
  });

  should("导入参数入队前复制，备份损坏后重启读取拒绝", async () => {
    const h = harness();
    const writer = h.create();
    const before = await writer.read();
    let release;
    const held = writer.enqueue(() => new Promise((resolve) => release = resolve));
    await Promise.resolve();
    const input = { legacyPatch: { scrollStepSize: 83 }, baseline: { keyboard: before.keyboard } };
    const pending = writer.importConfiguration(input);
    input.legacyPatch.scrollStepSize = 99;
    release();
    await held;
    assert.equal(83, (await pending).keyboard.scrollStepSize);
    const key = Object.keys(h.storage.local.values).find((name) =>
      name.startsWith(config.IMPORT_BACKUP_PREFIX)
    );
    const backup = await h.create().readImportBackup(key);
    assert.equal(before.revision, backup.snapshot.revision);
    h.storage.local.values[key].snapshot.keyboard.scrollStepSize = 100;
    await rejects(h.create().readImportBackup(key), "CONFIGURATION_DIGEST_MISMATCH");
  });

  should("普通提交入队后调用方修改输入不会改变待提交值或基线", async () => {
    const h = harness();
    const writer = h.create();
    const before = await writer.read();
    let release;
    const held = writer.enqueue(() => new Promise((resolve) => release = resolve));
    await Promise.resolve();
    const input = {
      legacyPatch: { scrollStepSize: 83 },
      baseline: { keyboard: clone(before.keyboard) },
    };
    const pending = writer.commit(input);
    input.legacyPatch.scrollStepSize = 99;
    input.baseline.keyboard.scrollStepSize = 777;
    release();
    await held;
    assert.equal(83, (await pending).keyboard.scrollStepSize);
  });

  should("导入前备份可在重启后列出并只导出配置，列表和导出不泄露指针资源", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const asset = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    h.storage.local.values[id] = asset;
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
    const before = await writer.commit({ legacyPatch: { scrollStepSize: 81 }, toolbox });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 92 },
      baseline: { keyboard: before.keyboard },
    });
    const restarted = h.create();
    const backups = await restarted.listImportBackups();
    assert.equal(1, backups.length);
    assert.equal("valid", backups[0].status);
    assert.equal(before.revision, backups[0].revision);
    assert.isFalse(JSON.stringify(backups).includes(asset));
    const exported = await restarted.exportImportBackup(backups[0].key);
    assert.equal(81, exported.snapshot.keyboard.scrollStepSize);
    assert.isFalse(JSON.stringify(exported).includes(asset));
    assert.equal(true, exported.cursorAssetPresent);
    h.storage.local.values[backups[0].key].snapshot.keyboard.scrollStepSize = 100;
    const damaged = await restarted.listImportBackups();
    assert.equal("invalid", damaged[0].status);
    await rejects(restarted.exportImportBackup(backups[0].key), "CONFIGURATION_DIGEST_MISMATCH");
  });

  should("明确导出指针时才返回备份资源，缺失或损坏备份不会返回内容", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const asset = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    h.storage.local.values[id] = asset;
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor.localAssetId = id;
    const current = await writer.commit({ toolbox });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 82 },
      baseline: { keyboard: current.keyboard },
    });
    const [entry] = await writer.listImportBackups();
    assert.isTrue(entry.cursorAssetPresent);
    assert.isFalse(JSON.stringify(entry).includes(asset));
    const writes = h.writes.length;
    assert.equal(
      { dataUrl: asset, pngHeaderValid: true },
      await writer.exportImportBackupCursor(entry.key),
    );
    assert.equal(writes, h.writes.length);
    h.storage.local.values[entry.key].cursorAsset.value += "A";
    await rejects(writer.exportImportBackupCursor(entry.key), "CONFIGURATION_DIGEST_MISMATCH");
    assert.equal(writes, h.writes.length);
  });

  should("缺失指针不能导出，损坏的指针字节可单独取出且标明未经有效检查", async () => {
    for (const present of [false, true]) {
      const h = harness();
      const writer = h.create();
      const initial = await writer.read();
      const id = "browserToolboxCursor-12345678";
      const asset = "data:image/png;base64,bm90LWEtcG5n";
      if (present) h.storage.local.values[id] = asset;
      const toolbox = clone(initial.toolboxSource.value);
      toolbox.cursor.localAssetId = id;
      const current = await writer.commit({ toolbox });
      await writer.importConfiguration({
        legacyPatch: { scrollStepSize: 82 },
        baseline: { keyboard: current.keyboard },
      });
      const [entry] = await writer.listImportBackups();
      if (present) {
        assert.equal(
          { dataUrl: asset, pngHeaderValid: false },
          await writer.exportImportBackupCursor(entry.key),
        );
      } else {
        await rejects(
          writer.exportImportBackupCursor(entry.key),
          "CONFIGURATION_CURSOR_ASSET_MISSING",
        );
      }
    }
  });

  should("备份恢复预览只返回字段差异和限制，不写入配置或泄露正文", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const asset = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    h.storage.local.values[id] = asset;
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor = { enabled: true, localAssetId: id, hotspotX: 0, hotspotY: 0 };
    const before = await writer.commit({
      legacyPatch: { keyMappings: "map secret-synthetic scrollDown" },
      toolbox,
    });
    const next = clone(before.toolboxSource.value);
    next.cursor = { enabled: false, localAssetId: null, hotspotX: 0, hotspotY: 0 };
    await writer.importConfiguration({
      legacyPatch: { keyMappings: "map a scrollUp" },
      toolbox: next,
      baseline: { keyboard: before.keyboard, toolbox: before.toolboxSource.value },
    });
    const [entry] = await writer.listImportBackups();
    const writes = h.writes.length;
    const sync = clone(h.storage.sync.values);
    const preview = await writer.previewImportBackupRestore(entry.key);
    assert.equal(["keyMappings"], preview.keyboardFields);
    assert.isTrue(preview.toolboxChanged && preview.cursorChanged);
    assert.equal("header-valid", preview.cursorStatus);
    assert.equal([], preview.legacyLimitations);
    assert.isFalse(preview.writeAllowed || preview.releaseAllowed || preview.lineageVerified);
    assert.isFalse(JSON.stringify(preview).includes("secret-synthetic"));
    assert.isFalse(JSON.stringify(preview).includes(asset));
    assert.equal(sync, h.storage.sync.values);
    assert.equal(writes, h.writes.length);
  });

  should("备份恢复预览报告缺失图片和旧格式无法表达字段，仍不放行写入", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor.localAssetId = "browserToolboxCursor-12345678";
    const current = await writer.commit({
      legacyPatch: {
        exclusionRules: [{ pattern: "https://example.invalid/*", passKeys: "", enabled: false }],
      },
      toolbox,
    });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 83 },
      baseline: { keyboard: current.keyboard },
    });
    const [entry] = await writer.listImportBackups();
    const preview = await writer.previewImportBackupRestore(entry.key);
    assert.equal("missing", preview.cursorStatus);
    assert.equal(["keyboard.exclusionRules[0].enabled"], preview.legacyLimitations);
    assert.isFalse(preview.writeAllowed || preview.releaseAllowed || preview.lineageVerified);
  });

  should("预览时备份或外部来源变化会拒绝返回过期结果且不覆盖现场", async () => {
    for (const scenario of ["backup", "source"]) {
      const h = harness();
      const writer = h.create();
      const current = await writer.read();
      await writer.importConfiguration({
        legacyPatch: { scrollStepSize: 83 },
        baseline: { keyboard: current.keyboard },
      });
      const [entry] = await writer.listImportBackups();
      let reads = 0;
      const localGet = h.storage.local.get;
      h.storage.local.get = async (keys) => {
        if (keys === entry.key && ++reads === 2) {
          if (scenario === "backup") h.storage.local.values[entry.key].createdAt = "changed";
          else h.storage.sync.values.scrollStepSize = 97;
        }
        return await localGet(keys);
      };
      const writes = h.writes.length;
      await rejects(
        writer.previewImportBackupRestore(entry.key),
        "CONFIGURATION_EXTERNAL_CONFLICT",
      );
      assert.equal(writes, h.writes.length);
      if (scenario === "source") assert.equal(97, h.storage.sync.values.scrollStepSize);
    }
  });

  should("恢复预览发现事务记录时停下，原记录和备份均保留", async () => {
    const h = harness();
    const writer = h.create();
    const current = await writer.read();
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 83 },
      baseline: { keyboard: current.keyboard },
    });
    const [entry] = await writer.listImportBackups();
    const journal = { formatVersion: 999, opaque: "synthetic-external-journal" };
    h.storage.local.values[ROLLBACK_JOURNAL_KEY] = clone(journal);
    const saved = clone(h.storage.local.values[entry.key]);
    const writes = h.writes.length;
    await rejects(writer.previewImportBackupRestore(entry.key), "CONFIGURATION_TRANSITION_PENDING");
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    assert.equal(saved, h.storage.local.values[entry.key]);
    assert.equal(writes, h.writes.length);
  });

  should("相同指针标识对应的本地资源已变化时，预览标记指针差异", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    h.storage.local.values[id] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor.localAssetId = id;
    const current = await writer.commit({ toolbox });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 84 },
      baseline: { keyboard: current.keyboard },
    });
    const [entry] = await writer.listImportBackups();
    h.storage.local.values[id] = "data:image/png;base64,bm90LWEtcG5n";
    const writes = h.writes.length;
    const preview = await writer.previewImportBackupRestore(entry.key);
    assert.isTrue(preview.cursorChanged);
    assert.equal("header-valid", preview.cursorStatus);
    assert.equal(writes, h.writes.length);
  });

  should("导出包含旧格式无法表达字段的本机备份时保留原值并返回兼容提示", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const rules = [{ pattern: "https://example.invalid/*", passKeys: "", enabled: false }];
    const before = await writer.commit({ legacyPatch: { exclusionRules: rules } });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 84 },
      baseline: { keyboard: before.keyboard },
    });
    const [entry] = await writer.listImportBackups();
    const exported = await writer.exportImportBackup(entry.key);
    assert.equal(rules, exported.snapshot.keyboard.exclusionRules);
    assert.equal(["keyboard.exclusionRules[0].enabled"], exported.legacyLimitations);
    assert.isFalse(exported.legacyLimitationsTruncated);
  });

  should("缺失的本地指针资源在导入备份中显式标记，不伪造默认资源", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor.localAssetId = "browserToolboxCursor-12345678";
    const current = await writer.commit({ toolbox });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 82 },
      baseline: { keyboard: current.keyboard },
    });
    const key = Object.keys(h.storage.local.values).find((name) =>
      name.startsWith(config.IMPORT_BACKUP_PREFIX)
    );
    const backup = await h.create().readImportBackup(key);
    assert.equal({ id: toolbox.cursor.localAssetId, present: false }, backup.cursorAsset);
    assert.isTrue((await h.create().listImportBackups())[0].cursorAssetMissing);
  });

  should("损坏的本地指针图片仍原样保留，并在备份列表标记无法使用", async () => {
    const h = harness();
    const writer = h.create();
    const initial = await writer.read();
    const id = "browserToolboxCursor-12345678";
    const asset = "data:image/png;base64,bm90LWEtcG5n";
    h.storage.local.values[id] = asset;
    const toolbox = clone(initial.toolboxSource.value);
    toolbox.cursor.localAssetId = id;
    const current = await writer.commit({ toolbox });
    await writer.importConfiguration({
      legacyPatch: { scrollStepSize: 82 },
      baseline: { keyboard: current.keyboard },
    });
    const [entry] = await h.create().listImportBackups();
    assert.equal("valid", entry.status);
    assert.isTrue(entry.cursorAssetInvalid);
    assert.equal(asset, (await h.create().readImportBackup(entry.key)).cursorAsset.value);
  });

  should("导入备份期间旧来源变化时停止提交并保留备份及外部值", async () => {
    const h = harness();
    const writer = h.create();
    const before = await writer.read();
    let changed = false;
    h.controls.fail = (area, method, input) => {
      if (
        !changed && area === "local" && method === "set" &&
        Object.keys(input).some((key) => key.startsWith(config.IMPORT_BACKUP_PREFIX))
      ) {
        changed = true;
        h.storage.sync.values.scrollStepSize = 88;
      }
      return false;
    };
    await rejects(
      writer.importConfiguration({
        legacyPatch: { scrollStepSize: 95 },
        baseline: { keyboard: before.keyboard },
      }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.isTrue(changed);
    assert.equal(88, h.storage.sync.values.scrollStepSize);
    assert.isTrue(
      Object.keys(h.storage.local.values).some((key) =>
        key.startsWith(config.IMPORT_BACKUP_PREFIX)
      ),
    );
  });

  should("导入备份计入普通提交的保留配额，不能删除备份腾空间", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const key = `${config.IMPORT_BACKUP_PREFIX}synthetic`;
    h.storage.local.values[key] = "x".repeat(config.MAX_BACKUP_BYTES);
    const sync = clone(h.storage.sync.values);
    await rejects(
      writer.commit({ legacyPatch: { scrollStepSize: 80 } }),
      "CONFIGURATION_BACKUP_QUOTA",
    );
    assert.equal(sync, h.storage.sync.values);
    assert.equal(config.MAX_BACKUP_BYTES, h.storage.local.values[key].length);
  });

  should("导入备份也计入回退备份和事务归档的保留配额", async () => {
    {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const key = `${config.IMPORT_BACKUP_PREFIX}synthetic`;
      h.storage.local.values[key] = "x".repeat(config.MAX_BACKUP_BYTES);
      const before = h.writes.length;
      await rejects(writer.createLegacyRollbackBackup(), "CONFIGURATION_BACKUP_QUOTA");
      assert.equal(before, h.writes.length);
      assert.equal(config.MAX_BACKUP_BYTES, h.storage.local.values[key].length);
    }
    {
      const { h, writer, transaction } = await rollbackFixture();
      await transaction.execute(await transaction.preview());
      const key = `${config.IMPORT_BACKUP_PREFIX}synthetic`;
      h.storage.local.values[key] = "x".repeat(config.MAX_BACKUP_BYTES);
      const before = h.writes.length;
      const archive = new TransitionArchive({ writer, authorize: () => true });
      await rejects(archive.archive("legacy-rollback"), "CONFIGURATION_BACKUP_QUOTA");
      assert.equal(before, h.writes.length);
      assert.equal(config.MAX_BACKUP_BYTES, h.storage.local.values[key].length);
    }
  });

  should("逐字段旧来源优先且空值有效，迁移备份不包含会话/Mark/未知 sync 数据", async () => {
    const h = harness({
      sync: { keyMappings: "", searchEngines: "", exclusionRules: [], unknownSecret: "仅合成哨兵" },
      local: { "vimiumGlobalMark|X": "仅合成标记" },
      session: { vimiumSecret: "仅合成令牌" },
    });
    const result = await h.create().read();
    assert.equal("", result.keyboard.keyMappings);
    assert.equal("", result.keyboard.searchEngines);
    assert.equal([], result.keyboard.exclusionRules);
    assert.equal(1, result.revision);
    const backup = JSON.stringify(h.storage.local.values[config.KEYS.backup]);
    assert.isFalse(
      backup.includes("仅合成哨兵") || backup.includes("仅合成标记") ||
        backup.includes("仅合成令牌"),
    );
    assert.equal("仅合成哨兵", h.storage.sync.values.unknownSecret);
    assert.equal(9, h.storage.sync.values.browserToolboxSettings.schemaVersion);
  });

  should("只读预演从最新已提交配置反向投影，保留显式空值与关闭项", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const writer = h.create();
    await writer.read();
    const saved = await writer.commit({
      legacyPatch: { keyMappings: "", searchEngines: "", exclusionRules: [], smoothScroll: false },
    });
    const beforeLocal = clone(h.storage.local.values);
    const beforeSync = clone(h.storage.sync.values);
    const writesBefore = h.writes.length;
    const plan = await writer.prepareLegacyRollback();

    assert.equal(saved.revision, plan.revision);
    assert.equal("", plan.target.keyMappings);
    assert.equal("", plan.target.searchEngines);
    assert.equal([], plan.target.exclusionRules);
    assert.equal(false, plan.target.smoothScroll);
    assert.equal("2.4.2", plan.target.settingsVersion);
    assert.isTrue(plan.remove.includes("scrollStepSize"));
    assert.equal(writesBefore, h.writes.length);
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(beforeSync, h.storage.sync.values);
    plan.target.exclusionRules.push({ pattern: "synthetic", passKeys: "" });
    assert.equal([], (await writer.read()).keyboard.exclusionRules);
  });

  should("反向投影遇到未知或缺失字段时拒绝静默丢失", () => {
    const keyboard = clone(Settings.defaultOptions);
    keyboard.futureField = "synthetic";
    let failure;
    try {
      config.planLegacyKeyboardProjection(keyboard, Settings.defaultOptions);
    } catch (caught) {
      failure = caught;
    }
    assert.equal("UNSUPPORTED_CONFIGURATION_FIELDS", failure?.code);
    assert.equal(["futureField"], failure?.conflicts);
    delete keyboard.futureField;
    delete keyboard.keyMappings;
    try {
      config.planLegacyKeyboardProjection(keyboard, Settings.defaultOptions);
      failure = null;
    } catch (caught) {
      failure = caught;
    }
    assert.equal("INVALID_KEYBOARD_CONFIGURATION", failure?.code);
  });

  should("旧规则无法表达的内层字段保留在回退备份中并阻止静默回写", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const rules = [{
      pattern: "https?://example.invalid/*",
      passKeys: "",
      enabled: false,
      futurePolicy: "synthetic-private-value",
    }];
    const saved = await writer.commit({ legacyPatch: { exclusionRules: rules } });
    const sync = clone(h.storage.sync.values);
    const failure = await rejects(
      writer.prepareLegacyRollback(),
      "UNSUPPORTED_CONFIGURATION_FIELDS",
    );
    assert.equal([
      "keyboard.exclusionRules[0].enabled",
      "keyboard.exclusionRules[0].futurePolicy",
    ], failure.conflicts);
    assert.isFalse(JSON.stringify(failure.conflicts).includes("synthetic-private-value"));
    assert.equal(sync, h.storage.sync.values);
    const { key } = await writer.createLegacyRollbackBackup();
    const backup = await writer.inspectLegacyRollbackBackup(h.storage.local.values[key]);
    assert.equal(saved.revision, backup.revision);
    assert.equal(rules, backup.snapshot.keyboard.exclusionRules);
    assert.equal(sync, h.storage.sync.values);
  });

  should("反向投影拒绝未完成事务、受损分片和不匹配的提交索引", async () => {
    for (const scenario of ["pending", "missing", "index"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const state = h.storage.local.values[config.KEYS.state];
      const index = h.storage.local.values[config.KEYS.index];
      if (scenario === "pending") state.phase = "APPLYING";
      if (scenario === "missing") delete h.storage.local.values[index.fields.keyMappings.chunks[0]];
      if (scenario === "index") index.operationId = "external";
      const before = h.writes.length;
      await rejects(writer.prepareLegacyRollback());
      assert.equal(before, h.writes.length);
    }
  });

  should("反向投影期间提交代次发生变化时拒绝使用旧计划", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const get = h.storage.local.get;
    let reads = 0;
    h.storage.local.get = async (keys) => {
      if (
        Array.isArray(keys) && keys.includes(config.KEYS.state) && keys.includes(config.KEYS.index)
      ) {
        reads++;
        if (reads === 2) h.storage.local.values[config.KEYS.index].operationId = "external";
      }
      return await get(keys);
    };
    const before = h.writes.length;
    await rejects(writer.prepareLegacyRollback(), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal(before, h.writes.length);
  });

  should("只读准备独立键盘同步代次，保持旧键和工具箱同步开关语义", async () => {
    const local = clone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS);
    local.general.browserSyncEnabled = false;
    const h = harness({
      local: { browserToolboxSettings: local },
      sync: { unrelated: "仅合成数据", keyMappings: "map a scrollDown" },
    });
    const writer = h.create();
    await writer.read();
    const css = "/*" + "中".repeat(2400) + "*/";
    const current = await writer.commit({
      legacyPatch: {
        keyMappings: "",
        exclusionRules: [],
        smoothScroll: false,
        userDefinedLinkHintCss: css,
      },
    });
    const beforeSync = clone(h.storage.sync.values);
    const beforeLocal = clone(h.storage.local.values);
    const writesBefore = h.writes.length;
    const plan = await writer.prepareKeyboardSyncMigration();
    const staged = {
      get: (keys) =>
        Promise.resolve(Object.fromEntries(keys.map((key) => [key, plan.chunks[key]]))),
    };
    const keyboard = await config.readGeneration(plan.index, staged);

    assert.equal(current.revision, plan.revision);
    assert.equal("", keyboard.keyMappings);
    assert.equal([], keyboard.exclusionRules);
    assert.equal(false, keyboard.smoothScroll);
    assert.equal(css, keyboard.userDefinedLinkHintCss);
    assert.isFalse(Object.hasOwn(keyboard, "toolbox"));
    assert.isTrue(plan.index.fields.userDefinedLinkHintCss.chunks.length > 1);
    assert.isTrue(
      Object.entries(plan.chunks).every(([key, value]) => config.itemBytes(key, value) <= 7 * 1024),
    );
    assert.isTrue(config.itemBytes(config.KEYS.index, plan.index) <= 7 * 1024);
    assert.equal("local", current.toolboxSource.area);
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(writesBefore, h.writes.length);
  });

  should("同步迁移预演在单项、总额、项目数和写频率不足时不写任何存储", async () => {
    for (const scenario of ["item", "total", "items", "frequency"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      if (scenario === "item") h.storage.sync.QUOTA_BYTES_PER_ITEM = 300;
      if (scenario === "total") h.storage.sync.QUOTA_BYTES = 100;
      if (scenario === "items") h.storage.sync.MAX_ITEMS = 1;
      if (scenario === "frequency") h.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE = 1;
      const beforeSync = clone(h.storage.sync.values);
      const beforeLocal = clone(h.storage.local.values);
      const writesBefore = h.writes.length;
      await rejects(writer.prepareKeyboardSyncMigration());
      assert.equal(writesBefore, h.writes.length);
      assert.equal(beforeSync, h.storage.sync.values);
      assert.equal(beforeLocal, h.storage.local.values);
    }
  });

  should("同步迁移预演拒绝远端已有索引以及预演期间的外部修改", async () => {
    for (const scenario of ["existing", "race"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      if (scenario === "existing") h.storage.sync.values[config.KEYS.index] = { formatVersion: 99 };
      if (scenario === "race") {
        const get = h.storage.sync.get;
        let reads = 0;
        h.storage.sync.get = async (keys) => {
          if (keys === null && ++reads === 2) h.storage.sync.values.external = "合成并发变化";
          return await get(keys);
        };
      }
      const writesBefore = h.writes.length;
      await rejects(writer.prepareKeyboardSyncMigration(), "CONFIGURATION_EXTERNAL_CONFLICT");
      assert.equal(writesBefore, h.writes.length);
      if (scenario === "existing") {
        assert.equal(99, h.storage.sync.values[config.KEYS.index].formatVersion);
      }
    }
  });

  should("只读检查远端键盘代次，完整后才返回且不改变本机权威", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const writer = h.create();
    const original = await writer.read();
    const plan = await writer.prepareKeyboardSyncMigration();
    Object.assign(h.storage.sync.values, clone(plan.chunks), {
      [config.KEYS.index]: clone(plan.index),
    });
    const before = h.writes.length;
    const candidate = await writer.inspectKeyboardSyncGeneration();
    assert.equal(original.keyboard.keyMappings, candidate.keyboard.keyMappings);
    assert.equal(original.revision, candidate.revision);
    candidate.keyboard.keyMappings = "仅调用方修改";
    assert.equal(original.keyboard.keyMappings, (await writer.read()).keyboard.keyMappings);
    assert.equal(before, h.writes.length);
  });

  should("只读检查拒绝缺片、损坏、未知格式和读取期间索引变化", async () => {
    for (const scenario of ["missing", "corrupt", "kind", "digest", "race"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const plan = await writer.prepareKeyboardSyncMigration();
      Object.assign(h.storage.sync.values, clone(plan.chunks), {
        [config.KEYS.index]: clone(plan.index),
      });
      const name = plan.index.fields.keyMappings.chunks[0];
      if (scenario === "missing") delete h.storage.sync.values[name];
      if (scenario === "corrupt") h.storage.sync.values[name].text += "x";
      if (scenario === "kind") h.storage.sync.values[config.KEYS.index].kind = "unknown";
      if (scenario === "digest") h.storage.sync.values[config.KEYS.index].sourceDigest = "wrong";
      if (scenario === "race") {
        const get = h.storage.sync.get;
        let indexReads = 0;
        h.storage.sync.get = async (keys) => {
          if (keys === config.KEYS.index && ++indexReads === 2) {
            h.storage.sync.values[config.KEYS.index].operationId = "external";
          }
          return await get(keys);
        };
      }
      const before = h.writes.length;
      await rejects(writer.inspectKeyboardSyncGeneration());
      assert.equal(before, h.writes.length);
    }
  });

  should("共同基线声明一致时只读预演跨设备不同字段合并，不依赖 revision 排序", async () => {
    const h = harness();
    const writer = h.create();
    const original = await writer.read();
    const baseline = clone(original.keyboard);
    delete baseline.settingsVersion;
    await writer.commit({ legacyPatch: { keyMappings: "", exclusionRules: [] } });
    const incoming = {
      ...clone(baseline),
      searchEngines: "s: https://example.invalid/?q=%s",
      smoothScroll: false,
    };
    await installSyntheticKeyboardGeneration(h, incoming, 999);
    const baseDigest = await config.digest(baseline);
    const beforeLocal = clone(h.storage.local.values);
    const beforeSync = clone(h.storage.sync.values);
    const writesBefore = h.writes.length;
    const plan = await writer.prepareKeyboardSyncReconciliation({
      baseline,
      localBaseDigest: baseDigest,
      incomingBaseDigest: baseDigest,
    });
    assert.equal("candidate", plan.status);
    assert.isFalse(plan.lineageVerified);
    assert.equal("", plan.candidate.keyMappings);
    assert.equal([], plan.candidate.exclusionRules);
    assert.equal(incoming.searchEngines, plan.candidate.searchEngines);
    assert.equal(false, plan.candidate.smoothScroll);
    assert.equal(999, plan.incomingRevision);
    assert.equal(await config.digest(plan.candidate), plan.candidateDigest);
    plan.candidate.exclusionRules.push({ pattern: "synthetic", passKeys: "" });
    assert.equal([], (await writer.read()).keyboard.exclusionRules);
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(writesBefore, h.writes.length);
  });

  should("跨设备同字段冲突保留双方，必须逐项明确选择才能产生只读候选", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = clone((await writer.read()).keyboard);
    delete baseline.settingsVersion;
    await writer.commit({ legacyPatch: { keyMappings: "map a scrollDown", hideHud: true } });
    const incoming = { ...clone(baseline), keyMappings: "map b scrollUp", smoothScroll: false };
    await installSyntheticKeyboardGeneration(h, incoming);
    const baseDigest = await config.digest(baseline);
    const input = { baseline, localBaseDigest: baseDigest, incomingBaseDigest: baseDigest };
    const writesBefore = h.writes.length;
    const conflict = await writer.prepareKeyboardSyncReconciliation(input);
    assert.equal("conflict", conflict.status);
    assert.equal(["keyboard.keyMappings"], conflict.conflicts);
    assert.isFalse(Object.hasOwn(conflict, "candidate"));
    assert.equal("map a scrollDown", conflict.sides.local.keyMappings);
    assert.equal("map b scrollUp", conflict.sides.incoming.keyMappings);
    const resolved = await writer.prepareKeyboardSyncReconciliation({
      ...input,
      choices: { "keyboard.keyMappings": "incoming" },
    });
    assert.equal("candidate", resolved.status);
    assert.equal("map b scrollUp", resolved.candidate.keyMappings);
    assert.equal(true, resolved.candidate.hideHud);
    assert.equal(false, resolved.candidate.smoothScroll);
    await rejects(
      writer.prepareKeyboardSyncReconciliation({ ...input, choices: {} }),
      "INVALID_CONFIGURATION_CHOICE",
    );
    await rejects(
      writer.prepareKeyboardSyncReconciliation({
        ...input,
        choices: { "keyboard.keyMappings": "incoming", "keyboard.hideHud": "local" },
      }),
      "INVALID_CONFIGURATION_CHOICE",
    );
    assert.equal(writesBefore, h.writes.length);
  });

  should("跨设备预演在入队时复制基线和冲突选择，调用方后续修改不能改变结果", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = clone((await writer.read()).keyboard);
    delete baseline.settingsVersion;
    await writer.commit({ legacyPatch: { keyMappings: "map a scrollDown" } });
    await installSyntheticKeyboardGeneration(h, {
      ...clone(baseline),
      keyMappings: "map b scrollUp",
    });
    const baseDigest = await config.digest(baseline);
    const choices = { "keyboard.keyMappings": "incoming" };
    const pending = writer.prepareKeyboardSyncReconciliation({
      baseline,
      localBaseDigest: baseDigest,
      incomingBaseDigest: baseDigest,
      choices,
    });
    baseline.keyMappings = "被调用方改变";
    choices["keyboard.keyMappings"] = "local";
    const result = await pending;
    assert.equal("candidate", result.status);
    assert.equal("map b scrollUp", result.candidate.keyMappings);
  });

  should("共同基线缺失或声明不一致时保留双方，不能生成或选择合并候选", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = clone((await writer.read()).keyboard);
    delete baseline.settingsVersion;
    await writer.commit({ legacyPatch: { keyMappings: "map a scrollDown" } });
    const incoming = { ...clone(baseline), keyMappings: "map b scrollUp" };
    await installSyntheticKeyboardGeneration(h, incoming);
    const baseDigest = await config.digest(baseline);
    const before = h.writes.length;
    for (
      const input of [
        {},
        { baseline, localBaseDigest: baseDigest },
        { baseline, localBaseDigest: baseDigest, incomingBaseDigest: "0".repeat(64) },
      ]
    ) {
      const plan = await writer.prepareKeyboardSyncReconciliation(input);
      assert.equal("unproven", plan.status);
      assert.isFalse(Object.hasOwn(plan, "candidate"));
      assert.equal("map a scrollDown", plan.sides.local.keyMappings);
      assert.equal("map b scrollUp", plan.sides.incoming.keyMappings);
      await rejects(
        writer.prepareKeyboardSyncReconciliation({
          ...input,
          choices: { "keyboard.keyMappings": "incoming" },
        }),
        "CONFIGURATION_BASELINE_UNPROVEN",
      );
    }
    assert.equal(before, h.writes.length);
  });

  should("跨设备预演拒绝未知基线字段、损坏远端分片及期间的数据变化", async () => {
    for (const scenario of ["future", "missing", "sync-race", "local-race"]) {
      const h = harness();
      const writer = h.create();
      const baseline = clone((await writer.read()).keyboard);
      delete baseline.settingsVersion;
      const remote = await installSyntheticKeyboardGeneration(h, baseline);
      const baseDigest = await config.digest(baseline);
      if (scenario === "future") baseline.futureField = "synthetic";
      if (scenario === "missing") {
        delete h.storage.sync.values[remote.index.fields.keyMappings.chunks[0]];
      }
      if (scenario === "sync-race") {
        const get = h.storage.sync.get;
        let reads = 0;
        h.storage.sync.get = async (keys) => {
          if (keys === null && ++reads === 2) h.storage.sync.values.external = "synthetic";
          return await get(keys);
        };
      }
      if (scenario === "local-race") {
        const get = h.storage.local.get;
        let reads = 0;
        h.storage.local.get = async (keys) => {
          if (
            Array.isArray(keys) && keys.includes(config.KEYS.state) &&
            keys.includes(config.KEYS.index) && ++reads === 2
          ) {
            h.storage.local.values[config.KEYS.index].operationId = "external";
          }
          return await get(keys);
        };
      }
      const before = h.writes.length;
      await rejects(writer.prepareKeyboardSyncReconciliation({
        baseline,
        localBaseDigest: baseDigest,
        incomingBaseDigest: baseDigest,
      }));
      assert.equal(before, h.writes.length);
    }
  });

  should("回退备份只读预演保存当前已提交配置并核算本机容量", async () => {
    const h = harness({
      session: { vimiumSecret: "仅合成令牌" },
      local: { "vimiumGlobalMark|X": "合成标记" },
    });
    const writer = h.create();
    await writer.read();
    const current = await writer.commit({ legacyPatch: { keyMappings: "", smoothScroll: false } });
    const beforeLocal = clone(h.storage.local.values);
    const beforeSync = clone(h.storage.sync.values);
    const writesBefore = h.writes.length;
    const plan = await writer.prepareLegacyRollbackBackup();
    assert.isTrue(plan.key.startsWith(config.ROLLBACK_BACKUP_PREFIX));
    assert.equal(current.revision, plan.backup.snapshot.revision);
    assert.equal("", plan.backup.snapshot.keyboard.keyMappings);
    assert.equal(false, plan.backup.snapshot.keyboard.smoothScroll);
    assert.equal(
      plan.backup.sourceDigest,
      await config.digest({
        keyboard: plan.backup.snapshot.keyboard,
        toolbox: plan.backup.snapshot.toolbox,
        area: plan.backup.snapshot.area,
      }),
    );
    assert.isFalse(JSON.stringify(plan.backup).includes("仅合成令牌"));
    assert.isFalse(JSON.stringify(plan.backup).includes("合成标记"));
    assert.equal(config.itemBytes(plan.key, plan.backup), plan.capacity.backupBytes);
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(writesBefore, h.writes.length);
  });

  should("回退备份可只读核验完整快照，损坏或未知格式一律拒绝", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await writer.commit({ legacyPatch: { keyMappings: "map a scrollDown" } });
    const { backup } = await writer.prepareLegacyRollbackBackup();
    const writesBefore = h.writes.length;
    const checked = await writer.inspectLegacyRollbackBackup(backup);
    assert.equal("map a scrollDown", checked.snapshot.keyboard.keyMappings);
    checked.snapshot.keyboard.keyMappings = "调用方修改";
    assert.equal("map a scrollDown", backup.snapshot.keyboard.keyMappings);
    for (const scenario of ["content", "revision", "digest", "format", "unknown"]) {
      const damaged = clone(backup);
      if (scenario === "content") damaged.snapshot.keyboard.keyMappings = "损坏";
      if (scenario === "revision") damaged.snapshot.revision++;
      if (scenario === "digest") damaged.sourceDigest = "0".repeat(64);
      if (scenario === "format") damaged.formatVersion++;
      if (scenario === "unknown") damaged.futureField = "保留";
      await rejects(writer.inspectLegacyRollbackBackup(damaged));
    }
    const wrongSource = clone(backup);
    wrongSource.sourceDigest = "0".repeat(64);
    const { backupDigest: _oldDigest, ...body } = wrongSource;
    wrongSource.backupDigest = await config.digest(body);
    await rejects(writer.inspectLegacyRollbackBackup(wrongSource), "CONFIGURATION_DIGEST_MISMATCH");
    const wrongArea = clone(backup);
    wrongArea.snapshot.area = wrongArea.snapshot.area === "sync" ? "local" : "sync";
    wrongArea.sourceDigest = await config.digest({
      keyboard: wrongArea.snapshot.keyboard,
      toolbox: wrongArea.snapshot.toolbox,
      area: wrongArea.snapshot.area,
    });
    const { backupDigest: _previousDigest, ...wrongAreaBody } = wrongArea;
    wrongArea.backupDigest = await config.digest(wrongAreaBody);
    await rejects(writer.inspectLegacyRollbackBackup(wrongArea), "INVALID_CONFIGURATION");
    assert.equal(writesBefore, h.writes.length);
  });

  should("回退备份预演拒绝本机总额和已保留备份超限，不删除旧数据", async () => {
    for (const scenario of ["local", "owned"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      if (scenario === "local") {
        h.storage.local.QUOTA_BYTES = await h.storage.local.getBytesInUse(null) + 1;
      }
      if (scenario === "owned") {
        h.storage.local.values[`${config.ROLLBACK_BACKUP_PREFIX}old`] = "x".repeat(
          config.MAX_BACKUP_BYTES,
        );
      }
      const beforeLocal = clone(h.storage.local.values);
      const writesBefore = h.writes.length;
      await rejects(
        writer.prepareLegacyRollbackBackup(),
        scenario === "local" ? "CONFIGURATION_LOCAL_QUOTA" : "CONFIGURATION_BACKUP_QUOTA",
      );
      assert.equal(beforeLocal, h.storage.local.values);
      assert.equal(writesBefore, h.writes.length);
    }
  });

  should("回退备份预演遇到并发变化或读取失败时不写入任何备份", async () => {
    for (const scenario of ["local-race", "sync-race", "read-failure"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      if (scenario === "local-race") {
        const get = h.storage.local.get;
        let reads = 0;
        h.storage.local.get = async (keys) => {
          if (keys === null && ++reads === 2) h.storage.local.values.unrelated = "synthetic";
          return await get(keys);
        };
      }
      if (scenario === "sync-race") {
        const get = h.storage.sync.get;
        let reads = 0;
        h.storage.sync.get = async (keys) => {
          if (keys === null && ++reads === 2) h.storage.sync.values.keyMappings = "external";
          return await get(keys);
        };
      }
      if (scenario === "read-failure") {
        h.controls.fail = (area, method, keys) =>
          area === "local" && method === "get" && keys === null;
      }
      const before = h.writes.length;
      await rejects(writer.prepareLegacyRollbackBackup());
      assert.equal(before, h.writes.length);
    }
  });

  should("独立回退备份先保存最新提交并读回，不改动原基线、状态或兼容同步", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const current = await writer.commit({ legacyPatch: { keyMappings: "map x scrollUp" } });
    const oldBackup = clone(h.storage.local.values[config.KEYS.backup]);
    const oldState = clone(h.storage.local.values[config.KEYS.state]);
    const oldSync = clone(h.storage.sync.values);
    const count = h.writes.length;
    const saved = await writer.createLegacyRollbackBackup();
    const stored = h.storage.local.values[saved.key];
    assert.equal(current.revision, saved.revision);
    assert.equal(
      "map x scrollUp",
      (await writer.inspectLegacyRollbackBackup(stored)).snapshot.keyboard.keyMappings,
    );
    assert.equal(oldBackup, h.storage.local.values[config.KEYS.backup]);
    assert.equal(oldState, h.storage.local.values[config.KEYS.state]);
    assert.equal(oldSync, h.storage.sync.values);
    assert.equal(count + 1, h.writes.length);
    const next = await writer.createLegacyRollbackBackup();
    assert.isTrue(next.key !== saved.key);
    assert.equal(stored, h.storage.local.values[saved.key]);
  });

  should("回退备份写入失败或读回失败均不改动兼容配置，已写入备份保留现场", async () => {
    for (const scenario of ["write-failure", "read-failure", "readback-corrupt", "source-race"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const stateBefore = clone(h.storage.local.values[config.KEYS.state]);
      const syncBefore = clone(h.storage.sync.values);
      if (scenario === "write-failure") {
        h.controls.fail = (area, method, items) =>
          area === "local" && method === "set" &&
          Object.keys(items).some((key) => key.startsWith(config.ROLLBACK_BACKUP_PREFIX));
      }
      if (scenario === "read-failure") {
        let reads = 0;
        h.controls.fail = (area, method, keys) =>
          area === "local" && method === "get" &&
          typeof keys === "string" && keys.startsWith(config.ROLLBACK_BACKUP_PREFIX) &&
          ++reads === 2;
      }
      if (scenario === "readback-corrupt" || scenario === "source-race") {
        const set = h.storage.local.set;
        h.storage.local.set = async (items) => {
          await set(items);
          const key = Object.keys(items).find((name) =>
            name.startsWith(config.ROLLBACK_BACKUP_PREFIX)
          );
          if (key && scenario === "readback-corrupt") {
            h.storage.local.values[key].snapshot.keyboard.keyMappings = "损坏";
          }
          if (key && scenario === "source-race") h.storage.sync.values.keyMappings = "外部合成变化";
        };
      }
      await rejects(writer.createLegacyRollbackBackup());
      const keys = Object.keys(h.storage.local.values).filter((key) =>
        key.startsWith(config.ROLLBACK_BACKUP_PREFIX)
      );
      assert.equal(scenario === "write-failure" ? 0 : 1, keys.length);
      assert.equal(stateBefore, h.storage.local.values[config.KEYS.state]);
      if (scenario === "source-race") {
        assert.equal("外部合成变化", h.storage.sync.values.keyMappings);
      } else assert.equal(syncBefore, h.storage.sync.values);
    }
  });

  should("写回退备份前再次核对来源，发生变化时不得落盘", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const get = h.storage.sync.get;
    let reads = 0;
    h.storage.sync.get = async (keys) => {
      if (keys === null && ++reads === 3) h.storage.sync.values.keyMappings = "外部合成变化";
      return await get(keys);
    };
    await rejects(writer.createLegacyRollbackBackup(), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.isFalse(
      Object.keys(h.storage.local.values).some((key) =>
        key.startsWith(config.ROLLBACK_BACKUP_PREFIX)
      ),
    );
    assert.equal("外部合成变化", h.storage.sync.values.keyMappings);
  });

  should("后续兼容提交计入保留的回退备份，超限时不能删除备份或写入设置", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const key = `${config.ROLLBACK_BACKUP_PREFIX}synthetic`;
    h.storage.local.values[key] = "x".repeat(config.MAX_BACKUP_BYTES);
    const beforeSync = clone(h.storage.sync.values);
    const beforeState = clone(h.storage.local.values[config.KEYS.state]);
    const beforeWrites = h.writes.length;
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map x scrollUp" } }),
      "CONFIGURATION_BACKUP_QUOTA",
    );
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeState, h.storage.local.values[config.KEYS.state]);
    assert.equal(config.MAX_BACKUP_BYTES, h.storage.local.values[key].length);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("隔离回退事务未获授权时不创建备份或写入任何存储", async () => {
    const { h, writer } = await rollbackFixture();
    const transaction = new LegacyRollbackTransaction({ writer, authorize: () => false });
    const plan = await transaction.preview();
    const before = h.writes.length;
    await rejects(transaction.execute(plan), "CONFIGURATION_ROLLBACK_NOT_ENABLED");
    assert.equal(before, h.writes.length);
    assert.isFalse(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("终态归档先验证备份并保留原记录，隔离确认不能自行解除写保护", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const journal = clone(h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    const beforeSync = clone(h.storage.sync.values);
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const archived = await manager.archive("legacy-rollback");
    const listed = await manager.listArchives();
    assert.equal("valid", listed.find((item) => item.key === archived.key).status);
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    assert.equal(beforeSync, h.storage.sync.values);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
    assert.isFalse(JSON.stringify(listed).includes("example.invalid"));
    assert.isTrue((await manager.previewRelease("legacy-rollback")).ready);
    const review = await manager.recordReview("legacy-rollback", archived.key);
    assert.isTrue((await manager.inspectReview("legacy-rollback", review.key)).ready);
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } }),
      "CONFIGURATION_TRANSITION_PENDING",
    );
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
  });

  should("终态归档未经授权不写入，中断重启后复用已验证归档", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const denied = new TransitionArchive({ writer, authorize: () => false });
    const before = h.writes.length;
    await rejects(denied.archive("legacy-rollback"), "CONFIGURATION_ARCHIVE_NOT_ENABLED");
    assert.equal(before, h.writes.length);
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const manager = new TransitionArchive({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "archive") throw stop;
      },
    });
    await rejects(manager.archive("legacy-rollback"));
    const restart = new TransitionArchive({ writer: h.create(), authorize: () => true });
    const first = await restart.listArchives();
    assert.equal(1, first.length);
    const archived = await restart.archive("legacy-rollback");
    assert.equal(first[0].key, archived.key);
    assert.equal(1, (await restart.listArchives()).length);
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("冲突终态可留档但不能登记解锁候选", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map external scrollUp";
      },
    });
    assert.equal("ABORTED", (await transaction.execute(await transaction.preview())).phase);
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const saved = await manager.archive("legacy-rollback");
    const preview = await manager.previewRelease("legacy-rollback");
    assert.isFalse(preview.ready);
    assert.equal("CONFIGURATION_CONFLICT_UNRESOLVED", preview.reason);
    await rejects(
      manager.recordReview("legacy-rollback", saved.key),
      "CONFIGURATION_CONFLICT_UNRESOLVED",
    );
    assert.equal("map external scrollUp", h.storage.sync.values.keyMappings);
  });

  should("归档或确认后来源变化必须重新拒绝，不能把旧确认当作释放依据", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const archived = await manager.archive("legacy-rollback");
    const review = await manager.recordReview("legacy-rollback", archived.key);
    h.storage.sync.values.searchEngines = "s: https://example.invalid/external?q=%s";
    const result = await manager.inspectReview("legacy-rollback", review.key);
    assert.isFalse(result.ready);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.reason);
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("同步发布归档须确认索引和分片，缺失或外部覆盖后不允许登记解锁候选", async () => {
    const { h, writer, publisher } = await publishFixture();
    const plan = await publisher.preview();
    assert.equal("COMMITTED", (await publisher.execute(plan)).phase);
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const archived = await manager.archive("keyboard-sync-publish");
    assert.isTrue((await manager.previewRelease("keyboard-sync-publish")).ready);
    delete h.storage.sync.values[plan.index.fields.keyMappings.chunks[0]];
    const result = await manager.previewRelease("keyboard-sync-publish");
    assert.isFalse(result.ready);
    await rejects(manager.recordReview("keyboard-sync-publish", archived.key), result.reason);
    assert.equal(plan.index, h.storage.sync.values[config.KEYS.index]);
  });

  should("保留空间不足时不能写归档，保留记录与备份", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const journal = clone(h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    h.storage.local.values[`${config.TRANSITION_RECORD_PREFIX}synthetic`] = "x".repeat(
      config.MAX_BACKUP_BYTES,
    );
    const before = h.writes.length;
    const manager = new TransitionArchive({ writer, authorize: () => true });
    await rejects(manager.archive("legacy-rollback"), "CONFIGURATION_BACKUP_QUOTA");
    assert.equal(before, h.writes.length);
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
  });

  should("归档读回后被改写时不能报告成功，原事务与备份仍保留", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const journal = clone(h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    const manager = new TransitionArchive({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "archive") {
          const key = Object.keys(h.storage.local.values).find((name) =>
            name.startsWith(`${config.TRANSITION_RECORD_PREFIX}archive:`)
          );
          h.storage.local.values[key].journal.code = "tampered";
        }
      },
    });
    await rejects(manager.archive("legacy-rollback"), "CONFIGURATION_READBACK_FAILED");
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
  });

  should("确认落盘后归档被改写时不能报告候选可用", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const preparation = new TransitionArchive({ writer, authorize: () => true });
    const archiveKey = (await preparation.archive("legacy-rollback")).key;
    const manager = new TransitionArchive({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "review") h.storage.local.values[archiveKey].journal.code = "tampered";
      },
    });
    await rejects(
      manager.recordReview("legacy-rollback", archiveKey),
      "CONFIGURATION_READBACK_FAILED",
    );
    const reviewKey = Object.keys(h.storage.local.values).find((name) =>
      name.startsWith(`${config.TRANSITION_RECORD_PREFIX}review:`)
    );
    assert.isFalse((await manager.inspectReview("legacy-rollback", reviewKey)).ready);
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("完整补偿和撤销后可生成候选，原事务记录依然保留", async () => {
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    for (const kind of ["legacy-rollback", "keyboard-sync-publish"]) {
      const fixture = kind === "legacy-rollback"
        ? await rollbackFixture({
          afterStep: (step) => {
            if (step === "sync") throw stop;
          },
        })
        : await publishFixture({
          afterStep: (step) => {
            if (step === "index") throw stop;
          },
        });
      const action = kind === "legacy-rollback" ? fixture.transaction : fixture.publisher;
      await rejects(action.execute(await action.preview()));
      const restarted = kind === "legacy-rollback"
        ? new LegacyRollbackTransaction({ writer: fixture.writer, authorize: () => true })
        : new KeyboardSyncPublisher({ writer: fixture.writer, authorize: () => true });
      const result = kind === "legacy-rollback"
        ? await restarted.compensate()
        : await restarted.cancel();
      assert.equal("ABORTED", result.phase);
      const manager = new TransitionArchive({ writer: fixture.writer, authorize: () => true });
      const archived = await manager.archive(kind);
      assert.isTrue((await manager.previewRelease(kind)).ready);
      const review = await manager.recordReview(kind, archived.key);
      assert.isTrue((await manager.inspectReview(kind, review.key)).ready);
      const key = kind === "legacy-rollback" ? ROLLBACK_JOURNAL_KEY : SYNC_PUBLISH_JOURNAL_KEY;
      assert.isTrue(Object.hasOwn(fixture.h.storage.local.values, key));
    }
  });

  should("确认落盘后中断可复用；备份丢失后旧确认不能继续放行", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const manager = new TransitionArchive({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "review") throw stop;
      },
    });
    const archived = await manager.archive("legacy-rollback");
    await rejects(manager.recordReview("legacy-rollback", archived.key));
    const restarted = new TransitionArchive({ writer: h.create(), authorize: () => true });
    const review = await restarted.recordReview("legacy-rollback", archived.key);
    assert.isTrue(review.reused);
    assert.isTrue((await restarted.inspectReview("legacy-rollback", review.key)).ready);
    delete h.storage.local.values[h.storage.local.values[ROLLBACK_JOURNAL_KEY].backupKey];
    assert.isFalse((await restarted.inspectReview("legacy-rollback", review.key)).ready);
    assert.isTrue(Object.hasOwn(h.storage.local.values, archived.key));
  });

  should("保留的归档计入普通提交与新备份的 4 MiB 上限", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    h.storage.local.values[`${config.TRANSITION_RECORD_PREFIX}archive:synthetic`] = "x".repeat(
      config.MAX_BACKUP_BYTES,
    );
    const beforeSync = clone(h.storage.sync.values);
    const beforeWrites = h.writes.length;
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } }),
      "CONFIGURATION_BACKUP_QUOTA",
    );
    await rejects(writer.createLegacyRollbackBackup(), "CONFIGURATION_BACKUP_QUOTA");
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("未结束的事务不能归档，另一种事务出现后不能生成解锁候选", async () => {
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const pending = await rollbackFixture({
      afterStep: (step) => {
        if (step === "journal") throw stop;
      },
    });
    await rejects(pending.transaction.execute(await pending.transaction.preview()));
    const first = new TransitionArchive({ writer: pending.writer, authorize: () => true });
    const writes = pending.h.writes.length;
    await rejects(first.archive("legacy-rollback"), "CONFIGURATION_TRANSITION_IN_PROGRESS");
    assert.equal(writes, pending.h.writes.length);

    const complete = await rollbackFixture();
    await complete.transaction.execute(await complete.transaction.preview());
    const manager = new TransitionArchive({ writer: complete.writer, authorize: () => true });
    const archived = await manager.archive("legacy-rollback");
    complete.h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY] = { phase: "PREPARED" };
    const preview = await manager.previewRelease("legacy-rollback");
    assert.isFalse(preview.ready);
    assert.equal("CONFIGURATION_TRANSITION_PENDING", preview.reason);
    await rejects(manager.recordReview("legacy-rollback", archived.key), preview.reason);
    assert.isTrue(Object.hasOwn(complete.h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("确认记录超过保留配额时不生成新记录，也不移除已存档数据", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const archived = await manager.archive("legacy-rollback");
    h.storage.local.QUOTA_BYTES = await h.storage.local.getBytesInUse(null) + 1;
    const writes = h.writes.length;
    await rejects(
      manager.recordReview("legacy-rollback", archived.key),
      "CONFIGURATION_LOCAL_QUOTA",
    );
    assert.equal(writes, h.writes.length);
    assert.isTrue(Object.hasOwn(h.storage.local.values, archived.key));
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("回退冲突只返回字段状态，不暴露或覆盖外部设置正文", async () => {
    const secret = "map synthetic-private scrollUp";
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = secret;
      },
    });
    assert.equal("ABORTED", (await transaction.execute(await transaction.preview())).phase);
    const beforeSync = clone(h.storage.sync.values);
    const writes = h.writes.length;
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const result = await manager.inspectConflict("legacy-rollback");
    assert.equal("external", result.fields.keyMappings);
    assert.equal("after", result.fields.searchEngines);
    assert.isFalse(JSON.stringify(result).includes(secret));
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(writes, h.writes.length);
  });

  should("回退冲突读取中再次变化时不返回过期分类", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map external scrollUp";
      },
    });
    await transaction.execute(await transaction.preview());
    const original = h.storage.sync.get;
    let changed = false;
    h.storage.sync.get = async (keys) => {
      const values = await original.call(h.storage.sync, keys);
      if (!changed && Array.isArray(keys) && keys.includes("keyMappings")) {
        changed = true;
        h.storage.sync.values.searchEngines = "s: https://example.invalid/external?q=%s";
      }
      return values;
    };
    const manager = new TransitionArchive({ writer, authorize: () => true });
    await rejects(manager.inspectConflict("legacy-rollback"), "CONFIGURATION_EXTERNAL_CONFLICT");
    h.storage.sync.get = original;
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("冲突分类期间关联备份变化时不返回旧结论", async () => {
    const { h, writer, transaction } = await rollbackFixture();
    await transaction.execute(await transaction.preview());
    const journal = h.storage.local.values[ROLLBACK_JOURNAL_KEY];
    const original = h.storage.sync.get;
    let changed = false;
    h.storage.sync.get = async (keys) => {
      const result = await original.call(h.storage.sync, keys);
      if (!changed && Array.isArray(keys) && keys.includes("keyMappings")) {
        changed = true;
        h.storage.local.values[journal.backupKey].backupDigest = "0".repeat(64);
      }
      return result;
    };
    const writes = h.writes.length;
    const manager = new TransitionArchive({ writer, authorize: () => false });
    await rejects(manager.inspectConflict("legacy-rollback"), "CONFIGURATION_DIGEST_MISMATCH");
    assert.isTrue(changed);
    assert.equal(writes, h.writes.length);
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
  });

  should("回退冲突现场与逐字段选择可复核，且不会修改同步数据或解除写保护", async () => {
    const external = "map synthetic-private scrollUp";
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = external;
      },
    });
    await transaction.execute(await transaction.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("legacy-rollback");
    const journal = clone(h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    const sync = clone(h.storage.sync.values);
    const decisions = new TransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    assert.isFalse(JSON.stringify(captured).includes(external));
    const preview = await decisions.preview(captured.key);
    assert.equal(external, preview.fields.keyMappings.current.value);
    assert.equal("map old scrollUp", preview.fields.keyMappings.before.value);
    assert.equal({ present: false }, preview.fields.keyMappings.after);
    assert.equal(false, preview.releaseAllowed);
    preview.fields.keyMappings.current.value = "不能修改已保存的现场";
    assert.equal(
      external,
      (await decisions.preview(captured.key)).fields.keyMappings.current.value,
    );
    const choices = Object.fromEntries(Object.keys(preview.fields).map((key) => [key, "current"]));
    choices.searchEngines = "before";
    const receipt = await decisions.record(captured.key, choices);
    assert.isFalse(JSON.stringify(receipt).includes(external));
    assert.equal("current", (await decisions.inspect(receipt.key)).status);
    const proposal = await decisions.previewDecision(receipt.key);
    assert.equal({ present: true, value: external }, proposal.cells.keyMappings);
    assert.equal(
      { present: true, value: "s: https://example.invalid/old?q=%s" },
      proposal.cells.searchEngines,
    );
    assert.isFalse(proposal.writeAllowed || proposal.releaseAllowed || proposal.lineageVerified);
    proposal.cells.keyMappings.value = "不能修改已保存的选择";
    assert.equal(external, (await decisions.previewDecision(receipt.key)).cells.keyMappings.value);
    assert.equal(sync, h.storage.sync.values);
    assert.equal(journal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
    assert.isTrue(Object.hasOwn(h.storage.local.values, archiveKey));
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } }),
      "CONFIGURATION_TRANSITION_PENDING",
    );
  });

  should("冲突选择必须完整明确，参数在排队前复制，保存后重启可复用", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map outside scrollUp";
      },
    });
    await transaction.execute(await transaction.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("legacy-rollback");
    const decisions = new TransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    const { fields } = await decisions.preview(captured.key);
    const choices = Object.fromEntries(Object.keys(fields).map((key) => [key, "current"]));
    await rejects(decisions.record(captured.key, {}), "INVALID_CONFIGURATION_CHOICE");
    await rejects(
      decisions.record(captured.key, { ...choices, extra: "current" }),
      "INVALID_CONFIGURATION_CHOICE",
    );
    await rejects(
      decisions.record(captured.key, { ...choices, keyMappings: "unknown" }),
      "INVALID_CONFIGURATION_CHOICE",
    );
    let release;
    const wait = new Promise((resolve) => release = resolve);
    const held = writer.enqueue(() => wait);
    const pending = decisions.record(captured.key, choices);
    choices.keyMappings = "before";
    release();
    await held;
    const saved = await pending;
    const restarted = new TransitionConflictDecisions({
      writer: h.create(),
      authorize: () => true,
    });
    assert.equal("current", (await restarted.inspect(saved.key)).status);
    assert.equal("current", h.storage.local.values[saved.key].choices.keyMappings);
    assert.isTrue((await restarted.capture(archiveKey)).reused);
    assert.isTrue(
      (await restarted.record(captured.key, h.storage.local.values[saved.key].choices)).reused,
    );
  });

  should("冲突选择未授权、现场改变、归档损坏及存储不足时均不能放行", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map outside scrollUp";
      },
    });
    await transaction.execute(await transaction.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("legacy-rollback");
    const denied = new TransitionConflictDecisions({ writer, authorize: () => false });
    const before = h.writes.length;
    await rejects(denied.capture(archiveKey), "CONFIGURATION_CONFLICT_DECISIONS_NOT_ENABLED");
    assert.equal(before, h.writes.length);
    const decisions = new TransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    const { fields } = await decisions.preview(captured.key);
    const choices = Object.fromEntries(Object.keys(fields).map((key) => [key, "current"]));
    h.storage.local.QUOTA_BYTES = await h.storage.local.getBytesInUse(null) + 1;
    await rejects(decisions.record(captured.key, choices), "CONFIGURATION_LOCAL_QUOTA");
    h.storage.local.QUOTA_BYTES = 10 * 1024 * 1024;
    h.storage.sync.values.keyMappings = "map newer scrollDown";
    await rejects(decisions.record(captured.key, choices), "CONFIGURATION_EXTERNAL_CONFLICT");
    await rejects(decisions.preview(captured.key), "CONFIGURATION_EXTERNAL_CONFLICT");
    h.storage.sync.values.keyMappings = "map outside scrollUp";
    h.storage.local.values[archiveKey].journal.code = "tampered";
    await rejects(decisions.record(captured.key, choices));
    assert.isTrue(Object.hasOwn(h.storage.local.values, captured.key));
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("冲突记录落盘后现场变化必须报错，保留现场和已保存数据", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map outside scrollUp";
      },
    });
    await transaction.execute(await transaction.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("legacy-rollback");
    const decisions = new TransitionConflictDecisions({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "case") h.storage.sync.values.keyMappings = "map newest scrollDown";
      },
    });
    await rejects(decisions.capture(archiveKey), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal("map newest scrollDown", h.storage.sync.values.keyMappings);
    assert.isTrue(
      Object.keys(h.storage.local.values).some((key) =>
        key.startsWith(`${config.TRANSITION_RECORD_PREFIX}conflict:`)
      ),
    );
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("选择落盘后现场变化使记录失效，但不能删除已保存的外部数据", async () => {
    const { h, writer, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map outside scrollUp";
      },
    });
    await transaction.execute(await transaction.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const { key: archiveKey } = await archive.archive("legacy-rollback");
    const decisions = new TransitionConflictDecisions({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "decision") h.storage.sync.values.keyMappings = "map later scrollDown";
      },
    });
    const captured = await decisions.capture(archiveKey);
    const { fields } = await decisions.preview(captured.key);
    const choices = Object.fromEntries(Object.keys(fields).map((key) => [key, "current"]));
    await rejects(decisions.record(captured.key, choices), "CONFIGURATION_EXTERNAL_CONFLICT");
    const key = Object.keys(h.storage.local.values).find((name) =>
      name.startsWith(`${config.TRANSITION_RECORD_PREFIX}decision:`)
    );
    assert.isTrue(Boolean(key));
    await rejects(decisions.inspect(key), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal(
      "map outside scrollUp",
      h.storage.local.values[captured.key].observed.keyMappings.value,
    );
    assert.equal("map later scrollDown", h.storage.sync.values.keyMappings);
    assert.isTrue(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("同步发布冲突只报告外部索引和分片状态，不回显外部内容", async () => {
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const { h, writer, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "chunks") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    h.storage.sync.values[config.KEYS.index] = { marker: "synthetic-private-index" };
    const restarted = new KeyboardSyncPublisher({ writer, authorize: () => true });
    assert.equal("ABORTED", (await restarted.recover()).phase);
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const result = await manager.inspectConflict("keyboard-sync-publish");
    assert.equal("external", result.index);
    assert.equal(Object.keys(plan.chunks).length, result.chunks.matching);
    assert.isFalse(result.syncBaseChanged);
    assert.isFalse(JSON.stringify(result).includes("synthetic-private-index"));
  });

  should("同步冲突保存完整外部代次并逐字段预演选择，但不能授权写入或解锁", async () => {
    const { h, writer, archiveKey, generation, latest } = await syncConflictFixture();
    const syncBefore = clone(h.storage.sync.values);
    const journal = clone(h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const inspection = await decisions.inspectIncoming(archiveKey);
    assert.equal("complete", inspection.status);
    assert.isFalse(
      inspection.lineageVerified || inspection.writeAllowed || inspection.releaseAllowed,
    );
    assert.isFalse(JSON.stringify(inspection).includes("map remote"));
    const captured = await decisions.capture(archiveKey);
    assert.isFalse(JSON.stringify(captured).includes("map remote"));
    const preview = await decisions.preview(captured.key);
    assert.equal(["keyMappings", "smoothScroll"], Object.keys(preview.fields).sort());
    assert.equal(latest.keyboard.keyMappings, preview.fields.keyMappings.local);
    assert.equal("map remote scrollUp", preview.fields.keyMappings.incoming);
    assert.isFalse(preview.lineageVerified || preview.writeAllowed || preview.releaseAllowed);
    assert.isTrue(preview.possibleOtherSyncChange);
    assert.isFalse(preview.localDomainChanged);
    assert.isFalse(preview.journalHasOtherConflicts);
    preview.fields.keyMappings.incoming = "不能更改已保存的候选";
    assert.equal(
      "map remote scrollUp",
      (await decisions.preview(captured.key)).fields.keyMappings.incoming,
    );
    const saved = h.storage.local.values[captured.key];
    assert.equal(generation.index, saved.incomingIndex);
    assert.equal(generation.chunks, saved.incomingChunks);
    assert.isFalse(JSON.stringify(saved).includes("synthetic-private-unrelated"));
    const receipt = await decisions.record(captured.key, {
      keyMappings: "incoming",
      smoothScroll: "local",
    });
    const proposal = await decisions.previewDecision(receipt.key);
    assert.equal("map remote scrollUp", proposal.candidate.keyMappings);
    assert.equal(false, proposal.candidate.smoothScroll);
    assert.isFalse(proposal.lineageVerified || proposal.writeAllowed || proposal.releaseAllowed);
    assert.isTrue(proposal.possibleOtherSyncChange);
    assert.equal(syncBefore, h.storage.sync.values);
    assert.equal(journal, h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } }),
      "CONFIGURATION_TRANSITION_PENDING",
    );
  });

  should("同步发布进行中出现外部完整代次，终止后仍可保留双方供逐字段复核", async () => {
    const { h, writer, latest } = await publishFixture();
    const incoming = clone(latest.keyboard);
    delete incoming.settingsVersion;
    incoming.keyMappings = "map remote scrollUp";
    incoming.smoothScroll = true;
    const publisher = new KeyboardSyncPublisher({
      writer,
      authorize: () => true,
      afterStep: async (step) => {
        if (step === "chunks") await installSyntheticKeyboardGeneration(h, incoming, 444);
      },
    });
    const result = await publisher.execute(await publisher.preview());
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const archived = await archive.archive("keyboard-sync-publish");
    const sync = clone(h.storage.sync.values);
    const journal = clone(h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archived.key);
    const preview = await decisions.preview(captured.key);
    assert.equal("map remote scrollUp", preview.fields.keyMappings.incoming);
    const receipt = await decisions.record(captured.key, {
      keyMappings: "local",
      smoothScroll: "incoming",
    });
    const proposal = await decisions.previewDecision(receipt.key);
    assert.equal(latest.keyboard.keyMappings, proposal.candidate.keyMappings);
    assert.equal(true, proposal.candidate.smoothScroll);
    assert.isFalse(proposal.lineageVerified || proposal.writeAllowed || proposal.releaseAllowed);
    assert.equal(sync, h.storage.sync.values);
    assert.equal(journal, h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
  });

  should("同步冲突同时涉及工具箱域时明确提示仍有其他冲突", async () => {
    const { h, writer } = await syncConflictFixture();
    const { integrityDigest: _digest, ...body } = h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY];
    const changed = {
      ...body,
      phase: "ABORTED",
      code: "CONFIGURATION_EXTERNAL_CONFLICT",
      conflicts: ["toolbox"],
    };
    h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY] = {
      ...changed,
      integrityDigest: await config.digest(changed),
    };
    h.storage.local.values[config.KEYS.toolbox] = { marker: "synthetic-private-local" };
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const archived = await archive.archive("keyboard-sync-publish");
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archived.key);
    const preview = await decisions.preview(captured.key);
    assert.isTrue(preview.localDomainChanged);
    assert.isTrue(preview.journalHasOtherConflicts);
    assert.isFalse(JSON.stringify(preview).includes("synthetic-private-local"));
    const receipt = await decisions.record(captured.key, {
      keyMappings: "incoming",
      smoothScroll: "local",
    });
    const proposal = await decisions.previewDecision(receipt.key);
    assert.isTrue(proposal.localDomainChanged && proposal.journalHasOtherConflicts);
    assert.isFalse(proposal.writeAllowed || proposal.releaseAllowed || proposal.lineageVerified);
    assert.equal(
      { marker: "synthetic-private-local" },
      h.storage.local.values[config.KEYS.toolbox],
    );
  });

  should("仅出现完整外部代次时不把它的分片误标为其他同步域变化", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    delete h.storage.sync.values.unrelatedSynthetic;
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    const preview = await decisions.preview(captured.key);
    assert.isFalse(preview.possibleOtherSyncChange);
    assert.isFalse(preview.localDomainChanged);
    assert.isFalse(preview.journalHasOtherConflicts);
    assert.isFalse(preview.lineageVerified || preview.writeAllowed || preview.releaseAllowed);
  });

  should("同步冲突预演保留本机不可表达规则并提示限制，不将其视为可写方案", async () => {
    const { h, writer, publisher } = await publishFixture();
    const rules = [{ pattern: "https://example.invalid/*", passKeys: "", enabled: false }];
    const latest = await writer.commit({ legacyPatch: { exclusionRules: rules } });
    await publisher.execute(await publisher.preview());
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const archived = await archive.archive("keyboard-sync-publish");
    const incoming = clone(latest.keyboard);
    delete incoming.settingsVersion;
    incoming.exclusionRules = [];
    await installSyntheticKeyboardGeneration(h, incoming, 222);
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archived.key);
    const preview = await decisions.preview(captured.key);
    assert.equal(["keyboard.exclusionRules[0].enabled"], preview.localLegacyLimitations);
    assert.equal(rules, preview.fields.exclusionRules.local);
    const retained = await decisions.record(captured.key, { exclusionRules: "local" });
    const proposal = await decisions.previewDecision(retained.key);
    assert.equal(rules, proposal.candidate.exclusionRules);
    assert.equal(["keyboard.exclusionRules[0].enabled"], proposal.legacyLimitations);
    assert.isFalse(proposal.writeAllowed || proposal.releaseAllowed || proposal.lineageVerified);
    const journal = h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY];
    assert.equal(rules, h.storage.local.values[journal.backupKey].snapshot.keyboard.exclusionRules);
    const incomingChoice = await decisions.record(captured.key, { exclusionRules: "incoming" });
    const incomingProposal = await decisions.previewDecision(incomingChoice.key);
    assert.equal([], incomingProposal.candidate.exclusionRules);
    assert.equal([], incomingProposal.legacyLimitations);
    assert.equal(rules, h.storage.local.values[journal.backupKey].snapshot.keyboard.exclusionRules);
  });

  should("同步冲突选择必须完整明确，排队前复制参数且重启后复用", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    await rejects(decisions.record(captured.key, {}), "INVALID_CONFIGURATION_CHOICE");
    await rejects(
      decisions.record(captured.key, { keyMappings: "incoming", smoothScroll: "unknown" }),
      "INVALID_CONFIGURATION_CHOICE",
    );
    let release;
    const held = writer.enqueue(() => new Promise((resolve) => release = resolve));
    await Promise.resolve();
    const input = { keyMappings: "incoming", smoothScroll: "local" };
    const pending = decisions.record(captured.key, input);
    input.keyMappings = "local";
    release();
    await held;
    const receipt = await pending;
    const restarted = new SyncTransitionConflictDecisions({
      writer: h.create(),
      authorize: () => true,
    });
    assert.isTrue((await restarted.capture(archiveKey)).reused);
    assert.equal("incoming", h.storage.local.values[receipt.key].choices.keyMappings);
    assert.isTrue(
      (await restarted.record(captured.key, h.storage.local.values[receipt.key].choices)).reused,
    );
    assert.isFalse((await restarted.previewDecision(receipt.key)).lineageVerified);
  });

  should("同步候选缺片、未知格式、额外元数据或规则字段时拒绝并保留所有现场", async () => {
    for (const scenario of ["missing", "format", "metadata", "unrelated-key", "rule"]) {
      const { h, writer, archiveKey, generation, incoming } = await syncConflictFixture();
      if (scenario === "missing") {
        delete h.storage.sync.values[generation.index.fields.keyMappings.chunks[0]];
      }
      if (scenario === "format") h.storage.sync.values[config.KEYS.index].formatVersion = 999;
      if (scenario === "metadata") {
        h.storage.sync.values[config.KEYS.index].fields.keyMappings.extra = "unknown";
      }
      if (scenario === "unrelated-key") {
        h.storage.sync.values[config.KEYS.index].fields.keyMappings.chunks = ["unrelatedSynthetic"];
      }
      if (scenario === "rule") {
        incoming.exclusionRules = [{
          pattern: "https://example.invalid/*",
          passKeys: "",
          enabled: false,
        }];
        await installSyntheticKeyboardGeneration(h, incoming, 778);
      }
      const sync = clone(h.storage.sync.values);
      const before = h.writes.length;
      const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
      const inspection = await decisions.inspectIncoming(archiveKey);
      assert.equal(
        scenario === "missing"
          ? "incomplete"
          : scenario === "rule"
          ? "unsupported-fields"
          : scenario === "unrelated-key"
          ? "invalid"
          : "unsupported",
        inspection.status,
      );
      assert.isFalse(JSON.stringify(inspection).includes("synthetic-private-unrelated"));
      await rejects(decisions.capture(archiveKey));
      assert.equal(before, h.writes.length);
      assert.equal(sync, h.storage.sync.values);
      assert.isTrue(Object.hasOwn(h.storage.local.values, archiveKey));
      assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
    }
  });

  should("同步选择前后任何来源变化、配额不足或授权缺失均不写业务数据", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    const denied = new SyncTransitionConflictDecisions({ writer, authorize: () => false });
    const writes = h.writes.length;
    await rejects(denied.capture(archiveKey), "CONFIGURATION_SYNC_DECISIONS_NOT_ENABLED");
    assert.equal(writes, h.writes.length);
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    const choices = { keyMappings: "incoming", smoothScroll: "local" };
    h.storage.local.QUOTA_BYTES = await h.storage.local.getBytesInUse(null) + 1;
    await rejects(decisions.record(captured.key, choices), "CONFIGURATION_LOCAL_QUOTA");
    h.storage.local.QUOTA_BYTES = 10 * 1024 * 1024;
    h.storage.sync.values.unrelatedSynthetic = "later-external-value";
    await rejects(decisions.record(captured.key, choices), "CONFIGURATION_EXTERNAL_CONFLICT");
    await rejects(decisions.preview(captured.key), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal("later-external-value", h.storage.sync.values.unrelatedSynthetic);
    assert.isTrue(Object.hasOwn(h.storage.local.values, captured.key));
    assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
  });

  should("同步冲突完整候选超过保留容量时不删除外部分片或事务", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    h.storage.local.values[`${config.TRANSITION_RECORD_PREFIX}synthetic`] = "x".repeat(
      config.MAX_BACKUP_BYTES,
    );
    const sync = clone(h.storage.sync.values);
    const journal = clone(h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    const writes = h.writes.length;
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    await rejects(decisions.capture(archiveKey), "CONFIGURATION_BACKUP_QUOTA");
    assert.equal(writes, h.writes.length);
    assert.equal(sync, h.storage.sync.values);
    assert.equal(journal, h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
  });

  should("同步冲突记录落盘后外部改变时保留已记录候选并拒绝过期结果", async () => {
    const { h, writer, archiveKey, generation } = await syncConflictFixture();
    const decisions = new SyncTransitionConflictDecisions({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step === "sync-case") h.storage.sync.values.unrelatedSynthetic = "later-external-value";
      },
    });
    await rejects(decisions.capture(archiveKey), "CONFIGURATION_EXTERNAL_CONFLICT");
    const key = Object.keys(h.storage.local.values).find((name) =>
      name.startsWith(`${config.TRANSITION_RECORD_PREFIX}sync-conflict:`)
    );
    assert.isTrue(Boolean(key));
    assert.equal(generation.index, h.storage.local.values[key].incomingIndex);
    assert.equal(generation.chunks, h.storage.local.values[key].incomingChunks);
    assert.equal("later-external-value", h.storage.sync.values.unrelatedSynthetic);
    assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
  });

  should("同步选择落盘后归档或外部分片变化不得报告成功", async () => {
    for (const scenario of ["archive", "chunk"]) {
      const { h, writer, archiveKey, generation } = await syncConflictFixture();
      const decisions = new SyncTransitionConflictDecisions({
        writer,
        authorize: () => true,
        afterStep: (step) => {
          if (step !== "sync-decision") return;
          if (scenario === "archive") h.storage.local.values[archiveKey].journal.code = "tampered";
          else {h.storage.sync.values[generation.index.fields.keyMappings.chunks[0]].text =
              "changed";}
        },
      });
      const captured = await decisions.capture(archiveKey);
      await rejects(
        decisions.record(captured.key, { keyMappings: "incoming", smoothScroll: "local" }),
      );
      const decisionKey = Object.keys(h.storage.local.values).find((name) =>
        name.startsWith(`${config.TRANSITION_RECORD_PREFIX}sync-decision:`)
      );
      assert.isTrue(Boolean(decisionKey));
      assert.equal(generation.index, h.storage.local.values[captured.key].incomingIndex);
      assert.equal(generation.chunks, h.storage.local.values[captured.key].incomingChunks);
      assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
    }
  });

  should("同步代次内容相同但身份不同也不能据此自动生成选择或放行", async () => {
    const { h, writer, archiveKey, latest } = await syncConflictFixture();
    const same = clone(latest.keyboard);
    delete same.settingsVersion;
    await installSyntheticKeyboardGeneration(h, same, 9999);
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    const captured = await decisions.capture(archiveKey);
    const preview = await decisions.preview(captured.key);
    assert.equal({}, preview.fields);
    assert.isFalse(preview.lineageVerified || preview.writeAllowed || preview.releaseAllowed);
    await rejects(decisions.record(captured.key, {}), "CONFIGURATION_CONFLICT_UNRESOLVED");
    assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
  });

  should("同步候选只读诊断遇到缺索引或读取中变化时不误报完成", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    delete h.storage.sync.values[config.KEYS.index];
    const absent = await decisions.inspectIncoming(archiveKey);
    assert.equal("no-foreign-candidate", absent.status);
    await rejects(decisions.capture(archiveKey), "CONFIGURATION_CONFLICT_UNRESOLVED");
    const original = h.storage.sync.get;
    let changed = false;
    h.storage.sync.get = async (keys) => {
      const value = await original.call(h.storage.sync, keys);
      if (!changed && keys === null) {
        changed = true;
        h.storage.sync.values.unrelatedSynthetic = "later-external-value";
      }
      return value;
    };
    await rejects(decisions.inspectIncoming(archiveKey), "CONFIGURATION_EXTERNAL_CONFLICT");
    h.storage.sync.get = original;
    assert.equal("later-external-value", h.storage.sync.values.unrelatedSynthetic);
    assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
  });

  should("同步冲突记录读回后被改写时不能声称保存成功", async () => {
    const { h, writer, archiveKey } = await syncConflictFixture();
    const decisions = new SyncTransitionConflictDecisions({
      writer,
      authorize: () => true,
      afterStep: (step) => {
        if (step !== "sync-case") return;
        const key = Object.keys(h.storage.local.values).find((name) =>
          name.startsWith(`${config.TRANSITION_RECORD_PREFIX}sync-conflict:`)
        );
        h.storage.local.values[key].incomingIndex.revision++;
      },
    });
    await rejects(decisions.capture(archiveKey), "CONFIGURATION_READBACK_FAILED");
    assert.isTrue(Object.hasOwn(h.storage.local.values, archiveKey));
    assert.isTrue(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
    assert.equal("synthetic-private-unrelated", h.storage.sync.values.unrelatedSynthetic);
  });

  should("未知终态原因不得生成同步冲突选择，原记录与外部候选保留", async () => {
    const { h, writer } = await syncConflictFixture();
    const existing = h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY];
    const { integrityDigest: _digest, ...body } = existing;
    const changed = { ...body, phase: "ABORTED", code: "SYNTHETIC_UNKNOWN_REASON" };
    h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY] = {
      ...changed,
      integrityDigest: await config.digest(changed),
    };
    const archive = new TransitionArchive({ writer, authorize: () => true });
    const archived = await archive.archive("keyboard-sync-publish");
    const sync = clone(h.storage.sync.values);
    const journal = clone(h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
    const writes = h.writes.length;
    const decisions = new SyncTransitionConflictDecisions({ writer, authorize: () => true });
    await rejects(decisions.inspectIncoming(archived.key), "INVALID_CONFIGURATION_RECOVERY");
    await rejects(decisions.capture(archived.key), "INVALID_CONFIGURATION_RECOVERY");
    assert.equal(writes, h.writes.length);
    assert.equal(sync, h.storage.sync.values);
    assert.equal(journal, h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY]);
  });

  should("同步冲突可区分分片、其余同步域和本机工具箱域变化", async () => {
    const stop = Object.assign(new Error("合成中断"), { simulatedTermination: true });
    const { h, writer, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "chunks") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    const chunk = plan.index.fields.keyMappings.chunks[0];
    h.storage.sync.values[chunk] = { operationId: "other", part: 0, text: "synthetic-private" };
    h.storage.sync.values.unrelated = "synthetic-private";
    h.storage.local.values[config.KEYS.toolbox] = { marker: "synthetic-private" };
    const restarted = new KeyboardSyncPublisher({ writer, authorize: () => true });
    assert.equal("ABORTED", (await restarted.recover()).phase);
    const manager = new TransitionArchive({ writer, authorize: () => true });
    const result = await manager.inspectConflict("keyboard-sync-publish");
    assert.equal("absent", result.index);
    assert.equal(1, result.chunks.external);
    assert.isTrue(result.syncBaseChanged);
    assert.isTrue(result.localDomainChanged);
    assert.isFalse(JSON.stringify(result).includes("synthetic-private"));
  });

  should("隔离回退事务先备份最新提交，再记录前后像并读回旧字段", async () => {
    const { h, latest, transaction } = await rollbackFixture();
    const plan = await transaction.preview();
    const result = await transaction.execute(plan);
    assert.equal("COMMITTED", result.phase);
    assert.equal(latest.revision, result.revision);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "keyMappings"));
    assert.equal("s: https://example.invalid/new?q=%s", h.storage.sync.values.searchEngines);
    assert.equal(false, h.storage.sync.values.smoothScroll);
    const journal = h.storage.local.values[ROLLBACK_JOURNAL_KEY];
    assert.equal("COMMITTED", journal.phase);
    assert.equal("map old scrollUp", journal.cells.keyMappings.before.value);
    assert.equal("s: https://example.invalid/old?q=%s", journal.cells.searchEngines.before.value);
    assert.isTrue(Object.hasOwn(h.storage.local.values, journal.backupKey));
    const backups = await transaction.listBackups();
    assert.isTrue(
      backups.some((item) => item.key === journal.backupKey && item.status === "valid"),
    );
    await rejects(transaction.execute(plan), "CONFIGURATION_ROLLBACK_JOURNAL_EXISTS");
  });

  should("隔离回退预演后旧字段变化时先停止，不覆盖外部值", async () => {
    const { h, transaction } = await rollbackFixture();
    const plan = await transaction.preview();
    h.storage.sync.values.keyMappings = "map external scrollDown";
    const before = h.writes.length;
    await rejects(transaction.execute(plan), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal(before, h.writes.length);
    assert.equal("map external scrollDown", h.storage.sync.values.keyMappings);
  });

  should("回退备份落盘后、恢复记录前中断可列出备份且不改兼容字段", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "backup") throw stop;
      },
    });
    const plan = await transaction.preview();
    const before = clone(h.storage.sync.values);
    await rejects(transaction.execute(plan));
    assert.equal(before, h.storage.sync.values);
    assert.isFalse(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
    const backups = await transaction.listBackups();
    assert.equal(1, backups.length);
    assert.equal("valid", backups[0].status);
  });

  should("隔离回退在同步写入中断后由新实例完成读回，不重复改动新配置", async () => {
    const { h, latest, transaction } = await rollbackFixture();
    const plan = await transaction.preview();
    const originalSet = h.storage.sync.set;
    let stopped = false;
    h.storage.sync.set = async (items) => {
      await originalSet.call(h.storage.sync, items);
      if (!stopped) {
        stopped = true;
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      }
    };
    await rejects(transaction.execute(plan));
    h.storage.sync.set = originalSet;
    assert.equal("APPLYING", h.storage.local.values[ROLLBACK_JOURNAL_KEY].phase);
    const restarted = new LegacyRollbackTransaction({
      writer: h.create(),
      authorize: () => true,
    });
    const recovered = await restarted.recover();
    assert.equal("COMMITTED", recovered.phase);
    assert.equal(latest.revision, recovered.revision);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "keyMappings"));
    assert.equal("s: https://example.invalid/new?q=%s", h.storage.sync.values.searchEngines);
    assert.equal(false, h.storage.sync.values.smoothScroll);
    assert.equal("COMMITTED", h.storage.local.values[ROLLBACK_JOURNAL_KEY].phase);
  });

  should("隔离回退恢复遇到外部新值时保留现场，显式补偿只恢复可识别字段", async () => {
    const { h, transaction } = await rollbackFixture();
    const plan = await transaction.preview();
    const originalSet = h.storage.sync.set;
    let stopped = false;
    h.storage.sync.set = async (items) => {
      await originalSet.call(h.storage.sync, items);
      if (!stopped) {
        stopped = true;
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      }
    };
    await rejects(transaction.execute(plan));
    h.storage.sync.set = originalSet;
    h.storage.sync.values.searchEngines = "s: https://example.invalid/external?q=%s";
    const restarted = new LegacyRollbackTransaction({
      writer: h.create(),
      authorize: () => true,
    });
    const aborted = await restarted.recover();
    assert.equal("ABORTED", aborted.phase);
    assert.equal("s: https://example.invalid/external?q=%s", h.storage.sync.values.searchEngines);
    const compensated = await restarted.compensate();
    assert.equal("ABORTED", compensated.phase);
    assert.isTrue(compensated.conflicts.includes("sync.searchEngines"));
    assert.equal("s: https://example.invalid/external?q=%s", h.storage.sync.values.searchEngines);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "smoothScroll"));
    assert.equal("map old scrollUp", h.storage.sync.values.keyMappings);
  });

  should("隔离回退恢复和补偿在频率预算耗尽时不改动同步字段", async () => {
    for (const action of ["recover", "compensate"]) {
      const { h, transaction } = await rollbackFixture();
      const plan = await transaction.preview();
      const set = h.storage.sync.set;
      h.storage.sync.set = async (items) => {
        await set.call(h.storage.sync, items);
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      };
      await rejects(transaction.execute(plan));
      h.storage.sync.set = set;
      h.storage.local.values[config.KEYS.frequency] = Array(120).fill(Date.now());
      const beforeSync = clone(h.storage.sync.values);
      const beforeJournal = clone(h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
      const restarted = new LegacyRollbackTransaction({
        writer: h.create(),
        authorize: () => true,
      });
      await rejects(restarted[action](), "CONFIGURATION_SYNC_FREQUENCY");
      assert.equal(beforeSync, h.storage.sync.values);
      if (action === "recover") {
        assert.equal(beforeJournal, h.storage.local.values[ROLLBACK_JOURNAL_KEY]);
      } else assert.equal("RECOVERING", h.storage.local.values[ROLLBACK_JOURNAL_KEY].phase);
    }
  });

  should("恢复记录即使重算摘要，后像与已验证备份不符也不得写入", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "journal") throw stop;
      },
    });
    const plan = await transaction.preview();
    await rejects(transaction.execute(plan));
    const journal = h.storage.local.values[ROLLBACK_JOURNAL_KEY];
    journal.cells.searchEngines.after.value = "tampered";
    const { integrityDigest: _oldDigest, ...body } = journal;
    journal.integrityDigest = await config.digest(body);
    const beforeSync = clone(h.storage.sync.values);
    const beforeWrites = h.writes.length;
    const restarted = new LegacyRollbackTransaction({
      writer: h.create(),
      authorize: () => true,
    });
    await rejects(restarted.recover(), "INVALID_CONFIGURATION_RECOVERY");
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("旧字段前像无法安全验证时，不生成不可恢复的事务记录", async () => {
    const { h, transaction } = await rollbackFixture();
    h.storage.sync.values.settingsVersion = 42;
    const plan = await transaction.preview();
    const beforeSync = clone(h.storage.sync.values);
    await rejects(transaction.execute(plan), "INVALID_CONFIGURATION_RECOVERY");
    assert.equal(beforeSync, h.storage.sync.values);
    assert.isFalse(Object.hasOwn(h.storage.local.values, ROLLBACK_JOURNAL_KEY));
  });

  should("恢复记录落盘后中断可重新执行；记录空间不足时不写同步字段", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const first = await rollbackFixture({
      afterStep: (step) => {
        if (step === "journal") throw stop;
      },
    });
    const plan = await first.transaction.preview();
    await rejects(first.transaction.execute(plan));
    assert.equal("PREPARED", first.h.storage.local.values[ROLLBACK_JOURNAL_KEY].phase);
    const restarted = new LegacyRollbackTransaction({
      writer: first.h.create(),
      authorize: () => true,
    });
    assert.equal("COMMITTED", (await restarted.recover()).phase);

    const second = await rollbackFixture();
    const quota = new LegacyRollbackTransaction({
      writer: second.writer,
      authorize: () => true,
      afterStep: async (step) => {
        if (step === "backup") {
          second.h.storage.local.QUOTA_BYTES = await second.h.storage.local.getBytesInUse(null) + 1;
        }
      },
    });
    const secondPlan = await quota.preview();
    const beforeSync = clone(second.h.storage.sync.values);
    await rejects(quota.execute(secondPlan), "CONFIGURATION_LOCAL_QUOTA");
    assert.equal(beforeSync, second.h.storage.sync.values);
    assert.isFalse(Object.hasOwn(second.h.storage.local.values, ROLLBACK_JOURNAL_KEY));
    assert.equal("valid", (await quota.listBackups())[0].status);
  });

  should("补偿途中中断后恢复补偿方向，不能重新执行原回写", async () => {
    const { h, transaction } = await rollbackFixture();
    const plan = await transaction.preview();
    const originalSet = h.storage.sync.set;
    h.storage.sync.set = async (items) => {
      await originalSet.call(h.storage.sync, items);
      throw Object.assign(new Error("写回中断"), { simulatedTermination: true });
    };
    await rejects(transaction.execute(plan));
    h.storage.sync.set = async (items) => {
      await originalSet.call(h.storage.sync, items);
      throw Object.assign(new Error("补偿中断"), { simulatedTermination: true });
    };
    await rejects(transaction.compensate());
    h.storage.sync.set = originalSet;
    assert.equal("RECOVERING", h.storage.local.values[ROLLBACK_JOURNAL_KEY].phase);
    const restarted = new LegacyRollbackTransaction({
      writer: h.create(),
      authorize: () => true,
    });
    const result = await restarted.recover();
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_ROLLED_BACK", result.code);
    assert.equal("map old scrollUp", h.storage.sync.values.keyMappings);
    assert.equal("s: https://example.invalid/old?q=%s", h.storage.sync.values.searchEngines);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "smoothScroll"));
  });

  should("尚未开始同步写入的事务取消时，不把碰巧等于后像的外部值回写为前像", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "journal") throw stop;
      },
    });
    const plan = await transaction.preview();
    await rejects(transaction.execute(plan));
    h.storage.sync.values.searchEngines = "s: https://example.invalid/new?q=%s";
    const beforeWrites = h.writes.length;
    const result = await transaction.compensate();
    assert.equal("ABORTED", result.phase);
    assert.isTrue(result.conflicts.includes("sync.searchEngines"));
    assert.equal("s: https://example.invalid/new?q=%s", h.storage.sync.values.searchEngines);
    assert.isFalse(h.writes.slice(beforeWrites).some((entry) => entry.name === "sync"));
  });

  should("隔离同步发布未经授权时不创建备份或写入", async () => {
    const { h, writer } = await publishFixture();
    const publisher = new KeyboardSyncPublisher({ writer, authorize: () => false });
    const plan = await publisher.preview();
    const before = h.writes.length;
    await rejects(publisher.execute(plan), "CONFIGURATION_SYNC_NOT_ENABLED");
    assert.equal(before, h.writes.length);
    assert.isFalse(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
  });

  should("隔离同步发布先验证分片再发布索引，旧字段与本机权威保持不变", async () => {
    const { h, writer, latest, publisher } = await publishFixture();
    const beforeState = clone(h.storage.local.values[config.KEYS.state]);
    const beforeLegacy = {
      keyMappings: h.storage.sync.values.keyMappings,
      smoothScroll: h.storage.sync.values.smoothScroll,
    };
    const plan = await publisher.preview();
    const result = await publisher.execute(plan);
    assert.equal("COMMITTED", result.phase);
    assert.equal(latest.revision, result.revision);
    assert.equal(plan.index, h.storage.sync.values[config.KEYS.index]);
    assert.equal(
      "map z scrollDown",
      (await config.readGeneration(plan.index, h.storage.sync)).keyMappings,
    );
    assert.equal(beforeLegacy.keyMappings, h.storage.sync.values.keyMappings);
    assert.equal(beforeLegacy.smoothScroll, h.storage.sync.values.smoothScroll);
    assert.equal(beforeState, h.storage.local.values[config.KEYS.state]);
    assert.isTrue(Object.hasOwn(h.storage.local.values, result.backupKey));
    assert.equal("map z scrollDown", (await writer.read()).keyboard.keyMappings);
  });

  should("隔离同步发布前已有新索引或候选被篡改时不创建备份", async () => {
    for (const scenario of ["existing", "tampered"]) {
      const { h, publisher } = await publishFixture();
      const plan = await publisher.preview();
      if (scenario === "existing") h.storage.sync.values[config.KEYS.index] = { formatVersion: 99 };
      if (scenario === "tampered") {
        const key = plan.index.fields.keyMappings.chunks[0];
        plan.chunks[key].text += "tampered";
      }
      const before = h.writes.length;
      await rejects(publisher.execute(plan));
      assert.equal(before, h.writes.length);
      assert.isFalse(Object.hasOwn(h.storage.local.values, SYNC_PUBLISH_JOURNAL_KEY));
    }
  });

  should("独立同步分片落盘后中断，重启只能校验完整代次后发布索引", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "chunks") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    assert.equal("PUBLISHING", h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY].phase);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
    const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
    const result = await restarted.recover();
    assert.equal("COMMITTED", result.phase);
    assert.equal(plan.index, h.storage.sync.values[config.KEYS.index]);
    assert.equal(
      "map z scrollDown",
      (await config.readGeneration(plan.index, h.storage.sync)).keyMappings,
    );
  });

  should("独立同步恢复遇到其他索引时保留外部索引和已暂存分片", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "chunks") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    h.storage.sync.values[config.KEYS.index] = { formatVersion: 99, marker: "外部合成索引" };
    const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
    const result = await restarted.recover();
    assert.equal("ABORTED", result.phase);
    assert.equal("外部合成索引", h.storage.sync.values[config.KEYS.index].marker);
    assert.isTrue(
      Object.keys(plan.chunks).every((key) => Object.hasOwn(h.storage.sync.values, key)),
    );
  });

  should("独立同步撤销在删除索引后中断，恢复时继续撤销而不重新发布", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "index") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    assert.equal(plan.index, h.storage.sync.values[config.KEYS.index]);
    const cancelling = new KeyboardSyncPublisher({
      writer: h.create(),
      authorize: () => true,
      afterStep: (step) => {
        if (step === "unpublish") throw stop;
      },
    });
    await rejects(cancelling.cancel());
    assert.equal("RECOVERING", h.storage.local.values[SYNC_PUBLISH_JOURNAL_KEY].phase);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
    const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
    const result = await restarted.recover();
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_SYNC_CANCELLED", result.code);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
    assert.isTrue(
      Object.keys(plan.chunks).every((key) => !Object.hasOwn(h.storage.sync.values, key)),
    );
    assert.equal("map z scrollDown", h.storage.sync.values.keyMappings);
  });

  should("隔离同步恢复预算不足或取消遇到外部索引时不覆盖或清除外部数据", async () => {
    for (const scenario of ["frequency", "external-index"]) {
      const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
      const { h, publisher } = await publishFixture({
        afterStep: (step) => {
          if (step === (scenario === "frequency" ? "chunks" : "index")) throw stop;
        },
      });
      const plan = await publisher.preview();
      await rejects(publisher.execute(plan));
      if (scenario === "frequency") {
        h.storage.local.values[config.KEYS.frequency] = Array(120).fill(Date.now());
      } else h.storage.sync.values[config.KEYS.index] = { formatVersion: 99, marker: "外部" };
      const beforeSync = clone(h.storage.sync.values);
      const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
      if (scenario === "frequency") {
        await rejects(restarted.recover(), "CONFIGURATION_SYNC_FREQUENCY");
      } else {
        const result = await restarted.cancel();
        assert.equal("ABORTED", result.phase);
        assert.equal("外部", h.storage.sync.values[config.KEYS.index].marker);
      }
      assert.equal(beforeSync, h.storage.sync.values);
    }
  });

  should("同步分片已确认后缺片时不能发布索引或删除其他分片", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "chunks") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    const missing = plan.index.fields.keyMappings.chunks[0];
    delete h.storage.sync.values[missing];
    const before = clone(h.storage.sync.values);
    const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
    const result = await restarted.recover();
    assert.equal("ABORTED", result.phase);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
    assert.equal(before, h.storage.sync.values);
  });

  should("同步撤销保留已被外部改写的分片，并只清除自身仍可识别的分片", async () => {
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "index") throw stop;
      },
    });
    const plan = await publisher.preview();
    await rejects(publisher.execute(plan));
    const changed = plan.index.fields.keyMappings.chunks[0];
    h.storage.sync.values[changed] = { operationId: "external", part: 0, text: "外部" };
    const restarted = new KeyboardSyncPublisher({ writer: h.create(), authorize: () => true });
    const result = await restarted.cancel();
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_RECOVERY_CONFLICT", result.code);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
    assert.equal("外部", h.storage.sync.values[changed].text);
    assert.isTrue(
      Object.keys(plan.chunks).filter((key) => key !== changed).every((key) =>
        !Object.hasOwn(h.storage.sync.values, key)
      ),
    );
  });

  should("回退或同步发布记录存在时，普通配置写入及另一种迁移均停止", async () => {
    for (const owner of ["rollback", "publish"]) {
      const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
      const fixture = owner === "rollback"
        ? await rollbackFixture({
          afterStep: (step) => {
            if (step === "journal") throw stop;
          },
        })
        : await publishFixture({
          afterStep: (step) => {
            if (step === "journal") throw stop;
          },
        });
      const { h, writer } = fixture;
      const rollback = owner === "rollback"
        ? fixture.transaction
        : new LegacyRollbackTransaction({ writer, authorize: () => true });
      const publisher = owner === "publish"
        ? fixture.publisher
        : new KeyboardSyncPublisher({ writer, authorize: () => true });
      const rollbackPlan = await rollback.preview();
      const publishPlan = await publisher.preview();
      await rejects(
        owner === "rollback" ? rollback.execute(rollbackPlan) : publisher.execute(publishPlan),
      );
      const beforeSync = clone(h.storage.sync.values);
      const beforeState = clone(h.storage.local.values[config.KEYS.state]);
      const writes = h.writes.length;
      const view = await writer.read();
      assert.equal(fixture.latest.revision, view.revision);
      assert.equal("CONFIGURATION_TRANSITION_PENDING", (await writer.preview()).code);
      await rejects(
        writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } }),
        "CONFIGURATION_TRANSITION_PENDING",
      );
      await rejects(writer.rollback(), "CONFIGURATION_TRANSITION_PENDING");
      await rejects(writer.resolve("incoming"), "CONFIGURATION_TRANSITION_PENDING");
      await rejects(
        owner === "rollback" ? publisher.execute(publishPlan) : rollback.execute(rollbackPlan),
        "CONFIGURATION_TRANSITION_PENDING",
      );
      assert.equal(beforeSync, h.storage.sync.values);
      assert.equal(beforeState, h.storage.local.values[config.KEYS.state]);
      assert.equal(writes, h.writes.length);
    }
  });

  should("旧字段写入后被外部改动不能报告回退已提交", async () => {
    const { h, transaction } = await rollbackFixture({
      afterStep: (step) => {
        if (step === "sync") h.storage.sync.values.keyMappings = "map external scrollUp";
      },
    });
    const result = await transaction.execute(await transaction.preview());
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_RECOVERY_CONFLICT", result.code);
    assert.equal("map external scrollUp", h.storage.sync.values.keyMappings);
  });

  should("同步索引写入后消失不能报告发布已提交", async () => {
    const { h, publisher } = await publishFixture({
      afterStep: (step) => {
        if (step === "index") delete h.storage.sync.values[config.KEYS.index];
      },
    });
    const result = await publisher.execute(await publisher.preview());
    assert.equal("ABORTED", result.phase);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, config.KEYS.index));
  });

  should("旧配置回退预演核算保留旧数据时的峰值并拒绝超额", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown", unrelated: "合成数据" } });
    const writer = h.create();
    await writer.read();
    const plan = await writer.prepareLegacyRollback();
    assert.isTrue(plan.capacity.peakBytes > 0);
    assert.isTrue(plan.capacity.peakItems > 0);
    h.storage.sync.QUOTA_BYTES = 100;
    const before = h.writes.length;
    await rejects(writer.prepareLegacyRollback(), "browser-toolbox-sync-quota");
    assert.equal(before, h.writes.length);
    assert.equal("map a scrollDown", h.storage.sync.values.keyMappings);
    assert.equal("合成数据", h.storage.sync.values.unrelated);
  });

  should("旧配置回退预演先计新值再计删除，不能用最终体积掩盖峰值", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await writer.commit({
      legacyPatch: {
        keyMappings: Settings.defaultOptions.keyMappings,
        searchEngines: "x: https://example.invalid/?q=%s " + "a".repeat(5400),
      },
    });
    h.storage.sync.values.keyMappings = "旧".repeat(2300);
    h.storage.sync.values.searchEngines = "旧搜索";
    const plan = await writer.prepareLegacyRollback();
    const initial = clone(h.storage.sync.values);
    const projected = { ...initial, ...plan.target };
    for (const key of plan.remove) delete projected[key];
    const size = (value) =>
      Object.entries(value).reduce((sum, [key, item]) => sum + config.itemBytes(key, item), 0);
    h.storage.sync.QUOTA_BYTES = Math.max(size(initial), size(projected));
    assert.isTrue(plan.capacity.peakBytes > h.storage.sync.QUOTA_BYTES);
    const before = h.writes.length;
    await rejects(writer.prepareLegacyRollback(), "browser-toolbox-sync-quota");
    assert.equal(before, h.writes.length);
    assert.equal(initial, h.storage.sync.values);
  });

  should("兼容提交先写新键后删旧键，临时峰值超额时在任何写入前拒绝", async () => {
    const h = harness({ sync: { keyMappings: "旧".repeat(2000), searchEngines: "" } });
    const writer = h.create();
    await writer.read();
    const beforeSync = clone(h.storage.sync.values);
    const beforeLocal = clone(h.storage.local.values);
    const beforeWrites = h.writes.length;
    const nextSearch = "s: https://example.invalid/?q=%s " + "a".repeat(5900);
    const projected = { ...clone(beforeSync), searchEngines: nextSearch };
    delete projected.keyMappings;
    const intermediate = { ...clone(beforeSync), searchEngines: nextSearch };
    const size = (values) =>
      Object.entries(values).reduce(
        (sum, [key, value]) => sum + config.itemBytes(key, value),
        0,
      );
    h.storage.sync.QUOTA_BYTES = Math.max(size(beforeSync), size(projected)) + 1;
    assert.isTrue(size(intermediate) > h.storage.sync.QUOTA_BYTES);
    await rejects(
      writer.commit({
        legacyPatch: {
          keyMappings: Settings.defaultOptions.keyMappings,
          searchEngines: nextSearch,
        },
      }),
      "browser-toolbox-sync-quota",
    );
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("兼容提交先增加新键再删旧键时检查临时项目数量峰值", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const writer = h.create();
    await writer.read();
    const beforeSync = clone(h.storage.sync.values);
    const beforeWrites = h.writes.length;
    assert.isFalse(Object.hasOwn(beforeSync, "searchEngines"));
    h.storage.sync.MAX_ITEMS = Object.keys(beforeSync).length;
    await rejects(
      writer.commit({
        legacyPatch: {
          keyMappings: Settings.defaultOptions.keyMappings,
          searchEngines: "s: https://example.invalid/?q=%s",
        },
      }),
      "CONFIGURATION_SYNC_ITEMS",
    );
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("规范 local 优先于同步和旧标识，关闭工具箱同步仍保留键盘 sync", async () => {
    const local = clone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS);
    local.general.browserSyncEnabled = false;
    const h = harness({
      local: { browserToolboxSettings: local, openKeyMouseSettings: { schemaVersion: 0 } },
    });
    const writer = h.create();
    const view = await writer.read();
    assert.equal("local", view.toolboxSource.area);
    await writer.commit({ legacyPatch: { keyMappings: "map x scrollUp" } });
    assert.equal("map x scrollUp", h.storage.sync.values.keyMappings);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "browserToolboxSettings"));
    assert.isTrue(Object.hasOwn(h.storage.local.values, "openKeyMouseSettings"));
  });

  should("仅旧标识迁移到 schema 9 后仍保留原旧键", async () => {
    const h = harness({
      local: {
        openKeyMouseSettings: {
          schemaVersion: 0,
          gestureBindings: [{ pattern: ["L"], commandName: "goBack" }],
        },
      },
    });
    delete h.storage.sync.values.browserToolboxSettings;
    const view = await h.create().read();
    assert.equal(9, view.toolboxSource.value.schemaVersion);
    assert.equal("goBack", view.toolboxSource.value.mouse.bindings[0].commandName);
    assert.isTrue(Object.hasOwn(h.storage.local.values, "openKeyMouseSettings"));
  });

  should("读取失败不等于缺省，不写默认值覆盖旧数据", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const before = clone(h.storage.sync.values);
    h.controls.fail = (area, method) => area === "sync" && method === "get";
    await rejects(h.create().read());
    assert.equal(before, h.storage.sync.values);
    assert.equal([], h.writes);
  });

  should("迁移备份失败先停止，业务键不变", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const before = clone(h.storage.sync.values);
    h.controls.fail = (area, method, input) =>
      area === "local" && method === "set" && Object.hasOwn(input, config.KEYS.backup);
    await rejects(h.create().read());
    assert.equal(before, h.storage.sync.values);
    assert.isFalse(Object.hasOwn(h.storage.local.values, config.KEYS.index));
  });

  should("合法 6004 字节 CSS 不复制进工具箱同步项，逻辑值和旧 CSS 完整", async () => {
    const css = "/*" + "a".repeat(6000) + "*/";
    const h = harness({ sync: { userDefinedLinkHintCss: css } });
    const view = await h.create().read();
    assert.equal(css, view.keyboard.userDefinedLinkHintCss);
    assert.equal(css, h.storage.sync.values.userDefinedLinkHintCss);
    assert.isTrue(
      config.itemBytes("browserToolboxSettings", h.storage.sync.values.browserToolboxSettings) <
        8192,
    );
    assert.isFalse(
      Object.hasOwn(
        h.storage.sync.values.browserToolboxSettings.keyboard,
        "userDefinedLinkHintCss",
      ),
    );
  });

  should("旧兼容 sync 单项超额仍拒绝，分片不静默绕过或关闭同步", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const before = clone(h.storage.sync.values);
    await rejects(
      writer.commit({ legacyPatch: { userDefinedLinkHintCss: "/*" + "a".repeat(9000) + "*/" } }),
      "browser-toolbox-sync-quota",
    );
    assert.equal(before, h.storage.sync.values);
    assert.equal(true, h.storage.sync.values.browserToolboxSettings.general.browserSyncEnabled);
  });

  should("旧字段中的小于号按浏览器转义后的字节预检，不先写入超额值", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const beforeSync = clone(h.storage.sync.values);
    const beforeWrites = h.writes.length;
    await rejects(
      writer.commit({ legacyPatch: { userDefinedLinkHintCss: "<".repeat(1400) } }),
      "browser-toolbox-sync-quota",
    );
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(beforeWrites, h.writes.length);
  });

  should("旧版本本机分片沿用原大小规则读取，迁移预演按新规则重新分片", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const css = "/*" + "<".repeat(1200) + "*/";
    const saved = await writer.commit({ legacyPatch: { userDefinedLinkHintCss: css } });
    const index = clone(h.storage.local.values[config.KEYS.index]);
    const name = `${config.CHUNK_PREFIX}${index.operationId}:userDefinedLinkHintCss:0`;
    const legacyChunk = { operationId: index.operationId, part: 0, text: JSON.stringify(css) };
    assert.isTrue(config.itemBytes(name, legacyChunk) > config.MAX_CHUNK_BYTES);
    index.fields.userDefinedLinkHintCss.chunks = [name];
    h.storage.local.values[name] = legacyChunk;
    h.storage.local.values[config.KEYS.index] = clone(index);
    h.storage.local.values[config.KEYS.state].committedIndex = clone(index);
    h.storage.local.values[config.KEYS.state].afterIndex = clone(index);

    const fresh = h.create();
    assert.equal(css, (await fresh.read()).keyboard.userDefinedLinkHintCss);
    assert.equal("COMMITTED", h.storage.local.values[config.KEYS.state].phase);
    const plan = await fresh.prepareKeyboardSyncMigration();
    assert.equal(saved.revision, plan.revision);
    assert.isTrue(plan.index.fields.userDefinedLinkHintCss.chunks.length > 1);
    assert.isTrue(
      Object.entries(plan.chunks).every(([key, value]) =>
        config.itemBytes(key, value) <= config.MAX_CHUNK_BYTES
      ),
    );
  });

  should("总容量、项目数量和写频率都在业务写入前拒绝", async () => {
    for (const scenario of ["bytes", "items", "frequency"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      if (scenario === "bytes") h.storage.sync.QUOTA_BYTES = 1;
      if (scenario === "items") h.storage.sync.MAX_ITEMS = 1;
      if (scenario === "frequency") {
        h.storage.local.values[config.KEYS.frequency] = Array(120).fill(Date.now());
      }
      const before = clone(h.storage.sync.values);
      await rejects(writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } }));
      assert.equal(before, h.storage.sync.values);
    }
  });

  should("local 已有资源占满时停止备份，不删除资源腾空间", async () => {
    const h = harness({ local: { unrelatedAsset: "合成指针资源" } });
    h.storage.local.QUOTA_BYTES = 10;
    await rejects(h.create().read(), "CONFIGURATION_LOCAL_QUOTA");
    assert.equal("合成指针资源", h.storage.local.values.unrelatedAsset);
    assert.isFalse(Object.hasOwn(h.storage.local.values, config.KEYS.backup));
  });

  should("两个页面不同字段修改可合并，同一字段冲突不覆盖", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = await writer.read();
    await Promise.all([
      writer.commit({
        legacyPatch: { keyMappings: "map a scrollDown" },
        baseline: { keyboard: baseline.keyboard },
      }),
      writer.commit({
        legacyPatch: { searchEngines: "x: https://example.invalid/?q=%s 合成" },
        baseline: { keyboard: baseline.keyboard },
      }),
    ]);
    const result = await writer.read();
    assert.equal("map a scrollDown", result.keyboard.keyMappings);
    assert.equal("x: https://example.invalid/?q=%s 合成", result.keyboard.searchEngines);
    await rejects(
      writer.commit({
        legacyPatch: { keyMappings: "map a scrollUp" },
        baseline: { keyboard: baseline.keyboard },
      }),
      "browser-toolbox-settings-conflict",
    );
    assert.equal("map a scrollDown", h.storage.sync.values.keyMappings);
  });

  should("外部旧设备来源不明时保留双方，冲突选择暂不写入", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = await writer.read();
    await h.storage.sync.set({ keyMappings: "map z scrollUp" });
    const view = await writer.read();
    assert.equal(baseline.keyboard.keyMappings, view.keyboard.keyMappings);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map j scrollDown" } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.equal("map z scrollUp", h.storage.sync.values.keyMappings);
    await rejects(writer.resolve("incoming"), "CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
    assert.equal("map z scrollUp", h.storage.sync.values.keyMappings);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
  });

  should("冲突处置不得覆盖读取后到达的更新或改写冲突记录", async () => {
    for (const choice of ["committed", "incoming"]) {
      const h = harness({ sync: { keyMappings: "map baseline scrollUp" } });
      const writer = h.create();
      await writer.read();
      await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
      assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
      const before = clone(h.storage.local.values[config.KEYS.state]);
      const writesBefore = h.writes.length;
      const set = h.storage.sync.set;
      let intervened = false;
      h.storage.sync.set = async (items) => {
        if (Object.hasOwn(items, "keyMappings")) {
          intervened = true;
          h.storage.sync.values.keyMappings = "map newer scrollDown";
        }
        return await set.call(h.storage.sync, items);
      };
      let failure;
      try {
        await writer.resolve(choice);
      } catch (caught) {
        failure = caught;
      }
      if (intervened) assert.equal("map newer scrollDown", h.storage.sync.values.keyMappings);
      assert.equal("CONFIGURATION_CONFLICT_REVIEW_REQUIRED", failure?.code);
      assert.isFalse(intervened);
      assert.equal(writesBefore, h.writes.length);
      assert.equal(before, h.storage.local.values[config.KEYS.state]);
      assert.equal("map remote scrollUp", h.storage.sync.values.keyMappings);
    }
  });

  should("冲突记录的只读导出保留已提交值和观察到的已知来源，不授权处置", async () => {
    const h = harness();
    const writer = h.create();
    const committed = await writer.read();
    const rules = [{ pattern: "https://example.invalid/*", passKeys: "", future: { keep: true } }];
    await h.storage.sync.set({ keyMappings: "map remote scrollUp", exclusionRules: rules });
    h.storage.sync.values.syntheticUnrelated = "不得导出";
    h.storage.local.values.syntheticCursor = "不得导出";
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
    const beforeLocal = clone(h.storage.local.values);
    const beforeSync = clone(h.storage.sync.values);
    const writesBefore = h.writes.length;
    const exported = await writer.exportCompatibilityConflict();
    assert.equal(committed.keyboard.keyMappings, exported.committed.keyboard.keyMappings);
    assert.equal("map remote scrollUp", exported.observed.sync.keyMappings);
    assert.equal(rules, exported.observed.sync.exclusionRules);
    assert.equal(false, exported.writeAllowed);
    assert.equal(false, exported.releaseAllowed);
    assert.equal(false, exported.lineageVerified);
    assert.equal(false, exported.pointInTimeVerified);
    assert.equal(false, exported.includesUnknownTopLevelSyncKeys);
    assert.equal(false, exported.includesSeparateLocalCursorAssets);
    assert.isFalse(JSON.stringify(exported).includes("不得导出"));
    assert.equal(beforeLocal, h.storage.local.values);
    assert.equal(beforeSync, h.storage.sync.values);
    assert.equal(writesBefore, h.writes.length);
  });

  should("只读导出拒绝未形成冲突、待处理事务及观察期间变化", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await rejects(writer.exportCompatibilityConflict(), "CONFIGURATION_CONFLICT_UNAVAILABLE");
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    await writer.preview();
    h.storage.local.values[ROLLBACK_JOURNAL_KEY] = { synthetic: true };
    await rejects(writer.exportCompatibilityConflict(), "CONFIGURATION_TRANSITION_PENDING");
    delete h.storage.local.values[ROLLBACK_JOURNAL_KEY];
    const get = h.storage.sync.get;
    let reads = 0;
    h.storage.sync.get = async (keys) => {
      const result = await get.call(h.storage.sync, keys);
      if (Array.isArray(keys) && keys.includes("keyMappings") && ++reads === 1) {
        h.storage.sync.values.keyMappings = "map newer scrollDown";
      }
      return result;
    };
    const beforeState = clone(h.storage.local.values[config.KEYS.state]);
    const writesBefore = h.writes.length;
    await rejects(writer.exportCompatibilityConflict(), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal("map newer scrollDown", h.storage.sync.values.keyMappings);
    assert.equal(beforeState, h.storage.local.values[config.KEYS.state]);
    assert.equal(writesBefore, h.writes.length);
  });

  should("恢复冲突可只读导出；提交代次缺片时不能把缓存冒充完整记录", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    await writer.preview();
    h.storage.local.values[config.KEYS.state].phase = "ABORTED";
    h.storage.local.values[config.KEYS.state].code = "CONFIGURATION_RECOVERY_CONFLICT";
    const exported = await writer.exportCompatibilityConflict();
    assert.equal("CONFIGURATION_RECOVERY_CONFLICT", exported.conflictCode);
    const index = h.storage.local.values[config.KEYS.index];
    delete h.storage.local.values[index.fields.keyMappings.chunks[0]];
    const before = clone(h.storage.local.values[config.KEYS.state]);
    const writesBefore = h.writes.length;
    await rejects(writer.exportCompatibilityConflict(), "INCOMPLETE_CONFIGURATION_GENERATION");
    assert.equal(before, h.storage.local.values[config.KEYS.state]);
    assert.equal("map remote scrollUp", h.storage.sync.values.keyMappings);
    assert.equal(writesBefore, h.writes.length);
  });

  should("首次检测到外部配置后持久保留双方观察，即使外部再变化仍阻止写入", async () => {
    const h = harness({ sync: { keyMappings: "map base scrollDown" } });
    const writer = h.create();
    const committed = await writer.read();
    const priorState = clone(h.storage.local.values[config.KEYS.state]);
    await h.storage.sync.set({ keyMappings: "map first scrollUp" });
    const first = await writer.preview();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", first.code);
    assert.equal("saved", first.captureStatus);
    assert.equal(priorState, h.storage.local.values[config.KEYS.state]);
    const records = await writer.listCompatibilityConflictObservations();
    assert.equal(1, records.length);
    assert.equal("saved", records[0].status);
    await h.storage.sync.set({ keyMappings: "map later scrollDown" });
    const reader = h.create();
    const stored = await reader.exportCompatibilityConflictObservation(records[0].key);
    assert.equal(committed.keyboard.keyMappings, stored.committed.keyboard.keyMappings);
    assert.equal("map first scrollUp", stored.observed.keyboard.keyMappings);
    assert.equal("map later scrollDown", h.storage.sync.values.keyMappings);
    assert.equal(false, stored.writeAllowed);
    assert.equal(false, stored.releaseAllowed);
    assert.equal(false, stored.lineageVerified);
    assert.equal(false, stored.pointInTimeVerified);
    assert.equal(false, stored.includesSeparateLocalCursorAssets);
    assert.equal(false, stored.includesUnknownTopLevelSyncKeys);
    await h.storage.sync.set({ keyMappings: committed.keyboard.keyMappings });
    await rejects(
      reader.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    await rejects(reader.rollback(), "CONFIGURATION_EXTERNAL_CONFLICT");
    assert.equal(priorState, h.storage.local.values[config.KEYS.state]);
    assert.equal(committed.keyboard.keyMappings, h.storage.sync.values.keyMappings);
  });

  async function searchDefaultConflictFixture(options = {}) {
    const oldDefault = "bd: https://www.baidu.com/s?wd=%s 百度";
    const h = harness();
    const oldWriter = h.create({
      defaults: () => ({ ...Settings.defaultOptions, searchEngines: oldDefault }),
    });
    const before = await oldWriter.read();
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "searchEngines"));
    // 显式同步值可能来自其他设备，仍应保留人工复核流程。
    h.storage.sync.values.searchEngines = Settings.defaultOptions.searchEngines;
    const writer = h.create(options);
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
    const [item] = await writer.listCompatibilityConflictObservations();
    const review = await writer.reviewCompatibilityConflictObservation(item.key);
    return { h, writer, before, item, review };
  }

  should("旧默认搜索规则升级时保留原值，保存其他设置不写入缺失的同步键", async () => {
    const oldDefault = "bd: https://www.baidu.com/s?wd=%s 百度";
    const h = harness();
    const oldWriter = h.create({
      defaults: () => ({ ...Settings.defaultOptions, searchEngines: oldDefault }),
    });
    const original = await oldWriter.read();
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "searchEngines"));
    h.writes.length = 0;
    const writer = h.create();
    assert.equal(null, (await writer.preview()).code);
    assert.equal(oldDefault, (await writer.read()).keyboard.searchEngines);
    assert.equal(0, (await writer.listCompatibilityConflictObservations()).length);
    const saved = await writer.commit({ legacyPatch: { smoothScroll: false } });
    assert.equal(false, saved.keyboard.smoothScroll);
    assert.equal(oldDefault, saved.keyboard.searchEngines);
    assert.equal(original.toolboxSource, saved.toolboxSource);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "searchEngines"));
    assert.isFalse(h.writes.some((write) => write.name === "sync" && write.keys.includes("searchEngines")));
    assert.equal(oldDefault, (await h.create().read()).keyboard.searchEngines);
    const changed = await h.create().commit({
      legacyPatch: { searchEngines: Settings.defaultOptions.searchEngines },
    });
    assert.equal(Settings.defaultOptions.searchEngines, changed.keyboard.searchEngines);
    assert.equal(Settings.defaultOptions.searchEngines, (await h.create().read()).keyboard.searchEngines);
  });

  should("已经保存的旧默认误报在升级后自动归档并保留百度和其他配置", async () => {
    const { h, before, item } = await searchDefaultConflictFixture();
    delete h.storage.sync.values.searchEngines;
    const syncBefore = clone(h.storage.sync.values);
    const writer = h.create();
    assert.equal(null, (await writer.preview()).code);
    const recovered = await writer.read();
    assert.equal(before.keyboard.searchEngines, recovered.keyboard.searchEngines);
    assert.equal(before.toolboxSource, recovered.toolboxSource);
    assert.equal(syncBefore, h.storage.sync.values);
    const [archive] = await writer.listCompatibilityConflictObservations();
    assert.equal("archived", archive.status);
    assert.equal(item.key.replace("m2-observation:", "m2-archive:"), archive.key);
    const saved = await writer.commit({ legacyPatch: { smoothScroll: false } });
    assert.equal(before.keyboard.searchEngines, saved.keyboard.searchEngines);
    assert.isFalse(Object.hasOwn(h.storage.sync.values, "searchEngines"));
  });

  should("自动兼容不吞掉明确同步值、其他变更或额外观察", async () => {
    for (const scenario of ["explicit", "empty", "custom", "other-field", "extra-observation", "quota"]) {
      const { h, writer, item } = await searchDefaultConflictFixture();
      if (scenario !== "explicit") delete h.storage.sync.values.searchEngines;
      if (scenario === "empty") h.storage.sync.values.searchEngines = "";
      if (scenario === "custom") h.storage.sync.values.searchEngines = "x: https://example.invalid/?q=%s";
      if (scenario === "other-field") h.storage.sync.values.keyMappings = "map a scrollUp";
      if (scenario === "extra-observation") await writer.captureCurrentCompatibilityConflict();
      if (scenario === "quota") h.storage.local.QUOTA_BYTES = 1;
      const syncBefore = clone(h.storage.sync.values);
      const reader = h.create();
      assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await reader.preview()).code);
      await rejects(reader.commit({ legacyPatch: { smoothScroll: false } }));
      assert.equal(syncBefore, h.storage.sync.values);
      assert.isTrue(Object.hasOwn(h.storage.local.values, item.key));
    }
  });

  should("自动归档遇到同步来源变化时保留观察和新配置", async () => {
    for (const stage of ["search-default-auto-archive", "search-default-auto-archived"]) {
      const { h, item } = await searchDefaultConflictFixture();
      delete h.storage.sync.values.searchEngines;
      let changed = false;
      const reader = h.create({
        afterStep: async (current) => {
          if (current === stage && !changed) {
            changed = true;
            await h.storage.sync.set({ searchEngines: "x: https://example.invalid/?q=%s" });
          }
        },
      });
      assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await reader.preview()).code);
      assert.equal("x: https://example.invalid/?q=%s", h.storage.sync.values.searchEngines);
      assert.isTrue(Object.hasOwn(h.storage.local.values, item.key));
      await rejects(reader.commit({ legacyPatch: { smoothScroll: false } }));
    }
  });

  should("首次识别旧默认时同步值发生变化会进入冲突保护", async () => {
    const h = harness();
    const oldDefault = "bd: https://www.baidu.com/s?wd=%s 百度";
    await h.create({ defaults: () => ({ ...Settings.defaultOptions, searchEngines: oldDefault }) }).read();
    const originalGet = h.storage.sync.get;
    let changed = false;
    h.storage.sync.get = async function (keys) {
      const result = await originalGet.call(this, keys);
      if (!changed && Array.isArray(keys) && keys.includes("searchEngines")) {
        changed = true;
        this.values.searchEngines = "x: https://example.invalid/?q=%s";
      }
      return result;
    };
    const reader = h.create();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await reader.preview()).code);
    assert.equal("x: https://example.invalid/?q=%s", h.storage.sync.values.searchEngines);
    await rejects(reader.commit({ legacyPatch: { smoothScroll: false } }));
  });

  should("保存其他设置时出现新的同步搜索规则不会覆盖新值", async () => {
    const h = harness();
    const oldDefault = "bd: https://www.baidu.com/s?wd=%s 百度";
    const incoming = "x: https://example.invalid/?q=%s";
    await h.create({ defaults: () => ({ ...Settings.defaultOptions, searchEngines: oldDefault }) }).read();
    let changed = false;
    const writer = h.create({
      afterStep: async (stage) => {
        if (stage === 0 && !changed) {
          changed = true;
          await h.storage.sync.set({ searchEngines: incoming });
        }
      },
    });
    await writer.read();
    await rejects(writer.commit({ legacyPatch: { smoothScroll: false } }));
    assert.isTrue(changed);
    assert.equal(incoming, h.storage.sync.values.searchEngines);
    assert.equal("CONFIGURATION_RECOVERY_CONFLICT", (await h.create().preview()).code);
  });

  should("自动归档或无关设置提交中断后仍能恢复原值", async () => {
    for (const stage of ["search-default-auto-archive", "search-default-auto-archived"]) {
      const { h, before } = await searchDefaultConflictFixture();
      delete h.storage.sync.values.searchEngines;
      const syncBefore = clone(h.storage.sync.values);
      const stopped = Object.assign(new Error("合成终止"), { simulatedTermination: true });
      const reader = h.create({ afterStep: (current) => { if (current === stage) throw stopped; } });
      await rejects(reader.read());
      const restarted = h.create();
      assert.equal(null, (await restarted.preview()).code);
      assert.equal(before.keyboard.searchEngines, (await restarted.read()).keyboard.searchEngines);
      assert.equal(syncBefore, h.storage.sync.values);
      assert.isTrue((await restarted.listCompatibilityConflictObservations()).some((entry) =>
        entry.status === "archived"
      ));
    }
    for (const stage of [0, 1]) {
      const h = harness();
      const oldDefault = "bd: https://www.baidu.com/s?wd=%s 百度";
      await h.create({ defaults: () => ({ ...Settings.defaultOptions, searchEngines: oldDefault }) }).read();
      const stopped = Object.assign(new Error("合成终止"), { simulatedTermination: true });
      const writer = h.create({ afterStep: (current) => { if (current === stage) throw stopped; } });
      await writer.read();
      await rejects(writer.commit({ legacyPatch: { smoothScroll: false } }));
      const restarted = h.create();
      assert.equal(null, (await restarted.preview()).code);
      assert.equal(oldDefault, (await restarted.read()).keyboard.searchEngines);
      assert.isFalse(Object.hasOwn(h.storage.sync.values, "searchEngines"));
    }
  });

  should("用户选当前 Google 规则后仅更新本机代次并保留可导出的原观察", async () => {
    const { h, writer, before, item, review } = await searchDefaultConflictFixture();
    assert.isTrue(review.searchDefaultRecoveryAvailable);
    assert.equal(["/keyboard/searchEngines"], review.fields.map((field) => field.path));
    const syncBefore = clone(h.storage.sync.values);
    const writesBefore = h.writes.length;
    const recovered = await writer.recoverSearchDefaultConflict(item.key, review.recordDigest);
    assert.equal(Settings.defaultOptions.searchEngines, recovered.keyboard.searchEngines);
    assert.equal(before.toolboxSource, recovered.toolboxSource);
    assert.equal(syncBefore, h.storage.sync.values);
    assert.isFalse(h.writes.slice(writesBefore).some((entry) => entry.name === "sync"));
    assert.equal(null, (await h.create().preview()).code);
    const [archive] = await writer.listCompatibilityConflictObservations();
    assert.equal("archived", archive.status);
    const saved = await writer.exportCompatibilityConflictObservation(archive.key);
    assert.equal(before.keyboard.searchEngines, saved.committed.keyboard.searchEngines);
    assert.equal(Settings.defaultOptions.searchEngines, saved.observed.keyboard.searchEngines);
    assert.isFalse((await writer.reviewCompatibilityConflictObservation(archive.key))
      .searchDefaultRecoveryAvailable);
    const changed = await writer.commit({ legacyPatch: { smoothScroll: false } });
    assert.equal(false, changed.keyboard.smoothScroll);
    assert.equal(Settings.defaultOptions.searchEngines, changed.keyboard.searchEngines);
  });

  should("搜索默认冲突的来源变化、额外观察和摘要变化均不能解除保护", async () => {
    for (const scenario of ["search", "other-field", "extra-observation", "digest", "quota"]) {
      const { h, writer, item, review } = await searchDefaultConflictFixture();
      const syncBefore = clone(h.storage.sync.values);
      if (scenario === "search") await h.storage.sync.set({ searchEngines: "x: https://example.invalid/?q=%s" });
      if (scenario === "other-field") await h.storage.sync.set({ keyMappings: "map a scrollUp" });
      if (scenario === "extra-observation") await writer.captureCurrentCompatibilityConflict();
      if (scenario === "quota") h.storage.local.QUOTA_BYTES = 1;
      const expectedSync = clone(h.storage.sync.values);
      const digest = scenario === "digest" ? "0".repeat(64) : review.recordDigest;
      await rejects(writer.recoverSearchDefaultConflict(item.key, digest));
      assert.equal(expectedSync, h.storage.sync.values);
      assert.isTrue(Object.hasOwn(h.storage.local.values, item.key));
      assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await h.create().preview()).code);
      if (!["search", "other-field"].includes(scenario)) assert.equal(syncBefore, expectedSync);
    }
  });

  should("搜索默认恢复中的中断不会丢失观察或覆盖同步值", async () => {
    for (const stage of ["search-default-archive", "search-default-archived", 0, 1]) {
      const stopped = Object.assign(new Error("合成终止"), { simulatedTermination: true });
      const { h, writer, item, review } = await searchDefaultConflictFixture({
        afterStep: (current) => {
          if (current === stage) throw stopped;
        },
      });
      const beforeSync = clone(h.storage.sync.values);
      await rejects(writer.recoverSearchDefaultConflict(item.key, review.recordDigest));
      const reader = h.create();
      const preview = await reader.preview();
      assert.equal(beforeSync, h.storage.sync.values);
      const records = await reader.listCompatibilityConflictObservations();
      assert.isTrue(records.some((entry) => entry.status === "archived"));
      if (stage === "search-default-archive" || stage === "search-default-archived") {
        assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", preview.code);
        assert.isTrue(records.some((entry) => entry.status === "saved"));
      } else {
        assert.equal(null, preview.code);
        assert.equal(Settings.defaultOptions.searchEngines, (await reader.read()).keyboard.searchEngines);
      }
    }
  });

  should("搜索默认恢复期间同步内容变化时保留新内容并阻止继续保存", async () => {
    for (const stage of ["search-default-archive", "search-default-archived", 0]) {
      const test = { h: null };
      const fixture = await searchDefaultConflictFixture({
        afterStep: async (current) => {
          if (current === stage) await test.h.storage.sync.set({ keyMappings: "map newer scrollUp" });
        },
      });
      const { h, writer, item, review } = fixture;
      test.h = h;
      await rejects(writer.recoverSearchDefaultConflict(item.key, review.recordDigest));
      assert.equal("map newer scrollUp", h.storage.sync.values.keyMappings);
      const reader = h.create();
      const preview = await reader.preview();
      assert.isTrue(Boolean(preview.code));
      await rejects(reader.commit({ legacyPatch: { smoothScroll: false } }));
      assert.equal("map newer scrollUp", h.storage.sync.values.keyMappings);
      assert.isTrue((await reader.listCompatibilityConflictObservations()).some((entry) =>
        entry.status === "archived"
      ));
    }
  });

  async function reviewObservationFixture() {
    const h = harness({ sync: { keyMappings: "map base scrollDown", smoothScroll: true } });
    const writer = h.create();
    const initial = await writer.read();
    const toolbox = clone(h.storage.sync.values[config.KEYS.toolbox]);
    toolbox.general.showHud = !toolbox.general.showHud;
    toolbox.mouse.bindings = [];
    await h.storage.sync.set({
      keyMappings: "map other scrollUp",
      smoothScroll: false,
      [config.KEYS.toolbox]: toolbox,
    });
    assert.equal("saved", (await writer.preview()).captureStatus);
    const [saved] = await writer.listCompatibilityConflictObservations();
    return { h, writer, initial, key: saved.key };
  }

  should("保存的冲突观察逐项要求用户选择，生成候选但不改写任何存储", async () => {
    const { h, writer, initial, key } = await reviewObservationFixture();
    const before = clone({ local: h.storage.local.values, sync: h.storage.sync.values });
    const writes = h.writes.length;
    const review = await writer.reviewCompatibilityConflictObservation(key);
    const paths = review.fields.map((field) => field.path);
    assert.isTrue(paths.includes("/keyboard/keyMappings"));
    assert.isTrue(paths.includes("/keyboard/smoothScroll"));
    assert.isTrue(paths.includes("/toolbox/general/showHud"));
    assert.isTrue(paths.includes("/toolbox/mouse/bindings"));
    assert.isFalse(paths.some((path) => path.startsWith("/toolbox/mouse/bindings/")));
    assert.equal(false, review.writeAllowed);
    assert.equal(false, review.releaseAllowed);
    assert.equal(false, review.lineageVerified);
    assert.equal(false, review.pointInTimeVerified);
    const choices = review.fields.map(({ path }) => ({
      path,
      side: path === "/keyboard/keyMappings" || path === "/toolbox/mouse/bindings"
        ? "observed"
        : "committed",
    }));
    const candidate = await writer.prepareCompatibilityConflictCandidate(
      key,
      review.recordDigest,
      choices,
    );
    assert.equal("map other scrollUp", candidate.keyboard.keyMappings);
    assert.equal(true, candidate.keyboard.smoothScroll);
    assert.equal(initial.toolboxSource.value.general.showHud, candidate.toolbox.general.showHud);
    assert.equal([], candidate.toolbox.mouse.bindings);
    assert.equal(false, candidate.writeAllowed);
    assert.equal(false, candidate.releaseAllowed);
    assert.equal(before, { local: h.storage.local.values, sync: h.storage.sync.values });
    assert.equal(writes, h.writes.length);
    await rejects(
      writer.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    await rejects(
      writer.importConfiguration({
        legacyPatch: { smoothScroll: false },
        toolbox: candidate.toolbox,
      }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
  });

  should("同步开关决定候选区域，未知字段标记不能当作完整观察复核", async () => {
    const h = harness();
    const writer = h.create();
    const original = await writer.read();
    const local = clone(original.toolboxSource.value);
    local.general.browserSyncEnabled = false;
    await h.storage.local.set({ [config.KEYS.toolbox]: local });
    assert.equal("saved", (await writer.preview()).captureStatus);
    const [record] = await writer.listCompatibilityConflictObservations();
    const review = await writer.reviewCompatibilityConflictObservation(record.key);
    assert.isTrue(
      review.fields.some((field) => field.path === "/toolbox/general/browserSyncEnabled"),
    );
    const choices = review.fields.map(({ path }) => ({ path, side: "observed" }));
    const candidate = await writer.prepareCompatibilityConflictCandidate(
      record.key,
      review.recordDigest,
      choices,
    );
    assert.equal("local", candidate.area);
    assert.equal(false, candidate.toolbox.general.browserSyncEnabled);

    const unknown = harness();
    const unknownWriter = unknown.create();
    await unknownWriter.read();
    const source = clone(unknown.storage.sync.values[config.KEYS.toolbox]);
    source.unrecognizedSyntheticField = "不能被捕获的正文";
    await unknown.storage.sync.set({ [config.KEYS.toolbox]: source });
    assert.equal("unsupported", (await unknownWriter.preview()).captureStatus);
    const [marker] = await unknownWriter.listCompatibilityConflictObservations();
    await rejects(
      unknownWriter.reviewCompatibilityConflictObservation(marker.key),
      "UNSUPPORTED_CONFIGURATION_FIELDS",
    );
    assert.equal(source, unknown.storage.sync.values[config.KEYS.toolbox]);
  });

  should("复核候选拒绝遗漏、重复、多余和非法选择，不能用旧摘要冒充当前记录", async () => {
    const { h, writer, key } = await reviewObservationFixture();
    const review = await writer.reviewCompatibilityConflictObservation(key);
    const choices = review.fields.map(({ path }) => ({ path, side: "observed" }));
    for (
      const invalid of [
        choices.slice(1),
        [...choices, choices[0]],
        [...choices, { path: "/keyboard/unknown", side: "committed" }],
        choices.map((item, index) => index ? item : { ...item, side: "newest" }),
      ]
    ) {
      await rejects(
        writer.prepareCompatibilityConflictCandidate(key, review.recordDigest, invalid),
        "INVALID_CONFIGURATION_CONFLICT_CHOICES",
      );
    }
    await rejects(
      writer.prepareCompatibilityConflictCandidate(key, "0".repeat(64), choices),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    h.storage.local.values[key].observed.keyboard.keyMappings = "map tampered scrollDown";
    await rejects(
      writer.reviewCompatibilityConflictObservation(key),
      "CONFIGURATION_DIGEST_MISMATCH",
    );
    await rejects(
      writer.prepareCompatibilityConflictCandidate(key, review.recordDigest, choices),
      "CONFIGURATION_DIGEST_MISMATCH",
    );
  });

  should("排队前固定冲突选择，入队后修改调用方对象不能改变候选", async () => {
    const { writer, key } = await reviewObservationFixture();
    const review = await writer.reviewCompatibilityConflictObservation(key);
    const choices = review.fields.map(({ path }) => ({ path, side: "observed" }));
    let release;
    const blocker = writer.enqueue(() => new Promise((resolve) => release = resolve));
    while (!release) await Promise.resolve();
    const pending = writer.prepareCompatibilityConflictCandidate(key, review.recordDigest, choices);
    for (const item of choices) item.side = "committed";
    release();
    await blocker;
    assert.equal("map other scrollUp", (await pending).keyboard.keyMappings);
  });

  should("复核过程中记录变化或正文过大时拒绝，不生成局部候选", async () => {
    const { h, writer, key } = await reviewObservationFixture();
    const get = h.storage.local.get;
    let reads = 0;
    h.storage.local.get = async (keys) => {
      const values = await get.call(h.storage.local, keys);
      if (keys === key && ++reads === 1) delete h.storage.local.values[key];
      return values;
    };
    await rejects(
      writer.reviewCompatibilityConflictObservation(key),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    h.storage.local.get = get;

    const large = harness();
    const largeWriter = large.create();
    await largeWriter.read();
    await large.storage.sync.set({
      keyMappings: "a".repeat(200000),
      searchEngines: "b".repeat(200000),
      userDefinedLinkHintCss: "c".repeat(200000),
    });
    assert.equal("saved", (await largeWriter.preview()).captureStatus);
    const [record] = await largeWriter.listCompatibilityConflictObservations();
    await rejects(
      largeWriter.reviewCompatibilityConflictObservation(record.key),
      "CONFIGURATION_CONFLICT_REVIEW_TOO_LARGE",
    );
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await largeWriter.preview()).code);
  });

  should("规则有未知字段时仅保存冲突标记，不把未知内容自动放入本机快照", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const priorState = clone(h.storage.local.values[config.KEYS.state]);
    const rules = [{ pattern: "x", passKeys: "", future: "synthetic-private-value" }];
    await h.storage.sync.set({ exclusionRules: rules });
    const result = await writer.preview();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    assert.equal("unsupported", result.captureStatus);
    const records = await writer.listCompatibilityConflictObservations();
    assert.equal("unsupported", records[0].status);
    const saved = h.storage.local.values[records[0].key];
    assert.isFalse(JSON.stringify(saved).includes("synthetic-private-value"));
    assert.equal(rules, h.storage.sync.values.exclusionRules);
    assert.equal(priorState, h.storage.local.values[config.KEYS.state]);
    await rejects(
      writer.exportCompatibilityConflictObservation(records[0].key),
      "UNSUPPORTED_CONFIGURATION_FIELDS",
    );
  });

  should("工具箱未知字段不会自动进入冲突观察或本机标记", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const external = clone(h.storage.sync.values[config.KEYS.toolbox]);
    external.futurePrivate = "synthetic-private-value";
    await h.storage.sync.set({ [config.KEYS.toolbox]: external });
    const result = await writer.preview();
    assert.equal("unsupported", result.captureStatus);
    const [marker] = await writer.listCompatibilityConflictObservations();
    assert.equal("unsupported", marker.status);
    assert.isFalse(
      JSON.stringify(h.storage.local.values[marker.key]).includes("synthetic-private"),
    );
    assert.equal(external, h.storage.sync.values[config.KEYS.toolbox]);
  });

  should("开放式绑定参数中的未知或敏感字段不能自动进入冲突备份", async () => {
    for (const name of ["futureOption", "inputToken"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const external = clone(h.storage.sync.values[config.KEYS.toolbox]);
      external.mouse.bindings[0].options[name] = "synthetic-private-value";
      await h.storage.sync.set({ [config.KEYS.toolbox]: external });
      const result = await writer.preview();
      assert.equal("unsupported", result.captureStatus);
      const [marker] = await writer.listCompatibilityConflictObservations();
      assert.equal("unsupported", marker.status);
      assert.isFalse(
        JSON.stringify(h.storage.local.values[marker.key]).includes("synthetic-private"),
      );
      assert.equal(external, h.storage.sync.values[config.KEYS.toolbox]);
    }
  });

  should("冲突观察写入失败时不覆盖原状态，仍可只读导出当前来源", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const before = clone(h.storage.local.values[config.KEYS.state]);
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    h.controls.fail = (area, method, values) =>
      area === "local" && method === "set" &&
      Object.keys(values).some((key) => key.startsWith(config.M2_CONFLICT_CAPTURE_PREFIX));
    const result = await writer.preview();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    assert.equal("failed", result.captureStatus);
    const observed = await writer.exportCompatibilityConflict();
    assert.equal("map remote scrollUp", observed.observed.sync.keyMappings);
    assert.equal(before, h.storage.local.values[config.KEYS.state]);
    assert.equal([], await writer.listCompatibilityConflictObservations());
    await rejects(
      writer.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
  });

  should("冲突观察额度不足时保留事务和来源、报告未保存并阻止本机提交", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const before = clone(h.storage.local.values[config.KEYS.state]);
    h.storage.local.values[`${config.TRANSITION_RECORD_PREFIX}synthetic-full`] = "x".repeat(
      config.MAX_BACKUP_BYTES,
    );
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    const result = await writer.preview();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    assert.equal("quota", result.captureStatus);
    assert.equal(before, h.storage.local.values[config.KEYS.state]);
    assert.equal("map remote scrollUp", h.storage.sync.values.keyMappings);
    await rejects(
      writer.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.equal([], await writer.listCompatibilityConflictObservations());
  });

  should("空间不足以保存正文但仍有余量时写入小标记，重启后继续阻止配置提交", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = await writer.read();
    const ownedBytes = Object.entries(h.storage.local.values).filter(([key]) =>
      key.startsWith(config.CHUNK_PREFIX) || Object.values(config.KEYS).includes(key)
    ).reduce((total, [key, value]) => total + config.itemBytes(key, value), 0);
    const paddingKey = `${config.TRANSITION_RECORD_PREFIX}synthetic-padding`;
    h.storage.local.values[paddingKey] = "x".repeat(config.MAX_BACKUP_BYTES - ownedBytes - 2048);
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    const result = await writer.preview();
    assert.equal("quota", result.captureStatus);
    const [marker] = await writer.listCompatibilityConflictObservations();
    assert.equal("quota", marker.status);
    await h.storage.sync.set({ keyMappings: baseline.keyboard.keyMappings });
    const reader = h.create();
    await rejects(
      reader.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.equal(baseline.keyboard.keyMappings, h.storage.sync.values.keyMappings);
  });

  should("冲突观察落盘时来源更新，已观察值与较新的外部值都不被覆盖", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await h.storage.sync.set({ keyMappings: "map first scrollUp" });
    const set = h.storage.local.set;
    let intervened = false;
    h.storage.local.set = async (items) => {
      if (Object.keys(items).some((key) => key.startsWith(config.M2_CONFLICT_CAPTURE_PREFIX))) {
        intervened = true;
        h.storage.sync.values.keyMappings = "map newer scrollDown";
      }
      return await set.call(h.storage.local, items);
    };
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await writer.preview()).code);
    const records = await writer.listCompatibilityConflictObservations();
    const saved = await writer.exportCompatibilityConflictObservation(records[0].key);
    assert.isTrue(intervened);
    assert.equal("map first scrollUp", saved.observed.keyboard.keyMappings);
    assert.equal("map newer scrollDown", h.storage.sync.values.keyMappings);
  });

  should("损坏的冲突记录仍阻止配置写入且不被列表清理", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const key = `${config.M2_CONFLICT_CAPTURE_PREFIX}synthetic-corrupt`;
    h.storage.local.values[key] = { synthetic: "损坏" };
    const writesBefore = h.writes.length;
    const reader = h.create();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await reader.preview()).code);
    const records = await reader.listCompatibilityConflictObservations();
    assert.equal("invalid", records[0].status);
    await rejects(reader.exportCompatibilityConflictObservation(key));
    await rejects(
      reader.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.equal(writesBefore, h.writes.length);
    assert.equal({ synthetic: "损坏" }, h.storage.local.values[key]);
  });

  should("首次提交尚未完成且有冲突记录时，不把已写入的新索引冒充已提交配置", async () => {
    const h = harness({ sync: { keyMappings: "map initial scrollUp" } });
    const writer = h.create({
      afterStep: (position, state) => {
        if (Object.hasOwn(state.steps[position]?.cells || {}, config.KEYS.index)) {
          throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
        }
      },
    });
    await rejects(writer.read());
    const state = clone(h.storage.local.values[config.KEYS.state]);
    assert.equal("APPLYING", state.phase);
    assert.equal(null, state.beforeIndex);
    assert.equal(state.afterIndex, h.storage.local.values[config.KEYS.index]);
    const guard = `${config.M2_CONFLICT_CAPTURE_PREFIX}synthetic-corrupt`;
    h.storage.local.values[guard] = { synthetic: true };
    const writesBefore = h.writes.length;
    const reader = h.create();
    await rejects(reader.read(), "CONFIGURATION_UNAVAILABLE");
    const exported = await reader.exportConfiguration();
    assert.equal("baseline", exported.source);
    await rejects(reader.exportCompatibilityConflict(), "CONFIGURATION_CONFLICT_UNAVAILABLE");
    assert.equal(state, h.storage.local.values[config.KEYS.state]);
    assert.equal(state.afterIndex, h.storage.local.values[config.KEYS.index]);
    assert.equal(writesBefore, h.writes.length);
  });

  should("已有提交再次中断且有冲突记录时只读原代次，不发布待提交的新值", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = await writer.read();
    writer.afterStep = (position, state) => {
      if (Object.hasOwn(state.steps[position]?.cells || {}, config.KEYS.index)) {
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      }
    };
    await rejects(writer.commit({ legacyPatch: { keyMappings: "map pending scrollUp" } }));
    const state = clone(h.storage.local.values[config.KEYS.state]);
    h.storage.local.values[`${config.M2_CONFLICT_CAPTURE_PREFIX}synthetic-corrupt`] = {};
    const writesBefore = h.writes.length;
    const reader = h.create();
    assert.equal(baseline.keyboard, (await reader.read()).keyboard);
    const exported = await reader.exportConfiguration();
    assert.equal("committed", exported.source);
    assert.equal(baseline.keyboard, exported.snapshot.keyboard);
    assert.equal(state, h.storage.local.values[config.KEYS.state]);
    assert.equal(writesBefore, h.writes.length);
  });

  should("观察记录落盘后中断可在全新后台发现并继续保护", async () => {
    const h = harness();
    const stop = Object.assign(new Error("合成终止"), { simulatedTermination: true });
    const writer = h.create({
      afterStep: (stage) => {
        if (stage === "compatibility-conflict-observation") throw stop;
      },
    });
    await writer.read();
    const priorState = clone(h.storage.local.values[config.KEYS.state]);
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    await rejects(writer.read());
    const reader = h.create();
    const result = await reader.preview();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", result.code);
    assert.equal("saved", result.captureStatus);
    const [record] = await reader.listCompatibilityConflictObservations();
    assert.equal(
      "map remote scrollUp",
      (await reader.exportCompatibilityConflictObservation(record.key)).observed.keyboard
        .keyMappings,
    );
    await rejects(
      reader.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
    assert.equal(priorState, h.storage.local.values[config.KEYS.state]);
  });

  should("旧冲突可手动保留当前观察，正常状态不能凭空创建冲突记录", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await rejects(
      writer.captureCurrentCompatibilityConflict(),
      "CONFIGURATION_CONFLICT_UNAVAILABLE",
    );
    h.storage.local.values[config.KEYS.state].phase = "ABORTED";
    h.storage.local.values[config.KEYS.state].code = "CONFIGURATION_RECOVERY_CONFLICT";
    await h.storage.sync.set({ keyMappings: "map later scrollUp" });
    const stateBefore = clone(h.storage.local.values[config.KEYS.state]);
    const result = await writer.captureCurrentCompatibilityConflict();
    assert.equal("saved", result.status);
    assert.equal(false, result.lineageVerified);
    assert.equal(false, result.writeAllowed);
    const [record] = await writer.listCompatibilityConflictObservations();
    assert.equal(
      "map later scrollUp",
      (await writer.exportCompatibilityConflictObservation(record.key)).observed.keyboard
        .keyMappings,
    );
    assert.equal(stateBefore, h.storage.local.values[config.KEYS.state]);
    assert.equal("map later scrollUp", h.storage.sync.values.keyMappings);
  });

  should("较旧浏览器没有键名列表接口时仍能发现冲突记录并停止写入", async () => {
    const h = harness();
    delete h.storage.local.getKeys;
    const writer = h.create();
    await writer.read();
    await h.storage.sync.set({ keyMappings: "map remote scrollUp" });
    assert.equal("saved", (await writer.preview()).captureStatus);
    const reader = h.create();
    assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", (await reader.preview()).code);
    await rejects(
      reader.commit({ legacyPatch: { smoothScroll: false } }),
      "CONFIGURATION_EXTERNAL_CONFLICT",
    );
  });

  should("迁移后新增修改回退用当前提交值，再启动仍完整", async () => {
    const h = harness({ sync: { keyMappings: "map a scrollDown" } });
    const writer = h.create();
    await writer.read();
    await writer.commit({ legacyPatch: { keyMappings: "map b scrollUp", searchEngines: "" } });
    await writer.rollback();
    assert.equal("map b scrollUp", h.storage.sync.values.keyMappings);
    const upgraded = await h.create().read();
    assert.equal("map b scrollUp", upgraded.keyboard.keyMappings);
    assert.equal("", upgraded.keyboard.searchEngines);
    assert.equal(
      "map a scrollDown",
      h.storage.local.values[config.KEYS.backup].baseline.keyboard.keyMappings,
    );
  });

  should("每个落盘步骤中断后由全新后台实例恢复，不重复提交 revision", async () => {
    const probe = harness();
    await probe.create().read();
    const stepCount = probe.storage.local.values[config.KEYS.state].steps.length;
    for (let position = 0; position < stepCount; position++) {
      const h = harness({ sync: { keyMappings: "map x scrollDown" } });
      const writer = h.create({
        afterStep: (step) => {
          if (step === position) {
            throw Object.assign(new Error("合成进程终止"), { simulatedTermination: true });
          }
        },
      });
      await rejects(writer.read());
      assert.equal("APPLYING", h.storage.local.values[config.KEYS.state].phase);
      const recovered = await h.create().read();
      assert.equal(1, recovered.revision);
      assert.equal("map x scrollDown", recovered.keyboard.keyMappings);
      assert.equal("COMMITTED", h.storage.local.values[config.KEYS.state].phase);
      assert.equal(recovered, await h.create().read());
    }
  });

  should("已准备记录未写业务时退出，下一实例完成恢复", async () => {
    const h = harness();
    let hit = false;
    h.controls.fail = (area, method, items) => {
      if (
        !hit && area === "local" && method === "set" &&
        items[config.KEYS.state]?.phase === "APPLYING"
      ) {
        hit = true;
        return true;
      }
      return false;
    };
    const result = await h.create().read();
    assert.equal(1, result.revision);
    assert.equal("COMMITTED", h.storage.local.values[config.KEYS.state].phase);
  });

  should("恢复遇到外部新值不覆盖，其他仍属于本次操作的值可补偿", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    writer.afterStep = (position) => {
      if (position === 0) {
        throw Object.assign(new Error("合成进程终止"), { simulatedTermination: true });
      }
    };
    await rejects(writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } }));
    await h.storage.sync.set({ keyMappings: "map external scrollDown" });
    const recovered = await h.create().read();
    assert.equal("map external scrollDown", h.storage.sync.values.keyMappings);
    assert.equal(1, recovered.revision);
    assert.equal("ABORTED", h.storage.local.values[config.KEYS.state].phase);
    assert.isTrue(h.storage.local.values[config.KEYS.state].conflicts.includes("sync.keyMappings"));
  });

  should("补偿写入失败保留恢复状态，后续实例可以继续", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    writer.afterStep = (position, state) => {
      if (
        Object.keys(state.steps[position].cells).some((key) => key.startsWith(config.CHUNK_PREFIX))
      ) {
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      }
    };
    await rejects(writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } }));
    await h.storage.sync.set({ keyMappings: "map external scrollDown" });
    h.controls.fail = (area, method, keys) =>
      area === "local" && method === "remove" && JSON.stringify(keys).includes(config.CHUNK_PREFIX);
    await rejects(h.create().read(), "CONFIGURATION_COMPENSATION_PENDING");
    assert.equal("RECOVERING", h.storage.local.values[config.KEYS.state].phase);
    h.controls.fail = null;
    await h.create().read();
    assert.equal("ABORTED", h.storage.local.values[config.KEYS.state].phase);
    assert.equal("map external scrollDown", h.storage.sync.values.keyMappings);
  });

  should("恢复记录不能写 session、Mark 或任意本地键", async () => {
    const h = harness();
    h.storage.local.values[config.KEYS.state] = {
      formatVersion: 1,
      phase: "APPLYING",
      operationId: "synthetic",
      steps: [{
        area: "local",
        cells: {
          "vimiumGlobalMark|X": {
            before: { present: false },
            after: { present: true, value: "合成攻击" },
          },
        },
      }],
    };
    await rejects(h.create().read(), "INVALID_CONFIGURATION_RECOVERY");
    assert.isFalse(Object.hasOwn(h.storage.local.values, "vimiumGlobalMark|X"));
  });

  should("不支持的新索引保持最后提交，不自动重写它", async () => {
    const h = harness();
    const writer = h.create();
    const baseline = await writer.read();
    const unsupported = { formatVersion: 999, revision: 999, fields: {} };
    await h.storage.local.set({ [config.KEYS.index]: unsupported });
    const view = await writer.read();
    assert.equal(baseline.keyboard, view.keyboard);
    await rejects(
      writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } }),
      "UNSUPPORTED_CONFIGURATION_FORMAT",
    );
    assert.equal(unsupported, h.storage.local.values[config.KEYS.index]);
  });

  should("连续提交仅保留最近两代分片和迁移基线，不线性积累备份", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    for (let cycle = 0; cycle < 10; cycle++) {
      await writer.commit({ legacyPatch: { keyMappings: `map a scrollDown count=${cycle + 1}` } });
    }
    const generations = new Set(
      Object.keys(h.storage.local.values).filter((key) => key.startsWith(config.CHUNK_PREFIX)).map((
        key,
      ) => key.split(":")[1]),
    );
    assert.equal(2, generations.size);
    assert.isTrue(Boolean(h.storage.local.values[config.KEYS.backup]));
  });

  should("未获当前索引提交的未来代次不被清理器删除", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const key = `${config.CHUNK_PREFIX}future-producer:keyMappings:0`;
    const future = { operationId: "future-producer", part: 0, text: "尚未提交的合成未来配置" };
    await h.storage.local.set({ [key]: future });
    for (let cycle = 0; cycle < 3; cycle++) {
      await writer.commit({ legacyPatch: { keyMappings: `map a scrollUp count=${cycle + 1}` } });
    }
    assert.equal(future, h.storage.local.values[key]);
  });

  should("已提交分片缺失时重启只读取摘要相符的最后快照并停止提交", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const saved = await writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } });
    const index = h.storage.local.values[config.KEYS.index];
    await h.storage.local.remove(index.fields.keyMappings.chunks[0]);
    const stateBefore = clone(h.storage.local.values[config.KEYS.state]);
    const writesBefore = h.writes.length;
    const fresh = h.create();
    assert.equal(saved.keyboard, (await fresh.read()).keyboard);
    assert.equal(stateBefore, h.storage.local.values[config.KEYS.state]);
    assert.equal(writesBefore, h.writes.length);
    assert.equal("INCOMPLETE_CONFIGURATION_GENERATION", (await fresh.preview()).code);
    await rejects(
      fresh.commit({ legacyPatch: { keyMappings: "map b scrollDown" } }),
      "INCOMPLETE_CONFIGURATION_GENERATION",
    );
    assert.equal("map a scrollUp", h.storage.sync.values.keyMappings);
  });

  should("缺片期间反复重启仍停止写入，分片恢复后可继续提交", async () => {
    const h = harness();
    const writer = h.create();
    const saved = await writer.read();
    const index = h.storage.local.values[config.KEYS.index];
    const name = index.fields.keyMappings.chunks[0];
    const chunk = clone(h.storage.local.values[name]);
    await h.storage.local.remove(name);
    const stateBefore = clone(h.storage.local.values[config.KEYS.state]);
    for (let restart = 0; restart < 2; restart++) {
      const fresh = h.create();
      assert.equal(saved.keyboard, (await fresh.read()).keyboard);
      assert.equal("INCOMPLETE_CONFIGURATION_GENERATION", (await fresh.preview()).code);
      await rejects(
        fresh.commit({ legacyPatch: { scrollStepSize: 83 } }),
        "INCOMPLETE_CONFIGURATION_GENERATION",
      );
      assert.equal(stateBefore, h.storage.local.values[config.KEYS.state]);
    }
    await h.storage.local.set({ [name]: chunk });
    const restored = h.create();
    assert.equal(saved.keyboard, (await restored.read()).keyboard);
    assert.equal(null, (await restored.preview()).code);
    assert.equal(
      83,
      (await restored.commit({ legacyPatch: { scrollStepSize: 83 } })).keyboard.scrollStepSize,
    );
  });

  should("读取失败期间本机代次已变化时不覆盖新状态，提交和回退均先停止", async () => {
    for (const action of ["read", "commit", "rollback"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const css = "/*" + "<".repeat(1200) + "*/";
      const saved = await writer.commit({ legacyPatch: { userDefinedLinkHintCss: css } });
      const index = clone(h.storage.local.values[config.KEYS.index]);
      const state = clone(h.storage.local.values[config.KEYS.state]);
      const names = index.fields.userDefinedLinkHintCss.chunks;
      assert.isTrue(names.length > 1);
      const newerIndex = clone(index);
      newerIndex.fields.userDefinedLinkHintCss.chunks = [names[0]];
      const newerState = clone(state);
      newerState.committedIndex = clone(newerIndex);
      newerState.afterIndex = clone(newerIndex);
      const replacement = { operationId: index.operationId, part: 0, text: JSON.stringify(css) };
      const get = h.storage.local.get;
      let injected = false;
      h.storage.local.get = async (keys) => {
        if (!injected && Array.isArray(keys) && names.every((name) => keys.includes(name))) {
          injected = true;
          h.storage.local.values[names[0]] = clone(replacement);
          h.storage.local.values[config.KEYS.index] = clone(newerIndex);
          h.storage.local.values[config.KEYS.state] = clone(newerState);
        }
        return await get(keys);
      };
      const reader = h.create();
      const writesBefore = h.writes.length;
      if (action === "read") {
        assert.equal(saved.keyboard, (await reader.read()).keyboard);
        assert.equal("CONFIGURATION_EXTERNAL_CONFLICT", reader.lastReadCode);
      } else {
        await rejects(
          action === "commit"
            ? reader.commit({ legacyPatch: { scrollStepSize: 83 } })
            : reader.rollback(),
          "CONFIGURATION_EXTERNAL_CONFLICT",
        );
      }
      assert.isTrue(injected);
      assert.equal(writesBefore, h.writes.length);
      assert.equal(newerState, h.storage.local.values[config.KEYS.state]);
      assert.equal(newerIndex, h.storage.local.values[config.KEYS.index]);
      assert.equal("COMMITTED", h.storage.local.values[config.KEYS.state].phase);
      assert.equal(saved.keyboard, (await reader.read()).keyboard);
      assert.equal(null, reader.lastReadCode);
    }
  });

  should("状态重读返回后才发生并发变化时，失败读取也不能写入过期状态", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    const css = "/*" + "<".repeat(1200) + "*/";
    const saved = await writer.commit({ legacyPatch: { userDefinedLinkHintCss: css } });
    const oldIndex = clone(h.storage.local.values[config.KEYS.index]);
    const names = oldIndex.fields.userDefinedLinkHintCss.chunks;
    const newerIndex = clone(oldIndex);
    newerIndex.fields.userDefinedLinkHintCss.chunks = [names[0]];
    const newerState = clone(h.storage.local.values[config.KEYS.state]);
    newerState.committedIndex = clone(newerIndex);
    newerState.afterIndex = clone(newerIndex);
    h.storage.local.values[names[0]] = {
      operationId: oldIndex.operationId,
      part: 0,
      text: JSON.stringify(css),
    };
    const get = h.storage.local.get;
    let stateReads = 0;
    h.storage.local.get = async (keys) => {
      const result = await get(keys);
      if (
        Array.isArray(keys) && keys.includes(config.KEYS.state) &&
        keys.includes(config.KEYS.index) &&
        ++stateReads === 2
      ) {
        h.storage.local.values[config.KEYS.index] = clone(newerIndex);
        h.storage.local.values[config.KEYS.state] = clone(newerState);
      }
      return result;
    };
    const reader = h.create();
    const writesBefore = h.writes.length;
    assert.equal(saved.keyboard, (await reader.read()).keyboard);
    assert.equal(writesBefore, h.writes.length);
    assert.equal(newerState, h.storage.local.values[config.KEYS.state]);
    assert.equal(newerIndex, h.storage.local.values[config.KEYS.index]);
    assert.isTrue(reader.dirty);
    assert.equal(saved.keyboard, (await reader.read()).keyboard);
    assert.equal(null, reader.lastReadCode);
  });

  should("分片损坏后二次读取状态失败时不写隔离状态或继续提交", async () => {
    for (const action of ["read", "commit", "rollback"]) {
      const h = harness();
      const writer = h.create();
      const saved = await writer.read();
      const index = h.storage.local.values[config.KEYS.index];
      await h.storage.local.remove(index.fields.keyMappings.chunks[0]);
      const state = clone(h.storage.local.values[config.KEYS.state]);
      const get = h.storage.local.get;
      let stateReads = 0;
      h.storage.local.get = async (keys) => {
        if (
          Array.isArray(keys) && keys.includes(config.KEYS.state) &&
          keys.includes(config.KEYS.index) &&
          ++stateReads === 2
        ) throw new Error("合成状态重读失败");
        return await get(keys);
      };
      const reader = h.create();
      const writesBefore = h.writes.length;
      if (action === "read") {
        assert.equal(saved.keyboard, (await reader.read()).keyboard);
        assert.equal("CONFIGURATION_SOURCE_UNAVAILABLE", reader.lastReadCode);
      } else {
        await rejects(
          action === "commit"
            ? reader.commit({ legacyPatch: { scrollStepSize: 83 } })
            : reader.rollback(),
          "CONFIGURATION_SOURCE_UNAVAILABLE",
        );
      }
      assert.equal(writesBefore, h.writes.length);
      assert.equal(state, h.storage.local.values[config.KEYS.state]);
      assert.isTrue(reader.dirty);
    }
  });

  should("提交代次缺片或冲突选择待复核时，写入入口均不得继续", async () => {
    for (const action of ["commit", "rollback", "incoming", "committed"]) {
      const h = harness();
      const writer = h.create();
      await writer.read();
      const index = h.storage.local.values[config.KEYS.index];
      const missing = index.fields.keyMappings.chunks[0];
      const get = h.storage.local.get;
      let reads = 0;
      h.storage.local.get = async (keys) => {
        if (Array.isArray(keys) && keys.includes(missing)) {
          reads++;
          if (reads === (["incoming", "committed"].includes(action) ? 1 : 2)) {
            delete h.storage.local.values[missing];
          }
        }
        return await get(keys);
      };
      const reader = h.create();
      const beforeSync = clone(h.storage.sync.values);
      const beforeState = clone(h.storage.local.values[config.KEYS.state]);
      const writesBefore = h.writes.length;
      const request = action === "commit"
        ? reader.commit({ legacyPatch: { scrollStepSize: 83 } })
        : action === "rollback"
        ? reader.rollback()
        : reader.resolve(action);
      await rejects(
        request,
        ["incoming", "committed"].includes(action)
          ? "CONFIGURATION_CONFLICT_REVIEW_REQUIRED"
          : "INCOMPLETE_CONFIGURATION_GENERATION",
      );
      assert.equal(writesBefore, h.writes.length);
      assert.equal(beforeSync, h.storage.sync.values);
      assert.equal(beforeState, h.storage.local.values[config.KEYS.state]);
    }
  });

  should("缺片且恢复快照摘要不符时不能用旧备份或默认值覆盖", async () => {
    const h = harness();
    await h.create().read();
    const index = h.storage.local.values[config.KEYS.index];
    await h.storage.local.remove(index.fields.keyMappings.chunks[0]);
    h.storage.local.values[config.KEYS.state].afterSnapshot.keyboard.keyMappings = "损坏快照";
    const before = clone(h.storage.sync.values);
    await rejects(h.create().read(), "INCOMPLETE_CONFIGURATION_GENERATION");
    assert.equal(before, h.storage.sync.values);
  });

  should("已有有效配置时旧来源读取失败继续提供有效快照，但不得提交", async () => {
    const h = harness();
    const saved = await h.create().read();
    const before = clone(h.storage.sync.values);
    h.controls.fail = (area, method) => area === "sync" && method === "get";
    const fresh = h.create();
    assert.equal(saved.keyboard, (await fresh.read()).keyboard);
    assert.equal("CONFIGURATION_SOURCE_UNAVAILABLE", (await fresh.preview()).code);
    await rejects(fresh.commit({ legacyPatch: { keyMappings: "map a scrollDown" } }));
    assert.equal(before, h.storage.sync.values);
  });

  should("正在提交时读者只能看到完整旧代次，完成后一次发布新代次", async () => {
    const h = harness();
    const writer = h.create();
    const saved = await writer.read();
    writer.afterStep = async () => assert.equal(saved, await writer.read());
    const next = await writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } });
    assert.equal(2, next.revision);
    assert.equal(2, h.notifications.length);
    assert.equal(next, await writer.read());
  });

  should("清理失败标记重试而不丢失已提交配置", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } });
    h.controls.fail = (area, method) => area === "local" && method === "remove";
    const next = await writer.commit({ legacyPatch: { keyMappings: "map b scrollDown" } });
    assert.equal(3, next.revision);
    assert.isTrue(h.storage.local.values[config.KEYS.state].cleanupPending);
    h.controls.fail = null;
    assert.equal(next.keyboard, (await h.create().read()).keyboard);
    assert.isFalse(h.storage.local.values[config.KEYS.state].cleanupPending);
  });

  should("提交完成通知指定最低 revision 时必须等完整发布，不能拿忙碌时旧快照应答", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    let notifiedRead;
    let finished = false;
    writer.afterStep = (_position, state) => {
      notifiedRead ||= writer.read(state.revision).then((view) => {
        finished = true;
        return view;
      });
      assert.isFalse(finished);
    };
    const saved = await writer.commit({ legacyPatch: { keyMappings: "map a scrollUp" } });
    assert.equal(saved, await notifiedRead);
  });

  should("维护导出优先使用最新提交，仅无提交时明确区分迁移基线", async () => {
    const h = harness();
    const writer = h.create();
    await writer.read();
    await writer.commit({ legacyPatch: { keyMappings: "map latest scrollUp" } });
    const latest = await writer.exportConfiguration();
    assert.equal("committed", latest.source);
    assert.equal("map latest scrollUp", latest.snapshot.keyboard.keyMappings);
    await h.storage.local.remove([config.KEYS.state, config.KEYS.index]);
    h.controls.fail = (area, method) => area === "sync" && method === "get";
    const baseline = await h.create().exportConfiguration();
    assert.equal("baseline", baseline.source);
    assert.equal(Settings.defaultOptions.keyMappings, baseline.snapshot.keyboard.keyMappings);
    h.storage.local.values[config.KEYS.backup].baseline.keyboard.keyMappings = "损坏基线";
    await rejects(h.create().exportConfiguration(), "CONFIGURATION_DIGEST_MISMATCH");
  });

  should("后台不可用的维护导出只读最新完整提交，不写入存储", async () => {
    const h = harness();
    await h.create().read();
    const saved = await h.create().commit({ legacyPatch: { keyMappings: "map offline scrollUp" } });
    const written = h.writes.length;
    const exported = await config.exportStoredConfiguration({
      local: h.storage.local,
      defaults: Settings.defaultOptions,
      validateToolbox: (value) => BrowserToolboxSettingsValidator.assertValid(value),
    });
    assert.equal("committed", exported.source);
    assert.equal(saved, exported.snapshot);
    assert.equal(written, h.writes.length);
  });

  should("维护只读导出在未完成提交中保留此前提交，不把待提交值冒充完成", async () => {
    const h = harness();
    const saved = await h.create().read();
    const writer = h.create({
      afterStep() {
        throw Object.assign(new Error("合成终止"), { simulatedTermination: true });
      },
    });
    await writer.commit({ legacyPatch: { keyMappings: "map pending scrollUp" } }).catch(() => {});
    const written = h.writes.length;
    const exported = await config.exportStoredConfiguration({
      local: h.storage.local,
      defaults: Settings.defaultOptions,
      validateToolbox: (value) => BrowserToolboxSettingsValidator.assertValid(value),
    });
    assert.equal("committed", exported.source);
    assert.equal(saved, exported.snapshot);
    assert.equal(written, h.writes.length);
  });

  should("维护只读导出拒绝未来代次和损坏分片，不降为初始备份", async () => {
    const h = harness();
    await h.create().read();
    const read = () =>
      config.exportStoredConfiguration({
        local: h.storage.local,
        defaults: Settings.defaultOptions,
        validateToolbox: (value) => BrowserToolboxSettingsValidator.assertValid(value),
      });
    h.storage.local.values[config.KEYS.state].committedIndex.formatVersion = 200;
    await rejects(read(), "UNSUPPORTED_CONFIGURATION_FORMAT");
    h.storage.local.values[config.KEYS.state].committedIndex.formatVersion = 1;
    h.storage.local.values[config.KEYS.state].afterSnapshot.keyboard.keyMappings = "损坏提交";
    const chunk = h.storage.local.values[config.KEYS.index].fields.keyMappings.chunks[0];
    delete h.storage.local.values[chunk];
    await rejects(read(), "INCOMPLETE_CONFIGURATION_GENERATION");
  });

  should("未来索引字段保留原文，显式冲突选择也不静默删除", async () => {
    const h = harness();
    const writer = h.create();
    const saved = await writer.read();
    const index = clone(h.storage.local.values[config.KEYS.index]);
    index.fields.futureKeyboardField = { chunks: [], digest: "future" };
    await h.storage.local.set({ [config.KEYS.index]: index });
    assert.equal(saved.keyboard, (await writer.read()).keyboard);
    await rejects(writer.resolve("incoming"), "UNSUPPORTED_CONFIGURATION_FIELDS");
    assert.equal(index, h.storage.local.values[config.KEYS.index]);
  });
});

context("配置分片完整性", () => {
  should("UTF-8/JSON 开销按真实字节分片，乱序读取仍恢复原文", async () => {
    const source = { keyMappings: '中\\"😀'.repeat(2500), toolbox: { schemaVersion: 9 } };
    const generation = await config.createGeneration(source, "synthetic-generation", 4);
    assert.isTrue(Object.keys(generation.chunks).length > 2);
    for (const [key, value] of Object.entries(generation.chunks)) {
      assert.isTrue(config.itemBytes(key, value) <= 7 * 1024);
    }
    const local = {
      get: () => Promise.resolve(Object.fromEntries(Object.entries(generation.chunks).reverse())),
    };
    assert.equal(source, await config.readGeneration(generation.index, local));
  });

  should("缺片、跨代次和摘要不符都拒绝，不拼成半份配置", async () => {
    const source = { keyMappings: "中文".repeat(4000) };
    for (const scenario of ["missing", "generation", "digest"]) {
      const generation = await config.createGeneration(source, "synthetic-generation", 1);
      const key = Object.keys(generation.chunks)[0];
      if (scenario === "missing") delete generation.chunks[key];
      if (scenario === "generation") generation.chunks[key].operationId = "other";
      if (scenario === "digest") generation.index.fields.keyMappings.digest = "0";
      let failure;
      try {
        await config.readGeneration(generation.index, { get: () => generation.chunks });
      } catch (caught) {
        failure = caught;
      }
      assert.isTrue(Boolean(failure));
    }
  });
});
