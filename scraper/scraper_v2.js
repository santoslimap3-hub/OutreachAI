/**
 * Skool Scraper v2 — Scott-only, full pagination, absolute timestamps, canonical slugs.
 *
 * WHAT CHANGED vs scraper.js (v1):
 *   1. SCOTT-ONLY FILTERING ON THE INDEX PAGE.
 *      Before opening a post's full thread we check the feed card for any
 *      Scott indicator (Scott authored the post, or his slug appears in the
 *      commenter avatars on the card). Posts without Scott involvement are
 *      skipped entirely — no wasted navigation, no wasted thread expansion.
 *      For posts that DO pass the filter we still verify on the post page.
 *
 *   2. CANONICAL SLUG IDS.
 *      Every author (post, comment, reply) is captured as
 *      { slug, displayName } where slug comes from the /@<slug> link.
 *      Display names change; slugs do not. This becomes the person key
 *      for cross-channel stream unification downstream.
 *
 *   3. ABSOLUTE TIMESTAMPS.
 *      For every post and every comment/reply we try in order:
 *        a. <time datetime="...">   — ISO 8601, most reliable
 *        b. title / aria-label      — tooltip of the "2d" relative string
 *        c. data-tooltip / data-hover
 *      If none resolve we record the raw string plus scrapedAt so the
 *      downstream resolver can still compute an absolute datetime.
 *
 *   4. STABLE COMMENT IDs.
 *      Comment permalinks (href containing "?comment=<id>" or "?c=<id>")
 *      give us a stable ID. If missing we fall back to
 *      sha1(postUrl + authorSlug + content).
 *
 *   5. FULL COMMUNITY PAGINATION.
 *      The old 20-page cap is gone. We walk until the "Next" button is
 *      disabled / missing. Safety cap is configurable (default 500).
 *
 *   6. TWO-PHASE OUTPUT.
 *      Phase 1 writes posts_index.json (feed-level, Scott-involved only).
 *      Phase 2 writes posts_scott_v2.json (full threads + timestamps +
 *      slugs + ids). Phase 1 is resumable — if it exists we skip re-scrape
 *      of the feed unless --refresh-index is passed.
 *
 * ENV (.env):
 *   SKOOL_EMAIL                  required
 *   SKOOL_PASSWORD               required
 *   SKOOL_COMMUNITY_URL          required (e.g. https://www.skool.com/synthesizer)
 *   TARGET_MEMBER                "Scott Northwolf" display name
 *   TARGET_MEMBER_SLUG           "scott-northwolf" — his /@slug, REQUIRED for reliable filter
 *   OUTPUT_FILE                  default "posts_scott_v2.json"
 *   MAX_PAGES                    default 500
 *   PARALLEL_TABS                default 3
 *   HEADLESS                     "true"/"false" — default true
 *
 * RUN:
 *   node scraper_v2.js                        // full scrape (walks community feed)
 *   node scraper_v2.js --refresh-index        // force re-fetch of feed index
 *   node scraper_v2.js --dry                  // list which posts would be scraped then exit
 *   node scraper_v2.js --contributions        // Phase 1 via Scott's profile page instead of feed
 *                                             // USE THIS for Synthesizer — feed cards don't expose
 *                                             // commenter slugs, so the feed walk misses 99% of Scott's posts.
 *                                             // Requires CONTRIBUTIONS_URL in .env (e.g. https://www.skool.com/@scott-northwolf-3818?g=synthesizer)
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const SCRAPER_VERSION = "v2.0.0";

const CONFIG = {
    email: process.env.SKOOL_EMAIL,
    password: process.env.SKOOL_PASSWORD,
    communityUrl: process.env.SKOOL_COMMUNITY_URL || "https://www.skool.com/self-improvement-nation-3104",
    targetDisplay: process.env.TARGET_MEMBER || "Scott Northwolf",
    targetSlug: (process.env.TARGET_MEMBER_SLUG || "scott-northwolf").toLowerCase(),
    outputFile: process.env.OUTPUT_FILE || "posts_scott_v2.json",
    indexFile: "posts_index_v2.json",
    outputDir: "./output",
    headless: (process.env.HEADLESS || "true") === "true",
    parallel: parseInt(process.env.PARALLEL_TABS || "3", 10),
    maxPages: parseInt(process.env.MAX_PAGES || "500", 10),
    pageNavTimeoutMs: 30000,
    commentExpandRounds: 6,
    // Contributions URL: Scott's profile filtered to a specific community.
    // Example: https://www.skool.com/@scott-northwolf-3818?g=synthesizer
    contributionsUrl: process.env.CONTRIBUTIONS_URL || null,
};

const CLI_FLAGS = {
    refreshIndex: process.argv.includes("--refresh-index"),
    dry: process.argv.includes("--dry"),
    contributions: process.argv.includes("--contributions"),
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureOutputDir() {
    if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

function saveJSON(filename, data) {
    const fp = path.join(CONFIG.outputDir, filename);
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function readJSONIfExists(filename) {
    const fp = path.join(CONFIG.outputDir, filename);
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch (_) { return null; }
}

function formatTime(ms) {
    var secs = Math.floor(ms / 1000);
    var mins = Math.floor(secs / 60);
    secs = secs % 60;
    if (mins > 0) return mins + "m " + secs + "s";
    return secs + "s";
}

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex").substring(0, 16); }

// ─── LOGIN ──────────────────────────────────────────────────────────────────

async function login(page) {
    console.log("🔐 Logging in as " + CONFIG.email + "...");
    await page.goto("https://www.skool.com/login", { waitUntil: "domcontentloaded", timeout: CONFIG.pageNavTimeoutMs });
    await sleep(1000);
    await page.fill('input[name="email"], input[type="email"]', CONFIG.email);
    await page.fill('input[name="password"], input[type="password"]', CONFIG.password);
    await page.click('button[type="submit"]');
    await sleep(3500);
    if (page.url().includes("login")) throw new Error("Login failed — check SKOOL_EMAIL / SKOOL_PASSWORD");
    console.log("✅ Logged in");
}

// ─── PHASE 1: COLLECT POST INDEX, SCOTT-ONLY ────────────────────────────────

/**
 * Walks every page of the community feed. For each feed card we check
 * whether Scott is involved by looking at:
 *   - post author slug (if Scott authored it)
 *   - commenter avatar links ("Last commented by" section sometimes
 *     contains /@<slug> links on the card itself)
 *   - presence of his display name anywhere on the card
 *
 * Posts that DON'T pass the filter are dropped immediately. This avoids
 * the phase-2 cost for thousands of irrelevant threads.
 *
 * NOTE: Skool feed cards don't always show full commenter lists. We treat
 * the card-level filter as a FAST prefilter — phase 2 will re-verify by
 * scanning the full thread, and non-Scott posts that leaked through are
 * dropped then.
 */
