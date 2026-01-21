// index.ts （完整可运行版，基于你之前的代码）
import { ImapFlow } from 'imapflow';
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import { simpleParser } from 'mailparser';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const attachmentsDir = './attachments';
await fs.mkdir(attachmentsDir, { recursive: true }).catch(() => { });

async function createClient() {
    return new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        servername: 'imap.gmail.com',
        auth: {
            user: import.meta.env.USER!,
            pass: import.meta.env.PASSWORD!
        },
        connectionTimeout: 60000,
        greetingTimeout: 30000,
        socketTimeout: 120000,
        // emitLogs: true,          // 调试时打开，生产可关
        maxIdleTime: 300000,
        // reconnect: false         // 我们手动控制，不依赖内置 reconnect
    });
}

async function saveAttachments(parsed: Awaited<ReturnType<typeof simpleParser>>) {
    // if (!parsed.attachments?.length) {
    //     console.log('📎 没有附件');
    //     return;
    // }


    console.log(`📎 发现 ${parsed.attachments.length} 个附件`);

    const attachments = []
    const dateNow = `${parsed.from?.value[0]?.address}_${Date.now().toString()}`
    await fs.mkdir(`${attachmentsDir}/${dateNow}`, { recursive: true }).catch(() => { });
    for (let [index, att] of parsed.attachments.entries()) {
        const ext = path.extname(att.filename || 'unknown');
        const safeName = (att.filename || `attachment_${index + 1}`).replace(/[^\w\-.]/g, '_') + ext;
        attachments.push(safeName)
        const filePath = path.join(attachmentsDir, dateNow, safeName);

        try {
            await fs.writeFile(filePath, att.content);
            console.log(`✅ 保存: ${safeName} (${att.size} bytes) → ${filePath}`);
        } catch (err) {
            console.error(`❌ 保存失败 ${safeName}:`, err);
        }
    }
    const filePath = path.join(attachmentsDir, dateNow, 'content.json')
    const desc_object = {
        subject: parsed.subject,
        from: parsed.from?.value,
        date: parsed.date?.toISOString(),
        text: parsed.text,
        attachments
    }
    await fs.writeFile(filePath, JSON.stringify(desc_object));

}

async function checkLatestEmail() {
    const client = await createClient();  // 每次都全新实例

    try {
        console.log('🔗 正在连接...');
        await client.connect();
        console.log('✅ 连接成功');

        const lock = await client.getMailboxLock('INBOX');
        try {
            if (client.mailbox) {
                const exists = client.mailbox?.exists ?? 0;

                console.log(`📊 INBOX 邮件总数: ${exists}`);

                if (exists === 0) {
                    console.log('📭 收件箱为空');
                    return;
                }

                // 用 SEARCH 获取最新 1 个 UID（最可靠，避免无效 UID）
                const uids = await client.search({ all: true }, { uid: true }); // 或 { unseen: true } 只未读
                if (uids && uids.length === 0) {
                    console.log('没有匹配邮件');
                    return;
                }

                if (uids && uids.length !== 0) {
                    const latestUid = uids[uids?.length - 1]
                    console.log(`最新有效 UID: ${latestUid}`);

                    const fetch = await client.fetchOne(String(latestUid), {
                        envelope: true,

                        source: true
                    }, {
                        uid: true            // 第二个参数是 fetchOptions，也可以在这里强调 uid
                    });

                    if (fetch) {
                        console.log(`📧 主题: ${fetch.envelope?.subject || '(无主题)'}`);
                        console.log(`   发件人: ${fetch.envelope?.from?.[0]?.address || '未知'}`);

                        const parsed = await simpleParser(fetch.source!);
                        await saveAttachments(parsed);
                    }
                }
            }
        } finally {
            lock.release()  // 释放锁也加容错

            try {
                await client.logout();
                console.log('🔌 正常登出');
            } catch (logoutErr: any) {
                if (logoutErr.message.includes('Connection not available') || logoutErr.code === 'NoConnection') {
                    console.log('⚠️ logout 时连接已不可用（正常现象），直接关闭');
                } else {
                    console.warn('logout 失败:', logoutErr.message);
                }
                // 强制关闭底层 socket
                client.close()
            }
        }
    } catch (e) {
        throw new Error(`error occured :${e}`)
    }
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (err: any) {
            console.warn(`尝试 ${attempt}/${maxRetries} 失败: ${err.message}`);
            if (attempt === maxRetries) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error('重试耗尽');
}

// 主入口
async function main() {
    await withRetry(checkLatestEmail);
}

main().catch(err => {
    console.error('最终失败:', err);
    process.exit(1);
})