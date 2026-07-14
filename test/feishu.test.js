const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
    applyEnvFile,
    bitableCreateRecord,
    bitableListFields,
    bitableListTables,
    bitableSearchRecords,
    bitableUpdateRecord,
    downloadDriveMedia,
    downloadMessageResource,
    normalizeName,
    parseBitableAppTokenFromUrl,
    parseEnv,
    parseMessageContent,
    parseTextContent,
    readChatMessages,
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

test("parseMessageContent parses text, file, image, and preserves unknown raw content", () => {
    assert.deepEqual(parseMessageContent("text", JSON.stringify({ text: "hello" })), {
        msgType: "text",
        rawContent: "{\"text\":\"hello\"}",
        text: "hello",
        json: { text: "hello" },
    });

    const file = parseMessageContent("file", JSON.stringify({
        file_key: "file_key_xxx",
        file_name: "report.xlsx",
        file_size: 1234,
        file_type: "xlsx",
    }));
    assert.equal(file.fileKey, "file_key_xxx");
    assert.equal(file.fileName, "report.xlsx");
    assert.equal(file.fileSize, 1234);
    assert.equal(file.fileType, "xlsx");

    const image = parseMessageContent("image", JSON.stringify({ image_key: "img_xxx" }));
    assert.equal(image.imageKey, "img_xxx");

    const post = parseMessageContent("post", JSON.stringify({ title: "post title", content: [] }));
    assert.equal(post.rawContent, "{\"title\":\"post title\",\"content\":[]}");
    assert.deepEqual(post.json, { title: "post title", content: [] });

    const invalid = parseMessageContent("interactive", "{not-json");
    assert.equal(invalid.parseError, "invalid_json");
    assert.equal(invalid.rawContent, "{not-json");
});

test("readChatMessages keeps legacy fields and adds parsedContent", async () => {
    const calls = [];
    const requestJson = async (method, requestPath, token, payload) => {
        calls.push({ method, requestPath, token, payload });
        if (requestPath.includes("tenant_access_token")) {
            return { status: 200, json: { code: 0, tenant_access_token: "tenant_token_test" } };
        }
        return {
            status: 200,
            json: {
                code: 0,
                data: {
                    has_more: false,
                    page_token: "",
                    items: [{
                        message_id: "om_message",
                        msg_type: "file",
                        create_time: "1710000000000",
                        update_time: "1710000000000",
                        sender: { sender_type: "user", id: "ou_sender" },
                        body: {
                            content: JSON.stringify({
                                file_key: "file_key_xxx",
                                file_name: "report.xlsx",
                                file_size: 2048,
                                file_type: "xlsx",
                            }),
                        },
                    }],
                },
            },
        };
    };

    const data = await readChatMessages({
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: "secret_test",
        FEISHU_TARGET_CHAT_ID: "oc_test",
    }, { requestJson, limit: 1 });

    assert.equal(calls[1].token, "tenant_token_test");
    assert.equal(data.messages[0].messageId, "om_message");
    assert.equal(data.messages[0].msgType, "file");
    assert.equal(data.messages[0].parsedContent.fileName, "report.xlsx");
    assert.equal(data.messages[0].parsedContent.fileKey, "file_key_xxx");
    assert.equal(data.messages[0].bodyContent.includes("report.xlsx"), true);
});

test("parseBitableAppTokenFromUrl extracts Base app_token", () => {
    assert.equal(
        parseBitableAppTokenFromUrl("https://example.feishu.cn/base/QPnubkmjXaPpwCs4EHGcGPDBnih?table=tbl_xxx"),
        "QPnubkmjXaPpwCs4EHGcGPDBnih",
    );
    assert.throws(() => parseBitableAppTokenFromUrl("https://example.feishu.cn/wiki/abc"), /could not find app_token/);
});

