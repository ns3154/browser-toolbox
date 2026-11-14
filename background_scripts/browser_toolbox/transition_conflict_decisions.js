// SPDX-License-Identifier: GPL-3.0-or-later
// 隔离准备模块：保存回退冲突现场和明确选择，不修改同步数据、不解除事务保护。
import { TransitionArchive } from "./transition_archive.js";

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
  Object.hasOwn(values, key) ? { present: true, value: clone(values[key]) } : { present: false };
const validCell = (value) =>
  record(value) && typeof value.present === "boolean" &&
  equal(Object.keys(value).sort(), value.present ? ["present", "value"] : ["present"]);
const error = (code) => Object.assign(new Error(code), { code });
const digestPattern = /^[a-f0-9]{64}$/;
const kind = "legacy-rollback";
const choicesAllowed = new Set(["current", "before", "after"]);

export class TransitionConflictDecisions {
  constructor({ writer, authorize, afterStep = () => {} }) {
    Object.assign(this, { writer, authorize, afterStep });
    this.storage = writer.storage;
    this.archive = new TransitionArchive({ writer, authorize });
  }

  async permit(operation) {
    if (
      typeof this.authorize !== "function" || await this.authorize({ operation, kind }) !== true
    ) {
      throw error("CONFIGURATION_CONFLICT_DECISIONS_NOT_ENABLED");
    }
  }

