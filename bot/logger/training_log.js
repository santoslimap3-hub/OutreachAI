/**
 * logger/training_log.js
 *
 * Per-run training data logger.
 * Every time the bot starts, it creates TWO new files:
 *
 *   data/logs/post_comment_log_YYYY-MM-DD_run001.json
 *   data/logs/dm_log_YYYY-MM-DD_run001.json
 *
 * The run number increments automatically — run002, run003, etc.
 * Files are never overwritten. Each run is self-contained.
 * Feedback is stored separately via the tagger in data/logs_feedback/.
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

// ─────────────────────────────────────────────────────────────────────────────
// Determine run number at module load time (once per bot start)
// ─────────────────────────────────────────────────────────────────────────────

function ensureLogsDir() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

function todayString() {
    var d = new Date();
    var yyyy = d.getFullYear();
    var mm   = String(d.getMonth() + 1).padStart(2, '0');
    var dd   = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
}

/**
 * Count existing files for today with the given prefix, then return
 * the next run number (1-based, zero-padded to 3 digits).
 *
 * e.g. if post_comment_log_2026-04-13_run001.json already exists,
 * returns "002".
 */
function nextRunNumber(prefix, dateStr) {
    ensureLogsDir();
    var existing = fs.readdirSync(LOGS_DIR).filter(function(f) {
        return f.startsWith(prefix + '_' + dateStr + '_run') && f.endsWith('.json');
    });
    return String(existing.length + 1).padStart(3, '0');
}

var TODAY      = todayString();
var RUN_NUMBER = nextRunNumber('post_comment_log', TODAY); // same number for both files

var POST_LOG_FILE = path.join(LOGS_DIR, 'post_comment_log_' + TODAY + '_run' + RUN_NUMBER + '.json');
var DM_LOG_FILE   = path.join(LOGS_DIR, 'dm_log_' + TODAY + '_run' + RUN_NUMBER + '.json');

console.log('📁 Training logs for this run:');
console.log('   ' + path.basename(POST_LOG_FILE));
console.log('   ' + path.basename(DM_LOG_FILE));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read an existing log file and return the parsed array.
 * Returns [] if the file doesn't exist or is unreadable.
 */
function readLogFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            var raw = fs.readFileSync(filePath, 'utf8').trim();
            if (raw.length === 0) return [];
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('⚠️  training_log: could not read ' + path.basename(filePath) + ' — ' + e.message);
    }
    return [];
}

/**
 * Atomically append one entry to a log file.
 * Reads the existing array, pushes the new entry, then writes to a .tmp
 * file and renames — so Ctrl+C can never corrupt the JSON.
 */
function atomicAppend(filePath, entry) {
    ensureLogsDir();
    var entries = readLogFile(filePath);
    entries.push(entry);
    var tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

function nowISO() {
    return new Date().toISOString();
}

function makeId(prefix, name) {
    return prefix + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '_' +
        (name || 'unknown').replace(/\s+/g, '_').substring(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append one post or comment reply to this run's post_comment_log file.
 */
function appendPostEntry(data) {
    var authorKey = data.type === 'post'
        ? (data.post && data.post.author ? data.post.author : 'unknown')
        : (data.comment && data.comment.author ? data.comment.author : 'unknown');

    var entry = {
        id:        makeId(data.type || 'post', authorKey),
        timestamp: nowISO(),
        type:      data.type || 'post',
        community: data.community || '',

        post: {
            author: (data.post && data.post.author) || '',
            title:  (data.post && data.post.title)  || '',
            body:   (data.post && data.post.body)   || '',
            url:    null,
        },

        comment: data.comment ? {
            author: data.comment.author || '',
            text:   data.comment.text   || '',
            thread: data.comment.thread || [],
        } : null,

        classifier: {
            systemPrompt: data.classifierSystemPrompt || '',
            userMessage:  data.classifierUserMessage  || '',
            tags: {
                tone_tags:   (data.tags && data.tags.tone_tags)   || [],
                intent:      (data.tags && data.tags.intent)      || '',
                sales_stage: (data.tags && data.tags.sales_stage) || '',
                reasoning:   (data.tags && data.tags.reasoning)   || '',
            },
        },

        generation: {
            systemPrompt: data.generationSystemPrompt || '',
            userMessage:  data.generationUserMessage  || '',
            model:        data.model  || '',
            reply:        data.reply  || '',
        },

        sent:     true,
        feedback: '',
    };

    try {
        atomicAppend(POST_LOG_FILE, entry);
        console.log('  📚 Training log → ' + path.basename(POST_LOG_FILE) + ' (' + entry.type + ' by ' + authorKey + ')');
    } catch (e) {
        console.warn('⚠️  training_log: failed to append post entry — ' + e.message);
    }
}

/**
 * Append one DM reply to this run's dm_log file.
 */
function appendDMEntry(data) {
    var entry = {
        id:        makeId('dm', data.partner),
        timestamp: nowISO(),
        partner:   data.partner || '',

        conversation: (data.conversation || []).map(function(m) {
            return { role: m.role || 'unknown', author: m.author || '', text: m.text || '' };
        }),

        classifier: {
            systemPrompt: data.classifierSystemPrompt || '',
            userMessage:  data.classifierUserMessage  || '',
            tags: {
                dm_stage:    (data.tags && data.tags.dm_stage)    != null ? data.tags.dm_stage : null,
                tone_tags:   (data.tags && data.tags.tone_tags)   || [],
                intent:      (data.tags && data.tags.intent)      || '',
                sales_stage: (data.tags && data.tags.sales_stage) || '',
                reasoning:   (data.tags && data.tags.reasoning)   || '',
            },
        },

        generation: {
            systemPrompt: data.generationSystemPrompt || '',
            userMessage:  data.generationUserMessage  || '',
            model:        data.model  || '',
            reply:        data.reply  || '',
        },

        sent:     data.sent != null ? data.sent : true,
        feedback: '',
    };

    try {
        atomicAppend(DM_LOG_FILE, entry);
        console.log('  📚 Training log → ' + path.basename(DM_LOG_FILE) + ' (DM with ' + entry.partner + ')');
    } catch (e) {
        console.warn('⚠️  training_log: failed to append DM entry — ' + e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { appendPostEntry: appendPostEntry, appendDMEntry: appendDMEntry };
