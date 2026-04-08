/**
 * Re-scrape posts that have "see more" artifacts in their content.
 * 
 * This script:
 * 1. Scans posts_with_scott_reply_threads.json for entries containing "see more"
 * 2. Re-scrapes ONLY those post URLs with aggressive "See more" button clicking
 * 3. Replaces the broken threads in-place, PRESERVING all existing tags
 * 4. Backs up the file before writing
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    targetMember: process.env.TARGET_MEMBER || "Scott Northwolf",
    headless: true,
};

const TAGGED_DATA_PATH = path.resolve(__dirname, "../data/posts_with_scott_reply_threads.json");
const BACKUP_PATH = path.resolve(__dirname, "../data/posts_with_scott_reply_threads_backup_recent.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hasSeeMore(post) {
    var body = (post.original_post || {}).body || "";
    if (/see more/i.test(body)) return true;
    for (var t of(post.threads || [])) {
        if (/see more/i.test((t.comment || {}).content || "")) return true;
        for (var r of(t.replies || [])) {
            if (/see more/i.test(r.content || "")) return true;
        }
    }
    return false;
}

// Clean UI artifacts that .textContent/.innerText may still capture
function cleanContent(text) {
    if (!text) return text;
    // Remove drag-and-drop accessibility text
    text = text.replace(/\n?\s*To pick up a draggable item[\s\S]*?press escape to cancel\.\s*/gm, '');
    // Remove emoji picker dumps
    text = text.replace(/\s*Drop files here to upload[\s\S]*$/m, '');
    text = text.replace(/\s*Recently UsedSmileys & People[\s\S]*$/m, '');
    text = text.replace(/\s*Recently Used[\s\S]*(?:Flags|Symbols)[\s\S]*$/m, '');
    // Remove trailing Reply/Like button text
    text = text.replace(/\d*\s*Reply\s*$/, '');
    // Remove trailing video timestamps
    text = text.replace(/\s+\d{1,2}:\d{2}\s*$/, '');
    return text.trim();
}

async function login(page) {
    console.log("🔐 Logging in...");
    await page.goto("https://www.skool.com/login", { waitUntil: "networkidle" });
    await sleep(800);
    await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
    await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"]');
    await sleep(3000);
    if (page.url().includes("login")) throw new Error("Login failed");
    console.log("✅ Logged in");
}

