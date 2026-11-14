// SPDX-License-Identifier: GPL-3.0-or-later
// 隔离准备模块：只追加本机归档及候选复核记录，不删除事务、不解除产品写保护。
import "./configuration_writer.js";
import { LegacyRollbackTransaction } from "./legacy_rollback_transaction.js";
import { KeyboardSyncPublisher } from "./keyboard_sync_publisher.js";

const store = globalThis.BrowserToolboxConfigurationStore;
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
  Object.hasOwn(values, key) ? { present: true, value: values[key] } : { present: false };
const error = (code) => Object.assign(new Error(code), { code });
const digestPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const safeReasons = new Set([
  "CONFIGURATION_EXTERNAL_CONFLICT",
  "CONFIGURATION_RECOVERY_CONFLICT",
  "CONFIGURATION_DIGEST_MISMATCH",
  "CONFIGURATION_ROLLBACK_UNAVAILABLE",
  "CONFIGURATION_TRANSITION_PENDING",
  "CONFIGURATION_UNAVAILABLE",
  "INCOMPLETE_CONFIGURATION_GENERATION",
  "INVALID_CONFIGURATION_RECOVERY",
  "UNSUPPORTED_CONFIGURATION_FORMAT",
]);
const reasonFor = (failure) =>
  safeReasons.has(failure?.code) ? failure.code : "CONFIGURATION_UNAVAILABLE";

export class TransitionArchive {
  constructor({ writer, authorize, afterStep = () => {} }) {
    Object.assign(this, { writer, authorize, afterStep });
    this.storage = writer.storage;
    this.handlers = {
      "legacy-rollback": new LegacyRollbackTransaction({ writer, authorize: () => true }),
      "keyboard-sync-publish": new KeyboardSyncPublisher({ writer, authorize: () => true }),
    };
  }

  handler(kind) {
    if (!Object.hasOwn(this.handlers, kind)) throw error("INVALID_CONFIGURATION_ACTION");
    return this.handlers[kind];
  }

  journalKey(kind) {
    this.handler(kind);
    return kind === "legacy-rollback" ? store.ROLLBACK_JOURNAL_KEY : store.SYNC_PUBLISH_JOURNAL_KEY;
  }

  keyFor(type, id) {
    return `${store.TRANSITION_RECORD_PREFIX}${type}:${id}`;
  }

  validKey(type, key) {
    const prefix = this.keyFor(type, "");
    return typeof key === "string" && key.startsWith(prefix) &&
      uuidPattern.test(key.slice(prefix.length));
  }

  async permit(operation, kind) {
    if (
      typeof this.authorize !== "function" || await this.authorize({ operation, kind }) !== true
    ) {
      throw error("CONFIGURATION_ARCHIVE_NOT_ENABLED");
    }
  }

  async currentJournal(kind) {
    const handler = this.handler(kind);
    const saved = await handler.readJournal();
    if (saved === undefined) throw error("CONFIGURATION_ROLLBACK_UNAVAILABLE");
    return handler.inspectJournal(saved);
  }

