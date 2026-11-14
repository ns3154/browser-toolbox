// SPDX-License-Identifier: GPL-3.0-or-later
// 隔离准备模块：保存完整外部同步候选和逐字段选择，不写入同步数据、不解除事务保护。
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
const error = (code) => Object.assign(new Error(code), { code });
const digestPattern = /^[a-f0-9]{64}$/;
const kind = "keyboard-sync-publish";
const caseType = "sync-conflict";
const decisionType = "sync-decision";
const allowedChoices = new Set(["local", "incoming"]);

function legacyLimitations(keyboard) {
  try {
    store.assertLegacyProjectionCompatible(keyboard);
    return [];
  } catch (failure) {
    if (failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
    return clone(failure.conflicts);
  }
}

export class SyncTransitionConflictDecisions {
  constructor({ writer, authorize, afterStep = () => {} }) {
    Object.assign(this, { writer, authorize, afterStep });
    this.storage = writer.storage;
    this.archive = new TransitionArchive({ writer, authorize });
    this.handler = this.archive.handler(kind);
  }

  async permit(operation) {
    if (
      typeof this.authorize !== "function" || await this.authorize({ operation, kind }) !== true
    ) throw error("CONFIGURATION_SYNC_DECISIONS_NOT_ENABLED");
  }

  assertTerminal(journal) {
    if (!["COMMITTED", "ABORTED"].includes(journal.phase)) {
      throw error("CONFIGURATION_TRANSITION_IN_PROGRESS");
    }
    if (
      journal.phase === "COMMITTED" && (journal.code !== null || journal.conflicts.length) ||
      journal.phase === "ABORTED" && ![
          "CONFIGURATION_SYNC_CANCELLED",
          "CONFIGURATION_RECOVERY_CONFLICT",
          "CONFIGURATION_EXTERNAL_CONFLICT",
          "CONFIGURATION_DIGEST_MISMATCH",
          "INCOMPLETE_CONFIGURATION_GENERATION",
          "CONFIGURATION_UNAVAILABLE",
        ].includes(journal.code)
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
  }

  candidateNames(index) {
    if (
      !record(index) || !equal(Object.keys(index).sort(), [
        "fields",
        "formatVersion",
        "kind",
        "operationId",
        "revision",
        "sourceDigest",
      ]) || index.kind !== "keyboard-sync" || index.formatVersion !== store.FORMAT_VERSION ||
      !record(index.fields) ||
      !equal(Object.keys(index.fields).sort(), [...this.writer.keyboardKeys].sort()) ||
      typeof index.operationId !== "string" || index.operationId.length < 1 ||
      index.operationId.length > 80
    ) throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
    for (const descriptor of Object.values(index.fields)) {
      if (
        !record(descriptor) || !equal(Object.keys(descriptor).sort(), ["chunks", "digest"]) ||
        !Array.isArray(descriptor.chunks) || typeof descriptor.digest !== "string" ||
        !digestPattern.test(descriptor.digest)
      ) throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
    }
    const names = Object.values(index.fields).flatMap((descriptor) => descriptor.chunks);
    if (
      names.length > 2048 ||
      names.some((name) =>
        typeof name !== "string" || !name.startsWith(`${store.CHUNK_PREFIX}${index.operationId}:`)
      ) || new Set(names).size !== names.length
    ) throw error("INVALID_CONFIGURATION_INDEX");
    return names;
  }

  async validateCandidate(index, chunks) {
    const names = this.candidateNames(index);
    if (!record(chunks) || !equal(Object.keys(chunks).sort(), [...names].sort())) {
      throw error("INVALID_CONFIGURATION_INDEX");
    }
    const reader = {
      get: (keys) =>
        Promise.resolve(
          Object.fromEntries(
            keys.filter((key) => Object.hasOwn(chunks, key)).map((
              key,
            ) => [key, clone(chunks[key])]),
          ),
        ),
    };
    let keyboard;
    try {
      keyboard = await store.readGeneration(index, reader);
      keyboard = this.writer.validateCompleteKeyboard(keyboard);
      await this.handler.validateGeneration(index, chunks, keyboard);
      store.assertLegacyProjectionCompatible(keyboard);
    } catch (failure) {
      if (failure?.code) throw failure;
      throw error("INVALID_CONFIGURATION_INDEX");
    }
    return keyboard;
  }

  async candidateFromSync(sync, journal) {
    const index = sync[store.KEYS.index];
    if (index === undefined || equal(index, journal.index)) {
      throw error("CONFIGURATION_CONFLICT_UNRESOLVED");
    }
    const names = this.candidateNames(index);
    if (names.some((name) => !Object.hasOwn(sync, name))) {
      throw error("INCOMPLETE_CONFIGURATION_GENERATION");
    }
    const chunks = Object.fromEntries(names.map((name) => [name, clone(sync[name])]));
    const keyboard = await this.validateCandidate(index, chunks);
    return { index: clone(index), chunks, keyboard };
  }

  async inspectCase(input) {
    const saved = clone(input);
    const keys = [
      "archiveDigest",
      "archiveKey",
      "caseDigest",
      "formatVersion",
      "incomingChunks",
      "incomingIndex",
      "journalDigest",
      "kind",
      "localDomainDigest",
      "phase",
      "syncDigest",
    ];
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), keys.sort()) ||
      saved.formatVersion !== 1 || saved.kind !== "keyboard-sync-conflict" ||
      !["COMMITTED", "ABORTED"].includes(saved.phase) ||
      !this.archive.validKey("archive", saved.archiveKey) ||
      ![
        saved.archiveDigest,
        saved.caseDigest,
        saved.journalDigest,
        saved.localDomainDigest,
        saved.syncDigest,
      ].every((value) => typeof value === "string" && digestPattern.test(value))
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { caseDigest, ...body } = saved;
    if (await store.digest(body) !== caseDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    const incoming = await this.validateCandidate(saved.incomingIndex, saved.incomingChunks);
    return { saved, incoming };
  }

  async inspectDecision(input) {
    const saved = clone(input);
    if (
      !record(saved) || !equal(Object.keys(saved).sort(), [
        "caseDigest",
        "caseKey",
        "choices",
        "decisionDigest",
        "formatVersion",
        "kind",
      ]) || saved.formatVersion !== 1 || saved.kind !== "keyboard-sync-decision" ||
      !this.archive.validKey(caseType, saved.caseKey) || !record(saved.choices) ||
      ![saved.caseDigest, saved.decisionDigest].every((value) =>
        typeof value === "string" && digestPattern.test(value)
      ) || Object.values(saved.choices).some((value) => !allowedChoices.has(value))
    ) throw error("INVALID_CONFIGURATION_RECOVERY");
    const { decisionDigest, ...body } = saved;
    if (await store.digest(body) !== decisionDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
    return saved;
  }

  async readInputs() {
    const [sync, local] = await Promise.all([
      this.storage.sync.get(null),
      this.storage.local.get([store.KEYS.toolbox, store.KEYS.legacyToolbox]),
    ]);
    return {
      sync,
      syncDigest: await store.digest(sync),
      localDomainDigest: await store.digest(local),
    };
  }

  async inspectIncoming(archiveKey) {
    await this.permit("inspect-incoming");
    if (!this.archive.validKey("archive", archiveKey)) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    return this.writer.enqueue(async () => {
      const journal = await this.archive.currentJournal(kind);
      this.assertTerminal(journal);
      const archived = await this.archive.inspectArchive(
        (await this.storage.local.get(archiveKey))[archiveKey],
      );
      if (archived.journalKind !== kind || !equal(archived.journal, journal)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.handler.assertNoOtherTransition();
      await this.archive.assertCommittedSource(journal);
      const before = await this.readInputs();
      let status = "complete";
      try {
        await this.candidateFromSync(before.sync, journal);
      } catch (failure) {
        const states = {
          CONFIGURATION_CONFLICT_UNRESOLVED: "no-foreign-candidate",
          INCOMPLETE_CONFIGURATION_GENERATION: "incomplete",
          UNSUPPORTED_CONFIGURATION_FORMAT: "unsupported",
          UNSUPPORTED_CONFIGURATION_FIELDS: "unsupported-fields",
          INVALID_CONFIGURATION_INDEX: "invalid",
          INVALID_KEYBOARD_CONFIGURATION: "invalid",
          CONFIGURATION_DIGEST_MISMATCH: "invalid",
        };
        if (!Object.hasOwn(states, failure?.code)) throw failure;
        status = states[failure.code];
      }
      const verify = async () => {
        const latest = await this.readInputs();
        if (
          !equal(latest.sync, before.sync) || latest.localDomainDigest !== before.localDomainDigest
        ) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
      };
      await verify();
      await this.handler.assertNoOtherTransition();
      await this.archive.assertCurrent(kind, journal);
      await this.archive.assertArchiveUnchanged(archiveKey, archived);
      await this.archive.assertCommittedSource(journal);
      await verify();
      return { status, writeAllowed: false, releaseAllowed: false, lineageVerified: false };
    });
  }

  // 比较只判断本次观察是否变化，不证明设备血缘，也不能排除检查后的并发写入。
  async assertCurrent(saved) {
    await this.handler.assertNoOtherTransition();
    const journal = await this.archive.currentJournal(kind);
    this.assertTerminal(journal);
    if (journal.integrityDigest !== saved.journalDigest || journal.phase !== saved.phase) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    const archived = await this.archive.inspectArchive(
      (await this.storage.local.get(saved.archiveKey))[saved.archiveKey],
    );
    if (
      archived.journalKind !== kind || archived.archiveDigest !== saved.archiveDigest ||
      !equal(archived.journal, journal) || equal(saved.incomingIndex, journal.index)
    ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    const checkInputs = async () => {
      const values = await this.readInputs();
      if (
        values.syncDigest !== saved.syncDigest ||
        values.localDomainDigest !== saved.localDomainDigest ||
        !equal(values.sync[store.KEYS.index], saved.incomingIndex) ||
        Object.entries(saved.incomingChunks).some(([key, value]) => !equal(values.sync[key], value))
      ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      return values;
    };
    await this.archive.assertCommittedSource(journal);
    await checkInputs();
    await this.handler.assertNoOtherTransition();
    if (!equal(await this.archive.currentJournal(kind), journal)) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    await this.archive.assertArchiveUnchanged(saved.archiveKey, archived);
    await this.archive.assertCommittedSource(journal);
    const observed = await checkInputs();
    const { current } = await this.writer.readPreparationSnapshot();
    const remaining = clone(observed.sync);
    delete remaining[store.KEYS.index];
    for (const key of [...Object.keys(journal.chunks), ...Object.keys(saved.incomingChunks)]) {
      delete remaining[key];
    }
    const flags = {
      possibleOtherSyncChange: await store.digest(remaining) !== journal.syncBaseDigest,
      localDomainChanged: saved.localDomainDigest !== journal.localDomainDigest,
      journalHasOtherConflicts: journal.conflicts.some((path) =>
        !["keyboardGeneration", "sync.keyboardGeneration"].includes(path)
      ),
    };
    return { journal, current, flags };
  }

  async assertSaved(key, expected, type) {
    const actual = (await this.storage.local.get(key))[key];
    if (!equal(actual, expected)) throw error("CONFIGURATION_READBACK_FAILED");
    if (type === caseType) await this.inspectCase(actual);
    else await this.inspectDecision(actual);
  }

  differences(local, incoming) {
    return this.writer.keyboardKeys.filter((name) => !equal(local[name], incoming[name])).sort();
  }

  async save(type, value, verify, step) {
    const local = await this.storage.local.get(null);
    for (
      const key of Object.keys(local).filter((name) => this.archive.validKey(type, name)).sort()
    ) {
      let existing;
      try {
        existing = type === caseType
          ? (await this.inspectCase(local[key])).saved
          : await this.inspectDecision(local[key]);
      } catch (_) {
        continue;
      }
      if (equal(existing, value)) {
        await this.assertSaved(key, value, type);
        await verify();
        return { key, reused: true };
      }
    }
    const key = this.archive.keyFor(type, crypto.randomUUID());
    await this.archive.assertCapacity(local, key, value);
    await verify();
    if (Object.hasOwn(await this.storage.local.get(key), key)) {
      throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }
    await this.storage.local.set({ [key]: value });
    await this.assertSaved(key, value, type);
    await this.afterStep(step);
    await this.assertSaved(key, value, type);
    await verify();
    return { key, reused: false };
  }

  async capture(archiveKey) {
    await this.permit("capture");
    if (!this.archive.validKey("archive", archiveKey)) {
      throw error("INVALID_CONFIGURATION_RECOVERY");
    }
    return this.writer.enqueue(async () => {
      const journal = await this.archive.currentJournal(kind);
      this.assertTerminal(journal);
      const archived = await this.archive.inspectArchive(
        (await this.storage.local.get(archiveKey))[archiveKey],
      );
      if (archived.journalKind !== kind || !equal(archived.journal, journal)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.handler.assertNoOtherTransition();
      await this.archive.assertCommittedSource(journal);
      const values = await this.readInputs();
      const incoming = await this.candidateFromSync(values.sync, journal);
      const body = {
        formatVersion: 1,
        kind: "keyboard-sync-conflict",
        phase: journal.phase,
        journalDigest: journal.integrityDigest,
        archiveKey,
        archiveDigest: archived.archiveDigest,
        syncDigest: values.syncDigest,
        localDomainDigest: values.localDomainDigest,
        incomingIndex: incoming.index,
        incomingChunks: incoming.chunks,
      };
      const saved = { ...body, caseDigest: await store.digest(body) };
      await this.inspectCase(saved);
      const { current, flags } = await this.assertCurrent(saved);
      const fields = this.differences(current.keyboard, incoming.keyboard);
      const result = await this.save(caseType, saved, () => this.assertCurrent(saved), "sync-case");
      return {
        ...result,
        fields,
        ...flags,
        writeAllowed: false,
        releaseAllowed: false,
        lineageVerified: false,
      };
    });
  }

  async readCase(key) {
    if (!this.archive.validKey(caseType, key)) throw error("INVALID_CONFIGURATION_RECOVERY");
    return this.inspectCase((await this.storage.local.get(key))[key]);
  }

  async caseContext(key) {
    const { saved, incoming } = await this.readCase(key);
    await this.assertCurrent(saved);
    await this.assertSaved(key, saved, caseType);
    const { current, flags } = await this.assertCurrent(saved);
    const fields = this.differences(current.keyboard, incoming);
    return { saved, incoming, current, fields, flags };
  }

  async preview(key) {
    await this.permit("preview");
    return this.writer.enqueue(async () => {
      const context = await this.caseContext(key);
      const fields = Object.fromEntries(context.fields.map((name) => [name, {
        local: clone(context.current.keyboard[name]),
        incoming: clone(context.incoming[name]),
      }]));
      return {
        fields,
        localLegacyLimitations: legacyLimitations(context.current.keyboard),
        ...context.flags,
        writeAllowed: false,
        releaseAllowed: false,
        lineageVerified: false,
      };
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
      const context = await this.caseContext(caseKey);
      if (!context.fields.length) throw error("CONFIGURATION_CONFLICT_UNRESOLVED");
      if (
        !equal(Object.keys(choices).sort(), context.fields) ||
        Object.values(choices).some((value) => !allowedChoices.has(value))
      ) throw error("INVALID_CONFIGURATION_CHOICE");
      const body = {
        formatVersion: 1,
        kind: "keyboard-sync-decision",
        caseKey,
        caseDigest: context.saved.caseDigest,
        choices,
      };
      const decision = { ...body, decisionDigest: await store.digest(body) };
      await this.inspectDecision(decision);
      const verify = async () => {
        await this.assertSaved(caseKey, context.saved, caseType);
        await this.assertCurrent(context.saved);
      };
      const result = await this.save(decisionType, decision, verify, "sync-decision");
      return {
        ...result,
        ...context.flags,
        writeAllowed: false,
        releaseAllowed: false,
        lineageVerified: false,
      };
    });
  }

  async previewDecision(key) {
    await this.permit("preview-decision");
    return this.writer.enqueue(async () => {
      if (!this.archive.validKey(decisionType, key)) throw error("INVALID_CONFIGURATION_RECOVERY");
      const decision = await this.inspectDecision((await this.storage.local.get(key))[key]);
      const context = await this.caseContext(decision.caseKey);
      if (
        decision.caseDigest !== context.saved.caseDigest || !context.fields.length ||
        !equal(Object.keys(decision.choices).sort(), context.fields)
      ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      const candidate = clone(context.current.keyboard);
      for (const name of context.fields) {
        if (decision.choices[name] === "incoming") candidate[name] = clone(context.incoming[name]);
      }
      this.writer.validateCompleteKeyboard(candidate);
      await this.assertSaved(key, decision, decisionType);
      await this.assertSaved(decision.caseKey, context.saved, caseType);
      const { flags } = await this.assertCurrent(context.saved);
      return {
        candidate,
        legacyLimitations: legacyLimitations(candidate),
        ...flags,
        writeAllowed: false,
        releaseAllowed: false,
        lineageVerified: false,
      };
    });
  }
}
