const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

/**
 * Skool DM Scraper
 * 
 * Connects to your already-open Chrome browser via remote debugging
 * and scrapes all DM conversations from your Skool account.
 * 
 * USAGE:
 *   1. Close Chrome completely
 *   2. Relaunch Chrome with remote debugging:
 *        Linux:   google-chrome --remote-debugging-port=9222
 *        Mac:     /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *        Windows: chrome.exe --remote-debugging-port=9222
 *   3. Log into Skool in that browser
 *   4. Run:  node dm_scraper.js
 */

const CONFIG = {
    cdpUrl: "http://localhost:9222",
    messagesUrl: "https://www.skool.com/messages",
    outputDir: "./output",
    outputFile: "dm_conversations.json",
    scrollPauseMs: 800,
    messageFetchPauseMs: 1000,
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function ensureOutputDir() {
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
}

function saveJSON(filename, data) {
    const fp = path.join(CONFIG.outputDir, filename);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    console.log(`💾 Saved ${fp}`);
}

async function connectBrowser() {
    console.log("🔌 Connecting to Chrome via CDP...");
    try {
        const browser = await chromium.connectOverCDP(CONFIG.cdpUrl);
        console.log("✅ Connected to browser");
        return browser;
    } catch (e) {
        console.error("❌ Failed to connect. Make sure Chrome is running with --remote-debugging-port=9222");
        console.error("   Error:", e.message);
        process.exit(1);
    }
}

/**
 * Scrolls the conversation list sidebar to load all conversations
 */
async function scrollConversationList(page) {
    console.log("📜 Scrolling conversation list to load all chats...");
    let previousCount = 0;
    let stableRounds = 0;

    for (let i = 0; i < 100; i++) {
        const currentCount = await page.evaluate(() => {
            // Find the scrollable conversation list container
            const sidebar = document.querySelector(
                '[class*="ChatList"], [class*="chatList"], [class*="ConversationList"], ' +
                '[class*="conversationList"], [class*="MessageList"], [class*="messageList"], ' +
                '[class*="inbox"], [class*="Inbox"], [class*="sidebar"], [class*="Sidebar"]'
            );

            // Also try: the left-side panel that contains conversation items
            const containers = document.querySelectorAll('div[class]');
            let listContainer = sidebar;

            if (!listContainer) {
                // Fallback: find container that has multiple conversation-like children
                for (const c of containers) {
                    const links = c.querySelectorAll('a[href*="/messages"]');
                    if (links.length > 2) {
                        listContainer = c;
                        break;
                    }
                }
            }

            if (listContainer) {
                listContainer.scrollTop = listContainer.scrollHeight;
            } else {
                // Last resort: scroll the whole page
                window.scrollTo(0, document.body.scrollHeight);
            }

            // Count conversation items
            const convItems = document.querySelectorAll(
                'a[href*="/messages/"], [class*="ChatItem"], [class*="chatItem"], ' +
                '[class*="ConversationItem"], [class*="conversationItem"], ' +
                '[class*="MessageItem"], [class*="messageItem"]'
            );
            return convItems.length;
        });

        if (currentCount === previousCount) {
            stableRounds++;
            if (stableRounds >= 5) {
                console.log(`   All conversations loaded (${currentCount} found)`);
                break;
            }
        } else {
            stableRounds = 0;
            console.log(`   Loaded ${currentCount} conversations so far...`);
        }
        previousCount = currentCount;
        await sleep(CONFIG.scrollPauseMs);
    }
}

/**
 * Collects all conversation links/entries from the sidebar
 */
async function collectConversationLinks(page) {
    return await page.evaluate(() => {
        const conversations = [];
        const seen = new Set();

        // Strategy 1: look for links to /messages/<id>
        const links = document.querySelectorAll('a[href*="/messages/"]');
        for (const link of links) {
            const href = link.href;
            if (seen.has(href)) continue;
            seen.add(href);

            // Try to extract the other person's name
            const nameEl = link.querySelector(
                '[class*="Name"], [class*="name"], [class*="Title"], [class*="title"], ' +
                'h3, h4, strong, b, span'
            );
            // Try to extract a preview/snippet
            const previewEl = link.querySelector(
                '[class*="Preview"], [class*="preview"], [class*="Snippet"], ' +
                '[class*="snippet"], [class*="Last"], [class*="last"], p, [class*="message"]'
            );
            // Try to extract timestamp
            const timeEl = link.querySelector(
                '[class*="Time"], [class*="time"], [class*="Date"], [class*="date"], time'
            );

            const nameText = nameEl ? nameEl.textContent.trim() : "";
            const previewText = previewEl ? previewEl.textContent.trim() : "";
            const fullText = link.textContent.trim();

            // The name is usually the first substantial text
            let name = nameText;
            if (!name && fullText) {
                // Take the first line as name
                name = fullText.split("\n")[0].trim();
            }

            conversations.push({
                url: href,
                name: name,
                preview: previewText,
                timestamp: timeEl ? timeEl.textContent.trim() : "",
            });
        }

        // Strategy 2: if no links found, look for clickable conversation items
        if (conversations.length === 0) {
            const items = document.querySelectorAll(
                '[class*="ChatItem"], [class*="chatItem"], ' +
                '[class*="ConversationItem"], [class*="conversationItem"], ' +
                '[role="listitem"], [role="option"]'
            );
            let idx = 0;
            for (const item of items) {
                const text = item.textContent.trim();
                if (text) {
                    conversations.push({
                        url: null,
                        elementIndex: idx,
                        name: text.split("\n")[0].trim(),
                        preview: text.split("\n").slice(1).join(" ").trim().substring(0, 200),
                        timestamp: "",
                    });
                }
                idx++;
            }
        }

        return conversations;
    });
}

/**
 * Scrolls up inside the open conversation to load all messages
 */
async function scrollToLoadAllMessages(page) {
    let previousCount = 0;
    let stableRounds = 0;

    for (let i = 0; i < 150; i++) {
        const currentCount = await page.evaluate(() => {
            // Find the message area container
            const messageAreas = document.querySelectorAll(
                '[class*="MessageArea"], [class*="messageArea"], [class*="ChatMessages"], ' +
                '[class*="chatMessages"], [class*="MessageBody"], [class*="messageBody"], ' +
                '[class*="conversation-messages"], [class*="ConversationMessages"]'
            );

            let messageContainer = messageAreas[0];

            if (!messageContainer) {
                // Fallback: look for a scrollable div that contains message-like elements
                const divs = document.querySelectorAll('div');
                for (const d of divs) {
                    if (d.scrollHeight > d.clientHeight) {
                        const msgs = d.querySelectorAll(
                            '[class*="Message"], [class*="message"], [class*="Bubble"], [class*="bubble"]'
                        );
                        if (msgs.length > 2) {
                            messageContainer = d;
                            break;
                        }
                    }
                }
            }

            if (messageContainer) {
                // Scroll to top to load older messages
                messageContainer.scrollTop = 0;
            }

            // Count message elements
            const messages = document.querySelectorAll(
                '[class*="MessageRow"], [class*="messageRow"], [class*="ChatMessage"], ' +
                '[class*="chatMessage"], [class*="MessageBubble"], [class*="messageBubble"], ' +
                '[class*="message-item"], [class*="MessageItem"]'
            );
            return messages.length;
        });

        if (currentCount === previousCount) {
            stableRounds++;
            if (stableRounds >= 5) break;
        } else {
            stableRounds = 0;
        }
        previousCount = currentCount;
        await sleep(400);
    }
}

/**
 * Extracts all messages from the currently open conversation
 */
async function extractMessages(page) {
    return await page.evaluate(() => {
        const messages = [];

        // Broad selector for individual message elements
        const msgElements = document.querySelectorAll(
            '[class*="MessageRow"], [class*="messageRow"], [class*="ChatMessage"], ' +
            '[class*="chatMessage"], [class*="MessageBubble"], [class*="messageBubble"], ' +
            '[class*="message-item"], [class*="MessageItem"], [class*="messageItem"]'
        );

        if (msgElements.length > 0) {
            for (const el of msgElements) {
                const senderEl = el.querySelector(
                    '[class*="Sender"], [class*="sender"], [class*="Author"], [class*="author"], ' +
                    '[class*="Name"], [class*="name"], strong, b'
                );
                const contentEl = el.querySelector(
                    '[class*="Content"], [class*="content"], [class*="Body"], [class*="body"], ' +
                    '[class*="Text"], [class*="text"], p'
                );
                const timeEl = el.querySelector(
                    '[class*="Time"], [class*="time"], [class*="Date"], [class*="date"], time, ' +
                    '[class*="Timestamp"], [class*="timestamp"]'
                );

                const sender = senderEl ? senderEl.textContent.trim() : "";
                let content = contentEl ? contentEl.textContent.trim() : el.textContent.trim();

                // Remove sender name from content if it starts with it
                if (sender && content.startsWith(sender)) {
                    content = content.substring(sender.length).trim();
                }

                if (content) {
                    messages.push({
                        sender: sender || "Unknown",
                        content: content,
                        timestamp: timeEl ? timeEl.textContent.trim() : "",
                    });
                }
            }
        }

        // Fallback: if no structured messages found, try to grab all text blocks
        if (messages.length === 0) {
            const allBlocks = document.querySelectorAll(
                '[class*="msg"], [class*="Msg"], [class*="chat"], [class*="Chat"]'
            );
            for (const block of allBlocks) {
                const text = block.textContent.trim();
                if (text && text.length > 0 && text.length < 5000) {
                    messages.push({
                        sender: "Unknown",
                        content: text,
                        timestamp: "",
                    });
                }
            }
        }

        return messages;
    });
}

/**
 * Opens a conversation by URL and extracts messages
 */
async function scrapeConversation(page, convInfo, index, total) {
    const label = convInfo.name || convInfo.url || `Conversation #${index + 1}`;
    console.log(`\n💬 [${index + 1}/${total}] Scraping: ${label}`);

    try {
        if (convInfo.url) {
            await page.goto(convInfo.url, { waitUntil: "domcontentloaded", timeout: 15000 });
        } else if (convInfo.elementIndex !== undefined) {
            // Click on the conversation item directly
            const items = await page.$$(
                '[class*="ChatItem"], [class*="chatItem"], ' +
                '[class*="ConversationItem"], [class*="conversationItem"], ' +
                '[role="listitem"], [role="option"]'
            );
            if (items[convInfo.elementIndex]) {
                await items[convInfo.elementIndex].click();
            }
        }

        await sleep(CONFIG.messageFetchPauseMs);

        // Scroll up to load older messages
        await scrollToLoadAllMessages(page);
        await sleep(500);

        const messages = await extractMessages(page);
        console.log(`   ✅ ${messages.length} messages extracted`);

        // Also try to extract participant names from the conversation header
        const participants = await page.evaluate(() => {
            const headerEl = document.querySelector(
                '[class*="ChatHeader"], [class*="chatHeader"], [class*="ConversationHeader"], ' +
                '[class*="conversationHeader"], [class*="Header"] [class*="Name"], ' +
                '[class*="header"] [class*="name"]'
            );
            return headerEl ? headerEl.textContent.trim() : "";
        });

        return {
            conversationWith: convInfo.name || participants || "Unknown",
            conversationUrl: convInfo.url || page.url(),
            participantHeader: participants,
            messageCount: messages.length,
            messages: messages,
            scrapedAt: new Date().toISOString(),
        };
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return {
            conversationWith: convInfo.name || "Unknown",
            conversationUrl: convInfo.url || "",
            error: e.message,
            messages: [],
            scrapedAt: new Date().toISOString(),
        };
    }
}

async function main() {
    const startTime = Date.now();
    ensureOutputDir();

    const browser = await connectBrowser();
    const contexts = browser.contexts();

    if (contexts.length === 0) {
        console.error("❌ No browser contexts found. Make sure you have a tab open.");
        process.exit(1);
    }

    const context = contexts[0];
    const pages = context.pages();

    // Use an existing page or create a new one
    let page;
    if (pages.length > 0) {
        page = pages[0];
        console.log(`📄 Using existing tab: ${page.url()}`);
    } else {
        page = await context.newPage();
    }

    // Navigate to the messages page
    console.log(`\n📨 Navigating to ${CONFIG.messagesUrl}...`);
    await page.goto(CONFIG.messagesUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000);

    // Check if we're logged in
    if (page.url().includes("/login")) {
        console.error("❌ Not logged in. Please log into Skool in your Chrome browser first.");
        await browser.close();
        process.exit(1);
    }

    console.log(`📍 Current URL: ${page.url()}`);

    // Scroll the conversation list to load all conversations
    await scrollConversationList(page);

    // Collect all conversation links
    const conversationLinks = await collectConversationLinks(page);
    console.log(`\n📋 Found ${conversationLinks.length} conversations`);

    if (conversationLinks.length === 0) {
        console.log("⚠️  No conversations found. The page might have a different structure.");
        console.log("   Saving a debug screenshot...");
        await page.screenshot({ path: path.join(CONFIG.outputDir, "dm_debug_screenshot.png"), fullPage: true });

        // Also dump the page HTML for debugging
        const html = await page.content();
        fs.writeFileSync(path.join(CONFIG.outputDir, "dm_debug_page.html"), html);
        console.log("   Saved debug screenshot and HTML to output/");
        await browser.close();
        process.exit(1);
    }

    // Scrape each conversation
    const allConversations = [];
    for (let i = 0; i < conversationLinks.length; i++) {
        const conversation = await scrapeConversation(page, conversationLinks[i], i, conversationLinks.length);
        allConversations.push(conversation);

        // Save progress incrementally every 10 conversations
        if ((i + 1) % 10 === 0) {
            saveJSON("dm_conversations_progress.json", allConversations);
        }

        // Brief pause between conversations to avoid rate limiting
        await sleep(500);
    }

    // Save final output
    saveJSON(CONFIG.outputFile, allConversations);

    const totalMessages = allConversations.reduce((sum, c) => sum + c.messages.length, 0);
    const elapsed = Date.now() - startTime;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);

    console.log("\n" + "=".repeat(50));
    console.log(`✅ Done! Scraped ${allConversations.length} conversations with ${totalMessages} total messages`);
    console.log(`⏱️  Took ${mins}m ${secs}s`);
    console.log(`💾 Output: ${path.join(CONFIG.outputDir, CONFIG.outputFile)}`);
    console.log("=".repeat(50));

    // Disconnect (don't close — it's the user's browser)
    browser.close();
}

main().catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
});