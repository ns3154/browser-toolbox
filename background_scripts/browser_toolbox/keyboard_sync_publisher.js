// SPDX-License-Identifier: GPL-3.0-or-later
// 尚未接入后台入口；只为后续阶段提供独立同步代次的事务实现。
import "./configuration_writer.js";
import { LegacyRollbackTransaction } from "./legacy_rollback_transaction.js";

const store = globalThis.BrowserToolboxConfigurationStore;
export const SYNC_PUBLISH_JOURNAL_KEY = store.SYNC_PUBLISH_JOURNAL_KEY;
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
const error = (code, properties = {}) => Object.assign(new Error(code), { code, ...properties });
const digestPattern = /^[a-f0-9]{64}$/;
const validCell = (value) =>
  record(value) && typeof value.present === "boolean" &&
  equal(Object.keys(value).sort(), value.present ? ["present", "value"] : ["present"]);

export class KeyboardSyncPublisher {
  constructor({ writer, authorize, afterStep = () => {} }) {
    Object.assign(this, { writer, authorize, afterStep });
    this.storage = writer.storage;
    this.guard = new LegacyRollbackTransaction({ writer, authorize });
  }

  preview() {
    return this.writer.prepareKeyboardSyncMigration();
  }

  async permit(operation, details = {}) {
    if (
      typeof this.authorize !== "function" ||
      await this.authorize({ operation, ...details }) !== true
    ) {
      throw error("CONFIGURATION_SYNC_NOT_ENABLED");
    }
  }

  async validateGeneration(index, chunks, keyboard) {
    const indexKeys = [
      "fields",
      "formatVersion",
      "kind",
      "operationId",
      "revision",
      "sourceDigest",
    ];
    if (
      !record(index) || !record(chunks) || !equal(Object.keys(index).sort(), indexKeys.sort()) ||
      index.kind !== "keyboard-sync" || index.formatVersion !== store.FORMAT_VERSION ||
      !digestPattern.test(index.sourceDigest) ||
      store.itemBytes(store.KEYS.index, index) > store.MAX_CHUNK_BYTES ||
      !record(index.fields) ||
      !equal(Object.keys(index.fields).sort(), [...this.writer.keyboardKeys].sort())
    ) throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
    const names = Object.values(index.fields).flatMap((field) => field?.chunks || []);
    if (
      new Set(names).size !== names.length || !equal(Object.keys(chunks).sort(), [...names].sort())
    ) {
      throw error("INVALID_CONFIGURATION_INDEX");
    }
    for (const value of Object.values(chunks)) {
      if (!record(value) || !equal(Object.keys(value).sort(), ["operationId", "part", "text"])) {
        throw error("INVALID_CONFIGURATION_INDEX");
      }
    }
    const staged = {
      get: (keys) =>
        Promise.resolve(Object.fromEntries(
          keys.filter((key) => Object.hasOwn(chunks, key)).map((key) => [key, clone(chunks[key])]),
        )),
    };
    const actual = this.writer.validateCompleteKeyboard(await store.readGeneration(index, staged));
    if (!equal(actual, keyboard) || await store.digest(actual) !== index.sourceDigest) {
      throw error("CONFIGURATION_DIGEST_MISMATCH");
    }
    return names;
  }

  chunkCells(journal) {
    return Object.fromEntries(
      Object.entries(journal.chunks).map(([key, value]) => [key, {
        before: { present: false },
        after: { present: true, value: clone(value) },
      }]),
    );
  }

  indexCells(journal) {
    return {
      [store.KEYS.index]: {
        before: { present: false },
        after: { present: true, value: clone(journal.index) },
      },
    };
  }

  async readJournal() {
    return (await this.storage.local.get(SYNC_PUBLISH_JOURNAL_KEY))[SYNC_PUBLISH_JOURNAL_KEY];
  }

  async assertNoOtherTransition() {
    const values = await this.storage.local.get(store.ROLLBACK_JOURNAL_KEY);
    if (Object.hasOwn(values, store.ROLLBACK_JOURNAL_KEY)) {
      throw error("CONFIGURATION_TRANSITION_PENDING");
    }
  }

  async writeJournal(body, previous = null) {
    const actual = await this.readJournal();
    if (previous ? !equal(actual, previous) : actual !== undefined) {
      throw error(
        previous ? "CONFIGURATION_EXTERNAL_CONFLICT" : "CONFIGURATION_SYNC_JOURNAL_EXISTS",
      );
    }
    const { integrityDigest: _oldDigest, ...plain } = body;
    const next = { ...plain, integrityDigest: await store.digest(plain) };
    await this.storage.local.set({ [SYNC_PUBLISH_JOURNAL_KEY]: next });
    if (!equal(await this.readJournal(), next)) throw error("CONFIGURATION_READBACK_FAILED");
    return next;
  }

