require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const maxChars = 500;

function normalizeUrl(input) {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function clipText(text = "", max = 4000) {
  const cleaned = String(text).trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trim();
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function getTagContent(html, regex) {
  const match = html.match(regex);
  return match?.[1]?.trim() || "";
}

function extractLinks(html = "", baseUrl = "") {
  const links = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = (match[1] || "").trim();
    const rawText = stripHtml(match[2] || "").trim();

    if (!rawHref) continue;
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      rawHref.startsWith("javascript:")
    ) {
      continue;
    }

    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }

    links.push({
      text: rawText,
      href: absoluteUrl,
    });
  }

  return links;
}

function scoreFounderLink(link) {
  const text = (link.text || "").toLowerCase();
  const href = (link.href || "").toLowerCase();
  let score = 0;

  if (/about us|about|our story|story|mission|founder|who we are|why we started/.test(text)) {
    score += 8;
  }

  if (/\/about|\/about-us|\/our-story|\/story|\/mission|\/founder/.test(href)) {
    score += 6;
  }

  if (/\/pages\//.test(href)) {
    score += 1;
  }

  if (
    /furoshiki|videos|video|start here|new to matcha|faq|collection|collections|shop|product|products|blog|guide|how to/i.test(
      text
    )
  ) {
    score -= 8;
  }

  if (
    /furoshiki|videos|video|start-here|new-to-matcha|faq|collection|collections|shop|product|products|blog|guide|how-to/i.test(
      href
    )
  ) {
    score -= 8;
  }

  if (/contact|cart|login|account/.test(text)) {
    score -= 4;
  }

  if (/contact|cart|login|account/.test(href)) {
    score -= 4;
  }

  return score;
}