  async inspectArchive(input) {
    const saved = clone(input);
    const keys = ["archiveDigest", "formatVersion", "journal", "journalKey", "journalKind", "kind"];
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), keys.sort()) ||
      saved.formatVersion !== 1 || saved.kind !== "keyboard-transition-archive" ||
      typeof saved.journalKind !== "string" || !Object.hasOwn(this.handlers, saved.journalKind) ||
      saved.journalKey !== this.journalKey(saved.journalKind) ||
      typeof saved.archiveDigest !== "string" || !digestPattern.test(saved.archiveDigest)
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { archiveDigest, ...body } = saved;
    if (await store.digest(body) !== archiveDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    const journal = await this.handler(saved.journalKind).inspectJournal(saved.journal);
    if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    return saved;
  }

  async inspectReviewRecord(input) {
    const saved = clone(input);
    const keys = [
      "archiveDigest",
      "archiveKey",
      "formatVersion",
      "journalDigest",
      "journalKind",
      "kind",
      "phase",
      "reviewDigest",
    ];
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), keys.sort()) ||
      saved.formatVersion !== 1 || saved.kind !== "keyboard-transition-review" ||
      typeof saved.journalKind !== "string" || !Object.hasOwn(this.handlers, saved.journalKind) ||
      !["COMMITTED", "ABORTED"].includes(saved.phase) ||
      !this.validKey("archive", saved.archiveKey) ||
      ![saved.archiveDigest, saved.journalDigest, saved.reviewDigest].every((value) =>
        typeof value === "string" && digestPattern.test(value)
      )
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { reviewDigest, ...body } = saved;
    if (await store.digest(body) !== reviewDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    return saved;
  }

  async assertCapacity(localBefore, key, value) {
    if (Object.hasOwn(localBefore, key)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    const addition = store.itemBytes(key, value);
    const owned = Object.entries(localBefore).filter(([name]) =>
      name.startsWith(store.CHUNK_PREFIX) || name.startsWith(store.ROLLBACK_BACKUP_PREFIX) ||
      name.startsWith(store.IMPORT_BACKUP_PREFIX) ||
      name.startsWith(store.TRANSITION_RECORD_PREFIX) || name === store.ROLLBACK_JOURNAL_KEY ||
      name === store.SYNC_PUBLISH_JOURNAL_KEY ||
      Object.values(store.KEYS).includes(name) && name !== store.KEYS.toolbox
    ).reduce((sum, [name, item]) => sum + store.itemBytes(name, item), addition);
    if (owned > store.MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
    const used = typeof this.storage.local.getBytesInUse === "function"
      ? await this.storage.local.getBytesInUse(null)
      : Object.entries(localBefore).reduce(
        (sum, [name, item]) => sum + store.itemBytes(name, item),
        0,
      );
    if (used + addition > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
      throw error("CONFIGURATION_LOCAL_QUOTA");
    }
  }

  async assertCurrent(kind, journal) {
    const current = await this.handler(kind).readJournal();
    if (!equal(current, journal)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
  }

  async assertCommittedSource(journal) {
    const { current, index, sourceDigest } = await this.writer.readPreparationSnapshot();
    if (
      current.revision !== journal.sourceRevision || sourceDigest !== journal.sourceDigest ||
      await store.digest(index) !== journal.sourceIndexDigest
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
  }

  async assertArchiveUnchanged(key, expected) {
    const actual = (await this.storage.local.get(key))[key];
    if (!equal(actual, expected)) throw error("CONFIGURATION_READBACK_FAILED");
    await this.inspectArchive(actual);
  }

  async assertReviewUnchanged(key, expected) {
    const actual = (await this.storage.local.get(key))[key];
    if (!equal(actual, expected)) throw error("CONFIGURATION_READBACK_FAILED");
    await this.inspectReviewRecord(actual);
  }

  async assess(kind, journal) {
    if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
      return { ready: false, reason: "CONFIGURATION_TRANSITION_IN_PROGRESS" };
    }
    const compensatedCode = kind === "legacy-rollback"
      ? "CONFIGURATION_ROLLED_BACK"
      : "CONFIGURATION_SYNC_CANCELLED";
    if (
      journal.conflicts.length ||
      journal.phase === "COMMITTED" && journal.code !== null ||
      journal.phase === "ABORTED" && journal.code !== compensatedCode
    ) return { ready: false, reason: "CONFIGURATION_CONFLICT_UNRESOLVED" };
    try {
      const handler = this.handler(kind);
      await handler.assertNoOtherTransition();
      await handler.assertSource(journal);
      if (kind === "legacy-rollback") {
        const values = await this.storage.sync.get(Object.keys(journal.cells));
        const direction = journal.phase === "COMMITTED" ? "after" : "before";
        if (
          Object.entries(journal.cells).some(([key, images]) =>
            !equal(cell(values, key), images[direction])
          )
        ) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
      } else {
        const names = [store.KEYS.index, ...Object.keys(journal.chunks)];
        const values = await this.storage.sync.get(names);
        if (journal.phase === "COMMITTED") {
          if (!equal(values[store.KEYS.index], journal.index)) {
            throw error("CONFIGURATION_EXTERNAL_CONFLICT");
          }
          await handler.verifyChunks(journal);
        } else if (names.some((key) => Object.hasOwn(values, key))) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
      }
      await handler.assertSource(journal);
      await this.assertCurrent(kind, journal);
      return { ready: true, reason: null };
    } catch (failure) {
      return { ready: false, reason: reasonFor(failure) };
    }
  }

  previewRelease(kind) {
    this.handler(kind);
    return this.writer.enqueue(async () => {
      try {
        const journal = await this.currentJournal(kind);
        return { kind, phase: journal.phase, ...await this.assess(kind, journal) };
      } catch (failure) {
        return { kind, phase: null, ready: false, reason: reasonFor(failure) };
      }
    });
  }

  inspectConflict(kind) {
    this.handler(kind);
    return this.writer.enqueue(async () => {
      const journal = await this.currentJournal(kind);
      if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
        throw error("CONFIGURATION_TRANSITION_IN_PROGRESS");
      }
      await this.assertCommittedSource(journal);
      const names = kind === "legacy-rollback" ? Object.keys(journal.cells) : null;
      const localKeys = [store.KEYS.toolbox, store.KEYS.legacyToolbox];
      const syncBefore = await this.storage.sync.get(names);
      const localBefore = kind === "keyboard-sync-publish"
        ? await this.storage.local.get(localKeys)
        : null;
      const syncAfter = await this.storage.sync.get(names);
      const localAfter = kind === "keyboard-sync-publish"
        ? await this.storage.local.get(localKeys)
        : null;
      await this.assertCommittedSource(journal);
      await this.assertCurrent(kind, journal);
      if (!equal(syncBefore, syncAfter) || !equal(localBefore, localAfter)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      // 再验证关联备份；只保证读取期间观察到的变化会停止，不保证读取后互斥。
      if (!equal(await this.currentJournal(kind), journal)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      if (kind === "legacy-rollback") {
        const fields = Object.fromEntries(
          Object.entries(journal.cells).map(([key, images]) => {
            const actual = cell(syncBefore, key);
            const before = equal(actual, images.before);
            const after = equal(actual, images.after);
            return [
              key,
              before && after ? "unchanged" : before ? "before" : after ? "after" : "external",
            ];
          }),
        );
        return { kind, phase: journal.phase, fields };
      }
      const index = !Object.hasOwn(syncBefore, store.KEYS.index)
        ? "absent"
        : equal(syncBefore[store.KEYS.index], journal.index)
        ? "matching"
        : "external";
      const chunks = { matching: 0, absent: 0, external: 0 };
      const remaining = clone(syncBefore);
      delete remaining[store.KEYS.index];
      for (const [key, expected] of Object.entries(journal.chunks)) {
        const status = !Object.hasOwn(syncBefore, key)
          ? "absent"
          : equal(syncBefore[key], expected)
          ? "matching"
          : "external";
        chunks[status]++;
        delete remaining[key];
      }
      return {
        kind,
        phase: journal.phase,
        index,
        chunks,
        syncBaseChanged: await store.digest(remaining) !== journal.syncBaseDigest,
        localDomainChanged: await store.digest(localBefore) !== journal.localDomainDigest,
      };
    });
  }

  async listArchives() {
    const values = await this.storage.local.get(null);
    const results = [];
    for (const key of Object.keys(values).filter((name) => this.validKey("archive", name)).sort()) {
      try {
        const archive = await this.inspectArchive(values[key]);
        results.push({
          key,
          status: "valid",
          kind: archive.journalKind,
          phase: archive.journal.phase,
          revision: archive.journal.sourceRevision,
        });
      } catch (_) {
        results.push({ key, status: "invalid" });
      }
    }
    return results;
  }

  async archive(kind) {
    this.handler(kind);
    await this.permit("archive", kind);
    return this.writer.enqueue(async () => {
      const journal = await this.currentJournal(kind);
      if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
        throw error("CONFIGURATION_TRANSITION_IN_PROGRESS");
      }
      const localBefore = await this.storage.local.get(null);
      for (
        const key of Object.keys(localBefore).filter((name) => this.validKey("archive", name))
          .sort()
      ) {
        let existing;
        try {
          existing = await this.inspectArchive(localBefore[key]);
        } catch (_) {
          // 无效记录不删除，也不能用于释放当前事务。
          continue;
        }
        if (existing.journalKind === kind && equal(existing.journal, journal)) {
          await this.assertArchiveUnchanged(key, existing);
          await this.assertCurrent(kind, journal);
          return { key, kind, phase: journal.phase, reused: true };
        }
      }
      const body = {
        formatVersion: 1,
        kind: "keyboard-transition-archive",
        journalKind: kind,
        journalKey: this.journalKey(kind),
        journal: clone(journal),
      };
      const saved = { ...body, archiveDigest: await store.digest(body) };
      await this.inspectArchive(saved);
      const key = this.keyFor("archive", crypto.randomUUID());
      await this.assertCapacity(localBefore, key, saved);
      await this.assertCurrent(kind, journal);
      if (Object.hasOwn(await this.storage.local.get(key), key)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.storage.local.set({ [key]: saved });
      const readback = (await this.storage.local.get(key))[key];
      if (!equal(readback, saved)) throw error("CONFIGURATION_READBACK_FAILED");
      await this.inspectArchive(readback);
      await this.afterStep("archive");
      await this.assertArchiveUnchanged(key, saved);
      await this.assertCurrent(kind, journal);
      return { key, kind, phase: journal.phase, reused: false };
    });
  }

  async recordReview(kind, archiveKey) {
    this.handler(kind);
    await this.permit("review", kind);
    if (!this.validKey("archive", archiveKey)) throw error("INVALID_CONFIGURATION_RECOVERY");
    return this.writer.enqueue(async () => {
      const journal = await this.currentJournal(kind);
      const archive = await this.inspectArchive(
        (await this.storage.local.get(archiveKey))[archiveKey],
      );
      if (archive.journalKind !== kind || !equal(archive.journal, journal)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const preview = await this.assess(kind, journal);
      if (!preview.ready) throw error(preview.reason);
      const body = {
        formatVersion: 1,
        kind: "keyboard-transition-review",
        journalKind: kind,
        phase: journal.phase,
        journalDigest: journal.integrityDigest,
        archiveKey,
        archiveDigest: archive.archiveDigest,
      };
      const saved = { ...body, reviewDigest: await store.digest(body) };
      await this.inspectReviewRecord(saved);
      const localBefore = await this.storage.local.get(null);
      for (
        const key of Object.keys(localBefore).filter((name) => this.validKey("review", name)).sort()
      ) {
        let existing;
        try {
          existing = await this.inspectReviewRecord(localBefore[key]);
        } catch (_) {
          continue;
        }
        if (equal(existing, saved)) {
          await this.assertReviewUnchanged(key, existing);
          await this.assertArchiveUnchanged(archiveKey, archive);
          const fresh = await this.assess(kind, journal);
          if (!fresh.ready) throw error(fresh.reason);
          return { key, kind, phase: journal.phase, reused: true };
        }
      }
      const key = this.keyFor("review", crypto.randomUUID());
      await this.assertCapacity(localBefore, key, saved);
      const fresh = await this.assess(kind, journal);
      if (!fresh.ready) throw error(fresh.reason);
      await this.assertArchiveUnchanged(archiveKey, archive);
      if (Object.hasOwn(await this.storage.local.get(key), key)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.storage.local.set({ [key]: saved });
      const readback = (await this.storage.local.get(key))[key];
      if (!equal(readback, saved)) throw error("CONFIGURATION_READBACK_FAILED");
      await this.inspectReviewRecord(readback);
      await this.afterStep("review");
      await this.assertReviewUnchanged(key, saved);
      await this.assertArchiveUnchanged(archiveKey, archive);
      const final = await this.assess(kind, journal);
      if (!final.ready) throw error(final.reason);
      return { key, kind, phase: journal.phase, reused: false };
    });
  }

  inspectReview(kind, reviewKey) {
    this.handler(kind);
    return this.writer.enqueue(async () => {
      try {
        if (!this.validKey("review", reviewKey)) throw error("INVALID_CONFIGURATION_RECOVERY");
        const review = await this.inspectReviewRecord(
          (await this.storage.local.get(reviewKey))[reviewKey],
        );
        const journal = await this.currentJournal(kind);
        if (
          review.journalKind !== kind || review.journalDigest !== journal.integrityDigest ||
          review.phase !== journal.phase
        ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        const archive = await this.inspectArchive(
          (await this.storage.local.get(review.archiveKey))[review.archiveKey],
        );
        if (
          archive.archiveDigest !== review.archiveDigest || archive.journalKind !== kind ||
          !equal(archive.journal, journal)
        ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        return await this.assess(kind, journal);
      } catch (failure) {
        return { ready: false, reason: reasonFor(failure) };
      }
    });
  }
}
