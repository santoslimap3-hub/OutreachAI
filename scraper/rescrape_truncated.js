/**
 * rescrape_truncated.js
 *
 * Detects posts in posts_with_scott_reply_threads.json whose body was
 * cut off by the old 1000-character limit in scraper.js, re-scrapes
 * each post URL to get the full body, patches the data in-place, and
 * preserves all existing tags.
 *
 * Detection heuristics (a post is considered truncated if ANY of these match):
 *   1. Body length is >= 950 chars (was hitting the 1000-char ceiling)
 *   2. Body ends without terminal punctuation / emoji (abrupt mid-sentence cut)
 *   3. Body contains "see more" text (was already caught by rescrape_see_more.js
 *      but included here for completeness)
 *
 * Usage:
 *   node rescrape_truncated.js
 *
 * Reads credentials from .env (same as scraper.js):
 *   SKOOL_EMAIL, SKOOL_PASSWORD
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    targetMember: process.env.TARGET_MEMBER || "Scott Northwolf",
    headless: true,
    // How many chars from the old 1000-char ceiling triggers a "probably truncated" flag
    truncationThreshold: 950,
};

const TAGGED_DATA_PATH = path.resolve(__dirname, "../data/posts_with_scott_reply_threads.json");
const BACKUP_PATH = path.resolve(
    __dirname,
    "../data/posts_with_scott_reply_threads_backup_pretruncfix_" +
        new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) +
        ".json"
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Returns true if the body looks like it was cut off.
 * We use three signals:
 *  1. Length >= threshold (was slamming the old 1000-char limit)
 *  2. Ends without a sentence-terminating character
 *  3. Contains a "see more" artifact
 */
