#!/usr/bin/env node
/**
 * bot/prelabel_dms.js
 *
 * Uses GPT to pre-label all DM entries in finetune_data_v5.jsonl.
 * Scott then loads dm_prelabeled.json into dm_tagger.html and just
 * reviews / corrects instead of labeling 4,810 entries from scratch.
 *
 * Usage:
 *   node prelabel_dms.js <path/to/finetune_data_v5.jsonl> [output.json]
 *
 * The script is RESUMABLE — re-run after interruption and it skips
 * entries that were already labeled in the output file.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// ── CONFIG ─────────────────────────────────────────────────────────────────────
const JSONL_PATH    = process.argv[2] || path.join(__dirname, '../data/finetune_data_v5.jsonl');
const OUTPUT_PATH   = process.argv[3] || path.join(path.dirname(JSONL_PATH), 'dm_prelabeled.json');
const MODEL         = process.env.CLASSIFIER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CONCURRENCY   = parseInt(process.env.CONCURRENCY || '5', 10);  // parallel API calls
const SAVE_EVERY    = 50;  // save to disk every N completions

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
const SYSTEM = `You are a sales DM classifier. Classify Scott's REPLY in a DM conversation.

DM_STAGE — main purpose of Scott's reply (one string, or null):
null=not a sales DM (WhatsApp/personal/casual) | connect=open with specific hook/interest | gather-intel=learn their pain/history/situation | share-authority=personal story, vulnerability, expertise | frame-outcome=probe dream goal, steer toward business | offer-call=invite to diagnostic call | pre-qualify=probe budget $1K-$5K commitment | send-calendly=qualified+committed, send calendar link | nurture-free=not ready/no budget, offer free resources

TONE_TAGS — 1–4 tones present in Scott's reply (array):
hype | brotherhood | motivational | chit-chat | curiosity | empathy | authority | tough-love | mystery-teasing | teasing-future-value | vulnerability | humor | bonding-rapport | self-aggrandization | direct | storytelling | praise | gratitude | casual

INTENT — single primary intent (one string):
engagement-nurture | value-delivery | info-gathering | lead-qualification | authority-proofing | pain-agitation | objection-handling | close-to-call | funneling | social-proof | acknowledgement | community-building | redirect

SALES_STAGE — where the lead is in the funnel (one string):
awareness | engagement | nurture | ask

Return ONLY valid JSON, no markdown fences:
{"nonsales":bool,"dm_stage":"..."or null,"tone_tags":[...],"intent":"...","sales_stage":"..."}`;

// ── PARSE JSONL ────────────────────────────────────────────────────────────────
function parseDMs(filePath) {
    console.log(`Reading ${filePath}…`);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const dms = [];

    for (const line of lines) {
        let d;
        try { d = JSON.parse(line.trim()); } catch (e) { continue; }

        const msgs = d.messages || [];
        if (msgs.length < 3) continue;

        // Skip post/comment entries
        const firstUser = (msgs[1] || {}).content || '';
        if (firstUser.includes('--- POST ---') || firstUser.includes('--- NEW MEMBER ---')) continue;

        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.role !== 'assistant') continue;

        // Extract sender name if present (format: "[Name]: message" or just message)
        // Try to infer lead name from first user message
        const leadName = extractLeadName(msgs);

        // Build context: last 4 turns before Scott's reply
        const histStart = Math.max(1, msgs.length - 5);
        const history = [];
        for (let i = histStart; i < msgs.length - 1; i++) {
            const speaker = msgs[i].role === 'assistant' ? 'Scott' : (leadName || 'Lead');
            const text = (msgs[i].content || '').substring(0, 250);
            history.push(`${speaker}: ${text}`);
        }

        const scottReply = lastMsg.content || '';
        const key = scottReply.substring(0, 80).trim().replace(/\s+/g, ' ');
        if (!key) continue;

        dms.push({
            key,
            leadName: leadName || 'Lead',
            context: history.join('\n'),
            reply: scottReply.substring(0, 400),
        });
    }

    return dms;
}

function extractLeadName(msgs) {
    // Look for a line like "Name: ..." in user messages or system prompt
    for (const m of msgs) {
        if (m.role === 'system') {
            const match = (m.content || '').match(/Conversation with[:\s]+([A-Za-z]+)/i)
                       || (m.content || '').match(/DM from[:\s]+([A-Za-z]+)/i)
                       || (m.content || '').match(/Lead[:\s]+([A-Za-z]+)/i);
            if (match) return match[1];
        }
    }
    return null;
}

// ── CLASSIFY ONE DM ────────────────────────────────────────────────────────────
async function classify(dm) {
    const userContent = dm.context
        ? `[Prior messages]\n${dm.context}\n\n[Scott's reply — classify this]\n${dm.reply}`
        : `[Scott's reply — classify this]\n${dm.reply}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await client.chat.completions.create({
                model:       MODEL,
                messages:    [
                    { role: 'system', content: SYSTEM },
                    { role: 'user',   content: userContent },
                ],
                max_tokens:  150,
                temperature: 0,
            });

            const raw = (res.choices[0]?.message?.content || '').trim()
                .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
            const parsed = JSON.parse(raw);

            // Normalize
            if (typeof parsed.nonsales !== 'boolean') parsed.nonsales = !parsed.dm_stage;
            if (!Array.isArray(parsed.tone_tags))     parsed.tone_tags = [];
            if (!parsed.intent)      parsed.intent      = '';
            if (!parsed.sales_stage) parsed.sales_stage = '';
            parsed.ai_suggested = true;
            parsed.lead_name    = dm.leadName;
            return parsed;

        } catch (err) {
            if (attempt === 3) {
                console.error(`\n  ✗ Failed after 3 attempts: ${err.message}`);
                return null;
            }
            await sleep(1200 * attempt);
        }
    }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
    if (!process.env.OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY not set. Check your .env file.');
        process.exit(1);
    }
    if (!fs.existsSync(JSONL_PATH)) {
        console.error(`File not found: ${JSONL_PATH}`);
        console.error('');
        console.error('Usage:');
        console.error('  node prelabel_dms.js <path/to/finetune_data_v5.jsonl>');
        console.error('');
        console.error('Example:');
        console.error('  node prelabel_dms.js ../data/finetune_data_v5.jsonl');
        process.exit(1);
    }

    console.log('─────────────────────────────────────────');
    console.log('  DM Pre-Labeler');
    console.log('─────────────────────────────────────────');
    console.log(`  Model:  ${MODEL}`);
    console.log(`  Input:  ${JSONL_PATH}`);
    console.log(`  Output: ${OUTPUT_PATH}`);
    console.log('─────────────────────────────────────────\n');

    const dms = parseDMs(JSONL_PATH);
    console.log(`Found ${dms.length} DM entries to label\n`);

    // Load existing progress (for resuming)
    let results = {};
    if (fs.existsSync(OUTPUT_PATH)) {
        try {
            const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
            results = existing.labels || {};
            const already = Object.keys(results).length;
            if (already > 0) {
                console.log(`Resuming — ${already} already labeled, skipping those\n`);
            }
        } catch (e) {
            console.log('Could not read existing output, starting fresh\n');
        }
    }

    const queue       = dms.filter(dm => !results[dm.key]);  // only unlabeled
    const total       = dms.length;
    const startAt     = Date.now();
    const alreadyDone = Object.keys(results).length;
    let   processed   = 0;
    let   failed      = 0;

    console.log(`Labeling ${queue.length} entries  ·  concurrency ${CONCURRENCY}\n`);

    // ── Rolling window for ETA (last 30 completions) ──────────────────────────
    const window = [];   // timestamps of recent completions
    const WINDOW_SIZE = 30;

    function printProgress() {
        const done      = alreadyDone + processed;
        const pct       = Math.round((done / total) * 100);
        const elapsed   = (Date.now() - startAt) / 1000;
        const remaining = total - done;

        // Rolling rate: avg ms per item over last WINDOW_SIZE completions
        let rateStr = '--';
        let etaStr  = '--';
        if (window.length >= 2) {
            const span    = (window[window.length - 1] - window[0]) / 1000;  // seconds
            const rate    = span / (window.length - 1);                       // sec/item
            const etaSec  = Math.round(remaining * rate);
            rateStr = rate < 1 ? `${(1 / rate).toFixed(1)}/s` : `${rate.toFixed(1)}s/item`;
            etaStr  = etaSec < 60   ? `${etaSec}s`
                    : etaSec < 3600 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
                    :                 `${Math.floor(etaSec / 3600)}h ${Math.floor((etaSec % 3600) / 60)}m`;
        }

        const elapsedStr = elapsed < 60   ? `${Math.round(elapsed)}s`
                         : elapsed < 3600 ? `${Math.floor(elapsed / 60)}m ${Math.round(elapsed % 60)}s`
                         :                  `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;

        const failStr = failed > 0 ? `  ·  ${failed} failed` : '';
        process.stdout.write(
            `\r  [${done}/${total}] ${pct}%  ·  ${rateStr}  ·  elapsed ${elapsedStr}  ·  ETA ${etaStr}${failStr}   `
        );
    }

    // ── Worker pool: CONCURRENCY workers pull from queue simultaneously ────────
    const iter = queue[Symbol.iterator]();
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (const dm of iter) {
            const label = await classify(dm);
            if (label) {
                results[dm.key] = label;
                processed++;
                window.push(Date.now());
                if (window.length > WINDOW_SIZE) window.shift();
            } else {
                failed++;
            }

            printProgress();

            if ((processed + failed) % SAVE_EVERY === 0 && (processed + failed) > 0) {
                saveResults(results, total);
            }
        }
    });

    await Promise.all(workers);

    const totalSec  = Math.round((Date.now() - startAt) / 1000);
    const totalTime = totalSec < 60   ? `${totalSec}s`
                    : totalSec < 3600 ? `${Math.floor(totalSec/60)}m ${totalSec%60}s`
                    :                   `${Math.floor(totalSec/3600)}h ${Math.floor((totalSec%3600)/60)}m`;

    saveResults(results, total);

    const avgRate = processed > 0 ? (totalSec / processed).toFixed(2) : '--';
    console.log(`\n\n✓ Done — ${Object.keys(results).length}/${total} labeled in ${totalTime}  ·  avg ${avgRate}s/item${failed > 0 ? `  ·  ${failed} failed` : ''}`);
    console.log(`\n  Output saved to:\n  ${OUTPUT_PATH}`);
    console.log('\n  Next: drop dm_prelabeled.json into dm_tagger.html');
    console.log('        to apply AI suggestions before Scott reviews.\n');
}

function saveResults(results, total) {
    const out = {
        generated_at: new Date().toISOString(),
        model:        MODEL,
        total_dms:    total,
        labeled:      Object.keys(results).length,
        labels:       results,
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
