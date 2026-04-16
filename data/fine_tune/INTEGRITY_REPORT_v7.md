# finetune_data_v7.jsonl — Integrity Report
**Date:** 2026-04-16  
**File:** `data/fine_tune/finetune_data_v7.jsonl`  
**Companion:** `data/fine_tune/finetune_data_v7_fixed.jsonl`

---

## TL;DR Verdict

| File | Status |
|------|--------|
| `finetune_data_v7.jsonl` | ⚠️ **ALMOST READY** — 2 issues to fix before upload |
| `finetune_data_v7_fixed.jsonl` | ❌ **DO NOT USE** — the fix script removed the wrong records |

---

## Files at a Glance

| Property | v7 | v7_fixed |
|---|---|---|
| Total lines | 2,646 | 2,318 |
| Valid JSON records | 2,645 | 2,318 |
| JSON errors | **1 (last line truncated)** | 0 |
| File size | 33.8 MB | 30.3 MB |

---

## Critical Issues

### 🔴 ISSUE 1 — Truncated Last Line (L2646)

**What:** Line 2,646 is an incomplete JSON record. The file was cut off mid-write — the line is only 776 chars vs. the average of 12,726 chars (6.1% complete). It ends mid-sentence inside the system prompt and is not parseable JSON.

**Impact:** OpenAI fine-tuning validation will fail or silently drop this line. It will never be used but it will cause your upload validator to report an error.

**Fix:** Delete line 2,646. The preceding 2,645 records are all valid.

```bash
head -n 2645 finetune_data_v7.jsonl > finetune_data_v7_clean.jsonl
```

---

### 🔴 ISSUE 2 — 127 Records Over the OpenAI 16,384 Token Limit

**What:** 127 records exceed OpenAI's per-example token limit. These come from a handful of deeply-scrolled conversations — primarily one user ("Jae Han") whose HISTORY block grows to 1,300+ DM messages across successive training examples, producing records of 130,000+ chars (~32k–35k tokens each).

**Impact:** OpenAI fine-tuning **silently drops** examples over the token limit during validation. You will lose 127 training examples without any obvious error message. The `v7_fixed` file claims to fix things but **kept 114 of these 127 oversized records** while removing 327 small, valid records instead — making it worse.

**Examples of over-limit records:**

| Line | Est. Tokens | DMs in History |
|------|-------------|----------------|
| L2162 | ~34,944 | 1,369 |
| L2158 | ~34,375 | 1,339 |
| L2155 | ~32,664 | 1,294 |
| L2038–2047 | 16k–17k | 200–260 |

**Fix:** Truncate HISTORY blocks to a maximum of ~60–80 messages (most relevant recent context), or filter out examples over the limit:

```python
# Quick filter approach
import json

MAX_CHARS = 50000  # safe proxy for ~12k tokens

with open("finetune_data_v7_clean.jsonl") as fin, \
     open("finetune_data_v7_ready.jsonl", "w") as fout:
    skipped = 0
    for line in fin:
        obj = json.loads(line)
        total_chars = sum(len(m["content"]) for m in obj["messages"])
        if total_chars <= MAX_CHARS:
            fout.write(line)
        else:
            skipped += 1
    print(f"Skipped {skipped} over-limit records")
```

---

## What v7_fixed Actually Did (and Why You Should Ignore It)

`v7_fixed` removed **327 records** from v7. Analysis shows:

- All 327 removed records were **valid, properly-structured DM conversations** with `--- PERSON ---`, `--- HISTORY ---`, and `--- REPLY TO ---` blocks
- **276 of them were under 4k tokens** — not over the limit at all
- The script kept **114 records over 16k tokens** (the real problem) while removing short, clean ones
- `v7_fixed` still contains all 216 outreach records and all the same structural patterns

**Conclusion:** The fix script had broken logic. `v7_fixed` is strictly worse than a properly-filtered `v7`. Ignore it.

---

## Everything That Passed ✅

These checks were run across all 2,645 valid records:

| Check | Result |
|---|---|
| JSON parse errors (non-last-line) | ✅ 0 |
| Root is a dict | ✅ 2,645 / 2,645 |
| Has `messages` array | ✅ 2,645 / 2,645 |
| All messages have `role` and `content` | ✅ 0 errors |
| Valid roles (system/user/assistant only) | ✅ 0 invalid |
| First message is `system` | ✅ 2,645 / 2,645 |
| Last message is `assistant` | ✅ 2,645 / 2,645 |
| Role ordering (system→user→assistant) | ✅ 0 violations |
| All records are exactly 3 messages | ✅ 2,645 / 2,645 |
| `SITUATION:` tag in system prompt | ✅ 2,645 / 2,645 |
| Consistent system prompt body | ✅ 1 unique variant |
| Exact duplicate records | ✅ 0 |
| Null bytes in content | ✅ 0 |
| Raw HTML artifacts | ✅ 0 |
| Extra unexpected keys | ✅ 0 |
| Empty/whitespace content fields | ✅ 0 |

---

## Findings That Are Intentional (Not Bugs)

### 216 Records Without `--- REPLY TO ---`

These are **intentional proactive outreach formats**, not broken records:

- **172 records** — Pure outreach: just `--- PERSON ---` block, no history. The model generates the *first* message to a new lead. Example: `L4: "Hey, Joyce, welcome to Self-Improvement Nation!"`
- **44 records** — Proactive follow-up: `--- PERSON ---` + `--- HISTORY ---` but no reply trigger. Scott is reaching out unprompted (e.g. community call reminders, check-ins).

These are valid training examples teaching the model when and how to initiate. Keep them.

### 369 Records With Markdown URLs in Assistant Output

The pattern `[text](https://url)` or `[https://url](https://url)` in assistant messages comes from how Skool renders links in DMs when scraped. Scott actually sends links this way — calendly bookings (92 occurrences), Skool post links (187), YouTube/Google Meet/etc (112). This is Scott's real behavior. Not a bug.

### 16 Single-Emoji Assistant Replies

Records where the assistant replies with just `🔥`, `😂`, `👌`, `❗`. Scott does this. Valid training signal.

---

## Token Distribution (All 2,645 Records)

| Bucket | Count |
|---|---|
| Under 4k tokens | ~2,218 (83.9%) |
| 4k – 8k tokens | ~199 (7.5%) |
| 8k – 16k tokens | ~101 (3.8%) |
| Over 16k (OVER LIMIT) | **127 (4.8%)** |

After filtering the 127 over-limit records: **2,518 clean records** ready for fine-tuning.

---

## Recommended Action Plan

1. **Delete the truncated last line:**
   ```bash
   head -n 2645 finetune_data_v7.jsonl > finetune_data_v7_clean.jsonl
   ```

2. **Filter over-limit records** (or better: fix the generation script to cap HISTORY blocks at ~60 messages):
   ```bash
   python3 filter_tokens.py  # see script above
   # Result: ~2,518 clean records
   ```

3. **Do not use `v7_fixed`** — it removed the wrong records.

4. **Run OpenAI's own validator before upload:**
   ```bash
   openai tools fine_tunes.prepare_data -f finetune_data_v7_ready.jsonl
   ```

---

## Summary

`finetune_data_v7.jsonl` is structurally sound. Schema is perfect, roles are correct, system prompts are consistent, zero duplicates, zero corruption in the first 2,645 lines. The only two things blocking a clean upload are: (1) the truncated last line which is trivial to fix, and (2) the 127 over-token-limit records caused by unbounded HISTORY accumulation across long conversations — these need to be filtered or the generation script needs to cap history length.
