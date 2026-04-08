const { chromium } = require("playwright");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REPLIED_DMS_FILE = path.join(__dirname, "replied_dms.json");

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    headless: false,
    dryRun: true, // type DM but don't send (for testing)
    // Active period: bot responds to DMs
    activeMinMs: 10 * 60 * 1000,   // 10 minutes
    activeMaxMs: 60 * 60 * 1000,   // 1 hour
    // Inactive period: bot ignores DMs
    inactiveMinMs: 20 * 60 * 1000, // 20 minutes
    inactiveMaxMs: 90 * 60 * 1000, // 1.5 hours
    // Random delay before replying during active period
    replyDelayMinMs: 0,            // 0 seconds
    replyDelayMaxMs: 60 * 1000,    // 60 seconds
    // How often to poll for new messages during active period
    pollIntervalMs: 15 * 1000,     // 15 seconds between polls
};

function randomBetween(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatMs(ms) {
    var totalSec = Math.round(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return min > 0 ? min + "m " + sec + "s" : sec + "s";
}

async function countdown(ms, label) {
    var totalSec = Math.ceil(ms / 1000);
    for (var remaining = totalSec; remaining > 0; remaining--) {
        var min = Math.floor(remaining / 60);
        var sec = remaining % 60;
        var timeStr = min > 0 ? min + "m " + sec + "s" : sec + "s";
        process.stdout.write("\r" + label + " " + timeStr + " remaining   ");
        await sleep(1000);
    }
    process.stdout.write("\r" + label + " done!                    \n");
}

function loadRepliedDMs() {
    try {
        if (fs.existsSync(REPLIED_DMS_FILE)) {
            var data = JSON.parse(fs.readFileSync(REPLIED_DMS_FILE, "utf8"));
            console.log("Loaded " + data.length + " previously replied DM keys from disk");
            return new Set(data);
        }
    } catch (e) {
        console.warn("Could not load replied_dms.json, starting fresh:", e.message);
    }
    return new Set();
}

function saveRepliedDMs(repliedSet) {
    fs.writeFileSync(REPLIED_DMS_FILE, JSON.stringify(Array.from(repliedSet), null, 2));
}

// ─── LOGIN ───────────────────────────────────────────────

async function login(page) {
    console.log("Logging in...");
    await page.goto("https://www.skool.com/login", { waitUntil: "networkidle" });
    await sleep(800);
    await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
    await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"]');
    await sleep(3000);
    if (page.url().includes("login")) throw new Error("Login failed — check credentials");
    console.log("Logged in");

    await page.goto("https://www.skool.com", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    var avatarBtn = await page.$('[class*="UserAvatar"], [class*="avatar"], img[class*="Avatar"]');
    if (avatarBtn) {
        await avatarBtn.click();
        await sleep(800);
    }
    var botName = await page.evaluate(function() {
        var links = document.querySelectorAll('a[href*="/@"]');
        for (var i = 0; i < links.length; i++) {
            var text = links[i].textContent.trim();
            if (text.length > 1 && !text.match(/^\d+$/)) return text;
        }
        return "";
    });
    await page.keyboard.press('Escape');
    await sleep(300);

    console.log("Bot account name: " + (botName || "(unknown)") + "\n");
    return botName;
}

// ─── OPEN / CLOSE CHAT PANEL ─────────────────────────────

async function openChatPanel(page) {
    var chatBtn = await page.$(
        '[class*="ChatNotificationsIconButton"], ' +
        '[class*="ChatIconWrapper"], ' +
        '[class*="ChatIcon"]'
    );
    if (chatBtn) {
        await chatBtn.click();
        return true;
    }

    var navItems = await page.$$('nav button, header button, nav a, header a, [class*="Nav"] button');
    for (var i = 0; i < navItems.length; i++) {
        var cls = await navItems[i].getAttribute('class') || '';
        if (/chat|message/i.test(cls)) {
            await navItems[i].click();
            return true;
        }
    }
    return false;
}

async function closeChatPanel(page) {
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.press('Escape');
    await sleep(500);
}

// ─── GET CONVERSATION LIST ────────────────────────────────

async function getConversationList(page, botName) {
    return await page.evaluate(function(botDisplayName) {
        var result = { conversations: [] };

        var msgEls = document.querySelectorAll('[class*="MessageContent"]');
        if (msgEls.length === 0) return result;

        var probe = msgEls[0];
        var listContainer = null;
        var parent = probe.parentElement;
        while (parent) {
            if (parent.querySelectorAll('[class*="MessageContent"]').length > 1) {
                listContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
        if (!listContainer) return result;

        var rows = [];
        for (var c = 0; c < listContainer.children.length; c++) {
            var child = listContainer.children[c];
            if (child.querySelector('[class*="MessageContent"]') || child.matches('[class*="MessageContent"]')) {
                rows.push(child);
            }
        }

        if (rows.length < msgEls.length && rows.length > 0) {
            var expandedRows = [];
            for (var r = 0; r < rows.length; r++) {
                if (rows[r].querySelectorAll('[class*="MessageContent"]').length > 1) {
                    for (var sc = 0; sc < rows[r].children.length; sc++) {
                        if (rows[r].children[sc].querySelector('[class*="MessageContent"]') ||
                            rows[r].children[sc].matches('[class*="MessageContent"]')) {
                            expandedRows.push(rows[r].children[sc]);
                        }
                    }
                } else {
                    expandedRows.push(rows[r]);
                }
            }
            if (expandedRows.length > rows.length) rows = expandedRows;
        }

        for (var k = 0; k < rows.length; k++) {
            var row = rows[k];
            var conv = { name: null, lastMsg: null, isUnread: false, index: k };

            var avatars = row.querySelectorAll('img[alt], [title]:not([title=""])');
            for (var a = 0; a < avatars.length; a++) {
                var name = avatars[a].getAttribute('alt') || avatars[a].getAttribute('title') || '';
                name = name.trim();
                if (name && name !== botDisplayName && !/^\d+$/.test(name) && name.length > 1) {
                    conv.name = name;
                    break;
                }
            }

            if (!conv.name) {
                var nameLinks = row.querySelectorAll('a[href*="/@"]');
                for (var n = 0; n < nameLinks.length; n++) {
                    var linkText = nameLinks[n].textContent.trim();
                    if (linkText && !/^\d+$/.test(linkText) && linkText !== botDisplayName) {
                        conv.name = linkText;
                        break;
                    }
                }
            }

            if (!conv.name) {
                var msgContent = row.querySelector('[class*="MessageContent"]');
                var timeEl = row.querySelector('[class*="LastMessageTime"], [class*="Time"]');
                var msgText = msgContent ? msgContent.textContent.trim() : '';
                var timeText = timeEl ? timeEl.textContent.trim() : '';
                var fullText = row.textContent.trim();
                var remaining = fullText;
                if (msgText) remaining = remaining.replace(msgText, '');
                if (timeText) remaining = remaining.replace(timeText, '');
                remaining = remaining.replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').trim();
                if (remaining && remaining.length > 1 && remaining.length < 60) {
                    conv.name = remaining;
                }
            }

            var msgEl = row.querySelector('[class*="MessageContent"]');
            if (msgEl) conv.lastMsg = msgEl.textContent.trim().substring(0, 150);

            if (msgEl) {
                var msgStyle = window.getComputedStyle(msgEl);
                var msgFw = parseInt(msgStyle.fontWeight) || 0;
                if (msgFw >= 600 || /bold/i.test(msgStyle.fontWeight)) {
                    conv.isUnread = true;
                }
            }
            var dot = row.querySelector('[class*="Unread"], [class*="unread"], [class*="Badge"], [class*="Dot"], [class*="Indicator"]');
            if (dot) {
                conv.isUnread = true;
            }

            if (conv.name) result.conversations.push(conv);
        }

        return result;
    }, botName);
}

// ─── CLICK INTO A CONVERSATION ────────────────────────────

async function clickConversation(page, targetIndex) {
    var convRect = await page.evaluate(function(targetIndex) {
        var msgEls = document.querySelectorAll('[class*="MessageContent"]');
        if (msgEls.length === 0) return null;
        var probe = msgEls[0];
        var listContainer = null;
        var parent = probe.parentElement;
        while (parent) {
            if (parent.querySelectorAll('[class*="MessageContent"]').length > 1) {
                listContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
        if (!listContainer) return null;
        var rows = [];
        for (var c = 0; c < listContainer.children.length; c++) {
            var child = listContainer.children[c];
            if (child.querySelector('[class*="MessageContent"]') || child.matches('[class*="MessageContent"]')) {
                rows.push(child);
            }
        }
        if (rows.length < msgEls.length && rows.length > 0) {
            var expanded = [];
            for (var r = 0; r < rows.length; r++) {
                if (rows[r].querySelectorAll('[class*="MessageContent"]').length > 1) {
                    for (var sc = 0; sc < rows[r].children.length; sc++) {
                        if (rows[r].children[sc].querySelector('[class*="MessageContent"]') ||
                            rows[r].children[sc].matches('[class*="MessageContent"]')) {
                            expanded.push(rows[r].children[sc]);
                        }
                    }
                } else {
                    expanded.push(rows[r]);
                }
            }
            if (expanded.length > rows.length) rows = expanded;
        }
        if (targetIndex >= rows.length) return null;
        var rect = rows[targetIndex].getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, targetIndex);

    if (!convRect) return false;
    await page.mouse.click(convRect.x, convRect.y);
    return true;
}

// ─── READ FULL CONVERSATION ──────────────────────────────

async function readFullConversation(page, botName) {
    return await page.evaluate(function(args) {
        var botDisplayName = args.botDisplayName;
        var result = { partner: null, messages: [], lastSender: null };

        // Get partner name from input placeholder ("Message Sulav")
        var allInputs = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
        for (var i = 0; i < allInputs.length; i++) {
            var ph = allInputs[i].getAttribute('placeholder') || '';
            var match = ph.match(/^Message\s+(.+)/i);
            if (match) {
                result.partner = match[1].trim();
                break;
            }
        }

        // Fallback: ChatHeader link
        if (!result.partner) {
            var header = document.querySelector('[class*="ChatHeader"]');
            if (header) {
                var links = header.querySelectorAll('a[href*="/@"]');
                for (var h = 0; h < links.length; h++) {
                    var text = links[h].textContent.trim();
                    if (text && !/^\d+$/.test(text) && text !== botDisplayName) {
                        result.partner = text;
                        break;
                    }
                }
            }
        }

        // Find message bubbles
        var msgSelectors = [
            '[class*="ChatBubble"]', '[class*="MessageBubble"]',
            '[class*="ChatMessage"]', '[class*="MessageItem"]',
            '[class*="MessageRow"]',
        ];
        var bubbles = [];
        for (var s = 0; s < msgSelectors.length; s++) {
            bubbles = document.querySelectorAll(msgSelectors[s]);
            if (bubbles.length > 0) break;
        }

        var lastAuthor = null;
        for (var b = 0; b < bubbles.length; b++) {
            var bubble = bubbles[b];

            // Get author from link or name element
            var authorEl = bubble.querySelector('a[href*="/@"], [class*="UserNameText"]');
            var author = authorEl ? authorEl.textContent.trim() : null;
            if (!author) author = lastAuthor; // consecutive messages omit the name
            if (author) lastAuthor = author;

            // Get message text
            var msgTextEl = bubble.querySelector('[class*="MessageBody"], [class*="TextContent"], p');
            var msgText = msgTextEl ? msgTextEl.textContent.trim() : bubble.textContent.trim();

            // Strip author name and timestamp prefixes
            if (author && msgText.startsWith(author)) msgText = msgText.substring(author.length).trim();
            msgText = msgText.replace(/^\d+[dhms]\s*/i, '').replace(/^\d{1,2}:\d{2}\s*(am|pm)\s*/i, '').trim();

            if (msgText && author) {
                var role = (author === botDisplayName) ? 'bot' : 'partner';
                result.messages.push({ role: role, author: author, text: msgText });
            }
        }

        if (result.messages.length > 0) {
            result.lastSender = result.messages[result.messages.length - 1].role;
        }

        return result;
    }, { botDisplayName: botName });
}

// ─── GENERATE DM REPLY (full context) ────────────────────

async function generateDMReply(partnerName, messages) {
    console.log("    Generating reply to " + partnerName + " (" + messages.length + " messages in context)...");

    var conversationLines = messages.map(function(m) {
        var label = m.role === 'bot' ? 'You' : m.author;
        return label + ": " + m.text;
    }).join("\n");

    var completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        max_tokens: 300,
        messages: [{
            role: "system",
            content: "You are Scott Northwolf, founder of Self-Improvement Nation. You help self-improvement coaches go from $0 to $10K/month in 42 days with the 'Reverse Engineered $10K Method' or they don't pay.\n\nYou are replying to a direct message. Be warm, personal, and direct. Keep it concise.\n\nWriting style:\nBe concise. No overexplaining. Focus on actionable steps, logical frameworks and motivational language with ancient sounding wording when appropriate.\nNever use dashes or bullet point formatting.\nCreate mystery with bold statements and loose 007 style comments.\nNever be needy or chase anyone. You are the SUN, always giving value, always in a good mood. Speaking to you is a privilege.\nUse '. . .' for ellipses and '! ! !' for emphasis. Never use generic AI patterns."
        }, {
            role: "user",
            content: "Here is your full DM conversation with " + partnerName + ":\n\n" + conversationLines + "\n\nWrite your next reply. Keep it natural and contextual to the conversation so far."
        }],
    });
    return completion.choices[0].message.content;
}

// ─── SINGLE POLL: check for unreads and reply ────────────

async function pollAndReply(page, botName, repliedDMs) {
    var handled = 0;

    // Make sure we're on Skool
    var currentUrl = page.url();
    if (!currentUrl.includes('skool.com') || currentUrl.includes('login')) {
        await page.goto("https://www.skool.com", { waitUntil: "domcontentloaded" });
        await sleep(2000);
    }

    // Dismiss overlays
    await page.keyboard.press('Escape');
    await sleep(300);

    // Open chat panel
    var chatOpened = await openChatPanel(page);
    if (!chatOpened) {
        console.log("    Could not find chat icon — skipping poll");
        return 0;
    }
    await sleep(2000);

    // Get conversation list
    var convList = await getConversationList(page, botName);
    var unreadConvs = convList.conversations.filter(function(c) { return c.isUnread; });

    // Filter out already-replied
    unreadConvs = unreadConvs.filter(function(c) {
        var key = c.name + ":" + (c.lastMsg || '').substring(0, 80);
        return !repliedDMs.has(key);
    });

    if (unreadConvs.length === 0) {
        // Close chat panel silently
        await closeChatPanel(page);
        return 0;
    }

    console.log("  " + unreadConvs.length + " unread DM(s): " +
        unreadConvs.map(function(c) { return c.name; }).join(", "));

    for (var di = 0; di < unreadConvs.length; di++) {
        var targetConv = unreadConvs[di];

        // For 2nd+ conversation, close and reopen chat panel for fresh DOM
        if (di > 0) {
            await closeChatPanel(page);
            var reopened = await openChatPanel(page);
            if (!reopened) {
                console.log("    Could not reopen chat panel — stopping");
                break;
            }
            await sleep(2000);

            // Re-scan and find by name
            var freshList = await getConversationList(page, botName);
            var freshConv = null;
            for (var fi = 0; fi < freshList.conversations.length; fi++) {
                if (freshList.conversations[fi].name === targetConv.name) {
                    freshConv = freshList.conversations[fi];
                    break;
                }
            }
            if (!freshConv) {
                console.log("    Could not find " + targetConv.name + " in refreshed list — skipping");
                continue;
            }
            targetConv = freshConv;
        }

        // Random reply delay (0s – 60s)
        var replyDelay = randomBetween(CONFIG.replyDelayMinMs, CONFIG.replyDelayMaxMs);
        if (replyDelay > 1000) {
            console.log("    Waiting " + formatMs(replyDelay) + " before replying to " + targetConv.name + "...");
            await sleep(replyDelay);
        }

        // Click into conversation
        var clicked = await clickConversation(page, targetConv.index);
        if (!clicked) {
            console.log("    Could not click conversation with " + targetConv.name + " — skipping");
            continue;
        }
        await sleep(2500);

        // Read full conversation
        var convInfo = await readFullConversation(page, botName);
        var partner = convInfo.partner || targetConv.name;

        console.log("    [" + partner + "] " + convInfo.messages.length + " messages, last sender: " + (convInfo.lastSender || "unknown"));

        if (convInfo.lastSender === 'bot') {
            console.log("    [" + partner + "] Last message is ours — no reply needed");
        } else if (convInfo.lastSender === 'partner' && convInfo.messages.length > 0) {
            var lastPartnerMsg = convInfo.messages[convInfo.messages.length - 1].text;
            console.log("    [" + partner + "] Their last msg: " + lastPartnerMsg.substring(0, 80));

            // Generate reply with full conversation context
            var dmReply = await generateDMReply(partner, convInfo.messages);

            console.log("    " + "-".repeat(40));
            console.log("    REPLY TO " + partner + ":");
            console.log("    " + dmReply);
            console.log("    " + "-".repeat(40));

            // Type into chat input
            var dmInput = await page.$(
                'textarea[placeholder*="Message"], ' +
                '[class*="ChatTextArea"] textarea, ' +
                '[class*="ChatInput"] textarea, ' +
                '[class*="Chat"] [contenteditable="true"], ' +
                '[class*="chat"] [contenteditable="true"]'
            );
            if (dmInput) {
                await dmInput.click({ force: true });
                await sleep(300);
                await page.keyboard.type(dmReply, { delay: 20 });
                await sleep(300);
                if (CONFIG.dryRun) {
                    console.log("    DRY RUN — typed but NOT sent");
                } else {
                    await page.keyboard.press('Enter');
                    console.log("    Sent!");
                }

                // Track as replied
                var dmKey = targetConv.name + ":" + (targetConv.lastMsg || '').substring(0, 80);
                repliedDMs.add(dmKey);
                saveRepliedDMs(repliedDMs);
                handled++;
            } else {
                console.log("    Could not find DM input box — skipping");
            }
        } else {
            console.log("    [" + partner + "] Could not read messages — skipping");
        }

        // Go back to conversation list
        await closeChatPanel(page);
        await sleep(500);
        var reopen = await openChatPanel(page);
        if (!reopen) break;
        await sleep(1500);
    }

    // Close chat panel
    await closeChatPanel(page);
    return handled;
}

// ─── MAIN ─────────────────────────────────────────────────

async function main() {
    if (!CONFIG.email || !CONFIG.password) {
        console.error("Set SKOOL_EMAIL and SKOOL_PASSWORD in your .env file");
        process.exit(1);
    }

    var browser = await chromium.launch({ headless: CONFIG.headless });
    var context = await browser.newContext();
    var page = await context.newPage();
    var repliedDMs = loadRepliedDMs();
    var cycle = 0;

    try {
        var botName = await login(page);

        while (true) {
            cycle++;

            // ── ACTIVE PERIOD ──
            var activeTime = randomBetween(CONFIG.activeMinMs, CONFIG.activeMaxMs);
            var activeEnd = Date.now() + activeTime;
            console.log("\n" + "=".repeat(55));
            console.log("CYCLE " + cycle + " — ACTIVE for " + formatMs(activeTime));
            console.log("=".repeat(55));

            var totalHandled = 0;
            var pollCount = 0;

            while (Date.now() < activeEnd) {
                pollCount++;
                var remaining = activeEnd - Date.now();
                var ts = new Date().toLocaleTimeString();
                console.log("\n[" + ts + "] Poll #" + pollCount + " (" + formatMs(remaining) + " left in active period)");

                try {
                    var handled = await pollAndReply(page, botName, repliedDMs);
                    totalHandled += handled;
                    if (handled === 0 && pollCount > 1) {
                        // No new messages — quiet poll, just show dot
                        process.stdout.write("  . no new DMs\n");
                    }
                } catch (err) {
                    console.error("  Error during poll: " + err.message);
                }

                // Wait before next poll (but not if active period is over)
                if (Date.now() < activeEnd) {
                    await sleep(CONFIG.pollIntervalMs);
                }
            }

            console.log("\n" + "-".repeat(55));
            console.log("ACTIVE PERIOD DONE — replied to " + totalHandled + " DMs across " + pollCount + " polls");
            console.log("-".repeat(55));

            // ── INACTIVE PERIOD ──
            var inactiveTime = randomBetween(CONFIG.inactiveMinMs, CONFIG.inactiveMaxMs);
            console.log("\nINACTIVE for " + formatMs(inactiveTime) + "\n");
            await countdown(inactiveTime, "Sleeping");
        }

    } catch (err) {
        console.error("Fatal error:", err.message);
    } finally {
        await browser.close();
    }
}

main();
