import { EmailAttachnebtClient } from "./emial-attachment-client";

// 主入口
async function main() {
    const client = new EmailAttachnebtClient({
        host: 'imap.gmail.com',
        port: 993,
        servername: 'imap.gmail.com',
        auth: {
             user: import.meta.env.USER!,
            pass: import.meta.env.PASSWORD!
        }
    })
    await client.withRetry()
}

main().catch(err => {
    console.error('最终失败:', err);
    process.exit(1);
})