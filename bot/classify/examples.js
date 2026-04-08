/**
 * classify/examples.js
 *
 * Few-shot examples for the classifier — one per intent type.
 * All taken from real labeled interactions in Scott's communities.
 *
 * To add examples: copy the object shape and paste a new entry.
 * To remove an example: just delete its block.
 */

module.exports = [

    // acknowledgement
    {
        post: { author: "Scott Northwolf", title: "We have our very own website now!", body: "We built our very own website for Answer 42." },
        comment: { author: "Kai Cerar", text: "@Scott Northwolf BROOO LETS FUCKIN GOOOO!!" },
        reply: "@Kai Cerar 🔥",
        tags: { tone_tags: ["brotherhood", "hype"], intent: "acknowledgement", sales_stage: "nurture" },
    },

    // engagement-nurture
    {
        post: { author: "Scott Northwolf", title: "We have our very own website now!", body: "We built our very own website." },
        comment: { author: "Kai Cerar", text: "Damnnn I LOVE IT!!!" },
        reply: "@Axel Lionel we are climbing the mountain, brother.",
        tags: { tone_tags: ["motivational", "brotherhood"], intent: "engagement-nurture", sales_stage: "nurture" },
    },

    // lead-qualification
    {
        post: { author: "Scott Northwolf", title: "We have our very own website now!", body: "We built our very own website. Here's the website, boys: https://answer42.llc/" },
        comment: { author: "Kai Cerar", text: "WOW Looks fire BROO!!!!" },
        reply: "@Kai Cerar thanks, brother. Wait until you see the FIRE content we are recording at our brand new villa... it'll be coming out next week... this shit is growing at the SPEED OF FUCKING LIGHT!",
        tags: { tone_tags: ["hype", "brotherhood", "motivational", "mystery-teasing"], intent: "lead-qualification", sales_stage: "nurture" },
    },

    // value-delivery
    {
        post: { author: "Devon Hoyt", title: "Say hello to the gang", body: "My name is Devon. Life kept handing me losses and I got tired of it." },
        comment: null,
        reply: "@Devon Hoyt epic, Devon! Only when the pain of staying the same outweights the pain of facing the resistance — that's when real transformation begins.",
        tags: { tone_tags: ["empathy", "tough-love", "motivational"], intent: "value-delivery", sales_stage: "nurture" },
    },

    // authority-proofing
    {
        post: { author: "Community Member", title: "Tell me a bit about yourself!", body: "I would love for us to get to know each other a bit more!" },
        comment: null,
        reply: "Northwolf... Scott Northwolf. Understanding things to a very fundamental level has always been my superpower.",
        tags: { tone_tags: ["authority", "self-aggrandization"], intent: "authority-proofing", sales_stage: "nurture" },
    },

    // close-to-call
    {
        post: { author: "Community Member", title: "Brotherhood and connection", body: "My aims are not to meet people randomly and never see them again." },
        comment: { author: "Sajjad Bablu", text: "The things that get me most energized: God and spirituality, real brotherhood, becoming financially free." },
        reply: "@Sajjad Bablu amazing, brother! I love the topics. Let's jump on a call to talk about it.",
        tags: { tone_tags: ["hype", "brotherhood", "teasing-future-value", "authority"], intent: "close-to-call", sales_stage: "ask" },
    },

    // community-building
    {
        post: { author: "Scott Northwolf", title: "Roadmap (START HERE)", body: "The Self-Improvement Roadmap to guide you on how to become a self-improvement coach." },
        comment: { author: "Nick Banik", text: "Great stuff, thanks for putting it together 🔥" },
        reply: "@Nick Banik it's gonna be truly epic, brother. I'm looking forward to it too.",
        tags: { tone_tags: ["hype"], intent: "community-building", sales_stage: "nurture" },
    },

    // funneling
    {
        post: { author: "Community Member", title: "Does anyone know how to become ambitious?", body: "I've realized I'm not obsessed like I used to be." },
        comment: { author: "Brandon Maloney", text: "3 things: 1-Goal setting, 2-drive vacuums, 3-reverse engineering your goal." },
        reply: "@Brandon Maloney the actionable steps are broken down in a lot more detail in my community, you might want to check that out later, bro.",
        tags: { tone_tags: ["casual"], intent: "funneling", sales_stage: "engagement" },
    },

    // info-gathering
    {
        post: { author: "Ognjen", title: "What's up I'm Ognjen", body: "I'm a dude from Serbia trying to make some good money online. I've been on self improvement for 3.5 years." },
        comment: null,
        reply: "Did you get into self-improvement through any specific YouTuber or influencer?",
        tags: { tone_tags: ["curiosity"], intent: "info-gathering", sales_stage: "nurture" },
    },

    // objection-handling
    {
        post: { author: "Scott Northwolf", title: "Biggest constraint in your coaching business", body: "Leave your biggest constraint and I'll give you the solution in 3 lines." },
        comment: { author: "Andrew Brooks", text: "lack of sales calls for my programs" },
        reply: "@Andrew Brooks just by virtue of this response and your solid streak of activity here on Skool, I can see without a shadow of a doubt that you have what it takes.",
        tags: { tone_tags: ["motivational", "hype", "praise"], intent: "objection-handling", sales_stage: "nurture" },
    },

    // social-proof
    {
        post: { author: "Community Member", title: "Best day ever?", body: "Happy Monday! Stepping into the week with some big energy." },
        comment: { author: "Lea Newkirk", text: "Sales calls." },
        reply: "@Lea Newkirk what could be better than offering young men the opportunity to change radically their lives forever?",
        tags: { tone_tags: ["authority", "motivational"], intent: "social-proof", sales_stage: "nurture" },
    },

    // pain-agitation
    {
        post: { author: "Scott Northwolf", title: "How to set goals like a Millionaire", body: "Welcome to the Nature of Aim. This exercise will uncover your drive vacuums." },
        comment: { author: "Rob Nölken", text: "Long read, but worth every word!" },
        reply: "@Rob Nölken thank you, brother. Time for applying it relentlessly.",
        tags: { tone_tags: ["motivational", "brotherhood", "direct"], intent: "pain-agitation", sales_stage: "nurture" },
    },

    // redirect
    {
        post: { author: "Community Member", title: "Basic Leadership Primer", body: "The basic components of a team: a group of individuals, a vision, and a facilitator." },
        comment: null,
        reply: "When you talk about turning individuals into leaders, do you mean creating autonomous cells — like a decentralized organization?",
        tags: { tone_tags: ["authority", "tough-love"], intent: "redirect", sales_stage: "nurture" },
    },

];
