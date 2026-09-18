import "../test_helper.js";
import { run } from "../../../pages/tools/properties_yaml_tool.js";
import { parse } from "../../../vendor/yaml.js";

context("BrowserToolbox Properties 与 YAML 互转", () => {
  const yaml = (input, options = {}) => run(input, options).output;
  const properties = (input) => run(input, { direction: "yamlToProperties" }).output;
  function rejects(input, direction, key) {
    let caught;
    try {
      run(input, { direction });
    } catch (error) {
      caught = error;
    }
    assert.isTrue(Boolean(caught));
    if (key) assert.equal(key, caught.messageKey);
    return caught;
  }

  should("按设计图转换嵌套配置、数组和中文，并提供实际行数", () => {
    const source =
      "server.port=8080\nserver.servlet.context-path=/api\nspring.application.name=demo-app\nspring.profiles.active=dev\napp.title=浏览器工具箱\napp.features[0]=json\napp.features[1]=yaml\napp.timeout=30000";
    const expected =
      'server:\n  port: "8080"\n  servlet:\n    context-path: /api\nspring:\n  application:\n    name: demo-app\n  profiles:\n    active: dev\napp:\n  title: 浏览器工具箱\n  features:\n    - json\n    - yaml\n  timeout: "30000"\n';
    const result = run(source);
    assert.equal(expected, result.output);
    assert.equal({ count: 8, inputLines: 8, outputLines: 15 }, result.metadata);
    assert.equal(source + "\n", properties(expected));
  });

  should("不把 Properties 的布尔文本、前导零与大整数转换成 YAML 类型", () => {
    const result = parse(
      yaml("zero=00123\nyes=true\nno=null\nlarge=9007199254740993123456789\nempty="),
    );
    assert.equal({
      zero: "00123",
      yes: "true",
      no: "null",
      large: "9007199254740993123456789",
      empty: "",
    }, result);
    assert.equal(
      "large=9007199254740993123456789\nfloat=1.2300e+4\nflag=TRUE\n",
      properties("large: 9007199254740993123456789\nfloat: 1.2300e+4\nflag: TRUE"),
    );
  });

  should("遵循 Java Properties 的分隔符、注释、空白和未知转义规则", () => {
    const source =
      "\ufeff  # comment\\\n! another\na : one  \nb\t=\ttwo\nc   three\nspace\\ key=\\ leading\ncolon\\:key:ok\nunknown=\\z\nflag";
    assert.equal({
      a: "one  ",
      b: "two",
      c: "three",
      "space key": " leading",
      "colon:key": "ok",
      unknown: "z",
      flag: "",
    }, parse(yaml(source)));
  });

  should("处理奇偶反斜杠续行和续行中的注释字符", () => {
    const source = "a=one\\\r\n   two\\\n\t#three\nb=C:\\\\tmp\\\\\nc=end\\";
    assert.equal({ a: "onetwo#three", b: "C:\\tmp\\", c: "end" }, parse(yaml(source)));
    assert.equal({ a: "tail\\joined" }, parse(yaml("a=tail\\\\\\\n joined")));
  });

  should("正确解码 Unicode、代理对及控制字符，并拒绝损坏的转义", () => {
    assert.equal(
      { title: "你好😀\t\n\r\f\\" },
      parse(yaml("title=\\u4f60\\u597d\\ud83d\\ude00\\t\\n\\r\\f\\\\")),
    );
    for (const source of ["a=\\u12", "a=\\uXYZW", "\\u12=bad"]) {
      rejects(source, "propertiesToYaml", "toolConfigUnicodeError");
    }
  });

  should("转换 YAML 的流式集合、对象数组、多行字符串和引号", () => {
    const source =
      'users: [{name: "甲", enabled: true}, {name: "乙", enabled: false}]\nmessage: |\n  first\n  second\nquote: "a: b # c"\n';
    const result = properties(source);
    assert.equal(
      "users[0].name=甲\nusers[0].enabled=true\nusers[1].name=乙\nusers[1].enabled=false\nmessage=first\\nsecond\\n\nquote=a: b # c\n",
      result,
    );
    assert.equal("first\nsecond\n", parse(yaml(result)).message);
  });

  should("转义 Properties 的键分隔符和字符串开头空白", () => {
    const result = properties('"a b:c=d": "  hello"\n"#key": "\\tline\\nnext\\r\\f\\\\"\n');
    assert.equal("a\\ b\\:c\\=d=\\  hello\n\\#key=\\tline\\nnext\\r\\f\\\\\n", result);
    assert.equal({ "a b:c=d": "  hello", "#key": "\tline\nnext\r\f\\" }, parse(yaml(result)));
  });

  should("拒绝重复键和标量、对象、数组之间的冲突", () => {
    rejects("a=1\na=2", "propertiesToYaml", "toolConfigDuplicate");
    rejects("a: 1\na: 2", "yamlToProperties", "toolConfigDuplicate");
    for (const value of ["a=1\na.b=2", "a.b=2\na=1", "a[0]=x\na.b=y", "a.b=y\na[0]=x"]) {
      rejects(value, "propertiesToYaml", "toolConfigConflict");
    }
  });

  should("只接受连续数组并支持根数组与多维数组", () => {
    assert.equal({ a: ["x", "y"] }, parse(yaml("a[1]=y\na[0]=x")));
    assert.equal([["x"], ["y"]], parse(yaml("[0][0]=x\n[1][0]=y")));
    assert.equal("[0].name=a\n[1].name=b\n", properties("- name: a\n- name: b"));
    for (const value of ["a[1]=x", "a[0]=x\na[2]=y"]) {
      rejects(value, "propertiesToYaml", "toolConfigSparseArray");
    }
    for (
      const value of [
        "a..b=x",
        "a.=x",
        "a[01]=x",
        "a[-1]=x",
        "a[10001]=x",
        "a[0]b=x",
        "a.[0]=x",
        "=x",
      ]
    ) {
      rejects(value, "propertiesToYaml", "toolConfigInvalidPath");
    }
  });

  should("不静默丢弃 null、空集合、歧义键或多个文档", () => {
    for (const value of ["a: null", "a:", "a: [x, null]"]) {
      rejects(value, "yamlToProperties", "toolConfigNull");
    }
    for (const value of ["a: []", "a: {}", "{}", "[]"]) {
      rejects(value, "yamlToProperties", "toolConfigEmptyCollection");
    }
    for (const value of ['"a.b": x', '"a[0]": x', '"": x']) {
      rejects(value, "yamlToProperties", "toolConfigAmbiguousKey");
    }
    rejects("plain text", "yamlToProperties", "toolConfigRoot");
    rejects("a: x\n---\nb: y", "yamlToProperties", "toolConfigYamlSyntax");
    assert.equal("a=\n", properties('a: ""'));
  });

  should("拒绝别名、循环、合并及自定义标签并定位输入行", () => {
    for (const value of ["a: &a {x: 1}\nb: *a", "a: &a [*a]", "a: {<<: {x: 1}}"]) {
      rejects(value, "yamlToProperties", "toolConfigAlias");
    }
    for (
      const value of ["a: !custom text", "a: !!binary SGVsbG8=", "a: !!js/function 'function() {}'"]
    ) {
      rejects(value, "yamlToProperties", "toolConfigYamlSyntax");
    }
    assert.equal(2, rejects("good=ok\na=\\uZZZZ", "propertiesToYaml").line);
    assert.isTrue(rejects("good: ok\nbad: [", "yamlToProperties").line >= 2);
  });

  should("将原型特殊键和 HTML 当作普通数据", () => {
    const source =
      "__proto__.polluted=x\nconstructor.prototype.flag=y\nhtml=<img src=x onerror=alert(1)>";
    assert.equal(source + "\n", properties(yaml(source)));
    assert.isTrue(({}).polluted === undefined);
    assert.isTrue(({}).flag === undefined);
  });

  should("执行大小、节点、深度和选项边界", () => {
    rejects("x=" + "a".repeat(1024 * 1024), "propertiesToYaml", "toolConfigLimit");
    rejects("a.".repeat(64) + "b=x", "propertiesToYaml", "toolConfigLimit");
    rejects(
      Array.from({ length: 20001 }, (_, i) => `a${i}=x`).join("\n"),
      "propertiesToYaml",
      "toolConfigLimit",
    );
    rejects("a: " + "[".repeat(66) + "x" + "]".repeat(66), "yamlToProperties", "toolConfigLimit");
    rejects("a=x", "unknown", "toolInvalid");
    assert.throwsError(() => run("a=x", { indent: 3 }));
    assert.equal("a:\n    b: x\n", yaml("a.b=x", { indent: 4 }));
    assert.equal("", yaml(""));
    assert.equal("", yaml("# only a comment"));
  });

  should("将孤立代理项写成 Properties 转义而不改变正常表情", () => {
    assert.equal("a=\\ud800\nb=\\udfff\nc=😀\n", properties('a: "\\ud800"\nb: "\\udfff"\nc: 😀'));
    assert.equal("a=\\ud800\n", properties(yaml("a=\\ud800")));
  });
});