async function collectScottPostIndex(page) {
    console.log("\n📋 Phase 1: Collecting Scott-involved post index...");
    var phase1Start = Date.now();
    var allPosts = [];
    var allSkipped = 0;
    var pageNum = 1;

    await page.goto(CONFIG.communityUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.pageNavTimeoutMs });
    await sleep(2500);

    while (true) {
        var pageData = null;
        for (var retries = 0; retries < 3; retries++) {
            try {
                await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
                await sleep(1500);
                pageData = await page.evaluate(function(args) {
                    var targetSlug = args.targetSlug;
                    var targetDisplay = args.targetDisplay;
                    var base = window.location.origin + "/" + window.location.pathname.split("/")[1];

                    function extractAuthorAndSlug(el) {
                        var links = Array.from(el.querySelectorAll('a[href*="/@"]'));
                        for (var i = 0; i < links.length; i++) {
                            var href = links[i].getAttribute("href") || "";
                            var m = href.match(/\/@([a-zA-Z0-9_-]+)/);
                            if (!m) continue;
                            var text = (links[i].textContent || "").trim();
                            // First such link that has a readable display name (not a numeric badge)
                            if (/^\d+$/.test(text) || text.startsWith("@") || text === "") continue;
                            return { slug: m[1].toLowerCase(), display: text };
                        }
                        // Fallback: any /@ link even if display is empty
                        if (links.length > 0) {
                            var m2 = (links[0].getAttribute("href") || "").match(/\/@([a-zA-Z0-9_-]+)/);
                            if (m2) return { slug: m2[1].toLowerCase(), display: (links[0].textContent || "").trim() };
                        }
                        return { slug: "", display: "" };
                    }

                    function extractTimestamp(el) {
                        var t = el.querySelector("time[datetime]");
                        if (t && t.getAttribute("datetime")) return { absolute: t.getAttribute("datetime"), raw: t.textContent.trim() };
                        var timeEl = el.querySelector('[class*="PostTimeContent"]');
                        if (timeEl) {
                            var title = timeEl.getAttribute("title") || timeEl.getAttribute("aria-label") || "";
                            return { absolute: title || null, raw: timeEl.textContent.trim() };
                        }
                        return { absolute: null, raw: "" };
                    }

                    function allSlugsInCard(el) {
                        var set = new Set();
                        var links = el.querySelectorAll('a[href*="/@"]');
                        for (var i = 0; i < links.length; i++) {
                            var m = (links[i].getAttribute("href") || "").match(/\/@([a-zA-Z0-9_-]+)/);
                            if (m) set.add(m[1].toLowerCase());
                        }
                        return Array.from(set);
                    }

                    var wrappers = document.querySelectorAll('[class*="PostItemWrapper"]');
                    var cards = [];
                    var skipped = 0;

                    wrappers.forEach(function(el) {
                        var author = extractAuthorAndSlug(el);
                        var ts = extractTimestamp(el);
                        var slugs = allSlugsInCard(el);
                        var txt = (el.textContent || "");

                        // Scott prefilter: slug match, author match, or display-name text
                        var scottInvolved =
                            slugs.indexOf(targetSlug) !== -1 ||
                            (author.slug && author.slug === targetSlug) ||
                            (targetDisplay && txt.indexOf(targetDisplay) !== -1);

                        if (!scottInvolved) { skipped++; return; }

                        var links = Array.from(el.querySelectorAll("a")).map(function(a) { return { href: a.href, text: a.textContent.trim() }; });
                        var postLink = links.find(function(l) {
                            return l.href && l.href.startsWith(base + "/") && !l.href.includes("/@") &&
                                !l.href.includes("?c=") && !l.href.includes("?p=") &&
                                l.href.split("/").length > 4;
                        });

                        var categoryEl = el.querySelector('[class*="GroupFeedLinkLabel"]');
                        var contentEl = el.querySelector('[class*="PostItemCardContent"]');

                        cards.push({
                            postUrl: postLink ? postLink.href : null,
                            title: postLink ? postLink.text : "",
                            authorSlug: author.slug,
                            authorDisplay: author.display,
                            category: categoryEl ? categoryEl.textContent.trim() : "",
                            timestampRaw: ts.raw,
                            timestampAbsolute: ts.absolute,
                            bodySnippet: contentEl ? contentEl.textContent.trim() : "",
                            commenterSlugs: slugs,
                        });
                    });
                    return { cards: cards, skipped: skipped };
                }, { targetSlug: CONFIG.targetSlug, targetDisplay: CONFIG.targetDisplay });
                break;
            } catch (e) {
                console.log("  Page " + pageNum + " attempt " + (retries + 1) + " failed: " + e.message);
                await sleep(2500);
                if (retries === 2) console.log("  Skipping page " + pageNum + " after 3 failures");
            }
        }

        var count = pageData ? pageData.cards.length : 0;
        var skipCt = pageData ? pageData.skipped : 0;
        allSkipped += skipCt;

        if (pageData && pageData.cards) {
            allPosts = allPosts.concat(pageData.cards);
            console.log("  Page " + pageNum + ": " + count + " Scott-involved kept, " + skipCt + " skipped");
        }

        // If THIS page had zero cards at all (kept + skipped) we're past the end.
        if (pageData && (pageData.cards.length + pageData.skipped) === 0) {
            console.log("  Page " + pageNum + " empty, end of feed");
            break;
        }

        var wentNext = false;
        try {
            wentNext = await page.evaluate(function() {
                var btns = document.querySelectorAll("button, a");
                for (var i = 0; i < btns.length; i++) {
                    var txt = (btns[i].textContent || "").trim();
                    if (txt === ">" || txt === "Next" || txt === "›") {
                        if (!btns[i].disabled && !btns[i].getAttribute("aria-disabled")) {
                            btns[i].click();
                            return true;
                        }
                    }
                }
                return false;
            });
        } catch (e) {
            console.log("  Pagination click failed: " + e.message);
            break;
        }
        if (!wentNext) { console.log("  No Next button — end of pagination"); break; }

        try { await page.waitForLoadState("domcontentloaded", { timeout: 12000 }); } catch (_) {}
        await sleep(1800);
        pageNum++;
        if (pageNum > CONFIG.maxPages) { console.log("  Hit MAX_PAGES=" + CONFIG.maxPages); break; }
    }

    // Dedup by postUrl (feed pagination can occasionally repeat)
    var seen = new Set();
    var deduped = allPosts.filter(function(p) {
        if (!p.postUrl || seen.has(p.postUrl)) return false;
        seen.add(p.postUrl);
        return true;
    });

    var phase1Time = Date.now() - phase1Start;
    console.log("✅ Phase 1 done in " + formatTime(phase1Time));
    console.log("   Scott-involved posts: " + deduped.length);
    console.log("   Skipped (no Scott):   " + allSkipped);
    console.log("   Pages walked:         " + (pageNum));
    return deduped;
}

