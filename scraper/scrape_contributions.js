const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ─────────────────────────────────────────────────────────
// Scrape all of Scott's contributions to Synthesizer
// by visiting his profile contributions page, collecting
// every post URL, then extracting full threaded data.
// Output format matches posts_with_scott_reply_threads.json
// ─────────────────────────────────────────────────────────

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    contributionsUrl: "https://www.skool.com/@scott-northwolf-3818?g=synthesizer",
    targetMember: "Scott Northwolf",
    outputFile: "scott_synthesizer_posts.json",
    headless: true,
    outputDir: "./output",
    parallel: 6,
};

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function ensureOutputDir() {
    if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

function saveJSON(filename, data) {
    var fp = path.join(CONFIG.outputDir, filename);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    console.log("  💾 Saved " + data.length + " posts to " + fp);
}

function formatTime(ms) {
    var secs = Math.floor(ms / 1000);
    var mins = Math.floor(secs / 60);
    secs = secs % 60;
    if (mins > 0) return mins + "m " + secs + "s";
    return secs + "s";
}

async function login(page) {
    console.log("🔐 Logging in...");
    await page.goto("https://www.skool.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
    await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
    await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/^(?!.*login)/, { timeout: 15000 });
    console.log("✅ Logged in\n");
}

// ─────────────────────────────────────────────────────────
// Phase 1: Collect all post URLs from the contributions page
// ─────────────────────────────────────────────────────────
async function collectContributionUrls(page) {
    console.log("📋 Phase 1: Collecting post URLs from contributions page...");
    console.log("  → " + CONFIG.contributionsUrl + "\n");

    // The contributions page uses PAGINATION. The URL pattern is ?p=1, ?p=2, etc.
    // We navigate directly to each page via URL — much faster & more reliable than clicking.
    var allUrlSet = {};
    var pageNum = 1;
    var maxPages = 50; // safety cap

    // Helper to extract post URLs from current page DOM
    function extractUrls() {
        return page.evaluate(function() {
            var links = document.querySelectorAll('a');
            var urlSet = {};
            for (var i = 0; i < links.length; i++) {
                var href = links[i].href;
                if (!href) continue;
                if (href.includes('/synthesizer/') &&
                    !href.includes('/@') &&
                    !href.includes('?c=') &&
                    !href.includes('?p=') &&
                    !href.includes('#') &&
                    href.split('/').length >= 5) {
                    var clean = href.split('?')[0].split('#')[0].replace(/\/+$/, '');
                    urlSet[clean] = true;
                }
            }
            return Object.keys(urlSet);
        });
    }

    // Helper to check if a "Next" link exists (not disabled)
    function hasNextPage() {
        return page.evaluate(function() {
            var allEls = document.querySelectorAll('a, button, span[role="button"]');
            for (var i = 0; i < allEls.length; i++) {
                var txt = allEls[i].textContent.trim();
                if (/^Next\s*[›>]?$/.test(txt) || txt === '›') {
                    var cls = (allEls[i].className || '').toString();
                    var parentCls = allEls[i].parentElement ? (allEls[i].parentElement.className || '').toString() : '';
                    if (/disabled|inactive/i.test(cls) || /disabled|inactive/i.test(parentCls)) return false;
                    if (allEls[i].getAttribute('aria-disabled') === 'true') return false;
                    return true;
                }
            }
            return false;
        });
    }

    while (pageNum <= maxPages) {
        var pageUrl = CONFIG.contributionsUrl + (pageNum === 1 ? '' : '&p=' + pageNum);
        // If the base URL already has no query param, use ?p= instead of &p=
        if (!CONFIG.contributionsUrl.includes('?')) {
            pageUrl = CONFIG.contributionsUrl + (pageNum === 1 ? '' : '?p=' + pageNum);
        }

        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        // Wait for contribution items to appear
        await page.waitForSelector('a[href*="/synthesizer/"]', { timeout: 10000 }).catch(function() {});
        await sleep(500);

        var pageUrls = await extractUrls();

        var newCount = 0;
        for (var i = 0; i < pageUrls.length; i++) {
            if (!allUrlSet[pageUrls[i]]) {
                allUrlSet[pageUrls[i]] = true;
                newCount++;
            }
        }
        var totalSoFar = Object.keys(allUrlSet).length;
        console.log("  Page " + pageNum + ": found " + pageUrls.length + " links (" + newCount + " new) — " + totalSoFar + " total");

        // Stop if no new URLs found on this page OR no Next button exists
        if (newCount === 0 || !(await hasNextPage())) {
            console.log("  ✅ No more pages\n");
            break;
        }

        pageNum++;
    }

    var postUrls = Object.keys(allUrlSet);
    console.log("✅ Found " + postUrls.length + " unique post URLs across " + pageNum + " pages\n");
    return postUrls;
}

// ─────────────────────────────────────────────────────────
// Phase 2: Extract full post + threaded comments from a URL
// ─────────────────────────────────────────────────────────
async function extractPost(page, postUrl, targetName) {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(500);

    // Scroll to load all comments (fast passes)
    for (var i = 0; i < 6; i++) {
        await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
        await sleep(300);
    }

    // Expand collapsed reply threads (multiple rounds)
    for (var attempt = 0; attempt < 5; attempt++) {
        var clicked = await page.evaluate(function() {
            var count = 0;
            var expandBtns = document.querySelectorAll(
                '[class*="ViewRepl"], [class*="viewRepl"], [class*="ShowRepl"], [class*="showRepl"], ' +
                '[class*="ExpandRepl"], [class*="expandRepl"]'
            );
            expandBtns.forEach(function(el) {
                try {
                    el.click();
                    count++;
                } catch (e) {}
            });
            if (count === 0) {
                var allEls = document.querySelectorAll(
                    'button, a, span[role="button"], div[role="button"], ' +
                    '[class*="Repl"] span, [class*="repl"] span'
                );
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
        await sleep(400);
    }

    // Expand "See more" buttons
    for (var seeMoreAttempt = 0; seeMoreAttempt < 5; seeMoreAttempt++) {
        var expandedCount = await page.evaluate(function() {
            var count = 0;
            var allClickable = document.querySelectorAll("button, a, span, div[role=button]");
            for (var i = 0; i < allClickable.length; i++) {
                var txt = allClickable[i].textContent.trim();
                if (txt.length > 30) continue;
                if (/^see\s*more$/i.test(txt) || /^\.\.\.\s*see\s*more$/i.test(txt) ||
                    /^read\s*more$/i.test(txt) || /^show\s*more$/i.test(txt)) {
                    try {
                        allClickable[i].click();
                        count++;
                    } catch (e) {}
                }
            }
            var classTargets = document.querySelectorAll(
                '[class*="SeeMore"], [class*="ReadMore"], [class*="ShowMore"], [class*="Truncat"]'
            );
            classTargets.forEach(function(el) {
                if (el.textContent.trim().length < 30) {
                    try {
                        el.click();
                        count++;
                    } catch (e) {}
                }
            });
            return count;
        });
        if (expandedCount === 0) break;
        await sleep(300);
    }

    // One final scroll
    await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(200);

    // Extract post metadata + threaded comments
    return await page.evaluate(function(targetName) {
        // --- Post metadata ---
        var postData = { author: "Unknown", title: "", body: "", category: "", timestamp: "", url: window.location.href };

        // Title: usually in the post header area
        var titleEl = document.querySelector('[class*="PostTitle"], h1, [class*="PostItemCardTitle"]');
        if (titleEl) postData.title = titleEl.textContent.trim();

        // Author: first profile link
        var authorLinks = document.querySelectorAll('[class*="PostItemHeader"] a[href*="/@"], [class*="PostAuthor"] a[href*="/@"]');
        if (authorLinks.length === 0) {
            // Broader fallback: first profile link on the page that's not in comments
            var allProfileLinks = document.querySelectorAll('a[href*="/@"]');
            for (var al = 0; al < allProfileLinks.length; al++) {
                var linkText = allProfileLinks[al].textContent.trim();
                if (linkText && !/^\d+$/.test(linkText) && !linkText.startsWith("@") && linkText.length < 60) {
                    postData.author = linkText;
                    break;
                }
            }
        } else {
            postData.author = authorLinks[0].textContent.trim();
        }

        // Category
        var catEl = document.querySelector('[class*="GroupFeedLinkLabel"], [class*="PostCategory"]');
        if (catEl) postData.category = catEl.textContent.trim();

        // Timestamp
        var timeEl = document.querySelector('[class*="PostTimeContent"], [class*="PostTime"], time');
        if (timeEl) postData.timestamp = timeEl.textContent.trim();

        // Body: main post content
        var bodyEl = document.querySelector('[class*="PostItemCardContent"], [class*="PostBody"], [class*="PostContent"]');
        if (bodyEl) {
            postData.body = bodyEl.innerText.trim();
        } else {
            // Aggressive fallback: grab article or main content
            var mainContent = document.querySelector('article, [class*="PostDetail"], [class*="PostWrapper"]');
            if (mainContent) postData.body = mainContent.innerText.trim().substring(0, 3000);
        }

        // --- Threaded comments ---
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
            var text = bubble.innerText.trim();
            var author = getAuthor(bubble);
            var idx = text.indexOf(author);
            if (idx !== -1) text = text.substring(idx + author.length).trim();
            text = text.replace(/^[^\w@]*[·•]\s*\d+[hmd]\s*/i, "").trim();
            text = text.replace(/^[^\w@]*[·•]\s*\w+\s+\d+\s*/i, "").trim();
            text = text.replace(/^[^\w@]*[·•]\s*\w+\s+'\d+\s*/i, "").trim();
            text = text.replace(/\n?\s*To pick up a draggable item[\s\S]*?press escape to cancel\.\s*/gm, '');
            text = text.replace(/\s*Drop files here to upload[\s\S]*$/m, '');
            text = text.replace(/\s*Recently UsedSmileys & People[\s\S]*$/m, '');
            text = text.replace(/\d*\s*Reply\s*$/, '');
            return text.trim();
        }

        function isTarget(author) { return author.trim() === targetName; }

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

        return { post: postData, threads: conversations };
    }, targetName);
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
async function main() {
    var totalStart = Date.now();
    console.log("🚀 SCOTT CONTRIBUTIONS SCRAPER");
    console.log("═".repeat(50));
    console.log("Target:  " + CONFIG.targetMember);
    console.log("Source:  " + CONFIG.contributionsUrl);
    console.log("Parallel tabs: " + CONFIG.parallel);
    console.log("═".repeat(50) + "\n");

    if (!CONFIG.email || !CONFIG.password) {
        console.error("❌ Set SKOOL_EMAIL and SKOOL_PASSWORD in .env");
        process.exit(1);
    }
    ensureOutputDir();

    var browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 0 });
    var context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    var mainPage = await context.newPage();

    try {
        await login(mainPage);

        // Phase 1: collect all post URLs from contributions page
        var postUrls = await collectContributionUrls(mainPage);

        if (postUrls.length === 0) {
            console.log("❌ No post URLs found — check if the contributions page loaded correctly");
            await mainPage.screenshot({ path: path.join(CONFIG.outputDir, "contributions_empty.png") });
            return;
        }

        // Phase 2: extract full post + threads for each URL
        console.log("💬 Phase 2: Scraping " + postUrls.length + " posts (" + CONFIG.parallel + " parallel)...\n");

        var allPosts = [];
        var totalBatches = Math.ceil(postUrls.length / CONFIG.parallel);
        var phase2Start = Date.now();
        var batchTimes = [];

        for (var batch = 0; batch < postUrls.length; batch += CONFIG.parallel) {
            var batchStart = Date.now();
            var batchNum = Math.floor(batch / CONFIG.parallel) + 1;
            var batchEnd = Math.min(batch + CONFIG.parallel, postUrls.length);
            var batchUrls = postUrls.slice(batch, batchEnd);

            var elapsed = Date.now() - phase2Start;
            var eta = "calculating...";
            if (batchTimes.length > 0) {
                var avgBatchTime = batchTimes.reduce(function(a, b) { return a + b; }, 0) / batchTimes.length;
                var remainingBatches = totalBatches - batchNum + 1;
                eta = formatTime(avgBatchTime * remainingBatches);
            }

            var slugs = batchUrls.map(function(u) {
                var parts = u.split('/');
                return (parts[parts.length - 1] || '?').substring(0, 25);
            }).join(" | ");
            console.log("  Batch " + batchNum + "/" + totalBatches + "  [" + formatTime(elapsed) + " elapsed | ETA: " + eta + "]");
            console.log("    → " + slugs);

            var promises = batchUrls.map(async function(url) {
                var pg = await context.newPage();
                try {
                    var result = await extractPost(pg, url, CONFIG.targetMember);
                    return result;
                } catch (e) {
                    console.log("    ⚠️  Failed: " + url.split('/').pop() + " — " + e.message);
                    // Retry once
                    try {
                        var result2 = await extractPost(pg, url, CONFIG.targetMember);
                        return result2;
                    } catch (e2) {
                        return null;
                    }
                } finally {
                    await pg.close();
                }
            });

            var results = await Promise.all(promises);

            var batchThreads = 0;
            var batchScott = 0;
            results.forEach(function(r) {
                if (!r) return;
                var scottInvolved = false;
                r.threads.forEach(function(t) {
                    if (t.comment.isTargetMember) scottInvolved = true;
                    t.replies.forEach(function(rep) { if (rep.isTargetMember) scottInvolved = true; });
                });

                allPosts.push({
                    id: String(allPosts.length + 1).padStart(3, "0"),
                    original_post: r.post,
                    threads: r.threads,
                    scott_involved: scottInvolved,
                });

                batchThreads += r.threads.length;
                if (scottInvolved) batchScott++;
            });

            var batchTime = Date.now() - batchStart;
            batchTimes.push(batchTime);
            console.log("    ✓ " + formatTime(batchTime) + " — " + batchThreads + " threads, " + batchScott + " with Scott");

            // Save progress after each batch
            saveJSON(CONFIG.outputFile, allPosts);
        }

        var totalTime = Date.now() - totalStart;
        var scottCount = allPosts.filter(function(p) { return p.scott_involved; }).length;

        console.log("\n" + "═".repeat(50));
        console.log("🎉 DONE in " + formatTime(totalTime));
        console.log("");
        console.log("  Posts scraped:     " + allPosts.length);
        console.log("  Scott involved:    " + scottCount);
        console.log("  Total threads:     " + allPosts.reduce(function(n, p) { return n + p.threads.length; }, 0));
        console.log("  Output:            " + path.join(CONFIG.outputDir, CONFIG.outputFile));
        console.log("═".repeat(50));

    } catch (e) {
        console.error("\n❌ Fatal error: " + e.message);
        await mainPage.screenshot({ path: path.join(CONFIG.outputDir, "error_contributions.png") });
    } finally {
        await browser.close();
    }
}

main();