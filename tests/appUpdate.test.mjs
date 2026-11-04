import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// 별도의 테스트 번들러 없이 실제 TypeScript 모듈을 실행합니다.
function loadModule(
  path,
  requireModule = () => {
    throw new Error("Unexpected import");
  },
) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: requireModule,
    process: { env: {} },
    AbortController,
    setTimeout,
    clearTimeout,
    URL,
  });
  return exports;
}
const {
  fetchNewVersion,
  keepPasswordForUpdate,
  takePasswordAfterUpdate,
  updatePageUrl,
} = loadModule("../src/lib/appUpdate.ts");
function storage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
    entries,
  };
}

test("새 버전 확인은 브라우저 캐시와 배포 고정 쿠키를 사용하지 않는다", async () => {
  const version = await fetchNewVersion("old", async (url, options) => {
    assert.match(url, /^\/api\/version\?check=\d+$/);
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    return Response.json({ version: "new" });
  });
  assert.equal(version, "new");
  assert.equal(
    await fetchNewVersion("same", async () =>
      Response.json({ version: "same" }),
    ),
    null,
  );
});

test("오프라인·서버 오류·잘못된 버전 응답은 강제 갱신을 일으키지 않는다", async () => {
  const responses = [
    () => {
      throw new Error("offline");
    },
    () => new Response("error", { status: 500 }),
    () => Response.json({}),
    () => Response.json({ version: "https://example.com" }),
    () => Response.json({ version: "development" }),
  ];
  for (const response of responses)
    assert.equal(await fetchNewVersion("old", async () => response()), null);
});

test("비밀번호는 업데이트에 한 번만 사용하고 저장소에서 바로 지운다", () => {
  const tab = storage();
  keepPasswordForUpdate(tab, "test-only-password", "new", 1000);
  assert.equal(takePasswordAfterUpdate(tab, "new", 1100), "test-only-password");
  assert.equal(tab.entries.size, 0);
  assert.equal(takePasswordAfterUpdate(tab, "new", 1200), "");
});

test("만료되거나 다른 버전·다른 탭의 비밀번호는 복원하지 않는다", () => {
  for (const [version, now] of [
    ["new", 61_001],
    ["different", 1100],
  ]) {
    const tab = storage();
    keepPasswordForUpdate(tab, "test-only-password", "new", 1000);
    assert.equal(takePasswordAfterUpdate(tab, version, now), "");
    assert.equal(tab.entries.size, 0);
  }
  assert.equal(takePasswordAfterUpdate(storage(), "new", 1100), "");
});

test("브라우저가 임시 저장을 차단해도 예외가 전파되지 않는다", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() =>
    keepPasswordForUpdate(blocked, "test-only-password", "new"),
  );
  assert.equal(takePasswordAfterUpdate(blocked, "new"), "");
});

test("갱신 URL은 현재 사이트와 기존 파라미터를 유지한다", () => {
  const url = new URL(
    updatePageUrl("https://example.com/?work=1#orders", "new"),
  );
  assert.equal(url.origin, "https://example.com");
  assert.equal(url.searchParams.get("work"), "1");
  assert.equal(url.searchParams.get("_app_version"), "new");
  assert.equal(url.hash, "#orders");
  assert.throws(() => updatePageUrl(url.href, "../invalid"));
});

test("갱신 전 저장과 작업 초기화는 앞선 저장 완료를 기다린다", async () => {
  const events = [];
  const fake = {
    config() {},
    async setItem(_key, value) {
      await new Promise((resolve) =>
        setTimeout(resolve, value.order === 1 ? 15 : 0),
      );
      events.push(value.order);
      return value;
    },
    async removeItem() {
      events.push("clear");
    },
    async getItem() {
      return null;
    },
  };
  const { saveState, clearState } = loadModule(
    "../src/lib/storage/storage.ts",
    () => fake,
  );
  await Promise.all([
    saveState({ order: 1 }),
    saveState({ order: 2 }),
    clearState(),
  ]);
  assert.deepEqual(events, [1, 2, "clear"]);
});

function pageHandlers(names, context) {
  const source = readFileSync(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text)
    )
      functions.push(
        `const ${node.name.text} = ${node.initializer.getText(ast)};`,
      );
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const code =
    functions.join("\n") + `\nglobalThis.handlers = {${names.join(",")}};`;
  vm.createContext(context);
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    context,
  );
  return context.handlers;
}

test("새 버전을 감지하면 실제 업로드·출력 함수가 기존 데이터를 변경하지 않는다", async () => {
  const names = [
    "onUploadOriginals",
    "onUploadResult",
    "onBuildIntegration",
    "onDownloadZip",
  ];
  const failures = [];
  let mutations = 0;
  const context = {
    disabled: false,
    newVersion: null,
    checkForUpdate: async () => "new",
    canVisitStep: () => true,
    state: {},
    setErrors: (errors) => failures.push(...errors),
    setBusy() {},
    setState() {
      mutations++;
    },
    errorMessage: (error) => error.message,
  };
  const handlers = pageHandlers(names, context);
  for (const name of names) await handlers[name]([{}]);
  assert.equal(mutations, 0);
  assert.deepEqual(failures, []);
});

test("실제 업데이트 함수는 작업 저장 후 비밀번호 전달과 화면 이동을 실행한다", async () => {
  const events = [];
  const tab = storage();
  let finishSave;
  const saved = new Promise((resolve) => {
    finishSave = resolve;
  });
  const context = {
    disabled: false,
    newVersion: "new",
    state: { original: "work" },
    sessionPassword: { current: "test-only-password" },
    setBusy() {},
    setErrors() {
      assert.fail("unexpected error");
    },
    saveState: async (state) => {
      assert.equal(state.original, "work");
      await saved;
      events.push("saved");
    },
    keepPasswordForUpdate,
    takePasswordAfterUpdate,
    updatePageUrl,
    window: {
      sessionStorage: tab,
      location: {
        href: "https://example.com/",
        replace(url) {
          assert.equal(
            takePasswordAfterUpdate(tab, "new"),
            "test-only-password",
          );
          assert.match(url, /_app_version=new/);
          events.push("navigate");
        },
      },
    },
  };
  const request = pageHandlers(["onApplyUpdate"], context).onApplyUpdate();
  assert.deepEqual(events, []);
  finishSave();
  await request;
  assert.deepEqual(events, ["saved", "navigate"]);
  assert.equal(tab.entries.size, 0);
});

test("저장 실패 시 화면을 이동하지 않고 기존 작업을 유지한다", async () => {
  const tab = storage();
  let navigated = false;
  let notified = false;
  const context = {
    disabled: false,
    newVersion: "new",
    state: { original: "work" },
    sessionPassword: { current: "test-only-password" },
    setBusy() {},
    setErrors() {
      notified = true;
    },
    saveState: async () => {
      throw new Error("quota");
    },
    keepPasswordForUpdate,
    takePasswordAfterUpdate,
    updatePageUrl,
    window: {
      sessionStorage: tab,
      location: {
        href: "https://example.com/",
        replace() {
          navigated = true;
        },
      },
    },
  };
  await pageHandlers(["onApplyUpdate"], context).onApplyUpdate();
  assert.equal(navigated, false);
  assert.equal(notified, true);
  assert.equal(context.state.original, "work");
  assert.equal(tab.entries.size, 0);
});