test("download helpers save explicit paths with mocked binary requests", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-bridge-download-"));
    const savePath = path.join(tmpDir, "report.xlsx");
    const calls = [];
    const requestJson = async () => ({ status: 200, json: { code: 0, tenant_access_token: "tenant_token_test" } });
    const requestBinary = async (method, requestPath, token) => {
        calls.push({ method, requestPath, token });
        return {
            status: 200,
            headers: {
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "content-disposition": "attachment; filename*=UTF-8''report.xlsx",
            },
            buffer: Buffer.from("fake-xlsx"),
        };
    };

    try {
        const result = await downloadMessageResource({
            FEISHU_APP_ID: "cli_test",
            FEISHU_APP_SECRET: "secret_test",
        }, {
            messageId: "om_message",
            fileKey: "file_key_xxx",
            type: "file",
            savePath,
            requestJson,
            requestBinary,
        });

        assert.equal(result.saved, true);
        assert.equal(result.bytes, 9);
        assert.equal(result.fileNameFromHeader, "report.xlsx");
        assert.equal(fs.readFileSync(savePath, "utf8"), "fake-xlsx");
        assert.equal(calls[0].method, "GET");
        assert.equal(calls[0].requestPath, "/open-apis/im/v1/messages/om_message/resources/file_key_xxx?type=file");
        assert.equal(calls[0].token, "tenant_token_test");

        await assert.rejects(() => downloadDriveMedia({
            FEISHU_APP_ID: "cli_test",
            FEISHU_APP_SECRET: "secret_test",
        }, {
            fileToken: "file_token_xxx",
            savePath: tmpDir,
            requestJson,
            requestBinary,
        }), /save_path points to a directory/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("bitable helpers call expected Feishu endpoints with mocked JSON requests", async () => {
    const calls = [];
    const env = { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret_test" };
    const requestJson = async (method, requestPath, token, payload) => {
        calls.push({ method, requestPath, token, payload });
        if (requestPath.includes("tenant_access_token")) {
            return { status: 200, json: { code: 0, tenant_access_token: "tenant_token_test" } };
        }
        return {
            status: 200,
            json: {
                code: 0,
                data: {
                    items: [{ record_id: "rec_xxx", fields: { Name: "Alice" } }],
                    has_more: false,
                    page_token: "",
                    record: { record_id: "rec_xxx", fields: payload?.fields || {} },
                },
            },
        };
    };

    await bitableListTables(env, { appToken: "app_token_xxx", requestJson });
    await bitableListFields(env, { appToken: "app_token_xxx", tableId: "tbl_xxx", requestJson });
    const search = await bitableSearchRecords(env, {
        appToken: "app_token_xxx",
        tableId: "tbl_xxx",
        viewId: "vew_xxx",
        fieldNames: ["Name"],
        pageSize: 50,
        requestJson,
    });
    const created = await bitableCreateRecord(env, {
        appToken: "app_token_xxx",
        tableId: "tbl_xxx",
        fields: { Name: "Alice" },
        requestJson,
    });
    await bitableUpdateRecord(env, {
        appToken: "app_token_xxx",
        tableId: "tbl_xxx",
        recordId: "rec_xxx",
        fields: { Name: "Bob" },
        requestJson,
    });

    const apiCalls = calls.filter((call) => !call.requestPath.includes("tenant_access_token"));
    assert.equal(apiCalls[0].requestPath, "/open-apis/bitable/v1/apps/app_token_xxx/tables?page_size=100");
    assert.equal(apiCalls[1].requestPath, "/open-apis/bitable/v1/apps/app_token_xxx/tables/tbl_xxx/fields?page_size=100");
    assert.equal(apiCalls[2].method, "POST");
    assert.equal(apiCalls[2].requestPath, "/open-apis/bitable/v1/apps/app_token_xxx/tables/tbl_xxx/records/search?page_size=50");
    assert.deepEqual(apiCalls[2].payload, { view_id: "vew_xxx", field_names: ["Name"] });
    assert.equal(apiCalls[3].method, "POST");
    assert.deepEqual(apiCalls[3].payload, { fields: { Name: "Alice" } });
    assert.equal(apiCalls[4].method, "PUT");
    assert.deepEqual(apiCalls[4].payload, { fields: { Name: "Bob" } });
    assert.equal(search.items[0].record_id, "rec_xxx");
    assert.equal(created.record.record_id, "rec_xxx");
});