async function extractThreadedComments(page, postUrl, targetName) {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000);

    // Scroll to load all comments — more aggressive
    for (var i = 0; i < 10; i++) {
        await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
        await sleep(600);
    }

    // Expand all collapsed reply threads — try multiple rounds
    for (var attempt = 0; attempt < 8; attempt++) {
        var clicked = await page.evaluate(function() {
            var count = 0;
            var expandBtns = document.querySelectorAll('[class*="ViewRepl"], [class*="viewRepl"], [class*="ShowRepl"], [class*="showRepl"], [class*="ExpandRepl"], [class*="expandRepl"], [class*="view-repl"], [class*="show-repl"]');
            expandBtns.forEach(function(el) {
                try {
                    el.click();
                    count++;
                } catch (e) {}
            });
            if (count === 0) {
                var allEls = document.querySelectorAll('button, a, span[role="button"], div[role="button"], [class*="Repl"] span, [class*="repl"] span');
                for (var i = 0; i < allEls.length; i++) {
                    var txt = allEls[i].textContent.trim();
                    if (txt.length > 50) continue;
                    if (/\d+\s*repl/i.test(txt) || /view.*repl/i.test(txt) || /show.*repl/i.test(txt)) {
                        try {
                            allEls[i].click();
                            count++;
                        } catch (e) {}
                    }
                }
            }
            return count;
        });
        if (clicked === 0) break;
        await sleep(1000);
    }

    // Click all "See more" buttons — MORE AGGRESSIVE with longer waits
    for (var seeMoreAttempt = 0; seeMoreAttempt < 10; seeMoreAttempt++) {
        var expandedCount = await page.evaluate(function() {
            var count = 0;
            var allClickable = document.querySelectorAll("button, a, span, div[role=button]");
            for (var i = 0; i < allClickable.length; i++) {
                var txt = allClickable[i].textContent.trim();
                if (txt.length > 30) continue;
                if (/^see\s*more$/i.test(txt) || /^\.\.\.\s*see\s*more$/i.test(txt) || /^read\s*more$/i.test(txt) || /^show\s*more$/i.test(txt) || txt === "See more" || txt === "... See more") {
                    try {
                        allClickable[i].click();
                        count++;
                    } catch (e) {}
                }
            }
            var classTargets = document.querySelectorAll('[class*="SeeMore"], [class*="see-more"], [class*="seeMore"], [class*="ReadMore"], [class*="readMore"], [class*="read-more"], [class*="ShowMore"], [class*="showMore"], [class*="Truncat"], [class*="truncat"], [class*="Expand"], [class*="expand"]');
            classTargets.forEach(function(el) {
                var t = el.textContent.trim();
                if (t.length < 30) {
                    try {
                        el.click();
                        count++;
                    } catch (e) {}
                }
            });
            return count;
        });
        if (expandedCount === 0) break;
        // Wait longer for content to load after clicking see more
        await sleep(1000);
    }

    // Final scroll after all expansions
    for (var i = 0; i < 3; i++) {
        await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
        await sleep(500);
    }

    // Wait for any lazy-loaded content
    await sleep(1500);

    // Get the full post body — must avoid capturing comment text
    var fullBody = await page.evaluate(function() {
        // Strategy 1: Find RichText elements that are NOT inside a comment bubble
        var richTexts = document.querySelectorAll('[class*="RichText"]');
        for (var i = 0; i < richTexts.length; i++) {
            var el = richTexts[i];
            // Skip if inside a comment bubble
            var inComment = false;
            var parent = el.parentElement;
            for (var j = 0; j < 15; j++) {
                if (!parent) break;
                var cls = parent.className || "";
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
        // Strategy 2: Try specific post content selectors
        var selectors = ['[class*="PostContent"]', '[class*="postContent"]', '[class*="PostBody"]', '[class*="postBody"]'];
        for (var s = 0; s < selectors.length; s++) {
            var bodyEl = document.querySelector(selectors[s]);
            if (bodyEl && bodyEl.innerText.trim().length > 20) {
                return bodyEl.innerText.trim();
            }
        }
        return null;
    });
    if (fullBody) fullBody = cleanContent(fullBody);

    var threads = await page.evaluate(function(targetName) {
        var conversations = [];
        var allBubbles = document.querySelectorAll('[class*="CommentItemBubble"]');
        var seen = new Set();

        function getAuthor(bubble) {
            var links = Array.from(bubble.querySelectorAll('a[href*="/@"]'));
            for (var i = 0; i < links.length; i++) {
                var txt = links[i].textContent.trim();
                if (/^\d+$/.test(txt) || txt.startsWith("@")) continue;
                return txt;
            }
            return "Unknown";
        }

        function getContent(bubble) {
            // Use innerText instead of textContent — respects CSS display:none
            // so hidden emoji pickers, drag-drop UI, etc. won't be captured
            var text = bubble.innerText.trim();
            var author = getAuthor(bubble);
            var idx = text.indexOf(author);
            if (idx !== -1) text = text.substring(idx + author.length).trim();
            text = text.replace(/^[^\w@]*[·•]\s*\d+[hmd]\s*/i, "").trim();
            text = text.replace(/^[^\w@]*[·•]\s*\w+\s+\d+\s*/i, "").trim();
            // Strip any remaining UI artifacts
            text = text.replace(/\n?\s*To pick up a draggable item[\s\S]*?press escape to cancel\.\s*/gm, '');
            text = text.replace(/\s*Drop files here to upload[\s\S]*$/m, '');
            text = text.replace(/\s*Recently UsedSmileys & People[\s\S]*$/m, '');
            text = text.replace(/\d*\s*Reply\s*$/, '');
            return text.trim();
        }

        function isTarget(author) {
            return author.trim() === targetName;
        }

        var replyClassPattern = /Reply|reply|Replies|replies|Nested|nested|Child|child/;

        function isReplyBubble(bubble) {
            var el = bubble.parentElement;
            for (var i = 0; i < 10; i++) {
                if (!el) break;
                var cls = el.className || "";
                if (replyClassPattern.test(cls)) return true;
                el = el.parentElement;
            }
            return false;
        }

        function findReplies(bubble) {
            var replies = [];
            var node = bubble;
            for (var i = 0; i < 10; i++) {
                if (!node || !node.parentElement) break;
                node = node.parentElement;
                var sibling = node.nextElementSibling;
                if (sibling) {
                    var cls = sibling.className || "";
                    if (replyClassPattern.test(cls)) {
                        var replyBubbles = sibling.querySelectorAll('[class*="CommentItemBubble"]');
                        replyBubbles.forEach(function(rb) {
                            var rAuthor = getAuthor(rb);
                            if (rAuthor === "Unknown") return;
                            var rContent = getContent(rb);
                            var rKey = rAuthor + "|" + rContent.substring(0, 50);
                            if (!seen.has(rKey)) {
                                seen.add(rKey);
                                replies.push({ author: rAuthor, content: rContent, isTargetMember: isTarget(rAuthor) });
                            }
                        });
                        if (replies.length > 0) return replies;
                    }
                }
                var nextSib = node.nextElementSibling;
                while (nextSib) {
                    var nCls = nextSib.className || "";
                    if (nCls && replyClassPattern.test(nCls)) {
                        var rbs = nextSib.querySelectorAll('[class*="CommentItemBubble"]');
                        rbs.forEach(function(rb) {
                            var rAuthor = getAuthor(rb);
                            if (rAuthor === "Unknown") return;
                            var rContent = getContent(rb);
                            var rKey = rAuthor + "|" + rContent.substring(0, 50);
                            if (!seen.has(rKey)) {
                                seen.add(rKey);
                                replies.push({ author: rAuthor, content: rContent, isTargetMember: isTarget(rAuthor) });
                            }
                        });
                        if (replies.length > 0) return replies;
                    }
                    nextSib = nextSib.nextElementSibling;
                }
            }
            return replies;
        }

        allBubbles.forEach(function(bubble) {
            if (isReplyBubble(bubble)) return;
            var author = getAuthor(bubble);
            if (author === "Unknown") return;
            var content = getContent(bubble);
            var key = author + "|" + content.substring(0, 50);
            if (seen.has(key)) return;
            seen.add(key);
            var thread = {
                comment: { author: author, content: content, isTargetMember: isTarget(author) },
                replies: findReplies(bubble),
            };
            conversations.push(thread);
        });
        return conversations;
    }, targetName);

    return { threads: threads, fullBody: fullBody };
}

async function main() {
    console.log("🔄 RE-SCRAPE: Fixing 'see more' artifacts");
    console.log("==========================================\n");

    if (!CONFIG.email || !CONFIG.password) {
        console.error("Missing .env credentials");
        process.exit(1);
    }

    // Load tagged data
    var taggedData = JSON.parse(fs.readFileSync(TAGGED_DATA_PATH, "utf-8"));
    console.log("Loaded " + taggedData.length + " tagged posts");

    // Find posts with "see more"
    var affectedPosts = [];
    taggedData.forEach(function(post, idx) {
        if (hasSeeMore(post)) {
            affectedPosts.push({ post: post, index: idx });
        }
    });

    if (affectedPosts.length === 0) {
        console.log("✅ No posts with 'see more' found. Nothing to do.");
        return;
    }

    console.log("Found " + affectedPosts.length + " posts with 'see more' artifacts:\n");
    affectedPosts.forEach(function(a) {
        var url = (a.post.original_post || {}).url || "no-url";
        console.log("  ID=" + a.post.id + " — " + url);
    });
    console.log("");

    // Backup before modifying
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(taggedData, null, 2));
    console.log("📦 Backup saved to: " + BACKUP_PATH + "\n");

    // Launch browser and login
    var browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 0 });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    var page = await context.newPage();

    try {
        await login(page);

        for (var i = 0; i < affectedPosts.length; i++) {
            var entry = affectedPosts[i];
            var post = entry.post;
            var url = (post.original_post || {}).url;

            if (!url) {
                console.log("  ⚠️  ID=" + post.id + " has no URL, skipping");
                continue;
            }

            console.log("  [" + (i + 1) + "/" + affectedPosts.length + "] Re-scraping ID=" + post.id + " ...");
            console.log("    URL: " + url);

            try {
                var result = await extractThreadedComments(page, url, CONFIG.targetMember);
                var newThreads = result.threads;
                var fullBody = result.fullBody;

                // Preserve existing tags on the post level
                var existingTags = post.tags || { tone_tags: [], intent: "", sales_stage: "" };

                // Build a map of existing thread-level tags by author+content prefix
                var existingThreadTags = {};
                (post.threads || []).forEach(function(t) {
                    var key = (t.comment || {}).author + "|" + ((t.comment || {}).content || "").substring(0, 30);
                    if ((t.comment || {}).tags) existingThreadTags[key] = t.comment.tags;
                    (t.replies || []).forEach(function(r) {
                        var rKey = r.author + "|" + (r.content || "").substring(0, 30);
                        if (r.tags) existingThreadTags[rKey] = r.tags;
                    });
                });

                // Apply tags to new threads — restore any existing tags, add empty tags for Northwolf entries
                newThreads.forEach(function(t) {
                    var cKey = (t.comment || {}).author + "|" + ((t.comment || {}).content || "").substring(0, 30);
                    if (existingThreadTags[cKey]) {
                        t.comment.tags = existingThreadTags[cKey];
                    } else if ((t.comment.author || "").includes("Northwolf")) {
                        t.comment.tags = t.comment.tags || { tone_tags: [], intent: "", sales_stage: "" };
                    }
                    (t.replies || []).forEach(function(r) {
                        var rKey = r.author + "|" + (r.content || "").substring(0, 30);
                        if (existingThreadTags[rKey]) {
                            r.tags = existingThreadTags[rKey];
                        } else if ((r.author || "").includes("Northwolf")) {
                            r.tags = r.tags || { tone_tags: [], intent: "", sales_stage: "" };
                        }
                    });
                });

                // Replace threads
                post.threads = newThreads;
                post.tags = existingTags;

                // Update body if we got a cleaner one
                if (fullBody && !(/see more/i.test(fullBody)) && fullBody.length > 50) {
                    post.original_post.body = fullBody;
                }

                // Verify fix
                if (hasSeeMore(post)) {
                    console.log("    ⚠️  Still has 'see more' after re-scrape (may need manual check)");
                } else {
                    console.log("    ✅ Fixed! " + newThreads.length + " threads scraped");
                }

                // Write back into array
                taggedData[entry.index] = post;

            } catch (e) {
                console.log("    ❌ Error: " + e.message);
            }

            // Small delay between posts
            await sleep(1000);
        }
    } finally {
        await browser.close();
    }

    // Save updated data
    fs.writeFileSync(TAGGED_DATA_PATH, JSON.stringify(taggedData, null, 2));

    // Final verification
    var remaining = taggedData.filter(hasSeeMore).length;
    console.log("\n==========================================");
    console.log("✅ RE-SCRAPE COMPLETE");
    console.log("  Posts re-scraped:     " + affectedPosts.length);
    console.log("  Still have see more:  " + remaining);
    console.log("  Total posts:          " + taggedData.length);
    console.log("  Saved to: " + TAGGED_DATA_PATH);
    console.log("==========================================");
}

main().catch(function(e) {
    console.error(e);
    process.exit(1);
});