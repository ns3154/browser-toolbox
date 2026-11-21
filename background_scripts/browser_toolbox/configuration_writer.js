// SPDX-License-Identifier: GPL-3.0-or-later
// 配置只由后台串行提交；恢复记录在业务写入前持久化，外部新值不得被补偿覆盖。
(function () {
  const FORMAT_VERSION = 1;
  const KEYS = Object.freeze({
    index: "browserToolboxKeyboardSettings",
    state: "browserToolboxKeyboardMigrationState",
    backup: "browserToolboxKeyboardMigrationBackup",
    frequency: "browserToolboxConfigurationWriteBudget",
    toolbox: "browserToolboxSettings",
    legacyToolbox: "openKeyMouseSettings",
    legacyBackup: "browserToolboxSettingsMigrationBackup",
  });
  const CHUNK_PREFIX = "browserToolboxKeyboardData:";
  const ROLLBACK_BACKUP_PREFIX = "browserToolboxKeyboardRollbackBackup:";
  const IMPORT_BACKUP_PREFIX = "browserToolboxConfigurationImportBackup:";
  const TRANSITION_RECORD_PREFIX = "browserToolboxKeyboardTransition:";
  const M2_CONFLICT_CAPTURE_PREFIX = `${TRANSITION_RECORD_PREFIX}m2-observation:`;
  const M2_CONFLICT_ARCHIVE_PREFIX = `${TRANSITION_RECORD_PREFIX}m2-archive:`;
  const OLD_SEARCH_DEFAULT = "bd: https://www.baidu.com/s?wd=%s 百度";
  const NEW_SEARCH_DEFAULT = "g: https://google.com/search?q=%s Google";
  const ROLLBACK_JOURNAL_KEY = "browserToolboxKeyboardRollbackJournal";
  const SYNC_PUBLISH_JOURNAL_KEY = "browserToolboxKeyboardSyncPublishJournal";
  const MAX_CHUNK_BYTES = 7 * 1024;
  const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
  const MAX_CONFLICT_REVIEW_FIELDS = 256;
  const MAX_CONFLICT_REVIEW_BYTES = 512 * 1024;
  const importBackupKeyPattern =
    /^browserToolboxConfigurationImportBackup:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
  const clone = (value) => structuredClone(value);
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
  // Chromium 的存储 JSON 会额外转义这三个字符；按转义后字节计费，避免低估配额。
  const itemBytes = (key, value) => {
    const json = JSON.stringify(value).replace(
      /[<\u2028\u2029]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    return new TextEncoder().encode(key).length + new TextEncoder().encode(json).length;
  };
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!record(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  const equal = (left, right) =>
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  async function digest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", encode(canonical(value)));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function error(code, properties = {}) {
    return Object.assign(new Error(code), { code, ...properties });
  }
  function cell(values, key) {
    return Object.hasOwn(values, key)
      ? { present: true, value: clone(values[key]) }
      : { present: false };
  }
  function matching(actual, expected) {
    return actual.present === expected.present &&
      (!actual.present || equal(actual.value, expected.value));
  }

  // 两份观察没有可信共同基线；仅比较双方，并把数组作为不可拆分的完整配置值。
  function compareCompatibilityObservation(committed, observed, selections = null) {
    const fields = [];
    const walk = (left, right, path) => {
      if (matching(left, right)) return clone(left);
      if (left.present && right.present && record(left.value) && record(right.value)) {
        const next = {};
        const keys = [...new Set([...Object.keys(left.value), ...Object.keys(right.value)])].sort();
        for (const key of keys) {
          if (["__proto__", "constructor", "prototype"].includes(key)) {
            throw error("INVALID_CONFIGURATION_RECOVERY");
          }
          const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
          const child = walk(cell(left.value, key), cell(right.value, key), `${path}/${escaped}`);
          if (child.present) next[key] = child.value;
        }
        return { present: true, value: next };
      }
      fields.push({ path, committed: clone(left), observed: clone(right) });
      if (fields.length > MAX_CONFLICT_REVIEW_FIELDS) {
        throw error("CONFIGURATION_CONFLICT_REVIEW_TOO_LARGE");
      }
      if (!selections) return clone(left);
      const side = selections.get(path);
      if (!["committed", "observed"].includes(side)) {
        throw error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
      }
      return clone(side === "committed" ? left : right);
    };
    const keyboard = walk({ present: true, value: committed.keyboard }, {
      present: true,
      value: observed.keyboard,
    }, "/keyboard").value;
    const toolbox = walk({ present: true, value: committed.toolbox }, {
      present: true,
      value: observed.toolbox,
    }, "/toolbox").value;
    if (encode(fields).length > MAX_CONFLICT_REVIEW_BYTES) {
      throw error("CONFIGURATION_CONFLICT_REVIEW_TOO_LARGE");
    }
    if (selections && selections.size !== fields.length) {
      throw error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
    }
    return { fields, keyboard, toolbox };
  }

  // 仅生成旧版设置的反向投影，不写存储；未知字段必须阻止后续回退，不能静默丢弃。
  function planLegacyKeyboardProjection(keyboard, defaults) {
    if (!record(keyboard) || !record(defaults)) throw error("INVALID_KEYBOARD_CONFIGURATION");
    const unknown = Object.keys(keyboard).filter((key) => !Object.hasOwn(defaults, key)).sort();
    if (unknown.length) throw error("UNSUPPORTED_CONFIGURATION_FIELDS", { conflicts: unknown });
    const target = {};
    const remove = [];
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const value = keyboard[key];
      if (
        !Object.hasOwn(keyboard, key) ||
        (Array.isArray(defaultValue)
          ? !Array.isArray(value)
          : typeof value !== typeof defaultValue) ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        encode(value).length > 256 * 1024
      ) throw error("INVALID_KEYBOARD_CONFIGURATION", { conflicts: [key] });
      if (equal(value, defaultValue)) remove.push(key);
      else target[key] = clone(value);
    }
    if (
      !Array.isArray(keyboard.exclusionRules) ||
      keyboard.exclusionRules.some((rule) =>
        !record(rule) || typeof rule.pattern !== "string" || typeof rule.passKeys !== "string"
      )
    ) throw error("INVALID_KEYBOARD_CONFIGURATION", { conflicts: ["exclusionRules"] });
    target.settingsVersion = "2.4.2";
    return { target, remove };
  }

  // 旧排除规则只理解 pattern 和 passKeys；其他字段可能改变语义，回退前必须提示并保留。
  function assertLegacyProjectionCompatible(keyboard) {
    const conflicts = [];
    for (const [index, rule] of keyboard.exclusionRules.entries()) {
      for (const key of Object.keys(rule).sort()) {
        if (key === "pattern" || key === "passKeys") continue;
        const label = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key) ? key : "未知字段";
        conflicts.push(`keyboard.exclusionRules[${index}].${label}`);
      }
    }
    if (conflicts.length) {
      throw error("UNSUPPORTED_CONFIGURATION_FIELDS", { conflicts: [...new Set(conflicts)] });
    }
  }

  // 按计划的 set/remove 顺序计算峰值；只检查，不预留配额或写入频率记录。
  function estimateSyncCapacity(before, steps, budget, limits) {
    if (!Array.isArray(budget)) throw error("INVALID_CONFIGURATION_RECOVERY");
    const projected = clone(before);
    const bytes = () =>
      Object.entries(projected).reduce((n, [key, value]) => n + itemBytes(key, value), 0);
    let peakBytes = bytes();
    let peakItems = Object.keys(projected).length;
    let syncWrites = 0;
    for (const step of steps) {
      const put = Object.entries(step.put || {}).filter(([key, value]) =>
        !Object.hasOwn(projected, key) || !equal(projected[key], value)
      );
      for (const [key, value] of put) {
        const size = itemBytes(key, value);
        if (size > limits.item) {
          throw error("browser-toolbox-sync-quota", {
            quota: "item",
            requiredBytes: size,
            limitBytes: limits.item,
          });
        }
        projected[key] = clone(value);
      }
      if (put.length) syncWrites++;
      peakBytes = Math.max(peakBytes, bytes());
      peakItems = Math.max(peakItems, Object.keys(projected).length);
      const remove = (step.remove || []).filter((key) => Object.hasOwn(projected, key));
      for (const key of remove) delete projected[key];
      if (remove.length) syncWrites++;
      peakBytes = Math.max(peakBytes, bytes());
      peakItems = Math.max(peakItems, Object.keys(projected).length);
    }
    if (peakBytes > limits.total) {
      throw error("browser-toolbox-sync-quota", {
        quota: "total",
        requiredBytes: peakBytes,
        limitBytes: limits.total,
      });
    }
    if (peakItems > limits.items) throw error("CONFIGURATION_SYNC_ITEMS");
    const now = Date.now();
    const times = budget.filter((time) => Number.isFinite(time) && time > now - 3600000);
    if (
      times.filter((time) => time > now - 60000).length + syncWrites > limits.minute ||
      times.length + syncWrites > limits.hour
    ) throw error("CONFIGURATION_SYNC_FREQUENCY");
    return { peakBytes, peakItems, syncWrites };
  }

  function mergeIdentifiedArray(baseline, incoming, current, path, conflicts) {
    const arrays = [baseline, incoming, current];
    const stringLists = ["toolbox.tools.pinnedIds", "toolbox.tools.contextMenu.toolIds"];
    const stringIdentity = stringLists.includes(path) && arrays.every((items) =>
      items.every((item) => typeof item === "string" && item.length > 0) && new Set(items).size === items.length
    );
    const identity = ["id", "pattern"].find((key) => arrays.every((items) => {
      const values = items.map((item) => record(item) && item[key]);
      return values.every((value) => typeof value === "string" && value.length > 0) &&
        new Set(values).size === values.length;
    }));
    if (!identity && !stringIdentity) return null;
    const idOf = (item) => stringIdentity ? item : item[identity];
    const ids = arrays.map((items) => items.map(idOf));
    const maps = arrays.map((items) => new Map(items.map((item) => [idOf(item), item])));
    const all = new Set(ids.flat());
    const merged = new Map();
    for (const id of all) {
      const value = merge(maps[0].get(id), maps[1].get(id), maps[2].get(id), `${path}[${id}]`, conflicts, true);
      if (value !== undefined) merged.set(id, value);
    }
    const baselineOrder = ids[0].filter((id) => maps[1].has(id));
    const incomingOrder = ids[1].filter((id) => maps[0].has(id));
    const reordered = !equal(baselineOrder, incomingOrder);
    const order = (reordered ? ids[1] : ids[2]).filter((id) => merged.has(id));
    const other = reordered ? ids[2] : ids[1];
    for (let index = 0; index < other.length; index++) {
      const id = other[index];
      if (!merged.has(id) || order.includes(id)) continue;
      const next = other.slice(index + 1).find((candidate) => order.includes(candidate));
      if (next !== undefined) order.splice(order.indexOf(next), 0, id);
      else {
        const prior = other.slice(0, index).reverse().find((candidate) => order.includes(candidate));
        if (prior === undefined) order.push(id);
        else order.splice(order.indexOf(prior) + 1, 0, id);
      }
    }
    return order.map((id) => merged.get(id));
  }

  // 用户明确保存时按稳定身份合并对象列表；无法识别身份的数组仍作为整体值。
  function merge(baseline, incoming, current, path = "settings", conflicts = [], preferIncoming = false) {
    if (equal(incoming, baseline)) return clone(current);
    if (equal(current, baseline) || equal(incoming, current)) return clone(incoming);
    if (preferIncoming && [baseline, incoming, current].every(Array.isArray)) {
      const identified = mergeIdentifiedArray(baseline, incoming, current, path, conflicts);
      if (identified) return identified;
    }
    if (record(baseline) && record(incoming) && record(current)) {
      const result = {};
      for (
        const key of new Set([
          ...Object.keys(baseline),
          ...Object.keys(incoming),
          ...Object.keys(current),
        ])
      ) {
        if (["__proto__", "constructor", "prototype"].includes(key)) {
          throw error("INVALID_CONFIGURATION");
        }
        const value = merge(
          baseline[key],
          incoming[key],
          current[key],
          `${path}.${key}`,
          conflicts,
          preferIncoming,
        );
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push(path);
    return clone(preferIncoming ? incoming : current);
  }

  async function createGeneration(snapshot, operationId, revision) {
    const fields = {};
    const chunks = {};
    for (const [field, value] of Object.entries(snapshot)) {
      const characters = Array.from(JSON.stringify(value));
      const names = [];
      let start = 0;
      while (start < characters.length) {
        const key = `${CHUNK_PREFIX}${operationId}:${field}:${names.length}`;
        let low = 1;
        let high = characters.length - start;
        let length = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const value = {
            operationId,
            part: names.length,
            text: characters.slice(start, start + middle).join(""),
          };
          if (itemBytes(key, value) <= MAX_CHUNK_BYTES) {
            length = middle;
            low = middle + 1;
          } else high = middle - 1;
        }
        if (!length) throw error("CONFIGURATION_CHUNK_TOO_LARGE");
        chunks[key] = {
          operationId,
          part: names.length,
          text: characters.slice(start, start + length).join(""),
        };
        names.push(key);
        start += length;
      }
      fields[field] = { chunks: names, digest: await digest(value) };
    }
    return { index: { formatVersion: FORMAT_VERSION, operationId, revision, fields }, chunks };
  }

  async function readGeneration(index, local, { legacyLocalChunks = false } = {}) {
    if (
      index?.formatVersion !== FORMAT_VERSION || !record(index.fields) ||
      !Number.isSafeInteger(index.revision) || index.revision < 1 ||
      typeof index.operationId !== "string" || index.operationId.length > 80
    ) {
      throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
    }
    if (Object.values(index.fields).some((field) => !Array.isArray(field?.chunks))) {
      throw error("INVALID_CONFIGURATION_INDEX");
    }
    const names = Object.values(index.fields).flatMap((field) => field.chunks);
    if (
      names.length > 2048 ||
      names.some((name) =>
        typeof name !== "string" || !name.startsWith(`${CHUNK_PREFIX}${index.operationId}:`)
      )
    ) {
      throw error("INVALID_CONFIGURATION_INDEX");
    }
    const stored = await local.get(names);
    const result = {};
    for (const [field, descriptor] of Object.entries(index.fields)) {
      if (
        ["__proto__", "constructor", "prototype"].includes(field) || !descriptor.chunks.length ||
        descriptor.chunks.some((name, part) =>
          name !== `${CHUNK_PREFIX}${index.operationId}:${field}:${part}`
        )
      ) {
        throw error("INVALID_CONFIGURATION_INDEX");
      }
      const text = descriptor.chunks.map((name, part) => {
        const chunk = stored[name];
        if (
          chunk?.operationId !== index.operationId || chunk.part !== part ||
          typeof chunk.text !== "string" ||
          (legacyLocalChunks
              ? new TextEncoder().encode(name).length + encode(chunk).length
              : itemBytes(name, chunk)) > MAX_CHUNK_BYTES
        ) {
          throw error("INCOMPLETE_CONFIGURATION_GENERATION");
        }
        return chunk.text;
      }).join("");
      const value = JSON.parse(text);
      if (await digest(value) !== descriptor.digest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      result[field] = value;
    }
    return result;
  }

  class ConfigurationWriter {
    constructor(
      {
        storage,
        defaults,
        migrateLegacy,
        migrateToolbox,
        validateToolbox,
        onCommit = () => {},
        afterStep = () => {},
      },
    ) {
      Object.assign(this, {
        storage,
        defaults,
        migrateLegacy,
        migrateToolbox,
        validateToolbox,
        onCommit,
        afterStep,
      });
      this.queue = Promise.resolve();
      this.lastSnapshot = null;
      this.busy = false;
      this.dirty = true;
      this.lastCaptureStatus = "none";
      this.ownedChanges = new Map();
      this.storage.onChanged?.addListener?.((changes, area) => {
        if (!["sync", "local"].includes(area)) return;
        const relevant = area === "sync"
          ? new Set([...this.keyboardKeys, "settingsVersion", KEYS.toolbox, KEYS.legacyToolbox])
          : new Set([
            KEYS.toolbox,
            KEYS.legacyToolbox,
            KEYS.index,
            ROLLBACK_JOURNAL_KEY,
            SYNC_PUBLISH_JOURNAL_KEY,
          ]);
        for (const [key, change] of Object.entries(changes)) {
          if (
            !relevant.has(key) &&
            !(area === "local" &&
              (key.startsWith(CHUNK_PREFIX) || key.startsWith(M2_CONFLICT_CAPTURE_PREFIX)))
          ) continue;
          const expected = this.ownedChanges.get(`${area}.${key}`);
          const actual = Object.hasOwn(change, "newValue")
            ? { present: true, value: change.newValue }
            : { present: false };
          if (!expected || !matching(actual, expected)) this.dirty = true;
        }
      });
    }

    enqueue(task) {
      const result = this.queue.then(task);
      this.queue = result.catch(() => {});
      return result;
    }

    get keyboardKeys() {
      return Object.keys(this.defaults());
    }

    cleanToolbox(value) {
      const next = clone(value);
      next.keyboard ||= {};
      next.keyboard.keyMappings = "";
      for (const key of this.keyboardKeys) if (key !== "keyMappings") delete next.keyboard[key];
      next.searchEngines = "";
      next.exclusionRules = [];
      return next;
    }

    validateKeyboard(value) {
      const defaults = this.defaults();
      const result = {};
      for (const key of this.keyboardKeys) {
        const item = value[key];
        if (
          Array.isArray(defaults[key]) ? !Array.isArray(item) : typeof item !== typeof defaults[key]
        ) throw error("INVALID_KEYBOARD_CONFIGURATION", { conflicts: [key] });
        if (
          typeof item === "number" && !Number.isFinite(item) || encode(item).length > 256 * 1024
        ) throw error("INVALID_KEYBOARD_CONFIGURATION", { conflicts: [key] });
        result[key] = clone(item);
      }
      if (
        result.exclusionRules.some((rule) =>
          !record(rule) || typeof rule.pattern !== "string" ||
          typeof rule.passKeys !== "string"
        )
      ) {
        throw error("INVALID_KEYBOARD_CONFIGURATION", { conflicts: ["exclusionRules"] });
      }
      return result;
    }

    validateCompleteKeyboard(value) {
      if (!record(value)) throw error("INVALID_KEYBOARD_CONFIGURATION");
      const unknown = Object.keys(value).filter((key) => !this.keyboardKeys.includes(key)).sort();
      if (unknown.length) throw error("UNSUPPORTED_CONFIGURATION_FIELDS", { conflicts: unknown });
      if (!equal(Object.keys(value).sort(), [...this.keyboardKeys].sort())) {
        throw error("INVALID_KEYBOARD_CONFIGURATION");
      }
      return this.validateKeyboard(value);
    }

    async source() {
      const [syncKeyboard, syncToolbox, localToolbox] = await Promise.all([
        this.storage.sync.get([...this.keyboardKeys, "settingsVersion", "newTabUrl"]),
        this.storage.sync.get([KEYS.toolbox, KEYS.legacyToolbox]),
        this.storage.local.get([KEYS.toolbox, KEYS.legacyToolbox]),
      ]);
      let selected = null;
      for (const key of [KEYS.toolbox, KEYS.legacyToolbox]) {
        for (const [area, values] of [["local", localToolbox], ["sync", syncToolbox]]) {
          if (record(values[key])) {
            selected = { value: values[key], area, legacy: key === KEYS.legacyToolbox };
            break;
          }
        }
        if (selected) break;
      }
      if (!selected && [syncToolbox, localToolbox].some((values) =>
        [KEYS.toolbox, KEYS.legacyToolbox].some((key) => Object.hasOwn(values, key))
      )) throw error("INVALID_CONFIGURATION_RECOVERY");
      const keyboard = this.validateKeyboard(
        Object.assign(clone(this.defaults()), this.migrateLegacy(clone(syncKeyboard))),
      );
      const legacyImplicitSearch = await this.usesLegacyImplicitSearch(syncKeyboard);
      if (legacyImplicitSearch === "pending") keyboard.searchEngines = OLD_SEARCH_DEFAULT;
      const toolbox = this.cleanToolbox(
        this.validateToolbox(this.migrateToolbox(selected?.value || {})),
      );
      const area = toolbox.general?.browserSyncEnabled === false ? "local" : "sync";
      return {
        keyboard,
        toolbox,
        area,
        raw: { syncKeyboard, syncToolbox, localToolbox },
        legacyImplicitSearch,
        sourceVersion: syncKeyboard.settingsVersion || "pre-2.0",
        legacy: selected?.legacy || false,
        legacyBackup: selected && selected.value.schemaVersion !== 9
          ? Object.fromEntries(
            Object.entries(selected.value).filter(([key]) =>
              Object.hasOwn(this.migrateToolbox({}), key) || key === "gestureBindings"
            ),
          )
          : null,
      };
    }

    async usesLegacyImplicitSearch(syncKeyboard) {
      if (
        Object.hasOwn(syncKeyboard, "searchEngines") ||
        this.defaults().searchEngines !== NEW_SEARCH_DEFAULT
      ) return false;
      const stored = await this.storage.local.get([KEYS.state, KEYS.index]);
      const state = stored[KEYS.state];
      if (!state) return false;
      try {
        this.assertRecoveryState(state);
        const expectedDigest = await digest(OLD_SEARCH_DEFAULT);
        if (state.phase === "COMMITTED" && !state.code &&
          equal(stored[KEYS.index], state.committedIndex) &&
          state.afterSnapshot?.keyboard?.searchEngines === OLD_SEARCH_DEFAULT &&
          state.committedIndex?.fields?.searchEngines?.digest === expectedDigest) {
          const committed = await this.loadCommitted(state, stored[KEYS.index]);
          return !this.generationFailure && committed?.keyboard?.searchEngines === OLD_SEARCH_DEFAULT
            ? "committed" : false;
        }
        // 未完成的本机事务沿用前后均一致的旧规则，才能在重启时安全恢复。
        return ["PREPARED", "APPLYING", "RECOVERING"].includes(state.phase) &&
          state.beforeSnapshot?.keyboard?.searchEngines === OLD_SEARCH_DEFAULT &&
          state.afterSnapshot?.keyboard?.searchEngines === OLD_SEARCH_DEFAULT &&
          state.beforeIndex?.fields?.searchEngines?.digest === expectedDigest &&
          state.afterIndex?.fields?.searchEngines?.digest === expectedDigest ? "pending" : false;
      } catch (_) {
        // 证据不完整时不猜测；既有冲突检测继续保护原配置。
        return false;
      }
    }

    snapshot(value, revision) {
      return {
        keyboard: clone(value.keyboard),
        toolbox: clone(value.toolbox),
        area: value.area,
        revision,
      };
    }

    view(value) {
      return {
        keyboard: { ...clone(value.keyboard), settingsVersion: "2.4.2" },
        toolboxSource: {
          value: clone(value.toolbox),
          area: value.area,
          legacy: false,
          canonicalPresent: true,
        },
        revision: value.revision,
        formatVersion: FORMAT_VERSION,
      };
    }

    async loadCommitted(state, index) {
      const committedIndex = state?.committedIndex || index;
      if (!committedIndex) return null;
      if (committedIndex.formatVersion !== FORMAT_VERSION) {
        throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
      }
      this.generationFailure = null;
      const expected = [...this.keyboardKeys, "toolbox"].sort();
      if (!equal(Object.keys(committedIndex.fields || {}).sort(), expected)) {
        throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      }
      try {
        // 已存在的本机代次可能由旧字节算法切片；读取时保留兼容，新同步代次仍按新规则重切。
        const fields = await readGeneration(committedIndex, this.storage.local, {
          legacyLocalChunks: true,
        });
        const keyboard = this.validateKeyboard(fields);
        const toolbox = this.validateToolbox(fields.toolbox);
        return this.snapshot({
          keyboard,
          toolbox,
          area: toolbox.general?.browserSyncEnabled === false ? "local" : "sync",
        }, committedIndex.revision);
      } catch (failure) {
        // 分片不完整时只使用与已提交摘要逐项相符的快照，不能拿默认值或旧迁移基线顶替。
        for (const candidate of [this.lastSnapshot, state?.afterSnapshot, state?.beforeSnapshot]) {
          if (!candidate || candidate.revision !== committedIndex.revision) continue;
          const fields = { ...candidate.keyboard, toolbox: candidate.toolbox };
          if (!equal(Object.keys(fields).sort(), expected)) continue;
          const valid = await Promise.all(
            expected.map(async (field) =>
              await digest(fields[field]) === committedIndex.fields[field].digest
            ),
          );
          if (!valid.every(Boolean)) continue;
          this.validateKeyboard(candidate.keyboard);
          this.validateToolbox(candidate.toolbox);
          this.generationFailure = failure.code || "CONFIGURATION_UNAVAILABLE";
          return clone(candidate);
        }
        throw failure;
      }
    }

    async loadGuardedCommitted({ state, index, conflictPending }) {
      const pending = state && !["COMMITTED", "ABORTED"].includes(state.phase);
      // 冲突阻止恢复时，首次提交的后像即使已有索引也不能被当作已提交代次。
      const committedIndex = conflictPending && pending ? state.beforeIndex || null : index;
      const evidence = conflictPending && pending ? { ...state, committedIndex } : state;
      return await this.loadCommitted(evidence, committedIndex);
    }

    assertRecoveryState(state) {
      if (
        !state || state.formatVersion !== FORMAT_VERSION ||
        !["PREPARED", "APPLYING", "RECOVERING", "COMMITTED", "ABORTED"].includes(state.phase)
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      if (
        !Array.isArray(state.steps) || state.steps.length > 12 ||
        typeof state.operationId !== "string" || state.operationId.length > 80
      ) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      const allowedSync = new Set([...this.keyboardKeys, "settingsVersion", KEYS.toolbox]);
      if (
        state.garbage && (!Array.isArray(state.garbage) || state.garbage.length > 2048 ||
          state.garbage.some((key) => typeof key !== "string" || !key.startsWith(CHUNK_PREFIX)))
      ) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      for (const step of state.steps) {
        if (!["sync", "local"].includes(step.area) || !record(step.cells)) {
          throw error("INVALID_CONFIGURATION_RECOVERY");
        }
        for (const [key, images] of Object.entries(step.cells)) {
          const allowed = step.area === "sync"
            ? allowedSync.has(key)
            : key === KEYS.toolbox || key === KEYS.index ||
              key.startsWith(`${CHUNK_PREFIX}${state.operationId}:`);
          if (
            !allowed || typeof images.before?.present !== "boolean" ||
            typeof images.after?.present !== "boolean"
          ) throw error("INVALID_CONFIGURATION_RECOVERY");
        }
      }
    }

    async writeImage(step, direction) {
      const area = this.storage[step.area];
      const values = await area.get(Object.keys(step.cells));
      const put = {};
      const remove = [];
      const conflicts = [];
      for (const [key, images] of Object.entries(step.cells)) {
        const actual = cell(values, key);
        const target = images[direction];
        if (matching(actual, target)) continue;
        if (!matching(actual, images[direction === "after" ? "before" : "after"])) {
          conflicts.push(
            `${step.area}.${
              key === KEYS.index || key.startsWith(CHUNK_PREFIX) ? "keyboardGeneration" : key
            }`,
          );
          continue;
        }
        if (target.present) put[key] = clone(target.value);
        else remove.push(key);
      }
      // 外部冲突整步停止；补偿时可安全恢复其余仍属于本次写入的字段。
      if (conflicts.length && direction === "after") {
        throw error("CONFIGURATION_RECOVERY_CONFLICT", { conflicts });
      }
      if (Object.keys(put).length) await area.set(put);
      if (remove.length) await area.remove(remove);
      const verified = await area.get([...Object.keys(put), ...remove]);
      for (const key of [...Object.keys(put), ...remove]) {
        if (!matching(cell(verified, key), step.cells[key][direction])) {
          throw error("CONFIGURATION_READBACK_FAILED");
        }
      }
      return conflicts;
    }

    async persist(state) {
      await this.storage.local.set({ [KEYS.state]: clone(state) });
    }

    async compatibilityConflictKeys() {
      const area = this.storage.local;
      const names = typeof area.getKeys === "function"
        ? await area.getKeys()
        : Object.keys(await area.get(null));
      return names.filter((name) => name.startsWith(M2_CONFLICT_CAPTURE_PREFIX)).sort();
    }

    assertSupportedObservationOptions(value, depth = 0) {
      if (depth > 32) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      if (Array.isArray(value)) {
        for (const item of value) this.assertSupportedObservationOptions(item, depth + 1);
        return;
      }
      if (!record(value)) return;
      if (typeof value.commandName === "string" && record(value.options)) {
        const command = globalThis.BrowserToolboxCommandDefinitions?.getCommand(value.commandName);
        for (const [key, option] of Object.entries(value.options)) {
          const rule = command?.optionSchema?.[key] || command?.parameterSchema?.[key];
          if (
            /token|cookie|password|secret|authorization|credential|api[-_]?key/i.test(key) ||
            !rule || !["boolean", "string", "enum", "mappingScalar"].includes(rule.type) ||
            !["boolean", "string", "number"].includes(typeof option) ||
            typeof option === "number" && !Number.isFinite(option) ||
            rule.type === "boolean" && typeof option !== "boolean" ||
            rule.type === "string" && typeof option !== "string" ||
            rule.type === "enum" && !rule.values?.includes(option) ||
            typeof option === "string" && rule.maxLength != null && option.length > rule.maxLength
          ) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
        }
      }
      for (const child of Object.values(value)) {
        this.assertSupportedObservationOptions(child, depth + 1);
      }
    }

    validateCompatibilityObservation(snapshot) {
      if (
        !record(snapshot) ||
        !equal(Object.keys(snapshot).sort(), ["area", "keyboard", "toolbox"]) ||
        !["local", "sync"].includes(snapshot.area)
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      const keyboard = this.validateCompleteKeyboard(snapshot.keyboard);
      assertLegacyProjectionCompatible(keyboard);
      const collect = globalThis.BrowserToolboxSettingsMigrations?.collectSettingsUnknownFields;
      if (typeof collect !== "function" || collect(snapshot.toolbox).length) {
        throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      }
      this.assertSupportedObservationOptions(snapshot.toolbox);
      const toolbox = this.validateToolbox(clone(snapshot.toolbox));
      if (!equal(toolbox, snapshot.toolbox)) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      const area = toolbox.general?.browserSyncEnabled === false ? "local" : "sync";
      if (area !== snapshot.area) throw error("INVALID_CONFIGURATION_RECOVERY");
    }

    async inspectCompatibilityConflictObservation(input) {
      const saved = clone(input);
      if (
        !record(saved) || saved.formatVersion !== FORMAT_VERSION ||
        !["m2-conflict-observation", "m2-conflict-marker", "m2-field-archive"].includes(saved.kind) ||
        typeof saved.capturedAt !== "string" || !Number.isFinite(Date.parse(saved.capturedAt)) ||
        typeof saved.recordDigest !== "string" || !/^[a-f0-9]{64}$/.test(saved.recordDigest)
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      const expected = saved.kind === "m2-conflict-observation"
        ? ["capturedAt", "committed", "formatVersion", "kind", "observed", "recordDigest"]
        : saved.kind === "m2-field-archive"
        ? ["capturedAt", "fields", "formatVersion", "kind", "recordDigest"]
        : ["capturedAt", "formatVersion", "kind", "reason", "recordDigest"];
      if (!equal(Object.keys(saved).sort(), expected)) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      const { recordDigest, ...body } = saved;
      if (await digest(body) !== recordDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      if (saved.kind === "m2-conflict-marker") {
        if (!["unsupported", "quota"].includes(saved.reason)) {
          throw error("INVALID_CONFIGURATION_RECOVERY");
        }
      } else if (saved.kind === "m2-field-archive") {
        if (!Array.isArray(saved.fields) || !saved.fields.length || saved.fields.length > MAX_CONFLICT_REVIEW_FIELDS) {
          throw error("INVALID_CONFIGURATION_RECOVERY");
        }
        const seen = new Set();
        for (const field of saved.fields) {
          if (!record(field) || !equal(Object.keys(field).sort(), ["committed", "observed", "path"]) ||
            typeof field.path !== "string" || !field.path.startsWith("/keyboard/") ||
            seen.has(field.path) || !this.keyboardKeys.includes(field.path.slice("/keyboard/".length))) {
            throw error("INVALID_CONFIGURATION_RECOVERY");
          }
          seen.add(field.path);
          const name = field.path.slice("/keyboard/".length);
          for (const item of [field.committed, field.observed]) {
            if (!record(item) || !equal(Object.keys(item).sort(), ["present", "value"]) || item.present !== true) {
              throw error("INVALID_CONFIGURATION_RECOVERY");
            }
            const keyboard = { ...clone(this.defaults()), [name]: clone(item.value) };
            this.validateKeyboard(keyboard);
            if (name === "exclusionRules") assertLegacyProjectionCompatible(keyboard);
          }
        }
        if (encode(saved.fields).length > MAX_CONFLICT_REVIEW_BYTES) {
          throw error("CONFIGURATION_CONFLICT_REVIEW_TOO_LARGE");
        }
      } else {
        this.validateCompatibilityObservation(saved.committed);
        this.validateCompatibilityObservation(saved.observed);
      }
      return saved;
    }

    async compatibilityConflictStatus(keys) {
      if (!keys.length) return "none";
      const values = await this.storage.local.get(keys);
      let status = "saved";
      for (const key of keys) {
        try {
          if (!this.validCompatibilityConflictKey(key)) {
            throw error("INVALID_CONFIGURATION_RECOVERY");
          }
          const saved = await this.inspectCompatibilityConflictObservation(values[key]);
          if (saved.kind === "m2-field-archive") throw error("INVALID_CONFIGURATION_RECOVERY");
          if (saved.kind === "m2-conflict-marker") {
            if (saved.reason === "quota" || status !== "quota") status = saved.reason;
          }
        } catch (_) {
          return "invalid";
        }
      }
      return status;
    }

    validCompatibilityConflictKey(key) {
      return typeof key === "string" && key.startsWith(M2_CONFLICT_CAPTURE_PREFIX) &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(
          key.slice(M2_CONFLICT_CAPTURE_PREFIX.length),
        );
    }

    validCompatibilityObservationKey(key) {
      if (this.validCompatibilityConflictKey(key)) return true;
      return typeof key === "string" && key.startsWith(M2_CONFLICT_ARCHIVE_PREFIX) &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(
          key.slice(M2_CONFLICT_ARCHIVE_PREFIX.length),
        );
    }

    async saveCompatibilityConflictObservation(committed, source, { forceMarker = false } = {}) {
      const asObservation = (snapshot) => ({
        keyboard: clone(snapshot.keyboard),
        toolbox: clone(snapshot.toolbox),
        area: snapshot.area,
      });
      const capturedAt = new Date().toISOString();
      let body;
      try {
        if (forceMarker) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
        const before = asObservation(committed);
        const observed = asObservation(source);
        this.validateCompatibilityObservation(before);
        this.validateCompatibilityObservation(observed);
        body = {
          formatVersion: FORMAT_VERSION,
          kind: "m2-conflict-observation",
          capturedAt,
          committed: before,
          observed,
        };
      } catch (failure) {
        if (failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
        // 未知字段可能包含不属于配置备份的内容，只保留不含正文的阻断标记。
        body = {
          formatVersion: FORMAT_VERSION,
          kind: "m2-conflict-marker",
          capturedAt,
          reason: "unsupported",
        };
      }
      try {
        return await this.appendCompatibilityConflictObservation(body);
      } catch (failure) {
        if (
          body.kind !== "m2-conflict-observation" ||
          !["CONFIGURATION_BACKUP_QUOTA", "CONFIGURATION_LOCAL_QUOTA"].includes(failure?.code)
        ) throw failure;
        // 正文超额时优先保留更小的阻断标记；标记也放不下时保留原数据并报告失败。
        return await this.appendCompatibilityConflictObservation({
          formatVersion: FORMAT_VERSION,
          kind: "m2-conflict-marker",
          capturedAt,
          reason: "quota",
        });
      }
    }

    async appendCompatibilityConflictObservation(body) {
      const saved = { ...body, recordDigest: await digest(body) };
      await this.inspectCompatibilityConflictObservation(saved);
      const key = `${M2_CONFLICT_CAPTURE_PREFIX}${crypto.randomUUID()}`;
      const local = await this.storage.local.get(null);
      if (Object.hasOwn(local, key)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      const bytes = itemBytes(key, saved);
      const owned = Object.entries(local).filter(([name]) =>
        name.startsWith(CHUNK_PREFIX) || name.startsWith(ROLLBACK_BACKUP_PREFIX) ||
        name.startsWith(IMPORT_BACKUP_PREFIX) || name.startsWith(TRANSITION_RECORD_PREFIX) ||
        name === ROLLBACK_JOURNAL_KEY || name === SYNC_PUBLISH_JOURNAL_KEY ||
        Object.values(KEYS).includes(name) && name !== KEYS.toolbox
      ).reduce((total, [name, value]) => total + itemBytes(name, value), bytes);
      if (owned > MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
      const used = typeof this.storage.local.getBytesInUse === "function"
        ? await this.storage.local.getBytesInUse(null)
        : Object.entries(local).reduce((total, [name, value]) => total + itemBytes(name, value), 0);
      if (used + bytes > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
        throw error("CONFIGURATION_LOCAL_QUOTA");
      }
      if (Object.hasOwn(await this.storage.local.get(key), key)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      await this.storage.local.set({ [key]: saved });
      const stored = (await this.storage.local.get(key))[key];
      if (!equal(saved, stored)) throw error("CONFIGURATION_READBACK_FAILED");
      await this.inspectCompatibilityConflictObservation(stored);
      await this.afterStep("compatibility-conflict-observation", { key });
      return saved.kind === "m2-conflict-marker" ? saved.reason : "saved";
    }

    listCompatibilityConflictObservations() {
      return this.enqueue(async () => {
        const area = this.storage.local;
        const names = typeof area.getKeys === "function"
          ? await area.getKeys()
          : Object.keys(await area.get(null));
        const keys = names.filter((name) =>
          name.startsWith(M2_CONFLICT_CAPTURE_PREFIX) || name.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)
        ).sort((left, right) =>
          Number(left.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)) -
            Number(right.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)) || left.localeCompare(right)
        );
        const values = await this.storage.local.get(keys);
        const result = [];
        for (const key of keys) {
          try {
            if (!this.validCompatibilityObservationKey(key)) {
              throw error("INVALID_CONFIGURATION_RECOVERY");
            }
            const saved = await this.inspectCompatibilityConflictObservation(values[key]);
            if (saved.kind === "m2-field-archive" && !key.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)) {
              throw error("INVALID_CONFIGURATION_RECOVERY");
            }
            result.push({
              key,
              status: saved.kind === "m2-field-archive" && key.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)
                ? "field-archive"
                : saved.kind === "m2-conflict-marker"
                ? saved.reason
                : key.startsWith(M2_CONFLICT_ARCHIVE_PREFIX) ? "archived" : "saved",
              capturedAt: saved.capturedAt,
            });
          } catch (_) {
            result.push({ key, status: "invalid" });
          }
        }
        return result;
      });
    }

    exportCompatibilityConflictObservation(key) {
      return this.enqueue(async () => {
        if (!this.validCompatibilityObservationKey(key)) {
          throw error("INVALID_CONFIGURATION_RECOVERY");
        }
        const saved = await this.inspectCompatibilityConflictObservation(
          (await this.storage.local.get(key))[key],
        );
        if (!["m2-conflict-observation", "m2-field-archive"].includes(saved.kind) ||
          saved.kind === "m2-field-archive" && !key.startsWith(M2_CONFLICT_ARCHIVE_PREFIX)) {
          throw error(
            saved.reason === "quota"
              ? "CONFIGURATION_BACKUP_QUOTA"
              : "UNSUPPORTED_CONFIGURATION_FIELDS",
          );
        }
        const again = (await this.storage.local.get(key))[key];
        if (!equal(saved, again)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        return {
          ...saved,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
          pointInTimeVerified: false,
          includesUnknownTopLevelSyncKeys: false,
          includesSeparateLocalCursorAssets: false,
          restorableAsSettings: false,
        };
      });
    }

    async readCompatibilityConflictReview(key, expectedDigest, selections) {
      if (!this.validCompatibilityObservationKey(key)) throw error("INVALID_CONFIGURATION_RECOVERY");
      const saved = await this.inspectCompatibilityConflictObservation(
        (await this.storage.local.get(key))[key],
      );
      if (saved.kind !== "m2-conflict-observation") {
        throw error(
          saved.reason === "quota"
            ? "CONFIGURATION_BACKUP_QUOTA"
            : "UNSUPPORTED_CONFIGURATION_FIELDS",
        );
      }
      if (expectedDigest !== undefined && saved.recordDigest !== expectedDigest) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const result = compareCompatibilityObservation(saved.committed, saved.observed, selections);
      if (!equal(saved, (await this.storage.local.get(key))[key])) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      return { saved, ...result };
    }

    // 仅识别这次版本默认值变化；无法证明来源时仍须由用户选择当前值。
    isSearchDefaultConflict(saved) {
      if (saved?.kind !== "m2-conflict-observation") return false;
      const fields = compareCompatibilityObservation(saved.committed, saved.observed).fields;
      return fields.length === 1 && fields[0].path === "/keyboard/searchEngines" &&
        fields[0].committed.present && fields[0].committed.value === OLD_SEARCH_DEFAULT &&
        fields[0].observed.present && fields[0].observed.value === NEW_SEARCH_DEFAULT &&
        this.defaults().searchEngines === NEW_SEARCH_DEFAULT;
    }

    async migrateImplicitSearchDefault(previous, committed, source = null) {
      const keys = previous.conflictKeys || [];
      if (
        previous.transitionPending || previous.state?.phase !== "COMMITTED" || previous.state.code ||
        !equal(previous.index, previous.state.committedIndex) || !committed || this.generationFailure ||
        keys.length > 1
      ) return false;
      let archived;
      try {
        source ||= await this.source();
        if (source.legacyImplicitSearch !== "committed" ||
          source.keyboard.searchEngines !== NEW_SEARCH_DEFAULT ||
          committed.keyboard.searchEngines !== OLD_SEARCH_DEFAULT) return false;
        const asObservation = (value) => ({
          keyboard: clone(value.keyboard), toolbox: clone(value.toolbox), area: value.area,
        });
        const oldSource = asObservation(source);
        oldSource.keyboard.searchEngines = OLD_SEARCH_DEFAULT;
        if (!equal(oldSource, asObservation(committed))) return false;
        if (keys.length) {
          if (!this.validCompatibilityConflictKey(keys[0])) return false;
          const saved = await this.inspectCompatibilityConflictObservation(
            (await this.storage.local.get(keys[0]))[keys[0]],
          );
          const onlyUnsupportedMarker = saved.kind === "m2-conflict-marker" && saved.reason === "unsupported";
          if (!onlyUnsupportedMarker && (!this.isSearchDefaultConflict(saved) ||
            !equal(saved.committed, asObservation(committed)) ||
            !equal(saved.observed, asObservation(source)))) return false;
        }
        const plan = { nextKeyboard: source.keyboard, nextToolbox: source.toolbox, conflicts: [] };
        archived = await this.archiveUserSaveObservations(previous, committed, source, plan, {
          legacySearchMigration: true,
        });
        // 升级仅发布新的本机默认快照，不补写原本缺失的同步键。
        await this.commitInternal({}, source, previous, { localOnly: true, beforeSnapshot: committed });
        this.dirty = true;
        return true;
      } catch (failure) {
        if (failure?.simulatedTermination) throw failure;
        if (archived) await this.restoreUserSaveObservations(previous, archived.originals, archived.archives);
        return false;
      }
    }

    reviewCompatibilityConflictObservation(key) {
      return this.enqueue(async () => {
        const { saved, fields } = await this.readCompatibilityConflictReview(key);
        return {
          recordDigest: saved.recordDigest,
          fields,
          searchDefaultRecoveryAvailable: this.validCompatibilityConflictKey(key) &&
            this.isSearchDefaultConflict(saved),
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
          pointInTimeVerified: false,
        };
      });
    }

    // 只接受当前观察值，不写同步键；原观察先归档，异常和重启仍保留保护证据。
    recoverSearchDefaultConflict(key, recordDigest) {
      return this.enqueue(async () => {
        if (typeof recordDigest !== "string" || !/^[a-f0-9]{64}$/.test(recordDigest)) {
          throw error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
        }
        const { saved } = await this.readCompatibilityConflictReview(key, recordDigest);
        if (!this.isSearchDefaultConflict(saved)) {
          throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
        }
        const previous = await this.recover();
        if (
          previous.transitionPending || !previous.conflictPending ||
          !equal(previous.conflictKeys, [key]) || previous.state?.phase !== "COMMITTED" ||
          previous.state.code || !equal(previous.index, previous.state.committedIndex)
        ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        const committed = await this.loadCommitted(previous.state, previous.index);
        if (!committed || this.generationFailure) {
          throw error(this.generationFailure || "CONFIGURATION_UNAVAILABLE");
        }
        const source = await this.source();
        const asObservation = (snapshot) => ({
          keyboard: snapshot.keyboard,
          toolbox: snapshot.toolbox,
          area: snapshot.area,
        });
        if (
          !equal(asObservation(committed), saved.committed) ||
          !equal(asObservation(source), saved.observed)
        ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        const archiveKey = M2_CONFLICT_ARCHIVE_PREFIX + key.slice(M2_CONFLICT_CAPTURE_PREFIX.length);
        const local = await this.storage.local.get(null);
        const archived = Object.hasOwn(local, archiveKey);
        if (archived && !equal(local[archiveKey], saved)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        if (!archived) {
          const addedBytes = itemBytes(archiveKey, saved);
          const owned = Object.entries(local).filter(([name]) =>
            name.startsWith(CHUNK_PREFIX) || name.startsWith(ROLLBACK_BACKUP_PREFIX) ||
            name.startsWith(IMPORT_BACKUP_PREFIX) || name.startsWith(TRANSITION_RECORD_PREFIX) ||
            name === ROLLBACK_JOURNAL_KEY || name === SYNC_PUBLISH_JOURNAL_KEY ||
            Object.values(KEYS).includes(name) && name !== KEYS.toolbox
          ).reduce((total, [name, value]) => total + itemBytes(name, value), addedBytes);
          if (owned > MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
          const used = typeof this.storage.local.getBytesInUse === "function"
            ? await this.storage.local.getBytesInUse(null)
            : Object.entries(local).reduce((total, [name, value]) => total + itemBytes(name, value), 0);
          if (used + addedBytes > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
            throw error("CONFIGURATION_LOCAL_QUOTA");
          }
          await this.storage.local.set({ [archiveKey]: saved });
        }
        const verify = async (active) => {
          const latest = await this.storage.local.get([
            key, archiveKey, KEYS.state, KEYS.index, ROLLBACK_JOURNAL_KEY,
            SYNC_PUBLISH_JOURNAL_KEY,
          ]);
          if (
            !equal(latest[archiveKey], saved) ||
            (active ? !equal(latest[key], saved) : Object.hasOwn(latest, key)) ||
            !equal(latest[KEYS.state], previous.state) ||
            !equal(latest[KEYS.index], previous.index) ||
            Object.hasOwn(latest, ROLLBACK_JOURNAL_KEY) ||
            Object.hasOwn(latest, SYNC_PUBLISH_JOURNAL_KEY) ||
            !equal(await this.compatibilityConflictKeys(), active ? [key] : []) ||
            !equal((await this.source()).raw, source.raw)
          ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        };
        await this.afterStep("search-default-archive", { key, archiveKey });
        await verify(true);
        await this.storage.local.remove(key);
        try {
          await this.afterStep("search-default-archived", { key, archiveKey });
          await verify(false);
          const result = await this.commitInternal({}, source, previous, {
            localOnly: true,
            beforeSnapshot: committed,
          });
          // 重新读取来源，避免恢复过程中观察到的更新被当作已处理。
          this.dirty = true;
          await this.readInternal();
          if (this.lastReadCode) throw error(this.lastReadCode);
          return result;
        } catch (failure) {
          if (!failure?.simulatedTermination) {
            const latest = await this.storage.local.get([key, archiveKey, KEYS.state]);
            if (
              !Object.hasOwn(latest, key) && equal(latest[archiveKey], saved) &&
              equal(latest[KEYS.state], previous.state)
            ) await this.storage.local.set({ [key]: saved });
          }
          this.dirty = true;
          throw failure;
        }
      });
    }

    prepareCompatibilityConflictCandidate(key, recordDigest, choices) {
      // 固定请求参数，避免排队期间调用方修改已确认的选择。
      const requested = clone(choices);
      return this.enqueue(async () => {
        if (
          typeof recordDigest !== "string" || !/^[a-f0-9]{64}$/.test(recordDigest) ||
          !Array.isArray(requested) || requested.length > MAX_CONFLICT_REVIEW_FIELDS
        ) throw error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
        const selections = new Map();
        for (const choice of requested) {
          if (
            !record(choice) || !equal(Object.keys(choice).sort(), ["path", "side"]) ||
            typeof choice.path !== "string" || !["committed", "observed"].includes(choice.side) ||
            selections.has(choice.path)
          ) throw error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
          selections.set(choice.path, choice.side);
        }
        const { fields, keyboard, toolbox } = await this.readCompatibilityConflictReview(
          key,
          recordDigest,
          selections,
        );
        if (!fields.length) throw error("CONFIGURATION_CONFLICT_NO_DIFFERENCES");
        const area = toolbox.general?.browserSyncEnabled === false ? "local" : "sync";
        this.validateCompatibilityObservation({ keyboard, toolbox, area });
        return {
          keyboard,
          toolbox,
          area,
          recordDigest,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
          pointInTimeVerified: false,
        };
      });
    }

    captureCurrentCompatibilityConflict() {
      return this.enqueue(async () => {
        const stored = await this.storage.local.get([
          KEYS.state,
          KEYS.index,
          ROLLBACK_JOURNAL_KEY,
          SYNC_PUBLISH_JOURNAL_KEY,
        ]);
        if (
          Object.hasOwn(stored, ROLLBACK_JOURNAL_KEY) ||
          Object.hasOwn(stored, SYNC_PUBLISH_JOURNAL_KEY)
        ) throw error("CONFIGURATION_TRANSITION_PENDING");
        const state = stored[KEYS.state];
        if (!state || !["COMMITTED", "ABORTED"].includes(state.phase)) {
          throw error("CONFIGURATION_CONFLICT_UNAVAILABLE");
        }
        this.assertRecoveryState(state);
        const committed = await this.loadCommitted(state, stored[KEYS.index]);
        if (!committed || this.generationFailure) {
          throw error(this.generationFailure || "CONFIGURATION_UNAVAILABLE");
        }
        const source = await this.source();
        const oldConflict = state.phase === "ABORTED" &&
          ["CONFIGURATION_EXTERNAL_CONFLICT", "CONFIGURATION_RECOVERY_CONFLICT"].includes(
            state.code,
          );
        if (
          !oldConflict && !(await this.compatibilityConflictKeys()).length &&
          equal(this.snapshot(source, committed.revision), committed)
        ) throw error("CONFIGURATION_CONFLICT_UNAVAILABLE");
        const status = await this.saveCompatibilityConflictObservation(committed, source);
        return {
          status,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
          pointInTimeVerified: false,
        };
      });
    }

    async cleanup(state) {
      const names = state.garbage || [];
      const values = await this.storage.local.get([KEYS.index, ...names]);
      if (!equal(values[KEYS.index], state.committedIndex)) return;
      const keep = new Set(
        [state.committedIndex, state.beforeIndex].filter(Boolean)
          .flatMap((index) => Object.values(index.fields).flatMap((field) => field.chunks || [])),
      );
      const unused = names.filter((key) => {
        const value = values[key];
        if (!key.startsWith(CHUNK_PREFIX) || keep.has(key)) return false;
        return typeof value?.operationId === "string" &&
          key.startsWith(`${CHUNK_PREFIX}${value.operationId}:`) &&
          Number.isSafeInteger(value.part) && typeof value.text === "string";
      });
      if (unused.length) await this.storage.local.remove(unused);
    }

    async finishCleanup(state) {
      try {
        await this.cleanup(state);
        if (state.cleanupPending || state.garbage?.length) {
          state.cleanupPending = false;
          state.garbage = [];
          await this.persist(state);
        }
      } catch (_) {
        // 业务提交已完成，清理失败只标记重试，不能撤销有效设置或删除未知数据。
        state.cleanupPending = true;
        await this.persist(state);
      }
    }

    async recover() {
      const stored = await this.storage.local.get([
        KEYS.state,
        KEYS.index,
        ROLLBACK_JOURNAL_KEY,
        SYNC_PUBLISH_JOURNAL_KEY,
      ]);
      let state = stored[KEYS.state];
      if (state) this.assertRecoveryState(state);
      const conflictKeys = await this.compatibilityConflictKeys();
      if (
        Object.hasOwn(stored, ROLLBACK_JOURNAL_KEY) ||
        Object.hasOwn(stored, SYNC_PUBLISH_JOURNAL_KEY)
      ) {
        return { state, index: stored[KEYS.index], transitionPending: true, conflictKeys };
      }
      if (conflictKeys.length) {
        // 追加记录仍存在时不触碰原恢复记录，也不能因来源暂时相同而自动解除保护。
        return { state, index: stored[KEYS.index], conflictPending: true, conflictKeys };
      }
      if (!state || ["COMMITTED", "ABORTED"].includes(state.phase)) {
        if (state?.cleanupPending) await this.finishCleanup(state);
        return { state, index: stored[KEYS.index] };
      }
      this.assertRecoveryState(state);
      state = { ...state, phase: "RECOVERING" };
      await this.persist(state);
      this.busy = true;
      try {
        for (let position = 0; position < state.steps.length; position++) {
          await this.writeImage(state.steps[position], "after");
          state.completedSteps = position + 1;
          await this.persist(state);
        }
        const actual = await this.source();
        if (!equal(this.snapshot(actual, state.revision), state.afterSnapshot)) {
          throw error("CONFIGURATION_RECOVERY_CONFLICT", { conflicts: ["configuration"] });
        }
        const completed = await readGeneration(state.afterIndex, this.storage.local, {
          legacyLocalChunks: true,
        });
        if (!equal(completed, { ...actual.keyboard, toolbox: actual.toolbox })) {
          throw error("CONFIGURATION_READBACK_FAILED");
        }
        state.phase = "COMMITTED";
        state.committedIndex = clone(state.afterIndex);
        state.code = null;
        await this.persist(state);
        this.lastSnapshot = clone(state.afterSnapshot);
        this.dirty = false;
        await this.finishCleanup(state);
        await this.onCommit(this.view(this.lastSnapshot));
        return { state, index: state.afterIndex };
      } catch (failure) {
        const conflicts = [...(failure.conflicts || [])];
        for (const step of [...state.steps].reverse()) {
          try {
            conflicts.push(...await this.writeImage(step, "before"));
          } catch (_) {
            state.code = "CONFIGURATION_COMPENSATION_PENDING";
            await this.persist(state);
            throw error(state.code);
          }
        }
        state.phase = "ABORTED";
        state.code = conflicts.length
          ? "CONFIGURATION_RECOVERY_CONFLICT"
          : failure.code || "CONFIGURATION_ABORTED";
        state.conflicts = [...new Set(conflicts)];
        state.committedIndex = clone(state.beforeIndex);
        await this.persist(state);
        this.lastSnapshot = await this.loadCommitted(state, state.beforeIndex);
        return { state, index: state.beforeIndex };
      } finally {
        this.busy = false;
      }
    }

    async readInternal({ reconcile = true } = {}) {
      const previous = await this.recover();
      const { state, index, transitionPending, conflictPending, conflictKeys } = previous;
      let snapshot = await this.loadGuardedCommitted({ state, index, conflictPending });
      if (transitionPending) {
        // 未接入的迁移记录存在时只提供完整快照，不能用旧来源触发新一轮写入。
        if (!snapshot || this.generationFailure) {
          throw error(this.generationFailure || "CONFIGURATION_UNAVAILABLE");
        }
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = "CONFIGURATION_TRANSITION_PENDING";
        return this.view(snapshot);
      }
      if (conflictPending) {
        if (!snapshot || this.generationFailure) {
          throw error(this.generationFailure || "CONFIGURATION_UNAVAILABLE");
        }
        if (await this.migrateImplicitSearchDefault(previous, snapshot)) {
          return await this.readInternal({ reconcile });
        }
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = state?.phase === "ABORTED" && state.code
          ? state.code
          : index && index.formatVersion !== FORMAT_VERSION
          ? "UNSUPPORTED_CONFIGURATION_FORMAT"
          : "CONFIGURATION_EXTERNAL_CONFLICT";
        this.lastCaptureStatus = await this.compatibilityConflictStatus(conflictKeys);
        return this.view(snapshot);
      }
      if (this.generationFailure && snapshot) {
        // 读取分片期间若提交状态已变化，旧快照不能覆盖新的恢复记录。
        let latest;
        try {
          latest = await this.storage.local.get([KEYS.state, KEYS.index]);
        } catch (_) {
          this.lastSnapshot = snapshot;
          this.dirty = true;
          this.lastReadCode = "CONFIGURATION_SOURCE_UNAVAILABLE";
          return this.view(snapshot);
        }
        if (!equal(latest[KEYS.state], state) || !equal(latest[KEYS.index], index)) {
          this.lastSnapshot = snapshot;
          this.dirty = true;
          this.lastReadCode = "CONFIGURATION_EXTERNAL_CONFLICT";
          return this.view(snapshot);
        }
        // 存储没有比较并交换；即使复核通过，也不能在读取失败时写入可能已过期的状态。
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = this.generationFailure;
        return this.view(snapshot);
      }
      if (state?.phase === "COMMITTED" && index && !equal(index, state.committedIndex)) {
        const code = index.formatVersion === FORMAT_VERSION
          ? "CONFIGURATION_EXTERNAL_CONFLICT"
          : "UNSUPPORTED_CONFIGURATION_FORMAT";
        try {
          this.lastCaptureStatus = await this.saveCompatibilityConflictObservation(
            snapshot,
            snapshot,
            { forceMarker: true },
          );
        } catch (failure) {
          this.lastCaptureStatus = ["CONFIGURATION_BACKUP_QUOTA", "CONFIGURATION_LOCAL_QUOTA"]
              .includes(failure?.code)
            ? "quota"
            : "failed";
        }
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = code;
        if (snapshot) return this.view(snapshot);
        throw error(code);
      }
      if (state?.code && state.phase === "ABORTED") {
        if (snapshot) {
          this.lastSnapshot = snapshot;
          this.dirty = false;
          return this.view(snapshot);
        }
        throw error(state.code, { conflicts: state.conflicts || [] });
      }
      let source;
      try {
        source = await this.source();
        if (source.legacyImplicitSearch) {
          // 旧默认回填仅在再次读取仍一致时生效；并发同步变化交回普通冲突检测。
          const checked = await this.source();
          if (!checked.legacyImplicitSearch || !equal(checked.raw, source.raw)) source = checked;
        }
        this.lastReadCode = null;
      } catch (failure) {
        if (!snapshot) throw failure;
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = "CONFIGURATION_SOURCE_UNAVAILABLE";
        return this.view(snapshot);
      }
      if (!snapshot) {
        const result = await this.commitInternal({}, source, { state, index });
        return result;
      }
      if (await this.migrateImplicitSearchDefault(previous, snapshot, source)) {
        return await this.readInternal({ reconcile });
      }
      // 不覆盖原恢复记录；追加观察或标记，并在没有安全解锁协议时持续阻止后续提交。
      if (reconcile && !equal(this.snapshot(source, snapshot.revision), snapshot)) {
        try {
          this.lastCaptureStatus = await this.saveCompatibilityConflictObservation(
            snapshot,
            source,
          );
        } catch (failure) {
          if (failure?.simulatedTermination) throw failure;
          this.lastCaptureStatus = ["CONFIGURATION_BACKUP_QUOTA", "CONFIGURATION_LOCAL_QUOTA"]
              .includes(failure?.code)
            ? "quota"
            : "failed";
        }
        this.lastSnapshot = snapshot;
        this.dirty = true;
        this.lastReadCode = "CONFIGURATION_EXTERNAL_CONFLICT";
        return this.view(snapshot);
      }
      this.lastSnapshot = snapshot;
      this.dirty = false;
      this.lastCaptureStatus = "none";
      return this.view(snapshot);
    }

    read(minimumRevision = 0) {
      // APPLYING 期间继续提供完整的上一次提交，不能读取跨区域写入的中间值。
      if (
        this.lastSnapshot && this.lastSnapshot.revision >= minimumRevision &&
        (this.busy || !this.dirty)
      ) {
        return Promise.resolve(this.view(this.lastSnapshot));
      }
      return this.enqueue(() => this.readInternal());
    }

    async preview() {
      return this.enqueue(async () => {
        let code;
        try {
          await this.readInternal();
        } catch (failure) {
          code = failure.code || "CONFIGURATION_UNAVAILABLE";
        }
        const state = (await this.storage.local.get(KEYS.state))[KEYS.state];
        return {
          formatVersion: FORMAT_VERSION,
          revision: state?.committedIndex?.revision || 0,
          phase: state?.phase || "PREPARED",
          code: code || state?.code || this.lastReadCode || null,
          conflicts: state?.conflicts || [],
          captureStatus: this.lastCaptureStatus,
          engineName: "vimium-compat",
        };
      });
    }

    async preflight(steps, state, backup) {
      const syncValues = await this.storage.sync.get(null);
      let projected = clone(syncValues);
      let peakBytes = Object.entries(projected).reduce(
        (n, [key, value]) => n + itemBytes(key, value),
        0,
      );
      let peakItems = Object.keys(projected).length;
      let syncWrites = 0;
      for (const step of steps.filter((step) => step.area === "sync")) {
        for (const [key, { after }] of Object.entries(step.cells)) {
          if (after.present) {
            const size = itemBytes(key, after.value);
            if (size > (this.storage.sync.QUOTA_BYTES_PER_ITEM || 8192)) {
              throw error("browser-toolbox-sync-quota", {
                quota: "item",
                requiredBytes: size,
                limitBytes: this.storage.sync.QUOTA_BYTES_PER_ITEM || 8192,
              });
            }
            projected[key] = after.value;
          }
        }
        // 与实际写入顺序一致：新值先落盘，旧键之后才删除，因此先计共存峰值。
        peakBytes = Math.max(
          peakBytes,
          Object.entries(projected).reduce((n, [key, value]) => n + itemBytes(key, value), 0),
        );
        peakItems = Math.max(peakItems, Object.keys(projected).length);
        for (const [key, { after }] of Object.entries(step.cells)) {
          if (!after.present) delete projected[key];
        }
        syncWrites += Number(Object.values(step.cells).some((images) => images.after.present)) +
          Number(Object.values(step.cells).some((images) => !images.after.present));
      }
      if (peakBytes > (this.storage.sync.QUOTA_BYTES || 102400)) {
        throw error("browser-toolbox-sync-quota", {
          quota: "total",
          requiredBytes: peakBytes,
          limitBytes: this.storage.sync.QUOTA_BYTES || 102400,
        });
      }
      if (peakItems > (this.storage.sync.MAX_ITEMS || 512)) throw error("CONFIGURATION_SYNC_ITEMS");
      const now = Date.now();
      const budget = (await this.storage.local.get(KEYS.frequency))[KEYS.frequency] || [];
      const times = budget.filter((time) => Number.isFinite(time) && time > now - 3600000);
      if (
        times.filter((time) => time > now - 60000).length + syncWrites >
          (this.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE || 120) ||
        times.length + syncWrites > (this.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR || 1800)
      ) throw error("CONFIGURATION_SYNC_FREQUENCY");
      const additions = {
        // 为最终提交、恢复和冲突摘要预留完整记录的峰值，而非只计算 PREPARED。
        [KEYS.state]: {
          ...state,
          phase: "RECOVERING",
          completedSteps: state.steps.length,
          committedIndex: state.afterIndex,
          cleanupPending: true,
          code: "CONFIGURATION_COMPENSATION_PENDING",
          conflicts: Array(64).fill("configuration"),
          capacity: {
            peakBytes,
            peakItems,
            syncWrites,
            ownedBytes: 4194304,
            requiredBytes: 10485760,
          },
        },
        [KEYS.frequency]: [...times, ...Array(syncWrites).fill(now)],
      };
      if (backup) Object.assign(additions, backup);
      for (const step of steps.filter((step) => step.area === "local")) {
        for (const [key, { after }] of Object.entries(step.cells)) {
          if (after.present) additions[key] = after.value;
        }
      }
      const localValues = await this.storage.local.get(null);
      const owned = Object.entries({ ...localValues, ...additions }).filter(([key]) =>
        key.startsWith(CHUNK_PREFIX) || key.startsWith(ROLLBACK_BACKUP_PREFIX) ||
        key.startsWith(IMPORT_BACKUP_PREFIX) ||
        key.startsWith(TRANSITION_RECORD_PREFIX) ||
        key === ROLLBACK_JOURNAL_KEY || key === SYNC_PUBLISH_JOURNAL_KEY ||
        Object.values(KEYS).includes(key) && key !== KEYS.toolbox
      );
      const ownedBytes = owned.reduce((n, [key, value]) => n + itemBytes(key, value), 0);
      if (ownedBytes > MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
      const usedBytes = typeof this.storage.local.getBytesInUse === "function"
        ? await this.storage.local.getBytesInUse(null)
        : Object.entries(localValues).reduce((n, [key, value]) => n + itemBytes(key, value), 0);
      const requiredBytes = usedBytes +
        Object.entries(additions).reduce(
          (n, [key, value]) =>
            n + itemBytes(key, value) -
            (Object.hasOwn(localValues, key) ? itemBytes(key, localValues[key]) : 0),
          0,
        );
      if (requiredBytes > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
        throw error("CONFIGURATION_LOCAL_QUOTA", {
          requiredBytes,
          limitBytes: this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024,
        });
      }
      await this.storage.local.set({ [KEYS.frequency]: additions[KEYS.frequency] });
      return { peakBytes, peakItems, syncWrites, ownedBytes, requiredBytes };
    }

    planCommit(input, source, { backupBeforeImport = false, preferIncoming = false } = {}) {
      const conflicts = [];
      const baseline = input.baseline || {};
      const patch = input.legacyPatch || {};
      if (!record(patch) || Object.keys(patch).some((key) => !this.keyboardKeys.includes(key))) {
        throw error("INVALID_KEYBOARD_CONFIGURATION");
      }
      if (
        backupBeforeImport && Object.hasOwn(patch, "exclusionRules") &&
        !equal(patch.exclusionRules, source.keyboard.exclusionRules)
      ) {
        try {
          assertLegacyProjectionCompatible(source.keyboard);
        } catch (failure) {
          if (failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
          const paths = failure.conflicts.slice(0, 20);
          if (failure.conflicts.length > 20) paths.push("…");
          throw error("CONFIGURATION_EXISTING_RULES_UNSUPPORTED", { conflicts: paths });
        }
      }
      const nextKeyboard = clone(source.keyboard);
      for (const [key, value] of Object.entries(patch)) {
        nextKeyboard[key] = merge(
          baseline.keyboard?.[key] ?? source.keyboard[key],
          value,
          source.keyboard[key],
          `keyboard.${key}`,
          conflicts,
          preferIncoming,
        );
      }
      let nextToolbox = source.toolbox;
      if (input.toolbox !== undefined) {
        const proposed = this.cleanToolbox(
          this.validateToolbox(this.migrateToolbox(input.toolbox)),
        );
        nextToolbox = merge(
          baseline.toolbox ? this.cleanToolbox(baseline.toolbox) : source.toolbox,
          proposed,
          source.toolbox,
          "toolbox",
          conflicts,
          preferIncoming,
        );
      }
      if (conflicts.length && !preferIncoming) {
        throw error("browser-toolbox-settings-conflict", {
          conflicts: [{ name: "BrowserToolbox", paths: conflicts, truncated: false }],
        });
      }
      this.validateKeyboard(nextKeyboard);
      this.validateToolbox(nextToolbox);
      return { nextKeyboard, nextToolbox, conflicts };
    }

    hasExplicitUserEdits(input) {
      if (!record(input) || !record(input.baseline)) return false;
      const patch = input.legacyPatch || {};
      if (!record(patch) || Object.keys(patch).some((key) => !this.keyboardKeys.includes(key))) {
        return false;
      }
      const baseline = input.baseline;
      const keys = Object.keys(patch);
      if (keys.length && (!record(baseline.keyboard) || keys.some((key) => !Object.hasOwn(baseline.keyboard, key)))) {
        return false;
      }
      try {
        const keyboard = clone(this.defaults());
        for (const key of keys) keyboard[key] = clone(baseline.keyboard[key]);
        this.validateKeyboard(keyboard);
        let changed = keys.some((key) => !equal(patch[key], baseline.keyboard[key]));
        if (input.toolbox !== undefined) {
          if (!record(baseline.toolbox)) return false;
          const before = this.cleanToolbox(this.validateToolbox(this.migrateToolbox(clone(baseline.toolbox))));
          const after = this.cleanToolbox(this.validateToolbox(this.migrateToolbox(clone(input.toolbox))));
          changed ||= !equal(before, after);
        }
        return changed;
      } catch (_) {
        return false;
      }
    }

    hasAmbiguousPhysicalToolbox(source) {
      const syncValue = source.raw.syncToolbox[KEYS.toolbox];
      const localValue = source.raw.localToolbox[KEYS.toolbox];
      const syncPresent = Object.hasOwn(source.raw.syncToolbox, KEYS.toolbox);
      const localPresent = Object.hasOwn(source.raw.localToolbox, KEYS.toolbox);
      return syncPresent && !record(syncValue) || localPresent && !record(localValue) ||
        syncPresent && localPresent && !equal(syncValue, localValue);
    }

    assertPhysicalToolboxWritable(source, plan) {
      const toolboxChanges = !equal(plan.nextToolbox, source.toolbox) ||
        (plan.nextToolbox.general?.browserSyncEnabled === false ? "local" : "sync") !== source.area;
      if (toolboxChanges && this.hasAmbiguousPhysicalToolbox(source)) {
        // 两处有不同原始配置时，本次不能清理未被观察到的另一处。
        throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
      }
    }

    async archiveUserSaveObservations(previous, committed, source, plan, { legacySearchMigration = false } = {}) {
      const keys = previous.conflictKeys || [];
      if (
        previous.transitionPending || previous.state?.phase !== "COMMITTED" || previous.state.code ||
        !equal(previous.index, previous.state.committedIndex) || !committed || this.generationFailure
      ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      const asObservation = (value) => ({
        keyboard: clone(value.keyboard),
        toolbox: clone(value.toolbox),
        area: value.area,
      });
      const committedObservation = asObservation(committed);
      const sourceObservation = asObservation(source);
      const local = await this.storage.local.get(null);
      let unsupportedMarker = false;
      if (keys.length) {
        this.assertPhysicalToolboxWritable(source, plan);
        if (keys.length === 1 && this.validCompatibilityConflictKey(keys[0])) {
          const item = await this.inspectCompatibilityConflictObservation(local[keys[0]]);
          unsupportedMarker = item.kind === "m2-conflict-marker" && item.reason === "unsupported";
        }
        if (!unsupportedMarker) {
          this.validateCompatibilityObservation(committedObservation);
          this.validateCompatibilityObservation(sourceObservation);
        }
      }
      const originals = {};
      const archives = {};
      const savedObservations = [];
      for (const key of keys) {
        if (!this.validCompatibilityConflictKey(key)) throw error("INVALID_CONFIGURATION_RECOVERY");
        const saved = await this.inspectCompatibilityConflictObservation(local[key]);
        if (!(unsupportedMarker && saved.kind === "m2-conflict-marker") &&
          (saved.kind !== "m2-conflict-observation" || !equal(saved.committed, committedObservation))) {
          throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
        }
        originals[key] = saved;
        savedObservations.push(saved);
        const archiveKey = M2_CONFLICT_ARCHIVE_PREFIX + key.slice(M2_CONFLICT_CAPTURE_PREFIX.length);
        if (Object.hasOwn(local, archiveKey) && !equal(local[archiveKey], saved)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        archives[archiveKey] = saved;
      }
      if (!keys.length || !savedObservations.some((item) => equal(item.observed, sourceObservation))) {
        // 来源已再次变化时单独保留最新观察；页面并发则保留本次写入前后的配置。
        const observed = keys.length || legacySearchMigration ? sourceObservation : {
          keyboard: clone(plan.nextKeyboard),
          toolbox: clone(plan.nextToolbox),
          area: plan.nextToolbox.general?.browserSyncEnabled === false ? "local" : "sync",
        };
        const before = keys.length || legacySearchMigration ? committedObservation : sourceObservation;
        let body;
        if (unsupportedMarker) {
          if (!equal(committedObservation.toolbox, sourceObservation.toolbox) ||
            committedObservation.area !== sourceObservation.area) {
            throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
          }
          const fields = compareCompatibilityObservation(committedObservation, sourceObservation).fields;
          if (!fields.length || fields.some((field) =>
            !field.path.startsWith("/keyboard/") ||
            !this.keyboardKeys.includes(field.path.slice("/keyboard/".length))
          )) throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
          // 未知规则保持原样；只备份能够验证的实际键盘差异。
          body = { formatVersion: FORMAT_VERSION, kind: "m2-field-archive", capturedAt: new Date().toISOString(), fields };
        } else try {
          this.validateCompatibilityObservation(before);
          this.validateCompatibilityObservation(observed);
          body = {
            formatVersion: FORMAT_VERSION,
            kind: "m2-conflict-observation",
            capturedAt: new Date().toISOString(),
            committed: before,
            observed,
          };
        } catch (failure) {
          if (keys.length || failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
          // 无关未知字段不能复制进备份；只归档可验证的键盘冲突字段。
          const paths = legacySearchMigration ? ["keyboard.searchEngines"] : [...new Set(plan.conflicts)];
          const fields = paths.map((path) => {
            if (!path.startsWith("keyboard.") || !this.keyboardKeys.includes(path.slice("keyboard.".length))) {
              throw failure;
            }
            const name = path.slice("keyboard.".length);
            return {
              path: `/keyboard/${name}`,
              committed: cell(legacySearchMigration ? committed.keyboard : source.keyboard, name),
              observed: cell(legacySearchMigration ? source.keyboard : plan.nextKeyboard, name),
            };
          });
          body = {
            formatVersion: FORMAT_VERSION,
            kind: "m2-field-archive",
            capturedAt: new Date().toISOString(),
            fields,
          };
        }
        const saved = { ...body, recordDigest: await digest(body) };
        await this.inspectCompatibilityConflictObservation(saved);
        const archiveKey = `${M2_CONFLICT_ARCHIVE_PREFIX}${crypto.randomUUID()}`;
        if (Object.hasOwn(local, archiveKey)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        archives[archiveKey] = saved;
      }
      const additions = Object.fromEntries(Object.entries(archives).filter(([key]) => !Object.hasOwn(local, key)));
      const addedBytes = Object.entries(additions).reduce((total, [key, value]) => total + itemBytes(key, value), 0);
      const owned = Object.entries(local).filter(([name]) =>
        name.startsWith(CHUNK_PREFIX) || name.startsWith(ROLLBACK_BACKUP_PREFIX) ||
        name.startsWith(IMPORT_BACKUP_PREFIX) || name.startsWith(TRANSITION_RECORD_PREFIX) ||
        name === ROLLBACK_JOURNAL_KEY || name === SYNC_PUBLISH_JOURNAL_KEY ||
        Object.values(KEYS).includes(name) && name !== KEYS.toolbox
      ).reduce((total, [name, value]) => total + itemBytes(name, value), addedBytes);
      if (owned > MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
      const used = typeof this.storage.local.getBytesInUse === "function"
        ? await this.storage.local.getBytesInUse(null)
        : Object.entries(local).reduce((total, [name, value]) => total + itemBytes(name, value), 0);
      if (used + addedBytes > (this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024)) {
        throw error("CONFIGURATION_LOCAL_QUOTA");
      }
      const verify = async (active, archived) => {
        const latest = await this.storage.local.get([
          ...keys, ...Object.keys(archives), KEYS.state, KEYS.index, ROLLBACK_JOURNAL_KEY,
          SYNC_PUBLISH_JOURNAL_KEY,
        ]);
        if (
          !equal(latest[KEYS.state], previous.state) || !equal(latest[KEYS.index], previous.index) ||
          Object.hasOwn(latest, ROLLBACK_JOURNAL_KEY) || Object.hasOwn(latest, SYNC_PUBLISH_JOURNAL_KEY) ||
          !equal(await this.compatibilityConflictKeys(), active ? keys : []) ||
          !equal((await this.source()).raw, source.raw)
        ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        for (const [key, value] of Object.entries(originals)) {
          if (active ? !equal(latest[key], value) : Object.hasOwn(latest, key)) {
            throw error("CONFIGURATION_EXTERNAL_CONFLICT");
          }
        }
        for (const [key, value] of Object.entries(archives)) {
          if (archived ? !equal(latest[key], value) :
            Object.hasOwn(local, key) ? !equal(latest[key], value) : Object.hasOwn(latest, key)) {
            throw error("CONFIGURATION_EXTERNAL_CONFLICT");
          }
        }
      };
      await verify(true, false);
      if (Object.keys(additions).length) await this.storage.local.set(additions);
      await this.afterStep(legacySearchMigration ? "search-default-auto-archive" : "user-save-archive", {
        keys, archives: Object.keys(archives),
      });
      await verify(true, true);
      if (keys.length) await this.storage.local.remove(keys);
      try {
        await this.afterStep(legacySearchMigration ? "search-default-auto-archived" : "user-save-archived", {
          keys, archives: Object.keys(archives),
        });
        await verify(false, true);
      } catch (failure) {
        if (!failure?.simulatedTermination) await this.restoreUserSaveObservations(previous, originals, archives);
        throw failure;
      }
      return { originals, archives };
    }

    async restoreUserSaveObservations(previous, originals, archives) {
      const keys = Object.keys(originals);
      if (!keys.length) return;
      const latest = await this.storage.local.get([KEYS.state, KEYS.index, ...keys, ...Object.keys(archives)]);
      if (!equal(latest[KEYS.state], previous.state) || !equal(latest[KEYS.index], previous.index)) return;
      if (Object.entries(archives).some(([key, value]) => !equal(latest[key], value))) return;
      const missing = Object.fromEntries(Object.entries(originals).filter(([key]) => !Object.hasOwn(latest, key)));
      if (Object.keys(missing).length) await this.storage.local.set(missing);
    }

    async commitInternal(
      input,
      source,
      previous,
      {
        backupBeforeImport = false,
        localOnly = false,
        beforeSnapshot = null,
        preferIncoming = false,
      } = {},
    ) {
      const { nextKeyboard, nextToolbox } = this.planCommit(input, source, {
        backupBeforeImport,
        preferIncoming,
      });
      const revision = (previous.state?.committedIndex?.revision || previous.index?.revision || 0) +
        1;
      const operationId = crypto.randomUUID();
      const afterSnapshot = this.snapshot({
        keyboard: nextKeyboard,
        toolbox: nextToolbox,
        area: nextToolbox.general?.browserSyncEnabled === false ? "local" : "sync",
      }, revision);
      const generation = await createGeneration(
        { ...nextKeyboard, toolbox: nextToolbox },
        operationId,
        revision,
      );
      generation.index.sourceDigest = await digest({
        keyboard: nextKeyboard,
        toolbox: nextToolbox,
        area: afterSnapshot.area,
      });
      const beforeIndex = previous.state?.committedIndex || previous.index || null;
      const steps = [];
      const addStep = (area, before, after) => {
        const cells = {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const images = { before: cell(before, key), after: cell(after, key) };
          if (!matching(images.before, images.after)) cells[key] = images;
        }
        if (Object.keys(cells).length) steps.push({ area, cells });
      };
      const { target: targetKeyboard } = planLegacyKeyboardProjection(
        nextKeyboard,
        this.defaults(),
      );
      const rawKeyboard = Object.fromEntries(
        Object.entries(source.raw.syncKeyboard).filter(([key]) =>
          this.keyboardKeys.includes(key) || key === "settingsVersion"
        ),
      );
      if (!localOnly) addStep("sync", rawKeyboard, targetKeyboard);
      const targetArea = afterSnapshot.area;
      const otherArea = targetArea === "sync" ? "local" : "sync";
      const writeToolbox = !localOnly && !this.hasAmbiguousPhysicalToolbox(source) && (previous.state?.phase !== "COMMITTED" ||
        !equal(nextToolbox, source.toolbox) || targetArea !== source.area);
      if (writeToolbox) addStep(
        targetArea,
        Object.hasOwn(source.raw[`${targetArea}Toolbox`], KEYS.toolbox)
          ? { [KEYS.toolbox]: source.raw[`${targetArea}Toolbox`][KEYS.toolbox] }
          : {},
        { [KEYS.toolbox]: nextToolbox },
      );
      if (writeToolbox) addStep(
        otherArea,
        Object.hasOwn(source.raw[`${otherArea}Toolbox`], KEYS.toolbox)
          ? { [KEYS.toolbox]: source.raw[`${otherArea}Toolbox`][KEYS.toolbox] }
          : {},
        {},
      );
      addStep("local", {}, generation.chunks);
      const rawIndex = await this.storage.local.get(KEYS.index);
      addStep("local", rawIndex, { [KEYS.index]: generation.index });
      const state = {
        formatVersion: FORMAT_VERSION,
        operationId,
        revision,
        phase: "PREPARED",
        completedSteps: 0,
        steps,
        beforeIndex,
        afterIndex: generation.index,
        committedIndex: beforeIndex,
        beforeSnapshot: beforeSnapshot || this.snapshot(source, revision - 1),
        afterSnapshot,
        code: null,
        sourceVersion: source.sourceVersion,
        // 只清理先前有效索引明确引用过的代次，不扫描并删除未知或未来格式的暂存片。
        garbage: [
          ...new Set([
            ...(previous.state?.garbage || []),
            ...Object.values(previous.state?.beforeIndex?.fields || {}).flatMap((field) =>
              field.chunks || []
            ),
          ]),
        ],
      };
      this.assertRecoveryState(state);
      const storedBackups = await this.storage.local.get([KEYS.backup, KEYS.legacyBackup]);
      const backup = {};
      if (!storedBackups[KEYS.backup]) {
        backup[KEYS.backup] = {
          formatVersion: FORMAT_VERSION,
          sourceVersion: source.sourceVersion,
          createdAt: new Date().toISOString(),
          sourceDigest: await digest({
            keyboard: source.keyboard,
            toolbox: source.toolbox,
            area: source.area,
          }),
          baseline: this.snapshot(source, revision - 1),
        };
      }
      if (source.legacyBackup && !storedBackups[KEYS.legacyBackup]) {
        backup[KEYS.legacyBackup] = clone(source.legacyBackup);
      }
      let importKey, importBackup;
      if (backupBeforeImport) {
        importKey = `${IMPORT_BACKUP_PREFIX}${operationId}`;
        if (Object.hasOwn(await this.storage.local.get(importKey), importKey)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        const snapshot = this.snapshot(source, revision - 1);
        const id = snapshot.toolbox.cursor?.localAssetId;
        let cursorAsset = null;
        if (id) {
          const value = cell(await this.storage.local.get(id), id);
          cursorAsset = { id, ...value };
        }
        const body = {
          formatVersion: FORMAT_VERSION,
          kind: "before-import",
          createdAt: new Date().toISOString(),
          sourceDigest: await digest({
            keyboard: snapshot.keyboard,
            toolbox: snapshot.toolbox,
            area: snapshot.area,
          }),
          snapshot,
          cursorAsset,
        };
        importBackup = { ...body, backupDigest: await digest(body) };
        await this.inspectImportBackup(importBackup);
        backup[importKey] = importBackup;
      }
      state.capacity = await this.preflight(steps, state, backup);
      if (importKey && Object.hasOwn(await this.storage.local.get(importKey), importKey)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      if (Object.keys(backup).length) await this.storage.local.set(backup);
      if (importKey) {
        const verify = async () => {
          const stored = (await this.storage.local.get(importKey))[importKey];
          if (!equal(stored, importBackup)) throw error("CONFIGURATION_READBACK_FAILED");
          await this.inspectImportBackup(stored);
          const observed = await this.storage.local.get([
            KEYS.state,
            KEYS.index,
            ROLLBACK_JOURNAL_KEY,
            SYNC_PUBLISH_JOURNAL_KEY,
          ]);
          if (
            Object.hasOwn(observed, ROLLBACK_JOURNAL_KEY) ||
            Object.hasOwn(observed, SYNC_PUBLISH_JOURNAL_KEY) ||
            !equal(observed[KEYS.state], previous.state) ||
            !equal(observed[KEYS.index], previous.index) ||
            !equal((await this.source()).raw, source.raw)
          ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
          if (importBackup.cursorAsset) {
            const { id, ...expected } = importBackup.cursorAsset;
            if (!matching(cell(await this.storage.local.get(id), id), expected)) {
              throw error("CONFIGURATION_EXTERNAL_CONFLICT");
            }
          }
        };
        await verify();
        await this.afterStep("import-backup", clone(state));
        await verify();
      }
      await this.persist(state);
      this.ownedChanges = new Map(
        steps.flatMap((step) =>
          Object.entries(step.cells).map(([key, images]) => [`${step.area}.${key}`, images.after])
        ),
      );
      this.busy = true;
      try {
        state.phase = "APPLYING";
        await this.persist(state);
        for (let position = 0; position < steps.length; position++) {
          await this.writeImage(steps[position], "after");
          state.completedSteps = position + 1;
          await this.persist(state);
          await this.afterStep(position, clone(state));
        }
        const actual = await this.source();
        if (!equal(this.snapshot(actual, revision), afterSnapshot)) {
          throw error("CONFIGURATION_RECOVERY_CONFLICT", { conflicts: ["configuration"] });
        }
        const verified = await readGeneration(generation.index, this.storage.local);
        if (!equal(verified, { ...nextKeyboard, toolbox: nextToolbox })) {
          throw error("CONFIGURATION_READBACK_FAILED");
        }
        state.phase = "COMMITTED";
        state.committedIndex = generation.index;
        await this.persist(state);
        this.lastSnapshot = afterSnapshot;
        this.dirty = false;
        await this.finishCleanup(state);
      } catch (failure) {
        if (failure.simulatedTermination) throw failure;
        // 不依赖当前 catch 的内存前像，补偿与下一次启动共用持久恢复协议。
        const recovered = await this.recover();
        if (recovered.conflictPending) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        if (recovered.state?.phase !== "COMMITTED") throw failure;
        return this.view(this.lastSnapshot);
      } finally {
        this.busy = false;
      }
      await this.onCommit(this.view(this.lastSnapshot));
      return this.view(this.lastSnapshot);
    }

    async commitQueued(input, backupBeforeImport = false) {
      await this.readInternal();
      const previous = await this.recover();
      if (previous.state?.code) {
        throw error(previous.state.code, { conflicts: previous.state.conflicts || [] });
      }
      const explicitEdits = !backupBeforeImport && this.hasExplicitUserEdits(input);
      if (this.dirty && this.lastReadCode &&
        !(previous.conflictPending && explicitEdits && this.lastReadCode === "CONFIGURATION_EXTERNAL_CONFLICT")) {
        throw error(this.lastReadCode, { conflicts: ["keyboardGeneration"] });
      }
      if (previous.transitionPending) throw error("CONFIGURATION_TRANSITION_PENDING");
      const source = await this.source();
      const committed = await this.loadCommitted(previous.state, previous.index);
      if (this.generationFailure) throw error(this.generationFailure);
      if (!previous.conflictPending && committed && !equal(this.snapshot(source, committed.revision), committed)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboard", "toolbox"] });
      }
      const plan = this.planCommit(input, source, { backupBeforeImport, preferIncoming: explicitEdits });
      this.assertPhysicalToolboxWritable(source, plan);
      let archived;
      if (previous.conflictPending || plan.conflicts.length) {
        archived = await this.archiveUserSaveObservations(previous, committed, source, plan);
      }
      try {
        // 仅覆盖用户相对于页面基线修改过的字段，未改字段沿用本次重读的来源。
        return await this.commitInternal(input, source, previous, {
          backupBeforeImport,
          preferIncoming: explicitEdits,
          beforeSnapshot: previous.conflictPending ? committed : null,
        });
      } catch (failure) {
        if (archived && !failure?.simulatedTermination) {
          await this.restoreUserSaveObservations(previous, archived.originals, archived.archives);
        }
        throw failure;
      }
    }

    commit(input) {
      let captured;
      try {
        captured = clone(input);
      } catch (_) {
        return Promise.reject(error("INVALID_CONFIGURATION"));
      }
      return this.enqueue(() => this.commitQueued(captured));
    }

    importConfiguration(input) {
      let captured;
      try {
        captured = clone(input);
      } catch (_) {
        return Promise.reject(error("INVALID_CONFIGURATION"));
      }
      return this.enqueue(() => this.commitQueued(captured, true));
    }

    resolve(choice) {
      return this.enqueue(async () => {
        if (!["incoming", "committed"].includes(choice)) {
          throw error("INVALID_CONFIGURATION_CHOICE");
        }
        const stored = await this.storage.local.get([
          KEYS.state,
          KEYS.index,
          ROLLBACK_JOURNAL_KEY,
          SYNC_PUBLISH_JOURNAL_KEY,
        ]);
        if (
          Object.hasOwn(stored, ROLLBACK_JOURNAL_KEY) ||
          Object.hasOwn(stored, SYNC_PUBLISH_JOURNAL_KEY)
        ) throw error("CONFIGURATION_TRANSITION_PENDING");
        const index = stored[KEYS.index];
        if (index && index.formatVersion !== FORMAT_VERSION) {
          throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
        }
        if (
          index &&
          !equal(
            Object.keys(index.fields || {}).sort(),
            [...this.keyboardKeys, "toolbox"].sort(),
          )
        ) {
          throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
        }
        // 没有原子比较并交换时，读取后的外部更新可能被覆盖；保留记录等待安全协议。
        throw error("CONFIGURATION_CONFLICT_REVIEW_REQUIRED");
      });
    }

    exportCompatibilityConflict() {
      return this.enqueue(async () => {
        const stateKeys = [KEYS.state, KEYS.index, ROLLBACK_JOURNAL_KEY, SYNC_PUBLISH_JOURNAL_KEY];
        const syncKeys = [
          ...this.keyboardKeys,
          "settingsVersion",
          "newTabUrl",
          KEYS.toolbox,
          KEYS.legacyToolbox,
        ];
        const localKeys = [KEYS.toolbox, KEYS.legacyToolbox, KEYS.index];
        const before = await this.storage.local.get(stateKeys);
        const conflictKeys = await this.compatibilityConflictKeys();
        if (
          Object.hasOwn(before, ROLLBACK_JOURNAL_KEY) ||
          Object.hasOwn(before, SYNC_PUBLISH_JOURNAL_KEY)
        ) throw error("CONFIGURATION_TRANSITION_PENDING");
        const state = before[KEYS.state];
        if (!state || !["COMMITTED", "ABORTED"].includes(state.phase)) {
          throw error("CONFIGURATION_CONFLICT_UNAVAILABLE");
        }
        this.assertRecoveryState(state);
        const committed = await this.loadCommitted(state, before[KEYS.index]);
        if (!committed || this.generationFailure) {
          throw error(this.generationFailure || "CONFIGURATION_UNAVAILABLE");
        }
        const observed = {
          sync: await this.storage.sync.get(syncKeys),
          local: await this.storage.local.get(localKeys),
        };
        const oldConflict = state.phase === "ABORTED" &&
          ["CONFIGURATION_EXTERNAL_CONFLICT", "CONFIGURATION_RECOVERY_CONFLICT"].includes(
            state.code,
          );
        if (!oldConflict && !conflictKeys.length) {
          const source = await this.source();
          if (equal(this.snapshot(source, committed.revision), committed)) {
            throw error("CONFIGURATION_CONFLICT_UNAVAILABLE");
          }
        }
        const after = await this.storage.local.get(stateKeys);
        const again = {
          sync: await this.storage.sync.get(syncKeys),
          local: await this.storage.local.get(localKeys),
        };
        if (
          !equal(before, after) || !equal(observed, again) ||
          !equal(conflictKeys, await this.compatibilityConflictKeys())
        ) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        // 两次观察只能发现已发生的部分变化，不能证明原子时点或设备来源。
        return {
          kind: "browser-toolbox-compatibility-conflict-observation",
          formatVersion: 1,
          conflictCode: oldConflict ? state.code : "CONFIGURATION_EXTERNAL_CONFLICT",
          committed: this.view(committed),
          observed,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
          pointInTimeVerified: false,
          includesUnknownTopLevelSyncKeys: false,
          includesSeparateLocalCursorAssets: false,
          restorableAsSettings: false,
        };
      });
    }

    rollback() {
      return this.enqueue(async () => {
        const view = await this.readInternal();
        if (this.dirty && this.lastReadCode) {
          throw error(this.lastReadCode, { conflicts: ["keyboardGeneration"] });
        }
        const previous = await this.recover();
        if (previous.state?.code) {
          throw error(previous.state.code, { conflicts: previous.state.conflicts || [] });
        }
        const source = await this.source();
        const current = await this.loadCommitted(previous.state, previous.index);
        if (this.generationFailure) throw error(this.generationFailure);
        const result = await this.commitInternal(
          { legacyPatch: current.keyboard, toolbox: current.toolbox },
          source,
          previous,
        );
        if (!equal(result.keyboard, view.keyboard)) {
          throw error("CONFIGURATION_ROLLBACK_READBACK_FAILED");
        }
        return result;
      });
    }

    async readPreparationSnapshot() {
      if ((await this.compatibilityConflictKeys()).length) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      }
      const initial = await this.storage.local.get([KEYS.state, KEYS.index]);
      const state = initial[KEYS.state];
      const index = initial[KEYS.index];
      if (state) this.assertRecoveryState(state);
      if (
        !state || state.phase !== "COMMITTED" || state.code || !index ||
        !equal(index, state.committedIndex)
      ) throw error("CONFIGURATION_ROLLBACK_UNAVAILABLE");
      const current = await this.loadCommitted(state, index);
      if (!current || this.generationFailure) throw error("CONFIGURATION_ROLLBACK_UNAVAILABLE");
      const sourceDigest = await digest({
        keyboard: current.keyboard,
        toolbox: current.toolbox,
        area: current.area,
      });
      if (sourceDigest !== index.sourceDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      return { current, index, sourceDigest };
    }

    async assertPreparationCurrent(index) {
      const latest = await this.storage.local.get([KEYS.state, KEYS.index]);
      if (
        latest[KEYS.state]?.phase !== "COMMITTED" || latest[KEYS.state]?.code ||
        !equal(latest[KEYS.state]?.committedIndex, index) || !equal(latest[KEYS.index], index)
      ) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
    }

    syncPreparationLimits(itemLimit = this.storage.sync.QUOTA_BYTES_PER_ITEM || 8192) {
      return {
        item: itemLimit,
        total: this.storage.sync.QUOTA_BYTES || 102400,
        items: this.storage.sync.MAX_ITEMS || 512,
        minute: this.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE || 120,
        hour: this.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR || 1800,
      };
    }

    async assertPreparationInputs(index, syncBefore, budgetBefore) {
      await this.assertPreparationCurrent(index);
      const [syncAfter, budgetAfter] = await Promise.all([
        this.storage.sync.get(null),
        this.storage.local.get(KEYS.frequency),
      ]);
      if (!equal(syncBefore, syncAfter) || !equal(budgetBefore, budgetAfter)) {
        throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
      }
    }

    // M3 尚未启用；这里只读已提交代次并核验完整性，不备份、写回或切换引擎。
    prepareLegacyRollback() {
      return this.enqueue(async () => {
        const { current, index, sourceDigest } = await this.readPreparationSnapshot();
        const projection = planLegacyKeyboardProjection(current.keyboard, this.defaults());
        assertLegacyProjectionCompatible(current.keyboard);
        const [syncBefore, budgetBefore] = await Promise.all([
          this.storage.sync.get(null),
          this.storage.local.get(KEYS.frequency),
        ]);
        const capacity = estimateSyncCapacity(
          syncBefore,
          [{ put: projection.target, remove: projection.remove }],
          budgetBefore[KEYS.frequency] || [],
          this.syncPreparationLimits(),
        );
        const names = new Set([...Object.keys(projection.target), ...projection.remove]);
        const legacySourceDigest = await digest(Object.fromEntries(
          [...names].map((name) => [name, cell(syncBefore, name)]),
        ));
        await this.assertPreparationInputs(index, syncBefore, budgetBefore);
        return {
          revision: current.revision,
          sourceDigest,
          legacySourceDigest,
          capacity,
          ...projection,
        };
      });
    }

    // 只构造最新快照的独立备份并核算本机容量；没有保留空间，也没有执行回退。
    prepareLegacyRollbackBackup() {
      return this.enqueue(async () => {
        const { key, backup, capacity } = await this.prepareLegacyRollbackBackupInternal();
        return { key, backup, capacity };
      });
    }

    async prepareLegacyRollbackBackupInternal() {
      const { current, index, sourceDigest } = await this.readPreparationSnapshot();
      const [localBefore, syncBefore] = await Promise.all([
        this.storage.local.get(null),
        this.storage.sync.get(null),
      ]);
      const key = `${ROLLBACK_BACKUP_PREFIX}${crypto.randomUUID()}`;
      if (Object.hasOwn(localBefore, key)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      const body = {
        formatVersion: FORMAT_VERSION,
        kind: "rollback",
        createdAt: new Date().toISOString(),
        sourceDigest,
        snapshot: clone(current),
      };
      const backup = { ...body, backupDigest: await digest(body) };
      await this.inspectLegacyRollbackBackup(backup);
      const backupBytes = itemBytes(key, backup);
      const ownedBytes = Object.entries(localBefore).filter(([name]) =>
        name.startsWith(CHUNK_PREFIX) || name.startsWith(ROLLBACK_BACKUP_PREFIX) ||
        name.startsWith(IMPORT_BACKUP_PREFIX) ||
        name.startsWith(TRANSITION_RECORD_PREFIX) ||
        name === ROLLBACK_JOURNAL_KEY || name === SYNC_PUBLISH_JOURNAL_KEY ||
        Object.values(KEYS).includes(name) && name !== KEYS.toolbox
      ).reduce((sum, [name, value]) => sum + itemBytes(name, value), backupBytes);
      if (ownedBytes > MAX_BACKUP_BYTES) throw error("CONFIGURATION_BACKUP_QUOTA");
      const usedBytes = typeof this.storage.local.getBytesInUse === "function"
        ? await this.storage.local.getBytesInUse(null)
        : Object.entries(localBefore).reduce(
          (sum, [name, value]) => sum + itemBytes(name, value),
          0,
        );
      const requiredBytes = usedBytes + backupBytes;
      const limitBytes = this.storage.local.QUOTA_BYTES || 10 * 1024 * 1024;
      if (requiredBytes > limitBytes) {
        throw error("CONFIGURATION_LOCAL_QUOTA", { requiredBytes, limitBytes });
      }
      const budgetBefore = { [KEYS.frequency]: localBefore[KEYS.frequency] };
      await this.assertPreparationInputs(index, syncBefore, budgetBefore);
      const localAfter = await this.storage.local.get(null);
      if (!equal(localBefore, localAfter)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      return {
        key,
        backup,
        capacity: { backupBytes, ownedBytes, requiredBytes, limitBytes },
        index,
        syncBefore,
        budgetBefore,
      };
    }

    // 只保存并校验本机备份，不写旧字段、同步代次、迁移状态或引擎开关。
    createLegacyRollbackBackup() {
      return this.enqueue(async () => {
        const { key, backup, index, syncBefore, budgetBefore } = await this
          .prepareLegacyRollbackBackupInternal();
        await this.assertPreparationInputs(index, syncBefore, budgetBefore);
        if (Object.hasOwn(await this.storage.local.get(key), key)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        await this.storage.local.set({ [key]: backup });
        const stored = (await this.storage.local.get(key))[key];
        if (!equal(stored, backup)) throw error("CONFIGURATION_READBACK_FAILED");
        await this.inspectLegacyRollbackBackup(stored);
        await this.assertPreparationInputs(index, syncBefore, budgetBefore);
        return {
          key,
          revision: backup.snapshot.revision,
          sourceDigest: backup.sourceDigest,
          backupDigest: backup.backupDigest,
        };
      });
    }

    // 只验证备份内容和元数据，不读取或更改存储，也不表示来源经过认证。
    async inspectLegacyRollbackBackup(input) {
      let backup;
      try {
        backup = clone(input);
      } catch (_) {
        throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
      }
      if (
        !record(backup) ||
        !equal(
          Object.keys(backup).sort(),
          [
            "backupDigest",
            "createdAt",
            "formatVersion",
            "kind",
            "snapshot",
            "sourceDigest",
          ].sort(),
        ) || backup.formatVersion !== FORMAT_VERSION || backup.kind !== "rollback" ||
        typeof backup.createdAt !== "string" || !Number.isFinite(Date.parse(backup.createdAt)) ||
        !/^[a-f0-9]{64}$/.test(backup.sourceDigest) ||
        !/^[a-f0-9]{64}$/.test(backup.backupDigest)
      ) throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
      const { backupDigest, ...body } = backup;
      if (await digest(body) !== backupDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      const snapshot = backup.snapshot;
      if (
        !record(snapshot) ||
        !equal(Object.keys(snapshot).sort(), ["area", "keyboard", "revision", "toolbox"]) ||
        !["sync", "local"].includes(snapshot.area) ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
        !record(snapshot.toolbox)
      ) throw error("INVALID_CONFIGURATION");
      this.validateCompleteKeyboard(snapshot.keyboard);
      const toolbox = this.validateToolbox(clone(snapshot.toolbox));
      if (!equal(toolbox, snapshot.toolbox)) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      const expectedArea = toolbox.general?.browserSyncEnabled === false ? "local" : "sync";
      if (snapshot.area !== expectedArea) throw error("INVALID_CONFIGURATION");
      if (
        await digest({
          keyboard: snapshot.keyboard,
          toolbox: snapshot.toolbox,
          area: snapshot.area,
        }) !==
          backup.sourceDigest
      ) throw error("CONFIGURATION_DIGEST_MISMATCH");
      return { revision: snapshot.revision, sourceDigest: backup.sourceDigest, snapshot };
    }

    // 仅检查本机导入前备份，不把摘要或本机版本视为跨设备来源证明。
    async inspectImportBackup(input) {
      let backup;
      try {
        backup = clone(input);
      } catch (_) {
        throw error("INVALID_CONFIGURATION_RECOVERY");
      }
      if (
        !record(backup) || !equal(Object.keys(backup).sort(), [
          "backupDigest",
          "createdAt",
          "cursorAsset",
          "formatVersion",
          "kind",
          "snapshot",
          "sourceDigest",
        ]) || backup.formatVersion !== FORMAT_VERSION || backup.kind !== "before-import" ||
        typeof backup.createdAt !== "string" || !Number.isFinite(Date.parse(backup.createdAt)) ||
        !/^[a-f0-9]{64}$/.test(backup.sourceDigest) ||
        !/^[a-f0-9]{64}$/.test(backup.backupDigest)
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      const { backupDigest, ...body } = backup;
      if (await digest(body) !== backupDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      const snapshot = backup.snapshot;
      if (
        !record(snapshot) ||
        !equal(Object.keys(snapshot).sort(), ["area", "keyboard", "revision", "toolbox"]) ||
        !["sync", "local"].includes(snapshot.area) ||
        !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
        !record(snapshot.toolbox)
      ) throw error("INVALID_CONFIGURATION_RECOVERY");
      this.validateCompleteKeyboard(snapshot.keyboard);
      const toolbox = this.validateToolbox(clone(snapshot.toolbox));
      if (!equal(toolbox, snapshot.toolbox)) throw error("UNSUPPORTED_CONFIGURATION_FIELDS");
      const expectedArea = toolbox.general?.browserSyncEnabled === false ? "local" : "sync";
      if (snapshot.area !== expectedArea) throw error("INVALID_CONFIGURATION_RECOVERY");
      const id = snapshot.toolbox.cursor?.localAssetId;
      if (id) {
        const asset = backup.cursorAsset;
        if (
          !record(asset) || asset.id !== id || typeof asset.present !== "boolean" ||
          !equal(
            Object.keys(asset).sort(),
            asset.present ? ["id", "present", "value"] : [
              "id",
              "present",
            ],
          ) ||
          asset.present && (typeof asset.value !== "string" ||
              !asset.value.startsWith("data:image/png;base64,") ||
              asset.value.length > Math.ceil(256 * 1024 * 4 / 3) + 64)
        ) throw error("INVALID_CONFIGURATION_RECOVERY");
      } else if (backup.cursorAsset !== null) throw error("INVALID_CONFIGURATION_RECOVERY");
      if (
        await digest({
          keyboard: snapshot.keyboard,
          toolbox: snapshot.toolbox,
          area: snapshot.area,
        }) !== backup.sourceDigest
      ) throw error("CONFIGURATION_DIGEST_MISMATCH");
      return backup;
    }

    readImportBackup(key) {
      if (typeof key !== "string" || !importBackupKeyPattern.test(key)) {
        return Promise.reject(error("INVALID_CONFIGURATION_RECOVERY"));
      }
      return this.enqueue(async () =>
        this.inspectImportBackup((await this.storage.local.get(key))[key])
      );
    }

    listImportBackups() {
      return this.enqueue(async () => {
        const values = await this.storage.local.get(null);
        const result = [];
        for (const key of Object.keys(values).filter((name) => importBackupKeyPattern.test(name))) {
          let backup;
          try {
            backup = await this.inspectImportBackup(values[key]);
          } catch (_) {
            result.push({ key, status: "invalid" });
            continue;
          }
          if (!equal((await this.storage.local.get(key))[key], backup)) {
            throw error("CONFIGURATION_EXTERNAL_CONFLICT");
          }
          result.push({
            key,
            status: "valid",
            createdAt: backup.createdAt,
            revision: backup.snapshot.revision,
            cursorAssetPresent: backup.cursorAsset?.present === true,
            cursorAssetMissing: backup.cursorAsset?.present === false,
            cursorAssetInvalid: backup.cursorAsset?.present === true &&
              (typeof globalThis.BrowserToolboxCursorAsset?.isSafeAsset !== "function" ||
                !globalThis.BrowserToolboxCursorAsset.isSafeAsset(backup.cursorAsset.value)),
          });
        }
        return result.sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || "") || a.key.localeCompare(b.key)
        );
      });
    }

    exportImportBackup(key) {
      if (typeof key !== "string" || !importBackupKeyPattern.test(key)) {
        return Promise.reject(error("INVALID_CONFIGURATION_RECOVERY"));
      }
      return this.enqueue(async () => {
        const backup = await this.inspectImportBackup((await this.storage.local.get(key))[key]);
        if (!equal((await this.storage.local.get(key))[key], backup)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        let legacyLimitations = [];
        try {
          assertLegacyProjectionCompatible(backup.snapshot.keyboard);
        } catch (failure) {
          if (failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
          legacyLimitations = clone(failure.conflicts);
        }
        return {
          snapshot: this.view(backup.snapshot),
          cursorAssetPresent: backup.cursorAsset?.present === true,
          legacyLimitations: legacyLimitations.slice(0, 20),
          legacyLimitationsTruncated: legacyLimitations.length > 20,
        };
      });
    }

    exportImportBackupCursor(key) {
      if (typeof key !== "string" || !importBackupKeyPattern.test(key)) {
        return Promise.reject(error("INVALID_CONFIGURATION_RECOVERY"));
      }
      return this.enqueue(async () => {
        const backup = await this.inspectImportBackup((await this.storage.local.get(key))[key]);
        if (!backup.cursorAsset?.present) throw error("CONFIGURATION_CURSOR_ASSET_MISSING");
        if (!equal((await this.storage.local.get(key))[key], backup)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        const validator = globalThis.BrowserToolboxCursorAsset?.isSafeAsset;
        return {
          dataUrl: backup.cursorAsset.value,
          pngHeaderValid: typeof validator === "function" && validator(backup.cursorAsset.value),
        };
      });
    }

    validLocalCursorKey(key) {
      const validator = globalThis.BrowserToolboxSettingsValidator;
      return typeof key === "string" && Boolean(
        validator?.CURSOR_ASSET_PATTERN?.test(key) ||
          validator?.LEGACY_CURSOR_ASSET_PATTERN?.test(key),
      );
    }

    listLocalCursorAssets(after = null) {
      return this.enqueue(async () => {
        if (after !== null && !this.validLocalCursorKey(after)) {
          throw error("INVALID_CONFIGURATION");
        }
        const area = this.storage.local;
        const names = typeof area.getKeys === "function"
          ? await area.getKeys()
          : Object.keys(await area.get(null));
        const keys = names.filter((key) =>
          this.validLocalCursorKey(key) &&
          (after === null || key > after)
        ).sort();
        const page = keys.slice(0, 100);
        return {
          keys: page,
          next: keys.length > page.length ? page[page.length - 1] : null,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
        };
      });
    }

    readLocalCursorAsset(key) {
      return this.enqueue(async () => {
        if (!this.validLocalCursorKey(key)) throw error("INVALID_CONFIGURATION");
        const source = await this.storage.local.get(key);
        if (!Object.hasOwn(source, key)) throw error("CONFIGURATION_CURSOR_ASSET_MISSING");
        const value = source[key];
        const maxBytes = globalThis.BrowserToolboxCursorAsset?.MAX_BYTES;
        const prefix = "data:image/png;base64,";
        if (
          !Number.isSafeInteger(maxBytes) || typeof value !== "string" ||
          !value.startsWith(prefix) ||
          value.length > prefix.length + Math.ceil(maxBytes * 4 / 3) + 32
        ) throw error("INVALID_CURSOR_ASSET");
        if (!equal(source, await this.storage.local.get(key))) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        return {
          dataUrl: value,
          pngHeaderValid: globalThis.BrowserToolboxCursorAsset.isSafeAsset(value),
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
        };
      });
    }

    // 只比较白名单字段和资源状态；不能把本机快照或摘要当作跨设备血缘证明。
    previewImportBackupRestore(key) {
      if (typeof key !== "string" || !importBackupKeyPattern.test(key)) {
        return Promise.reject(error("INVALID_CONFIGURATION_RECOVERY"));
      }
      return this.enqueue(async () => {
        const backup = await this.inspectImportBackup((await this.storage.local.get(key))[key]);
        const assertNoTransition = async () => {
          const records = await this.storage.local.get([
            ROLLBACK_JOURNAL_KEY,
            SYNC_PUBLISH_JOURNAL_KEY,
          ]);
          if (
            Object.hasOwn(records, ROLLBACK_JOURNAL_KEY) ||
            Object.hasOwn(records, SYNC_PUBLISH_JOURNAL_KEY)
          ) throw error("CONFIGURATION_TRANSITION_PENDING");
        };
        await assertNoTransition();
        const { current, index } = await this.readPreparationSnapshot();
        const source = await this.source();
        if (!equal(this.snapshot(source, current.revision), current)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        const currentId = current.toolbox.cursor?.localAssetId;
        const readCurrentCursor = async () =>
          currentId
            ? { id: currentId, ...cell(await this.storage.local.get(currentId), currentId) }
            : null;
        const currentCursor = await readCurrentCursor();
        const targetCursor = backup.cursorAsset;
        const validator = globalThis.BrowserToolboxCursorAsset?.isSafeAsset;
        const cursorStatus = !targetCursor
          ? "none"
          : !targetCursor.present
          ? "missing"
          : typeof validator !== "function"
          ? "unchecked"
          : validator(targetCursor.value)
          ? "header-valid"
          : "invalid";
        let limitations = [];
        try {
          assertLegacyProjectionCompatible(backup.snapshot.keyboard);
        } catch (failure) {
          if (failure?.code !== "UNSUPPORTED_CONFIGURATION_FIELDS") throw failure;
          limitations = clone(failure.conflicts);
        }
        const result = {
          keyboardFields: this.keyboardKeys.filter((name) =>
            !equal(current.keyboard[name], backup.snapshot.keyboard[name])
          ).sort(),
          toolboxChanged: !equal(current.toolbox, backup.snapshot.toolbox),
          cursorChanged: !equal(current.toolbox.cursor, backup.snapshot.toolbox.cursor) ||
            !equal(currentCursor, targetCursor),
          cursorStatus,
          legacyLimitations: limitations.slice(0, 20),
          legacyLimitationsTruncated: limitations.length > 20,
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
        };
        if (!equal((await this.storage.local.get(key))[key], backup)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        await this.assertPreparationCurrent(index);
        await assertNoTransition();
        const latestSource = await this.source();
        if (
          !equal(latestSource.raw, source.raw) || !equal(await readCurrentCursor(), currentCursor)
        ) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT");
        }
        return result;
      });
    }

    // 只生成待审阅的同步代次和容量计划；实际写入、备份与权威切换均未启用。
    prepareKeyboardSyncMigration() {
      return this.enqueue(async () => {
        const { current, index, sourceDigest } = await this.readPreparationSnapshot();
        const [syncBefore, budgetBefore] = await Promise.all([
          this.storage.sync.get(null),
          this.storage.local.get(KEYS.frequency),
        ]);
        if (Object.hasOwn(syncBefore, KEYS.index)) {
          throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
        }
        const generation = await createGeneration(
          current.keyboard,
          crypto.randomUUID(),
          current.revision,
        );
        generation.index.kind = "keyboard-sync";
        generation.index.sourceDigest = await digest(current.keyboard);
        const entries = { ...generation.chunks, [KEYS.index]: generation.index };
        for (const key of Object.keys(entries)) {
          if (Object.hasOwn(syncBefore, key)) {
            throw error("CONFIGURATION_EXTERNAL_CONFLICT", { conflicts: ["keyboardGeneration"] });
          }
        }
        const capacity = estimateSyncCapacity(
          syncBefore,
          [{ put: generation.chunks }, { put: { [KEYS.index]: generation.index } }],
          budgetBefore[KEYS.frequency] || [],
          this.syncPreparationLimits(
            Math.min(MAX_CHUNK_BYTES, this.storage.sync.QUOTA_BYTES_PER_ITEM || 8192),
          ),
        );
        const stagedReader = {
          get: (names) =>
            Promise.resolve(
              Object.fromEntries(names.map((name) => [name, generation.chunks[name]])),
            ),
        };
        const verified = await readGeneration(generation.index, stagedReader);
        if (!equal(verified, current.keyboard)) throw error("CONFIGURATION_READBACK_FAILED");
        await this.assertPreparationInputs(index, syncBefore, budgetBefore);
        return {
          revision: current.revision,
          sourceDigest,
          index: generation.index,
          chunks: generation.chunks,
          capacity,
        };
      });
    }

    async readKeyboardSyncCandidate() {
      const before = await this.storage.sync.get(KEYS.index);
      const index = before[KEYS.index];
      if (
        !index || index.kind !== "keyboard-sync" || index.formatVersion !== FORMAT_VERSION ||
        itemBytes(KEYS.index, index) > MAX_CHUNK_BYTES ||
        !equal(Object.keys(index.fields || {}).sort(), [...this.keyboardKeys].sort())
      ) throw error("UNSUPPORTED_CONFIGURATION_FORMAT");
      const fields = await readGeneration(index, this.storage.sync);
      const keyboard = this.validateKeyboard(fields);
      if (await digest(keyboard) !== index.sourceDigest) {
        throw error("CONFIGURATION_DIGEST_MISMATCH");
      }
      const after = await this.storage.sync.get(KEYS.index);
      if (!equal(before, after)) throw error("CONFIGURATION_EXTERNAL_CONFLICT");
      return { revision: index.revision, sourceDigest: index.sourceDigest, keyboard };
    }

    // 远端代次仅作候选读取；不会发布到运行时，也不按本地 revision 推断跨设备先后。
    inspectKeyboardSyncGeneration() {
      return this.enqueue(() => this.readKeyboardSyncCandidate());
    }

    // 两端声明相同摘要只允许生成待审候选，不能证明设备来源或授权写入。
    prepareKeyboardSyncReconciliation(input = {}) {
      let captured;
      try {
        if (!record(input)) throw error("INVALID_CONFIGURATION");
        captured = clone(input);
      } catch (_) {
        return Promise.reject(error("INVALID_CONFIGURATION"));
      }
      return this.enqueue(async () => {
        const { baseline, localBaseDigest, incomingBaseDigest, choices } = captured;
        if (baseline !== undefined && baseline !== null) {
          this.validateCompleteKeyboard(baseline);
        }
        const { current, index } = await this.readPreparationSnapshot();
        const [syncBefore, budgetBefore] = await Promise.all([
          this.storage.sync.get(null),
          this.storage.local.get(KEYS.frequency),
        ]);
        const incoming = await this.readKeyboardSyncCandidate();
        const baselineDigest = baseline == null ? null : await digest(baseline);
        const result = {
          lineageVerified: false,
          localRevision: current.revision,
          incomingRevision: incoming.revision,
          baselineDigest,
          localDigest: await digest(current.keyboard),
          incomingDigest: incoming.sourceDigest,
          sides: { local: clone(current.keyboard), incoming: clone(incoming.keyboard) },
        };
        if (
          !baselineDigest || localBaseDigest !== baselineDigest ||
          incomingBaseDigest !== baselineDigest
        ) {
          if (choices !== undefined) throw error("CONFIGURATION_BASELINE_UNPROVEN");
          await this.assertPreparationInputs(index, syncBefore, budgetBefore);
          return { status: "unproven", ...result };
        }
        const candidate = {};
        const conflicts = [];
        for (const key of this.keyboardKeys) {
          const local = current.keyboard[key];
          const remote = incoming.keyboard[key];
          if (equal(local, baseline[key])) candidate[key] = clone(remote);
          else if (equal(remote, baseline[key]) || equal(local, remote)) {
            candidate[key] = clone(local);
          } else conflicts.push(`keyboard.${key}`);
        }
        conflicts.sort();
        if (choices !== undefined) {
          if (!record(choices) || !equal(Object.keys(choices).sort(), conflicts)) {
            throw error("INVALID_CONFIGURATION_CHOICE");
          }
          for (const path of conflicts) {
            if (!["local", "incoming"].includes(choices[path])) {
              throw error("INVALID_CONFIGURATION_CHOICE");
            }
            const key = path.slice("keyboard.".length);
            candidate[key] = clone(result.sides[choices[path]][key]);
          }
        }
        await this.assertPreparationInputs(index, syncBefore, budgetBefore);
        if (conflicts.length && choices === undefined) {
          return { status: "conflict", conflicts, ...result };
        }
        const verified = this.validateKeyboard(candidate);
        return {
          status: "candidate",
          conflicts,
          ...result,
          candidate: verified,
          candidateDigest: await digest(verified),
        };
      });
    }

    exportConfiguration() {
      return this.enqueue(async () => {
        const previous = await this.recover();
        const committed = await this.loadGuardedCommitted(previous);
        if (committed) return { source: "committed", snapshot: this.view(committed) };
        return this.exportBaseline();
      });
    }

    async exportBaseline() {
      const backup = (await this.storage.local.get(KEYS.backup))[KEYS.backup];
      const baseline = backup?.baseline;
      if (
        backup?.formatVersion !== FORMAT_VERSION || !baseline ||
        !equal(Object.keys(baseline.keyboard || {}).sort(), this.keyboardKeys.sort())
      ) {
        throw error("CONFIGURATION_UNAVAILABLE");
      }
      this.validateKeyboard(baseline.keyboard);
      this.validateToolbox(baseline.toolbox);
      const actualDigest = await digest({
        keyboard: baseline.keyboard,
        toolbox: baseline.toolbox,
        area: baseline.area,
      });
      if (actualDigest !== backup.sourceDigest) throw error("CONFIGURATION_DIGEST_MISMATCH");
      return { source: "baseline", snapshot: this.view(baseline) };
    }
  }

  // 后台启动失败时，维护页只读本机已提交代次；不执行恢复步骤，也不重新读取旧同步来源。
  async function exportStoredConfiguration({ local, defaults, validateToolbox }) {
    const reader = Object.assign(Object.create(ConfigurationWriter.prototype), {
      storage: { local: { get: (keys) => local.get(keys) } },
      defaults: () => defaults,
      validateToolbox,
    });
    const stored = await local.get([KEYS.state, KEYS.index]);
    const state = stored[KEYS.state];
    if (state) reader.assertRecoveryState(state);
    const pending = state && !["COMMITTED", "ABORTED"].includes(state.phase);
    const index = pending ? state.beforeIndex : state?.committedIndex || stored[KEYS.index];
    const evidence = pending
      ? { committedIndex: index, beforeSnapshot: state.beforeSnapshot }
      : state;
    const committed = await reader.loadCommitted(evidence, index);
    if (committed) return { source: "committed", snapshot: reader.view(committed) };
    return reader.exportBaseline();
  }

  globalThis.BrowserToolboxConfigurationStore = Object.freeze({
    FORMAT_VERSION,
    KEYS,
    CHUNK_PREFIX,
    ROLLBACK_BACKUP_PREFIX,
    IMPORT_BACKUP_PREFIX,
    TRANSITION_RECORD_PREFIX,
    M2_CONFLICT_CAPTURE_PREFIX,
    M2_CONFLICT_ARCHIVE_PREFIX,
    ROLLBACK_JOURNAL_KEY,
    SYNC_PUBLISH_JOURNAL_KEY,
    MAX_CHUNK_BYTES,
    MAX_BACKUP_BYTES,
    ConfigurationWriter,
    createGeneration,
    readGeneration,
    exportStoredConfiguration,
    planLegacyKeyboardProjection,
    assertLegacyProjectionCompatible,
    merge,
    digest,
    itemBytes,
  });
})();
