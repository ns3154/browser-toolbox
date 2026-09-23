// 默认执行发布输入和静态审计；完整自动化验收使用 ./make.js verify。
import { buildArtifacts, checkReleaseInputs, commandOutput } from "./release_artifacts.js";

const manifest = await checkReleaseInputs();
for (const script of ["audit_permissions", "audit_network_usage", "audit_technical_rename"]) {
  console.log((await commandOutput(Deno.execPath(), ["run", "-A", `scripts/${script}.js`])).trim());
}
console.log(
  `静态发布检查通过：BrowserToolbox ${manifest.version}；此结果不代表完整测试或人工验收。`,
);

if (Deno.args.includes("--package")) {
  const report = await buildArtifacts();
  for (const artifact of report.artifacts) {
    console.log(
      `${artifact.kind}: dist/${artifact.file} (${artifact.size} 字节，SHA-256 ${artifact.sha256})`,
    );
  }
  console.log("可加载目录：dist/browser-toolbox；产物校验清单：dist/artifacts.json。");
}