// ─── PHASE 2: FULL THREAD EXTRACTION W/ TIMESTAMPS AND SLUGS ────────────────

/**
 * Runs inside the browser. For a single post page, walks every comment
 * bubble and pulls:
 *   - authorSlug (from /@slug link, lowercased)
 *   - authorDisplay (text of that link)
 *   - content (visible innerText, stripped of UI noise)
 *   - absolute timestamp (time[datetime] → title → aria-label)
 *   - comment id (?comment=<id>, ?c=<id>, fallback: content hash)
 *   - parent id (reply-of, if nested)
 *
 * Returns full post metadata + threads[]. Does NOT filter to Scott — that
 * happens in the Node-side caller so we can also drop leaked feed cards.
 */
async function extractFullThread(page, postUrl, indexCard) {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.pageNavTimeoutMs });
    await sleep(1800);

    // Lazy-load: scroll to bottom several times
    for (var s = 0; s < 5; s++) {
        await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
        await sleep(500);
    }

    // Expand all "View N replies" and "See more" buttons in rounds
    for (var round = 0; round < CONFIG.commentExpandRounds; round++) {
        var didExpand = await page.evaluate(function() {
            var count = 0;
            var classBtns = document.querySelectorAll(
                '[class*="ViewRepl"], [class*="viewRepl"], [class*="ShowRepl"], [class*="showRepl"], ' +
                '[class*="ExpandRepl"], [class*="expandRepl"], [class*="view-repl"], [class*="show-repl"], ' +
                '[class*="SeeMore"], [class*="see-more"], [class*="seeMore"], [class*="ReadMore"], ' +
                '[class*="readMore"], [class*="ShowMore"], [class*="showMore"], [class*="Truncat"], [class*="truncat"]'
            );
            classBtns.forEach(function(b) {
                try {
                    b.click();
                    count++;
                } catch (_) {}
            });

            var allClickable = document.querySelectorAll('button, a, span[role="button"], div[role="button"]');
            for (var i = 0; i < allClickable.length; i++) {
                var txt = (allClickable[i].textContent || "").trim();
                if (txt.length > 40) continue;
                if (/^see\s*more$/i.test(txt) || /^\.\.\.\s*see\s*more$/i.test(txt) ||
                    /^read\s*more$/i.test(txt) || /^show\s*more$/i.test(txt) ||
                    /\d+\s*repl/i.test(txt) || /view.*repl/i.test(txt) || /show.*repl/i.test(txt)) {
                    try {
                        allClickable[i].click();
                        count++;
                    } catch (_) {}
                }
            }
            return count;
        });
        if (!didExpand) break;
        await sleep(700);
    }

    await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(500);

    return await page.evaluate(function(ctx) {
        var targetSlug = ctx.targetSlug;
        var targetName = ctx.targetDisplay;
        var postUrl = ctx.postUrl;
        var nowIso = new Date().toISOString();

        // ─ helpers ─
        function slugFromHref(href) {
            var m = (href || "").match(/\/@([a-zA-Z0-9_-]+)/);
            return m ? m[1].toLowerCase() : "";
        }

        function getAuthor(bubble) {
            var links = Array.from(bubble.querySelectorAll('a[href*="/@"]'));
            for (var i = 0; i < links.length; i++) {
                var href = links[i].getAttribute("href") || "";
                var slug = slugFromHref(href);
                if (!slug) continue;
                var text = (links[i].textContent || "").trim();
                if (/^\d+$/.test(text) || text.startsWith("@") || text === "") continue;
                return { slug: slug, display: text };
            }
            if (links.length > 0) {
                return { slug: slugFromHref(links[0].getAttribute("href")), display: (links[0].textContent || "").trim() };
            }
            return { slug: "", display: "Unknown" };
        }

        function getTimestamp(bubble) {
            // 1. <time datetime="..."> — ideal, rarely populated by Skool
            var t = bubble.querySelector("time[datetime]");
            if (t && t.getAttribute("datetime")) return { absolute: t.getAttribute("datetime"), raw: t.textContent.trim() };

            // 2. title / aria-label with a full datetime ("Fri, Feb 7, 2025 3:14 PM")
            var cands = bubble.querySelectorAll("[title], [aria-label]");
            for (var i = 0; i < cands.length; i++) {
                var attr = cands[i].getAttribute("title") || cands[i].getAttribute("aria-label") || "";
                if (/\d{4}/.test(attr) && /(AM|PM|:)/.test(attr)) return { absolute: attr, raw: attr };
            }

            // 3. Dedicated time/date class element (strip leading dot/bullet)
            var timeEl = bubble.querySelector(
                '[class*="Time"], [class*="time"], [class*="Timestamp"], [class*="timestamp"], ' +
                '[class*="PostedAt"], [class*="postedAt"], [class*="Date"], [class*="date"], ' +
                '[class*="CreatedAt"], [class*="createdAt"], [class*="Age"], [class*="age"]'
            );
            if (timeEl) {
                var raw3 = (timeEl.textContent || "").trim().replace(/^[·•\s]+/, "").trim();
                if (raw3 && raw3.length < 30) return { absolute: null, raw: raw3 };
            }

            // 4. READ the first line of the bubble's visible text and extract the
            //    part after the middle-dot separator.
            //    Skool renders: "AuthorName · Mar '25" or "AuthorName · 44 mins" etc.
            //    This is the primary path since Skool uses this format everywhere.
            var firstLine = ((bubble.innerText || bubble.textContent || "").split("\n")[0] || "").trim();
            // Look for · or • followed by the timestamp
            var dotMatch = firstLine.match(/[·•]\s*(.{1,30})$/);
            if (dotMatch) {
                var candidate = dotMatch[1].trim();
                // Validate it looks like a time expression (not random trailing text)
                var looksLikeTime =
                    /^\d+\s*(min|mins|m|h|hr|hrs|d|day|days|w|wk|wks)$/i.test(candidate) ||  // "44 mins", "2h", "3d", "2w"
                    /^[A-Za-z]{3}\s+'?\d{2,4}$/i.test(candidate) ||                           // "Mar '25", "Jan 2025"
                    /^[A-Za-z]{3}\s+\d{1,2}$/i.test(candidate) ||                             // "Feb 12"
                    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(candidate) ||                         // "3/15/25"
                    /^\d{4}-\d{2}-\d{2}/.test(candidate);                                     // ISO
                if (looksLikeTime) return { absolute: null, raw: candidate };
            }

            return { absolute: null, raw: "" };
        }

        function getCommentId(bubble) {
            // Look for a permalink anchor inside the bubble
            var links = bubble.querySelectorAll('a[href]');
            for (var i = 0; i < links.length; i++) {
                var href = links[i].getAttribute("href") || "";
                var m = href.match(/[?&](?:comment|c)=([a-zA-Z0-9_-]+)/);
                if (m) return m[1];
            }
            // data-id fallbacks
            if (bubble.getAttribute("data-id")) return bubble.getAttribute("data-id");
            if (bubble.getAttribute("data-comment-id")) return bubble.getAttribute("data-comment-id");
            return null;
        }

        function cleanContent(bubble, authorDisplay) {
            var text = (bubble.innerText || "").trim();
            if (authorDisplay) {
                var idx = text.indexOf(authorDisplay);
                if (idx !== -1) text = text.substring(idx + authorDisplay.length).trim();
            }
            text = text.replace(/^[^\w@]*[·•]\s*\d+[hmd]\s*/i, "").trim();
            text = text.replace(/^[^\w@]*[·•]\s*\w+\s+\d+\s*/i, "").trim();
            text = text.replace(/\n?\s*To pick up a draggable item[\s\S]*?press escape to cancel\.\s*/gm, "");
            text = text.replace(/\s*Drop files here to upload[\s\S]*$/m, "");
            text = text.replace(/\s*Recently UsedSmileys & People[\s\S]*$/m, "");
            text = text.replace(/\d*\s*Reply\s*$/, "");
            return text.trim();
        }

        var replyClassPattern = /Reply|reply|Replies|replies|Nested|nested|Child|child/;

        function isReplyBubble(bubble) {
            var el = bubble.parentElement;
            for (var i = 0; i < 10; i++) {
                if (!el) break;
                if (replyClassPattern.test(el.className || "")) return true;
                el = el.parentElement;
            }
            return false;
        }

        function findReplies(topBubble, seen) {
            var replies = [];
            var node = topBubble;
            for (var i = 0; i < 10; i++) {
                if (!node || !node.parentElement) break;
                node = node.parentElement;
                var sib = node.nextElementSibling;
                while (sib) {
                    if (replyClassPattern.test(sib.className || "")) {
                        var rbs = sib.querySelectorAll('[class*="CommentItemBubble"]');
                        rbs.forEach(function(rb) {
                            var auth = getAuthor(rb);
                            if (!auth.slug) return;
                            var content = cleanContent(rb, auth.display);
                            var ts = getTimestamp(rb);
                            var cid = getCommentId(rb);
                            var dedupKey = cid || (auth.slug + "|" + content.substring(0, 80));
                            if (seen.has(dedupKey)) return;
                            seen.add(dedupKey);
                            replies.push({
                                id: cid,
                                authorSlug: auth.slug,
                                authorDisplay: auth.display,
                                content: content,
                                timestampAbsolute: ts.absolute,
                                timestampRaw: ts.raw,
                                isTarget: auth.slug === targetSlug || auth.display === targetName,
                            });
                        });
                        if (replies.length > 0) return replies;
                    }
                    sib = sib.nextElementSibling;
                }
            }
            return replies;
        }

        // ─ post metadata ─
        var titleEl = document.querySelector('h1, [class*="PostTitle"], [class*="postTitle"]');
        var postTitle = titleEl ? titleEl.textContent.trim() : "";

        var bodyEl = document.querySelector('[class*="PostContent"], [class*="postContent"], [class*="PostBody"]');
        var postBody = "";
        if (bodyEl) {
            // Walk paragraph children to skip comments section and UI noise
            var ps = bodyEl.querySelectorAll("p, div, span");
            var collected = [];
            for (var i = 0; i < ps.length && i < 50; i++) {
                var cls = (ps[i].className || "").toString();
                if (/emoji|picker|draggable|tooltip|avatar|badge|comment|reply|reaction/i.test(cls)) continue;
                var inside = ps[i].closest('[class*="CommentsSection"], [class*="CommentsList"], [class*="CommentsListWrapper"]');
                if (inside) continue;
                var t = (ps[i].innerText || "").trim();
                if (!t || t === "Like" || t === "Reply" || /^draggable/i.test(t)) continue;
                collected.push(t);
            }
            postBody = collected.join("\n").trim();
            if (!postBody) postBody = (bodyEl.innerText || "").trim();
        }

        // Post timestamp — same multi-strategy approach as comment getTimestamp.
        // On the post page Skool shows "AuthorName · Mar '25" in the post header.
        var postTs = { absolute: null, raw: "" };
        // a) <time datetime>
        var postTimeEl = document.querySelector(
            '[class*="PostHeader"] time[datetime], [class*="postHeader"] time[datetime], ' +
            'header time[datetime], [class*="PostMeta"] time[datetime], time[datetime]'
        );
        if (postTimeEl && postTimeEl.getAttribute("datetime")) {
            postTs = { absolute: postTimeEl.getAttribute("datetime"), raw: postTimeEl.textContent.trim() };
        }
        // b) dedicated time element
        if (!postTs.raw) {
            var ptEl = document.querySelector(
                '[class*="PostTime"], [class*="postTime"], [class*="PostHeader"] [class*="Time"], ' +
                '[class*="PostMeta"] [class*="Time"], [class*="PostHeader"] [class*="Age"]'
            );
            if (ptEl) {
                postTs.raw = (ptEl.textContent || "").trim().replace(/^[·•\s]+/, "").trim();
                postTs.absolute = ptEl.getAttribute("title") || ptEl.getAttribute("datetime") || null;
            }
        }
        // c) · pattern from the post header area text
        if (!postTs.raw) {
            var headerArea = document.querySelector(
                '[class*="PostHeader"], [class*="postHeader"], [class*="PostMeta"], header'
            );
            if (headerArea) {
                var hLine = ((headerArea.innerText || "").split("\n")[0] || "").trim();
                var hDot = hLine.match(/[·•]\s*(.{1,30})$/);
                if (hDot) {
                    var hCand = hDot[1].trim();
                    var hLooks =
                        /^\d+\s*(min|mins|m|h|hr|hrs|d|day|days|w|wk|wks)$/i.test(hCand) ||
                        /^[A-Za-z]{3}\s+'?\d{2,4}$/i.test(hCand) ||
                        /^[A-Za-z]{3}\s+\d{1,2}$/i.test(hCand);
                    if (hLooks) postTs.raw = hCand;
                }
            }
        }

        // Post author — look in the header
        var postAuthor = { slug: "", display: "Unknown" };
        var headerLinks = document.querySelectorAll('header a[href*="/@"], [class*="PostHeader"] a[href*="/@"], [class*="postHeader"] a[href*="/@"]');
        if (!headerLinks.length) headerLinks = document.querySelectorAll('a[href*="/@"]');
        for (var i = 0; i < headerLinks.length; i++) {
            var href = headerLinks[i].getAttribute("href") || "";
            var slug = slugFromHref(href);
            if (!slug) continue;
            var text = (headerLinks[i].textContent || "").trim();
            if (/^\d+$/.test(text) || text.startsWith("@") || text === "") continue;
            postAuthor = { slug: slug, display: text };
            break;
        }

        // ─ threads ─
        var allBubbles = document.querySelectorAll('[class*="CommentItemBubble"]');
        var seen = new Set();
        var threads = [];
        allBubbles.forEach(function(bubble) {
            if (isReplyBubble(bubble)) return;
            var auth = getAuthor(bubble);
            if (!auth.slug) return;
            var content = cleanContent(bubble, auth.display);
            var ts = getTimestamp(bubble);
            var cid = getCommentId(bubble);
            var key = cid || (auth.slug + "|" + content.substring(0, 80));
            if (seen.has(key)) return;
            seen.add(key);
            threads.push({
                comment: {
                    id: cid,
                    authorSlug: auth.slug,
                    authorDisplay: auth.display,
                    content: content,
                    timestampAbsolute: ts.absolute,
                    timestampRaw: ts.raw,
                    isTarget: auth.slug === targetSlug || auth.display === targetName,
                },
                replies: findReplies(bubble, seen),
            });
        });

        return {
            post: {
                url: postUrl,
                title: postTitle,
                body: postBody,
                authorSlug: postAuthor.slug,
                authorDisplay: postAuthor.display,
                timestampAbsolute: postTs.absolute,
                timestampRaw: postTs.raw,
                isTargetAuthor: postAuthor.slug === targetSlug || postAuthor.display === targetName,
                scrapedAt: nowIso,
            },
            threads: threads,
        };
    }, { targetSlug: CONFIG.targetSlug, targetDisplay: CONFIG.targetDisplay, postUrl: postUrl });
}

