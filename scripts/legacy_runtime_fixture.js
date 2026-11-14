// SPDX-License-Identifier: GPL-3.0-or-later
// 只读提取已冻结的 Git 提交，归档不含忽略目录或用户 profile，不修改当前 checkout。
import * as path from "@std/path";
import { readManifest } from "./release_artifacts.js";

export async function prepareLegacyRuntime(root, output) {
  const contracts = JSON.parse(
    await Deno.readTextFile(path.join(root, "tests/fixtures/runtime_compat_contracts.json")),
  );
  const destination = path.join(output, "frozen-runtime");
  const archive = path.join(output, "frozen-runtime.tar");
  await Deno.mkdir(destination, { recursive: true });
  for (
    const [command, args] of [
      ["git", ["archive", "--format=tar", `--output=${archive}`, contracts.baselineCommit]],
      ["tar", ["-xf", archive, "-C", destination]],
    ]
  ) {
    const result = await new Deno.Command(command, {
      args,
      cwd: root,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!result.success) throw new Error("冻结运行时准备失败");
  }
  await Deno.writeTextFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(await readManifest(destination), null, 2),
  );
  return destination;
}
