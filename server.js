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

const PORT = process.env.PORT || 3000;
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

function clipText(text = "", max = 4000) {
  const cleaned = String(text || "").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trim();
}

function normalizeUrl(input) {
  if (!input) return "";
  const trimmed = String(input).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

async function runJsonChat(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("JSON PARSE ERROR:", raw);
    throw new Error("Invalid JSON returned from model.");
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeStringArray(input, maxItems = 8) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(items = [], maxItems = 8) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}

function sentenceCase(text = "") {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function ensureSentence(text = "") {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  if (/[.!?]$/.test(cleaned)) return cleaned;
  return `${cleaned}.`;
}

function pickFirst(items = [], fallback = "") {
  const clean = normalizeStringArray(items, 1);
  return clean[0] || fallback;
}

function getOverallState(score = 0) {
  if (score >= 70) return { label: "Strong", colorKey: "green" };
  if (score >= 40) return { label: "Developing", colorKey: "amber" };
  return { label: "Weak", colorKey: "red" };
}

function getGroupState(score = 0, max = 100) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 70) return { label: "Strong", colorKey: "green" };
  if (pct >= 40) return { label: "Developing", colorKey: "amber" };
  return { label: "Weak", colorKey: "red" };
}

function getScoreBand(score = 0, max = 100, groupKey = "") {
  if (groupKey === "brandCore") {
    if (score >= 21) return "strong";
    if (score >= 12) return "developing";
    return "weak";
  }
  if (groupKey === "marketSignal" || groupKey === "optimization") {
    if (score >= 18) return "strong";
    if (score >= 10) return "developing";
    return "weak";
  }
  if (groupKey === "sourceMix") {
    if (score >= 14) return "strong";
    if (score >= 8) return "developing";
    return "weak";
  }

  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 70) return "strong";
  if (pct >= 40) return "developing";
  return "weak";
}

function confidencePrefix(confidence = "medium") {
  if (confidence === "high") return "YEVIB can see";
  if (confidence === "low") return "The current scan suggests";
  return "YEVIB can reasonably infer";
}

function confidenceActionLead(confidence = "medium") {
  if (confidence === "high") return "The strongest current direction is to";
  if (confidence === "low") return "A sensible next step would be to";
  return "The most useful next move is to";
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
  return String(name || "")
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
      lastFounderGoal: "",
    };
  }

  const entries = Array.isArray(business.entries) ? business.entries : [];
  const lastEntry = entries[entries.length - 1] || {};

  return {
    entryCount: entries.length,
    lastFeeling: lastEntry.ownerFeeling || "",
    lastQuickType: lastEntry.quickType || "",
    lastFounderGoal: lastEntry.founderGoal || "",
  };
}

