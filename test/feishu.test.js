const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    applyEnvFile,
    normalizeName,
    parseEnv,
    parseTextContent,
    resolveChatId,
} = require("../lib/feishu");

test("parseEnv supports comments, export, and simple quoted values", () => {
    const env = parseEnv([
        "# comment",
        "FEISHU_APP_ID=cli_xxx",
        "export FEISHU_APP_SECRET=\"secret\"",
        "FEISHU_TARGET_CHAT_ID='oc_xxx'",
        "",
    ].join("\n"));

    assert.equal(env.FEISHU_APP_ID, "cli_xxx");
    assert.equal(env.FEISHU_APP_SECRET, "secret");
    assert.equal(env.FEISHU_TARGET_CHAT_ID, "oc_xxx");
});

test("applyEnvFile does not override existing process env by default", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-test-"));
    const envFile = path.join(tmpDir, ".env");
    const name = "FEISHU_BRIDGE_TEST_VALUE";
    const previous = process.env[name];

    try {
        fs.writeFileSync(envFile, `${name}=from_file\n`, "utf8");
        process.env[name] = "from_process";
        const result = applyEnvFile(envFile);

        assert.equal(result.loaded, true);
        assert.equal(process.env[name], "from_process");
    } finally {
        if (previous === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = previous;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("resolveChatId accepts an explicit chat id before env fallback", () => {
    assert.equal(resolveChatId("oc_explicit", { FEISHU_TARGET_CHAT_ID: "oc_env" }), "oc_explicit");
    assert.equal(resolveChatId("", { FEISHU_TARGET_CHAT_ID: "oc_env" }), "oc_env");
});

test("parseTextContent and normalizeName handle CLI display helpers", () => {
    assert.equal(parseTextContent(JSON.stringify({ text: "hello" })), "hello");
    assert.equal(normalizeName("Alice.Zhang_01"), "alicezhang01");
});