// ─── TIMESTAMP RESOLUTION (Node.js side) ─────────────────────────────────────
//
// The browser-side getTimestamp() returns {raw, absolute}. `absolute` is set
// only when a machine-readable attribute existed. For the common case — where
// Skool shows "Mar '25", "44 mins", "3d" etc. — we resolve `raw` here using
// scrapedAt as the reference point, then write the result back to absolute.
//
// This is done in Node.js (not browser) so we get accurate Date math from
// a single consistent clock.
//
var MONTHS_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function resolveRawTimestamp(raw, scrapedAtIso) {
    if (!raw) return null;
    raw = raw.trim();

    // Already an ISO string
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
        var d0 = new Date(raw);
        if (!isNaN(d0.getTime())) return d0.toISOString();
    }

    var base = new Date(scrapedAtIso);

    // "44 mins" / "44 min" / "44m"  (minutes ago)
    var mM = raw.match(/^(\d+)\s*(?:min|mins|m)$/i);
    if (mM) return new Date(base.getTime() - parseInt(mM[1]) * 60000).toISOString();

    // "2h" / "2 hrs" / "2 hours"
    var hM = raw.match(/^(\d+)\s*h(?:rs?|ours?)?$/i);
    if (hM) return new Date(base.getTime() - parseInt(hM[1]) * 3600000).toISOString();

    // "3d" / "3 days"
    var dM = raw.match(/^(\d+)\s*d(?:ays?)?$/i);
    if (dM) return new Date(base.getTime() - parseInt(dM[1]) * 86400000).toISOString();

    // "2w" / "2 weeks"
    var wM = raw.match(/^(\d+)\s*w(?:ks?|eeks?)?$/i);
    if (wM) return new Date(base.getTime() - parseInt(wM[1]) * 7 * 86400000).toISOString();

    // "Mar '25" / "Jan '26"  → first of that month
    var myM = raw.match(/^([A-Za-z]{3})\s+'(\d{2})$/);
    if (myM) {
        var mon = MONTHS_MAP[(myM[1] || "").toLowerCase()];
        if (mon !== undefined) {
            var yr = 2000 + parseInt(myM[2], 10);
            return new Date(Date.UTC(yr, mon, 1)).toISOString();
        }
    }

    // "Feb 12" / "Mar 5"  → infer year (never in the future vs scrapedAt)
    var mdM = raw.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
    if (mdM) {
        var mon2 = MONTHS_MAP[(mdM[1] || "").toLowerCase()];
        if (mon2 !== undefined) {
            var day2 = parseInt(mdM[2], 10);
            var yr2  = base.getUTCFullYear();
            var cand = new Date(Date.UTC(yr2, mon2, day2));
            // If candidate is more than 1 day in the future, use prior year
            if (cand.getTime() > base.getTime() + 86400000) cand = new Date(Date.UTC(yr2 - 1, mon2, day2));
            return cand.toISOString();
        }
    }

    // Last resort — let Date parse it
    var d2 = new Date(raw);
    if (!isNaN(d2.getTime()) && d2.getFullYear() > 2000 && d2.getFullYear() < 2100) return d2.toISOString();

    return null; // unparseable — stream builder uses derived fallback
}