function saveOwnerChoiceToKb({
  businessName,
  businessSummary,
  founderGoal,
  quickType,
  category,
  ownerFeeling,
  chosenPost,
  voiceSourceText,
  ownerWritingSample,
  manualBusinessContext,
}) {
  const kb = readOwnerKb();
  const cleanBusinessName = clipText(businessName || "Unknown Business", 200);
  const key = businessKey(cleanBusinessName);

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
    founderGoal: clipText(founderGoal || "", 200),
    quickType: clipText(quickType || "", 100),
    category: clipText(category || "", 100),
    ownerFeeling: clipText(ownerFeeling || "", 120),
    chosenPost: clipText(chosenPost || "", 1500),
    voiceSourceText: clipText(voiceSourceText || "", 3500),
    ownerWritingSample: clipText(ownerWritingSample || "", 3500),
    manualBusinessContext: clipText(manualBusinessContext || "", 2500),
  });

  kb.businesses[key].entries = kb.businesses[key].entries.slice(-100);
  writeOwnerKb(kb);

  return { entryCount: kb.businesses[key].entries.length };
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
  const founderGoalCounts = {};
  let totalLength = 0;

  for (const entry of entries) {
    const qt = entry.quickType || "Unknown";
    const feeling = entry.ownerFeeling || "Not specified";
    const founderGoal = entry.founderGoal || "Not specified";
    lensCounts[qt] = (lensCounts[qt] || 0) + 1;
    feelingCounts[feeling] = (feelingCounts[feeling] || 0) + 1;
    founderGoalCounts[founderGoal] = (founderGoalCounts[founderGoal] || 0) + 1;
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

  const topGoals = Object.entries(founderGoalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
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
- Most common founder goals recently: ${topGoals || "none yet"}
- Preferred chosen-post length trend: ${preferredLengthBand}
${recentPostSnippets ? `- Recent chosen post patterns:\n${recentPostSnippets}` : ""}
${ownerWritingSnippets ? `- Owner-written text remembered:\n${ownerWritingSnippets}` : ""}

OWNER KB RULE:
- Learn from these patterns, but do NOT trap the owner inside their usual pattern
- If today's feeling, current lens, or current founder goal points somewhere different, respect that
- Current state can override baseline tone, but not owner identity
`.trim();
}

function stripHtml(html = "") {
  return String(html || "")
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
  const match = String(html || "").match(regex);
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

    links.push({ text: rawText, href: absoluteUrl });
  }

  return links;
}

function dedupeLinksByHref(links = [], maxItems = 20) {
  const seen = new Set();
  const result = [];

  for (const link of links) {
    const href = String(link?.href || "").trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    result.push({
      text: String(link?.text || "").trim(),
      href,
    });
    if (result.length >= maxItems) break;
  }

  return result;
}

function extractSocialLinks(links = []) {
  const result = {
    instagram: "",
    facebook: "",
    tiktok: "",
    youtube: "",
    x: "",
    linkedin: "",
  };

  for (const link of links) {
    const href = String(link?.href || "").toLowerCase();

    if (!result.instagram && href.includes("instagram.com")) result.instagram = link.href;
    else if (!result.facebook && href.includes("facebook.com")) result.facebook = link.href;
    else if (!result.tiktok && href.includes("tiktok.com")) result.tiktok = link.href;
    else if (!result.youtube && (href.includes("youtube.com") || href.includes("youtu.be"))) result.youtube = link.href;
    else if (!result.x && (href.includes("x.com") || href.includes("twitter.com"))) result.x = link.href;
    else if (!result.linkedin && href.includes("linkedin.com")) result.linkedin = link.href;
  }

  return result;
}

function looksLikeTestimonial(text = "") {
  const lower = String(text || "").toLowerCase();

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

  if (/contact|cart|login|account/.test(text)) score -= 4;
  if (/contact|cart|login|account/.test(href)) score -= 4;

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

function classifyLinkText(link = {}) {
  return `${String(link.text || "")} ${String(link.href || "")}`.toLowerCase();
}

function isAboutPage(link = {}) {
  const text = classifyLinkText(link);
  return /about|about-us|our-story|story|founder|mission|who-we-are|why-we-started/.test(text);
}

function isBlogPage(link = {}) {
  const text = classifyLinkText(link);
  return /blog|news|journal|article|articles|insights|stories/.test(text);
}

function isFaqPage(link = {}) {
  const text = classifyLinkText(link);
  return /faq|faqs|help|questions|common-questions|support/.test(text);
}

function isReviewPage(link = {}) {
  const text = classifyLinkText(link);
  return /review|reviews|testimonial|testimonials|case-study|case-studies|results/.test(text);
}

function isActivityPage(link = {}) {
  const text = classifyLinkText(link);
  return /event|events|workshop|workshops|collab|collabs|collaboration|collaborations|community|partner|partners|stockist|stockists|sponsor|sponsorship/.test(
    text
  );
}

function isPressPage(link = {}) {
  const text = classifyLinkText(link);
  return /press|media|featured|feature|as-seen|in-the-media/.test(text);
}

function isProductPage(link = {}) {
  const text = classifyLinkText(link);
  return /shop|product|products|service|services|collection|collections|menu|catalog|store/.test(text);
}

function groupDiscoveredPages(links = []) {
  const grouped = {
    aboutPages: [],
    blogPages: [],
    faqPages: [],
    reviewPages: [],
    activityPages: [],
    pressPages: [],
    productPages: [],
  };

  for (const link of dedupeLinksByHref(links, 80)) {
    if (isAboutPage(link)) grouped.aboutPages.push(link);
    if (isBlogPage(link)) grouped.blogPages.push(link);
    if (isFaqPage(link)) grouped.faqPages.push(link);
    if (isReviewPage(link)) grouped.reviewPages.push(link);
    if (isActivityPage(link)) grouped.activityPages.push(link);
    if (isPressPage(link)) grouped.pressPages.push(link);
    if (isProductPage(link)) grouped.productPages.push(link);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = dedupeLinksByHref(grouped[key], 5);
  }

  return grouped;
}

function extractWebsiteData(html, url) {
  const title =
    getTagContent(html, /<title>([\s\S]*?)<\/title>/i) ||
    getTagContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    "";

  const metaDescription =
    getTagContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    getTagContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    "";

  const h1Matches = [...String(html).matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean);

  const h2Matches = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter(Boolean);

  const pMatches = [...String(html).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
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
  const cleanBase = String(base).replace(/\/+$/, "");
  const cleanSlug = String(slug).replace(/^\/+/, "");
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
  return String(text || "").replace(/\s+/g, " ").trim();
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
  const lower = String(text).toLowerCase();
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
  if (looksLikeTestimonial(lower)) score -= 12;

  if (/i bought|i tried|my husband|highly recommend|worth the price|shipping|5 stars|review/i.test(lower)) {
    score -= 10;
  }

  if (/exclusive access|new releases|promotions|instant alerts|order status|tracking at a glance|subscribe/i.test(lower)) {
    score -= 10;
  }

  return score;
}

function scoreCustomerBlock(text = "") {
  const lower = String(text).toLowerCase();
  let score = 0;

  if (text.length >= 100) score += 1;

  if (
    /i bought|i tried|my experience|i noticed|since using|highly recommend|worth the price|my husband|sleep improved|better than|addicted|our company has been using|we have been using|we've been using|would not go anywhere else|value for money|communication is great|second to none/i.test(
      lower
    )
  ) {
    score += 6;
  }

  if (looksLikeTestimonial(lower)) score += 5;

  if (/our mission|we started|we believe|our story|founder|our goal|our vision|why we started/i.test(lower)) {
    score -= 5;
  }

  return score;
}

function scoreProductBlock(text = "") {
  const lower = String(text).toLowerCase();
  let score = 0;

  if (text.length >= 80) score += 1;

  if (
    /ceremonial grade|organic|sourced from|uji|japan|blend|ingredients|product|powder|tea|matcha|origin|quality|flavour|embroidery|printing|custom uniforms|workwear|apparel|signage/i.test(
      lower
    )
  ) {
    score += 4;
  }

  if (/i bought|highly recommend|my husband|worth the price|review|5 stars/i.test(lower)) {
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
  if (best === founderScore) return { lane: "founderVoice", text: cleaned, score: founderScore };
  if (best === customerScore) return { lane: "customerOutcome", text: cleaned, score: customerScore };
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

  const homepageLinks = homepage?.rawHtml ? extractLinks(homepage.rawHtml, normalizedUrl) : [];
  const dedupedHomepageLinks = dedupeLinksByHref(homepageLinks, 80);
  const socialLinks = extractSocialLinks(dedupedHomepageLinks);
  const groupedPages = groupDiscoveredPages(dedupedHomepageLinks);
  const menuFounderLinks = pickFounderLinks(dedupedHomepageLinks);

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
    allDiscoveredLinks: dedupedHomepageLinks,
    socialLinks,
    groupedPages,
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

function inferTrustSignals({ groupedPages = {}, lanes = {}, pages = [] }) {
  const signals = [];
  const productLane = lanes?.brandProductTruth || [];
  const pageText = pages
    .map((page) => `${page?.title || ""} ${(page?.headings || []).join(" ")} ${page?.metaDescription || ""}`)
    .join(" ")
    .toLowerCase();
  const productText = productLane.join(" ").toLowerCase();

  if ((groupedPages.aboutPages || []).length > 0) signals.push("Founder or about page is publicly visible");
  if ((groupedPages.reviewPages || []).length > 0) signals.push("Review or testimonial pages were detected");
  if (/organic|traditional|sourced|origin|quality|process|craft|standard|certified|ceremonial/.test(productText)) {
    signals.push("Product or process truth appears in the source material");
  }
  if (/organic|traditional|sourced|origin|quality|process|craft|standard|certified|ceremonial/.test(pageText)) {
    signals.push("Origin or sourcing language appears on the public site");
  }

  return uniqueStrings(signals, 5);
}

function inferEducationSignals({ groupedPages = {}, lanes = {}, pages = [] }) {
  const signals = [];
  const productLane = lanes?.brandProductTruth || [];
  const pageText = pages
    .map((page) => `${page?.title || ""} ${(page?.headings || []).join(" ")} ${page?.metaDescription || ""}`)
    .join(" ")
    .toLowerCase();
  const productText = productLane.join(" ").toLowerCase();

  if ((groupedPages.faqPages || []).length > 0) signals.push("FAQ or help content is present");
  if ((groupedPages.blogPages || []).length > 0) signals.push("Blog or article content appears to exist");
  if (/how to|benefits|faq|guide|learn|ritual|what is|why it matters|process|brewing|preparation/.test(pageText + " " + productText)) {
    signals.push("Educational or process-based language is already present");
  }

  return uniqueStrings(signals, 5);
}

function inferActivitySignals({ groupedPages = {}, pages = [] }) {
  const signals = [];
  const pageText = pages
    .map((page) => `${page?.title || ""} ${(page?.headings || []).join(" ")} ${page?.metaDescription || ""}`)
    .join(" ")
    .toLowerCase();

  if ((groupedPages.activityPages || []).length > 0) signals.push("Activity or collaboration pages were detected");
  if ((groupedPages.pressPages || []).length > 0) signals.push("Press or media pages were detected");
  if ((groupedPages.blogPages || []).length > 0) signals.push("News or journal content suggests ongoing public activity");
  if (/event|workshop|community|collab|partner|stockist|featured|press|media/.test(pageText)) {
    signals.push("The public site shows signs of wider ecosystem activity");
  }

  return uniqueStrings(signals, 5);
}

function inferFounderVisibilitySignals({ groupedPages = {}, founderText = "", pages = [] }) {
  const signals = [];
  const founderLower = String(founderText || "").toLowerCase();
  const pageText = pages
    .map((page) => `${page?.title || ""} ${(page?.headings || []).join(" ")} ${page?.metaDescription || ""}`)
    .join(" ")
    .toLowerCase();

  if ((groupedPages.aboutPages || []).length > 0) signals.push("Founder or story pages were detected");
  if (/we started|our story|why we started|founder|i started|we believe/.test(founderLower)) {
    signals.push("Founder voice appears in the current source material");
  }
  if (!founderText || founderText.length < 180) {
    signals.push("Founder presence is still limited in the current public signal");
  }
  if (/founder|our story|why we started|about/.test(pageText)) {
    signals.push("The public site carries at least some founder or story signal");
  }

  return uniqueStrings(signals, 5);
}

function inferSourceConfidence({
  channelsFound = {},
  groupedPages = {},
  pagesScanned = 0,
  hasOwnerWriting = false,
}) {
  let score = 0;

  if (pagesScanned > 0) score += 1;
  if ((groupedPages.aboutPages || []).length > 0) score += 1;
  if ((groupedPages.productPages || []).length > 0) score += 1;
  if (Object.values(channelsFound).some(Boolean)) score += 1;
  if (hasOwnerWriting) score += 1;
  if (
    (groupedPages.blogPages || []).length > 0 ||
    (groupedPages.faqPages || []).length > 0 ||
    (groupedPages.reviewPages || []).length > 0 ||
    (groupedPages.activityPages || []).length > 0 ||
    (groupedPages.pressPages || []).length > 0
  ) {
    score += 1;
  }

  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
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

function buildRecommendedFocus({
  founderGoal = "",
  contentProfile = {},
  discoveryProfile = {},
  brandProductTruth = {},
  customerOutcome = {},
  sourceProfile = {},
}) {
  const goal = String(founderGoal || "").toLowerCase();
  const category = String(contentProfile?.suggestedCategory || "");
  const offers = normalizeStringArray(brandProductTruth?.offers, 5);
  const audience = normalizeStringArray(brandProductTruth?.audience, 5);
  const lifeMoments = normalizeStringArray(customerOutcome?.lifeMoments, 5);
  const weakVoice = Boolean(sourceProfile?.weakVoiceSource);
  const trustSignals = normalizeStringArray(discoveryProfile?.trustSignals, 5);
  const educationSignals = normalizeStringArray(discoveryProfile?.educationSignals, 5);
  const activitySignals = normalizeStringArray(discoveryProfile?.activitySignals, 5);

  if (/posting consistency/.test(goal)) {
    return "The business already has enough material to post from more regularly. Turn the strongest current theme into one repeatable weekly format.";
  }
  if (/clarify brand voice/.test(goal)) {
    return weakVoice
      ? "Bring more founder-written language into the public brand so the business sounds more distinct and less generic."
      : "Tighten the public-facing language so the founder voice carries more clearly across the business.";
  }
  if (/educational/.test(goal)) {
    return educationSignals.length > 0
      ? "The business already shows useful teaching signal. Turn that into clearer educational content that explains why the work matters."
      : "Use product truth and process detail to create simple educational content the audience can learn from quickly.";
  }
  if (/trust/.test(goal)) {
    return trustSignals.length > 0
      ? "The business already has trust signal. Surface it more clearly so it does more public work."
      : "Make standards, proof, and process more visible so the business feels more credible faster.";
  }
  if (/promote products or services/.test(goal)) {
    return offers.length > 0
      ? "Make the offer easier to understand through real-life use cases instead of relying on feature description alone."
      : "Clarify the offer in practical terms so people can understand what the business does and why it matters.";
  }
  if (/founder presence/.test(goal)) {
    return "Make the founder more visible in the public-facing language of the brand so the business feels more human-led and memorable.";
  }

  if (category === "Everyday Ritual" || lifeMoments.length > 0) {
    return "Your business already lends itself to repeat-use content. Turn that into one steady content theme built around real daily use.";
  }
  if (educationSignals.length > 0) {
    return "There is already enough knowledge in the business to support clearer educational content. Turn that into a repeatable public asset.";
  }
  if (activitySignals.length > 0) {
    return "Use the business activity that already exists and make it more visible so the brand feels more active and current.";
  }
  if (audience.length > 0) {
    return "Speak more directly to the audience the business already appears to serve so the public signal becomes more legible.";
  }

  return "Take the clearest existing business truth and turn it into one repeatable public-facing theme the brand can return to consistently.";
}

function adaptRecommendedFocusByBand(focus = "", band = "developing", founderGoal = "") {
  const clean = String(focus || "").trim();
  if (!clean) return "";

  if (band === "weak") return clean;

  const lower = clean.toLowerCase();
  const goal = String(founderGoal || "").toLowerCase();

  if (band === "strong") {
    if (lower.includes("already has trust signal") || lower.includes("surface it more clearly")) {
      return "Use the trust signal already present in the business more deliberately so it carries more public weight.";
    }
    if (lower.includes("already shows useful teaching signal")) {
      return "Turn the teaching signal already present in the business into a stronger public advantage through clearer educational content.";
    }
    if (lower.includes("enough material to post from more regularly")) {
      return "Use the strongest current theme as a repeatable weekly advantage so the business posts with more momentum and less friction.";
    }
    if (lower.includes("bring more founder-written language")) {
      return "Use more founder-led language deliberately so the business feels even more distinct and human in public.";
    }
    if (lower.includes("tighten the public-facing language")) {
      return "Carry the founder voice more consistently across the public-facing language so it becomes a stronger brand advantage.";
    }
    if (lower.includes("make the offer easier to understand")) {
      return "Turn the already-visible offer into clearer real-life messaging so it carries more weight publicly.";
    }
    if (lower.includes("make the founder more visible")) {
      return "Use the founder signal already present more deliberately so it carries more weight across the public brand.";
    }
    if (lower.includes("already lends itself to repeat-use content")) {
      return "Turn the repeat-use nature of the business into a stronger public advantage through one repeatable content theme.";
    }
    if (lower.includes("already enough knowledge")) {
      return "Use the knowledge already present in the business as a stronger public advantage through repeatable educational content.";
    }
    if (lower.includes("use the business activity that already exists")) {
      return "Turn the business activity already present into more visible public momentum so it does more work for the brand.";
    }
    if (lower.includes("speak more directly to the audience")) {
      return "Use the audience signal already present to make the public message land more clearly and carry more weight.";
    }
    if (lower.includes("take the clearest existing business truth")) {
      return "Turn the clearest existing business truth into a repeatable public advantage the brand can build from consistently.";
    }

    if (/posting consistency/.test(goal)) {
      return "Use the strongest current direction as a repeatable weekly advantage so the business posts with more consistency and less drag.";
    }

    return clean;
  }

  if (band === "developing") {
    if (lower.includes("already has trust signal") || lower.includes("surface it more clearly")) {
      return "Bring the trust signal already present in the business forward more clearly so it does more public work.";
    }
    if (lower.includes("already shows useful teaching signal")) {
      return "Sharpen the teaching signal already present in the business into clearer educational content.";
    }
    if (lower.includes("enough material to post from more regularly")) {
      return "Structure the strongest current theme into a repeatable weekly format so posting becomes easier to sustain.";
    }
    if (lower.includes("bring more founder-written language")) {
      return "Bring more founder-led language forward so the business sounds more distinct in public.";
    }
    if (lower.includes("tighten the public-facing language")) {
      return "Tighten the public-facing language so the founder voice carries more clearly across the business.";
    }
    if (lower.includes("make the offer easier to understand")) {
      return "Sharpen how the offer is explained so its real-life value lands more clearly.";
    }
    if (lower.includes("make the founder more visible")) {
      return "Strengthen how the founder shows up in the public-facing language of the brand.";
    }
    if (lower.includes("already lends itself to repeat-use content")) {
      return "Build the repeat-use nature of the business into one clearer recurring content theme.";
    }
    if (lower.includes("already enough knowledge")) {
      return "Turn the knowledge already present in the business into clearer educational content people can follow easily.";
    }
    if (lower.includes("use the business activity that already exists")) {
      return "Make the business activity already present more visible so the brand feels more current and active.";
    }
    if (lower.includes("speak more directly to the audience")) {
      return "Speak more directly to the audience already visible in the business signal so the message lands more clearly.";
    }
    if (lower.includes("take the clearest existing business truth")) {
      return "Structure the clearest existing business truth into a repeatable public-facing theme.";
    }

    if (/posting consistency/.test(goal)) {
      return "Structure the strongest current direction into a repeatable weekly format so the business posts more consistently.";
    }

    return clean;
  }

  return clean;
}

function inferAdvisorSnapshot({
  founderGoal,
  founderVoice,
  brandProductTruth,
  customerOutcome,
  sourceProfile,
  discoveryProfile,
  contentProfile,
}) {
  const offers = normalizeStringArray(brandProductTruth?.offers, 6);
  const audience = normalizeStringArray(brandProductTruth?.audience, 6);
  const facts = normalizeStringArray(brandProductTruth?.facts, 6);
  const lifeMoments = normalizeStringArray(customerOutcome?.lifeMoments, 6);
  const outcomes = normalizeStringArray(customerOutcome?.valueOutcomes, 6);
  const doRules = normalizeStringArray(founderVoice?.doRules, 6);
  const weakVoice = Boolean(sourceProfile?.weakVoiceSource);

  const trustSignals = normalizeStringArray(discoveryProfile?.trustSignals, 6);
  const educationSignals = normalizeStringArray(discoveryProfile?.educationSignals, 6);
  const activitySignals = normalizeStringArray(discoveryProfile?.activitySignals, 6);
  const founderVisibilitySignals = normalizeStringArray(discoveryProfile?.founderVisibilitySignals, 6);
  const channelsFound = discoveryProfile?.channelsFound || {};
  const hasChannels = Object.values(channelsFound).some(Boolean);

  const strengths = [];
  const weakPoints = [];
  const blindSpots = [];
  const opportunities = [];

  if (facts.length > 0) strengths.push("The business has real product or service substance that can be turned into public signal");
  if (offers.length > 0) strengths.push("The offer is clear enough to support stronger value-led content");
  if (audience.length > 0) strengths.push("The audience is visible enough to shape more direct communication");
  if (lifeMoments.length > 0 || outcomes.length > 0) {
    strengths.push("There are real-world use cues that can make the content more believable");
  }
  if (doRules.length > 0 && !weakVoice) {
    strengths.push("There is enough founder voice to keep the brand human-led rather than generic");
  }
  if (trustSignals.length > 0) {
    strengths.push("The business already has trust markers that can do more public work");
  }
  if (educationSignals.length > 0) {
    strengths.push("There is teaching value in the business that can become stronger educational content");
  }
  if (hasChannels) {
    strengths.push("The business has at least some visible footprint beyond the website");
  }

  if (weakVoice) weakPoints.push("Founder voice is still too thin, so the public brand risks sounding more product-led than person-led");
  if (offers.length === 0) weakPoints.push("The offer is not yet clear enough in the current source set");
  if (audience.length === 0) weakPoints.push("Audience signal is still too weak to guide communication confidently");
  if (lifeMoments.length === 0) weakPoints.push("The business is not yet showing enough real-life use signal");
  if (!hasChannels) weakPoints.push("The public footprint still looks narrow outside the website");
  if (founderVisibilitySignals.some((s) => /limited/i.test(s))) {
    weakPoints.push("Founder presence is still not doing enough visible work in public");
  }

  if (weakVoice) blindSpots.push("The founder may have more perspective than the public-facing brand currently shows");
  if (offers.length > 0 && lifeMoments.length === 0) {
    blindSpots.push("The business may explain what it is, but not yet where it fits in everyday life");
  }
  if (audience.length > 0 && outcomes.length === 0) {
    blindSpots.push("The brand may know who it serves, but not yet show enough visible proof of the result");
  }
  if (facts.length > 0) {
    blindSpots.push("There may be more standards, process, or product truth available than the public brand is currently using");
  }
  if (activitySignals.length > 0) {
    blindSpots.push("The business appears more active than its current public presentation suggests");
  }

  if (facts.length > 0) {
    opportunities.push("Turn the strongest product or service truth into clearer public-facing content");
  }
  if (lifeMoments.length > 0) {
    opportunities.push("Use real customer-life situations as stronger content openings");
  }
  if (trustSignals.length > 0) {
    opportunities.push("Bring trust and proof signal forward so it carries more weight publicly");
  }
  if (educationSignals.length > 0) {
    opportunities.push("Convert existing knowledge into clearer educational content");
  }
  if (activitySignals.length > 0) {
    opportunities.push("Make visible business activity do more public work for the brand");
  }
  if (weakVoice) {
    opportunities.push("Add more founder-led language so the business feels more distinct and human");
  }

  const recommendedFocus = buildRecommendedFocus({
    founderGoal,
    contentProfile,
    discoveryProfile,
    brandProductTruth,
    customerOutcome,
    sourceProfile,
  });

  return {
    strengths: uniqueStrings(strengths, 5),
    weakPoints: uniqueStrings(weakPoints, 5),
    blindSpots: uniqueStrings(blindSpots, 5),
    opportunities: uniqueStrings(opportunities, 5),
    recommendedFocus,
  };
}

function buildIntelligenceRead({
  advisorSnapshot = {},
  discoveryProfile = {},
}) {
  const confidence = discoveryProfile?.sourceConfidence || "medium";
  const lead = confidencePrefix(confidence);
  const strong = pickFirst(
    advisorSnapshot?.strengths,
    "the business has at least one credible signal to build from"
  );
  const weak = pickFirst(
    advisorSnapshot?.weakPoints,
    "parts of the public signal are still thinner than they should be"
  );
  const focus =
    advisorSnapshot?.recommendedFocus ||
    "clarify the strongest current business truth and use it more consistently";

  const sentence1 = `${lead} that ${strong.toLowerCase()}.`;
  const sentence2 = `What looks weaker right now is that ${weak.toLowerCase()}.`;
  const sentence3 = `${confidenceActionLead(confidence)} ${focus.replace(/\.$/, "").toLowerCase()}.`;

  return `${sentence1} ${sentence2} ${sentence3}`;
}

function qualitySentenceList(items = [], maxItems = 3) {
  return uniqueStrings(
    normalizeStringArray(items, maxItems).map((item) => ensureSentence(sentenceCase(item))),
    maxItems
  );
}

function limitWeaknesses(items = [], maxItems = 2) {
  return uniqueStrings(
    normalizeStringArray(items, maxItems).map((item) => ensureSentence(sentenceCase(item))),
    maxItems
  );
}

function buildBrandCoreGroup({
  businessProfile = {},
  founderGoal = "",
  founderVoice = {},
  sourceProfile = {},
  discoveryProfile = {},
}) {
  let score = 0;
  const max = 30;
  const strengths = [];
  const weaknesses = [];

  const businessSummary = String(businessProfile?.summary || "").trim();
  const voiceSummary = String(founderVoice?.voiceSummary || "").trim();
  const weakVoice = Boolean(sourceProfile?.weakVoiceSource);
  const founderSignals = normalizeStringArray(discoveryProfile?.founderVisibilitySignals, 6);
  const hasFounderPage = founderSignals.some((s) => /page|story/i.test(s));
  const founderLimited = founderSignals.some((s) => /limited/i.test(s));
  const doRules = normalizeStringArray(founderVoice?.doRules, 6);
  const confidence = discoveryProfile?.sourceConfidence || "medium";

  if (businessSummary.length >= 80) {
    score += 8;
    strengths.push("The business identity is clear enough to anchor the scan");
  } else {
    weaknesses.push("The core business story is still too thin");
  }

  if (voiceSummary.length >= 60 && !weakVoice) {
    score += 8;
    strengths.push("Founder voice is strong enough to make the brand feel more distinct");
  } else if (voiceSummary.length >= 30) {
    score += 4;
    weaknesses.push("There is some founder voice, but it is not yet carrying enough weight");
  } else {
    weaknesses.push("Founder voice is still too weak or too generic");
  }

  if (String(founderGoal || "").trim()) {
    score += 4;
    strengths.push("The founder goal gives the scan a clear direction");
  } else {
    weaknesses.push("The scan is working without a clear founder goal");
  }

  if (hasFounderPage) {
    score += 5;
    strengths.push("Founder or story pages are visible publicly");
  } else if (founderLimited) {
    score += 1;
    weaknesses.push("Founder presence is still limited in the public-facing brand");
  } else {
    weaknesses.push("Founder visibility is not yet clear enough");
  }

  if (doRules.length >= 2) {
    score += 5;
    strengths.push("The brand already carries some founder-led behavior in its language");
  } else {
    weaknesses.push("The public brand still risks sounding more generic than founder-led");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "brandCore");
  const state = getGroupState(score, max);
  const lead = confidencePrefix(confidence);
  const goal = String(founderGoal || "").toLowerCase();

  let summary = "";
  if (band === "strong") {
    summary = `${lead} a clear brand core that is already doing useful public work. The founder signal is visible enough to be used more deliberately, not rebuilt from scratch.`;
  } else if (band === "developing") {
    summary = `${lead} a recognizable brand core, but founder presence or message clarity is still not carrying enough weight consistently.`;
  } else {
    summary = `${lead} only a partial brand core right now, which makes the business feel less distinct than it could.`;
  }

  let nextMove = "";
  if (band === "strong") {
    if (/founder presence/.test(goal) || weakVoice || founderLimited) {
      nextMove = "Use the founder signal more deliberately so it carries more weight across the public brand.";
    } else if (/clarify brand voice/.test(goal)) {
      nextMove = "Carry the founder voice more consistently across the public-facing language so the brand feels even more distinct.";
    } else {
      nextMove = "Turn the founder-led side of the brand into an even clearer public advantage.";
    }
  } else if (band === "developing") {
    if (/founder presence/.test(goal) || weakVoice || founderLimited) {
      nextMove = "Strengthen the founder-led side of the brand so the public identity feels clearer and more consistent.";
    } else if (/clarify brand voice/.test(goal)) {
      nextMove = "Tighten the public language so the founder voice carries more clearly across the business.";
    } else {
      nextMove = "Sharpen the founder-led side of the brand so the public identity feels more legible and consistent.";
    }
  } else {
    if (/founder presence/.test(goal) || weakVoice || founderLimited) {
      nextMove = "Make the founder more visible in the public-facing language of the brand.";
    } else if (/clarify brand voice/.test(goal)) {
      nextMove = "Clarify the public language so the founder voice is easier to recognise.";
    } else {
      nextMove = "Build a clearer founder-led brand core so the business feels more distinct publicly.";
    }
  }

  return {
    key: "brandCore",
    title: "Brand Core",
    score,
    max,
    stateLabel: state.label,
    colorKey: state.colorKey,
    summary: ensureSentence(summary),
    strengths: qualitySentenceList(strengths, 3),
    weaknesses: limitWeaknesses(weaknesses, 2),
    nextMove: ensureSentence(nextMove),
  };
}

function buildMarketSignalGroup({
  founderGoal = "",
  brandProductTruth = {},
  customerOutcome = {},
  discoveryProfile = {},
}) {
  let score = 0;
  const max = 25;
  const strengths = [];
  const weaknesses = [];

  const offers = normalizeStringArray(brandProductTruth?.offers, 6);
  const audience = normalizeStringArray(brandProductTruth?.audience, 6);
  const trustSignals = normalizeStringArray(discoveryProfile?.trustSignals, 6);
  const educationSignals = normalizeStringArray(discoveryProfile?.educationSignals, 6);
  const activitySignals = normalizeStringArray(discoveryProfile?.activitySignals, 6);
  const lifeMoments = normalizeStringArray(customerOutcome?.lifeMoments, 6);
  const confidence = discoveryProfile?.sourceConfidence || "medium";

  if (offers.length > 0) {
    score += 6;
    strengths.push("The offer is visible enough to work with");
  } else {
    weaknesses.push("The offer is not yet clear enough in public-facing material");
  }

  if (audience.length > 0) {
    score += 5;
    strengths.push("The audience is legible enough to shape clearer messaging");
  } else {
    weaknesses.push("Audience signal is still too weak");
  }

  if (trustSignals.length > 0) {
    score += 5;
    strengths.push("Trust and proof markers are already present");
  } else {
    weaknesses.push("Trust signal is still too hidden or too thin");
  }

  if (educationSignals.length > 0) {
    score += 4;
    strengths.push("The business has educational signal it can use more clearly");
  } else {
    weaknesses.push("Educational signal is not yet clearly surfaced");
  }

  if (activitySignals.length > 0 || lifeMoments.length > 0) {
    score += 5;
    strengths.push("There are enough real-world cues to make the brand feel believable");
  } else {
    weaknesses.push("The public brand still lacks enough real-world context");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "marketSignal");
  const state = getGroupState(score, max);
  const lead = confidencePrefix(confidence);
  const goal = String(founderGoal || "").toLowerCase();

  let summary = "";
  if (band === "strong") {
    summary = `${lead} enough offer, audience, and trust signal to understand how the business lands publicly. This part of the brand is already visible enough to be leveraged further.`;
  } else if (band === "developing") {
    summary = `${lead} a developing market signal, but some of the business value is still not visible enough yet.`;
  } else {
    summary = `${lead} only a thin market signal right now, which makes the public read less clear than it should be.`;
  }

  let nextMove = "";
  if (band === "strong") {
    if (/promote products or services/.test(goal)) {
      nextMove = "Turn the already-visible offer into clearer real-world messaging so it carries more weight publicly.";
    } else if (/build more trust/.test(goal)) {
      nextMove = "Use the proof and standards already present here more deliberately so they carry more public weight.";
    } else if (/educational/.test(goal) && educationSignals.length > 0) {
      nextMove = "Leverage the existing market signal to support stronger educational content that explains why the offer matters.";
    } else {
      nextMove = "Make the already-visible offer do more public work by tying it more clearly to real-life value.";
    }
  } else if (band === "developing") {
    if (/promote products or services/.test(goal)) {
      nextMove = "Sharpen how the offer is explained so its real-world value lands more clearly.";
    } else if (/build more trust/.test(goal)) {
      nextMove = "Bring proof, process, and standards forward so the business feels more credible at first glance.";
    } else if (/educational/.test(goal) && educationSignals.length > 0) {
      nextMove = "Turn the business knowledge already visible here into clearer educational content.";
    } else {
      nextMove = "Make the offer and its real-world value easier to understand in public-facing content.";
    }
  } else {
    if (/promote products or services/.test(goal)) {
      nextMove = "Clarify the offer through practical use and plain value, not just feature description.";
    } else if (/build more trust/.test(goal)) {
      nextMove = "Surface proof, process, and standards more clearly so the business feels more credible quickly.";
    } else if (/educational/.test(goal) && educationSignals.length > 0) {
      nextMove = "Use the early educational signal here to make the offer easier to understand.";
    } else {
      nextMove = "Make the offer and its real-world value easier to understand in public-facing content.";
    }
  }

  return {
    key: "marketSignal",
    title: "Market Signal",
    score,
    max,
    stateLabel: state.label,
    colorKey: state.colorKey,
    summary: ensureSentence(summary),
    strengths: qualitySentenceList(strengths, 3),
    weaknesses: limitWeaknesses(weaknesses, 2),
    nextMove: ensureSentence(nextMove),
  };
}

function buildOptimizationGroup({
  founderGoal = "",
  advisorSnapshot = {},
  contentProfile = {},
  discoveryProfile = {},
}) {
  let score = 0;
  const max = 25;
  const strengths = [];
  const weaknesses = [];

  const opportunities = normalizeStringArray(advisorSnapshot?.opportunities, 6);
  const blindSpots = normalizeStringArray(advisorSnapshot?.blindSpots, 6);
  const recommendedFocus = String(advisorSnapshot?.recommendedFocus || "").trim();
  const suggestedCategory = String(contentProfile?.suggestedCategory || "").trim();
  const suggestedIdea = String(contentProfile?.suggestedIdea || "").trim();
  const confidence = discoveryProfile?.sourceConfidence || "medium";

  if (opportunities.length >= 2) {
    score += 8;
    strengths.push("YEVIB can already point to specific improvement opportunities");
  } else if (opportunities.length === 1) {
    score += 4;
    weaknesses.push("There is one useful opportunity, but the diagnosis is not fully developed yet");
  } else {
    weaknesses.push("Optimization guidance is still too general");
  }

  if (recommendedFocus.length >= 40) {
    score += 6;
    strengths.push("There is a clear direction for what the business should do next");
  } else {
    weaknesses.push("The next direction is still too soft or too broad");
  }

  if (blindSpots.length > 0) {
    score += 5;
    strengths.push("The scan can already see underused areas of the business signal");
  } else {
    weaknesses.push("Blind-spot detection is still limited");
  }

  if (suggestedCategory || suggestedIdea) {
    score += 3;
    strengths.push("The scan can suggest a practical content direction");
  } else {
    weaknesses.push("The content direction is not yet sharp enough");
  }

  if (String(founderGoal || "").trim()) {
    score += 3;
    strengths.push("The advice is being shaped by the founder goal rather than only generic scan logic");
  } else {
    weaknesses.push("Advice would improve with a clearer founder goal");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "optimization");
  const state = getGroupState(score, max);
  const lead = confidencePrefix(confidence);

  let summary = "";
  if (band === "strong") {
    summary = `${lead} enough business signal to give useful next-step guidance rather than only broad suggestions. This part of the diagnosis is ready to be used as leverage, not just correction.`;
  } else if (band === "developing") {
    summary = `${lead} some grounded direction, but parts of the diagnosis still need stronger signal underneath them.`;
  } else {
    summary = `${lead} only an early optimization read right now, so the advice is still lighter than it could be.`;
  }

  let nextMove = "";
  const scoreAwareFocus = adaptRecommendedFocusByBand(recommendedFocus, band, founderGoal);

  if (band === "strong") {
    if (scoreAwareFocus) {
      nextMove = scoreAwareFocus;
    } else if (/posting consistency/i.test(founderGoal || "")) {
      nextMove = "Use the strongest current opportunity as a leverage point and turn it into a repeatable weekly advantage.";
    } else {
      nextMove = "Use the strongest current opportunity as a leverage point and turn it into a repeatable public advantage.";
    }
  } else if (band === "developing") {
    if (scoreAwareFocus) {
      nextMove = scoreAwareFocus;
    } else if (/posting consistency/i.test(founderGoal || "")) {
      nextMove = "Structure the strongest opportunity into a clearer weekly next-step direction.";
    } else {
      nextMove = "Structure the strongest opportunity into a clearer next-step direction.";
    }
  } else {
    if (scoreAwareFocus) {
      nextMove = scoreAwareFocus;
    } else if (/posting consistency/i.test(founderGoal || "")) {
      nextMove = "Clarify the next direction so the business has a more usable weekly improvement path.";
    } else {
      nextMove = "Clarify the next direction so the business has a more usable improvement path.";
    }
  }

  return {
    key: "optimization",
    title: "Optimization",
    score,
    max,
    stateLabel: state.label,
    colorKey: state.colorKey,
    summary: ensureSentence(summary),
    strengths: qualitySentenceList(strengths, 3),
    weaknesses: limitWeaknesses(weaknesses, 2),
    nextMove: ensureSentence(nextMove),
  };
}

function buildSourceMixGroup({
  founderGoal = "",
  sourceProfile = {},
  discoveryProfile = {},
  debug = {},
  hasOwnerWriting = false,
}) {
  let score = 0;
  const max = 20;
  const strengths = [];
  const weaknesses = [];

  const channelsFound = discoveryProfile?.channelsFound || {};
  const sourceConfidence = String(discoveryProfile?.sourceConfidence || "").trim().toLowerCase();
  const pagesScanned = Number(debug?.pagesScanned || 0);
  const hasChannels = Object.values(channelsFound).some(Boolean);
  const broaderDiscovery =
    (discoveryProfile?.sourcePages?.aboutPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.blogPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.faqPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.reviewPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.activityPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.pressPages || []).length > 0 ||
    (discoveryProfile?.sourcePages?.productPages || []).length > 0;

  if (sourceProfile?.urlUsed) {
    score += 4;
    strengths.push("The scan has a direct website source to work from");
  } else {
    weaknesses.push("The scan does not have a direct website source");
  }

  if (sourceProfile?.pastedTextUsed || hasOwnerWriting) {
    score += 4;
    strengths.push("Owner-written material strengthens the local signal");
  } else {
    weaknesses.push("The scan is working without enough owner-written source material");
  }

  if (hasChannels) {
    score += 4;
    strengths.push("There is at least some wider public signal beyond the site");
  } else {
    weaknesses.push("The wider public signal is still narrow");
  }

  if (broaderDiscovery || pagesScanned >= 3) {
    score += 4;
    strengths.push("The scan is drawing from more than one page or page type");
  } else {
    weaknesses.push("The source base is still too narrow");
  }

  if (sourceConfidence === "high") {
    score += 4;
    strengths.push("The current source base gives YEVIB a stronger read");
  } else if (sourceConfidence === "medium") {
    score += 2;
    strengths.push("The current source base is enough for a workable first pass");
  } else {
    weaknesses.push("The current read is still running on partial signal");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "sourceMix");
  const state = getGroupState(score, max);

  let summary = "";
  if (band === "strong") {
    summary = "YEVIB is working from a broad enough source mix to make the current scan feel more grounded. This base can now be extended for sharper reads, not just basic reliability.";
  } else if (band === "developing") {
    summary = "The source mix is workable, but the scan would feel stronger with more direct and public signal.";
  } else {
    summary = "The current diagnosis is still constrained by a narrow source mix.";
  }

  let nextMove = "";
  if (band === "strong") {
    if (!sourceProfile?.pastedTextUsed && !hasOwnerWriting) {
      nextMove = "Extend the source base further with owner-written material so YEVIB can make even sharper reads.";
    } else if (!hasChannels) {
      nextMove = "Extend the discoverable public footprint so YEVIB can read the business from an even broader source base.";
    } else if (/founder presence/i.test(founderGoal || "")) {
      nextMove = "Use more founder-led public signal so the current source base reflects the human side of the business even better.";
    } else {
      nextMove = "Extend the source base further so YEVIB can make even sharper, more precise reads.";
    }
  } else if (band === "developing") {
    if (!sourceProfile?.pastedTextUsed && !hasOwnerWriting) {
      nextMove = "Add more owner-written material so the business sounds more distinct and less inferred.";
    } else if (!hasChannels) {
      nextMove = "Broaden the discoverable public footprint so YEVIB can read the business from a stronger source base.";
    } else if (/founder presence/i.test(founderGoal || "")) {
      nextMove = "Use more founder-led public signal so the source base reflects the human side of the business better.";
    } else {
      nextMove = "Broaden the source base so the next diagnosis carries more confidence and more precision.";
    }
  } else {
    if (!sourceProfile?.pastedTextUsed && !hasOwnerWriting) {
      nextMove = "Add more owner-written material so YEVIB has a stronger local source to work from.";
    } else if (!hasChannels) {
      nextMove = "Strengthen the discoverable public footprint so YEVIB can read the business from a broader source base.";
    } else if (/founder presence/i.test(founderGoal || "")) {
      nextMove = "Add more founder-led public signal so the source base reflects the human side of the business better.";
    } else {
      nextMove = "Add more direct and public signal so YEVIB can build a more reliable diagnosis.";
    }
  }

  return {
    key: "sourceMix",
    title: "Source Mix",
    score,
    max,
    stateLabel: state.label,
    colorKey: state.colorKey,
    summary: ensureSentence(summary),
    strengths: qualitySentenceList(strengths, 3),
    weaknesses: limitWeaknesses(weaknesses, 2),
    nextMove: ensureSentence(nextMove),
  };
}

function buildGroupedSnapshotScoring({
  businessProfile = {},
  founderGoal = "",
  contentProfile = {},
  sourceProfile = {},
  founderVoice = {},
  customerOutcome = {},
  brandProductTruth = {},
  discoveryProfile = {},
  advisorSnapshot = {},
  debug = {},
  hasOwnerWriting = false,
}) {
  const brandCore = buildBrandCoreGroup({
    businessProfile,
    founderGoal,
    founderVoice,
    sourceProfile,
    discoveryProfile,
  });

  const marketSignal = buildMarketSignalGroup({
    founderGoal,
    brandProductTruth,
    customerOutcome,
    discoveryProfile,
  });

  const optimization = buildOptimizationGroup({
    founderGoal,
    advisorSnapshot,
    contentProfile,
    discoveryProfile,
  });

  const sourceMix = buildSourceMixGroup({
    founderGoal,
    sourceProfile,
    discoveryProfile,
    debug,
    hasOwnerWriting,
  });

  const totalScore = clampNumber(
    brandCore.score + marketSignal.score + optimization.score + sourceMix.score,
    0,
    100
  );
  const overall = getOverallState(totalScore);

  return {
    brandSignalState: {
      score: totalScore,
      max: 100,
      label: overall.label,
      colorKey: overall.colorKey,
    },
    snapshotGroups: {
      brandCore,
      marketSignal,
      optimization,
      sourceMix,
    },
  };
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
- If the input sounds like a customer testimonial, do NOT preserve the testimonial perspective
- Convert the underlying brand traits into neutral brand voice guidance
- Never write the voice summary from the perspective of a customer praising the business
- Focus on beliefs, standards, purpose, care, reliability, and reflection style
- Avoid loyalty/review phrasing like "we've used them for years", "highly recommend", "second to none", "value for money"

INPUT:
"""
${clipText(input || "", 5000)}
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
${clipText(input || "", 3000)}
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
${clipText(input || "", 3000)}
"""
`;

const sourceProfilePrompt = ({
  mode,
  businessName,
  founderGoal,
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
    "suggestedCategory": "one of: Daily Relief, Everyday Ritual, Founder Reflection, Product in Real Life, Quiet Value, Standards and Care, Busy Day Ease, Small Moment Real Value, Something Real",
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
- Do not mistake testimonial language for founder voice
- If founder lane is weak, infer business tone from business summary and product truth instead
- Use the founder goal to bias the suggested category and suggested idea where it genuinely fits
- The summary should feel useful to a founder, not like generic catalog copy

BUSINESS NAME PROVIDED:
"""
${clipText(businessName || "none provided", 200)}
"""

FOUNDER GOAL PROVIDED:
"""
${clipText(founderGoal || "none provided", 300)}
"""

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

function buildGenerationContext({
  mode,
  initialProfile,
  businessName,
  businessSummary,
  founderGoal,
  businessUrl,
  pastedSourceText,
  manualBusinessContext,
  manualVoiceInput,
  ownerKbContext,
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
  const advisorStrengths =
    (initialProfile?.advisorSnapshot?.strengths || []).join(", ") || "Not provided";
  const advisorWeakPoints =
    (initialProfile?.advisorSnapshot?.weakPoints || []).join(", ") || "Not provided";
  const advisorBlindSpots =
    (initialProfile?.advisorSnapshot?.blindSpots || []).join(", ") || "Not provided";
  const advisorOpportunities =
    (initialProfile?.advisorSnapshot?.opportunities || []).join(", ") || "Not provided";
  const recommendedFocus =
    initialProfile?.advisorSnapshot?.recommendedFocus || "Not provided";

  const discoveryChannels = initialProfile?.discoveryProfile?.channelsFound || {};
  const channelsSummary = Object.entries(discoveryChannels)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(", ") || "Not detected";

  const trustSignals =
    (initialProfile?.discoveryProfile?.trustSignals || []).join(", ") || "Not detected";
  const educationSignals =
    (initialProfile?.discoveryProfile?.educationSignals || []).join(", ") || "Not detected";
  const activitySignals =
    (initialProfile?.discoveryProfile?.activitySignals || []).join(", ") || "Not detected";
  const founderVisibilitySignals =
    (initialProfile?.discoveryProfile?.founderVisibilitySignals || []).join(", ") ||
    "Not detected";

  const brandSignalState = initialProfile?.groupedSnapshot?.brandSignalState || {};
  const snapshotGroups = initialProfile?.groupedSnapshot?.snapshotGroups || {};

  const groupSummary = Object.values(snapshotGroups)
    .map((group) => `${group.title}: ${group.score}/${group.max}`)
    .join(", ") || "Not scored";

  const base = `
PROFILE CONTEXT:
- Business name: ${profileName}
- Business summary: ${profileSummary}
- Founder goal: ${founderGoal || "Not provided"}
- Offers/services: ${profileOffers}
- Audience: ${profileAudience}
- Customer life moments: ${customerMoments}
- Customer outcomes: ${customerOutcomes}
- Founder priorities: ${founderBeliefs}
- Brand Signal State: ${brandSignalState.score || "Not scored"}/${brandSignalState.max || 100} (${brandSignalState.label || "Unknown"})
- Snapshot groups: ${groupSummary}
- Detected public channels: ${channelsSummary}
- Trust signals detected: ${trustSignals}
- Education signals detected: ${educationSignals}
- Activity signals detected: ${activitySignals}
- Founder visibility signals detected: ${founderVisibilitySignals}
- Strongest business strengths detected: ${advisorStrengths}
- Weak points detected: ${advisorWeakPoints}
- Blind spots detected: ${advisorBlindSpots}
- Opportunity directions detected: ${advisorOpportunities}
- Recommended focus: ${recommendedFocus}
- URL: ${businessUrl || "Not provided"}

${ownerKbContext || ""}

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
Use the advisor snapshot, grouped snapshot scoring, discovery profile, and founder goal to make the output more useful.
Only use manual or pasted inputs as fallback or refinement.
${base}
`;
  }

  if (mode === "manual") {
    return `
MODE: MANUAL
Use manual and pasted inputs as primary truth.
Use profile/URL context only as fallback.
Use the founder goal, advisor snapshot, grouped snapshot scoring, and discovery profile to keep the output practical.
${base}
`;
  }

  return `
MODE: HYBRID
Use the profile as the base.
Blend in pasted and manual inputs where useful.
If there is conflict, prefer the user's manual wording and corrections.
Use the founder goal, advisor snapshot, grouped snapshot scoring, discovery profile to keep the output practical.
${base}
`;
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
- Use the business summary, product truth, advisor snapshot, grouped snapshot scoring, discovery profile, and owner role as stronger anchors than the thin voice sample
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
-SCENE RULE (STRICT):
- At least one post MUST begin with a real-world moment
- This means a specific situation, time, or action (e.g. “I remember…”, “Last week…”, “Woke up…”, “Sat there…”)
- Do NOT begin that post with an abstract idea or reflection
- The reader should be able to picture the moment immediately
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
    if (tokens.some((t) => softWords.has(t))) softCount += 1;
    if (tokens.includes("quiet")) quietCount += 1;
  }

  if (!allowQuiet && quietCount >= 1) {
    return { failed: true, reason: `The word "quiet" appeared outside Quiet Value.` };
  }

  if (allowQuiet && quietCount >= 2) {
    return { failed: true, reason: `The word "quiet" appeared in too many Quiet Value openers.` };
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
    return { failed: true, reason: "Too many posts start with the same first word." };
  }

  for (let i = 0; i < openerTokens.length; i += 1) {
    for (let j = i + 1; j < openerTokens.length; j += 1) {
      const a = openerTokens[i];
      const b = openerTokens[j];
      const shared = a.filter((token) => b.includes(token));
      if (shared.length >= 3) {
        return { failed: true, reason: "Opening lines are too lexically similar." };
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
      return { failed: true, reason: `Too many Quiet Value posts still use "quiet".` };
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
  let text = String(post || "").trim();
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

  const lower = String(text).toLowerCase();
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
      founderGoal,
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
      founderGoal,
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
  const {
    mode,
    businessName,
    founderGoal,
    businessUrl,
    pastedSourceText,
    manualBusinessContext,
  } = req.body || {};

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

    const [sourceProfile, customerOutcome, brandProductTruth] = await Promise.all([
      runJsonChat(
        sourceProfilePrompt({
          mode,
          businessName,
          founderGoal,
          founderText,
          customerText,
          productText,
          pastedSourceText,
          manualBusinessContext,
        })
      ),
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
      clipText(businessName || "", 200) ||
      sourceProfile?.businessProfile?.name ||
      brandProductTruth?.productType ||
      "Unknown Business";

    const contentProfile = {
      suggestedCategory:
        sourceProfile?.contentProfile?.suggestedCategory || "Product in Real Life",
      suggestedIdea:
        sourceProfile?.contentProfile?.suggestedIdea ||
        "How this business makes everyday life feel easier or better",
    };

    const weakVoiceSource = isWeakVoiceSource(safeVoiceSourceText);

    const sourceProfileData = {
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
      weakVoiceSource,
      founderLanePreview: founderText,
      customerLanePreview: customerText,
      productLanePreview: productText,
      urlUsed: Boolean(normalizedUrl),
      pastedTextUsed: Boolean(pastedSourceText),
      manualContextUsed: Boolean(manualBusinessContext),
      suggestedCategory: contentProfile.suggestedCategory,
      suggestedIdea: contentProfile.suggestedIdea,
    };

    const discoveryProfile = {
      channelsFound: laneGather?.socialLinks || {
        instagram: "",
        facebook: "",
        tiktok: "",
        youtube: "",
        x: "",
        linkedin: "",
      },
      sourcePages: laneGather?.groupedPages || {
        aboutPages: [],
        blogPages: [],
        faqPages: [],
        reviewPages: [],
        activityPages: [],
        pressPages: [],
        productPages: [],
      },
      activitySignals: inferActivitySignals({
        groupedPages: laneGather?.groupedPages || {},
        pages: laneGather?.pages || [],
      }),
      trustSignals: inferTrustSignals({
        groupedPages: laneGather?.groupedPages || {},
        lanes: laneGather?.lanes || {},
        pages: laneGather?.pages || [],
      }),
      educationSignals: inferEducationSignals({
        groupedPages: laneGather?.groupedPages || {},
        lanes: laneGather?.lanes || {},
        pages: laneGather?.pages || [],
      }),
      founderVisibilitySignals: inferFounderVisibilitySignals({
        groupedPages: laneGather?.groupedPages || {},
        founderText,
        pages: laneGather?.pages || [],
      }),
      sourceConfidence: inferSourceConfidence({
        channelsFound: laneGather?.socialLinks || {},
        groupedPages: laneGather?.groupedPages || {},
        pagesScanned: laneGather?.pages?.length || 0,
        hasOwnerWriting: Boolean(pastedSourceText),
      }),
    };

    const advisorSnapshot = inferAdvisorSnapshot({
      founderGoal,
      founderVoice: safeFounderVoice,
      brandProductTruth,
      customerOutcome,
      sourceProfile: sourceProfileData,
      discoveryProfile,
      contentProfile,
    });

    const intelligenceRead = buildIntelligenceRead({
      advisorSnapshot,
      discoveryProfile,
      sourceProfile: sourceProfileData,
    });

    const debug = {
      pagesScanned: laneGather?.pages?.length || 0,
      discoveredLinks: laneGather?.allDiscoveredLinks?.length || 0,
    };

    const groupedSnapshot = buildGroupedSnapshotScoring({
      businessProfile: {
        name: finalBusinessName,
        summary: sourceProfile?.businessProfile?.summary || "",
      },
      founderGoal,
      contentProfile,
      sourceProfile: sourceProfileData,
      founderVoice: safeFounderVoice,
      customerOutcome,
      brandProductTruth,
      discoveryProfile,
      advisorSnapshot,
      debug,
      hasOwnerWriting: Boolean(pastedSourceText),
    });

    const profile = {
      businessProfile: {
        name: finalBusinessName,
        summary: sourceProfile?.businessProfile?.summary || "",
      },
      founderGoal: founderGoal || "",
      contentProfile,
      visualProfile: {
        visualDirections: sourceProfile?.visualProfile?.visualDirections || [],
        avoidRules: sourceProfile?.visualProfile?.avoidRules || [],
      },
      sourceProfile: sourceProfileData,
      founderVoice: safeFounderVoice,
      customerOutcome,
      brandProductTruth,
      discoveryProfile,
      advisorSnapshot: {
        ...advisorSnapshot,
        intelligenceRead,
      },
      groupedSnapshot,
      ownerKbMeta: getBusinessKbMeta(finalBusinessName),
      debug,
    };

    res.json({ profile });
  } catch (err) {
    console.error("BUILD PROFILE ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to build profile." });
  }
});

app.post("/analyze-voice", async (req, res) => {
  const { input } = req.body || {};

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

app.post("/generate", async (req, res) => {
  const {
    mode,
    idea,
    category,
    weeklyPosts,
    founderGoal,
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
  } = req.body || {};

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
      founderGoal,
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

CURRENT FOUNDER GOAL:
${clipText(founderGoal || initialProfile?.founderGoal || "Not specified", 300)}

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

FOUNDER GOAL RULE:
- The current founder goal should influence usefulness, emphasis, and relevance
- Do not mention the founder goal directly unless it sounds natural
- Let the post quietly solve toward the goal rather than stating strategy out loud

ADVISOR RULE:
- Use the detected blind spots, weak points, and opportunities to make the content more useful
- Help the business say what it is not yet saying clearly enough
- Where possible, make the output feel like it closes a real business gap

SNAPSHOT RULE:
- Use the grouped Snapshot scoring to understand where the brand signal is strongest and weakest
- If Brand Core is weak, write with more care around identity and founder presence
- If Market Signal is weak, make the offer and practical value easier to understand
- If Optimization is weak, keep the output more grounded and directly useful
- If Source Mix is weak, avoid overclaiming what the business is doing publicly

DISCOVERY RULE:
- Use the discovered public signals where useful
- If there are trust, activity, education, or founder-visibility signals, let them improve relevance
- Do not invent public activity that was not found

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
- But if today's feeling, current lens, or founder goal points in a different direction, follow the current moment
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
- If the voice sample is thin, rely harder on the lens, advisor snapshot, grouped snapshot scoring, discovery profile, and business truth

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
  const { imagePrompt } = req.body || {};

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

app.listen(PORT, () => {
  ensureOwnerKbFile();
  console.log(`Server running on port ${PORT}`);
});