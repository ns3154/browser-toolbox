// SPDX-License-Identifier: GPL-3.0-or-later
import { assert, context, should } from "../../vendor/shoulda.js";
import {
  createCanaryCloseObserver,
  inspectCanaryProcess as inspect,
} from "../../../scripts/canary_browser_process.js";

const started = "Sun Oct 25 04:37:34 2026";
const expected = {
  pid: 123,
  launcherPath: "/test/Launcher",
  command: "/test/CFT --profile=/test/profile about:blank",
};
const result = (command, status = "S", start = started, pid = 123) => ({
  code: 0,
  stdout: ` ${pid} ${start} ${status} ${command}\n`,
  stderr: "",
});

context("Browser.close 后的有界退出复查", () => {
  const sampleReader = (snapshots) => {
    let reads = 0;
    return {
      read: async () => inspect(snapshots[reads++], expected, started).state,
      count: () => reads,
    };
  };
  const failed = async (action) => {
    let error;
    try {
      await action();
    } catch (value) {
      error = value;
    }
    assert.isTrue(Boolean(error));
    return error;
  };
  should("实际退出过渡 ?E 加短命令先被拒绝，复查同身份Z后才接受", async () => {
    const reader = sampleReader([result("(CFT)", "?E"), result("<defunct>", "Z")]);
    const waits = [];
    const observe = createCanaryCloseObserver(reader.read, async (ms) => waits.push(ms));
    assert.equal("exited", await observe());
    assert.equal([100], waits);
    assert.equal(2, reader.count());
  });
  should("首次异常后PID已消失才允许退出", async () => {
    const reader = sampleReader([result("(CFT)", "?E"), { code: 1, stdout: "", stderr: "" }]);
    assert.equal("exited", await createCanaryCloseObserver(reader.read, async () => {})());
  });
  should("复查仍是未知或预期活进程均保留失败，不继续放宽", async () => {
    for (const second of [result("/other/CFT", "S"), result(expected.command, "S")]) {
      const reader = sampleReader([result("(CFT)", "?E"), second]);
      await failed(createCanaryCloseObserver(reader.read, async () => {}));
      assert.equal(2, reader.count());
    }
  });
  should("启动身份变化或查询失败立即拒绝，不进入退出复查", async () => {
    for (
      const first of [result("<defunct>", "Z", "Sun Oct 25 04:37:35 2026"), {
        code: 2,
        stdout: "",
        stderr: "failed",
      }]
    ) {
      const reader = sampleReader([first]);
      const waits = [];
      await failed(createCanaryCloseObserver(reader.read, async (ms) => waits.push(ms)));
      assert.equal([], waits);
      assert.equal(1, reader.count());
    }
  });
  should("复查最多一次，重入不会再次延后失败", async () => {
    const reader = sampleReader([
      result("(CFT)", "?E"),
      result("/other/CFT", "S"),
      result("(CFT)", "?E"),
    ]);
    const waits = [];
    const observe = createCanaryCloseObserver(reader.read, async (ms) => waits.push(ms));
    await failed(observe);
    await failed(observe);
    assert.equal([100], waits);
    assert.equal(3, reader.count());
  });
});
const rejects = (action) => {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  assert.isTrue(failed);
};

context("CUA owned PID 生命周期核验", () => {
  should("首次严格核验浏览器并记录启动身份", () => {
    assert.equal(
      { state: "browser", verifiedStart: started },
      inspect(result(expected.command), expected),
    );
  });
  should("同 PID launcher 到浏览器必须保留启动身份", () => {
    const launcher = inspect(result(expected.launcherPath), expected);
    assert.equal("launcher", launcher.state);
    assert.equal(
      "browser",
      inspect(result(expected.command), expected, launcher.verifiedStart).state,
    );
  });
  should("已核验同一进程变成僵尸时无需完整 argv 或发送信号", () => {
    assert.equal("exited", inspect(result("<defunct>", "Z"), expected, started).state);
  });
  should("拒绝未核验僵尸和复用 PID 的僵尸", () => {
    rejects(() => inspect(result("<defunct>", "Z"), expected));
    rejects(() => inspect(result("<defunct>", "Z", "Sun Oct 25 04:37:35 2026"), expected, started));
  });
  should("拒绝活进程任何完整命令行变化", () => {
    for (
      const command of [
        expected.command + " --extra",
        expected.command.replace("/test/profile", "/other/profile"),
        expected.command.replace("/test/CFT", "/other/CFT"),
        "<defunct>",
      ]
    ) {
      rejects(() => inspect(result(command), expected, started));
    }
  });
  should("状态和命令行疑似来自退出竞态时仍拒绝，不直接认作退出", () => {
    rejects(() => inspect(result("<defunct>", "S"), expected, started));
    rejects(() => inspect(result("(CFT)", "R"), expected, started));
  });
  should("拒绝不同 PID 和启动时间", () => {
    rejects(() => inspect(result(expected.command, "S", started, 124), expected, started));
    rejects(() =>
      inspect(result(expected.command, "S", "Sun Oct 25 04:37:35 2026"), expected, started)
    );
  });
  should("只有 ps 无匹配的空输出可作为已退出", () => {
    assert.equal("exited", inspect({ code: 1, stdout: "", stderr: "" }, expected, started).state);
    for (
      const bad of [{ code: 2, stdout: "", stderr: "" }, { code: 1, stdout: "", stderr: "error" }, {
        code: 0,
        stdout: "",
        stderr: "",
      }, { code: 1, stdout: "unexpected", stderr: "" }]
    ) rejects(() => inspect(bad, expected, started));
  });
});

if (import.meta.main) {
  const { run } = await import("../../vendor/shoulda.js");
  if (!await run()) Deno.exitCode = 1;
}