  async inspectJournal(input) {
    const journal = clone(input);
    const keys = [
      "backupDigest",
      "backupKey",
      "budget",
      "budgetAt",
      "chunks",
      "code",
      "conflicts",
      "formatVersion",
      "index",
      "integrityDigest",
      "kind",
      "localDomainDigest",
      "phase",
      "sourceDigest",
      "sourceIndexDigest",
      "sourceRevision",
      "syncBaseDigest",
    ];
    if (
      !record(journal) || !equal(Object.keys(journal).sort(), keys.sort()) ||
      journal.formatVersion !== store.FORMAT_VERSION || journal.kind !== "keyboard-sync-publish" ||
      !["PREPARED", "STAGING", "PUBLISHING", "RECOVERING", "COMMITTED", "ABORTED"].includes(
        journal.phase,
      ) ||
      !Number.isSafeInteger(journal.sourceRevision) || journal.sourceRevision < 1 ||
      ![
        journal.backupDigest,
        journal.integrityDigest,
        journal.localDomainDigest,
        journal.sourceDigest,
        journal.sourceIndexDigest,
        journal.syncBaseDigest,
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
      inspected.revision !== journal.sourceRevision ||
      journal.index?.revision !== journal.sourceRevision
    ) throw error("CONFIGURATION_DIGEST_MISMATCH");
    await this.validateGeneration(journal.index, journal.chunks, inspected.snapshot.keyboard);
    if (
      !record(journal.budget) || !equal(Object.keys(journal.budget).sort(), ["after", "before"]) ||
      !validCell(journal.budget.before) || !validCell(journal.budget.after) ||
      !Number.isSafeInteger(journal.budgetAt)
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const times = journal.budget.before.present ? journal.budget.before.value : [];
    if (!Array.isArray(times) || times.some((value) => !Number.isFinite(value))) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    const after = {
      present: true,
      value: [
        ...times.filter((time) => time > journal.budgetAt - 3600000),
        journal.budgetAt,
        journal.budgetAt,
      ],
    };
    if (!equal(after, journal.budget.after)) throw error("INVALID_CONFIGURATION_RECOVERY");
    return journal;
  }

  async assertSource(journal, { allowChunkChanges = false, allowForeignIndex = false } = {}) {
    const { current, index, sourceDigest } = await this.writer.readPreparationSnapshot();
    if (
      current.revision !== journal.sourceRevision || sourceDigest !== journal.sourceDigest ||
      await store.digest(index) !== journal.sourceIndexDigest
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
    const [sync, local] = await Promise.all([
      this.storage.sync.get(null),
      this.storage.local.get([store.KEYS.toolbox, store.KEYS.legacyToolbox]),
    ]);
    if (await store.digest(local) !== journal.localDomainDigest) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["toolbox"] });
    }
    for (const [key, value] of Object.entries(journal.chunks)) {
      if (Object.hasOwn(sync, key) && !equal(sync[key], value) && !allowChunkChanges) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
      }
      delete sync[key];
    }
    if (
      Object.hasOwn(sync, store.KEYS.index) && !equal(sync[store.KEYS.index], journal.index) &&
      !allowForeignIndex
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
    delete sync[store.KEYS.index];
    if (await store.digest(sync) !== journal.syncBaseDigest) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
    }
  }

  async verifyChunks(journal) {
    try {
      const keyboard = await store.readGeneration(journal.index, this.storage.sync);
      if (await store.digest(keyboard) !== journal.index.sourceDigest) {
        throw error("CONFIGURATION_DIGEST_MISMATCH");
      }
    } catch (failure) {
      throw error(failure.code || "CONFIGURATION_UNAVAILABLE");
    }
  }

  async assertCapacity(syncBefore, localBefore, journal) {
    const limits = this.writer.syncPreparationLimits(Math.min(
      store.MAX_CHUNK_BYTES,
      this.storage.sync.QUOTA_BYTES_PER_ITEM || 8192,
    ));
    const projected = { ...syncBefore, ...journal.chunks, [store.KEYS.index]: journal.index };
    for (
      const [key, value] of Object.entries({ ...journal.chunks, [store.KEYS.index]: journal.index })
    ) {
      if (store.itemBytes(key, value) > limits.item) {
        throw error("browser-toolbox-sync-quota", { quota: "item" });
      }
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
      times.filter((time) => time > journal.budgetAt - 60000).length + 2 > limits.minute ||
      times.filter((time) => time > journal.budgetAt - 3600000).length + 2 > limits.hour
    ) throw error("CONFIGURATION_SYNC_FREQUENCY");
    const maximum = {
      ...journal,
      phase: "ABORTED",
      code: "CONFIGURATION_EXTERNAL_CONFLICT",
      conflicts: ["keyboardGeneration", "toolbox"],
      integrityDigest: "0".repeat(64),
    };
    const additions = {
      [SYNC_PUBLISH_JOURNAL_KEY]: maximum,
      [store.KEYS.frequency]: journal.budget.after.value,
    };
    const localProjected = { ...localBefore, ...additions };
    const owned = Object.entries(localProjected).filter(([key]) =>
      key.startsWith(store.CHUNK_PREFIX) || key.startsWith(store.ROLLBACK_BACKUP_PREFIX) ||
      key.startsWith(store.IMPORT_BACKUP_PREFIX) ||
      key.startsWith(store.TRANSITION_RECORD_PREFIX) ||
      key === store.ROLLBACK_JOURNAL_KEY || key === SYNC_PUBLISH_JOURNAL_KEY ||
      Object.values(store.KEYS).includes(key) && key !== store.KEYS.toolbox
    ).reduce((sum, [key, value]) => sum + store.itemBytes(key, value), 0);
    if (owned > store.MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
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

  async execute(input) {
    let plan;
    try {
      plan = clone(input);
    } catch (_) {
      throw error("INVALID_CONFIGURATION");
    }
    await this.permit("execute");
    await this.assertNoOtherTransition();
    if (await this.readJournal() !== undefined) throw error("CONFIGURATION_SYNC_JOURNAL_EXISTS");
    const initial = await this.writer.readPreparationSnapshot();
    if (
      !record(plan) || plan.revision !== initial.current.revision ||
      plan.sourceDigest !== initial.sourceDigest ||
      plan.index?.revision !== initial.current.revision
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    await this.validateGeneration(plan.index, plan.chunks, initial.current.keyboard);
    const [syncBefore, localDomain] = await Promise.all([
      this.storage.sync.get(null),
      this.storage.local.get([store.KEYS.toolbox, store.KEYS.legacyToolbox]),
    ]);
    if (
      [store.KEYS.index, ...Object.keys(plan.chunks)].some((key) => Object.hasOwn(syncBefore, key))
    ) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    const backup = await this.writer.createLegacyRollbackBackup();
    await this.afterStep("backup");
    return this.writer.enqueue(async () => {
      await this.assertNoOtherTransition();
      if (await this.readJournal() !== undefined) throw error("CONFIGURATION_SYNC_JOURNAL_EXISTS");
      const { current, index, sourceDigest } = await this.writer.readPreparationSnapshot();
      if (
        current.revision !== plan.revision || sourceDigest !== plan.sourceDigest ||
        backup.revision !== plan.revision || backup.sourceDigest !== plan.sourceDigest
      ) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const [syncNow, localBefore, localNow] = await Promise.all([
        this.storage.sync.get(null),
        this.storage.local.get(null),
        this.storage.local.get([store.KEYS.toolbox, store.KEYS.legacyToolbox]),
      ]);
      if (!equal(syncBefore, syncNow) || !equal(localDomain, localNow)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const budgetBefore = cell(localBefore, store.KEYS.frequency);
      const times = budgetBefore.present ? budgetBefore.value : [];
      if (!Array.isArray(times) || times.some((time) => !Number.isFinite(time))) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      const budgetAt = Date.now();
      const journal = {
        formatVersion: store.FORMAT_VERSION,
        kind: "keyboard-sync-publish",
        phase: "PREPARED",
        sourceRevision: current.revision,
        sourceDigest,
        sourceIndexDigest: await store.digest(index),
        syncBaseDigest: await store.digest(syncBefore),
        localDomainDigest: await store.digest(localDomain),
        backupKey: backup.key,
        backupDigest: backup.backupDigest,
        index: clone(plan.index),
        chunks: clone(plan.chunks),
        budget: {
          before: budgetBefore,
          after: {
            present: true,
            value: [
              ...times.filter((time) => time > budgetAt - 3600000),
              budgetAt,
              budgetAt,
            ],
          },
        },
        budgetAt,
        code: null,
        conflicts: [],
      };
      await this.inspectJournal({ ...journal, integrityDigest: await store.digest(journal) });
      await this.assertCapacity(syncBefore, localBefore, journal);
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
      await this.assertSource(journal);
      if (journal.phase === "PREPARED") {
        await this.writer.writeImage({
          area: "local",
          cells: { [store.KEYS.frequency]: journal.budget },
        }, "after");
        journal = await this.writeJournal({ ...journal, phase: "STAGING" }, journal);
        await this.afterStep("budget");
      }
      if (journal.phase === "STAGING") {
        await this.assertSource(journal);
        const cells = this.chunkCells(journal);
        await this.guard.checkSyncAndReserve(cells, "after", resuming);
        await this.writer.writeImage({ area: "sync", cells }, "after");
        await this.assertSource(journal);
        await this.verifyChunks(journal);
        journal = await this.writeJournal({ ...journal, phase: "PUBLISHING" }, journal);
        await this.afterStep("chunks");
      }
      if (journal.phase === "PUBLISHING") {
        await this.assertSource(journal);
        await this.verifyChunks(journal);
        const cells = this.indexCells(journal);
        await this.guard.checkSyncAndReserve(cells, "after", resuming);
        await this.writer.writeImage({ area: "sync", cells }, "after");
        await this.afterStep("index");
        await this.assertSource(journal);
        await this.verifyChunks(journal);
        const actualIndex = (await this.storage.sync.get(store.KEYS.index))[store.KEYS.index];
        if (!equal(actualIndex, journal.index)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
        }
        journal = await this.writeJournal({ ...journal, phase: "COMMITTED" }, journal);
      }
      return this.summary(journal);
    } catch (failure) {
      if (failure.simulatedTermination) throw failure;
      if (
        [
          "CONFIGURATION_RECOVERY_CONFLICT",
          "CONFIGURATION_EXTERNAL_CONFLICT",
          "CONFIGURATION_DIGEST_MISMATCH",
          "INCOMPLETE_CONFIGURATION_GENERATION",
          "CONFIGURATION_UNAVAILABLE",
        ].includes(failure.code)
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
      if (journal.phase === "RECOVERING") return this.continueCancel(journal);
      return ["COMMITTED", "ABORTED"].includes(journal.phase)
        ? this.summary(journal)
        : this.apply(journal, true);
    });
  }

  async cancel() {
    await this.permit("cancel");
    return this.writer.enqueue(async () => {
      await this.assertNoOtherTransition();
      let journal = await this.inspectJournal(await this.readJournal());
      if (!["PREPARED", "STAGING", "PUBLISHING", "RECOVERING", "ABORTED"].includes(journal.phase)) {
        throw error("CONFIGURATION_ROLLBACK_UNAVAILABLE");
      }
      if (journal.phase === "PREPARED") {
        journal = await this.writeJournal({
          ...journal,
          phase: "ABORTED",
          code: "CONFIGURATION_SYNC_CANCELLED",
          conflicts: [],
        }, journal);
        return this.summary(journal);
      }
      if (journal.phase !== "RECOVERING") {
        journal = await this.writeJournal({ ...journal, phase: "RECOVERING" }, journal);
      }
      return this.continueCancel(journal);
    });
  }

  async continueCancel(input) {
    let journal = await this.inspectJournal(input);
    if (journal.phase !== "RECOVERING") throw error("INVALID_CONFIGURATION_RECOVERY");
    await this.assertSource(journal, { allowChunkChanges: true, allowForeignIndex: true });
    const current = (await this.storage.sync.get(store.KEYS.index))[store.KEYS.index];
    if (current !== undefined && !equal(current, journal.index)) {
      journal = await this.writeJournal({
        ...journal,
        phase: "ABORTED",
        code: "CONFIGURATION_EXTERNAL_CONFLICT",
        conflicts: ["keyboardGeneration"],
      }, journal);
      return this.summary(journal);
    }
    const indexCells = this.indexCells(journal);
    await this.guard.checkSyncAndReserve(indexCells, "before", true);
    const indexConflicts = await this.writer.writeImage(
      { area: "sync", cells: indexCells },
      "before",
    );
    await this.afterStep("unpublish");
    const afterIndex = (await this.storage.sync.get(store.KEYS.index))[store.KEYS.index];
    if (indexConflicts.length || afterIndex !== undefined) {
      journal = await this.writeJournal({
        ...journal,
        phase: "ABORTED",
        code: "CONFIGURATION_EXTERNAL_CONFLICT",
        conflicts: ["keyboardGeneration"],
      }, journal);
      return this.summary(journal);
    }
    await this.assertSource(journal, { allowChunkChanges: true });
    const chunks = this.chunkCells(journal);
    await this.guard.checkSyncAndReserve(chunks, "before", true);
    const conflicts = await this.writer.writeImage({ area: "sync", cells: chunks }, "before");
    journal = await this.writeJournal({
      ...journal,
      phase: "ABORTED",
      code: conflicts.length ? "CONFIGURATION_RECOVERY_CONFLICT" : "CONFIGURATION_SYNC_CANCELLED",
      conflicts: [...new Set(conflicts)],
    }, journal);
    return this.summary(journal);
  }
}

globalThis.BrowserToolboxKeyboardSyncPublisher = Object.freeze({
  KeyboardSyncPublisher,
  SYNC_PUBLISH_JOURNAL_KEY,
});