function isTruncated(body) {
    if (!body || body.length < 20) return false;

    // Signal 1: near or at the old limit
    if (body.length >= CONFIG.truncationThreshold) return true;

    // Signal 2: ends without terminal punctuation / emoji / closing bracket
    // Terminal chars: . ! ? " ' ) ] emoji (broad unicode range)
    const last = body.trimEnd();
    if (last.length === 0) return false;
    const lastChar = last[last.length - 1];
    // Code-point check for emoji / extended unicode
    const cp = last.codePointAt(last.length - 2); // surrogate pair aware
    const isEmoji = cp && cp > 0x1F000;
    const isTerminal = /[.!?'")}\]🔥💪🙏✅❤️👊💯🎯🚀]/.test(lastChar) || isEmoji;
    if (!isTerminal) return true;

    // Signal 3: explicit "see more" artifact
    if (/see more/i.test(body)) return true;

    return false;
}

function cleanContent(text) {
    if (!text) return text;
    text = text.replace(/\n?\s*To pick up a draggable item[\s\S]*?press escape to cancel\.\s*/gm, "");
    text = text.replace(/\s*Drop files here to upload[\s\S]*$/m, "");
    text = text.replace(/\s*Recently UsedSmileys & People[\s\S]*$/m, "");
    text = text.replace(/\s*Recently Used[\s\S]*(?:Flags|Symbols)[\s\S]*$/m, "");
    text = text.replace(/\d*\s*Reply\s*$/, "");
    text = text.replace(/\s+\d{1,2}:\d{2}\s*$/, "");
    return text.trim();
}

// ─── Browser / scrape helpers ─────────────────────────────────────────────────

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

/**
 * Navigate to a post URL, expand all "See more" / reply threads,
 * and return the full post body text.
 */
async function scrapeFullBody(page, postUrl) {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    // Scroll down to trigger lazy loading
    for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(400);
    }

    // Expand reply threads (up to 8 rounds)
    for (let attempt = 0; attempt < 8; attempt++) {
        const clicked = await page.evaluate(() => {
            let count = 0;
            const expandBtns = document.querySelectorAll(
                '[class*="ViewRepl"], [class*="viewRepl"], [class*="ShowRepl"], [class*="showRepl"],' +
                '[class*="ExpandRepl"], [class*="expandRepl"], [class*="view-repl"], [class*="show-repl"]'
            );
            expandBtns.forEach(el => { try { el.click(); count++; } catch (_) {} });
            if (count === 0) {
                document.querySelectorAll('button, a, span[role="button"], div[role="button"]').forEach(el => {
                    const txt = el.textContent.trim();
                    if (txt.length > 50) return;
                    if (/\d+\s*repl/i.test(txt) || /view.*repl/i.test(txt) || /show.*repl/i.test(txt)) {
                        try { el.click(); count++; } catch (_) {}
                    }
                });
            }
            return count;
        });
        if (clicked === 0) break;
        await sleep(800);
    }

    // Click "See more" buttons aggressively (up to 10 rounds)
    for (let attempt = 0; attempt < 10; attempt++) {
        const expanded = await page.evaluate(() => {
            let count = 0;
            document.querySelectorAll("button, a, span, div[role=button]").forEach(el => {
                const txt = el.textContent.trim();
                if (txt.length > 30) return;
                if (
                    /^see\s*more$/i.test(txt) ||
                    /^\.\.\.\s*see\s*more$/i.test(txt) ||
                    /^read\s*more$/i.test(txt) ||
                    /^show\s*more$/i.test(txt)
                ) {
                    try { el.click(); count++; } catch (_) {}
                }
            });
            document.querySelectorAll(
                '[class*="SeeMore"], [class*="see-more"], [class*="seeMore"],' +
                '[class*="ReadMore"], [class*="readMore"], [class*="Truncat"],' +
                '[class*="truncat"], [class*="ShowMore"], [class*="showMore"]'
            ).forEach(el => {
                if (el.textContent.trim().length < 30) {
                    try { el.click(); count++; } catch (_) {}
                }
            });
            return count;
        });
        if (expanded === 0) break;
        await sleep(800);
    }

    // Final scroll after expansions
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1000);

    // Extract the post body — must NOT capture comment text
    const fullBody = await page.evaluate(() => {
        // Strategy 1: first RichText block not inside a comment bubble
        const richTexts = document.querySelectorAll('[class*="RichText"]');
        for (const el of richTexts) {
            let inComment = false;
            let parent = el.parentElement;
            for (let j = 0; j < 15; j++) {
                if (!parent) break;
                const cls = parent.className || "";
                if (/CommentItem|commentItem|CommentBubble|commentBubble/i.test(cls)) {
                    inComment = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!inComment && el.innerText.trim().length > 20) {
                return el.innerText.trim();
            }
        }
        // Strategy 2: named post body selectors
        for (const sel of [
            '[class*="PostContent"]',
            '[class*="postContent"]',
            '[class*="PostBody"]',
            '[class*="postBody"]',
        ]) {
            const el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 20) return el.innerText.trim();
        }
        return null;
    });

    return fullBody ? cleanContent(fullBody) : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("🔄 RESCRAPE TRUNCATED POST BODIES");
    console.log("===================================\n");

    if (!CONFIG.email || !CONFIG.password) {
        console.error("❌ Missing SKOOL_EMAIL / SKOOL_PASSWORD in .env");
        process.exit(1);
    }

    // Load the tagged dataset
    const taggedData = JSON.parse(fs.readFileSync(TAGGED_DATA_PATH, "utf-8"));
    console.log(`Loaded ${taggedData.length} posts from tagged dataset\n`);

    // ── Detect truncated posts ────────────────────────────────────────────────
    const truncatedPosts = [];
    taggedData.forEach((post, idx) => {
        const body = (post.original_post || {}).body || "";
        if (isTruncated(body)) {
            truncatedPosts.push({ post, idx, bodyLength: body.length, bodyEnd: body.slice(-60) });
        }
    });

    if (truncatedPosts.length === 0) {
        console.log("✅ No truncated posts found. Dataset looks clean.");
        return;
    }

    console.log(`⚠️  Found ${truncatedPosts.length} truncated posts:\n`);
    truncatedPosts.forEach(({ post, bodyLength, bodyEnd }, i) => {
        const url = (post.original_post || {}).url || "no-url";
        console.log(`  [${String(i + 1).padStart(3, "0")}] ID=${post.id} | len=${bodyLength} | ...${JSON.stringify(bodyEnd)}`);
        console.log(`       URL: ${url}`);
    });
    console.log("");

    // ── Backup before any writes ──────────────────────────────────────────────
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(taggedData, null, 2));
    console.log(`📦 Backup saved → ${path.basename(BACKUP_PATH)}\n`);

    // ── Launch browser ────────────────────────────────────────────────────────
    const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 0 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const results = { fixed: 0, skipped_no_url: 0, skipped_no_improvement: 0, errored: 0 };

    try {
        await login(page);

        for (let i = 0; i < truncatedPosts.length; i++) {
            const { post, idx } = truncatedPosts[i];
            const url = (post.original_post || {}).url;
            const oldBody = post.original_post.body || "";

            console.log(`[${i + 1}/${truncatedPosts.length}] ID=${post.id}`);

            if (!url) {
                console.log("  ⚠️  No URL — skipping\n");
                results.skipped_no_url++;
                continue;
            }

            try {
                const newBody = await scrapeFullBody(page, url);

                if (!newBody) {
                    console.log("  ⚠️  Couldn't extract body — skipping\n");
                    results.skipped_no_improvement++;
                    continue;
                }

                // Only accept the new body if it's actually longer / cleaner
                if (newBody.length <= oldBody.length && !/see more/i.test(oldBody)) {
                    console.log(`  ℹ️  New body (${newBody.length}) not longer than old (${oldBody.length}) — keeping old\n`);
                    results.skipped_no_improvement++;
                    continue;
                }

                // Patch in-place — preserve all other fields
                taggedData[idx].original_post.body = newBody;

                const stillTruncated = isTruncated(newBody);
                if (stillTruncated) {
                    console.log(`  ⚠️  Updated but still looks truncated (len=${newBody.length})`);
                    console.log(`       End: ...${JSON.stringify(newBody.slice(-60))}\n`);
                } else {
                    console.log(`  ✅ Fixed! ${oldBody.length} → ${newBody.length} chars\n`);
                }

                results.fixed++;

                // Save after every successful fix so a crash doesn't lose progress
                fs.writeFileSync(TAGGED_DATA_PATH, JSON.stringify(taggedData, null, 2));

            } catch (err) {
                console.log(`  ❌ Error: ${err.message}\n`);
                results.errored++;
            }

            // Polite delay between requests
            await sleep(1200);
        }

    } finally {
        await browser.close();
    }

    // ── Final verification pass ───────────────────────────────────────────────
    const reloaded = JSON.parse(fs.readFileSync(TAGGED_DATA_PATH, "utf-8"));
    const stillTruncated = reloaded.filter(p => isTruncated((p.original_post || {}).body || ""));

    console.log("===================================");
    console.log("✅ RESCRAPE COMPLETE\n");
    console.log(`  Posts checked:           ${truncatedPosts.length}`);
    console.log(`  Fixed:                   ${results.fixed}`);
    console.log(`  Skipped (no URL):        ${results.skipped_no_url}`);
    console.log(`  Skipped (no improvement):${results.skipped_no_improvement}`);
    console.log(`  Errored:                 ${results.errored}`);
    console.log(`  Still truncated:         ${stillTruncated.length}`);
    console.log(`  Total posts:             ${reloaded.length}`);
    console.log(`\n  Dataset saved → ${TAGGED_DATA_PATH}`);
    console.log(`  Backup kept   → ${BACKUP_PATH}`);
    console.log("===================================");

    if (stillTruncated.length > 0) {
        console.log(`\n⚠️  ${stillTruncated.length} posts still look truncated after re-scrape.`);
        console.log("   These may need manual review (deleted posts, private content, etc.):");
        stillTruncated.forEach(p => {
            const body = (p.original_post || {}).body || "";
            console.log(`     ID=${p.id} | len=${body.length} | url=${(p.original_post || {}).url}`);
        });
    }
}

main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