  async inspectCase(input) {
    const saved = clone(input);
    const keys = [
      "archiveDigest",
      "archiveKey",
      "caseDigest",
      "conflicts",
      "formatVersion",
      "journalDigest",
      "kind",
      "observed",
      "phase",
    ];
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), keys.sort()) ||
      saved.formatVersion !== 1 || saved.kind !== "legacy-rollback-conflict" ||
      !["COMMITTED", "ABORTED"].includes(saved.phase) ||
      !this.archive.validKey("archive", saved.archiveKey) ||
      ![saved.archiveDigest, saved.journalDigest, saved.caseDigest].every((value) =>
        typeof value === "string" && digestPattern.test(value)
      ) || !record(saved.observed) || !Array.isArray(saved.conflicts) ||
      !saved.conflicts.length || saved.conflicts.some((name) => typeof name !== "string") ||
      !equal(saved.conflicts, [...new Set(saved.conflicts)].sort()) ||
      Object.values(saved.observed).some((value) => !validCell(value))
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { caseDigest, ...body } = saved;
    if (await store.digest(body) !== caseDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    return saved;
  }

  async inspectDecision(input) {
    const saved = clone(input);
    const keys = ["caseDigest", "caseKey", "choices", "decisionDigest", "formatVersion", "kind"];
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), keys.sort()) ||
      saved.formatVersion !== 1 || saved.kind !== "legacy-rollback-decision" ||
      !this.archive.validKey("conflict", saved.caseKey) || !record(saved.choices) ||
      ![saved.caseDigest, saved.decisionDigest].every((value) =>
        typeof value === "string" && digestPattern.test(value)
      ) || Object.values(saved.choices).some((value) => !choicesAllowed.has(value))
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { decisionDigest, ...body } = saved;
    if (await store.digest(body) !== decisionDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    return saved;
  }

  conflictNames(journal, observed) {
    const names = Object.keys(journal.cells).sort();
    if (!equal(Object.keys(observed).sort(), names)) throw error("INVALID_CONFIGURATION_RECOVERY");
    const reported = new Set();
    for (const path of journal.conflicts) {
      if (!path.startsWith("sync.") || !names.includes(path.slice(5))) {
        throw error("CONFIGURATION_CONFLICT_UNRESOLVED");
      }
      reported.add(path.slice(5));
    }
    if (
      journal.phase === "COMMITTED" && journal.code !== null ||
      journal.phase === "ABORTED" && ![
          "CONFIGURATION_ROLLED_BACK",
          "CONFIGURATION_RECOVERY_CONFLICT",
          "CONFIGURATION_EXTERNAL_CONFLICT",
        ].includes(journal.code)
    ) throw error("CONFIGURATION_CONFLICT_UNRESOLVED");
    const direction = journal.phase === "COMMITTED" ? "after" : "before";
    const conflicts = names.filter((name) =>
      reported.has(name) || !equal(observed[name], journal.cells[name][direction])
    );
    if (!conflicts.length) throw error("CONFIGURATION_CONFLICT_UNRESOLVED");
    return conflicts;
  }

  async readObserved(journal) {
    const names = Object.keys(journal.cells).sort();
    const values = await this.storage.sync.get(names);
    return Object.fromEntries(names.map((name) => [name, cell(values, name)]));
  }

  // 每次使用时重读事务、备份、归档、提交源和全部相关旧字段；本机复核不是远端原子性证明。
  async assertCurrent(saved) {
    const handler = this.archive.handler(kind);
    await handler.assertNoOtherTransition();
    const journal = await this.archive.currentJournal(kind);
    if (journal.integrityDigest !== saved.journalDigest || journal.phase !== saved.phase) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    const archived = await this.archive.inspectArchive(
      (await this.storage.local.get(saved.archiveKey))[saved.archiveKey],
    );
    if (
      archived.journalKind !== kind || archived.archiveDigest !== saved.archiveDigest ||
      !equal(archived.journal, journal) ||
      !equal(this.conflictNames(journal, saved.observed), saved.conflicts)
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    await this.archive.assertCommittedSource(journal);
    const actual = await this.readObserved(journal);
    if (!equal(actual, saved.observed)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    await handler.assertNoOtherTransition();
    const latest = await this.archive.currentJournal(kind);
    if (!equal(latest, journal)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    await this.archive.assertArchiveUnchanged(saved.archiveKey, archived);
    await this.archive.assertCommittedSource(journal);
    if (!equal(await this.readObserved(journal), saved.observed)) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    return journal;
  }

  async assertSaved(key, expected, type) {
    const actual = (await this.storage.local.get(key))[key];
    if (!equal(actual, expected)) throw error("CONFIGURATION_READBACK_FAILED");
    if (type === "conflict") await this.inspectCase(actual);
    else await this.inspectDecision(actual);
  }

  async capture(archiveKey) {
    await this.permit("capture");
    if (!this.archive.validKey("archive", archiveKey)) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    return this.writer.enqueue(async () => {
      const journal = await this.archive.currentJournal(kind);
      if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
        throw error("CONFIGURATION_TRANSITION_IN_PROGRESS");
      }
      const archived = await this.archive.inspectArchive(
        (await this.storage.local.get(archiveKey))[archiveKey],
      );
      if (archived.journalKind !== kind || !equal(archived.journal, journal)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const observed = await this.readObserved(journal);
      const body = {
        formatVersion: 1,
        kind: "legacy-rollback-conflict",
        phase: journal.phase,
        journalDigest: journal.integrityDigest,
        archiveKey,
        archiveDigest: archived.archiveDigest,
        observed,
        conflicts: this.conflictNames(journal, observed),
      };
      const saved = { ...body, caseDigest: await store.digest(body) };
      await this.inspectCase(saved);
      await this.assertCurrent(saved);
      const local = await this.storage.local.get(null);
      for (
        const key of Object.keys(local).filter((name) => this.archive.validKey("conflict", name))
          .sort()
      ) {
        let existing;
        try {
          existing = await this.inspectCase(local[key]);
        } catch (_) {
          continue;
        }
        if (equal(existing, saved)) {
          await this.assertSaved(key, existing, "conflict");
          await this.assertCurrent(saved);
          return { key, conflicts: clone(saved.conflicts), reused: true };
        }
      }
      const key = this.archive.keyFor("conflict", crypto.randomUUID());
      await this.archive.assertCapacity(local, key, saved);
      await this.assertCurrent(saved);
      if (Object.hasOwn(await this.storage.local.get(key), key)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.storage.local.set({ [key]: saved });
      await this.assertSaved(key, saved, "conflict");
      await this.afterStep("case");
      await this.assertSaved(key, saved, "conflict");
      await this.assertCurrent(saved);
      return { key, conflicts: clone(saved.conflicts), reused: false };
    });
  }

  async readCase(key) {
    if (!this.archive.validKey("conflict", key)) throw error("INVALID_CONFIGURATION_RECOVERY");
    return this.inspectCase((await this.storage.local.get(key))[key]);
  }

  async preview(caseKey) {
    await this.permit("preview");
    return this.writer.enqueue(async () => {
      const saved = await this.readCase(caseKey);
      const journal = await this.assertCurrent(saved);
      const fields = Object.fromEntries(saved.conflicts.map((name) => [name, {
        before: clone(journal.cells[name].before),
        after: clone(journal.cells[name].after),
        current: clone(saved.observed[name]),
      }]));
      await this.assertSaved(caseKey, saved, "conflict");
      await this.assertCurrent(saved);
      return { fields, releaseAllowed: false, lineageVerified: false };
    });
  }

  record(caseKey, input) {
    let choices;
    try {
      if (!record(input)) throw error("INVALID_CONFIGURATION_CHOICE");
      choices = clone(input);
    } catch (_) {
      return Promise.reject(error("INVALID_CONFIGURATION_CHOICE"));
    }
    return this.recordCaptured(caseKey, choices);
  }

  async recordCaptured(caseKey, choices) {
    await this.permit("record");
    return this.writer.enqueue(async () => {
      const saved = await this.readCase(caseKey);
      if (
        !equal(Object.keys(choices).sort(), saved.conflicts) ||
        Object.values(choices).some((value) => !choicesAllowed.has(value))
      ) throw error("INVALID_CONFIGURATION_CHOICE");
      await this.assertCurrent(saved);
      const body = {
        formatVersion: 1,
        kind: "legacy-rollback-decision",
        caseKey,
        caseDigest: saved.caseDigest,
        choices,
      };
      const decision = { ...body, decisionDigest: await store.digest(body) };
      await this.inspectDecision(decision);
      const local = await this.storage.local.get(null);
      for (
        const key of Object.keys(local).filter((name) => this.archive.validKey("decision", name))
          .sort()
      ) {
        let existing;
        try {
          existing = await this.inspectDecision(local[key]);
        } catch (_) {
          continue;
        }
        if (equal(existing, decision)) {
          await this.assertSaved(key, existing, "decision");
          await this.assertSaved(caseKey, saved, "conflict");
          await this.assertCurrent(saved);
          return { key, reused: true, releaseAllowed: false };
        }
      }
      const key = this.archive.keyFor("decision", crypto.randomUUID());
      await this.archive.assertCapacity(local, key, decision);
      await this.assertSaved(caseKey, saved, "conflict");
      await this.assertCurrent(saved);
      if (Object.hasOwn(await this.storage.local.get(key), key)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.storage.local.set({ [key]: decision });
      await this.assertSaved(key, decision, "decision");
      await this.afterStep("decision");
      await this.assertSaved(key, decision, "decision");
      await this.assertSaved(caseKey, saved, "conflict");
      await this.assertCurrent(saved);
      return { key, reused: false, releaseAllowed: false };
    });
  }

  async readDecisionContext(key) {
    if (!this.archive.validKey("decision", key)) throw error("INVALID_CONFIGURATION_RECOVERY");
    const decision = await this.inspectDecision((await this.storage.local.get(key))[key]);
    const saved = await this.readCase(decision.caseKey);
    if (
      decision.caseDigest !== saved.caseDigest ||
      !equal(Object.keys(decision.choices).sort(), saved.conflicts)
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    const journal = await this.assertCurrent(saved);
    await this.assertSaved(decision.caseKey, saved, "conflict");
    await this.assertSaved(key, decision, "decision");
    await this.assertCurrent(saved);
    return { decision, saved, journal };
  }

  async inspect(key) {
    await this.permit("inspect");
    return this.writer.enqueue(async () => {
      await this.readDecisionContext(key);
      return { status: "current", releaseAllowed: false, lineageVerified: false };
    });
  }

  async previewDecision(key) {
    await this.permit("preview-decision");
    return this.writer.enqueue(async () => {
      const { decision, saved, journal } = await this.readDecisionContext(key);
      const cells = Object.fromEntries(saved.conflicts.map((name) => {
        const selected = decision.choices[name];
        return [
          name,
          clone(selected === "current" ? saved.observed[name] : journal.cells[name][selected]),
        ];
      }));
      await this.assertSaved(decision.caseKey, saved, "conflict");
      await this.assertSaved(key, decision, "decision");
      await this.assertCurrent(saved);
      return { cells, writeAllowed: false, releaseAllowed: false, lineageVerified: false };
    });
  }
}
