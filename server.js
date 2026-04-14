require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const maxChars = 500;
const OWNER_KB_PATH = path.join(__dirname, "owner-kb.json");

const QUIET_FAMILY_WORDS = ["quiet", "calm", "gentle", "subtle", "steady", "small"];
const NON_QUIET_REPLACEMENTS = {
  quiet: "real",
  calm: "clear",
  gentle: "measured",
  subtle: "real",
  steady: "reliable",
  small: "real",
};

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

function ensureOwnerKbFile() {
  if (!fs.existsSync(OWNER_KB_PATH)) {
    fs.writeFileSync(
      OWNER_KB_PATH,
      JSON.stringify({ businesses: {} }, null, 2),
      "utf8"
    );
  }
}

function readOwnerKb() {
  ensureOwnerKbFile();
  try {
    const raw = fs.readFileSync(OWNER_KB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.businesses || typeof parsed.businesses !== "object") {
      return { businesses: {} };
    }
    return parsed;
  } catch {
    return { businesses: {} };
  }
}

function writeOwnerKb(data) {
  ensureOwnerKbFile();
  fs.writeFileSync(OWNER_KB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function businessKey(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown_business";
}

function getBusinessKbMeta(name = "") {
  const kb = readOwnerKb();
  const key = businessKey(name);
  const business = kb.businesses[key];

  if (!business) {
    return {
      entryCount: 0,
      lastFeeling: "",
      lastQuickType: "",
    };
  }

  const entries = Array.isArray(business.entries) ? business.entries : [];
  const lastEntry = entries[entries.length - 1] || null;

  return {
    entryCount: entries.length,
    lastFeeling: lastEntry?.ownerFeeling || "",
    lastQuickType: lastEntry?.quickType || "",
  };
}

function saveOwnerChoiceToKb({
  businessName,
  businessSummary,
  quickType,
  category,
  ownerFeeling,
  chosenPost,
  voiceSourceText,
  ownerWritingSample,
  manualBusinessContext,
}) {
  const cleanBusinessName = clipText(businessName || "Unknown Business", 200);
  const key = businessKey(cleanBusinessName);

  const kb = readOwnerKb();

  if (!kb.businesses[key]) {
    kb.businesses[key] = {
      businessName: cleanBusinessName,
      businessSummary: clipText(businessSummary || "", 500),
      entries: [],
    };
  }

  kb.businesses[key].businessSummary = clipText(businessSummary || "", 500);

  kb.businesses[key].entries.push({
    timestamp: new Date().toISOString(),
    quickType: clipText(quickType || "", 80),
    category: clipText(category || "", 80),
    ownerFeeling: clipText(ownerFeeling || "", 120),
    chosenPost: clipText(chosenPost || "", 1200),
    voiceSourceText: clipText(voiceSourceText || "", 3000),
    ownerWritingSample: clipText(ownerWritingSample || "", 3000),
    manualBusinessContext: clipText(manualBusinessContext || "", 2000),
  });

  kb.businesses[key].entries = kb.businesses[key].entries.slice(-100);

  writeOwnerKb(kb);

  return {
    entryCount: kb.businesses[key].entries.length,
  };
}

function summarizeOwnerKbForPrompt(businessName = "") {
  const kb = readOwnerKb();
  const key = businessKey(businessName);
  const business = kb.businesses[key];

  if (!business || !Array.isArray(business.entries) || business.entries.length === 0) {
    return `
OWNER KNOWLEDGE BASE:
- No saved owner choices yet
- Use current inputs and current feeling as the main guide
`.trim();
  }

  const entries = business.entries.slice(-12);
  const lensCounts = {};
  const feelingCounts = {};
  let totalLength = 0;

  for (const entry of entries) {
    const qt = entry.quickType || "Unknown";
    const feeling = entry.ownerFeeling || "Not specified";

    lensCounts[qt] = (lensCounts[qt] || 0) + 1;
    feelingCounts[feeling] = (feelingCounts[feeling] || 0) + 1;
    totalLength += (entry.chosenPost || "").length;
  }

  const topLenses = Object.entries(lensCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");

  const topFeelings = Object.entries(feelingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");

  const avgLength = Math.round(totalLength / entries.length);
  const preferredLengthBand =
    avgLength < 240 ? "shorter" : avgLength < 360 ? "medium" : "longer";

  const recentPostSnippets = entries
    .slice(-3)
    .map((entry, i) => `Recent chosen post ${i + 1}: ${clipText(entry.chosenPost || "", 220)}`)
    .join("\n");

  const ownerWritingSnippets = entries
    .map((entry) => entry.ownerWritingSample)
    .filter(Boolean)
    .slice(-2)
    .map((text, i) => `Owner writing sample ${i + 1}: ${clipText(text, 220)}`)
    .join("\n");

  return `
OWNER KNOWLEDGE BASE:
- Saved choices for this business: ${entries.length}
- Most used lenses recently: ${topLenses || "none yet"}
- Most common feelings recently: ${topFeelings || "none yet"}
- Preferred chosen-post length trend: ${preferredLengthBand}
${recentPostSnippets ? `- Recent chosen post patterns:\n${recentPostSnippets}` : ""}
${ownerWritingSnippets ? `- Owner-written text remembered:\n${ownerWritingSnippets}` : ""}

OWNER KB RULE:
- Learn from these patterns, but do NOT trap the owner inside their usual pattern
- If today's feeling or current lens points somewhere different, respect that
- Current state can override baseline tone, but not owner identity
`.trim();
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

function looksLikeTestimonial(text = "") {
  const lower = String(text).toLowerCase();

  return (
    /our company has been using|we have been using|we've been using|would not go anywhere else|value for money|communication is great|second to none|tried a few of the bigger companies|before .* we tried|highly recommend|couldn't be happier|customer service/i.test(
      lower
    ) ||
    (/\bwe\b/.test(lower) && /\busing\b/.test(lower) && /\byears?\b/.test(lower)) ||
    (/\bservice\b/.test(lower) && /\bcommunication\b/.test(lower)) ||
    (/\bbefore\b/.test(lower) && /\btried\b/.test(lower) && /\bcompanies\b/.test(lower))
  );
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
    /reviews|review|testimonial|testimonials|videos|video|start here|faq|collection|collections|shop|product|products|blog|guide|how to/i.test(
      text
    )
  ) {
    score -= 10;
  }

  if (
    /reviews|review|testimonial|testimonials|videos|video|start-here|faq|collection|collections|shop|product|products|blog|guide|how-to/i.test(
      href
    )
  ) {
    score -= 10;
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

  if (
    /about us|who we are|our approach|what matters to us|why we started|family owned|family-run|locally owned|small business/i.test(
      lower
    )
  ) {
    score += 4;
  }

  if (/\bwe\b|\bour\b/.test(lower)) score += 1;

  if (looksLikeTestimonial(lower)) {
    score -= 12;
  }

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

  return score;
}

function scoreCustomerBlock(text = "") {
  const lower = text.toLowerCase();
  let score = 0;

  if (text.length >= 100) score += 1;

  if (
    /i bought|i tried|my experience|i noticed|since using|highly recommend|worth the price|my husband|sleep improved|better than|addicted|our company has been using|we have been using|we've been using|would not go anywhere else|value for money|communication is great|second to none/i.test(
      lower
    )
  ) {
    score += 6;
  }

  if (looksLikeTestimonial(lower)) {
    score += 5;
  }

  if (
    /our mission|we started|we believe|our story|founder|our goal|our vision|why we started/i.test(
      lower
    )
  ) {
    score -= 5;
  }

  return score;
}

function scoreProductBlock(text = "") {
  const lower = text.toLowerCase();
  let score = 0;

  if (text.length >= 80) score += 1;

  if (
    /ceremonial grade|organic|sourced from|uji|japan|blend|ingredients|product|powder|tea|matcha|origin|quality|flavour|embroidery|printing|custom uniforms|workwear|apparel|signage/i.test(
      lower
    )
  ) {
    score += 4;
  }

  if (
    /i bought|highly recommend|my husband|worth the price|review|5 stars/i.test(lower)
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

  const productPaths = ["", "shop", "products", "collections", "services", "faq"];

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
        /about|our story|story|mission|founder|why we started|who we are|family owned|family-run/.test(
          titleText
        ) ||
        /about|our story|story|mission|founder|why we started|who we are|family owned|family-run/.test(
          linkText
        ) ||
        /\/about|\/about-us|\/our-story|\/story|\/mission|\/founder/.test(hrefText);

      const hasNegativeSignal =
        /reviews|review|testimonial|testimonials|videos|video|start here|guide|faq|collection|collections|shop|product|products|how to/i.test(
          titleText
        ) ||
        /reviews|review|testimonial|testimonials|videos|video|start here|guide|faq|collection|collections|shop|product|products|how to/i.test(
          linkText
        ) ||
        /reviews|review|testimonial|testimonials|videos|video|start-here|guide|faq|collection|collections|shop|product|products|how-to/i.test(
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

function chooseVoiceSourceText({
  mode,
  founderText,
  customerText,
  productText,
  pastedSourceText,
  manualBusinessContext,
  sourceProfileSummary,
}) {
  const founderClean = clipText(founderText || "", 3000);
  const customerClean = clipText(customerText || "", 3000);
  const productClean = clipText(productText || "", 3000);
  const pastedClean = clipText(pastedSourceText || "", 3000);
  const manualClean = clipText(manualBusinessContext || "", 2000);
  const summaryClean = clipText(sourceProfileSummary || "", 1000);

  if (mode === "manual") {
    return manualClean || pastedClean || founderClean || productClean || summaryClean;
  }

  if (mode === "hybrid") {
    if (manualClean) return manualClean;
    if (pastedClean && !looksLikeTestimonial(pastedClean)) return pastedClean;
    if (founderClean && !looksLikeTestimonial(founderClean)) return founderClean;
    return [summaryClean, productClean, customerClean ? `Customer signals:\n${customerClean}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  if (founderClean && !looksLikeTestimonial(founderClean)) return founderClean;

  return [summaryClean, productClean, customerClean ? `Customer signals:\n${customerClean}` : ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function isWeakVoiceSource(text = "") {
  const cleaned = clipText(text || "", 5000);
  const lower = cleaned.toLowerCase();

  if (!cleaned) return true;
  if (cleaned.length < 180) return true;
  if (looksLikeTestimonial(cleaned)) return true;

  const genericProductSignals =
    /best tasting|organic matcha|quality you can trust|popular regions|settled for what we believe|you can buy|premium quality|carefully selected/i.test(
      lower
    );

  const founderSignals =
    /i |we |our story|why we|we started|i started|what matters|we care|i believe|we believe|we wanted/i.test(
      lower
    );

  if (genericProductSignals && !founderSignals) return true;

  return false;
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
    "Something Real": "#SomethingReal",
  };

  const topicTag =
    "#" +
    ((idea || "Business")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || "Business");

  return `${brandTag} ${categoryMap[category] || "#BrandContent"} ${topicTag}`;
}

function getLensRules({ quickType = "", category = "", weakVoice = false }) {
  const qt = String(quickType || "").toLowerCase();

  let lensTitle = "General";
  let lensRules = `
- Keep the same owner voice throughout
- Change the lens, not the personality
- Keep the owner as the human being behind the operation
`;

  if (qt === "business") {
    lensTitle = "Business";
    lensRules = `
- Keep the owner voice constant
- Focus on value, standards, decisions, effort, and why the business works
- Show the owner as the brain and body behind the operation
- Make the post feel like the owner understands what holds the whole thing together
- Highlight judgment, consistency, positioning, or operational care
- Do NOT slip into customer review language
- Do NOT write like a brochure
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (qt === "family") {
    lensTitle = "Family";
    lensRules = `
- Keep the owner voice constant
- Focus on home life, routine, sacrifice, togetherness, care, or the human side of running the business
- Make the owner feel like a real person carrying both business and life
- Let warmth show, but keep it grounded and believable
- The business should feel connected to the owner's life, not separate from it
- Avoid heavy operational positioning language
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (qt === "educational") {
    lensTitle = "Educational";
    lensRules = `
- Keep the owner voice constant
- Focus on teaching, explaining, clarifying, or passing on something useful
- Make the owner sound informed, capable, and worth listening to
- The post should leave the reader understanding something better than before
- Do not become dry or textbook-like
- Do not lose the human voice
- Open more clearly and directly
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (qt === "community") {
    lensTitle = "Community";
    lensRules = `
- Keep the owner voice constant
- Focus on people, support, belonging, shared effort, local impact, or the wider circle around the business
- Make it feel like the owner sees more than just transactions
- Show connection, trust, and shared momentum
- The business should feel part of a bigger human ecosystem
- Avoid over-focusing on product specs
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (qt === "personal") {
    lensTitle = "Personal";
    lensRules = `
- Keep the owner voice constant
- Focus on reflection, beliefs, lessons, pressure, pride, doubt, or lived experience
- Make it clearly feel like the owner speaking from inside the work
- Show the owner as a real person with thought, effort, and perspective
- Let personality and self-awareness show more here than in other lenses
- Avoid sounding like a general brand narrator
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (qt === "something real") {
    lensTitle = "Something Real";
    lensRules = `
- Keep the owner voice constant
- Focus on an honest, human, less-polished moment
- This is for days where the owner feels off-rhythm, tired, reflective, restless, or simply real
- Make the post feel truthful, not dramatic
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  } else if (category === "Quiet Value") {
    lensTitle = "Quiet Value";
    lensRules = `
- Keep the owner voice constant
- Focus on subtle benefits people notice without needing a hard sell
- Soft, reflective, understated language is allowed here
- The word "quiet" is allowed in this lens if it genuinely fits
- Calm, subtle, gentle, and steady wording can be used here when natural
`;
  }

  if (category === "Quiet Value" && !/The word "quiet" is allowed/.test(lensRules)) {
    lensTitle = "Quiet Value";
    lensRules += `
- This is the one lens where quiet-value language can live naturally
- The word "quiet" is allowed here if it genuinely fits
- Calm, subtle, gentle, and steady wording can be used here when natural
`;
  }

  if (category !== "Quiet Value" && !/Do NOT use the word "quiet"/.test(lensRules)) {
    lensRules += `
- Do NOT use the word "quiet"
- Avoid opener words like calm, subtle, gentle, steady, small
`;
  }

  if (category === "Founder Reflection" && qt !== "personal") {
    lensRules += `
- Keep a slightly more reflective edge because of the internal content frame
`;
  }

  if (weakVoice) {
    lensRules += `
- The available voice sample is weak or thin, so rely more heavily on this lens
- Increase contrast between this lens and the others
- Use the business summary, product truth, and owner role as stronger anchors than the thin voice sample
- Make the difference in angle obvious without changing the speaker
`;
  }

  return { lensTitle, lensRules };
}

function getFeelingRules(ownerNudge = "") {
  const feeling = String(ownerNudge || "").trim();
  const lower = feeling.toLowerCase();

  if (!feeling) {
    return {
      feelingLabel: "Not specified",
      feelingRules: `
- No specific feeling was provided
- Keep the emotional temperature grounded and natural
- Let the lens lead the direction
`,
    };
  }

  if (/focused|clear|locked in|dialled in/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels focused right now
- Make the post clearer, steadier, and more intentional
- Reduce drift and softness
- Let the writing feel composed and purposeful
`,
    };
  }

  if (/proud|earned/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels proud right now
- Let the post carry earned pride
- Avoid bragging
- Make the effort and achievement feel real and deserved
`,
    };
  }

  if (/tired|flat|drained|exhausted/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels tired or flat right now
- Strip away polish and hype
- Let the post feel more honest, direct, and effort-aware
- Do not become negative or dramatic
- Keep the writing human and restrained
`,
    };
  }

  if (/reflective|thoughtful|processing/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels reflective right now
- Slow the post down slightly
- Let observation and meaning carry more weight
- Keep it grounded, not poetic for the sake of it
`,
    };
  }

  if (/grateful|thankful/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels grateful right now
- Let appreciation and awareness show
- Keep it sincere, not sentimental
- Make gratitude feel tied to real people, effort, or support
`,
    };
  }

  if (/fired up|energised|energized|ready|sharp/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels fired up right now
- Increase conviction and forward movement
- Make the tone stronger and more decisive
- Do not become loud, preachy, or hype-driven
`,
    };
  }

  if (/not feeling it|off|restless|random/.test(lower)) {
    return {
      feelingLabel: feeling,
      feelingRules: `
- The owner feels off-rhythm or random right now
- Let the post feel more in-the-moment and human
- Reduce polish
- Keep it real, believable, and lightly open-ended if useful
`,
    };
  }

  return {
    feelingLabel: feeling,
    feelingRules: `
- The owner gave this current feeling/state: "${feeling}"
- Let it shape the emotional temperature, emphasis, and posture of the writing
- Do not let it replace the owner voice
- Do not let it overpower the selected lens
- Make its influence visible but controlled
`,
  };
}

function getVariationRules(category = "") {
  const quietOnlyRule =
    category === "Quiet Value"
      ? `- "quiet" language is allowed here, but do not use it in more than one post opener in the batch`
      : `- Do NOT use any of these words anywhere in the posts: quiet, calm, gentle, subtle, steady, small`;

  return `
LANGUAGE SEPARATION RULE:
- The 3 posts must not sound like rewrites of each other
- Use clearly different opening styles across the 3 posts
- Vary sentence length and rhythm more aggressively
- At least one post should open with a direct statement
- At least one post should open with a lived moment or scene
- At least one post should open with an insight, decision, or truth
- Avoid repeating the same emotional posture across all 3 posts
- Avoid repeating the same nouns, same transitions, and same cadence too closely
- If one post is softer and reflective, another should be clearer and firmer
- Do not let all 3 default into the same calm, polished phrasing family
${quietOnlyRule}
`.trim();
}

function getFirstSentence(text = "") {
  const cleaned = String(text).trim();
  const match = cleaned.match(/^.*?[.!?](\s|$)/);
  return match ? match[0].trim() : cleaned;
}

function normalizeForOpenerCheck(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[#@][\w-]+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openerFamilyTokens(sentence = "") {
  const normalized = normalizeForOpenerCheck(sentence);
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.slice(0, 6);
}

function repeatedOpenerGuard(posts = [], category = "") {
  if (!Array.isArray(posts) || posts.length < 2) return { failed: false, reason: "" };

  const softWords = new Set(QUIET_FAMILY_WORDS);
  const allowQuiet = category === "Quiet Value";

  const normalizedOpeners = posts.map((post) => normalizeForOpenerCheck(getFirstSentence(post)));
  const openerTokens = normalizedOpeners.map((opener) => openerFamilyTokens(opener));

  let softCount = 0;
  let quietCount = 0;

  for (const tokens of openerTokens) {
    if (tokens.some((t) => softWords.has(t))) {
      softCount += 1;
    }
    if (tokens.includes("quiet")) {
      quietCount += 1;
    }
  }

  if (!allowQuiet && quietCount >= 1) {
    return {
      failed: true,
      reason: `The word "quiet" appeared outside Quiet Value.`,
    };
  }

  if (allowQuiet && quietCount >= 2) {
    return {
      failed: true,
      reason: `The word "quiet" appeared in too many Quiet Value openers.`,
    };
  }

  if (!allowQuiet && softCount >= 2) {
    return {
      failed: true,
      reason:
        "Too many posts use soft reflective opener words like calm/small/steady/subtle/gentle.",
    };
  }

  const firstWordCounts = {};
  for (const tokens of openerTokens) {
    const first = tokens[0];
    if (!first) continue;
    firstWordCounts[first] = (firstWordCounts[first] || 0) + 1;
  }

  if (Object.values(firstWordCounts).some((count) => count >= 2)) {
    return {
      failed: true,
      reason: "Too many posts start with the same first word.",
    };
  }

  for (let i = 0; i < openerTokens.length; i += 1) {
    for (let j = i + 1; j < openerTokens.length; j += 1) {
      const a = openerTokens[i];
      const b = openerTokens[j];
      const shared = a.filter((token) => b.includes(token));
      if (shared.length >= 3) {
        return {
          failed: true,
          reason: "Opening lines are too lexically similar.",
        };
      }
    }
  }

  return { failed: false, reason: "" };
}

function containsQuietFamily(text = "") {
  const normalized = ` ${normalizeForOpenerCheck(text)} `;
  return QUIET_FAMILY_WORDS.some((word) => normalized.includes(` ${word} `));
}

function containsHardQuietViolation(post = "", category = "") {
  if (category === "Quiet Value") return false;
  return containsQuietFamily(post);
}

function sanitizeQuietFamilyOutsideQuietValue(text = "", category = "") {
  if (category === "Quiet Value") return text;

  let result = String(text);

  for (const [word, replacement] of Object.entries(NON_QUIET_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, (match) => {
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  result = result.replace(/\s+/g, " ").replace(/\s([,.!?;:])/g, "$1").trim();
  return result;
}

function hardQuietGuard(posts = [], category = "") {
  if (category === "Quiet Value") {
    const quietCount = posts.filter((p) => /\bquiet\b/i.test(p)).length;
    if (quietCount > 1) {
      return {
        failed: true,
        reason: `Too many Quiet Value posts still use "quiet".`,
      };
    }
    return { failed: false, reason: "" };
  }

  for (const post of posts) {
    if (containsHardQuietViolation(post, category)) {
      return {
        failed: true,
        reason: `Restricted quiet-family language appeared outside Quiet Value.`,
      };
    }
  }

  return { failed: false, reason: "" };
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

async function generatePostsWithRetry(promptBase, category) {
  let retryReason = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retryBlock =
      attempt === 0
        ? ""
        : `

RETRY CORRECTION:
The previous batch failed output enforcement.
Reason: ${retryReason}

You must correct this now:
- make each first sentence clearly distinct in structure and wording
- do not reuse the same opener word family
- ${
            category === "Quiet Value"
              ? `the word "quiet" may appear in at most one post in the batch`
              : `do not use any of these words anywhere in the posts: quiet, calm, gentle, subtle, steady, small`
          }
- one opener should be direct
- one opener should be scene-based
- one opener should be insight/decision/truth-based
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: `${promptBase}${retryBlock}` }],
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
      retryReason = "Model did not return 3 usable posts.";
      continue;
    }

    const openerCheck = repeatedOpenerGuard(posts, category);
    if (openerCheck.failed) {
      retryReason = openerCheck.reason;
      continue;
    }

    const quietCheck = hardQuietGuard(posts, category);
    if (quietCheck.failed) {
      retryReason = quietCheck.reason;
      continue;
    }

    return posts;
  }

  return [];
}

function enforceFinalQuietRules(posts = [], category = "") {
  if (category === "Quiet Value") {
    let quietSeen = false;
    return posts.map((post) => {
      if (!/\bquiet\b/i.test(post)) return post;
      if (!quietSeen) {
        quietSeen = true;
        return post;
      }
      return sanitizeQuietFamilyOutsideQuietValue(post, "Not Quiet Value");
    });
  }

  return posts.map((post) => sanitizeQuietFamilyOutsideQuietValue(post, category));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/save-owner-choice", async (req, res) => {
  try {
    const {
      businessName,
      businessSummary,
      quickType,
      category,
      ownerFeeling,
      chosenPost,
      voiceSourceText,
      ownerWritingSample,
      manualBusinessContext,
    } = req.body || {};

    if (!businessName || !chosenPost) {
      return res.status(400).json({
        error: "businessName and chosenPost are required.",
      });
    }

    const result = saveOwnerChoiceToKb({
      businessName,
      businessSummary,
      quickType,
      category,
      ownerFeeling,
      chosenPost,
      voiceSourceText,
      ownerWritingSample,
      manualBusinessContext,
    });

    res.json({
      ok: true,
      entryCount: result.entryCount,
    });
  } catch (err) {
    console.error("SAVE OWNER CHOICE ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to save owner choice." });
  }
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

    const safeVoiceSourceText = chooseVoiceSourceText({
      mode,
      founderText,
      customerText,
      productText,
      pastedSourceText,
      manualBusinessContext,
      sourceProfileSummary: sourceProfile?.businessProfile?.summary || "",
    });

    const safeFounderVoice = await runJsonChat(
      voiceAgentPrompt(clipText(safeVoiceSourceText || founderSourceInput || "", 5000))
    );

    const finalBusinessName =
      sourceProfile?.businessProfile?.name ||
      brandProductTruth?.productType ||
      "Unknown Business";

    const profile = {
      businessProfile: {
        name: finalBusinessName,
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
        voiceSourceText: safeVoiceSourceText,
        voiceSourceLane:
          mode === "manual"
            ? "manual"
            : safeVoiceSourceText === founderText
            ? "founder"
            : safeVoiceSourceText === pastedSourceText
            ? "pasted"
            : safeVoiceSourceText === manualBusinessContext
            ? "manual"
            : "fallback",
        weakVoiceSource: isWeakVoiceSource(safeVoiceSourceText),
        founderLanePreview: founderText,
        customerLanePreview: customerText,
        productLanePreview: productText,
        urlUsed: Boolean(normalizedUrl),
        pastedTextUsed: Boolean(pastedSourceText),
        manualContextUsed: Boolean(manualBusinessContext),
      },
      founderVoice: safeFounderVoice,
      customerOutcome,
      brandProductTruth,
      ownerKbMeta: getBusinessKbMeta(finalBusinessName),
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
    quickType,
    ownerNudge,
  } = req.body;

  let extraCategoryRule = "";

  if (category === "Daily Relief") {
    extraCategoryRule = `
- Focus on stress reduced, friction removed, or the day feeling easier
- Use a real-life moment where the business helps
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Everyday Ritual") {
    extraCategoryRule = `
- Focus on routine, rhythm, repeat use, or a daily practice
- Make it feel lived-in and natural
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Founder Reflection") {
    extraCategoryRule = `
- Focus on what the founder notices, values, or cares about
- Make it feel personal but grounded
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Product in Real Life") {
    extraCategoryRule = `
- Focus on where the product or service actually shows up in life
- Prioritise use and effect over features
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Quiet Value") {
    extraCategoryRule = `
- Focus on subtle benefits people notice without needing a hard sell
- Keep it understated and real
- This is the one lane where the word "quiet" may be used if it genuinely fits
- Do not overuse quiet-family wording across all 3 posts
`;
  } else if (category === "Standards and Care") {
    extraCategoryRule = `
- Focus on why doing it properly matters
- Show care, detail, standards, or long-term thinking
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Busy Day Ease") {
    extraCategoryRule = `
- Focus on pressure, rush, chaos, or a full day becoming easier
- Keep the life moment clear
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Small Moment Real Value") {
    extraCategoryRule = `
- Focus on an ordinary moment that reveals real value
- Keep it human and believable
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  } else if (category === "Something Real") {
    extraCategoryRule = `
- Focus on something more human, less polished, and more honest
- Let the post feel like it came from a real day, not a campaign plan
- Do NOT use any of these words: quiet, calm, gentle, subtle, steady, small
`;
  }

  try {
    const finalBusinessName =
      initialProfile?.businessProfile?.name || businessName || "Your Brand";

    const ownerKbContext = summarizeOwnerKbForPrompt(finalBusinessName);

    const generationContext = buildGenerationContext({
      mode,
      initialProfile,
      businessName,
      businessSummary,
      businessUrl,
      pastedSourceText,
      manualBusinessContext,
      manualVoiceInput,
      ownerKbContext,
    });

    const weakVoice = Boolean(initialProfile?.sourceProfile?.weakVoiceSource);
    const { lensTitle, lensRules } = getLensRules({
      quickType: quickType || idea || "",
      category,
      weakVoice,
    });

    const { feelingLabel, feelingRules } = getFeelingRules(ownerNudge || "");
    const variationRules = getVariationRules(category);

    const prompt = `
Create exactly 3 X posts.

${generationContext}

QUICK LENS:
${lensTitle}

LENS RULES:
${lensRules}

CURRENT OWNER FEELING / STATE:
${feelingLabel}

FEELING RULES:
${feelingRules}

${variationRules}

LIFE FRAME:
${category}

IDEA:
${clipText(idea || "No idea provided", 300)}

WEEKLY SOURCE MATERIAL:
${clipText(weeklyPosts || "No weekly notes provided", 2000)}

VOICE PROFILE:
${buildVoiceInstructions(voiceProfile)}

CORE RULE:
All 3 posts must sound like the SAME owner / founder / business voice.
Do NOT create 3 different personalities.
The owner must remain the speaker and central force behind the business.

OWNER-CENTRED RULE:
- The owner is the main character behind the operation
- The post should feel aware of the owner's effort, judgment, care, articulation, and signal
- The business should feel human-led, not faceless
- Even when the lens changes, keep the owner as the constant presence behind the words

IMPORTANT VOICE RULE:
- Do NOT write like a customer testimonial
- Do NOT write as if praising the business from the outside
- Write from inside the owner voice, not from the buyer's review perspective
- Even when customer outcome is strong, keep the post framed as owner reflection, owner observation, or owner-led business truth

LENS SEPARATION RULE:
- Make this lens clearly distinct from the other quick buttons
- The difference should be obvious in angle, emphasis, and feeling
- Do NOT let all outputs collapse into the same safe narrative
- Change the viewpoint emphasis, not the speaker

FEELING INTEGRATION RULE:
- Use the current feeling/state to shape the emotional temperature of the post
- Let it affect posture, emphasis, directness, energy, and openness
- Do NOT let it replace the owner voice
- Do NOT let it overpower the selected lens
- Make its influence noticeable but controlled

OWNER KB RULE:
- Use learned owner patterns where useful
- But if today's feeling or current lens points in a different direction, follow the current moment
- Baseline memory should support the owner, not trap them

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
- write as if the owner is reflecting on a real situation

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
- If the voice sample is thin, rely harder on the lens and business truth

AVOID:
- generic motivation clichés
- "unlock your potential"
- "embrace the journey"
- "transform your life"
- empty hype
- obvious ad language
- repeated sentence structures across all 3 posts
- repeating the same opener structure across all 3 posts
- review-style phrasing like "we've used them for years"
- praise framing like "would not go anywhere else"
- recommendation framing like "highly recommend"

${extraCategoryRule}
`;

    let posts = await generatePostsWithRetry(prompt, category);

    if (posts.length < 3) {
      return res.status(500).json({
        error: "Model did not return all 3 post tiers.",
      });
    }

    const filteredGeneric = posts.filter((p) => !soundsTooGeneric(p));
    if (filteredGeneric.length === 3) posts = filteredGeneric;

    posts = enforceFinalQuietRules(posts, category);

    const finalQuietCheck = hardQuietGuard(posts, category);
    if (finalQuietCheck.failed) {
      return res.status(500).json({
        error: "Hard quiet suppression failed after enforcement.",
      });
    }

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
    const hardenedPrompt = `
${clipText(imagePrompt || "", 3500)}

NON-NEGOTIABLE IMAGE SAFETY RULES:
- no readable words anywhere in the image
- no signage text, shop signs, labels, or written words
- no readable logos anywhere in the image
- no fake brand names
- no invented company names on clothing, packaging, signage, or vehicles
- no letters or text on garments
- keep all clothing and objects visually unbranded unless real assets were explicitly provided
`.trim();

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: hardenedPrompt,
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
  ensureOwnerKbFile();
  console.log(`Server running on port ${PORT}`);
});