/**
 * Walk all comments/replies in a post result and fill in timestampAbsolute
 * from timestampRaw wherever the browser returned null for absolute.
 * Also resolves the post-level timestamp.
 */
function postProcessTimestamps(postData) {
    var scrAt = postData.post.scrapedAt || new Date().toISOString();
    var resolved = 0, failed = 0;

    function resolve(obj) {
        if (obj.timestampAbsolute) return; // already have it
        var iso = resolveRawTimestamp(obj.timestampRaw || obj.timestampRaw, scrAt);
        if (iso) { obj.timestampAbsolute = iso; resolved++; }
        else      { failed++; }
    }

    resolve(postData.post);
    postData.threads.forEach(function(th) {
        resolve(th.comment);
        th.replies.forEach(function(r) { resolve(r); });
    });
    return { resolved: resolved, failed: failed };
}

// Attach stable IDs for comments that lacked a permalink
function backfillIds(postData) {
    function mkId(postUrl, authorSlug, content) {
        return "h_" + sha1(postUrl + "|" + (authorSlug || "") + "|" + (content || ""));
    }
    postData.threads.forEach(function(th) {
        if (!th.comment.id) th.comment.id = mkId(postData.post.url, th.comment.authorSlug, th.comment.content);
        th.replies.forEach(function(r) {
            if (!r.id) r.id = mkId(postData.post.url, r.authorSlug, r.content);
            r.parentId = th.comment.id;
        });
    });
}

