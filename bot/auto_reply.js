const { chromium } = require("playwright");
const OpenAI = require("openai");
const readline = require("readline");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    communityUrl: process.env.SKOOL_COMMUNITY_URL || "https://www.skool.com/self-improvement-nation-3104",
    headless: false, // visible so you can watch it
    autoSend: true, // sends without approval
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function askUser(question) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(function(resolve) {
        rl.question(question, function(answer) {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

async function login(page) {
    console.log("🔐 Logging in...");
    await page.goto("https://www.skool.com/login", { waitUntil: "networkidle" });
    await sleep(800);
    await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
    await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"]');
    await sleep(3000);
    if (page.url().includes("login")) throw new Error("Login failed — check credentials");
    console.log("✅ Logged in\n");
}

async function getFirstPost(page) {
    console.log("📋 Navigating to community...");
    await page.goto(CONFIG.communityUrl, { waitUntil: "networkidle" });
    await sleep(2000);

    // Grab all post wrappers, skip pinned ones, collect all real posts
    var allPosts = await page.evaluate(function() {
        var wrappers = Array.from(document.querySelectorAll('[class*="PostItemWrapper"]'));
        var posts = [];
        for (var i = 0; i < wrappers.length; i++) {
            var w = wrappers[i];
            // Skip pinned posts
            if (w.textContent.includes("Pinned") || w.querySelector('[class*="Pinned"], [class*="pinned"]')) continue;

            var authorEl = w.querySelector('a[href*="/@"]');
            var categoryEl = w.querySelector('[class*="GroupFeedLinkLabel"]');
            var contentEl = w.querySelector('[class*="PostItemCardContent"]');
            // Find the actual post link (not profile, not category)
            var postLinks = Array.from(w.querySelectorAll("a")).filter(function(a) {
                var href = a.href || "";
                return href.includes("/post/") || (href.split("/").length > 4 && !href.includes("/@") && !href.includes("?c=") && !href.includes("?p="));
            });
            var titleLink = postLinks.find(function(a) { return a.textContent.trim().length > 3; });

            if (titleLink) {
                posts.push({
                    author: authorEl ? authorEl.textContent.trim() : "Unknown",
                    title: titleLink.textContent.trim(),
                    category: categoryEl ? categoryEl.textContent.trim() : "General",
                    body: contentEl ? contentEl.textContent.trim() : "",
                    href: titleLink.href,
                });
            }
        }
        return posts;
    });

    if (!allPosts || allPosts.length === 0) throw new Error("No non-pinned posts found on page");

    // Pick a random post
    var postData = allPosts[Math.floor(Math.random() * allPosts.length)];
    console.log("🎲 Found " + allPosts.length + " posts, picked random one");

    // Click into the post to open the detail view
    console.log("📖 Opening post: " + postData.title);
    await page.goto(postData.href, { waitUntil: "networkidle" });
    await sleep(3000);

    // Get full post body from the detail page — try multiple selectors
    var fullBody = await page.evaluate(function() {
        var selectors = [
            '[class*="PostContent"]',
            '[class*="post-body"]',
            '[class*="RichText"]',
            '.ql-editor',
            '[data-testid*="post-content"]',
            'article',
        ];
        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el && el.textContent.trim().length > 20) return el.textContent.trim();
        }
        return "";
    });

    if (fullBody) postData.body = fullBody;

    console.log("  Author:   " + postData.author);
    console.log("  Category: " + postData.category);
    console.log("  Body:     " + postData.body.substring(0, 200) + (postData.body.length > 200 ? "..." : ""));
    console.log("");

    return postData;
}

async function typeReply(page, replyText) {
    // Skool uses an input with placeholder "Your comment"
    var replyBox = await page.$('input[placeholder="Your comment"]');

    // Fallback selectors
    if (!replyBox) {
        var selectors = [
            '[placeholder*="comment" i]',
            '[placeholder*="Your comment"]',
            '[class*="CommentInput"] input',
            '[class*="CommentInput"] [contenteditable="true"]',
            '[class*="comment"] input',
            '[contenteditable="true"]',
        ];
        for (var i = 0; i < selectors.length; i++) {
            replyBox = await page.$(selectors[i]);
            if (replyBox) break;
        }
    }

    if (!replyBox) {
        await page.screenshot({ path: "debug_screenshot.png" });
        throw new Error("Could not find reply input box — saved debug_screenshot.png for inspection");
    }

    await replyBox.click();
    await sleep(500);
    await page.keyboard.type(replyText, { delay: 20 });
    await sleep(300);
    console.log("✏️  Reply typed into box\n");
}

async function submitReply(page) {
    // Click the COMMENT button to submit
    var commentBtn = await page.$('button:has-text("COMMENT"), button:has-text("Comment")');
    if (!commentBtn) {
        // Fallback: try finding by text content
        commentBtn = await page.$('button >> text=COMMENT');
    }
    if (!commentBtn) throw new Error("Could not find COMMENT button");
    await commentBtn.click();
    console.log("✅ Reply sent! Closing in 10 seconds...\n");
    await sleep(10000);
}

async function main() {
    if (!CONFIG.email || !CONFIG.password) {
        console.error("❌ Set SKOOL_EMAIL and SKOOL_PASSWORD in your .env file");
        process.exit(1);
    }

    var browser = await chromium.launch({ headless: CONFIG.headless });
    var context = await browser.newContext();
    var page = await context.newPage();

    try {
        await login(page);
        var post = await getFirstPost(page);

        // Generate AI reply using OpenAI
        console.log("🤖 Generating AI reply...\n");
        var completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o",
            max_tokens: 300,
            messages: [{
                    role: "system",
                    content: "You are Scott Northwolf, founder of Self-Improvement Nation. You help self-improvement coaches go from $0 to $10K/month in 42 days with the 'Reverse Engineered $10K Method' or they don't pay.\n\nYou speak like a legend of old. The wise old man of the mountain meets Alexander The Great rallying his soldiers to battle. Unshakable confidence without arrogance.\n\nWriting style:\nBe concise. No overexplaining. Focus on actionable steps, logical frameworks and motivational language with ancient sounding wording when appropriate.\nNever use dashes or bullet point formatting.\nCreate mystery with bold statements and loose 007 style comments.\nNever be needy or chase anyone. You are the SUN, always giving value, always in a good mood. Speaking to you is a privilege.\nUse '. . .' for ellipses and '! ! !' for emphasis. Never use generic AI patterns.\nSign off with variations of 'Duty, Honor and Pride! ! !"
                },
                {
                    role: "user",
                    content: post.author + " posted in " + post.category + ":\n\n" + post.body + "\n\nWrite a short, natural reply."
                }
            ],
        });
        var replyText = completion.choices[0].message.content;

        console.log("─".repeat(50));
        console.log("GENERATED REPLY:");
        console.log("─".repeat(50));
        console.log(replyText);
        console.log("─".repeat(50));
        console.log("Model: " + (process.env.OPENAI_MODEL || "gpt-4o"));
        console.log("");

        // Type into the reply box
        await typeReply(page, replyText);

        if (CONFIG.autoSend) {
            await submitReply(page);
        } else {
            // Human-in-the-loop: wait for approval
            var answer = await askUser("Send this reply? (y/n): ");
            if (answer === "y" || answer === "yes") {
                await submitReply(page);
            } else {
                console.log("❌ Reply cancelled. Browser staying open for manual editing.");
                console.log("   Press Ctrl+C to close when done.\n");
                await page.waitForTimeout(600000); // keep open 10 min
            }
        }
    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await browser.close();
    }
}

main();