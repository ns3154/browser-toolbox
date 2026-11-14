// SPDX-License-Identifier: GPL-3.0-or-later
// 尚未接入后台入口；只有通过未来阶段门禁的调用者才能启用反向回写。
import "./configuration_writer.js";

const store = globalThis.BrowserToolboxConfigurationStore;
export const ROLLBACK_JOURNAL_KEY = store.ROLLBACK_JOURNAL_KEY;
const clone = (value) => structuredClone(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : record(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const cell = (values, key) =>
  Object.hasOwn(values, key) ? { present: true, value: clone(values[key]) } : { present: false };
const digestPattern = /^[a-f0-9]{64}$/;
const error = (code, properties = {}) => Object.assign(new Error(code), { code, ...properties });
const validCell = (value) =>
  record(value) && typeof value.present === "boolean" &&
  equal(Object.keys(value).sort(), value.present ? ["present", "value"] : ["present"]);

export class LegacyRollbackTransaction {
  constructor({ writer, authorize, afterStep = () => {} }) {
    Object.assign(this, { writer, authorize, afterStep });
    this.storage = writer.storage;
  }

  preview() {
    return this.writer.prepareLegacyRollback();
  }

  async permit(operation, details = {}) {
    if (
      typeof this.authorize !== "function" ||
      await this.authorize({ operation, ...details }) !== true
    ) {
      throw error("CONFIGURATION_ROLLBACK_NOT_ENABLED");
    }
  }

  validateExpected(input) {
    if (
      !record(input) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      !digestPattern.test(input.sourceDigest) || !digestPattern.test(input.legacySourceDigest)
    ) throw error("INVALID_CONFIGURATION");
    return {
      revision: input.revision,
      sourceDigest: input.sourceDigest,
      legacySourceDigest: input.legacySourceDigest,
    };
  }

  async readJournal() {
    return (await this.storage.local.get(ROLLBACK_JOURNAL_KEY))[ROLLBACK_JOURNAL_KEY];
  }

  async assertNoOtherTransition() {
    const values = await this.storage.local.get(store.SYNC_PUBLISH_JOURNAL_KEY);
    if (Object.hasOwn(values, store.SYNC_PUBLISH_JOURNAL_KEY)) {
      throw error("CONFIGURATION_TRANSITION_PENDING");
    }
  }

  async writeJournal(body, previous = null) {
    const actual = await this.readJournal();
    if (previous ? !equal(actual, previous) : actual !== undefined) {
      throw error(
        previous ? "CONFIGURATION_EXTERNAL_CONFLICT" : "CONFIGURATION_ROLLBACK_JOURNAL_EXISTS",
      );
    }
    const { integrityDigest: _oldDigest, ...plain } = body;
    const next = { ...plain, integrityDigest: await store.digest(plain) };
    await this.storage.local.set({ [ROLLBACK_JOURNAL_KEY]: next });
    const readback = await this.readJournal();
    if (!equal(readback, next)) throw error("CONFIGURATION_READBACK_FAILED");
    return next;
  }

  async inspectJournal(input) {
    const journal = clone(input);
    const keys = [
      "backupDigest",
      "backupKey",
      "budget",
      "budgetAt",
      "cells",
      "code",
      "conflicts",
      "formatVersion",
      "integrityDigest",
      "kind",
      "legacySourceDigest",
      "operationId",
      "phase",
      "reservedWrites",
      "sourceDigest",
      "sourceIndexDigest",
      "sourceRevision",
    ];
    if (
      !record(journal) || !equal(Object.keys(journal).sort(), keys.sort()) ||
      journal.formatVersion !== store.FORMAT_VERSION || journal.kind !== "legacy-rollback" ||
      !["PREPARED", "APPLYING", "RECOVERING", "COMMITTED", "ABORTED"].includes(journal.phase) ||
      typeof journal.operationId !== "string" || !/^[a-f0-9-]{36}$/.test(journal.operationId) ||
      !Number.isSafeInteger(journal.sourceRevision) || journal.sourceRevision < 1 ||
      ![
        journal.sourceDigest,
        journal.sourceIndexDigest,
        journal.legacySourceDigest,
        journal.backupDigest,
        journal.integrityDigest,
      ].every((value) => typeof value === "string" && digestPattern.test(value)) ||
      typeof journal.backupKey !== "string" ||
      !journal.backupKey.startsWith(store.ROLLBACK_BACKUP_PREFIX) ||
      journal.backupKey.length > 160 ||
      !Array.isArray(journal.conflicts) ||
      journal.conflicts.some((value) => typeof value !== "string") ||
      !(journal.code === null || typeof journal.code === "string")
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { integrityDigest, ...plain } = journal;
    if (await store.digest(plain) !== integrityDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    const backup = (await this.storage.local.get(journal.backupKey))[journal.backupKey];
    const inspected = await this.writer.inspectLegacyRollbackBackup(backup);
    if (
      backup.backupDigest !== journal.backupDigest ||
      inspected.sourceDigest !== journal.sourceDigest ||
      inspected.revision !== journal.sourceRevision
    ) throw error("CONFIGURATION_DIGEST_MISMATCH");
    const projection = store.planLegacyKeyboardProjection(
      inspected.snapshot.keyboard,
      this.writer.defaults(),
    );
    const names = [...new Set([...Object.keys(projection.target), ...projection.remove])].sort();
    if (!record(journal.cells) || !equal(Object.keys(journal.cells).sort(), names)) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    const defaults = this.writer.defaults();
    for (const name of names) {
      const images = journal.cells[name];
      if (
        !record(images) || !equal(Object.keys(images).sort(), ["after", "before"]) ||
        !validCell(images.before) || !validCell(images.after) ||
        !equal(images.after, cell(projection.target, name))
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      if (images.before.present) {
        if (name === "settingsVersion") {
          if (typeof images.before.value !== "string" || images.before.value.length > 80) {
            throw error("INVALID_CONFIGURATION_RECOVERY");
          }
        } else {
          const sample = clone(defaults);
          sample[name] = clone(images.before.value);
          this.writer.validateKeyboard(sample);
        }
      }
    }
    const before = Object.fromEntries(names.map((name) => [name, journal.cells[name].before]));
    if (await store.digest(before) !== journal.legacySourceDigest) {
      throw error("CONFIGURATION_DIGEST_MISMATCH");
    }
    const changes = Object.values(journal.cells).filter(({ before, after }) =>
      !equal(before, after)
    );
    const reserved = Number(changes.some(({ after }) => after.present)) +
      Number(changes.some(({ after }) => !after.present));
    if (
      journal.reservedWrites !== reserved || !Number.isSafeInteger(journal.budgetAt) ||
      !record(journal.budget) || !equal(Object.keys(journal.budget).sort(), ["after", "before"]) ||
      !validCell(journal.budget.before) || !validCell(journal.budget.after)
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const times = journal.budget.before.present ? journal.budget.before.value : [];
    if (!Array.isArray(times) || times.some((value) => !Number.isFinite(value))) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    const after = reserved
      ? {
        present: true,
        value: [
          ...times.filter((time) => time > journal.budgetAt - 3600000),
          ...Array(reserved).fill(journal.budgetAt),
        ],
      }
      : journal.budget.before;
    if (!equal(after, journal.budget.after)) throw error("INVALID_CONFIGURATION_RECOVERY");
    return journal;
  }

  async assertSource(journal) {
    const { current, index, sourceDigest } = await this.writer.readPreparationSnapshot();
    if (
      current.revision !== journal.sourceRevision || sourceDigest !== journal.sourceDigest ||
      await store.digest(index) !== journal.sourceIndexDigest
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
    return current;
  }

  capacity(syncBefore, cells, journal) {
    const limits = this.writer.syncPreparationLimits();
    const projected = clone(syncBefore);
    const changes = Object.entries(cells).filter(([, images]) =>
      !equal(images.before, images.after)
    );
    for (const [key, { after }] of changes) {
      if (!after.present) continue;
      const size = store.itemBytes(key, after.value);
      if (size > limits.item) throw error("browser-toolbox-sync-quota", { quota: "item" });
      projected[key] = clone(after.value);
    }
    const peakBytes = Object.entries(projected).reduce(
      (sum, [key, value]) => sum + store.itemBytes(key, value),
      0,
    );
    if (peakBytes > limits.total) throw error("browser-toolbox-sync-quota", { quota: "total" });
    if (Object.keys(projected).length > limits.items) throw error("CONFIGURATION_SYNC_ITEMS");
    const times = journal.budget.before.present ? journal.budget.before.value : [];
    if (!Array.isArray(times) || times.some((time) => !Number.isFinite(time))) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    if (
      times.filter((time) => time > journal.budgetAt - 60000).length + journal.reservedWrites >
        limits.minute ||
      times.filter((time) => time > journal.budgetAt - 3600000).length + journal.reservedWrites >
        limits.hour
    ) throw error("CONFIGURATION_SYNC_FREQUENCY");
    return { peakBytes, peakItems: Object.keys(projected).length };
  }

  async assertLocalCapacity(localBefore, journal) {
    const maximum = {
      ...journal,
      phase: "ABORTED",
      code: "CONFIGURATION_RECOVERY_CONFLICT",
      conflicts: Object.keys(journal.cells).map((name) => `sync.${name}`),
      integrityDigest: "0".repeat(64),
    };
    const additions = { [ROLLBACK_JOURNAL_KEY]: maximum };
    if (journal.budget.after.present) additions[store.KEYS.frequency] = journal.budget.after.value;
    const projected = { ...localBefore, ...additions };
    const ownedBytes = Object.entries(projected).filter(([key]) =>
      key.startsWith(store.CHUNK_PREFIX) || key.startsWith(store.ROLLBACK_BACKUP_PREFIX) ||
      key.startsWith(store.IMPORT_BACKUP_PREFIX) ||
      key.startsWith(store.TRANSITION_RECORD_PREFIX) ||
      key === ROLLBACK_JOURNAL_KEY || key === store.SYNC_PUBLISH_JOURNAL_KEY ||
      Object.values(store.KEYS).includes(key) && key !== store.KEYS.toolbox
    ).reduce((sum, [key, value]) => sum + store.itemBytes(key, value), 0);
    if (ownedBytes > store.MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
    const used = typeof this.storage.local.getBytesInUse === "function"
      ? await this.storage.local.getBytesInUse(null)
      : Object.entries(localBefore).reduce(
        (sum, [key, value]) => sum + store.itemBytes(key, value),
        0,
      );
    const required = used +
      Object.entries(additions).reduce((sum, [key, value]) =>
        sum + store.itemBytes(key, value) -
        (Object.hasOwn(localBefore, key) ? store.itemBytes(key, localBefore[key]) : 0), 0);
    if (required > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
      throw error("CONFIGURATION_LOCAL_QUOTA");
    }
  }

  async checkSyncAndReserve(cells, direction, reserve) {
    const sync = await this.storage.sync.get(null);
    const projected = clone(sync);
    let sets = false;
    let removes = false;
    const conflicts = [];
    const limits = this.writer.syncPreparationLimits();
    for (const [key, images] of Object.entries(cells)) {
      const actual = cell(sync, key);
      const target = images[direction];
      const opposite = images[direction === "after" ? "before" : "after"];
      if (equal(actual, target)) continue;
      if (!equal(actual, opposite)) {
        conflicts.push(`sync.${key}`);
        continue;
      }
      if (target.present) {
        if (store.itemBytes(key, target.value) > limits.item) {
          throw error("browser-toolbox-sync-quota", { quota: "item" });
        }
        projected[key] = clone(target.value);
        sets = true;
      } else removes = true;
    }
    if (conflicts.length && direction === "after") {
      throw error("CONFIGURATION_RECOVERY_CONFLICT", { conflicts });
    }
    const peakBytes = Object.entries(projected).reduce(
      (sum, [key, value]) => sum + store.itemBytes(key, value),
      0,
    );
    if (peakBytes > limits.total) throw error("browser-toolbox-sync-quota", { quota: "total" });
    if (Object.keys(projected).length > limits.items) throw error("CONFIGURATION_SYNC_ITEMS");
    const writes = Number(sets) + Number(removes);
    if (!reserve || !writes) return;
    const stored = await this.storage.local.get(store.KEYS.frequency);
    const before = cell(stored, store.KEYS.frequency);
    const times = before.present ? before.value : [];
    if (!Array.isArray(times) || times.some((time) => !Number.isFinite(time))) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    const now = Date.now();
    const recent = times.filter((time) => time > now - 3600000);
    if (
      recent.filter((time) => time > now - 60000).length + writes > limits.minute ||
      recent.length + writes > limits.hour
    ) throw error("CONFIGURATION_SYNC_FREQUENCY");
    await this.writer.writeImage({
      area: "local",
      cells: {
        [store.KEYS.frequency]: {
          before,
          after: { present: true, value: [...recent, ...Array(writes).fill(now)] },
        },
      },
    }, "after");
  }

  async execute(input) {
    const expected = this.validateExpected(clone(input));
    await this.permit("execute", expected);
    await this.assertNoOtherTransition();
    if (await this.readJournal() !== undefined) {
      throw error("CONFIGURATION_ROLLBACK_JOURNAL_EXISTS");
    }
    const preview = await this.writer.prepareLegacyRollback();
    if (!equal(this.validateExpected(preview), expected)) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    const backup = await this.writer.createLegacyRollbackBackup();
    await this.afterStep("backup");
    return this.writer.enqueue(async () => {
      await this.assertNoOtherTransition();
      if (await this.readJournal() !== undefined) {
        throw error("CONFIGURATION_ROLLBACK_JOURNAL_EXISTS");
      }
      const { current, index, sourceDigest } = await this.writer.readPreparationSnapshot();
      if (
        current.revision !== expected.revision || sourceDigest !== expected.sourceDigest ||
        backup.revision !== expected.revision || backup.sourceDigest !== expected.sourceDigest
      ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      const projection = store.planLegacyKeyboardProjection(
        current.keyboard,
        this.writer.defaults(),
      );
      store.assertLegacyProjectionCompatible(current.keyboard);
      const names = [...new Set([...Object.keys(projection.target), ...projection.remove])].sort();
      const [syncBefore, localBefore] = await Promise.all([
        this.storage.sync.get(null),
        this.storage.local.get(null),
      ]);
      const before = Object.fromEntries(names.map((name) => [name, cell(syncBefore, name)]));
      if (await store.digest(before) !== expected.legacySourceDigest) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const cells = Object.fromEntries(names.map((name) => [name, {
        before: before[name],
        after: cell(projection.target, name),
      }]));
      const changes = Object.values(cells).filter(({ before, after }) => !equal(before, after));
      const reservedWrites = Number(changes.some(({ after }) => after.present)) +
        Number(changes.some(({ after }) => !after.present));
      const budgetAt = Date.now();
      const budgetBefore = cell(localBefore, store.KEYS.frequency);
      const times = budgetBefore.present ? budgetBefore.value : [];
      if (!Array.isArray(times) || times.some((value) => !Number.isFinite(value))) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      const budgetAfter = reservedWrites
        ? {
          present: true,
          value: [
            ...times.filter((time) => time > budgetAt - 3600000),
            ...Array(reservedWrites).fill(budgetAt),
          ],
        }
        : budgetBefore;
      const journal = {
        formatVersion: store.FORMAT_VERSION,
        kind: "legacy-rollback",
        operationId: crypto.randomUUID(),
        phase: "PREPARED",
        sourceRevision: current.revision,
        sourceDigest,
        sourceIndexDigest: await store.digest(index),
        legacySourceDigest: expected.legacySourceDigest,
        backupKey: backup.key,
        backupDigest: backup.backupDigest,
        cells,
        budget: { before: budgetBefore, after: budgetAfter },
        budgetAt,
        reservedWrites,
        code: null,
        conflicts: [],
      };
      // 在持久化前验证整条恢复记录，避免留下自身无法恢复的前像。
      await this.inspectJournal({ ...journal, integrityDigest: await store.digest(journal) });
      this.capacity(syncBefore, cells, journal);
      await this.assertLocalCapacity(localBefore, journal);
      await this.writer.assertPreparationInputs(index, syncBefore, {
        [store.KEYS.frequency]: localBefore[store.KEYS.frequency],
      });
      const saved = await this.writeJournal(journal);
      await this.afterStep("journal");
      return this.apply(saved);
    });
  }

  async apply(input, resuming = false) {
    let journal = await this.inspectJournal(input);
    try {
      const source = await this.assertSource(journal);
      store.assertLegacyProjectionCompatible(source.keyboard);
      if (journal.phase === "PREPARED") {
        await this.writer.writeImage({
          area: "local",
          cells: { [store.KEYS.frequency]: journal.budget },
        }, "after");
        journal = await this.writeJournal({ ...journal, phase: "APPLYING" }, journal);
        await this.afterStep("budget");
      }
      if (journal.phase !== "APPLYING") return this.summary(journal);
      await this.assertSource(journal);
      // 重启后原先的频率预算可能已经过期，恢复时按当前存储重新预留。
      await this.checkSyncAndReserve(journal.cells, "after", resuming);
      await this.writer.writeImage({ area: "sync", cells: journal.cells }, "after");
      await this.afterStep("sync");
      await this.assertSource(journal);
      const actual = await this.storage.sync.get(Object.keys(journal.cells));
      const conflicts = Object.entries(journal.cells).filter(([key, images]) =>
        !equal(cell(actual, key), images.after)
      ).map(([key]) => `sync.${key}`);
      if (conflicts.length) throw error("CONFIGURATION_RECOVERY_CONFLICT", { conflicts });
      journal = await this.writeJournal({ ...journal, phase: "COMMITTED" }, journal);
      return this.summary(journal);
    } catch (failure) {
      if (failure.simulatedTermination) throw failure;
      if (
        ["CONFIGURATION_RECOVERY_CONFLICT", "CONFIGURATION_EXTERNAL_CONFLICT"].includes(
          failure.code,
        )
      ) {
        journal = await this.writeJournal({
          ...journal,
          phase: "ABORTED",
          code: failure.code,
          conflicts: [...new Set(failure.conflicts || [])],
        }, journal);
        return this.summary(journal);
      }
      throw failure;
    }
  }

  summary(journal) {
    return {
      phase: journal.phase,
      revision: journal.sourceRevision,
      backupKey: journal.backupKey,
      code: journal.code,
      conflicts: clone(journal.conflicts),
    };
  }

  async recover() {
    await this.permit("recover");
    return this.writer.enqueue(async () => {
      await this.assertNoOtherTransition();
      const stored = await this.readJournal();
      if (stored === undefined) return { phase: "NONE" };
      const journal = await this.inspectJournal(stored);
      if (journal.phase === "RECOVERING") return this.continueCompensation(journal);
      return ["COMMITTED", "ABORTED"].includes(journal.phase)
        ? this.summary(journal)
        : this.apply(journal, true);
    });
  }

  async compensate() {
    await this.permit("compensate");
    return this.writer.enqueue(async () => {
      await this.assertNoOtherTransition();
      let journal = await this.inspectJournal(await this.readJournal());
      if (!["PREPARED", "APPLYING", "RECOVERING", "ABORTED"].includes(journal.phase)) {
        throw error("CONFIGURATION_ROLLBACK_UNAVAILABLE");
      }
      await this.assertSource(journal);
      if (journal.phase === "PREPARED") {
        // 该阶段尚未写同步字段；外部值即使等于预期后像，也不能当作本事务写入。
        const actual = await this.storage.sync.get(Object.keys(journal.cells));
        const conflicts = Object.entries(journal.cells).filter(([key, images]) =>
          !equal(cell(actual, key), images.before)
        ).map(([key]) => `sync.${key}`);
        journal = await this.writeJournal({
          ...journal,
          phase: "ABORTED",
          code: conflicts.length ? "CONFIGURATION_RECOVERY_CONFLICT" : "CONFIGURATION_ROLLED_BACK",
          conflicts,
        }, journal);
        return this.summary(journal);
      }
      if (journal.phase !== "RECOVERING") {
        // 持久化补偿方向后才能写前像，重启时不能再次执行原回写。
        journal = await this.writeJournal({ ...journal, phase: "RECOVERING" }, journal);
      }
      return this.continueCompensation(journal);
    });
  }

  async continueCompensation(input) {
    const journal = await this.inspectJournal(input);
    if (journal.phase !== "RECOVERING") throw error("INVALID_CONFIGURATION_RECOVERY");
    await this.assertSource(journal);
    await this.checkSyncAndReserve(journal.cells, "before", true);
    const conflicts = await this.writer.writeImage(
      { area: "sync", cells: journal.cells },
      "before",
    );
    await this.assertSource(journal);
    const next = await this.writeJournal({
      ...journal,
      phase: "ABORTED",
      code: conflicts.length ? "CONFIGURATION_RECOVERY_CONFLICT" : "CONFIGURATION_ROLLED_BACK",
      conflicts: [...new Set(conflicts)],
    }, journal);
    return this.summary(next);
  }

  async listBackups() {
    const stored = await this.storage.local.get(null);
    const result = [];
    for (
      const key of Object.keys(stored).filter((name) =>
        name.startsWith(store.ROLLBACK_BACKUP_PREFIX)
      ).sort()
    ) {
      try {
        const backup = await this.writer.inspectLegacyRollbackBackup(stored[key]);
        result.push({
          key,
          status: "valid",
          revision: backup.revision,
          sourceDigest: backup.sourceDigest,
        });
      } catch (failure) {
        result.push({ key, status: "invalid", code: failure.code || "CONFIGURATION_UNAVAILABLE" });
      }
    }
    return result;
  }
}

globalThis.BrowserToolboxLegacyRollback = Object.freeze({
  LegacyRollbackTransaction,
  ROLLBACK_JOURNAL_KEY,
  FORMAT_VERSION: store.FORMAT_VERSION,
});
