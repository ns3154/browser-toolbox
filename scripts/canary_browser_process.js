// SPDX-License-Identifier: GPL-3.0-or-later
// 活进程必须匹配完整命令行；僵尸只在同一启动身份曾核验成功后视为退出。
export function inspectCanaryProcess(result, expected, verifiedStart) {
  const fail = (message, code) => {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  };
  if (result.code === 1 && !result.stdout.trim() && !result.stderr.trim()) {
    return { state: "exited", verifiedStart };
  }
  if (result.code !== 0 || result.stderr.trim()) fail("CUA PID 状态查询失败");
  const match = result.stdout.trimEnd().match(/^\s*(\d+)\s+(.{24})\s+(\S+)\s+([^\n]+)$/);
  if (!match || Number(match[1]) !== expected.pid) fail("CUA PID 状态记录无效");
  const [, , startedAt, status, command] = match;
  if (verifiedStart !== undefined && startedAt !== verifiedStart) fail("CUA PID 启动身份已改变");
  if (status.startsWith("Z")) {
    if (verifiedStart === undefined) fail("CUA 未核验的僵尸 PID 不属于当前会话");
    return { state: "exited", verifiedStart };
  }
  const state = command === expected.launcherPath ? "launcher" : "browser";
  if (state === "browser" && command !== expected.command) {
    fail("CUA PID 对应程序或完整参数不符", "CUA_PROCESS_COMMAND_MISMATCH");
  }
  return { state, verifiedStart: startedAt };
}

// 仅供已经发送 Browser.close 的退出等待使用；复查期间不发送信号，也不释放 profile。
export function createCanaryCloseObserver(readState, wait) {
  let retried = false;
  return async () => {
    try {
      return await readState();
    } catch (error) {
      if (retried || error.code !== "CUA_PROCESS_COMMAND_MISMATCH") throw error;
      retried = true;
      await wait(100);
      try {
        if (await readState() === "exited") return "exited";
        error.message += "；退出复查仍为活进程";
      } catch (recheckError) {
        error.message += `；退出复查未确认：${recheckError.message}`;
      }
      throw error;
    }
  };
}
