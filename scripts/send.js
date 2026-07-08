#!/usr/bin/env node
const {
    DEFAULT_ENV_FILE,
    getTenantToken,
    normalizeName,
    requestJson,
    resolveChatId,
    resolveEnv,
} = require("../lib/feishu");

function usage(exitCode = 0) {
    const out = exitCode === 0 ? process.stdout : process.stderr;
    out.write(`Usage:
  send.js --text "hello"
  send.js --at-open-id ou_xxx --at-label "name" --text "hello"
  send.js --at-name "name" --text "hello"

Options:
  --env PATH          Env file path. Defaults to ${DEFAULT_ENV_FILE}
  --chat-id CHAT_ID   Target chat_id. Defaults to FEISHU_TARGET_CHAT_ID.
  --text TEXT         Message text.
  --at-open-id ID     Mention this Feishu open_id.
  --at-label LABEL    Label displayed for --at-open-id. Defaults to the ID.
  --at-name NAME      Resolve and mention one group member by visible name/member_id.
  --help              Show this help.
`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) usage(1);
            return argv[++i];
        };
        if (arg === "--help" || arg === "-h") usage(0);
        else if (arg === "--env") args.envFile = next();
        else if (arg === "--chat-id") args.chatId = next();
        else if (arg === "--text") args.text = next();
        else if (arg === "--at-open-id") args.atOpenId = next();
        else if (arg === "--at-label") args.atLabel = next();
        else if (arg === "--at-name") args.atName = next();
        else {
            console.error(`Unknown option: ${arg}`);
            usage(1);
        }
    }
    return args;
}

async function resolveMemberByName(token, chatId, name) {
    let pageToken = "";
    const members = [];
    do {
        const requestPath = `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=100&member_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
        const resp = await requestJson("GET", requestPath, token);
        if (resp.json.code !== 0) {
            throw new Error(`chat members failed: ${resp.json.code} ${resp.json.msg}`);
        }
        members.push(...(resp.json.data?.items || []));
        pageToken = resp.json.data?.page_token || "";
    } while (pageToken);

    const target = normalizeName(name);
    const matches = members.filter((member) => {
        return [member.name, member.member_id].some((value) => normalizeName(value).includes(target));
    });

    if (matches.length !== 1) {
        const visible = matches.slice(0, 10).map((member) => ({
            name: member.name,
            openId: member.member_id,
            memberType: member.member_type,
        }));
        throw new Error(`expected one member match for "${name}", got ${matches.length}; matches=${JSON.stringify(visible)}`);
    }

    return matches[0];
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.text) {
        console.error("--text is required.");
        usage(1);
    }

    const { env } = resolveEnv(args.envFile);
    const chatId = resolveChatId(args.chatId, env);
    const token = await getTenantToken(env);
    let text = args.text;

    if (args.atName) {
        const member = await resolveMemberByName(token, chatId, args.atName);
        text = `<at user_id="${member.member_id}">${member.name || args.atName}</at> ${text}`;
    } else if (args.atOpenId) {
        text = `<at user_id="${args.atOpenId}">${args.atLabel || args.atOpenId}</at> ${text}`;
    }

    const sendResp = await requestJson("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", token, {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
    });

    if (sendResp.json.code !== 0) {
        throw new Error(`send failed: ${sendResp.json.code} ${sendResp.json.msg}`);
    }

    console.log(JSON.stringify({
        sent: true,
        chatId,
        messageId: sendResp.json.data?.message_id,
    }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({ sent: false, error: error.message }, null, 2));
    process.exit(1);
});