// ─── CONTRIBUTIONS-PAGE PHASE 1 (alternative to feed walk) ──────────────────

/**
 * Instead of walking the community feed (which only exposes post authors, not
 * commenters), navigate directly to Scott's Skool profile filtered to the
 * target community. This page lists every post he engaged with — whether he
 * authored it or commented on it.
 *
 * Requires CONTRIBUTIONS_URL in .env, e.g.:
 *   CONTRIBUTIONS_URL=https://www.skool.com/@scott-northwolf-3818?g=synthesizer
 *
 * Returns an array of index cards compatible with the Phase-2 schema.
 */
async function collectFromContributionsPage(page) {
    var url = CONFIG.contributionsUrl;
    if (!url) {
        throw new Error("--contributions requires CONTRIBUTIONS_URL in .env (e.g. https://www.skool.com/@scott-northwolf-3818?g=synthesizer)");
    }

    console.log("\n📋 Phase 1 (contributions mode): Collecting post URLs from profile page...");
    console.log("   " + url + "\n");

    var allUrlSet = {};
    var pageNum = 1;
    var maxPages = 100;
    var communitySlug = CONFIG.communityUrl.replace(/\/$/, "").split("/").pop(); // e.g. "synthesizer"

    while (pageNum <= maxPages) {
        var separator = url.includes("?") ? "&" : "?";
        var pageUrl = pageNum === 1 ? url : url + separator + "p=" + pageNum;

        try {
            await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.pageNavTimeoutMs });
            await sleep(1200);
        } catch (e) {
            console.log("  Page " + pageNum + " nav failed: " + e.message);
            break;
        }

        var pageUrls = await page.evaluate(function(communitySlug) {
            var links = document.querySelectorAll("a[href]");
            var found = {};
            for (var i = 0; i < links.length; i++) {
                var href = links[i].href || "";
                if (!href) continue;
                // Must be a post URL for this community (contains /community-slug/ but not profile links)
                if (href.includes("/" + communitySlug + "/") &&
                    !href.includes("/@") &&
                    !href.includes("?c=") &&
                    !href.includes("?p=") &&
                    !href.includes("#") &&
                    href.split("/").length >= 5) {
                    var clean = href.split("?")[0].split("#")[0].replace(/\/+$/, "");
                    found[clean] = true;
                }
            }
            return Object.keys(found);
        }, communitySlug);

        var newCount = 0;
        for (var i = 0; i < pageUrls.length; i++) {
            if (!allUrlSet[pageUrls[i]]) {
                allUrlSet[pageUrls[i]] = true;
                newCount++;
            }
        }
        console.log("  Page " + pageNum + ": " + pageUrls.length + " links (" + newCount + " new) — " + Object.keys(allUrlSet).length + " total");

        // Check for next page button
        var hasNext = await page.evaluate(function() {
            var els = document.querySelectorAll("a, button, span[role='button']");
            for (var i = 0; i < els.length; i++) {
                var txt = (els[i].textContent || "").trim();
                if (/^Next\s*[›>]?$/.test(txt) || txt === "›") {
                    if (els[i].disabled) return false;
                    if ((els[i].getAttribute("aria-disabled") || "") === "true") return false;
                    return true;
                }
            }
            return false;
        });

        if (newCount === 0 || !hasNext) { console.log("  ✅ No more pages\n"); break; }
        pageNum++;
    }

    var postUrls = Object.keys(allUrlSet);
    console.log("✅ Phase 1 done — " + postUrls.length + " unique post URLs found");

    // Convert to index card format expected by Phase 2
    return postUrls.map(function(u) {
        return {
            postUrl: u,
            title: "",
            authorSlug: "",
            authorDisplay: "",
            category: "",
            timestampRaw: "",
            timestampAbsolute: null,
            bodySnippet: "",
            commenterSlugs: [],
        };
    });
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
    var start = Date.now();
    console.log("🚀 Skool scraper " + SCRAPER_VERSION);
    console.log("   Community:  " + CONFIG.communityUrl);
    console.log("   Target:     " + CONFIG.targetDisplay + " (slug @" + CONFIG.targetSlug + ")");
    console.log("   Headless:   " + CONFIG.headless);
    console.log("   Parallel:   " + CONFIG.parallel);
    console.log("");

    if (!CONFIG.email || !CONFIG.password) {
        console.error("Missing SKOOL_EMAIL / SKOOL_PASSWORD in .env");
        process.exit(1);
    }
    if (!CONFIG.targetSlug) {
        console.error("Missing TARGET_MEMBER_SLUG in .env (e.g. scott-northwolf)");
        process.exit(1);
    }
    ensureOutputDir();

    var browser = await chromium.launch({ headless: CONFIG.headless, slowMo: 0 });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    var mainPage = await context.newPage();

    try {
        await login(mainPage);

        // Phase 1: index
        var index;
        var existingIndex = readJSONIfExists(CONFIG.indexFile);
        if (existingIndex && !CLI_FLAGS.refreshIndex && !CLI_FLAGS.contributions) {
            index = existingIndex.posts;
            console.log("📦 Using cached index (" + index.length + " posts). Pass --refresh-index to re-fetch.");
        } else if (CLI_FLAGS.contributions) {
            index = await collectFromContributionsPage(mainPage);
            saveJSON(CONFIG.indexFile, {
                metadata: {
                    scraperVersion: SCRAPER_VERSION,
                    community: CONFIG.communityUrl,
                    targetSlug: CONFIG.targetSlug,
                    targetDisplay: CONFIG.targetDisplay,
                    scrapedAt: new Date().toISOString(),
                    count: index.length,
                    mode: "contributions",
                },
                posts: index,
            });
        } else {
            index = await collectScottPostIndex(mainPage);
            saveJSON(CONFIG.indexFile, {
                metadata: {
                    scraperVersion: SCRAPER_VERSION,
                    community: CONFIG.communityUrl,
                    targetSlug: CONFIG.targetSlug,
                    targetDisplay: CONFIG.targetDisplay,
                    scrapedAt: new Date().toISOString(),
                    count: index.length,
                    mode: "feed",
                },
                posts: index,
            });
        }

        if (CLI_FLAGS.dry) {
            console.log("\n--dry: " + index.length + " posts would be scraped. Exiting.");
            await browser.close();
            return;
        }

        // Phase 2: full threads
        var dataset = {
            metadata: {
                scraperVersion: SCRAPER_VERSION,
                community: CONFIG.communityUrl,
                targetSlug: CONFIG.targetSlug,
                targetDisplay: CONFIG.targetDisplay,
                scrapedAt: new Date().toISOString(),
                totalPosts: index.length,
                postsKept: 0,
                postsDroppedNoScott: 0,
                totalThreads: 0,
                totalScottMessages: 0,
            },
            posts: [],
        };

        console.log("\n💬 Phase 2: Extracting full threads (parallel=" + CONFIG.parallel + ") ...");
        var totalBatches = Math.ceil(index.length / CONFIG.parallel);
        var phase2Start = Date.now();

        for (var b = 0; b < index.length; b += CONFIG.parallel) {
            var batchStart = Date.now();
            var batchNum = Math.floor(b / CONFIG.parallel) + 1;
            var batchPosts = index.slice(b, Math.min(b + CONFIG.parallel, index.length));

            console.log("  Batch " + batchNum + "/" + totalBatches + "  [" + formatTime(Date.now() - phase2Start) + " elapsed]");

            var promises = batchPosts.map(async function(card) {
                if (!card.postUrl) return null;
                var pg = await context.newPage();
                var result = null;
                try {
                    result = await extractFullThread(pg, card.postUrl, card);
                } catch (e) {
                    try { result = await extractFullThread(pg, card.postUrl, card); } catch (e2) {
                        console.log("    ⚠ giving up on " + card.postUrl + ": " + e2.message);
                    }
                }
                await pg.close();
                if (!result) return null;
                // Resolve raw timestamps ("Mar '25", "44 mins", "3d" etc.) to ISO
                var tsStats = postProcessTimestamps(result);
                if (tsStats.resolved > 0) process.stdout.write("  ⏱ " + tsStats.resolved + " timestamps resolved");
                backfillIds(result);

                // verify Scott is actually involved (leak-through defense)
                var scottMessages = 0;
                if (result.post.isTargetAuthor) scottMessages++;
                result.threads.forEach(function(t) {
                    if (t.comment.isTarget) scottMessages++;
                    t.replies.forEach(function(r) { if (r.isTarget) scottMessages++; });
                });
                return { card: card, result: result, scottMessages: scottMessages };
            });

            var results = await Promise.all(promises);
            results.forEach(function(r) {
                if (!r) return;
                if (r.scottMessages === 0) {
                    dataset.metadata.postsDroppedNoScott++;
                    return;
                }
                r.result.post.indexCard = { category: r.card.category, bodySnippet: r.card.bodySnippet };
                dataset.posts.push(r.result);
                dataset.metadata.postsKept++;
                dataset.metadata.totalThreads += r.result.threads.length;
                dataset.metadata.totalScottMessages += r.scottMessages;
            });

            console.log("    ✓ batch " + batchNum + " done in " + formatTime(Date.now() - batchStart) +
                " — running totals: " + dataset.metadata.postsKept + " kept, " +
                dataset.metadata.postsDroppedNoScott + " dropped");
            saveJSON(CONFIG.outputFile, dataset);
        }

        console.log("\n=================================");
        console.log("🎉 Done in " + formatTime(Date.now() - start));
        console.log("  Index candidates:    " + index.length);
        console.log("  Kept (Scott):        " + dataset.metadata.postsKept);
        console.log("  Dropped (leak):      " + dataset.metadata.postsDroppedNoScott);
        console.log("  Threads:             " + dataset.metadata.totalThreads);
        console.log("  Scott messages:      " + dataset.metadata.totalScottMessages);
        console.log("  Output:              " + path.join(CONFIG.outputDir, CONFIG.outputFile));
        console.log("=================================");

    } catch (e) {
        console.error("Fatal: " + e.stack || e.message);
        try { await mainPage.screenshot({ path: path.join(CONFIG.outputDir, "error.png") }); } catch (_) {}
    } finally {
        await browser.close();
    }
}

main();