function pickFounderLinks(links = []) {
  const deduped = [];
  const seen = new Set();

  for (const link of links) {
    const key = `${link.href}|${(link.text || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(link);
    }
  }

  return deduped
    .map((link) => ({ ...link, score: scoreFounderLink(link) }))
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function extractWebsiteData(html, url) {
  const title =
    getTagContent(html, /<title>([\s\S]*?)<\/title>/i) ||
    getTagContent(
      html,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    ) ||
    "";

  const metaDescription =
    getTagContent(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    getTagContent(
      html,
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    ) ||
    "";

  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean);

  const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean);

  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((text) => text && text.length > 60);

  return {
    url,
    title,
    metaDescription,
    h1: h1Matches[0] || "",
    headings: [...h1Matches, ...h2Matches].slice(0, 12),
    paragraphs: pMatches,
  };
}

async function fetchPageData(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 YEVIB/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url} (${res.status})`);
    }

    const html = await res.text();
    const extracted = extractWebsiteData(html, url);

    return {
      ...extracted,
      rawHtml: html,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function joinUrl(base, slug) {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanSlug = slug.replace(/^\/+/, "");
  return `${cleanBase}/${cleanSlug}`;
}

function qualityParagraphs(paragraphs = []) {
  return paragraphs
    .filter((p) => p.length >= 100)
    .filter(
      (p) =>
        !/add to cart|buy now|shop now|free shipping|sale|subscribe|checkout|review summary|exclusive access|new releases|promotions|instant alerts|order status|tracking at a glance|get exclusive access/i.test(
          p
        )
    );
}

function cleanBlock(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function dedupeBlocks(blocks = []) {
  const seen = new Set();
  const result = [];

  for (const block of blocks) {
    const normalized = String(block).toLowerCase().slice(0, 120);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(block);
    }
  }

  return result;
}

function scoreFounderBlock(text = "") {
  const lower = text.toLowerCase();
  let score = 0;

  if (text.length >= 120) score += 1;

  if (
    /we started|i started|our story|our mission|we believe|our vision|our goal|founded|founder|why we|we wanted|inspired by/i.test(
      lower
    )
  ) {
    score += 8;
  }

  if (/\bwe\b|\bour\b/.test(lower)) score += 1;

  if (
    /i bought|i tried|my husband|highly recommend|worth the price|shipping|5 stars|review/i.test(
      lower
    )
  ) {
    score -= 10;
  }

  if (
    /exclusive access|new releases|promotions|instant alerts|order status|tracking at a glance|subscribe/i.test(
      lower
    )
  ) {
    score -= 10;
  }

  if (
    /ceremonial grade|organic|ingredients|blend|sourced from|product|powder|grams|flavour|how matcha is made|what is organic matcha|culinary matcha/i.test(
      lower
    )
  ) {
    score -= 4;
  }

  return score;
}

function scoreCustomerBlock(text = "") {
  const lower = text.toLowerCase();
  let score = 0;

  if (text.length >= 100) score += 1;

  if (
    /i bought|i tried|my experience|i noticed|since using|highly recommend|worth the price|my husband|sleep improved|better than|addicted/i.test(
      lower
    )
  ) {
    score += 4;
  }

  if (
    /our mission|we started|we believe|our story|founder|our goal|our vision/i.test(
      lower
    )
  ) {
    score -= 4;
  }

  return score;
}

function scoreProductBlock(text = "") {
  const lower = text.toLowerCase();
  let score = 0;

  if (text.length >= 80) score += 1;

  if (
    /ceremonial grade|organic|sourced from|uji|japan|blend|ingredients|product|powder|tea|matcha|origin|quality|flavour/i.test(
      lower
    )
  ) {
    score += 4;
  }

  if (
    /i bought|highly recommend|my husband|worth the price|review|5 stars/i.test(
      lower
    )
  ) {
    score -= 3;
  }

  if (/our mission|we started|our story|founder|we believe/i.test(lower)) {
    score -= 1;
  }

  return score;
}

function classifyBlock(text = "") {
  const cleaned = cleanBlock(text);
  if (!cleaned || cleaned.length < 80) return null;

  const founderScore = scoreFounderBlock(cleaned);
  const customerScore = scoreCustomerBlock(cleaned);
  const productScore = scoreProductBlock(cleaned);

  const best = Math.max(founderScore, customerScore, productScore);

  if (best < 1) return null;

  if (best === founderScore) {
    return { lane: "founderVoice", text: cleaned, score: founderScore };
  }
  if (best === customerScore) {
    return { lane: "customerOutcome", text: cleaned, score: customerScore };
  }
  return { lane: "brandProductTruth", text: cleaned, score: productScore };
}

function classifyBlocks(blocks = []) {
  const result = {
    founderVoice: [],
    customerOutcome: [],
    brandProductTruth: [],
  };

  for (const block of blocks) {
    const classified = classifyBlock(block);
    if (!classified) continue;
    result[classified.lane].push(classified);
  }

  for (const key of Object.keys(result)) {
    result[key] = result[key]
      .sort((a, b) => b.score - a.score)
      .map((x) => x.text);
  }

  return result;
}

async function gatherLaneSources(normalizedUrl) {
  const fallbackFounderPaths = [
    "about",
    "about-us",
    "our-story",
    "story",
    "mission",
    "our-mission",
    "founder",
  ];

  const productPaths = ["", "shop", "products", "collections", "our-matcha", "faq"];

  const allPages = [];
  const attempted = new Set();

  let homepage = null;
  try {
    homepage = await fetchPageData(normalizedUrl);
    allPages.push({ type: "homepage", ...homepage });
    attempted.add(normalizedUrl);
  } catch {}

  const homepageLinks = homepage?.rawHtml
    ? extractLinks(homepage.rawHtml, normalizedUrl)
    : [];

  const menuFounderLinks = pickFounderLinks(homepageLinks);

  for (const link of menuFounderLinks) {
    if (attempted.has(link.href)) continue;
    attempted.add(link.href);

    try {
      const page = await fetchPageData(link.href);

      const titleText = `${page.title || ""} ${(page.headings || []).join(" | ")}`.toLowerCase();
      const linkText = (link.text || "").toLowerCase();
      const hrefText = (link.href || "").toLowerCase();

      const hasPositiveFounderSignal =
        /about|our story|story|mission|founder|why we started|who we are/.test(titleText) ||
        /about|our story|story|mission|founder|why we started|who we are/.test(linkText) ||
        /\/about|\/about-us|\/our-story|\/story|\/mission|\/founder/.test(hrefText);

      const hasNegativeSignal =
        /furoshiki|videos|video|start here|new to matcha|guide|faq|collection|collections|shop|product|products|how to/i.test(
          titleText
        ) ||
        /furoshiki|videos|video|start here|new to matcha|guide|faq|collection|collections|shop|product|products|how to/i.test(
          linkText
        ) ||
        /furoshiki|videos|video|start-here|new-to-matcha|guide|faq|collection|collections|shop|product|products|how-to/i.test(
          hrefText
        );

      if (!hasPositiveFounderSignal || hasNegativeSignal) continue;

      allPages.push({
        type: "founderCandidate",
        linkText: link.text,
        linkScore: link.score,
        ...page,
      });
    } catch {}
  }

  for (const slug of fallbackFounderPaths) {
    const url = joinUrl(normalizedUrl, slug);
    if (attempted.has(url)) continue;
    attempted.add(url);

    try {
      const page = await fetchPageData(url);
      allPages.push({ type: "founderFallback", ...page });
    } catch {}
  }

  for (const slug of productPaths) {
    const url = slug ? joinUrl(normalizedUrl, slug) : normalizedUrl;
    if (attempted.has(url)) continue;
    attempted.add(url);

    try {
      const page = await fetchPageData(url);
      allPages.push({ type: "productCandidate", ...page });
    } catch {}
  }

  const allBlocks = [];

  for (const page of allPages) {
    const pageIntro = [
      `PAGE TYPE: ${page.type}`,
      `PAGE URL: ${page.url}`,
      `PAGE TITLE: ${page.title}`,
      `META DESCRIPTION: ${page.metaDescription}`,
      `HEADINGS: ${(page.headings || []).join(" | ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    allBlocks.push(pageIntro);

    for (const para of qualityParagraphs(page.paragraphs || [])) {
      allBlocks.push(para);
    }
  }

  const classified = classifyBlocks(dedupeBlocks(allBlocks));

  return {
    pages: allPages,
    homepageLinks: menuFounderLinks,
    lanes: classified,
  };
}

function laneText(blocks = [], fallback = "") {
  const filteredBlocks = blocks.filter(
    (block) =>
      !/^PAGE TYPE:/i.test(block) &&
      !/^PAGE URL:/i.test(block) &&
      !/^PAGE TITLE:/i.test(block) &&
      !/^META DESCRIPTION:/i.test(block) &&
      !/^HEADINGS:/i.test(block)
  );

  const text = filteredBlocks.slice(0, 6).join("\n\n").trim();
  return text || fallback;
}

function buildVoiceInstructions(profile) {
  if (!profile) {
    return `
TONE:
- grounded
- clear
- direct

STYLE:
- simple language
- human
- believable
- not over-polished
`;
  }

  return `
TONE:
${(profile.tone || []).map((t) => `- ${t}`).join("\n")}

STYLE:
${(profile.style || []).map((s) => `- ${s}`).join("\n")}

VOCABULARY:
${(profile.vocabulary || []).map((v) => `- ${v}`).join("\n")}

POSITIONING:
${profile.positioning || ""}

STRUCTURE:
${profile.structure || ""}

VOICE SUMMARY:
${profile.voiceSummary || ""}

DO RULES:
${(profile.doRules || []).map((r) => `- ${r}`).join("\n")}

DON'T RULES:
${(profile.dontRules || []).map((r) => `- ${r}`).join("\n")}
`;
}

function cleanPost(post = "") {
  let text = post.trim();
  text = text.replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();

  if (text.length > maxChars) {
    text = text.slice(0, maxChars).trim();
  }

  const sentenceMatches = text.match(/[^.!?]+[.!?]+/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    let rebuilt = "";

    for (const sentence of sentenceMatches) {
      const candidate = (rebuilt + " " + sentence.trim()).trim();
      if (candidate.length <= maxChars) rebuilt = candidate;
      else break;
    }

    if (rebuilt.length > 0) text = rebuilt.trim();
  }

  if (!/[.!?]$/.test(text)) {
    text += ".";
  }

  return text;
}

function soundsTooGeneric(text = "") {
  const badPhrases = [
    "embrace the journey",
    "unlock your potential",
    "step into your power",
    "transform your life",
    "foundation for tomorrow",
  ];

  const lower = text.toLowerCase();
  return badPhrases.some((p) => lower.includes(p));
}

function getHashtags(category, idea, businessName) {
  const cleanName = (businessName || "Brand")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim();

  const brandTag =
    "#" +
    (cleanName
      ? cleanName
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join("")
      : "YourBrand");

  const categoryMap = {
    "Daily Relief": "#DailyRelief",
    "Everyday Ritual": "#EverydayRitual",
    "Founder Reflection": "#FounderReflection",
    "Product in Real Life": "#RealLifeUse",
    "Quiet Value": "#QuietValue",
    "Standards and Care": "#StandardsAndCare",
    "Busy Day Ease": "#BusyDayEase",
    "Small Moment Real Value": "#SmallMomentRealValue",
  };

  const topicTag =
    "#" +
    ((idea || "Small Business")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || "SmallBusiness");

  return `${brandTag} ${categoryMap[category] || "#BrandContent"} ${topicTag}`;
}

const voiceAgentPrompt = (input) => `
You are a Brand Voice Agent.

Analyse the writing sample and return ONLY valid JSON.

Use this exact structure:
{
  "tone": ["trait 1", "trait 2", "trait 3"],
  "style": ["pattern 1", "pattern 2", "pattern 3"],
  "vocabulary": ["pattern 1", "pattern 2", "pattern 3"],
  "positioning": "short brand positioning summary",
  "structure": "short explanation of how the content is structured",
  "voiceSummary": "short paragraph summary",
  "doRules": ["rule 1", "rule 2", "rule 3"],
  "dontRules": ["rule 1", "rule 2", "rule 3"]
}

Rules:
- Return JSON only
- No markdown
- No code fences
- Keep it grounded
- Do not exaggerate
- Treat this as founder or mission language, not customer review language
- Focus on beliefs, standards, purpose, care, and reflection style

INPUT:
"""
${input}
"""
`;

const customerOutcomePrompt = (input) => `
You are a Customer Outcome Agent.

Return ONLY valid JSON in this structure:
{
  "lifeMoments": ["moment 1", "moment 2", "moment 3"],
  "microProblems": ["problem 1", "problem 2", "problem 3"],
  "valueOutcomes": ["outcome 1", "outcome 2", "outcome 3"],
  "repeatBenefits": ["benefit 1", "benefit 2", "benefit 3"]
}

Rules:
- Return JSON only
- No markdown
- No code fences
- Use customer-experience language only
- Focus on what people notice in real life

INPUT:
"""
${input}
"""
`;

const productTruthPrompt = (input) => `
You are a Brand and Product Truth Agent.

Return ONLY valid JSON in this structure:
{
  "productType": "",
  "origin": "",
  "facts": ["fact 1", "fact 2", "fact 3"],
  "offers": ["offer 1", "offer 2"],
  "audience": ["audience 1", "audience 2"]
}

Rules:
- Return JSON only
- No markdown
- No code fences
- Focus on factual business and product truth
- Do not invent facts
- Keep it grounded in actual product/business information

INPUT:
"""
${input}
"""
`;

const sourceProfilePrompt = ({
  mode,
  founderText,
  customerText,
  productText,
  pastedSourceText,
  manualBusinessContext,
}) => `
You are a Source Intake Agent.

Read the lane-separated source material and return ONLY valid JSON.

Use this exact structure:
{
  "businessProfile": {
    "name": "business or brand name",
    "summary": "plain English summary of what the business/person/brand appears to do"
  },
  "contentProfile": {
    "suggestedCategory": "one of: Daily Relief, Everyday Ritual, Founder Reflection, Product in Real Life, Quiet Value, Standards and Care, Busy Day Ease, Small Moment Real Value",
    "suggestedIdea": "strong first content angle"
  },
  "visualProfile": {
    "visualDirections": ["direction 1", "direction 2", "direction 3"],
    "avoidRules": ["avoid 1", "avoid 2"]
  },
  "sourceProfile": {
    "dominantSource": "url or pasted_text or manual_context or mixed"
  }
}

Rules:
- Return JSON only
- No markdown
- No code fences
- If mode is express and URL is present, use founder lane for voice direction, customer lane for outcomes, product lane for facts
- If mode is manual, let manual context and pasted writing lead
- If mode is hybrid, blend intelligently
- Suggested category must be a lived-use frame

FOUNDER LANE:
"""
${clipText(founderText || "none provided", 3000)}
"""

CUSTOMER OUTCOME LANE:
"""
${clipText(customerText || "none provided", 3000)}
"""

BRAND / PRODUCT TRUTH LANE:
"""
${clipText(productText || "none provided", 3000)}
"""

PASTED SOURCE TEXT:
"""
${clipText(pastedSourceText || "none provided", 3000)}
"""

MANUAL BUSINESS CONTEXT:
"""
${clipText(manualBusinessContext || "none provided", 2000)}
"""
`;

async function runJsonChat(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

function buildGenerationContext({
  mode,
  initialProfile,
  businessName,
  businessSummary,
  businessUrl,
  pastedSourceText,
  manualBusinessContext,
  manualVoiceInput,
}) {
  const profileName = initialProfile?.businessProfile?.name || businessName || "Unknown";
  const profileSummary =
    initialProfile?.businessProfile?.summary || businessSummary || "Not provided";
  const profileOffers =
    (initialProfile?.brandProductTruth?.offers || []).join(", ") || "Not provided";
  const profileAudience =
    (initialProfile?.brandProductTruth?.audience || []).join(", ") || "Not provided";
  const customerMoments =
    (initialProfile?.customerOutcome?.lifeMoments || []).join(", ") || "Not provided";
  const customerOutcomes =
    (initialProfile?.customerOutcome?.valueOutcomes || []).join(", ") || "Not provided";
  const founderBeliefs =
    (initialProfile?.founderVoice?.doRules || []).join(", ") || "Not provided";

  const base = `
PROFILE CONTEXT:
- Business name: ${profileName}
- Business summary: ${profileSummary}
- Offers/services: ${profileOffers}
- Audience: ${profileAudience}
- Customer life moments: ${customerMoments}
- Customer outcomes: ${customerOutcomes}
- Founder priorities: ${founderBeliefs}
- URL: ${businessUrl || "Not provided"}

PASTED SOURCE TEXT:
${clipText(pastedSourceText || "None provided", 3000)}

MANUAL CONTEXT:
${clipText(manualBusinessContext || "None provided", 2000)}

MANUAL VOICE INPUT:
${clipText(manualVoiceInput || "None provided", 3000)}
`;

  if (mode === "express") {
    return `
MODE: EXPRESS
Use founder voice lane as the tone anchor.
Use customer outcome lane for real-life effects.
Use brand/product truth lane for factual grounding.
Only use manual or pasted inputs as fallback or refinement.
${base}
`;
  }

  if (mode === "manual") {
    return `
MODE: MANUAL
Use manual and pasted inputs as primary truth.
Use profile/URL context only as fallback.
${base}
`;
  }

  return `
MODE: HYBRID
Use the profile as the base.
Blend in pasted and manual inputs where useful.
If there is conflict, prefer the user's manual wording and corrections.
${base}
`;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/build-profile", async (req, res) => {
  const { mode, businessUrl, pastedSourceText, manualBusinessContext } = req.body;

  try {
    let laneGather = null;
    const normalizedUrl = normalizeUrl(businessUrl);

    if (normalizedUrl) {
      laneGather = await gatherLaneSources(normalizedUrl);
    }

    const founderText = laneText(
      laneGather?.lanes?.founderVoice || [],
      manualBusinessContext || pastedSourceText || ""
    );

    const customerText = laneText(laneGather?.lanes?.customerOutcome || [], "");
    const productText = laneText(laneGather?.lanes?.brandProductTruth || [], "");

    const founderSourceInput = clipText(
      mode === "manual"
        ? manualBusinessContext || pastedSourceText
        : mode === "hybrid"
        ? pastedSourceText || manualBusinessContext || founderText
        : founderText || pastedSourceText || manualBusinessContext || productText,
      5000
    );

    const [sourceProfile, founderVoice, customerOutcome, brandProductTruth] =
      await Promise.all([
        runJsonChat(
          sourceProfilePrompt({
            mode,
            founderText,
            customerText,
            productText,
            pastedSourceText,
            manualBusinessContext,
          })
        ),
        runJsonChat(voiceAgentPrompt(founderSourceInput)),
        runJsonChat(customerOutcomePrompt(clipText(customerText || pastedSourceText || "", 3000))),
        runJsonChat(
          productTruthPrompt(clipText(productText || founderText || pastedSourceText || "", 3000))
        ),
      ]);

    const profile = {
      businessProfile: {
        name: sourceProfile?.businessProfile?.name || brandProductTruth?.productType || "",
        summary: sourceProfile?.businessProfile?.summary || "",
      },
      contentProfile: {
        suggestedCategory:
          sourceProfile?.contentProfile?.suggestedCategory || "Product in Real Life",
        suggestedIdea:
          sourceProfile?.contentProfile?.suggestedIdea ||
          "How this business makes everyday life feel easier or better",
      },
      visualProfile: {
        visualDirections: sourceProfile?.visualProfile?.visualDirections || [],
        avoidRules: sourceProfile?.visualProfile?.avoidRules || [],
      },
      sourceProfile: {
        dominantSource: sourceProfile?.sourceProfile?.dominantSource || "mixed",
        voiceSourceText:
          mode === "manual"
            ? manualBusinessContext || pastedSourceText
            : mode === "hybrid"
            ? pastedSourceText || manualBusinessContext || founderText
            : founderText,
        founderLanePreview: founderText,
        customerLanePreview: customerText,
        productLanePreview: productText,
        urlUsed: Boolean(normalizedUrl),
        pastedTextUsed: Boolean(pastedSourceText),
        manualContextUsed: Boolean(manualBusinessContext),
      },
      founderVoice,
      customerOutcome,
      brandProductTruth,
      debug: {
        pagesScanned: laneGather?.pages?.length || 0,
      },
    };

    res.json({ profile });
  } catch (err) {
    console.error("BUILD PROFILE ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to build profile." });
  }
});

app.post("/analyze-voice", async (req, res) => {
  const { input } = req.body;

  try {
    const profile = await runJsonChat(voiceAgentPrompt(clipText(input, 5000)));
    res.json({
      profile,
      result: JSON.stringify(profile, null, 2),
    });
  } catch (err) {
    console.error("VOICE AGENT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", async (req, res) => {
  const {
    mode,
    idea,
    category,
    weeklyPosts,
    businessUrl,
    pastedSourceText,
    manualBusinessContext,
    businessName,
    businessSummary,
    manualVoiceInput,
    voiceProfile,
    initialProfile,
  } = req.body;

  let extraCategoryRule = "";

  if (category === "Daily Relief") {
    extraCategoryRule = `
- Focus on stress reduced, friction removed, or the day feeling easier
- Use a real-life moment where the business quietly helps
`;
  } else if (category === "Everyday Ritual") {
    extraCategoryRule = `
- Focus on routine, rhythm, repeat use, or a small daily practice
- Make it feel lived-in and natural
`;
  } else if (category === "Founder Reflection") {
    extraCategoryRule = `
- Focus on what the founder notices, values, or cares about
- Make it feel personal but grounded
`;
  } else if (category === "Product in Real Life") {
    extraCategoryRule = `
- Focus on where the product or service actually shows up in life
- Prioritise use and effect over features
`;
  } else if (category === "Quiet Value") {
    extraCategoryRule = `
- Focus on subtle benefits people notice without needing a hard sell
- Keep it understated and real
`;
  } else if (category === "Standards and Care") {
    extraCategoryRule = `
- Focus on why doing it properly matters
- Show care, detail, standards, or long-term thinking
`;
  } else if (category === "Busy Day Ease") {
    extraCategoryRule = `
- Focus on pressure, rush, chaos, or a full day becoming easier
- Keep the life moment clear
`;
  } else if (category === "Small Moment Real Value") {
    extraCategoryRule = `
- Focus on a small ordinary moment that reveals real value
- Keep it human, simple, and believable
`;
  }

  try {
    const generationContext = buildGenerationContext({
      mode,
      initialProfile,
      businessName,
      businessSummary,
      businessUrl,
      pastedSourceText,
      manualBusinessContext,
      manualVoiceInput,
    });

    const prompt = `
Create exactly 3 X posts.

${generationContext}

LIFE FRAME:
${category}

IDEA:
${clipText(idea || "No idea provided", 300)}

WEEKLY SOURCE MATERIAL:
${clipText(weeklyPosts || "No weekly notes provided", 2000)}

VOICE PROFILE:
${buildVoiceInstructions(voiceProfile)}

CORE RULE:
All 3 posts must sound like the SAME founder / brand voice.
Do NOT create 3 different personalities.
Change only the level of explicitness and framing.

3-TIER OUTPUT RULE:
Post 1 = SUBTLE
- feels like a natural reflection or passing thought
- product/service presence is light or implied
- focus more on the life moment, emotional shift, or small realization
- should not feel like marketing

Post 2 = BALANCED
- feels like a natural everyday brand post
- product/service is present but woven into real life
- focus on lived use, routine, relief, value, or practical difference
- this should be the most generally usable option

Post 3 = DIRECT
- still human and believable, but clearer about the value
- product/service impact should be more obvious
- focus on what changed, what problem is reduced, or why it matters
- still must not sound like an ad

REAL LIFE RULE:
- every post must feel like it came from a real moment
- the product/service must appear naturally inside that moment
- do NOT describe the product directly like a brochure
- show what it does to the day, not just what it is
- write as if the founder is reflecting on a real situation

STYLE:
- write like a real person
- clear and practical
- believable
- not over-polished
- no fluff
- no fake guru language
- no corporate waffle
- complete the thought properly

REQUIREMENTS:
- output exactly 3 posts
- separate each post with ---
- each post must end with exactly 3 hashtags on the final line
- no numbering
- no markdown
- platform is X
- no greeting/signoff

IMPORTANT:
- Express mode should use founder voice as the main tone anchor
- Customer outcome should support the life effect, not replace the voice
- Product truth should keep the content accurate, not make it sound like a brochure
- Manual mode should follow manual and pasted inputs most closely
- Hybrid mode should combine both cleanly

AVOID:
- generic motivation clichés
- "unlock your potential"
- "embrace the journey"
- "transform your life"
- empty hype
- obvious ad language
- repeated sentence structures across all 3 posts

${extraCategoryRule}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.choices?.[0]?.message?.content || "";

    let posts = rawText
      .split("---")
      .map((p) => p.trim())
      .filter(Boolean);

    if (posts.length !== 3) {
      posts = rawText
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 3);
    }

    if (posts.length < 3) {
      return res.status(500).json({
        error: "Model did not return all 3 post tiers.",
      });
    }

    const filteredGeneric = posts.filter((p) => !soundsTooGeneric(p));
    if (filteredGeneric.length === 3) posts = filteredGeneric;

    const finalBusinessName =
      initialProfile?.businessProfile?.name || businessName || "Your Brand";

    const finalPosts = posts.map((post) => {
      let cleaned = cleanPost(post);
      cleaned = cleaned.replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();
      return `${cleaned}\n${getHashtags(category, idea, finalBusinessName)}`;
    });

    res.json({ text: finalPosts.join("\n\n\n") });
  } catch (err) {
    console.error("GENERATE ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to generate posts." });
  }
});

app.post("/generate-image", async (req, res) => {
  const { imagePrompt } = req.body;

  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: clipText(imagePrompt, 4000),
      size: "1024x1024",
    });

    const base64Image = response.data?.[0]?.b64_json;
    if (!base64Image) {
      return res.status(500).json({ error: "No image returned from OpenAI." });
    }

    res.json({
      imageUrl: `data:image/png;base64,${base64Image}`,
    });
  } catch (err) {
    console.error("IMAGE GENERATION ERROR:", err);
    res.status(500).json({
      error:
        err?.response?.data?.error?.message ||
        err?.message ||
        "Unknown image generation error",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});