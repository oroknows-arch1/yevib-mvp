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
const PHASE3_TEST_MATRIX_PATH = path.join(__dirname, "phase3-test-matrix.json");

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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function cleanSceneText(value = "", fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function ensurePanelRole(role = "", panelNumber = 1) {
  const cleanRole = String(role || "").trim().toLowerCase();

  if (panelNumber === 1) return "establishing";
  if (panelNumber === 2) {
    return ["preparation", "inspection", "method"].includes(cleanRole)
      ? cleanRole
      : "inspection";
  }
  if (panelNumber === 3) {
    return ["action", "process", "transformation"].includes(cleanRole)
      ? cleanRole
      : "process";
  }
  if (panelNumber === 4) return "outcome";

  return cleanRole || "supporting";
}

function normalizeLockedScenePlan(rawPlan = {}, imagePrompt = "") {
  const fallbackPrimarySubject = cleanSceneText(
    rawPlan?.primarySubject || rawPlan?.mainSubject,
    cleanSceneText(imagePrompt, "the primary subject from the request")
  );

  const primarySubject = fallbackPrimarySubject;
  const supportSubjects = Array.isArray(rawPlan?.supportSubjects)
    ? rawPlan.supportSubjects.map((item) => cleanSceneText(item)).filter(Boolean).slice(0, 4)
    : [cleanSceneText(rawPlan?.supportingSubject, "")].filter(Boolean);

  const problemStateSubject = cleanSceneText(
    rawPlan?.problemStateSubject,
    primarySubject
  );

  const resolvedStateSubject = cleanSceneText(
    rawPlan?.resolvedStateSubject,
    primarySubject
  );

  const primaryActor = cleanSceneText(
    rawPlan?.primaryActor,
    "the main actor described in the request"
  );

  const secondaryActors = Array.isArray(rawPlan?.secondaryActors)
    ? rawPlan.secondaryActors.map((item) => cleanSceneText(item)).filter(Boolean).slice(0, 4)
    : [];

  const serviceableArea = cleanSceneText(
    rawPlan?.serviceableArea,
    "the plausible serviceable area where hands-on work can realistically happen"
  );

  const sameSubjectInstanceAcrossPanels =
    typeof rawPlan?.sameSubjectInstanceAcrossPanels === "boolean"
      ? rawPlan.sameSubjectInstanceAcrossPanels
      : true;

  const sameActorIdentityAcrossPanels =
    typeof rawPlan?.sameActorIdentityAcrossPanels === "boolean"
      ? rawPlan.sameActorIdentityAcrossPanels
      : true;

  const sameEnvironmentAcrossPanels =
    typeof rawPlan?.sameEnvironmentAcrossPanels === "boolean"
      ? rawPlan.sameEnvironmentAcrossPanels
      : true;

  const forbiddenRoleSwaps = Array.isArray(rawPlan?.forbiddenRoleSwaps)
    ? rawPlan.forbiddenRoleSwaps
        .map((item) => cleanSceneText(item))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const forbiddenSwaps = Array.isArray(rawPlan?.forbiddenSwaps)
    ? rawPlan.forbiddenSwaps
        .map((item) => cleanSceneText(item))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const continuityRules = Array.isArray(rawPlan?.continuityRules)
    ? rawPlan.continuityRules
        .map((item) => cleanSceneText(item))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const globalScene = cleanSceneText(
    rawPlan?.globalScene,
    "A single coherent real-world scene built directly from the request."
  );

  const panelRoleFallbacks = {
    1: "establishing",
    2: "inspection",
    3: "process",
    4: "outcome",
  };

  const panels = Array.isArray(rawPlan?.panels)
    ? rawPlan.panels
        .map((panel, index) => {
          const panelNumber = index + 1;
          const fallbackRole = panelRoleFallbacks[panelNumber];
          const role = ensurePanelRole(panel?.role, panelNumber);

          const defaultTargetSubject =
            role === "outcome" ? resolvedStateSubject : primarySubject;

          return {
            panel: panelNumber,
            role,
            shotType: cleanSceneText(
              panel?.shotType,
              panelNumber === 1
                ? "wide establishing shot"
                : panelNumber === 2
                ? "medium inspection shot"
                : panelNumber === 3
                ? "close process shot"
                : "medium outcome shot"
            ),
            lockedSubject: cleanSceneText(panel?.lockedSubject, primarySubject),
            targetSubject: cleanSceneText(panel?.targetSubject, defaultTargetSubject),
            targetActor: cleanSceneText(panel?.targetActor, primaryActor),
            allowedSupportSubject: cleanSceneText(
              panel?.allowedSupportSubject,
              supportSubjects[0] || ""
            ),
            serviceableArea: cleanSceneText(
              panel?.serviceableArea,
              serviceableArea
            ),
            problemStateOwner: cleanSceneText(
              panel?.problemStateOwner,
              role === "outcome" ? "" : problemStateSubject
            ),
            resolvedStateOwner: cleanSceneText(
              panel?.resolvedStateOwner,
              role === "outcome" ? resolvedStateSubject : ""
            ),
            mustShow: cleanSceneText(panel?.mustShow, ""),
            mustNotShow: cleanSceneText(panel?.mustNotShow, ""),
            scene: cleanSceneText(
              panel?.scene,
              panelNumber === 1
                ? `Establish ${primarySubject} in the real environment described by the request.`
                : panelNumber === 2
                ? `Show inspection, setup, or preparation focused on ${primarySubject}.`
                : panelNumber === 3
                ? `Show the main process or action involving ${primarySubject}.`
                : `Show the resolved outcome or lived result connected to ${resolvedStateSubject}.`
            ),
          };
        })
        .slice(0, 4)
    : [];

  while (panels.length < 4) {
    const panelNumber = panels.length + 1;
    const role = panelRoleFallbacks[panelNumber];

    panels.push({
      panel: panelNumber,
      role,
      shotType:
        panelNumber === 1
          ? "wide establishing shot"
          : panelNumber === 2
          ? "medium inspection shot"
          : panelNumber === 3
          ? "close process shot"
          : "medium outcome shot",
      lockedSubject: primarySubject,
      targetSubject: panelNumber === 4 ? resolvedStateSubject : primarySubject,
      targetActor: primaryActor,
      allowedSupportSubject: supportSubjects[0] || "",
      serviceableArea,
      problemStateOwner: panelNumber === 4 ? "" : problemStateSubject,
      resolvedStateOwner: panelNumber === 4 ? resolvedStateSubject : "",
      mustShow: "",
      mustNotShow: "",
      scene:
        panelNumber === 1
          ? `Establish ${primarySubject} in the real environment described by the request.`
          : panelNumber === 2
          ? `Show inspection, setup, or preparation focused on ${primarySubject}.`
          : panelNumber === 3
          ? `Show the main process or action involving ${primarySubject}.`
          : `Show the resolved outcome or lived result connected to ${resolvedStateSubject}.`,
    });
  }

  const finalContinuityRules = [
    `The primary subject is locked as: ${primarySubject}`,
    supportSubjects.length > 0
      ? `Support subjects are secondary only: ${supportSubjects.join(", ")}`
      : "",
    `The problem-state subject is: ${problemStateSubject}`,
    `The resolved-state subject is: ${resolvedStateSubject}`,
    `The primary actor is: ${primaryActor}`,
    sameSubjectInstanceAcrossPanels
      ? "Use the same exact subject instance across all panels."
      : "",
    sameActorIdentityAcrossPanels
      ? "Use the same exact actor identity across all panels unless explicitly changed."
      : "",
    sameEnvironmentAcrossPanels
      ? "Keep the same environment, place, and event continuity across panels unless explicitly changed."
      : "",
    "Do not switch the primary subject between panels.",
    "Do not promote a support subject into the hero subject.",
    "Do not swap product type, vehicle type, machine type, service type, or job type.",
    ...continuityRules,
  ]
    .filter(Boolean)
    .slice(0, 14);

  const finalForbiddenSwaps = [
    "Do not replace the primary subject with a nearby support subject.",
    "Do not reinterpret the panel as a different product, vehicle, machine, or job.",
    ...forbiddenRoleSwaps,
    ...forbiddenSwaps,
  ]
    .filter(Boolean)
    .slice(0, 14);

  return {
    globalScene,
    primarySubject,
    supportSubjects,
    problemStateSubject,
    resolvedStateSubject,
    primaryActor,
    secondaryActors,
    serviceableArea,
    sameSubjectInstanceAcrossPanels,
    sameActorIdentityAcrossPanels,
    sameEnvironmentAcrossPanels,
    forbiddenRoleSwaps,
    forbiddenSwaps: finalForbiddenSwaps,
    continuityRules: finalContinuityRules,
    panels,
    mainSubject: primarySubject,
    supportingSubject: supportSubjects[0] || "",
  };
}

async function buildImageScenePlan(imagePrompt = "", discoveryProfile = {}) {
  const locationContext = discoveryProfile?.locationContext || {};
  const visualIdentity = discoveryProfile?.visualIdentity || {};

  const prompt = `
Turn this image request into a strict 4-panel visual scene plan using a universal subject-role control system.

INPUT IMAGE REQUEST:
${clipText(imagePrompt || "", 3000)}

LOCATION CONTEXT:
- country: ${locationContext.country || "not specified"}
- state: ${locationContext.state || "not specified"}
- city: ${locationContext.city || "not specified"}
- environment type: ${locationContext.environmentType || "real working environment"}

VISUAL IDENTITY:
- tone: ${visualIdentity.tone || "grounded, real, business-appropriate"}
- palette: ${visualIdentity.palette || "natural business-appropriate colours"}
- environment: ${visualIdentity.environment || "real working environments"}
- branding style: ${visualIdentity.brandingStyle || "unbranded, practical, context-led"}

Return valid JSON in exactly this shape:
{
  "globalScene": "one sentence describing the overall world of the image",
  "primarySubject": "the one exact physical subject instance the sequence is really about",
  "supportSubjects": [
    "secondary subject 1",
    "secondary subject 2"
  ],
  "problemStateSubject": "the subject carrying the fault, stress, disruption, or problem state",
  "resolvedStateSubject": "the same subject after the problem is resolved",
  "primaryActor": "the one main person performing the key action across the sequence",
  "secondaryActors": [
    "secondary actor 1",
    "secondary actor 2"
  ],
  "serviceableArea": "the plausible serviceable area, component, zone, or part where hands-on work can realistically happen",
  "locationContext": {
    "country": "country for the scene",
    "state": "state or region for the scene",
    "city": "city or area for the scene",
    "environmentType": "the matching environment type for the scene"
  },
  "visualIdentity": {
    "tone": "matching visual tone",
    "palette": "matching colour palette",
    "environment": "matching environment style",
    "brandingStyle": "matching branding style"
  },
  "sameSubjectInstanceAcrossPanels": true,
  "sameActorIdentityAcrossPanels": true,
  "sameEnvironmentAcrossPanels": true,
  "forbiddenRoleSwaps": [
    "support subject must not become the primary subject",
    "secondary actor must not become the primary actor"
  ],
  "forbiddenSwaps": [
    "swap that must never happen",
    "swap that must never happen"
  ],
  "continuityRules": [
    "rule 1",
    "rule 2",
    "rule 3"
  ],
  "panels": [
    {
      "panel": 1,
      "role": "establishing",
      "shotType": "wide establishing shot",
      "lockedSubject": "same primary subject",
      "targetSubject": "exact subject this panel must focus on",
      "targetActor": "exact actor this panel must focus on",
      "allowedSupportSubject": "optional support subject",
      "serviceableArea": "same plausible serviceable area when relevant",
      "problemStateOwner": "who or what owns the problem state in this panel",
      "resolvedStateOwner": "who or what owns the resolved state in this panel",
      "mustShow": "what must be clearly visible in frame",
      "mustNotShow": "what must not appear or take over",
      "scene": "..."
    },
    {
      "panel": 2,
      "role": "inspection",
      "shotType": "medium inspection shot",
      "lockedSubject": "same primary subject",
      "targetSubject": "exact subject this panel must focus on",
      "targetActor": "exact actor this panel must focus on",
      "allowedSupportSubject": "optional support subject",
      "serviceableArea": "same plausible serviceable area when relevant",
      "problemStateOwner": "who or what owns the problem state in this panel",
      "resolvedStateOwner": "who or what owns the resolved state in this panel",
      "mustShow": "what must be clearly visible in frame",
      "mustNotShow": "what must not appear or take over",
      "scene": "..."
    },
    {
      "panel": 3,
      "role": "process",
      "shotType": "close process shot",
      "lockedSubject": "same primary subject",
      "targetSubject": "exact subject this panel must focus on",
      "targetActor": "exact actor this panel must focus on",
      "allowedSupportSubject": "optional support subject",
      "serviceableArea": "same plausible serviceable area when relevant",
      "problemStateOwner": "who or what owns the problem state in this panel",
      "resolvedStateOwner": "who or what owns the resolved state in this panel",
      "mustShow": "what must be clearly visible in frame",
      "mustNotShow": "what must not appear or take over",
      "scene": "..."
    },
    {
      "panel": 4,
      "role": "outcome",
      "shotType": "medium outcome shot",
      "lockedSubject": "same primary subject",
      "targetSubject": "exact subject this panel must focus on",
      "targetActor": "exact actor this panel must focus on",
      "allowedSupportSubject": "optional support subject",
      "serviceableArea": "same plausible serviceable area when relevant",
      "problemStateOwner": "who or what owns the problem state in this panel",
      "resolvedStateOwner": "who or what owns the resolved state in this panel",
      "mustShow": "what must be clearly visible in frame",
      "mustNotShow": "what must not appear or take over",
      "scene": "..."
    }
  ]
}

PLANNING RULES:
- create exactly 4 panels
- each panel must be visually distinct but logically connected
- identify one exact physical primary subject instance and keep that same instance locked across the full collage
- identify one exact primary actor and keep that same actor identity locked across the full collage unless the request explicitly requires otherwise
- support subjects may appear, but they must remain secondary and must never replace the primary subject
- secondary actors may appear, but they must remain secondary and must never replace the primary actor
- define which subject owns the problem state
- define which subject owns the resolved state
- if hands-on work is involved, define one plausible serviceable area where the work can realistically happen
- use the provided location context as the scene anchor when it is available
- if country, state, city, or environment type are provided, keep the scene visually consistent with them
- do not invent a different country, city, streetscape, or environment if location context was provided
- use the provided visual identity as the style anchor when it is available
- match the tone, palette, environment, and branding style to the business identity instead of default generic stock imagery
- do not switch vehicle type, machine type, product type, service type, job type, or subject instance unless explicitly required
- panel 1 must establish the situation
- panel 2 must show inspection, setup, or method
- panel 3 must show the key process or active work
- panel 4 must show the outcome or resolved state
- for every panel, explicitly name the target subject
- for every panel, explicitly name the target actor
- for every panel, explicitly define who owns the problem state and who owns the resolved state
- if the request involves repair or inspection, do not place the action on an implausible seam, hinge, invented access point, or non-serviceable area
- keep the plan grounded, realistic, and literal
- avoid abstract symbolism
- avoid generic lifestyle filler
- if there is any ambiguity, choose the most literal interpretation of the request
`;

  const rawPlan = await runJsonChat(prompt);
  return normalizeLockedScenePlan(rawPlan, imagePrompt);
}
function classifySceneType(text = "") {
  const t = String(text || "").toLowerCase();

  if (
    /midnight|burst|flood|urgent|emergency|water damage|water everywhere|sudden/i.test(t)
  ) {
    return "emergency_response";
  }

  if (
    /plan|planning|renovation|timeline|quote|discussion|explaining|walkthrough|next steps|bathroom renovation/i.test(t)
  ) {
    return "planning_consultation";
  }

  if (
    /i run|i make sure|i insist|responsibility|with that at the front of my mind|i keep|i focus/i.test(t)
  ) {
    return "founder_reflection";
  }

  if (
    /reliable|backbone|functioning home|on call 24\/7|on call|dependable|keep your home back on track/i.test(t)
  ) {
    return "system_reliability";
  }

  if (
    /maintenance|regular|routine|check|servicing|prevent|standard service/i.test(t)
  ) {
    return "routine_maintenance";
  }

  return "inspection_diagnosis";
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

const UBDG_SOURCE_HIERARCHY = Object.freeze({
  owner_input: {
    priority: 1,
    tier: "owner_truth",
    label: "Owner-provided truth",
    rule: "Highest priority. Use owner-provided context as the clearest statement of intent, voice, goal, and business reality unless contradicted by safer factual evidence.",
  },
  owned_website: {
    priority: 2,
    tier: "business_owned_public",
    label: "Business-owned website",
    rule: "Strong public business signal. Use for offers, positioning, services, product truth, location, trust markers, and education signals.",
  },
  registry: {
    priority: 3,
    tier: "official_record",
    label: "Official registry or verification source",
    rule: "Use for factual legitimacy checks such as registration, official business identity, and public compliance-style trust signals.",
  },
  public_profile: {
    priority: 4,
    tier: "platform_profile",
    label: "Public business profile",
    rule: "Use for public footprint signals such as Google Business Profile, directories, platform bios, visible activity, and business presence.",
  },
  review: {
    priority: 5,
    tier: "customer_signal",
    label: "Customer review signal",
    rule: "Use as customer-perceived proof, not as confirmed business fact unless repeated and strongly supported.",
  },
  social: {
    priority: 6,
    tier: "social_signal",
    label: "Social channel signal",
    rule: "Use for activity, tone, audience hints, content style, and public consistency. Do not overclaim business quality from social posts alone.",
  },
  inferred: {
    priority: 7,
    tier: "ai_inference",
    label: "Inferred signal",
    rule: "Lowest priority. Use only as cautious interpretation and never present as confirmed fact.",
  },
});

function normalizeUbdgEvidence(rawEvidence = [], maxItems = 24) {
  if (!Array.isArray(rawEvidence)) return [];

  const allowedSourceTypes = new Set(Object.keys(UBDG_SOURCE_HIERARCHY));
  const allowedConfidence = new Set(["high", "medium", "low"]);
  const allowedFreshness = new Set(["known", "unknown", "stale"]);
  const allowedClaimTypes = new Set(["fact", "signal", "inference"]);

  const seen = new Set();
  const evidence = [];

  for (const item of rawEvidence) {
    if (!item || typeof item !== "object") continue;

    const sourceType = String(item.sourceType || "").trim();
    const sourceUrl = String(item.sourceUrl || "").trim();
    const evidenceText = clipText(item.evidenceText || "", 600);
    const confidence = String(item.confidence || "").trim();
    const freshness = String(item.freshness || "").trim();
    const claimType = String(item.claimType || "").trim();

    if (!evidenceText) continue;

    const safeSourceType = allowedSourceTypes.has(sourceType)
      ? sourceType
      : "inferred";

    const safeConfidence = allowedConfidence.has(confidence)
      ? confidence
      : "low";

    const safeFreshness = allowedFreshness.has(freshness)
      ? freshness
      : "unknown";

    const safeClaimType = allowedClaimTypes.has(claimType)
      ? claimType
      : "inference";

    const dedupeKey = `${safeSourceType}:${sourceUrl}:${evidenceText}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    evidence.push({
      sourceType: safeSourceType,
      sourceUrl,
      evidenceText,
      confidence: safeConfidence,
      freshness: safeFreshness,
      claimType: safeClaimType,
    });

    if (evidence.length >= maxItems) break;
  }

  return evidence;
}

function getUbdgSourcePriority(sourceType = "") {
  const key = String(sourceType || "").trim();
  return UBDG_SOURCE_HIERARCHY[key]?.priority || UBDG_SOURCE_HIERARCHY.inferred.priority;
}

function sortUbdgEvidenceByPriority(evidence = []) {
  const normalizedEvidence = normalizeUbdgEvidence(evidence);

  return normalizedEvidence.sort((a, b) => {
    const priorityA = getUbdgSourcePriority(a.sourceType);
    const priorityB = getUbdgSourcePriority(b.sourceType);

    if (priorityA !== priorityB) return priorityA - priorityB;

    const confidenceRank = { high: 1, medium: 2, low: 3 };
    const confidenceA = confidenceRank[a.confidence] || confidenceRank.low;
    const confidenceB = confidenceRank[b.confidence] || confidenceRank.low;

    if (confidenceA !== confidenceB) return confidenceA - confidenceB;

    return String(a.evidenceText || "").localeCompare(String(b.evidenceText || ""));
  });
}

function getUbdgRegistryClaimBoundary(sourceMix = {}, evidenceCount = 0) {
  const sourceTypes = Object.keys(sourceMix).filter((key) => sourceMix[key] > 0);
  const hasRegistry = Boolean(sourceMix.registry);
  const registryOnly =
    evidenceCount > 0 &&
    hasRegistry &&
    sourceTypes.length === 1 &&
    sourceTypes[0] === "registry";

  if (registryOnly) {
    return {
      boundaryType: "registry_identity_only",
      identitySupported: true,
      businessTrustSupported: false,
      allowedClaimScope: "official identity or registration wording only",
      forbiddenClaimExamples: [
        "trustworthy",
        "high quality",
        "safe to buy from",
        "active",
        "successful",
      ],
      instruction:
        "Registry-only evidence may confirm official identity or registration presence, but it must not be used as proof of business trust, quality, safety, activity, success, customer satisfaction, or operational strength.",
    };
  }

  return {
    boundaryType: hasRegistry ? "registry_with_supporting_sources" : "standard",
    identitySupported: hasRegistry,
    businessTrustSupported: !registryOnly,
    allowedClaimScope:
      hasRegistry
        ? "registry identity plus other supported business signals when present"
        : "standard evidence-supported business wording",
    forbiddenClaimExamples: [],
    instruction:
      "Use normal UBDG evidence limits. Do not exceed what the available source mix can actually support.",
  };
}

function summarizeUbdgEvidenceStrength(evidence = []) {
  const sortedEvidence = sortUbdgEvidenceByPriority(evidence);
  const evidenceCount = sortedEvidence.length;

  const sourceMix = sortedEvidence.reduce((acc, item) => {
    const sourceType = item.sourceType || "inferred";
    acc[sourceType] = (acc[sourceType] || 0) + 1;
    return acc;
  }, {});

  const confidenceMix = sortedEvidence.reduce((acc, item) => {
    const confidence = item.confidence || "low";
    acc[confidence] = (acc[confidence] || 0) + 1;
    return acc;
  }, {});

  const strongestEvidence = sortedEvidence[0] || null;
  const strongestSourceType = strongestEvidence?.sourceType || "none";
  const strongestSourcePriority = strongestEvidence
    ? getUbdgSourcePriority(strongestEvidence.sourceType)
    : null;

  const claimBoundary = getUbdgRegistryClaimBoundary(sourceMix, evidenceCount);

  const hasOwnerTruth = Boolean(sourceMix.owner_input);
  const hasOwnedWebsite = Boolean(sourceMix.owned_website);
  const hasOfficialRecord = Boolean(sourceMix.registry);
  const hasHighConfidence = Boolean(confidenceMix.high);
  const hasOnlyInferred =
    evidenceCount > 0 && Object.keys(sourceMix).every((key) => key === "inferred");

  let evidenceState = "no_evidence";
  let safeClaimLevel = "blocked";
  let summary = "No usable evidence was found.";

  if (evidenceCount > 0) {
    if (claimBoundary.boundaryType === "registry_identity_only") {
      evidenceState = "identity_supported";
      safeClaimLevel = "identity_only";
      summary =
        "The evidence set supports official identity or registration wording only. It does not support broader business trust, quality, safety, activity, success, or customer claims.";
    } else if (hasOwnerTruth || hasOwnedWebsite || hasOfficialRecord) {
      evidenceState = hasHighConfidence ? "strong" : "usable";
      safeClaimLevel = hasHighConfidence ? "safe" : "cautious";
      summary = "The evidence set includes strong source types that can support a grounded business read.";
    } else if (hasOnlyInferred) {
      evidenceState = "inference_only";
      safeClaimLevel = "inference_only";
      summary = "The evidence set is inference-only and should not be presented as confirmed fact.";
    } else {
      evidenceState = "limited";
      safeClaimLevel = "cautious";
      summary = "The evidence set has usable signals, but claims should stay cautious.";
    }
  }

  return {
    evidenceCount,
    evidenceState,
    safeClaimLevel,
    strongestSourceType,
    strongestSourcePriority,
    sourceMix,
    confidenceMix,
    claimBoundary,
    summary,
    sortedEvidence,
  };
}

function getUbdgClaimWording(summary = {}) {
  const safeClaimLevel = String(summary?.safeClaimLevel || "blocked").trim();
  const claimBoundary = summary?.claimBoundary || {};

  if (safeClaimLevel === "safe") {
    return {
      safeClaimLevel: "safe",
      claimLead: "YEVIB can see",
      instruction:
        "Use direct but grounded language. Claims may be stated confidently when supported by owner input, owned website evidence, official records with supporting business evidence, or other high-confidence source evidence.",
      claimBoundary,
    };
  }

  if (safeClaimLevel === "cautious") {
    return {
      safeClaimLevel: "cautious",
      claimLead: "YEVIB can reasonably infer",
      instruction:
        "Use careful language. Claims should be framed as reasoned interpretation, not confirmed fact.",
      claimBoundary,
    };
  }

  if (safeClaimLevel === "identity_only") {
    return {
      safeClaimLevel: "identity_only",
      claimLead: "YEVIB can verify an official identity signal",
      instruction:
        "Use identity-only wording. Do not describe the business as trustworthy, high quality, safe to buy from, active, successful, customer-approved, or operationally strong from registry evidence alone.",
      claimBoundary,
    };
  }

  if (safeClaimLevel === "inference_only") {
    return {
      safeClaimLevel: "inference_only",
      claimLead: "The current scan suggests",
      instruction:
        "Use low-confidence language. Do not present inferred signals as confirmed business truth.",
      claimBoundary,
    };
  }

  return {
    safeClaimLevel: "blocked",
    claimLead: "More source signal is needed",
    instruction:
      "Do not make a business claim. Ask for stronger owner input, owned website evidence, official records, or clearer public source material.",
    claimBoundary,
  };
}

function buildUbdgEvidencePacket(rawEvidence = [], maxItems = 24) {
  const normalizedEvidence = normalizeUbdgEvidence(rawEvidence, maxItems);
  const sortedEvidence = sortUbdgEvidenceByPriority(normalizedEvidence);
  const strengthSummary = summarizeUbdgEvidenceStrength(sortedEvidence);
  const claimWording = getUbdgClaimWording(strengthSummary);

  const evidenceCaution = (() => {
    const evidenceCount = Number(strengthSummary?.evidenceCount || 0);
    const evidenceState = String(strengthSummary?.evidenceState || "").trim();
    const safeClaimLevel = String(strengthSummary?.safeClaimLevel || "").trim();
    const claimBoundary = strengthSummary?.claimBoundary || {};
    const boundaryType = String(claimBoundary?.boundaryType || "").trim();

    if (evidenceCount === 0 || evidenceState === "no_evidence") {
      return {
        shouldSurface: false,
        cautionLevel: "none",
        cautionType: "none",
        summary: "No evidence caution is needed because no usable evidence was found.",
        ownerMeaning: "YEVIB should ask for better source material before making business claims.",
      };
    }

    if (
      safeClaimLevel === "identity_only" ||
      boundaryType === "registry_identity_only"
    ) {
      return {
        shouldSurface: true,
        cautionLevel: "high",
        cautionType: "registry_identity_only",
        summary:
          "Official registry evidence can support identity or registration wording only.",
        ownerMeaning:
          "YEVIB may confirm the business identity signal, but must not use registry-only evidence to claim trust, quality, safety, activity, success, or customer approval.",
      };
    }

    if (safeClaimLevel === "inference_only" || evidenceState === "inference_only") {
      return {
        shouldSurface: true,
        cautionLevel: "high",
        cautionType: "inference_only",
        summary:
          "The current evidence is inference-only and should not be treated as confirmed business truth.",
        ownerMeaning:
          "YEVIB should ask for owner input, owned website evidence, or official source evidence before making stronger recommendations.",
      };
    }

    if (safeClaimLevel === "cautious" || evidenceState === "limited") {
      return {
        shouldSurface: true,
        cautionLevel: "medium",
        cautionType: "limited_source_support",
        summary:
          "The evidence is usable, but claims should stay cautious and avoid overconfident wording.",
        ownerMeaning:
          "YEVIB can help the owner act, but should keep source limits and blind spots visible.",
      };
    }

    return {
      shouldSurface: false,
      cautionLevel: "none",
      cautionType: "none",
      summary: "No extra evidence caution is needed for this packet.",
      ownerMeaning:
        "YEVIB has enough source support to proceed within the normal evidence rules.",
    };
  })();

  return {
    normalizedEvidence,
    sortedEvidence,
    strengthSummary: {
      evidenceCount: strengthSummary.evidenceCount,
      evidenceState: strengthSummary.evidenceState,
      safeClaimLevel: strengthSummary.safeClaimLevel,
      strongestSourceType: strengthSummary.strongestSourceType,
      strongestSourcePriority: strengthSummary.strongestSourcePriority,
      sourceMix: strengthSummary.sourceMix,
      confidenceMix: strengthSummary.confidenceMix,
      claimBoundary: strengthSummary.claimBoundary,
      summary: strengthSummary.summary,
    },
    claimWording,
    evidenceCaution,
  };
}

function normalizeRegistryLookupResult(rawLookup = {}) {
  const allowedLookupStatuses = new Set([
    "matched",
    "not_found",
    "ambiguous",
    "error",
    "skipped",
  ]);

  if (!rawLookup || typeof rawLookup !== "object") {
    return {
      lookupStatus: "skipped",
      registryProfile: {},
      warning: "Registry lookup was skipped because no lookup payload was provided.",
    };
  }

  const lookupStatusRaw = String(rawLookup.lookupStatus || rawLookup.status || "")
    .trim()
    .toLowerCase();

  const lookupStatus = allowedLookupStatuses.has(lookupStatusRaw)
    ? lookupStatusRaw
    : "";

  const rawResults = Array.isArray(rawLookup.results)
    ? rawLookup.results
    : Array.isArray(rawLookup.matches)
    ? rawLookup.matches
    : [];

  if (lookupStatus === "error") {
    return {
      lookupStatus: "error",
      registryProfile: {},
      warning:
        String(rawLookup.warning || rawLookup.error || "").trim() ||
        "Registry lookup failed.",
    };
  }

  if (lookupStatus === "skipped") {
    return {
      lookupStatus: "skipped",
      registryProfile: {},
      warning:
        String(rawLookup.warning || "").trim() ||
        "Registry lookup was skipped.",
    };
  }

  if (lookupStatus === "not_found") {
    return {
      lookupStatus: "not_found",
      registryProfile: {},
      warning:
        String(rawLookup.warning || "").trim() ||
        "No official registry match was found.",
    };
  }

  if (lookupStatus === "ambiguous" || rawResults.length > 1) {
    return {
      lookupStatus: "ambiguous",
      registryProfile: {},
      warning:
        String(rawLookup.warning || "").trim() ||
        "Multiple possible registry matches were found.",
    };
  }

  const record =
    rawResults[0] ||
    rawLookup.record ||
    rawLookup.result ||
    rawLookup.registryProfile ||
    rawLookup;

  const businessName = String(
    record.businessName ||
      record.name ||
      record.mainName ||
      record.entityName ||
      record.organisationName ||
      ""
  ).trim();

  const matchedName = String(
    record.matchedName ||
      record.businessName ||
      record.name ||
      record.mainName ||
      record.entityName ||
      record.organisationName ||
      ""
  ).trim();

  const abn = String(record.abn || record.ABN || "").replace(/\s+/g, "").trim();
  const acn = String(record.acn || record.ACN || "").replace(/\s+/g, "").trim();

  const registrationStatus = String(
    record.registrationStatus ||
      record.status ||
      record.entityStatus ||
      record.abnStatus ||
      ""
  ).trim();

  const entityType = String(
    record.entityType ||
      record.entityTypeName ||
      record.organisationType ||
      ""
  ).trim();

  const gstStatus = String(
    record.gstStatus ||
      record.gst ||
      record.goodsAndServicesTax ||
      ""
  ).trim();

  const postcode = String(record.postcode || record.postCode || "").trim();
  const state = String(record.state || record.stateCode || "").trim();

  const sourceUrl = String(
    rawLookup.sourceUrl ||
      record.sourceUrl ||
      record.registryUrl ||
      "https://abr.business.gov.au/"
  ).trim();

  const confidence = String(rawLookup.confidence || record.confidence || "")
    .trim()
    .toLowerCase();

  const freshness = String(rawLookup.freshness || record.freshness || "")
    .trim()
    .toLowerCase();

  const hasCleanMatch = Boolean((businessName || matchedName) && abn);

  if (!hasCleanMatch) {
    return {
      lookupStatus: lookupStatus || "not_found",
      registryProfile: {},
      warning:
        String(rawLookup.warning || "").trim() ||
        "Registry lookup did not return a clean name and ABN match.",
    };
  }

  return {
    lookupStatus: "matched",
    registryProfile: {
      businessName,
      matchedName,
      abn,
      acn,
      entityType,
      status: registrationStatus,
      registrationStatus,
      gstStatus,
      postcode,
      state,
      sourceUrl,
      confidence: ["high", "medium", "low"].includes(confidence)
        ? confidence
        : "high",
      freshness: ["known", "unknown", "stale"].includes(freshness)
        ? freshness
        : "known",
    },
    warning: "",
  };
}

async function lookupOfficialRegistryForBusiness(input = {}) {
  const registryAdapterEnabled =
    String(process.env.UBDG_REGISTRY_ADAPTER_ENABLED || "")
      .trim()
      .toLowerCase() === "true";

  try {
    if (!registryAdapterEnabled) {
      return normalizeRegistryLookupResult({
        lookupStatus: "skipped",
        warning: "Registry lookup skipped because registry adapter is disabled.",
      });
    }

    const businessName = String(input?.businessName || "").trim();
    const businessUrl = String(input?.businessUrl || "").trim();

    if (!businessName && !businessUrl) {
      return normalizeRegistryLookupResult({
        lookupStatus: "skipped",
        warning:
          "Registry lookup skipped because no business name or URL was provided.",
      });
    }

    const abnLookupGuid = String(process.env.ABN_LOOKUP_GUID || "").trim();

    if (!abnLookupGuid) {
      return normalizeRegistryLookupResult({
        lookupStatus: "skipped",
        warning:
          "Registry lookup skipped because ABN_LOOKUP_GUID is not configured.",
      });
    }

    return normalizeRegistryLookupResult({
      lookupStatus: "skipped",
      warning: "Live registry lookup has not been implemented yet.",
    });
  } catch (err) {
    return normalizeRegistryLookupResult({
      lookupStatus: "error",
      warning:
        err?.message || "Registry lookup failed inside the registry adapter.",
    });
  }
}

function buildRegistryEvidenceForProfile(profile = {}) {
  const registryProfile =
    profile?.registryProfile ||
    profile?.sourceProfile?.registryProfile ||
    profile?.discoveryProfile?.registryProfile ||
    {};

  const registryName = String(
    registryProfile?.businessName ||
      registryProfile?.name ||
      registryProfile?.matchedName ||
      ""
  ).trim();

  const registryIdentifier = String(
    registryProfile?.abn ||
      registryProfile?.acn ||
      registryProfile?.registrationNumber ||
      registryProfile?.identifier ||
      ""
  ).trim();

  const registryStatus = String(
    registryProfile?.status ||
      registryProfile?.registrationStatus ||
      registryProfile?.recordStatus ||
      ""
  ).trim();

  const registrySourceUrl = String(
    registryProfile?.sourceUrl ||
      registryProfile?.registryUrl ||
      registryProfile?.url ||
      ""
  ).trim();

  const registryConfidence = String(registryProfile?.confidence || "").trim();
  const registryFreshness = String(registryProfile?.freshness || "").trim();

  const hasCleanRegistrySignal = Boolean(
    registryName || registryIdentifier || registryStatus
  );

  if (!hasCleanRegistrySignal) return [];

  const evidenceParts = [
    registryName ? `Official registry name: ${registryName}` : "",
    registryIdentifier ? `Registry identifier: ${registryIdentifier}` : "",
    registryStatus ? `Registry status: ${registryStatus}` : "",
  ].filter(Boolean);

  return [
    {
      sourceType: "registry",
      sourceUrl: registrySourceUrl,
      evidenceText: evidenceParts.join(". "),
      confidence: ["high", "medium", "low"].includes(registryConfidence)
        ? registryConfidence
        : registryName && registryIdentifier
        ? "high"
        : "medium",
      freshness: ["known", "unknown", "stale"].includes(registryFreshness)
        ? registryFreshness
        : registryStatus
        ? "known"
        : "unknown",
      claimType: "fact",
    },
  ];
}

function buildUbdgEvidencePacketForProfile(profile = {}) {
  const sourceProfile = profile?.sourceProfile || {};
  const businessProfile = profile?.businessProfile || {};
  const discoveryProfile = profile?.discoveryProfile || {};
  const registryEvidence = buildRegistryEvidenceForProfile(profile);

  const ownedWebsiteDiscoveryEvidence = uniqueStrings(
    [
      ...normalizeStringArray(discoveryProfile?.trustSignals || [], 4),
      ...normalizeStringArray(discoveryProfile?.educationSignals || [], 4),
      ...normalizeStringArray(discoveryProfile?.activitySignals || [], 4),
      ...normalizeStringArray(discoveryProfile?.founderVisibilitySignals || [], 4),
    ],
    8
  ).join(" ");

  return buildUbdgEvidencePacket([
    {
      sourceType: "owner_input",
      sourceUrl: "",
      evidenceText: sourceProfile?.voiceSourceText || "",
      confidence: sourceProfile?.weakVoiceSource ? "low" : "medium",
      freshness: "known",
      claimType: "signal",
    },
    {
      sourceType: "owned_website",
      sourceUrl: sourceProfile?.urlUsed || "",
      evidenceText: businessProfile?.summary || "",
      confidence: sourceProfile?.urlUsed ? "medium" : "low",
      freshness: "unknown",
      claimType: "signal",
    },
    {
      sourceType: "owned_website",
      sourceUrl: sourceProfile?.urlUsed || "",
      evidenceText: ownedWebsiteDiscoveryEvidence,
      confidence: sourceProfile?.urlUsed ? "medium" : "low",
      freshness: "unknown",
      claimType: "signal",
    },
    ...registryEvidence,
  ]);
}

async function runUbdgEvidenceHelperSelfTest() {
  const messyEvidence = [
    {
      sourceType: "social",
      sourceUrl: "https://example.com/instagram",
      evidenceText: "Posts suggest the business is active with local customers.",
      confidence: "medium",
      freshness: "known",
      claimType: "signal",
    },
    {
      sourceType: "owned_website",
      sourceUrl: "https://example.com/about",
      evidenceText: "Family-owned plumbing business serving Western Sydney.",
      confidence: "high",
      freshness: "known",
      claimType: "fact",
    },
    {
      sourceType: "owned_website",
      sourceUrl: "https://example.com/about",
      evidenceText: "Family-owned plumbing business serving Western Sydney.",
      confidence: "high",
      freshness: "known",
      claimType: "fact",
    },
    {
      sourceType: "unknown_source",
      sourceUrl: "",
      evidenceText: "Possibly focused on emergency work.",
      confidence: "certain",
      freshness: "",
      claimType: "guess",
    },
    {
      sourceType: "owner_input",
      sourceUrl: "",
      evidenceText: "The owner says the main goal is building trust with local homeowners.",
      confidence: "high",
      freshness: "known",
      claimType: "fact",
    },
    {
      sourceType: "registry",
      sourceUrl: "https://example.gov/register",
      evidenceText: "Official registration signal is visible.",
      confidence: "high",
      freshness: "unknown",
      claimType: "fact",
    },
    {
      sourceType: "review",
      sourceUrl: "https://example.com/reviews",
      evidenceText: "",
      confidence: "medium",
      freshness: "unknown",
      claimType: "signal",
    },
    null,
  ];

  const packet = buildUbdgEvidencePacket(messyEvidence, 10);

  const registryProfile = {
    registryProfile: {
      businessName: "Example Plumbing Pty Ltd",
      abn: "12345678901",
      status: "Active",
      sourceUrl: "https://example.gov/register",
    },
  };

  const mockLiveRegistryLookupContract = {
    sourceType: "registry",
    sourceName: "Mock Official Registry",
    sourceUrl: "https://example.gov/register",
    lookupStatus: "matched",
    businessName: "Example Plumbing Pty Ltd",
    matchedName: "Example Plumbing Pty Ltd",
    abn: "12345678901",
    acn: "",
    entityType: "Australian Private Company",
    registrationStatus: "Active",
    gstStatus: "Registered",
    postcode: "2000",
    state: "NSW",
    confidence: "high",
    freshness: "known",
    warning: "",
  };

  const normalizedMatchedLookup =
    normalizeRegistryLookupResult(mockLiveRegistryLookupContract);
  const mockLookupProfile = {
    registryProfile: normalizedMatchedLookup.registryProfile,
  };

  const ambiguousMockLookupContract = {
    sourceType: "registry",
    sourceName: "Mock Official Registry",
    sourceUrl: "https://example.gov/register",
    lookupStatus: "ambiguous",
    businessName: "",
    matchedName: "",
    abn: "",
    acn: "",
    entityType: "",
    registrationStatus: "",
    gstStatus: "",
    postcode: "",
    state: "",
    confidence: "low",
    freshness: "unknown",
    warning: "Multiple possible registry matches found.",
  };

  const normalizedAmbiguousLookup =
    normalizeRegistryLookupResult(ambiguousMockLookupContract);

  const normalizedNotFoundLookup = normalizeRegistryLookupResult({
    sourceType: "registry",
    sourceName: "Mock Official Registry",
    sourceUrl: "https://example.gov/register",
    lookupStatus: "not_found",
    results: [],
    warning: "No official registry match was found.",
  });

  const normalizedErrorLookup = normalizeRegistryLookupResult({
    sourceType: "registry",
    sourceName: "Mock Official Registry",
    sourceUrl: "https://example.gov/register",
    lookupStatus: "error",
    error: "Mock registry service failed.",
  });

      const normalizedSkippedLookup = normalizeRegistryLookupResult({
    sourceType: "registry",
    sourceName: "Mock Official Registry",
    lookupStatus: "skipped",
    warning: "Registry lookup skipped for this test.",
  });

  const previousRegistryAdapterEnabledEnv = process.env.UBDG_REGISTRY_ADAPTER_ENABLED;
  const previousAbnLookupGuidEnv = process.env.ABN_LOOKUP_GUID;

  delete process.env.UBDG_REGISTRY_ADAPTER_ENABLED;
  delete process.env.ABN_LOOKUP_GUID;

  const disabledRegistryAdapterLookup = await lookupOfficialRegistryForBusiness({
    businessName: "Example Plumbing Pty Ltd",
    businessUrl: "https://example.com",
    jurisdiction: "AU",
  });

  process.env.UBDG_REGISTRY_ADAPTER_ENABLED = "true";

  const emptyRegistryAdapterLookup = await lookupOfficialRegistryForBusiness({});

  const missingGuidRegistryAdapterLookup = await lookupOfficialRegistryForBusiness({
    businessName: "Example Plumbing Pty Ltd",
    businessUrl: "https://example.com",
    jurisdiction: "AU",
  });

  if (typeof previousRegistryAdapterEnabledEnv === "undefined") {
    delete process.env.UBDG_REGISTRY_ADAPTER_ENABLED;
  } else {
    process.env.UBDG_REGISTRY_ADAPTER_ENABLED = previousRegistryAdapterEnabledEnv;
  }

  if (typeof previousAbnLookupGuidEnv === "undefined") {
    delete process.env.ABN_LOOKUP_GUID;
  } else {
    process.env.ABN_LOOKUP_GUID = previousAbnLookupGuidEnv;
  }

  const disabledRegistryAdapterEvidence = buildRegistryEvidenceForProfile({
    registryProfile: disabledRegistryAdapterLookup.registryProfile,
  });

  const emptyRegistryAdapterEvidence = buildRegistryEvidenceForProfile({
    registryProfile: emptyRegistryAdapterLookup.registryProfile,
  });

  const missingGuidRegistryAdapterEvidence = buildRegistryEvidenceForProfile({
    registryProfile: missingGuidRegistryAdapterLookup.registryProfile,
  });

  const ambiguousMockLookupProfile = {
    registryProfile: normalizedAmbiguousLookup.registryProfile,
  };

  const registryEvidence = buildRegistryEvidenceForProfile(registryProfile);
  const mockLookupRegistryEvidence = buildRegistryEvidenceForProfile(mockLookupProfile);
  const ambiguousMockRegistryEvidence =
    buildRegistryEvidenceForProfile(ambiguousMockLookupProfile);
  const missingRegistryEvidence = buildRegistryEvidenceForProfile({});
  const profilePacket = buildUbdgEvidencePacketForProfile(registryProfile);
    const registryOnlyPacket = buildUbdgEvidencePacket(registryEvidence);
  const mockLookupRegistryOnlyPacket =
    buildUbdgEvidencePacket(mockLookupRegistryEvidence);
  const missingRegistryPacket = buildUbdgEvidencePacket(missingRegistryEvidence);

    const registryEvidenceItem = registryEvidence[0] || null;
  const mockLookupRegistryEvidenceItem = mockLookupRegistryEvidence[0] || null;
  const registryOnlyBoundary =
    registryOnlyPacket?.strengthSummary?.claimBoundary || {};
  const mockLookupRegistryOnlyBoundary =
    mockLookupRegistryOnlyPacket?.strengthSummary?.claimBoundary || {};

    const sourceImprovementGuidanceTest = buildSourceImprovementGuidance({
    evidenceProfile: {
      missingEvidence: [],
    },
    qualificationProfile: {
      executionEligible: true,
      level: "diagnosable",
    },
    ubdgEvidencePacket: {
      evidenceCaution: {
        cautionType: "limited_source_support",
      },
      strengthSummary: {
        safeClaimLevel: "cautious",
      },
    },
  });

  function sourceImprovementGuidanceHasContradictoryOwnerGuidance(guidance = {}) {
    const shouldImproveSources = guidance?.shouldImproveSources === true;
    const nextActions = Array.isArray(guidance?.nextActions)
      ? guidance.nextActions
      : [];
    const serializedNextActions = JSON.stringify(nextActions);

    if (!shouldImproveSources) return false;

    return (
      nextActions.length === 0 ||
      guidance.minimumUsefulAction ===
        "No extra source material is needed right now." ||
      serializedNextActions.includes("No extra source material is needed right now.")
    );
  }

  const sourceImprovementGuidanceHasContradiction =
    sourceImprovementGuidanceHasContradictoryOwnerGuidance(
      sourceImprovementGuidanceTest
    );

    const checks = {
    basePacketHasNormalizedEvidence: Array.isArray(packet.normalizedEvidence),
    basePacketHasSortedEvidence: Array.isArray(packet.sortedEvidence),
    basePacketHasStrengthSummary: Boolean(packet.strengthSummary),
        basePacketHasClaimWording: Boolean(packet.claimWording),
    basePacketHasEvidenceCaution: Boolean(packet.evidenceCaution),
    basePacketEvidenceCautionHasSurfaceFlag:
      typeof packet.evidenceCaution?.shouldSurface === "boolean",
    basePacketEvidenceCautionHasType:
      Boolean(packet.evidenceCaution?.cautionType),

        sourceImprovementGuidanceReturnsObject:
      Boolean(sourceImprovementGuidanceTest),
    sourceImprovementGuidanceShouldImproveSourcesIsTrue:
      sourceImprovementGuidanceTest?.shouldImproveSources === true,
    sourceImprovementGuidanceNextActionsNotEmpty:
      Array.isArray(sourceImprovementGuidanceTest?.nextActions) &&
      sourceImprovementGuidanceTest.nextActions.length > 0,
    sourceImprovementGuidanceMinimumUsefulActionIsNotNoExtraSourceMaterial:
      sourceImprovementGuidanceTest?.minimumUsefulAction !==
      "No extra source material is needed right now.",
    sourceImprovementGuidanceHasNoContradiction:
      sourceImprovementGuidanceHasContradiction === false,

    registryOnlyPacketSurfacesEvidenceCaution:
      registryOnlyPacket.evidenceCaution?.shouldSurface === true,
    registryOnlyPacketCautionTypeIsRegistryIdentityOnly:
      registryOnlyPacket.evidenceCaution?.cautionType ===
      "registry_identity_only",
    registryOnlyPacketCautionLevelIsHigh:
      registryOnlyPacket.evidenceCaution?.cautionLevel === "high",

    missingRegistryPacketDoesNotSurfaceEvidenceCaution:
      missingRegistryPacket.evidenceCaution?.shouldSurface === false,
    missingRegistryPacketCautionTypeIsNone:
      missingRegistryPacket.evidenceCaution?.cautionType === "none",

    mockLookupRegistryOnlyPacketSurfacesEvidenceCaution:
      mockLookupRegistryOnlyPacket.evidenceCaution?.shouldSurface === true,
    mockLookupRegistryOnlyPacketCautionTypeIsRegistryIdentityOnly:
      mockLookupRegistryOnlyPacket.evidenceCaution?.cautionType ===
      "registry_identity_only",

    registryHelperReturnsOneItem: registryEvidence.length === 1,
    registryHelperSourceTypeIsRegistry:
      registryEvidenceItem?.sourceType === "registry",
    registryHelperClaimTypeIsFact:
      registryEvidenceItem?.claimType === "fact",
    registryHelperUsesOfficialRecordUrl:
      registryEvidenceItem?.sourceUrl === "https://example.gov/register",
    registryHelperTextIncludesBusinessName:
      String(registryEvidenceItem?.evidenceText || "").includes(
        "Example Plumbing Pty Ltd"
      ),
    registryHelperTextIncludesIdentifier:
      String(registryEvidenceItem?.evidenceText || "").includes("12345678901"),

    normalizerMatchedStatusIsMatched:
      normalizedMatchedLookup.lookupStatus === "matched",
    normalizerMatchedProfileHasBusinessName:
      normalizedMatchedLookup.registryProfile?.businessName ===
      "Example Plumbing Pty Ltd",
    normalizerMatchedProfileHasIdentifier:
      normalizedMatchedLookup.registryProfile?.abn === "12345678901",
    normalizerMatchedProfileUsesSourceUrl:
      normalizedMatchedLookup.registryProfile?.sourceUrl ===
      "https://example.gov/register",
    normalizerMatchedWarningIsEmpty:
      normalizedMatchedLookup.warning === "",

    normalizerAmbiguousStatusIsAmbiguous:
      normalizedAmbiguousLookup.lookupStatus === "ambiguous",
    normalizerAmbiguousProfileIsEmpty:
      Object.keys(normalizedAmbiguousLookup.registryProfile || {}).length === 0,
    normalizerAmbiguousWarningExists:
      Boolean(normalizedAmbiguousLookup.warning),

    normalizerNotFoundStatusIsNotFound:
      normalizedNotFoundLookup.lookupStatus === "not_found",
    normalizerNotFoundProfileIsEmpty:
      Object.keys(normalizedNotFoundLookup.registryProfile || {}).length === 0,
    normalizerNotFoundWarningExists:
      Boolean(normalizedNotFoundLookup.warning),

    normalizerErrorStatusIsError:
      normalizedErrorLookup.lookupStatus === "error",
    normalizerErrorProfileIsEmpty:
      Object.keys(normalizedErrorLookup.registryProfile || {}).length === 0,
    normalizerErrorWarningExists:
      Boolean(normalizedErrorLookup.warning),

    normalizerSkippedStatusIsSkipped:
      normalizedSkippedLookup.lookupStatus === "skipped",
    normalizerSkippedProfileIsEmpty:
      Object.keys(normalizedSkippedLookup.registryProfile || {}).length === 0,
        normalizerSkippedWarningExists:
      Boolean(normalizedSkippedLookup.warning),

        disabledRegistryAdapterStatusIsSkipped:
      disabledRegistryAdapterLookup.lookupStatus === "skipped",
    disabledRegistryAdapterProfileIsEmpty:
      Object.keys(disabledRegistryAdapterLookup.registryProfile || {}).length === 0,
    disabledRegistryAdapterWarningExists:
      Boolean(disabledRegistryAdapterLookup.warning),
    disabledRegistryAdapterCreatesNoEvidence:
      Array.isArray(disabledRegistryAdapterEvidence) &&
      disabledRegistryAdapterEvidence.length === 0,

        emptyRegistryAdapterStatusIsSkipped:
      emptyRegistryAdapterLookup.lookupStatus === "skipped",
    emptyRegistryAdapterProfileIsEmpty:
      Object.keys(emptyRegistryAdapterLookup.registryProfile || {}).length === 0,
    emptyRegistryAdapterWarningExists:
      Boolean(emptyRegistryAdapterLookup.warning),
    emptyRegistryAdapterCreatesNoEvidence:
      Array.isArray(emptyRegistryAdapterEvidence) &&
      emptyRegistryAdapterEvidence.length === 0,

    missingGuidRegistryAdapterStatusIsSkipped:
      missingGuidRegistryAdapterLookup.lookupStatus === "skipped",
    missingGuidRegistryAdapterProfileIsEmpty:
      Object.keys(missingGuidRegistryAdapterLookup.registryProfile || {}).length === 0,
    missingGuidRegistryAdapterWarningExists:
      Boolean(missingGuidRegistryAdapterLookup.warning),
    missingGuidRegistryAdapterCreatesNoEvidence:
      Array.isArray(missingGuidRegistryAdapterEvidence) &&
      missingGuidRegistryAdapterEvidence.length === 0,

    mockLookupContractIsMatched:
      mockLiveRegistryLookupContract.lookupStatus === "matched",
    mockLookupRegistryHelperReturnsOneItem:
      mockLookupRegistryEvidence.length === 1,
    mockLookupRegistrySourceTypeIsRegistry:
      mockLookupRegistryEvidenceItem?.sourceType === "registry",
    mockLookupRegistryClaimTypeIsFact:
      mockLookupRegistryEvidenceItem?.claimType === "fact",
    mockLookupRegistryTextIncludesBusinessName:
      String(mockLookupRegistryEvidenceItem?.evidenceText || "").includes(
        "Example Plumbing Pty Ltd"
      ),
    mockLookupRegistryTextIncludesIdentifier:
      String(mockLookupRegistryEvidenceItem?.evidenceText || "").includes(
        "12345678901"
      ),
    mockLookupRegistryOnlyPacketIsIdentityOnly:
      mockLookupRegistryOnlyPacket?.strengthSummary?.safeClaimLevel ===
      "identity_only",
    mockLookupRegistryOnlyBoundaryIsIdentitySupported:
      mockLookupRegistryOnlyBoundary.identitySupported === true,
    mockLookupRegistryOnlyBoundaryDoesNotSupportBusinessTrust:
      mockLookupRegistryOnlyBoundary.businessTrustSupported === false,

    ambiguousMockLookupDoesNotCreateEvidence:
      ambiguousMockLookupContract.lookupStatus === "ambiguous" &&
      Array.isArray(ambiguousMockRegistryEvidence) &&
      ambiguousMockRegistryEvidence.length === 0,

    missingRegistryFieldsReturnEmptyArray:
      Array.isArray(missingRegistryEvidence) &&
      missingRegistryEvidence.length === 0,
    profilePacketReceivesRegistryEvidence:
      Array.isArray(profilePacket.normalizedEvidence) &&
      profilePacket.normalizedEvidence.some(
        (item) => item.sourceType === "registry"
      ),
    registryOnlyPacketIsIdentityOnly:
      registryOnlyPacket?.strengthSummary?.safeClaimLevel === "identity_only",
    registryOnlyBoundaryIsIdentitySupported:
      registryOnlyBoundary.identitySupported === true,
    registryOnlyBoundaryDoesNotSupportBusinessTrust:
      registryOnlyBoundary.businessTrustSupported === false,
    registryOnlyBoundaryBlocksTrustClaimWords:
      Array.isArray(registryOnlyBoundary.forbiddenClaimExamples) &&
      registryOnlyBoundary.forbiddenClaimExamples.includes("trustworthy") &&
      registryOnlyBoundary.forbiddenClaimExamples.includes("high quality") &&
      registryOnlyBoundary.forbiddenClaimExamples.includes("safe to buy from") &&
      registryOnlyBoundary.forbiddenClaimExamples.includes("active") &&
      registryOnlyBoundary.forbiddenClaimExamples.includes("successful"),
  };

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const result = {
    ok: failedChecks.length === 0,
    test: "ubdg_registry_evidence_helper_self_test",
    checks,
    failedChecks,
    registryEvidence,
    mockLiveRegistryLookupContract,
    mockLookupRegistryEvidence,
    ambiguousMockLookupContract,
    ambiguousMockRegistryEvidence,
    missingRegistryEvidence,
    disabledRegistryAdapterLookup,
    disabledRegistryAdapterEvidence,
    emptyRegistryAdapterLookup,
    emptyRegistryAdapterEvidence,
    profilePacketSummary: {
      normalizedEvidenceCount: profilePacket.normalizedEvidence.length,
      hasRegistryEvidence: profilePacket.normalizedEvidence.some(
        (item) => item.sourceType === "registry"
      ),
      sourceMix: profilePacket.strengthSummary.sourceMix,
      strongestSourceType: profilePacket.strengthSummary.strongestSourceType,
      safeClaimLevel: profilePacket.strengthSummary.safeClaimLevel,
    },
    registryOnlyPacketSummary: {
      normalizedEvidenceCount: registryOnlyPacket.normalizedEvidence.length,
      evidenceState: registryOnlyPacket.strengthSummary.evidenceState,
      safeClaimLevel: registryOnlyPacket.strengthSummary.safeClaimLevel,
      claimLead: registryOnlyPacket.claimWording.claimLead,
      claimBoundary: registryOnlyPacket.strengthSummary.claimBoundary,
    },
    mockLookupRegistryOnlyPacketSummary: {
      normalizedEvidenceCount:
        mockLookupRegistryOnlyPacket.normalizedEvidence.length,
      evidenceState: mockLookupRegistryOnlyPacket.strengthSummary.evidenceState,
      safeClaimLevel:
        mockLookupRegistryOnlyPacket.strengthSummary.safeClaimLevel,
      claimLead: mockLookupRegistryOnlyPacket.claimWording.claimLead,
      claimBoundary:
        mockLookupRegistryOnlyPacket.strengthSummary.claimBoundary,
    },
    basePacketSummary: {
      normalizedEvidenceCount: packet.normalizedEvidence.length,
      sortedEvidenceCount: packet.sortedEvidence.length,
      evidenceState: packet.strengthSummary.evidenceState,
      safeClaimLevel: packet.strengthSummary.safeClaimLevel,
      strongestSourceType: packet.strengthSummary.strongestSourceType,
      claimLead: packet.claimWording.claimLead,
    },
  };

  console.log("UBDG registry evidence helper self-test:");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    throw new Error(
      `UBDG registry evidence helper self-test failed: ${failedChecks.join(", ")}`
    );
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
  if (score >= 78) return { label: "Strong", colorKey: "green" };
  if (score >= 52) return { label: "Developing", colorKey: "amber" };
  return { label: "Limited", colorKey: "red" };
}

function getGroupState(score = 0, max = 100) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 78) return { label: "Strong", colorKey: "green" };
  if (pct >= 52) return { label: "Developing", colorKey: "amber" };
  return { label: "Limited", colorKey: "red" };
}

function getScoreBand(score = 0, max = 100, groupKey = "") {
  if (groupKey === "brandCore") {
    if (score >= 24) return "strong";
    if (score >= 15) return "developing";
    return "limited";
  }
  if (groupKey === "marketSignal" || groupKey === "optimization") {
    if (score >= 20) return "strong";
    if (score >= 12) return "developing";
    return "limited";
  }
  if (groupKey === "sourceMix") {
    if (score >= 16) return "strong";
    if (score >= 10) return "developing";
    return "limited";
  }

  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 78) return "strong";
  if (pct >= 52) return "developing";
  return "limited";
}

function confidencePrefix(confidence = "medium") {
  if (confidence === "high") return "YEVIB can see";
  if (confidence === "low") return "The current scan suggests";
  return "YEVIB can reasonably infer";
}

function confidenceActionLead(confidence = "medium") {
  if (confidence === "high") return "The most useful move now is to";
  if (confidence === "low") return "A sensible next step is to";
  return "The clearest next move is to";
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

function getDefaultPhase3TestMatrix() {
  return {
    meta: {
      name: "YEVIB Phase 3 Intelligence Regression Matrix",
      version: "2026-04-27",
      purpose:
        "Tests whether YEVIB can qualify business signal, diagnose readiness, choose a useful strategy, and avoid overclaiming when source evidence is weak.",
      status: "active",
    },
    defaults: {
      mode: "hybrid",
      founderGoal: "Build more trust",
      pastedSourceText: "",
      ownerWritingSample: "",
    },
    sites: [
      {
        id: "local_service_01",
        group: "local_service",
        label: "Local service business 1",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "trust_or_visibility",
        notes: "Replace businessUrl with a real local service business test URL.",
      },
      {
        id: "local_service_02",
        group: "local_service",
        label: "Local service business 2",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "trust_or_visibility",
        notes: "Replace businessUrl with a real local service business test URL.",
      },
      {
        id: "local_service_03",
        group: "local_service",
        label: "Local service business 3",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "trust_or_visibility",
        notes: "Replace businessUrl with a real local service business test URL.",
      },
      {
        id: "ecommerce_01",
        group: "small_ecommerce",
        label: "Small e-commerce brand 1",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "product_truth_or_trust",
        notes: "Replace businessUrl with a real small e-commerce brand test URL.",
      },
      {
        id: "ecommerce_02",
        group: "small_ecommerce",
        label: "Small e-commerce brand 2",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "product_truth_or_trust",
        notes: "Replace businessUrl with a real small e-commerce brand test URL.",
      },
      {
        id: "ecommerce_03",
        group: "small_ecommerce",
        label: "Small e-commerce brand 3",
        businessUrl: "",
        expectedQualification: "diagnosable",
        expectedSignalLevel: "medium_to_strong",
        expectedStrategyPressure: "product_truth_or_trust",
        notes: "Replace businessUrl with a real small e-commerce brand test URL.",
      },
      {
        id: "mixed_signal_01",
        group: "mixed_signal",
        label: "Mixed-signal business 1",
        businessUrl: "",
        expectedQualification: "cautious",
        expectedSignalLevel: "limited_to_medium",
        expectedStrategyPressure: "clarity_or_trust",
        notes: "Replace businessUrl with a real mixed-signal business test URL.",
      },
      {
        id: "mixed_signal_02",
        group: "mixed_signal",
        label: "Mixed-signal business 2",
        businessUrl: "",
        expectedQualification: "cautious",
        expectedSignalLevel: "limited_to_medium",
        expectedStrategyPressure: "clarity_or_trust",
        notes: "Replace businessUrl with a real mixed-signal business test URL.",
      },
      {
        id: "mixed_signal_03",
        group: "mixed_signal",
        label: "Mixed-signal business 3",
        businessUrl: "",
        expectedQualification: "cautious",
        expectedSignalLevel: "limited_to_medium",
        expectedStrategyPressure: "clarity_or_trust",
        notes: "Replace businessUrl with a real mixed-signal business test URL.",
      },
      {
        id: "thin_signal_01",
        group: "thin_signal",
        label: "Thin-signal business 1",
        businessUrl: "",
        expectedQualification: "blocked_or_low_confidence",
        expectedSignalLevel: "weak",
        expectedStrategyPressure: "request_more_source_signal",
        notes: "Replace businessUrl with a real thin-signal business test URL.",
      },
      {
        id: "thin_signal_02",
        group: "thin_signal",
        label: "Thin-signal business 2",
        businessUrl: "",
        expectedQualification: "blocked_or_low_confidence",
        expectedSignalLevel: "weak",
        expectedStrategyPressure: "request_more_source_signal",
        notes: "Replace businessUrl with a real thin-signal business test URL.",
      },
      {
        id: "thin_signal_03",
        group: "thin_signal",
        label: "Thin-signal business 3",
        businessUrl: "",
        expectedQualification: "blocked_or_low_confidence",
        expectedSignalLevel: "weak",
        expectedStrategyPressure: "request_more_source_signal",
        notes: "Replace businessUrl with a real thin-signal business test URL.",
      },
    ],
  };
}

function ensurePhase3TestMatrixFile() {
  if (!fs.existsSync(PHASE3_TEST_MATRIX_PATH)) {
    fs.writeFileSync(
      PHASE3_TEST_MATRIX_PATH,
      JSON.stringify(getDefaultPhase3TestMatrix(), null, 2),
      "utf8"
    );
  }
}

function readPhase3TestMatrix() {
  ensurePhase3TestMatrixFile();

  try {
    const raw = fs.readFileSync(PHASE3_TEST_MATRIX_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return getDefaultPhase3TestMatrix();
    }

    if (!Array.isArray(parsed.sites)) {
      parsed.sites = [];
    }

    return parsed;
  } catch (err) {
    console.error("PHASE 3 TEST MATRIX READ ERROR:", err.message);
    return getDefaultPhase3TestMatrix();
  }
}

function writePhase3TestMatrix(matrix = {}) {
  const safeMatrix =
    matrix && typeof matrix === "object"
      ? {
          ...matrix,
          sites: Array.isArray(matrix.sites) ? matrix.sites : [],
        }
      : getDefaultPhase3TestMatrix();

  fs.writeFileSync(
    PHASE3_TEST_MATRIX_PATH,
    JSON.stringify(safeMatrix, null, 2),
    "utf8"
  );

  return safeMatrix;
}

function getRunnablePhase3Sites(matrix = {}) {
  const sites = Array.isArray(matrix?.sites) ? matrix.sites : [];

  return sites.filter((site) => {
    const url = String(site?.businessUrl || "").trim();
    return Boolean(url);
  });
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

  const bodyText = [
    title,
    metaDescription,
    ...h1Matches,
    ...h2Matches,
    ...pMatches.slice(0, 20),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    url,
    title,
    metaDescription,
    h1: h1Matches[0] || "",
    headings: [...h1Matches, ...h2Matches].slice(0, 12),
    paragraphs: pMatches,
    bodyText,
  };
}

function inferWebsiteLocationContext(pages = [], normalizedUrl = "") {
  const combinedText = pages
    .map((page) =>
      [
        page?.title || "",
        page?.metaDescription || "",
        ...(page?.headings || []),
        ...(page?.paragraphs || []).slice(0, 8),
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const lower = combinedText.toLowerCase();
  const urlLower = String(normalizedUrl || "").toLowerCase();

  const hasAustralia =
    /\baustralia\b|\baustralian\b|\bnsw\b|\bnew south wales\b|\bsydney\b|\bliverpool\b/.test(lower) ||
    /\.com\.au\b/.test(urlLower);

  const city =
    /\bliverpool\b/.test(lower)
      ? "Liverpool"
      : /\bsydney\b/.test(lower)
      ? "Sydney"
      : "";

  const state =
    /\bnsw\b|\bnew south wales\b/.test(lower) ? "NSW" : "";

  const country = hasAustralia ? "Australia" : "";

  let environmentType = "real working environment";

  if (/warehouse|industrial|factory|logistics|dispatch|loading dock|commercial site/.test(lower)) {
    environmentType = "industrial commercial environment";
  } else if (/clinic|medical|dental|patient|treatment room/.test(lower)) {
    environmentType = "clinical environment";
  } else if (/construction|fitout|site|builder|compliance|project/.test(lower)) {
    environmentType = "construction site environment";
  } else if (/home|residential|driveway|family home/.test(lower)) {
    environmentType = "residential service environment";
  } else if (/roadside|mobile mechanic|fleet|truck|vehicle|breakdown/.test(lower)) {
    environmentType = "roadside service environment";
  }

  return {
    country,
    state,
    city,
    environmentType,
    combinedText,
  };
}

function inferWebsiteVisualIdentity(pages = [], groupedPages = {}, lanes = {}) {
  const combinedText = pages
    .map((page) =>
      [
        page?.title || "",
        page?.metaDescription || "",
        ...(page?.headings || []),
        ...(page?.paragraphs || []).slice(0, 8),
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const lower = combinedText.toLowerCase();
  const productTruthText = (lanes?.brandProductTruth || []).join(" ").toLowerCase();

  const toneTags = [];
  const paletteTags = [];
  const environmentTags = [];
  const brandingTags = [];

  if (/industrial|fleet|truck|mechanic|commercial driver|heavy vehicle|mobile mechanical/.test(lower + " " + productTruthText)) {
    toneTags.push("industrial", "practical", "no-nonsense");
    paletteTags.push("neutral", "workwear black", "white", "grey");
    environmentTags.push("real working environments");
    brandingTags.push("trade-focused", "functional");
  }

  if (/clinical|medical|doctor|dental|patient|sleep|implant|treatment/.test(lower + " " + productTruthText)) {
    toneTags.push("clinical", "clean", "professional");
    paletteTags.push("clean neutrals", "soft whites", "medical tones");
    environmentTags.push("treatment and consultation environments");
    brandingTags.push("professional", "trust-led");
  }

  if (/construction|fitout|builder|site|compliance|project|commercial project/.test(lower + " " + productTruthText)) {
    toneTags.push("practical", "disciplined", "site-led");
    paletteTags.push("neutral construction tones", "safety colours", "workwear tones");
    environmentTags.push("real commercial build environments");
    brandingTags.push("functional", "project-focused");
  }

  if (/coolroom|refrigeration|hvac|branch|service team|stock|cooling/.test(lower + " " + productTruthText)) {
    toneTags.push("technical", "responsive", "commercial");
    paletteTags.push("neutral industrial tones", "whites", "greys", "utility colours");
    environmentTags.push("plant rooms, loading areas, service spaces");
    brandingTags.push("service-led", "operational");
  }

  if (/luxury|premium|bespoke|handcrafted|artisan/.test(lower)) {
    toneTags.push("premium");
    paletteTags.push("refined neutrals");
    brandingTags.push("elevated");
  }

  if (/family|community|friendly|local/.test(lower)) {
    toneTags.push("human", "grounded");
    environmentTags.push("real local environments");
  }

  const tone = uniqueStrings(toneTags, 6).join(", ") || "grounded, real, business-appropriate";
  const palette = uniqueStrings(paletteTags, 6).join(", ") || "natural business-appropriate colours";
  const environment = uniqueStrings(environmentTags, 6).join(", ") || "real working environments";
  const brandingStyle = uniqueStrings(brandingTags, 6).join(", ") || "unbranded, practical, context-led";

  return {
    tone,
    palette,
    environment,
    brandingStyle,
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
  const locationContext = inferWebsiteLocationContext(allPages, normalizedUrl);
  const visualIdentity = inferWebsiteVisualIdentity(allPages, groupedPages, classified);

  return {
    pages: allPages,
    homepageLinks: menuFounderLinks,
    allDiscoveredLinks: dedupedHomepageLinks,
    socialLinks,
    groupedPages,
    lanes: classified,
    locationContext,
    visualIdentity,
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
    return "The business has enough material to post from more regularly. Turn the strongest current theme into one repeatable weekly format.";
  }
  if (/clarify brand voice/.test(goal)) {
    return weakVoice
      ? "Bring more founder-written language into the public brand so the business sounds less generic and more recognisable."
      : "Tighten the public-facing language so the founder voice carries more clearly across the business.";
  }
  if (/educational/.test(goal)) {
    return educationSignals.length > 0
      ? "The business already shows usable teaching signal. Turn that into clearer educational content that explains why the work matters."
      : "Use product truth and process detail to build simple educational content people can understand quickly.";
  }
  if (/trust/.test(goal)) {
    return trustSignals.length > 0
      ? "The business already has trust signal. Put it where people can see it more clearly."
      : "Make standards, proof, and process more visible so the business feels credible faster.";
  }
  if (/promote products or services/.test(goal)) {
    return offers.length > 0
      ? "Make the offer easier to understand through real-life use cases instead of feature description alone."
      : "Clarify the offer in practical terms so people can understand what the business does and why it matters.";
  }
  if (/founder presence/.test(goal)) {
    return "Make the founder more visible in the public-facing language of the brand so the business feels more human-led and memorable.";
  }

  if (category === "Everyday Ritual" || lifeMoments.length > 0) {
    return "The business already lends itself to repeat-use content. Turn that into one steady content theme built around real daily use.";
  }
  if (educationSignals.length > 0) {
    return "There is already enough knowledge in the business to support clearer educational content. Turn that into a repeatable public asset.";
  }
  if (activitySignals.length > 0) {
    return "Use the activity already visible in the business and make it more public so the brand feels more current.";
  }
  if (audience.length > 0) {
    return "Speak more directly to the audience the business already appears to serve so the public signal becomes easier to read.";
  }

  return "Take the clearest existing business truth and turn it into one repeatable public-facing theme the brand can return to consistently.";
}

function adaptRecommendedFocusByBand(focus = "", band = "developing", founderGoal = "") {
  const clean = String(focus || "").trim();
  if (!clean) return "";

  if (band === "limited") return clean;

  const lower = clean.toLowerCase();
  const goal = String(founderGoal || "").toLowerCase();

  if (band === "strong") {
    if (lower.includes("already has trust signal") || lower.includes("put it where people can see it more clearly")) {
      return "Use the trust signal already present more deliberately so it does more public work.";
    }
    if (lower.includes("already shows usable teaching signal")) {
      return "Turn the teaching signal already present into a stronger public advantage through clearer educational content.";
    }
    if (lower.includes("enough material to post from more regularly")) {
      return "Use the strongest current theme as a repeatable weekly advantage so the business posts with more momentum and less friction.";
    }
    if (lower.includes("bring more founder-written language")) {
      return "Use more founder-led language deliberately so the business feels more distinct and human in public.";
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
    if (lower.includes("use the activity already visible")) {
      return "Turn the activity already present into more visible public momentum so it does more work for the brand.";
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
    if (lower.includes("already has trust signal") || lower.includes("put it where people can see it more clearly")) {
      return "Bring the trust signal already present forward more clearly so it does more public work.";
    }
    if (lower.includes("already shows usable teaching signal")) {
      return "Sharpen the teaching signal already present into clearer educational content.";
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
      return "Turn the knowledge already present into clearer educational content people can follow easily.";
    }
    if (lower.includes("use the activity already visible")) {
      return "Make the activity already present more visible so the brand feels more current and active.";
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

  if (weakVoice) weakPoints.push("Founder voice is still thin, so the public brand risks sounding more product-led than person-led");
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
    "Clarify the strongest current business truth and use it more consistently.";

  const cleanFocus = ensureSentence(sentenceCase(focus));

  const sentence1 = `${lead} that ${strong.toLowerCase()}.`;
  const sentence2 = `What looks underbuilt right now is that ${weak.toLowerCase()}.`;
  const sentence3 = `Best next step: ${cleanFocus.charAt(0).toLowerCase()}${cleanFocus.slice(1)}`;

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

  if (businessSummary.length >= 120) {
    score += 7;
    strengths.push("The business identity is clear enough to anchor the scan");
  } else if (businessSummary.length >= 80) {
    score += 4;
    strengths.push("The business identity is partly clear");
    weaknesses.push("The core business story still needs sharper wording");
  } else {
    weaknesses.push("The core business story is still too thin");
  }

  if (voiceSummary.length >= 90 && !weakVoice) {
    score += 7;
    strengths.push("Founder voice is strong enough to make the brand feel distinct");
  } else if (voiceSummary.length >= 60 && !weakVoice) {
    score += 4;
    strengths.push("There is some founder voice to work with");
    weaknesses.push("Founder voice is present but not yet carrying enough weight");
  } else if (voiceSummary.length >= 30) {
    score += 2;
    weaknesses.push("There is some founder voice, but it is not yet carrying enough weight");
  } else {
    weaknesses.push("Founder voice is still too weak or too generic");
  }

  if (String(founderGoal || "").trim()) {
    score += 3;
    strengths.push("The founder goal gives the scan a usable direction");
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

  if (doRules.length >= 4) {
    score += 5;
    strengths.push("The brand already carries founder-led behavior in its language");
  } else if (doRules.length >= 2) {
    score += 3;
    strengths.push("The brand carries some founder-led behavior in its language");
    weaknesses.push("The language rules are still not strong enough to hold the voice consistently");
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
    summary = `${lead} a clear brand core that is already doing useful public work. The founder signal is visible enough to use more deliberately, not rebuild from scratch.`;
  } else if (band === "developing") {
    summary = `${lead} a recognisable brand core, but founder presence or message clarity is still not carrying enough weight consistently.`;
  } else {
    summary = `${lead} only a partial brand core right now, which makes the business feel less distinct than it should.`;
  }

  let nextMove = "";
  if (band === "strong") {
    if (/founder presence/.test(goal) || weakVoice || founderLimited) {
      nextMove = "Use the founder signal more deliberately so it carries more weight across the public brand.";
    } else if (/clarify brand voice/.test(goal)) {
      nextMove = "Carry the founder voice more consistently across the public-facing language so the brand feels even more distinct.";
    } else {
      nextMove = "Turn the founder-led side of the brand into a clearer public advantage.";
    }
  } else if (band === "developing") {
    if (/founder presence/.test(goal) || weakVoice || founderLimited) {
      nextMove = "Strengthen the founder-led side of the brand so the public identity feels clearer and more consistent.";
    } else if (/clarify brand voice/.test(goal)) {
      nextMove = "Tighten the public language so the founder voice carries more clearly across the business.";
    } else {
      nextMove = "Sharpen the founder-led side of the brand so the public identity feels easier to read.";
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

  if (offers.length >= 2) {
    score += 5;
    strengths.push("The offer is visible enough to work with");
  } else if (offers.length === 1) {
    score += 3;
    strengths.push("The offer is partly visible");
    weaknesses.push("The offer still needs clearer framing");
  } else {
    weaknesses.push("The offer is not yet clear enough in public-facing material");
  }

  if (audience.length >= 2) {
    score += 5;
    strengths.push("The audience is legible enough to shape clearer messaging");
  } else if (audience.length === 1) {
    score += 3;
    strengths.push("There is some audience signal");
    weaknesses.push("Audience signal is still too light");
  } else {
    weaknesses.push("Audience signal is still too weak");
  }

  if (trustSignals.length >= 2) {
    score += 5;
    strengths.push("Trust and proof markers are already present");
  } else if (trustSignals.length === 1) {
    score += 3;
    strengths.push("There is some trust signal");
    weaknesses.push("Trust signal is still not strong enough yet");
  } else {
    weaknesses.push("Trust signal is still too hidden or too thin");
  }

  if (educationSignals.length >= 2) {
    score += 4;
    strengths.push("The business has educational signal it can use more clearly");
  } else if (educationSignals.length === 1) {
    score += 2;
    strengths.push("There is some educational signal");
    weaknesses.push("Educational signal is not yet clearly surfaced");
  } else {
    weaknesses.push("Educational signal is not yet clearly surfaced");
  }

  if (activitySignals.length > 0 && lifeMoments.length > 0) {
    score += 4;
    strengths.push("There are enough real-world cues to make the brand feel believable");
  } else if (activitySignals.length > 0 || lifeMoments.length > 0) {
    score += 2;
    strengths.push("There is some real-world context to work with");
    weaknesses.push("The public brand still needs more lived context");
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
    summary = `${lead} enough offer, audience, and trust signal to understand how the business lands publicly. This part of the brand is visible enough to leverage further.`;
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
  let weaknesses = [];

  const opportunities = normalizeStringArray(advisorSnapshot?.opportunities, 6);
  const blindSpots = normalizeStringArray(advisorSnapshot?.blindSpots, 6);
  const recommendedFocus = String(advisorSnapshot?.recommendedFocus || "").trim();
  const suggestedCategory = String(contentProfile?.suggestedCategory || "").trim();
  const suggestedIdea = String(contentProfile?.suggestedIdea || "").trim();
  const confidence = discoveryProfile?.sourceConfidence || "medium";

  if (opportunities.length >= 3) {
    score += 7;
    strengths.push("YEVIB can already point to specific improvement opportunities");
  } else if (opportunities.length >= 1) {
    score += 4;
    strengths.push("There is at least one usable opportunity");
    weaknesses.push("The opportunity map is still not broad enough yet");
  } else {
    weaknesses.push("Optimization guidance is still too general");
  }

  if (recommendedFocus.length >= 60) {
    score += 6;
    strengths.push("There is a clear direction for what the business should do next");
  } else if (recommendedFocus.length >= 40) {
    score += 4;
    strengths.push("There is a workable next direction");
    weaknesses.push("The next direction still needs tighter prioritisation");
  } else {
    weaknesses.push("The next direction is still too soft or too broad");
  }

  if (blindSpots.length >= 2) {
    score += 5;
    strengths.push("The scan can already see underused areas of the business signal");
  } else if (blindSpots.length === 1) {
    score += 3;
    strengths.push("The scan can see at least one underused area");
    weaknesses.push("Blind-spot detection is still limited");
  } else {
    weaknesses.push("Blind-spot detection is still limited");
  }

  if (suggestedCategory && suggestedIdea) {
    score += 4;
    strengths.push("The scan can suggest a practical content direction");
  } else if (suggestedCategory || suggestedIdea) {
    score += 2;
    strengths.push("There is a partial content direction");
    weaknesses.push("The content direction is not yet sharp enough");
  } else {
    weaknesses.push("The content direction is not yet sharp enough");
  }

  if (String(founderGoal || "").trim()) {
    score += 3;
    strengths.push("The advice is being shaped by the founder goal rather than generic scan logic");
  } else {
    weaknesses.push("Advice would improve with a clearer founder goal");
  }

  if (weaknesses.length === 0) {
    weaknesses.push("No clear execution has been carried out yet.");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "optimization");
  const state = getGroupState(score, max);
  const lead = confidencePrefix(confidence);

  let summary = "";
  if (band === "strong") {
    summary = `${lead} enough business signal to give useful next-step guidance rather than broad suggestions. This part of the diagnosis is ready to be used as leverage, not just correction.`;
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
    score += 3;
    strengths.push("There is at least some wider public signal beyond the site");
  } else {
    weaknesses.push("The wider public signal is still narrow");
  }

  if (broaderDiscovery || pagesScanned >= 4) {
    score += 4;
    strengths.push("The scan is drawing from more than one page or page type");
  } else if (pagesScanned >= 2) {
    score += 2;
    strengths.push("The scan has more than a single page to work from");
    weaknesses.push("The source base is still narrower than it should be");
  } else {
    weaknesses.push("The source base is still too narrow");
  }

  if (sourceConfidence === "high") {
    score += 5;
    strengths.push("The current source base gives YEVIB a stronger read");
  } else if (sourceConfidence === "medium") {
    score += 3;
    strengths.push("The current source base is enough for a workable first pass");
  } else {
    weaknesses.push("The current read is still running on partial signal");
  }

  score = clampNumber(score, 0, max);
  const band = getScoreBand(score, max, "sourceMix");
  const state = getGroupState(score, max);

  let summary = "";
  if (band === "strong") {
    summary = "YEVIB is working from a broad enough source mix to make the current scan feel grounded. This base can now be extended for sharper reads, not just basic reliability.";
  } else if (band === "developing") {
    summary = "The source mix is workable, but the scan would feel stronger with more direct and public signal.";
  } else {
    summary = "The current diagnosis is still constrained by a narrow source mix.";
  }

  let nextMove = "";
  if (band === "strong") {
    nextMove = "Use the broader source base already present to deepen the scan and sharpen future recommendations.";
  } else if (band === "developing") {
    nextMove = "Add more direct founder-written and public-facing source material so the next scan lands more confidently.";
  } else {
    nextMove = "Widen the source mix with more founder-written material, more site coverage, and more visible public signal.";
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

function buildGroupedSnapshot({
  founderGoal = "",
  initialProfile = {},
  hasOwnerWriting = false,
}) {
  const businessProfile = initialProfile?.businessProfile || {};
  const founderVoice = initialProfile?.founderVoice || {};
  const brandProductTruth = initialProfile?.brandProductTruth || {};
  const customerOutcome = initialProfile?.customerOutcome || {};
  const sourceProfile = initialProfile?.sourceProfile || {};
  const discoveryProfile = initialProfile?.discoveryProfile || {};
  const contentProfile = initialProfile?.contentProfile || {};
  const debug = initialProfile?.debug || {};
  const advisorSnapshot = initialProfile?.advisorSnapshot || {};

  const groups = [
    buildBrandCoreGroup({
      businessProfile,
      founderGoal,
      founderVoice,
      sourceProfile,
      discoveryProfile,
    }),
    buildMarketSignalGroup({
      founderGoal,
      brandProductTruth,
      customerOutcome,
      discoveryProfile,
    }),
    buildOptimizationGroup({
      founderGoal,
      advisorSnapshot,
      contentProfile,
      discoveryProfile,
    }),
    buildSourceMixGroup({
      founderGoal,
      sourceProfile,
      discoveryProfile,
      debug,
      hasOwnerWriting,
    }),
  ];

  const totalScore = groups.reduce((sum, group) => sum + group.score, 0);
  const totalMax = groups.reduce((sum, group) => sum + group.max, 0);
  const overallPct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  const overallState = getOverallState(overallPct);
  const recommendedFocus = adaptRecommendedFocusByBand(
    advisorSnapshot?.recommendedFocus || "",
    getScoreBand(groups[2]?.score || 0, groups[2]?.max || 25, "optimization"),
    founderGoal
  );

  return {
    overallScore: totalScore,
    overallMax: totalMax,
    overallPct,
    overallStateLabel: overallState.label,
    overallColorKey: overallState.colorKey,
    recommendedFocus: recommendedFocus || advisorSnapshot?.recommendedFocus || "",
    groups,
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
  businessUrl,
  pastedSourceText,
  manualBusinessContext,
  manualVoiceInput,
  ownerKbContext,
  founderGoal,
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
- Founder goal: ${founderGoal || "Not provided"}
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
function classifyPostClass({
  founderGoal = "",
  category = "",
  quickType = "",
  idea = "",
  weeklyPosts = "",
}) {
  const combined = [
    founderGoal,
    category,
    quickType,
    idea,
    weeklyPosts,
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");

  if (
    /trust|build more trust|clarity|clear quotes|fair pricing|confidence|reassurance/.test(combined)
  ) {
    return "trust_building";
  }

  if (
    /educational|explain|teaching|teach|understand|what's needed|why|how/.test(combined)
  ) {
    return "education";
  }

  if (
    /promote|offer|discount|first service|quote|book|call now|get started/.test(combined)
  ) {
    return "offer_positioning";
  }

  if (
    /founder|show more founder presence|i run|i insist|i make sure|responsibility|where i stand/.test(combined)
  ) {
    return "founder_authority";
  }

  if (
    /consistency|routine|daily|every day|standard|maintenance|reliable|24\/7|availability/.test(combined)
  ) {
    return "operational_reliability";
  }

  return "real_world_value";
}

function classifyPostType({
  postClass = "",
  quickType = "",
  ownerNudge = "",
  category = "",
}) {
  const lens = String(quickType || "").toLowerCase();
  const feeling = String(ownerNudge || "").toLowerCase();
  const contentCategory = String(category || "").toLowerCase();

  if (postClass === "education") return "instructional";
  if (postClass === "offer_positioning") return "direct_response";
  if (postClass === "founder_authority") return "authority";
  if (postClass === "operational_reliability") return "operational";
  if (postClass === "trust_building") return "reassurance";

  if (lens === "personal" || contentCategory === "founder reflection") {
    return "reflective";
  }

  if (lens === "educational") {
    return "instructional";
  }

  if (/reflective|thoughtful|processing/.test(feeling)) {
    return "reflective";
  }

  if (/focused|fired up|clear|locked in/.test(feeling)) {
    return "directive";
  }

  return "observational";
}

function getPostClassRules(postClass = "") {
  if (postClass === "trust_building") {
    return `
- The job of this post is to reduce hesitation and increase confidence
- Prioritise reassurance, clarity, and grounded trust signals
- Do not drift into generic reliability filler
- Make trust feel earned through specifics
`;
  }

  if (postClass === "education") {
    return `
- The job of this post is to help the audience understand something better
- Prioritise explanation, clarity, and practical takeaway
- Do not drift into vague inspiration
- Make the value come from understanding
`;
  }

  if (postClass === "offer_positioning") {
    return `
- The job of this post is to position an offer or clear reason to act
- Prioritise relevance, timing, and practical value
- Do not sound pushy or salesy
- Make the action feel grounded and justified
`;
  }

  if (postClass === "founder_authority") {
    return `
- The job of this post is to strengthen founder-led authority
- Prioritise judgment, standards, decision-making, and responsibility
- Keep the owner central
- Do not collapse into generic business praise
`;
  }

  if (postClass === "operational_reliability") {
    return `
- The job of this post is to show dependable execution and repeatable standards
- Prioritise process, readiness, availability, and consistency
- Do not repeat the same trust script
- Make reliability feel operational, not abstract
`;
  }

  return `
- The job of this post is to show real-world value in a believable way
- Prioritise lived effect, practical use, and grounded relevance
- Avoid broad generic claims
`;
}

function getPostTypeRules(postType = "") {
  if (postType === "instructional") {
    return `
- Shape the writing to teach clearly
- Use plain explanation and useful framing
- Keep it human, not textbook
`;
  }

  if (postType === "direct_response") {
    return `
- Shape the writing to move someone closer to action
- Keep the value clear and immediate
- Avoid hype and pressure
`;
  }

  if (postType === "authority") {
    return `
- Shape the writing around confident judgment and standards
- Let the owner sound decisive and responsible
- Avoid sounding arrogant
`;
  }

  if (postType === "operational") {
    return `
- Shape the writing around systems, readiness, and execution
- Let the business feel dependable because it is well run
- Avoid generic slogans
`;
  }

  if (postType === "reassurance") {
    return `
- Shape the writing to reduce stress and uncertainty
- Let calm certainty come from specifics
- Avoid saying the same trust phrases repeatedly
`;
  }

  if (postType === "reflective") {
    return `
- Shape the writing around observation and meaning
- Let reflection guide the post without becoming soft or vague
`;
  }

  if (postType === "directive") {
    return `
- Shape the writing with more edge, clarity, and forward posture
- Keep it controlled, not aggressive
`;
  }

  return `
- Shape the writing like a real observation from a real owner
- Keep it natural, grounded, and specific
`;
}

function getPostEnforcementRules(postClass = "", postType = "") {
  const rules = [];

  if (postClass === "trust_building") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must reduce uncertainty through specifics
- Use one concrete trust anchor only: quote clarity, timing clarity, process clarity, standards clarity, or respectful service conduct
- Do NOT stack multiple generic trust claims in one post
- Do NOT lean on vague phrases like "you can trust us", "peace of mind", or "we care" unless grounded in a real detail
- Do NOT default to generic reliability language unless reliability is the actual point
`);
  }

  if (postClass === "education") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must teach one useful thing clearly
- Pick one explanation lane only: what it is, why it matters, how it works, or what to notice
- Do NOT drift into founder-story filler unless it supports the explanation directly
- The value must come from understanding, not just admiration
`);
  }

  if (postClass === "offer_positioning") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must make one practical reason to act easier to understand
- Pick one offer lever only: timing, savings, convenience, fit, or reduced friction
- Do NOT stack too many sales reasons together
- Keep action grounded, not pushy
`);
  }

  if (postClass === "founder_authority") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must sound like a founder making a judgment call
- Center one founder move only: what I insist on, what I refuse, what I check, or what I prioritise
- Do NOT collapse into generic brand praise
- Keep the owner visibly responsible for the standard being described
`);
  }

  if (postClass === "operational_reliability") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must show dependable execution through operation, not slogans
- Center one operational proof only: readiness, repeatability, availability, process discipline, or response standard
- Do NOT turn this into a general trust post
- Reliability must feel procedural and lived, not abstract
`);
  }

  if (postClass === "real_world_value") {
    rules.push(`
CLASS ENFORCEMENT:
- The post must show one believable real-life benefit
- Use one grounded day-impact only
- Avoid broad claims that try to cover everything
`);
  }

  if (postType === "instructional") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with explanation, not nostalgia
- Use a clear teaching posture
- Avoid dramatic storytelling unless it directly serves the lesson
`);
  }

  if (postType === "direct_response") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with relevance or practical value
- Keep the path to action visible
- Avoid reflective or wandering openings
`);
  }

  if (postType === "authority") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with a decision, standard, or non-negotiable
- The owner should sound decisive
- Avoid soft observational drift
`);
  }

  if (postType === "operational") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with process, readiness, or execution reality
- Keep the language functional and grounded
- Avoid emotional over-explaining
`);
  }

  if (postType === "reassurance") {
    rules.push(`
TYPE ENFORCEMENT:
- Open by reducing confusion, friction, or hesitation
- Keep the tone steady and concrete
- Avoid repeating "trust", "clarity", and "confidence" unless one is truly essential
`);
  }

  if (postType === "reflective") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with a real observation or specific moment
- Keep reflection tied to lived experience
- Avoid floating philosophical filler
`);
  }

  if (postType === "directive") {
    rules.push(`
TYPE ENFORCEMENT:
- Open with sharper posture and firmer momentum
- Keep the language controlled
- Avoid hype and motivational clichés
`);
  }

  if (!rules.length) {
    rules.push(`
TYPE ENFORCEMENT:
- Keep the writing natural, specific, and grounded
- Use one clear angle per post
- Avoid blending too many purposes into one post
`);
  }

  rules.push(`
OPENING ENFORCEMENT:
- Across the 3 posts, use 3 different opening styles
- Do NOT let more than one post open with a memory/reflection setup
- Do NOT let more than one post open with "That is why", "It's not just", "I remember", or similar familiar scaffolding
- At least one post must open with a direct statement
- At least one post must open with a concrete real-world situation, action, or scene
- At least one post must open with a standard, decision, or observation
`);

  rules.push(`
CLAIM ENFORCEMENT:
- Each post should center one main claim only
- Do NOT repeat the same claim across all 3 posts
- If one post centers quality, another should not center quality in the same way
- If one post centers trust, another should shift to process, explanation, timing, or lived effect
`);

  rules.push(`
NARRATIVE ENFORCEMENT:
- Do not let all 3 posts use the same skeleton
- Separate the batch into different shapes: one scene-led, one explanation-led, one standard-led
- Same voice, different construction
`);

  return rules.join("\n");
}

function detectPrimaryClaim(post = "") {
  const lower = String(post || "").toLowerCase();

  if (/quote|pricing|price|cost|estimate|no surprises|fairness/.test(lower)) {
    return "pricing_clarity";
  }
  if (/trust|confidence|hesitation|certainty|reassurance/.test(lower)) {
    return "trust_reduction";
  }
  if (/quality|standards|done right|baseline|council standards|properly/.test(lower)) {
    return "quality_standard";
  }
  if (/24\/7|on call|response|ready|availability|fast|urgent|delay/.test(lower)) {
    return "response_readiness";
  }
  if (/explain|understand|why|how it works|guide|what's needed/.test(lower)) {
    return "education_explanation";
  }
  if (/ritual|daily|routine|every day|morning/.test(lower)) {
    return "daily_use";
  }
  if (/tradition|uji|kyoto|farmers|heritage|origin|shaded/.test(lower)) {
    return "origin_tradition";
  }

  return "general_value";
}

function countScaffoldRepeats(posts = []) {
  const scaffoldPatterns = [
    /i remember/gi,
    /that'?s why/gi,
    /it'?s not just/gi,
    /this is why/gi,
    /when .* matters/gi,
    /clear communication/gi,
    /clear priorities/gi,
    /customer satisfaction/gi,
    /the difference in/gi,
  ];

  let hits = 0;
  const joined = posts.join("\n\n").toLowerCase();

  for (const pattern of scaffoldPatterns) {
    const matches = joined.match(pattern);
    if (matches && matches.length > 1) hits += matches.length - 1;
  }

  return hits;
}

function detectOpeningStyle(post = "") {
  const text = String(post || "").trim();
  const lower = text.toLowerCase();

  if (/^(i remember|i still remember|i found myself|i noticed|last|this morning|one day)/.test(lower)) {
    return "memory_scene";
  }

  if (/^(that'?s why|this is why|it'?s not just|when|if|clear|customer satisfaction|the difference)/.test(lower)) {
    return "framing_statement";
  }

  if (/^(i insist|i make sure|i check|i won'?t|i refuse|i focus|i prioritise)/.test(lower)) {
    return "decision_standard";
  }

  if (/^(what|why|how)\b/.test(lower)) {
    return "explanation_open";
  }

  return "direct_statement";
}

function detectPrimaryClaim(post = "") {
  const lower = String(post || "").toLowerCase();

  if (/price|cost|quote|estimate|no surprises/.test(lower)) return "pricing";
  if (/trust|confidence|reassurance/.test(lower)) return "trust";
  if (/quality|standard|done right/.test(lower)) return "quality";
  if (/24\/7|on call|fast|response|urgent/.test(lower)) return "response";
  if (/explain|understand|how|why/.test(lower)) return "education";
  if (/ritual|daily|routine/.test(lower)) return "routine";
  if (/uji|kyoto|tradition|farmers/.test(lower)) return "origin";

  return "general";
}
function getPostLengthBucket(post = "") {
  const length = String(post || "").trim().length;

  if (length <= 180) return "short";
  if (length >= 360) return "long";
  return "medium";
}

function validatePostBatch(posts = []) {
  const openingStyles = posts.map(detectOpeningStyle);
  const claims = posts.map(detectPrimaryClaim);
  const lengths = posts.map((post) => String(post || "").trim().length);
  const lengthBuckets = posts.map(getPostLengthBucket);

  const openingSet = new Set(openingStyles);
  const claimSet = new Set(claims);
  const lengthBucketSet = new Set(lengthBuckets);

  const shortest = lengths.length ? Math.min(...lengths) : 0;
  const longest = lengths.length ? Math.max(...lengths) : 0;
  const lengthSpread = longest - shortest;

  const failedReasons = [];
  const warnings = [];

  if (openingSet.size < 3) {
    warnings.push("Opening styles are not diverse.");
  }

  if (claimSet.size < 2) {
    warnings.push("Primary claims are too similar.");
  }

  if (!openingStyles.includes("direct_statement")) {
    failedReasons.push("Missing direct statement opener.");
  }

  if (!openingStyles.includes("memory_scene")) {
    failedReasons.push("Missing scene/memory opener.");
  }

  if (!lengthBucketSet.has("short")) {
    warnings.push("Batch is missing a clearly shorter post.");
  }

  if (!lengthBucketSet.has("long")) {
    warnings.push("Batch is missing a clearly longer post.");
  }

  if (lengthSpread < 140) {
    warnings.push("Post lengths are too similar.");
  }

  return {
    isValid: failedReasons.length === 0,
    failedReasons,
    warnings,
    openingStyles,
    claims,
    lengthBuckets,
    lengths,
    lengthSpread,
  };
}

function getFeelingRules(ownerNudge = "") {
  const feeling = String(ownerNudge || "").trim();
  const lower = feeling.toLowerCase();

  if (!feeling) return "";

  if (lower.includes("tired") || lower.includes("flat") || lower.includes("not feeling it")) {
    return `
FEELING RULE:
- Let the tone be honest, flatter, or more matter-of-fact
- Do not force energy or inspiration
- Keep it grounded and believable
`.trim();
  }

  if (lower.includes("reflective") || lower.includes("grateful")) {
    return `
FEELING RULE:
- Let one post carry more reflection or appreciation
- Keep it simple and real, not poetic
- Do not let all 3 posts drift into the same soft reflective tone
`.trim();
  }

  if (lower.includes("fired up") || lower.includes("proud") || lower.includes("focused")) {
    return `
FEELING RULE:
- Let the tone be clearer, firmer, and more assertive
- Keep the confidence grounded in real business truth
- Do not sound like hype or motivation content
`.trim();
  }

  if (lower.includes("random")) {
    return `
FEELING RULE:
- Allow more variation in rhythm and entry angle
- Keep the posts believable and on-brand
- Do not become messy or abstract
`.trim();
  }

  return `
FEELING RULE:
- Respect the owner feeling without letting all 3 posts collapse into the same tone
- Keep the wording human, grounded, and usable
`.trim();
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
- At least one post should open with a direct statemen

SCENE RULE (STRICT):
- At least one post MUST begin with a real-world moment
- This means a specific situation, time, or action (e.g. “I remember…”, “Last week…”, “Woke up…”, “Sat there…”)
- Do NOT begin that post with an abstract idea or reflection
- The reader should be able to picture the moment immediately

INSIGHT RULE:
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

  if (Object.values(firstWordCounts).some((count) => count >= 3)) {
    return { failed: true, reason: "All posts start with the same first word." };
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
function getPostGenerationModel(attempt = 0) {
  if (attempt >= 2) return "gpt-5.2";
  return "gpt-4.1-mini";
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

function parseGeneratedPosts(rawText = "") {
  const text = String(rawText || "").trim();
  if (!text) return [];

  const byDivider = text
    .split(/\n?\s*---\s*\n?/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (byDivider.length >= 3) {
    return byDivider.slice(0, 3);
  }

  const hashtagMatches = [...text.matchAll(/(?:^|\n)(#[^\n]+(?:\s+#[^\n]+)*)\s*(?=\n|$)/g)];

  if (hashtagMatches.length >= 3) {
    const posts = [];
    let start = 0;

    for (const match of hashtagMatches) {
      const fullMatch = match[0] || "";
      const hashtagIndex = match.index ?? -1;

      if (hashtagIndex < 0) continue;

      const end = hashtagIndex + fullMatch.length;
      const chunk = text.slice(start, end).trim();

      if (chunk) {
        posts.push(chunk);
      }

      start = end;
    }

    if (posts.length >= 3) {
      return posts.slice(0, 3);
    }
  }

  const byLargeBreak = text
    .split(/\n{2,}(?=[A-Z"'0-9])/g)
    .map((p) => p.trim())
    .filter(Boolean);

  if (byLargeBreak.length >= 3) {
    return byLargeBreak.slice(0, 3);
  }

  return [];
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
- if the previous attempt was too repetitive, increase structural diversity instead of paraphrasing the same idea
- keep the same owner voice, but change the construction and primary claim focus
`;

    const model = getPostGenerationModel(attempt);

    const response = await openai.chat.completions.create({
      model,
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

      console.log("POST RETRY FAILURE:", {
        attempt: attempt + 1,
        model,
        category,
        reason: retryReason,
        rawText,
        parsedPosts: posts,
      });

      continue;
    }

    const openerCheck = repeatedOpenerGuard(posts, category);
    if (openerCheck.failed) {
      retryReason = openerCheck.reason;

      console.log("POST RETRY FAILURE:", {
        attempt: attempt + 1,
        model,
        category,
        reason: retryReason,
        rawText,
        parsedPosts: posts,
        openingStyles: posts.map((post) => detectOpeningStyle(post)),
      });

      continue;
    }

    const quietCheck = hardQuietGuard(posts, category);
    if (quietCheck.failed) {
      retryReason = quietCheck.reason;

      console.log("POST RETRY FAILURE:", {
        attempt: attempt + 1,
        model,
        category,
        reason: retryReason,
        rawText,
        parsedPosts: posts,
        openingStyles: posts.map((post) => detectOpeningStyle(post)),
      });

      continue;
    }

    const batchValidation = validatePostBatch(posts);
    if (!batchValidation.isValid) {
      retryReason = batchValidation.failedReasons.join(" ");

      console.log("POST RETRY FAILURE:", {
        attempt: attempt + 1,
        model,
        category,
        reason: retryReason,
        rawText,
        parsedPosts: posts,
        openingStyles: batchValidation.openingStyles || posts.map((post) => detectOpeningStyle(post)),
        primaryClaims: batchValidation.primaryClaims || [],
        narrativeLanes: batchValidation.narrativeLanes || [],
        proofTypes: batchValidation.proofTypes || [],
        scaffoldRepeatCount: batchValidation.scaffoldRepeatCount || 0,
      });

      continue;
    }

    return posts;
  }

  throw new Error(
    retryReason
      ? `Post generation failed after retries: ${retryReason}`
      : "Post generation failed after retries: Unknown output enforcement failure."
  );
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

function getGroupPct(group = {}) {
  if (!group?.max) return 0;
  return Math.round((group.score / group.max) * 100);
}

function getGroupMap(profile = {}) {
  const groups = Array.isArray(profile?.groupedSnapshot?.groups)
    ? profile.groupedSnapshot.groups
    : [];

  const map = {};
  for (const group of groups) {
    map[group.key] = {
      ...group,
      pct: getGroupPct(group),
    };
  }
  return map;
}

function firstNonEmpty(items = [], fallback = "") {
  for (const item of items) {
    const text = String(item || "").trim();
    if (text) return text;
  }
  return fallback;
}

function buildStrategyLibrary(profile = {}, groupMap = {}) {
  const businessName = profile?.businessProfile?.name || "the business";
  const offers = normalizeStringArray(profile?.brandProductTruth?.offers || [], 4);
  const audience = normalizeStringArray(profile?.brandProductTruth?.audience || [], 4);
  const trustSignals = normalizeStringArray(profile?.discoveryProfile?.trustSignals || [], 4);
  const educationSignals = normalizeStringArray(profile?.discoveryProfile?.educationSignals || [], 4);
  const activitySignals = normalizeStringArray(profile?.discoveryProfile?.activitySignals || [], 4);
  const founderSignals = normalizeStringArray(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    4
  );
  const opportunities = normalizeStringArray(profile?.advisorSnapshot?.opportunities || [], 6);
  const lifeMoments = normalizeStringArray(profile?.customerOutcome?.lifeMoments || [], 4);
  const recommendedFocus =
    profile?.groupedSnapshot?.recommendedFocus ||
    profile?.advisorSnapshot?.recommendedFocus ||
    "";

  return {
    trust_build: {
      key: "trust_build",
      title: "Trust Build System",
      reason:
        "The business needs stronger public proof, standards, and credibility so people trust it faster.",
      operatorRole:
        "YEVIB acts as trust builder, proof harvester, authority editor, and credibility marketer.",
      strategySummary:
        `Run a 4-week trust-building system for ${businessName} using proof-led posts, standards-led visuals, visible process, and public credibility signals.`,
      actions: [
        `Build a 4-week post and image pack focused on trust, standards, and proof${trustSignals[0] ? `, starting with ${trustSignals[0]}` : ""}.`,
        "Turn one proof point each week into a social post, image, homepage statement, and comment/reply angle.",
        "Show how the business works, what it does properly, and what standards it refuses to compromise on.",
        "Use engagement reciprocity: reward strong audience interaction with samples, free value, collaboration offers, or relationship-building gestures.",
        "Harvest testimonials, outcomes, before/after examples, screenshots, process proof, and visible trust assets for reuse."
      ],
      supportActions: [
        "Turn hidden credibility into visible credibility.",
        "Make trust easier to feel at first glance.",
        "Use proof repeatedly, not once."
      ],
      tools: ["social posts", "image pack", "proof content", "offer messaging"],
      campaignType: "trust",
      duration: "4 weeks",
      cadence: "3-5 trust-led outputs per week",
      successSignal:
        "Stronger trust-bearing engagement, better conversion conversations, and more confident public perception."
    },

        visibility_push: {
      key: "visibility_push",
      title: "Visibility Push System",
      reason:
        "The business may be strong enough already, but it is not showing up often enough or widely enough in public.",
      operatorRole:
        "YEVIB acts as visibility manager, distribution worker, content operator, and attention builder.",
      strategySummary:
        `Run a visibility push for ${businessName} so the brand becomes harder to miss in its niche, audience circles, and relevant communities.`,
      actions: [
        "Create a month-long high-frequency post and image run using one strong theme across all content.",
        "Repurpose every strong idea into multiple forms: post, image, comment angle, reply angle, and group/community version.",
        "Push content into audience-relevant spaces consistently instead of posting once and leaving it there.",
        "Use founder comments, replies, and community interaction to multiply visibility around each post.",
        "Turn the strongest content theme into repeated public exposure until the brand becomes familiar."
      ],
      supportActions: [
        "Increase frequency without losing message consistency.",
        "Use repetition strategically, not randomly.",
        "Build familiarity through visible presence."
      ],
      tools: ["social posts", "image pack", "comment strategy", "community posting"],
      campaignType: "visibility",
      duration: "4 weeks",
      cadence: "4-6 visibility outputs per week",
      successSignal:
        "More impressions, more repeated audience exposure, more profile visits, and more public familiarity."
    },

    product_truth_system: {
      key: "product_truth_system",
      title: "Product Truth System",
      reason:
        "The business has enough product, use-case, quality, standards, or ingredient signal to make the product truth clearer in public.",
      operatorRole:
        "YEVIB acts as product truth editor, offer translator, standards explainer, and product-value content operator.",
      strategySummary:
        `Run a product truth system for ${businessName} using real product qualities, use cases, standards, proof, and customer value signals.`,
      actions: [
        `Build a product-truth post and image pack focused on ${offers[0] || "the clearest product or offer signal"}.`,
        "Turn product facts, ingredients, standards, quality markers, or use cases into simple public explanations.",
        "Show who the product is for, when it is used, why it matters, and what makes it trustworthy.",
        "Create content that connects product details to real customer moments instead of generic promotion.",
        "Use proof, standards, reviews, process, and product education to make buying confidence easier."
      ],
      supportActions: [
        "Make product value easier to understand at first glance.",
        "Use real product details rather than vague lifestyle claims.",
        "Connect product quality to customer use, trust, and repeat value."
      ],
      tools: ["social posts", "image pack", "product proof", "offer messaging"],
      campaignType: "product_truth",
      duration: "4 weeks",
      cadence: "3-5 product-truth outputs per week",
      successSignal:
        "Clearer product understanding, stronger buyer trust, and more confident product-led engagement."
    },

    founder_presence: {
      key: "founder_presence",
      title: "Founder Presence Campaign",
      reason:
        "The brand needs to feel more human-led, memorable, and connected to the person behind the operation.",
      operatorRole:
        "YEVIB acts as founder-positioning strategist, voice clarifier, and founder signal amplifier.",
      strategySummary:
        `Build a founder presence campaign for ${businessName} so the business feels clearly led by a real person with judgment, standards, and perspective.`,
      actions: [
        "Create a founder-led post and image series for one month.",
        "Use posts that show decisions, beliefs, standards, effort, pressure, lessons, and real founder perspective.",
        "Make the founder visible in the language, visuals, and public-facing brand explanations.",
        "Turn business knowledge into founder-authored insight instead of faceless brand messaging.",
        "Use comments, replies, and follow-up content to reinforce the founder as the recognisable voice behind the brand."
      ],
      supportActions: [
        "Move the business away from faceless language.",
        "Make the founder part of the signal, not hidden behind it.",
        "Use human presence as brand advantage."
      ],
      tools: ["founder posts", "founder visuals", "voice-led messaging", "community interaction"],
      campaignType: "founder_presence",
      duration: "4 weeks",
      cadence: "3-4 founder-led outputs per week",
      successSignal:
        "Stronger recognition, deeper connection, more memorable brand feel, and more human-led engagement."
    },

    education_authority: {
      key: "education_authority",
      title: "Education Authority Series",
      reason:
        "The business has usable knowledge and needs to turn that knowledge into authority, clarity, and audience trust.",
      operatorRole:
        "YEVIB acts as education marketer, authority builder, topic planner, and trust-through-teaching system.",
      strategySummary:
        `Run an education authority series for ${businessName} by teaching what the audience needs to understand, avoid, and do better.`,
      actions: [
        `Build a 4-week teaching series${educationSignals[0] ? ` starting from ${educationSignals[0]}` : ""}.`,
        "Turn one business truth or misunderstood topic into a post, image, example, and follow-up explanation.",
        "Teach using real-life context, plain language, and visual explanation where possible.",
        "Repeat one educational theme long enough to earn authority, not just one-off attention.",
        "Use the educational series to make the offer easier to understand and trust."
      ],
      supportActions: [
        "Teach consistently enough to become associated with clarity.",
        "Use education to reduce confusion and increase trust.",
        "Turn expertise into recurring public signal."
      ],
      tools: ["educational posts", "educational visuals", "topic series", "explanatory content"],
      campaignType: "education",
      duration: "4 weeks",
      cadence: "3 educational outputs per week",
      successSignal:
        "More saves, shares, clearer audience understanding, and stronger authority perception."
    },

    offer_clarification: {
      key: "offer_clarification",
      title: "Offer Clarification Run",
      reason:
        "People need to understand the offer faster, more clearly, and in real-life terms rather than vague business language.",
      operatorRole:
        "YEVIB acts as offer clarifier, conversion writer, use-case translator, and message sharpener.",
      strategySummary:
        `Run an offer clarification sequence for ${businessName} so people understand what it does, who it is for, and why it matters.`,
      actions: [
        `Choose the clearest current offer${offers[0] ? `: ${offers[0]}` : ""} and explain it through real-life use cases.`,
        "Build a post and image pack that shows the offer in life, not just in description.",
        "Write clearer homepage, bio, and caption-level language that explains what changes for the customer.",
        "Show the problem, the use moment, and the result more directly.",
        "Use repeated clarification posts until the offer lands faster."
      ],
      supportActions: [
        "Replace vague wording with lived value.",
        "Show where the offer fits into real life.",
        "Make the result easier to picture."
      ],
      tools: ["offer posts", "offer visuals", "homepage messaging", "conversion language"],
      campaignType: "offer_clarification",
      duration: "3-4 weeks",
      cadence: "3 clarification outputs per week",
      successSignal:
        "Faster understanding, better quality inquiries, clearer audience response, and stronger conversion readiness."
    },

    reactivation_sequence: {
      key: "reactivation_sequence",
      title: "Reactivation Sequence",
      reason:
        "The business needs a structured sequence to wake up colder, quieter, or less engaged parts of its audience.",
      operatorRole:
        "YEVIB acts as reactivation planner, re-engagement writer, and dormant-attention recovery system.",
      strategySummary:
        `Run a reactivation sequence for ${businessName} using reminders, renewed proof, renewed relevance, and low-friction re-entry points.`,
      actions: [
        "Create a 2-4 week reactivation content run aimed at quieter followers and colder audience layers.",
        "Use reminder posts, renewed proof, customer outcome content, and simple return-entry offers.",
        "Pair each reactivation message with an image that makes the business feel current and active again.",
        "Use email, SMS, or direct-message variants where available in future paid tiers.",
        "Give people a reason to look again through value, proof, clarity, or community invitation."
      ],
      supportActions: [
        "Wake up colder attention without sounding desperate.",
        "Make the brand feel active again.",
        "Use relevance and timing to reopen engagement."
      ],
      tools: ["social reactivation posts", "image pack", "future email/SMS sequence"],
      campaignType: "reactivation",
      duration: "2-4 weeks",
      cadence: "2-3 reactivation outputs per week",
      successSignal:
        "Renewed engagement from quieter followers, more returning interest, and re-opened conversation."
    },

    community_penetration: {
      key: "community_penetration",
      title: "Community Penetration Play",
      reason:
        "The business needs structured entry into relevant communities, not just isolated posting on its own page.",
      operatorRole:
        "YEVIB acts as niche penetration strategist, community operator, and relevance-distribution worker.",
      strategySummary:
        `Run a community penetration play for ${businessName} by shaping content for relevant groups, circles, and industry-adjacent spaces.`,
      actions: [
        "Identify the business's most relevant audience and niche communities.",
        "Turn strong core content into community-suitable versions for group posting, discussion threads, or direct engagement.",
        "Use useful, relevant, non-spam contribution to become visible in audience-heavy spaces.",
        "Follow up engagement with reciprocity: useful advice, samples, collaborations, exhibitions, partnerships, or referral openings.",
        "Use repeated community presence so the brand becomes known inside the right circles."
      ],
      supportActions: [
        "Do not rely on owned audience only.",
        "Meet the audience where it already gathers.",
        "Turn relevance into entry."
      ],
      tools: ["community posts", "reply strategy", "group-adapted content", "partnership openings"],
      campaignType: "community_penetration",
      duration: "4 weeks",
      cadence: "2-4 community-facing pushes per week",
      successSignal:
        "More relevant exposure, more inbound relationships, and deeper niche recognition."
    },

    referral_loop: {
      key: "referral_loop",
      title: "Referral / Reciprocity Loop",
      reason:
        "The business needs a system that turns engagement, satisfaction, and goodwill into repeated relationship growth.",
      operatorRole:
        "YEVIB acts as referral designer, reciprocity strategist, and relationship-growth operator.",
      strategySummary:
        `Build a referral and reciprocity loop for ${businessName} so engagement turns into stronger relationship-based growth.`,
      actions: [
        "Create a public-facing reciprocity sequence using gratitude, rewards, proof, and referral encouragement.",
        "Use posts and images that acknowledge existing supporters and invite deeper participation.",
        "Offer low-cost but high-value reciprocity: features, free product, collaborations, introductions, exhibitions, or useful visibility.",
        "Turn satisfied attention into referrals instead of letting it sit inactive.",
        "Repeat the loop enough that supporters know what happens when they engage."
      ],
      supportActions: [
        "Turn good feeling into repeatable growth behavior.",
        "Reward engagement strategically.",
        "Create a loop, not a one-off ask."
      ],
      tools: ["social referral posts", "reward messaging", "proof content", "relationship-building content"],
      campaignType: "referral",
      duration: "4 weeks",
      cadence: "2-3 reciprocity touches per week",
      successSignal:
        "More shares, more recommendations, more relationship-based growth, and stronger goodwill."
    },

    proof_harvest: {
      key: "proof_harvest",
      title: "Proof Harvest Campaign",
      reason:
        "The business likely has usable proof already, but it is scattered, hidden, or underused.",
      operatorRole:
        "YEVIB acts as proof collector, credibility organiser, and public evidence builder.",
      strategySummary:
        `Run a proof harvest campaign for ${businessName} so existing evidence becomes visible, reusable, and strategically deployed.`,
      actions: [
        "Collect screenshots, testimonials, outcomes, before/after examples, process evidence, and standards proof.",
        "Sort them into reusable proof categories: trust, result, standards, transformation, and consistency.",
        "Turn those proof assets into a month of post and image content.",
        "Use proof across posts, comments, captions, and future email/SMS assets.",
        "Repeat strong proof until it becomes part of public brand memory."
      ],
      supportActions: [
        "Do not leave proof buried.",
        "Organise proof into reusable assets.",
        "Use evidence repeatedly, not accidentally."
      ],
      tools: ["proof library", "post pack", "image pack", "future CRM assets"],
      campaignType: "proof_harvest",
      duration: "3-4 weeks",
      cadence: "2-4 proof outputs per week",
      successSignal:
        "More visible evidence, stronger trust, better response quality, and easier conversion support."
    },

    partnership_outreach: {
      key: "partnership_outreach",
      title: "Partnership Outreach Pack",
      reason:
        "The brand may be ready to grow faster through aligned partners, collaborators, exhibitions, or cross-exposure relationships.",
      operatorRole:
        "YEVIB acts as partnership scout, outreach writer, and collaboration-growth operator.",
      strategySummary:
        `Run a partnership outreach pack for ${businessName} to open aligned collaborations, exhibitions, co-promotions, and brand relationships.`,
      actions: [
        "Identify relevant businesses, creators, events, retailers, stockists, or communities worth approaching.",
        "Build outreach-ready messaging that explains fit, value, and why collaboration makes sense.",
        "Support outreach with visible public content that makes the brand look active and partnership-ready.",
        "Use reciprocity-led offers rather than cold generic asks.",
        "Turn successful partner contact into repeatable templates for future outreach."
      ],
      supportActions: [
        "Approach with fit and value, not vague networking.",
        "Use public signal to support private outreach.",
        "Build reusable outreach assets."
      ],
      tools: ["outreach pack", "supporting social content", "future email templates"],
      campaignType: "partnership",
      duration: "2-4 weeks",
      cadence: "5-15 targeted outreach attempts over cycle",
      successSignal:
        "More conversations, more warm partner responses, and more collaboration openings."
    },

    subscription_base: {
      key: "subscription_base",
      title: "Subscription Base Build",
      reason:
        "The business needs a repeatable owned-audience layer it can speak to directly beyond platform algorithms.",
      operatorRole:
        "YEVIB acts as retention builder, owned-audience strategist, and subscription-growth operator.",
      strategySummary:
        `Build a subscription base for ${businessName} so attention can be retained, revisited, and converted outside algorithm-only dependence.`,
      actions: [
        "Create a reason to subscribe: offer, insider value, early access, education, updates, or community relevance.",
        "Use posts and visuals that move people from casual follower to owned audience member.",
        "Build repeated subscription invitations into content instead of one-off asks.",
        "Pair subscription growth with proof, founder presence, or education so the invitation feels earned.",
        "Prepare future email/SMS continuity so subscription becomes a real business asset."
      ],
      supportActions: [
        "Move from borrowed attention to owned attention.",
        "Give subscription a clear reason, not just a form.",
        "Build retention, not just reach."
      ],
      tools: ["subscription-focused posts", "offer language", "future email/SMS base"],
      campaignType: "subscription",
      duration: "4-6 weeks",
      cadence: "2-3 subscription-led prompts per week",
      successSignal:
        "Growth in owned audience, more repeat contact potential, and stronger retention capacity."
    }
  };
}

function choosePrimaryStrategy(profile = {}, groupMap = {}) {
  const founderGoal = String(profile?.advisorSnapshot?.founderGoal || "").toLowerCase();
  const recommendedFocus = String(
    profile?.groupedSnapshot?.recommendedFocus ||
    profile?.advisorSnapshot?.recommendedFocus ||
    ""
  ).toLowerCase();

  const trustSignals = normalizeStringArray(profile?.discoveryProfile?.trustSignals || [], 4);
  const educationSignals = normalizeStringArray(profile?.discoveryProfile?.educationSignals || [], 4);
  const activitySignals = normalizeStringArray(profile?.discoveryProfile?.activitySignals || [], 4);
  const founderSignals = normalizeStringArray(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    4
  );
  const offers = normalizeStringArray(profile?.brandProductTruth?.offers || [], 4);

  const brandCorePct = groupMap?.brandCore?.pct || 0;
  const marketSignalPct = groupMap?.marketSignal?.pct || 0;
  const optimizationPct = groupMap?.optimization?.pct || 0;
  const sourceMixPct = groupMap?.sourceMix?.pct || 0;

  if (/subscription/.test(founderGoal) || /subscription/.test(recommendedFocus)) {
    return "subscription_base";
  }
  if (/founder presence/.test(founderGoal) || founderSignals.some((x) => /limited/i.test(x))) {
    return "founder_presence";
  }
  if (/educational/.test(founderGoal) || educationSignals.length >= 2) {
    return "education_authority";
  }
  if (/trust/.test(founderGoal) || trustSignals.length >= 2) {
    return "trust_build";
  }
  if (/promote products or services/.test(founderGoal) || offers.length > 0 && marketSignalPct < 70) {
    return "offer_clarification";
  }
  if (/posting consistency/.test(founderGoal) && activitySignals.length < 2) {
    return "visibility_push";
  }

  if (sourceMixPct < 55) return "proof_harvest";
  if (brandCorePct < 60) return "founder_presence";
  if (marketSignalPct < 60) return "offer_clarification";
  if (optimizationPct >= 70 && educationSignals.length > 0) return "education_authority";
  if (activitySignals.length >= 2) return "community_penetration";
  if (trustSignals.length >= 2) return "trust_build";

  return "visibility_push";
}

function buildSecondaryStrategies(primaryKey, profile = {}, groupMap = {}) {
  const options = [];
  const trustSignals = normalizeStringArray(profile?.discoveryProfile?.trustSignals || [], 4);
  const educationSignals = normalizeStringArray(profile?.discoveryProfile?.educationSignals || [], 4);
  const founderSignals = normalizeStringArray(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    4
  );
  const activitySignals = normalizeStringArray(profile?.discoveryProfile?.activitySignals || [], 4);

  if (primaryKey !== "trust_build" && trustSignals.length > 0) options.push("trust_build");
  if (primaryKey !== "education_authority" && educationSignals.length > 0) options.push("education_authority");
  if (primaryKey !== "founder_presence" && founderSignals.length > 0) options.push("founder_presence");
  if (primaryKey !== "community_penetration" && activitySignals.length > 0) options.push("community_penetration");
  if (primaryKey !== "proof_harvest") options.push("proof_harvest");
  if (primaryKey !== "visibility_push") options.push("visibility_push");

  return uniqueStrings(options, 3);
}
function buildStrategyCatalog() {
  return [
    {
      key: "trust_build",
      title: "Trust Build",
      objective: "Increase buyer confidence by making proof, standards, and reassurance more visible.",
      channels: ["social_posts", "image_posts", "email", "website_copy"],
      defaultDurationDays: 30,
      defaultCadence: "3 posts per week, 1 trust email, 1 website proof update",
      outputs: [
        "trust-led post pack",
        "proof-led image pack",
        "reassurance email",
        "website trust block"
      ]
    },
    {
      key: "visibility_push",
      title: "Visibility Push",
      objective: "Increase public visibility by publishing more consistently into the most relevant channels and communities.",
      channels: ["social_posts", "image_posts", "community_outreach"],
      defaultDurationDays: 30,
      defaultCadence: "4 posts per week, 2 community placements per week",
      outputs: [
        "visibility post pack",
        "image pack",
        "community posting plan"
      ]
    },
    {
      key: "founder_presence_campaign",
      title: "Founder Presence Campaign",
      objective: "Make the founder more visible so the brand feels more human, distinct, and memorable.",
      channels: ["social_posts", "image_posts", "website_copy", "email"],
      defaultDurationDays: 21,
      defaultCadence: "3 founder-led posts per week, 1 founder email, 1 founder website update",
      outputs: [
        "founder-led post pack",
        "founder image pack",
        "founder story update",
        "founder email"
      ]
    },
    {
      key: "education_authority_series",
      title: "Education Authority Series",
      objective: "Turn business knowledge into authority by publishing useful educational content consistently.",
      channels: ["social_posts", "image_posts", "email"],
      defaultDurationDays: 30,
      defaultCadence: "3 educational posts per week, 1 teaching email per week",
      outputs: [
        "education post pack",
        "education image pack",
        "authority email sequence"
      ]
    },
        {
      key: "offer_clarification_run",
      name: "Offer Clarification Run",
      objective: "Make the business offer easier to understand, remember, and act on.",
      triggers: [
        "unclear_offer",
        "weak_value_explanation",
        "confusing_positioning"
      ],
      primaryOutputs: [
        "offer clarity post pack",
        "simple value explanation",
        "product/service explanation series",
        "homepage offer clarity direction"
      ]
    },
    {
      key: "product_truth_system",
      name: "Product Truth System",
      objective: "Turn real product qualities, use cases, standards, ingredients, proof, and customer value into clearer public content.",
      triggers: [
        "clear_product_signal",
        "product_value_needs_explaining",
        "quality_or_standard_signal",
        "ecommerce_product_brand"
      ],
      primaryOutputs: [
        "product truth post pack",
        "product value explanation series",
        "use-case content angles",
        "standards and proof content direction"
      ]
    },
  ];
}

function buildExecutionLayers(strategy = {}, profile = {}) {
  const businessName = profile?.businessProfile?.name || "the business";
  const offers = normalizeStringArray(profile?.brandProductTruth?.offers || [], 4);
  const trustSignals = normalizeStringArray(profile?.discoveryProfile?.trustSignals || [], 4);
  const educationSignals = normalizeStringArray(profile?.discoveryProfile?.educationSignals || [], 4);
  const activitySignals = normalizeStringArray(profile?.discoveryProfile?.activitySignals || [], 4);
  const founderSignals = normalizeStringArray(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    4
  );
  const opportunities = normalizeStringArray(profile?.advisorSnapshot?.opportunities || [], 6);
  const recommendedFocus =
    profile?.groupedSnapshot?.recommendedFocus ||
    profile?.advisorSnapshot?.recommendedFocus ||
    "";

  const primaryOffer = firstNonEmpty(offers, "the clearest current offer");
  const primaryTrust = firstNonEmpty(trustSignals, "visible proof and standards");
  const primaryEducation = firstNonEmpty(educationSignals, "the clearest teachable business truth");
  const primaryActivity = firstNonEmpty(activitySignals, "audience-relevant public activity");
  const primaryFounder = firstNonEmpty(founderSignals, "stronger founder-led public signal");
  const primaryOpportunity = firstNonEmpty(opportunities, recommendedFocus || "the clearest current opportunity");

  switch (strategy?.key) {
    case "trust_build":
      return {
        core: `Run a 30-day trust build system for ${businessName} around ${primaryTrust}.`,
        content: [
          "Create 3 trust-led posts per week.",
          "Create matching proof-led images for every trust post.",
          "Show standards, process, result, and reassurance repeatedly."
        ],
        distribution: [
          "Publish across the main public channel consistently for 4 weeks.",
          "Repeat the strongest trust angle more than once so it sticks."
        ],
        trust: [
          `Turn ${primaryTrust} into visible public proof.`,
          "Collect testimonials, screenshots, process proof, or before/after assets during the campaign."
        ],
        reciprocity: [
          "Reward strong audience engagement with useful replies, recognition, or value-led follow-up.",
          "Use goodwill to deepen trust instead of leaving engagement cold."
        ],
        conversion: [
          `Connect trust content back to ${primaryOffer}.`,
          "Rewrite one offer explanation so the business feels safer and easier to buy from."
        ]
      };

    case "visibility_push":
      return {
        core: `Run a 30-day visibility push for ${businessName} using one repeated campaign theme.`,
        content: [
          "Create 4 visibility-led posts per week.",
          "Create a matching image for each post.",
          "Keep one clear repeated angle across the month instead of switching themes constantly."
        ],
        distribution: [
          "Push the same campaign into main channel posting plus relevant community spaces.",
          "Use comments and replies as part of distribution, not as an afterthought."
        ],
        trust: [
          "Attach proof, standards, or real-life use to the best-performing visibility posts.",
          "Make visibility also carry credibility."
        ],
        reciprocity: [
          "Follow up strong engagement with direct conversation, useful replies, or low-friction collaboration openings.",
          "Use audience response as an expansion path."
        ],
        conversion: [
          "Attach a simple next step to the strongest posts.",
          "Turn repeated attention into profile visits, inquiry, or offer awareness."
        ]
      };

    case "founder_presence_campaign":
      return {
        core: `Run a founder presence campaign for ${businessName} so the business feels more human-led and recognisable.`,
        content: [
          "Create 3 founder-led posts per week.",
          "Create matching visuals that show effort, judgment, standards, or lived business reality.",
          `Use ${primaryFounder} as the main signal to strengthen.`
        ],
        distribution: [
          "Use founder comments, replies, and follow-up posts to reinforce identity.",
          "Make the founder visible in public-facing brand moments repeatedly."
        ],
        trust: [
          "Tie founder presence to standards and real decision-making.",
          "Do not let founder content become empty personality content."
        ],
        reciprocity: [
          "Use audience interaction to deepen relationship with the human behind the brand.",
          "Turn replies into recognisable founder-led signal."
        ],
        conversion: [
          "Update one public-facing brand explanation so the founder is visible in the offer and message.",
          "Use founder credibility to strengthen conversion confidence."
        ]
      };

    case "education_authority_series":
      return {
        core: `Run a 30-day education authority series for ${businessName} around ${primaryEducation}.`,
        content: [
          "Create 3 educational posts per week.",
          "Create matching explanatory visuals.",
          "Turn repeated business knowledge into audience clarity."
        ],
        distribution: [
          "Post the teaching series consistently and reuse the best topic angles.",
          "Adapt the clearest education content for public and community-facing use."
        ],
        trust: [
          "Use teaching to build authority and reduce buyer doubt.",
          "Make every lesson reinforce competence."
        ],
        reciprocity: [
          "Answer audience questions publicly where possible.",
          "Turn engagement into topic expansion for future educational posts."
        ],
        conversion: [
          `Use education to make ${primaryOffer} easier to understand and trust.`,
          "Bridge the gap between explanation and buying confidence."
        ]
      };

    case "offer_clarification_run":
      return {
        core: `Run an offer clarification campaign for ${businessName} focused on ${primaryOffer}.`,
        content: [
          "Create 3 offer-clarity posts per week.",
          "Create matching visuals that show the offer in real life.",
          "Explain the problem, use moment, and result more clearly."
        ],
        distribution: [
          "Repeat the clearest offer message across posts, replies, and public-facing brand touchpoints.",
          "Keep the same value message visible long enough to land."
        ],
        trust: [
          "Use proof and standards to support the clarified offer.",
          "Make the offer feel both clear and credible."
        ],
        reciprocity: [
          "Use audience questions and confusion as fuel for better offer explanation.",
          "Reply with real examples, not generic pitch language."
        ],
        conversion: [
          "Rewrite one homepage, caption, or offer explanation block.",
          "Make the next buying step easier to understand."
        ]
      };

    case "community_penetration_play":
      return {
        core: `Run a community penetration play for ${businessName} using ${primaryActivity}.`,
        content: [
          "Create a community-suited post pack for relevant groups and audience spaces.",
          "Adapt main posts into more discussion-friendly versions.",
          "Use useful relevance, not spam."
        ],
        distribution: [
          "Place content into audience-relevant groups, circles, and niche spaces.",
          "Treat distribution as relationship-building, not dumping content."
        ],
        trust: [
          "Use proof and relevance to avoid looking random or intrusive.",
          "Make the brand feel worth listening to inside the community."
        ],
        reciprocity: [
          "Use collaboration, support, replies, referrals, or mutual promotion to deepen entry.",
          "Turn attention into relationship."
        ],
        conversion: [
          "Guide the right people back toward the offer or brand page after relevance is built.",
          "Use community trust before conversion pressure."
        ]
      };

    case "proof_harvest_campaign":
      return {
        core: `Run a proof harvest campaign for ${businessName} and build a reusable credibility bank.`,
        content: [
          "Turn collected proof into posts and images.",
          "Organise proof by standards, outcomes, trust, and result.",
          "Use proof-led content repeatedly during the cycle."
        ],
        distribution: [
          "Publish proof across normal posting and supporting brand touchpoints.",
          "Reuse the strongest proof in more than one format."
        ],
        trust: [
          "Collect screenshots, testimonials, outcomes, process evidence, and result signals.",
          "Make hidden proof visible and reusable."
        ],
        reciprocity: [
          "Thank customers or supporters who help generate proof assets.",
          "Turn proof collection into stronger brand goodwill."
        ],
        conversion: [
          "Move the best proof into offer-supporting language.",
          "Use evidence to reduce buying hesitation."
        ]
      };

    default:
      return {
        core: `Run a 30-day strategic campaign for ${businessName} around ${primaryOpportunity}.`,
        content: [
          "Create a consistent post and image pack under one theme.",
          "Keep all outputs under the same campaign direction."
        ],
        distribution: [
          "Distribute consistently across public channels.",
          "Repeat the best angle enough times to matter."
        ],
        trust: [
          "Support the campaign with proof, standards, or result where possible."
        ],
        reciprocity: [
          "Use engagement as a relationship and growth lever."
        ],
        conversion: [
          "Connect the campaign back to a clear offer or next step."
        ]
      };
  }
}

function buildExecutionAssets(strategy = {}, layers = {}) {
  const contentCount = Array.isArray(layers?.content) ? layers.content.length : 0;
  const distributionCount = Array.isArray(layers?.distribution) ? layers.distribution.length : 0;

  return {
    campaignName: strategy?.title || "Campaign System",
    primaryOutputs: [
      "post pack",
      "image pack",
      "distribution actions",
      "trust/proof actions",
      "conversion support"
    ],
    minimumDeliverables: [
      "3 campaign-aligned posts",
      "3 matching campaign-aligned images",
      "1 supporting distribution action",
      "1 trust/proof action",
      "1 conversion-support action"
    ],
    campaignRhythm: `${contentCount || 3} content actions + ${distributionCount || 2} distribution actions per cycle`
  };
}

function hasUsefulArrayItems(items = []) {
  return Array.isArray(items) && items.some((item) => String(item || "").trim());
}

function scorePresence(items = [], pointsIfPresent = 1) {
  return hasUsefulArrayItems(items) ? pointsIfPresent : 0;
}

function buildEvidenceProfile(profile = {}) {
  const sourceProfile = profile?.sourceProfile || {};
  const discoveryProfile = profile?.discoveryProfile || {};
  const brandProductTruth = profile?.brandProductTruth || {};
  const founderVoice = profile?.founderVoice || {};
  const customerOutcome = profile?.customerOutcome || {};
  const debug = profile?.debug || {};

  const pagesScanned = Number(debug?.pagesScanned || 0);
  const hasWebsite = Boolean(sourceProfile?.urlUsed);
    const hasSuppliedOwnerWriting = Boolean(
    sourceProfile?.pastedTextUsed ||
    sourceProfile?.manualContextUsed
  );

  const hasInferredVoiceSignal = Boolean(
    !sourceProfile?.weakVoiceSource &&
      (
        normalizeStringArray(founderVoice?.tone, 3).length > 0 ||
        normalizeStringArray(founderVoice?.vocabulary, 3).length > 0 ||
        clipText(founderVoice?.voiceSummary || "", 80).length > 0
      )
  );

  const hasOwnerWriting = hasSuppliedOwnerWriting || hasInferredVoiceSignal;

  const trustSignals = normalizeStringArray(discoveryProfile?.trustSignals, 10);
  const educationSignals = normalizeStringArray(discoveryProfile?.educationSignals, 10);
  const activitySignals = normalizeStringArray(discoveryProfile?.activitySignals, 10);
  const founderVisibilitySignals = normalizeStringArray(
    discoveryProfile?.founderVisibilitySignals,
    10
  );
  const offers = normalizeStringArray(brandProductTruth?.offers, 10);
  const audience = normalizeStringArray(brandProductTruth?.audience, 10);
  const lifeMoments = normalizeStringArray(customerOutcome?.lifeMoments, 10);

  const evidenceScore = clampNumber(
    (hasWebsite ? 22 : 0) +
      (pagesScanned >= 3 ? 12 : pagesScanned > 0 ? 6 : 0) +
      (hasOwnerWriting ? 16 : 0) +
      scorePresence(trustSignals, 12) +
      scorePresence(educationSignals, 8) +
      scorePresence(activitySignals, 8) +
      scorePresence(founderVisibilitySignals, 8) +
      scorePresence(offers, 8) +
      scorePresence(audience, 4) +
      scorePresence(lifeMoments, 2),
    0,
    100
  );

  const missingEvidence = uniqueStrings(
    [
      !hasWebsite ? "No live website evidence was available." : "",
      pagesScanned === 0 ? "No owned-site pages were successfully scanned." : "",
      !hasOwnerWriting ? "No meaningful owner-written voice signal was supplied." : "",
      trustSignals.length === 0 ? "Visible trust and proof signals are limited." : "",
      founderVisibilitySignals.length === 0 ? "Visible founder presence is limited." : "",
      offers.length === 0 ? "Offer or service clarity is still limited." : "",
      audience.length === 0 ? "Audience clarity is still limited." : "",
    ],
    8
  );

  const availableEvidence = uniqueStrings(
    [
      hasWebsite ? "Owned-site signal is available." : "",
      pagesScanned > 0 ? `${pagesScanned} owned-site page(s) were scanned.` : "",
      hasOwnerWriting ? "Owner voice signal is available." : "",
      trustSignals.length > 0 ? `Trust/proof signals found: ${trustSignals.length}` : "",
      educationSignals.length > 0 ? `Education signals found: ${educationSignals.length}` : "",
      activitySignals.length > 0 ? `Activity signals found: ${activitySignals.length}` : "",
      founderVisibilitySignals.length > 0
        ? `Founder visibility signals found: ${founderVisibilitySignals.length}`
        : "",
      offers.length > 0 ? `Offers/services found: ${offers.length}` : "",
      audience.length > 0 ? `Audience clues found: ${audience.length}` : "",
    ],
    10
  );

  let evidenceState = "thin";
  if (evidenceScore >= 75) evidenceState = "strong";
  else if (evidenceScore >= 50) evidenceState = "usable";
  else if (evidenceScore >= 28) evidenceState = "limited";

  return {
    score: evidenceScore,
    state: evidenceState,
    pagesScanned,
    hasWebsite,
    hasOwnerWriting,
    availableEvidence,
    missingEvidence,
    signals: {
      trustSignals,
      educationSignals,
      activitySignals,
      founderVisibilitySignals,
      offers,
      audience,
      lifeMoments,
      voiceSummary: clipText(founderVoice?.voiceSummary || "", 300),
      sourceConfidence: discoveryProfile?.sourceConfidence || "",
    },
  };
}

function buildQualificationProfile(evidenceProfile = {}, profile = {}) {
  const founderGoal = String(profile?.founderGoal || "").trim();
  const evidenceScore = Number(evidenceProfile?.score || 0);
  const hasWebsite = Boolean(evidenceProfile?.hasWebsite);
  const hasOwnerWriting = Boolean(evidenceProfile?.hasOwnerWriting);
  const pagesScanned = Number(evidenceProfile?.pagesScanned || 0);
  const trustSignalCount = Array.isArray(evidenceProfile?.signals?.trustSignals)
    ? evidenceProfile.signals.trustSignals.length
    : 0;
  const offerCount = Array.isArray(evidenceProfile?.signals?.offers)
    ? evidenceProfile.signals.offers.length
    : 0;

  let level = "blocked";
  let swotLevel = "none";
  let strategyLevel = "none";
  let executionEligible = false;
  let confidence = "low";
  let summary = "YEVIB does not yet have enough evidence to produce a trustworthy diagnosis.";
  let nextMove = "Add a stronger source of evidence before asking YEVIB for strategy or execution.";

  if (evidenceScore >= 75 && hasWebsite && pagesScanned >= 3 && (trustSignalCount > 0 || offerCount > 0)) {
    level = "strong";
    swotLevel = "full";
    strategyLevel = "full";
    executionEligible = true;
    confidence = "high";
    summary =
      "YEVIB has enough evidence to produce a strong diagnosis, a full SWOT view, and a strategy recommendation.";
    nextMove =
      founderGoal
        ? `Use the current evidence to recommend the best move toward: ${founderGoal}.`
        : "Recommend the strongest next strategic move from the current evidence.";
  } else if (evidenceScore >= 50 && hasWebsite) {
    level = "standard";
    swotLevel = "standard";
    strategyLevel = "standard";
    executionEligible = true;
    confidence = "medium";
    summary =
      "YEVIB has enough evidence for a standard diagnosis and a controlled strategy recommendation.";
    nextMove =
      "Proceed with a ranked diagnosis, but keep confidence and blind spots visible.";
  } else if (evidenceScore >= 28 && (hasWebsite || hasOwnerWriting)) {
    level = "limited";
    swotLevel = "limited";
    strategyLevel = "cautious";
    executionEligible = false;
    confidence = "low";
    summary =
      "YEVIB can produce a limited diagnosis, but should not overreach into confident strategy or execution.";
    nextMove =
      "Show the clearest visible gaps and ask for the minimum extra evidence that would unlock deeper help.";
  }

  const ubdgStrength = profile?.ubdgEvidencePacket?.strengthSummary || {};
  const ubdgClaimWording = profile?.ubdgEvidencePacket?.claimWording || {};
  const ubdgEvidenceState = String(ubdgStrength?.evidenceState || "").trim();
  const ubdgSafeClaimLevel = String(ubdgStrength?.safeClaimLevel || "").trim();

  if (ubdgEvidenceState === "inference_only" || ubdgSafeClaimLevel === "inference_only") {
    level = level === "strong" ? "standard" : level;
    swotLevel = swotLevel === "full" ? "standard" : swotLevel;
    strategyLevel = strategyLevel === "full" ? "standard" : strategyLevel;
    executionEligible = false;
    confidence = "low";
    summary =
      "YEVIB can see some signals, but the UBDG evidence packet is inference-only, so strategy and execution must stay cautious.";
    nextMove =
      "Add owner input, owned website evidence, or official source evidence before asking YEVIB for stronger recommendations.";
  } else if (ubdgSafeClaimLevel === "cautious" && confidence === "high") {
    confidence = "medium";
    summary =
      "YEVIB has useful evidence, but UBDG marks the claim level as cautious, so the diagnosis should avoid overconfident language.";
    nextMove =
      "Proceed with the recommendation, but keep evidence limits and blind spots visible.";
  }

  return {
    level,
    swotLevel,
    strategyLevel,
    executionEligible,
    confidence,
    summary,
    nextMove,
  };
}

function buildReadinessProfile(profile = {}) {
  const evidenceProfile = profile?.evidenceProfile || buildEvidenceProfile(profile);
  const qualificationProfile =
    profile?.qualificationProfile || buildQualificationProfile(evidenceProfile, profile);

  const signals = evidenceProfile?.signals || {};
  const trustSignals = normalizeStringArray(signals?.trustSignals, 10);
  const educationSignals = normalizeStringArray(signals?.educationSignals, 10);
  const activitySignals = normalizeStringArray(signals?.activitySignals, 10);
  const founderVisibilitySignals = normalizeStringArray(signals?.founderVisibilitySignals, 10);
  const offers = normalizeStringArray(signals?.offers, 10);
  const audience = normalizeStringArray(signals?.audience, 10);
  const lifeMoments = normalizeStringArray(signals?.lifeMoments, 10);

  function makeGroup({
    key,
    title,
    score,
    strengths,
    weaknesses,
    nextMove,
  }) {
    const safeScore = clampNumber(score, 0, 100);
    const state = getOverallState(safeScore);

    return {
      key,
      title,
      score: safeScore,
      max: 100,
      stateLabel: state.label,
      colorKey: state.colorKey,
      confidence: qualificationProfile?.confidence || "low",
      summary:
        `${title} is ${state.label.toLowerCase()} based on the evidence currently available.`,
      strengths: uniqueStrings(strengths, 4),
      weaknesses: uniqueStrings(weaknesses, 4),
      nextMove,
    };
  }

  const groups = [
    makeGroup({
      key: "trust_readiness",
      title: "Trust Readiness",
      score: 30 + (trustSignals.length > 0 ? 40 : 0) + (founderVisibilitySignals.length > 0 ? 10 : 0),
      strengths: [
        trustSignals.length > 0 ? "Visible trust or proof signals are present." : "",
        founderVisibilitySignals.length > 0 ? "Some visible human/founder signal is present." : "",
      ],
      weaknesses: [
        trustSignals.length === 0 ? "Trust and proof signals are still limited." : "",
        founderVisibilitySignals.length === 0 ? "Founder visibility is limited." : "",
      ],
      nextMove:
        trustSignals.length === 0
          ? "Add visible proof, standards, reviews, outcomes, or reassurance signals."
          : "Turn the strongest existing proof into reusable public trust assets.",
    }),
    makeGroup({
      key: "legibility_readiness",
      title: "Legibility Readiness",
      score: 25 + (offers.length > 0 ? 35 : 0) + (audience.length > 0 ? 20 : 0) + (lifeMoments.length > 0 ? 10 : 0),
      strengths: [
        offers.length > 0 ? "The offer or service is visible enough to identify." : "",
        audience.length > 0 ? "Audience clues are visible." : "",
      ],
      weaknesses: [
        offers.length === 0 ? "Offer clarity is limited." : "",
        audience.length === 0 ? "Audience clarity is limited." : "",
      ],
      nextMove:
        offers.length === 0
          ? "Clarify what the business actually does, sells, or solves first."
          : "Tighten how the offer, audience, and outcome are described together.",
    }),
    makeGroup({
      key: "visibility_readiness",
      title: "Visibility Readiness",
      score: 20 + (activitySignals.length > 0 ? 35 : 0) + (educationSignals.length > 0 ? 20 : 0) + (evidenceProfile?.hasWebsite ? 15 : 0),
      strengths: [
        activitySignals.length > 0 ? "Public activity signals are present." : "",
        educationSignals.length > 0 ? "Educational signal exists." : "",
      ],
      weaknesses: [
        activitySignals.length === 0 ? "Public visibility signal is still light." : "",
        educationSignals.length === 0 ? "Educational visibility signal is limited." : "",
      ],
      nextMove:
        activitySignals.length === 0
          ? "Build visible outward activity before expecting stronger market response."
          : "Turn current activity into more repeatable visibility and discovery.",
    }),
    makeGroup({
      key: "transaction_readiness",
      title: "Transaction Readiness",
      score: 20 + (offers.length > 0 ? 35 : 0) + (trustSignals.length > 0 ? 20 : 0) + (audience.length > 0 ? 10 : 0),
      strengths: [
        offers.length > 0 ? "There is enough signal to identify a transaction path." : "",
        trustSignals.length > 0 ? "Trust signals support conversion readiness." : "",
      ],
      weaknesses: [
        offers.length === 0 ? "The path from attention to offer is still weak." : "",
        trustSignals.length === 0 ? "Conversion support proof is still weak." : "",
      ],
      nextMove:
        offers.length === 0
          ? "Make the commercial next step easier to understand and easier to trust."
          : "Support the offer with stronger proof and clearer next-step language.",
    }),
    makeGroup({
      key: "execution_readiness",
      title: "Execution Readiness",
      score: 25 + (evidenceProfile?.hasWebsite ? 20 : 0) + (evidenceProfile?.hasOwnerWriting ? 20 : 0) + (activitySignals.length > 0 ? 15 : 0) + (offers.length > 0 ? 10 : 0),
      strengths: [
        evidenceProfile?.hasWebsite ? "The system has owned-site evidence to work from." : "",
        evidenceProfile?.hasOwnerWriting ? "The system has owner voice signal to work from." : "",
      ],
      weaknesses: [
        !evidenceProfile?.hasWebsite ? "Execution is constrained without owned-site evidence." : "",
        !evidenceProfile?.hasOwnerWriting ? "Execution tone control is weaker without owner writing." : "",
      ],
      nextMove:
        qualificationProfile?.executionEligible
          ? "Proceed with controlled execution under the current qualification level."
          : "Hold execution and unlock stronger evidence first.",
    }),
    makeGroup({
      key: "differentiation_readiness",
      title: "Differentiation Readiness",
      score: 20 + (founderVisibilitySignals.length > 0 ? 30 : 0) + (educationSignals.length > 0 ? 20 : 0) + (trustSignals.length > 0 ? 10 : 0),
      strengths: [
        founderVisibilitySignals.length > 0 ? "There is some visible human distinction in the brand signal." : "",
        educationSignals.length > 0 ? "Educational signal can support differentiation." : "",
      ],
      weaknesses: [
        founderVisibilitySignals.length === 0 ? "The brand risks feeling generic or interchangeable." : "",
        educationSignals.length === 0 ? "Distinctive expertise signal is still limited." : "",
      ],
      nextMove:
        founderVisibilitySignals.length === 0
          ? "Make the business feel more specific, human, and recognisable."
          : "Turn the strongest distinct signal into repeatable public positioning.",
    }),
  ];

  const overallScore = Math.round(
    groups.reduce((sum, group) => sum + Number(group.score || 0), 0) / (groups.length || 1)
  );
  const overallState = getOverallState(overallScore);

  return {
    overallScore,
    overallStateLabel: overallState.label,
    confidence: qualificationProfile?.confidence || "low",
    groups,
  };
}

function buildSourceImprovementGuidance(profile = {}) {
  const evidenceProfile = profile?.evidenceProfile || buildEvidenceProfile(profile);
  const qualificationProfile =
    profile?.qualificationProfile || buildQualificationProfile(evidenceProfile, profile);
  const ubdgEvidencePacket = profile?.ubdgEvidencePacket || {};
  const evidenceCaution = ubdgEvidencePacket?.evidenceCaution || {};
  const strengthSummary = ubdgEvidencePacket?.strengthSummary || {};
  const discoveryProfile = profile?.discoveryProfile || {};
  const sourceProfile = profile?.sourceProfile || {};

  const missingEvidence = Array.isArray(evidenceProfile?.missingEvidence)
    ? evidenceProfile.missingEvidence
    : [];

  const channelsFound =
    discoveryProfile?.channelsFound && typeof discoveryProfile.channelsFound === "object"
      ? discoveryProfile.channelsFound
      : {};

  const hasDetectedChannels = Object.values(channelsFound).some(Boolean);
  const hasWebsiteSignal = Boolean(
    sourceProfile?.urlUsed ||
      evidenceProfile?.hasWebsite ||
      discoveryProfile?.websitePresence ||
      discoveryProfile?.businessWebsite
  );

  const hasChannelOrPlatformSignal = Boolean(hasDetectedChannels || hasWebsiteSignal);

  const safeClaimLevel = String(strengthSummary?.safeClaimLevel || "").trim();
  const cautionType = String(evidenceCaution?.cautionType || "none").trim();

  function actionForGap(gap = "") {
    const text = String(gap || "").trim();

    if (/channel|platform|social|website|profile|google business|referral|enquiry|inquiry/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Clarify where customers actually find or contact the business so YEVIB can understand the real visibility pathway, not just the brand message.",
        minimumInput:
          "Paste one practical channel signal: main platform, best-performing channel, website link, social profile, Google Business/Profile link, referral source, or main enquiry channel.",
      };
    }

    if (/website|owned-site pages/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add or provide a clearer website, landing page, service page, product page, or About page that explains what the business does.",
        minimumInput:
          "Paste one clear paragraph that explains the business, offer, location, and who it helps.",
      };
    }

    if (/owner-written|owner voice/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one real owner-written sample so YEVIB can understand how the owner actually explains, reassures, teaches, or speaks about the business.",
        minimumInput:
          "Paste one short post, caption, customer message, founder note, or 3–5 sentence explanation written in the owner’s real words.",
      };
    }

    if (/trust|proof/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one practical proof point so YEVIB can ground trust advice in something the business can actually show, not just imply.",
        minimumInput:
          "Paste one review, testimonial, before/after result, guarantee, certification, service standard, customer outcome, or short proof note.",
      };
    }

    if (/founder presence/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add a simple founder or team signal so the business feels more human, specific, and recognisable.",
        minimumInput:
          "Paste one short founder note, team description, or reason the business exists.",
      };
    }

    if (/offer|service|product/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Clarify the offer signal so YEVIB can ground recommendations in what the business actually sells, delivers, includes, or solves.",
        minimumInput:
          "Paste one practical offer note: a service description, product detail, package, price point, inclusion, delivery method, or customer problem the offer solves.",
      };
    }

    if (/audience/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Clarify the audience signal so YEVIB knows whether to aim strategy at the customer, buyer, or local market the business actually serves.",
        minimumInput:
          "Paste one practical audience note: who usually buys, who uses the product or service, or which local market the business mainly serves.",
      };
    }

    if (/outcome|result|benefit|transformation|customer win|solved|save|saved|stress|before\/after|before and after|value received/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one practical customer outcome signal so YEVIB can understand the real value customers receive, not just what the business offers.",
        minimumInput:
          "Paste one customer result, before/after note, solved problem, saved time or money example, reduced-stress example, customer win, or lived benefit.",
      };
    }

    if (/founder|owner|story|leadership|human|face|behind the business|why we started|values/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one practical founder visibility signal so YEVIB can understand the human reason, standard, or story behind the business.",
        minimumInput:
          "Paste one founder note, owner intro, short story, why-we-started explanation, values note, face-of-business detail, or human trust signal.",
      };
    }

    if (/education|educate|explain|explanation|faq|process|teach|teaching|question|how we do|advice/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one practical education signal so YEVIB understands what customers need explained before they trust, buy, book, or enquire.",
        minimumInput:
          "Paste one common customer question, FAQ answer, process explanation, advice note, teaching point, or short 'how we do it' explanation.",
      };
    }

    if (/activity|active|recent|post|posting|update|movement|latest|fresh|new/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Add one recent public activity signal so YEVIB can understand whether the business is active now, not just present online.",
        minimumInput:
          "Paste one recent post, update, job example, launch note, service change, customer-facing activity signal, or short note about recent business movement.",
      };
    }

    if (/location|local|area|region|market|suburb|service area|delivery area/i.test(text)) {
      return {
        gap: text,
        ownerAction:
          "Clarify the location or local-market signal so YEVIB understands where the business actually serves, sells, delivers, or wants attention.",
        minimumInput:
          "Paste one practical location note: suburb, service area, delivery area, pickup area, region, shipping area, or main local market.",
      };
    }

    return {
      gap: text,
      ownerAction:
        "Add one clearer source of business evidence so YEVIB can make a stronger and safer recommendation.",
      minimumInput:
        "Paste one short piece of source material that explains the business more clearly.",
    };
  }

  const channelGap = hasChannelOrPlatformSignal
    ? ""
    : "Channel, platform, social presence, website presence, public profile, Google Business/Profile, referral source, or enquiry channel is unclear.";

  const enrichedMissingEvidence = uniqueStrings(
    [
      channelGap,
      ...missingEvidence,
    ],
    8
  );

  const nextActions = enrichedMissingEvidence.map(actionForGap);

  const sourceLimitAction = (() => {
    if (nextActions.length > 0) return null;

    if (
      qualificationProfile?.executionEligible === false ||
      ["blocked", "identity_only", "inference_only"].includes(safeClaimLevel)
    ) {
      return {
        gap: "Limited source support",
        ownerAction:
          "Add one clearer owner-provided or business-owned source so YEVIB can move from restricted guidance to safer recommendations.",
        minimumInput:
          "Paste 3–5 owner-written sentences, one clear About/service paragraph, or one proof point that confirms what the business does and who it helps.",
      };
    }

    if (
      safeClaimLevel === "cautious" ||
      qualificationProfile?.level === "limited" ||
      cautionType !== "none"
    ) {
      return {
        gap: "Source confidence could be improved",
        ownerAction:
          "Add one real proof point so YEVIB can make the recommendation with less caution.",
        minimumInput:
          "Paste one customer review, testimonial, result, service detail, or founder note that proves the main claim.",
      };
    }

    return null;
  })();

  const finalNextActions = sourceLimitAction
    ? [sourceLimitAction]
    : nextActions;

  const shouldImproveSources = finalNextActions.length > 0;

  let priority = "none";
  if (
    ["blocked", "identity_only", "inference_only"].includes(safeClaimLevel) ||
    qualificationProfile?.level === "blocked"
  ) {
    priority = "high";
  } else if (
    safeClaimLevel === "cautious" ||
    qualificationProfile?.level === "limited" ||
    finalNextActions.length > 0
  ) {
    priority = "medium";
  }

  return {
    shouldImproveSources,
    priority: shouldImproveSources ? priority : "none",
    summary: shouldImproveSources
      ? "YEVIB can improve the quality of its recommendations if the owner adds a small amount of clearer source material."
      : "No immediate source improvement is required from the current evidence profile.",
    minimumUsefulAction:
      finalNextActions[0]?.minimumInput ||
      "No extra source material is needed right now.",
    nextActions: finalNextActions,
  };
}

function buildBrandIntelligence(profile = {}) {
  const advisorSnapshot = profile?.advisorSnapshot || {};
  const strategyEngine = profile?.strategyEngine || {};
  const evidenceProfile = profile?.evidenceProfile || buildEvidenceProfile(profile);
  const qualificationProfile =
    profile?.qualificationProfile || buildQualificationProfile(evidenceProfile, profile);
  const readinessProfile = profile?.readinessProfile || buildReadinessProfile({
    ...profile,
    evidenceProfile,
    qualificationProfile,
  });

  const primaryStrategy = strategyEngine?.primaryStrategy || null;
  const supportingStrategies = Array.isArray(strategyEngine?.supportingStrategies)
    ? strategyEngine.supportingStrategies
    : [];

  const groups = Array.isArray(readinessProfile?.groups) ? readinessProfile.groups : [];
  const strongestGroup = groups.length
    ? [...groups].sort((a, b) => (b.score / b.max) - (a.score / a.max))[0]
    : null;
  const weakestGroup = groups.length
    ? [...groups].sort((a, b) => (a.score / a.max) - (b.score / b.max))[0]
    : null;

  const readinessWeaknesses = groups.flatMap((group) => group?.weaknesses || []).slice(0, 8);
  const readinessStrengths = groups.flatMap((group) => group?.strengths || []).slice(0, 8);

  const strengths = uniqueStrings(
    [
      strongestGroup?.title
        ? `${strongestGroup.title} is currently the strongest readiness area.`
        : "",
      ...readinessStrengths,
      primaryStrategy?.name
        ? `The strongest current strategic direction is ${primaryStrategy.name}.`
        : "",
    ],
    6
  );

  const weaknesses = uniqueStrings(
    [
      weakestGroup?.title
        ? `${weakestGroup.title} is currently the weakest readiness area.`
        : "",
      ...readinessWeaknesses,
      ...(qualificationProfile?.level === "limited" || qualificationProfile?.level === "blocked"
        ? ["The current diagnosis is constrained by limited evidence."]
        : []),
    ],
    6
  );

  const opportunities = uniqueStrings(
    [
      advisorSnapshot?.recommendedFocus || "",
      strongestGroup?.title
        ? `Use ${strongestGroup.title} as leverage while improving the weakest area.`
        : "",
      weakestGroup?.nextMove || "",
      qualificationProfile?.nextMove || "",
    ],
    6
  );

  const threats = uniqueStrings(
    [
      weakestGroup?.title
        ? `If ${weakestGroup.title} stays weak, business performance may remain constrained.`
        : "",
      qualificationProfile?.level === "blocked"
        ? "The current evidence is too thin for trustworthy strategy or execution."
        : "",
      qualificationProfile?.level === "limited"
        ? "Overreaching beyond the available evidence would risk false confidence."
        : "",
      evidenceProfile?.missingEvidence?.length
        ? `Missing evidence remains: ${evidenceProfile.missingEvidence[0]}`
        : "",
    ],
    6
  );

  const readParts = [
    qualificationProfile?.summary || "",
    strongestGroup?.title
      ? `${strongestGroup.title} is the strongest readiness area right now.`
      : "",
    weakestGroup?.title
      ? `${weakestGroup.title} is the weakest readiness area right now.`
      : "",
    primaryStrategy?.name && qualificationProfile?.strategyLevel !== "none"
      ? `The best current strategy is ${primaryStrategy.name} at a ${qualificationProfile.strategyLevel} qualification level.`
      : "",
  ].filter(Boolean);

  return {
    read: readParts.join(" "),
    qualification: qualificationProfile,
    evidence: {
      score: evidenceProfile?.score || 0,
      state: evidenceProfile?.state || "thin",
      availableEvidence: evidenceProfile?.availableEvidence || [],
      missingEvidence: evidenceProfile?.missingEvidence || [],
    },
    readiness: readinessProfile,
    recommendedFocus:
      advisorSnapshot?.recommendedFocus ||
      weakestGroup?.nextMove ||
      qualificationProfile?.nextMove ||
      "No clear recommended focus yet.",
    strengths,
    weaknesses,
    opportunities,
    threats,
    blindSpots: evidenceProfile?.missingEvidence || [],
    trustSignals: evidenceProfile?.signals?.trustSignals || [],
    educationSignals: evidenceProfile?.signals?.educationSignals || [],
    activitySignals: evidenceProfile?.signals?.activitySignals || [],
    founderVisibilitySignals: evidenceProfile?.signals?.founderVisibilitySignals || [],
    primaryStrategy: primaryStrategy
      ? {
          key: primaryStrategy.key,
          name: primaryStrategy.name,
          objective: primaryStrategy.objective,
          score: primaryStrategy.score,
          scoreBreakdown: primaryStrategy.scoreBreakdown || [],
          primaryOutputs: primaryStrategy.primaryOutputs || [],
        }
      : null,
    supportingStrategies: supportingStrategies.map((strategy) => ({
      key: strategy.key,
      name: strategy.name,
      objective: strategy.objective,
      score: strategy.score,
      primaryOutputs: strategy.primaryOutputs || [],
    })),
  };
}

function buildChosenMove(profile = {}) {
  const qualificationProfile = profile?.qualificationProfile || {};
  const strategyEngine = profile?.strategyEngine || buildStrategyEngine(profile);

  const qualificationLevel = qualificationProfile?.level || "blocked";
  const strategyLevel = strategyEngine?.strategyLevel || qualificationProfile?.strategyLevel || "none";
  const executionEligible =
    typeof qualificationProfile?.executionEligible === "boolean"
      ? qualificationProfile.executionEligible
      : Boolean(strategyEngine?.executionEligible);

  const primary = strategyEngine?.primaryStrategy || null;
  const supporting = Array.isArray(strategyEngine?.supportingStrategies)
    ? strategyEngine.supportingStrategies
    : [];

  const strategyLibrary = buildStrategyLibrary(profile, getGroupMap(profile));
  const selectedStrategy = strategyLibrary[primary?.key] || null;

  if (strategyLevel === "none" || qualificationLevel === "blocked") {
    return {
      strategyKey: "blocked",
      title: "Evidence-Limited Guidance",
      operatorRole:
        "YEVIB stays in diagnostic mode until there is enough evidence for a trustworthy strategy.",
      instruction:
        "Do not present a full campaign direction yet. First strengthen the evidence base.",
      reason:
        qualificationProfile?.summary ||
        "There is not enough evidence yet to unlock a trustworthy strategy.",
      actions: [
        "Show the clearest visible gaps in the current business signal.",
        "Ask for the minimum extra evidence that would unlock a stronger diagnosis.",
        "Hold execution until the system is qualified to recommend it."
      ],
      supportActions: [
        "Keep the scan honest about what it can and cannot see.",
        "Prefer evidence gathering over confident execution language.",
        "Only unlock strategy when the diagnosis is strong enough to support it."
      ],
      tools: ["diagnostic guidance"],
      constraint:
        "Do not pretend a full execution path is available when the evidence is still too thin.",
      schedule: "Unlock after stronger evidence",
      campaignType: "diagnostic_only",
      successSignal:
        "A stronger evidence base that justifies a more confident strategy recommendation.",
      secondaryStrategies: []
    };
  }

  if (!primary || !selectedStrategy) {
    return {
      strategyKey: strategyLevel === "cautious" ? "cautious_general" : "general",
      title:
        strategyLevel === "cautious"
          ? "Cautious Strategy Guidance"
          : "General Strategy System",
      operatorRole:
        strategyLevel === "cautious"
          ? "YEVIB acts carefully, using only the business signal it can actually justify."
          : "YEVIB acts as a digital strategy operator across content, visibility, and conversion.",
      instruction:
        strategyLevel === "cautious"
          ? "Use one controlled direction, but keep claims and execution scope modest."
          : "Run one clear campaign direction instead of scattered activity.",
      reason:
        strategyLevel === "cautious"
          ? qualificationProfile?.summary ||
            "The scan can suggest a direction, but it is not strong enough for a fully confident strategy."
          : "No stronger strategy signal was available, so YEVIB selected a general execution path.",
      actions:
        strategyLevel === "cautious"
          ? [
              "Choose one low-risk campaign direction.",
              "Create a small set of aligned outputs under that direction.",
              "Use the next cycle to strengthen evidence before expanding execution."
            ]
          : [
              "Choose one campaign direction.",
              "Create posts and images under that one direction.",
              "Distribute consistently enough for the market to feel it."
            ],
      supportActions:
        strategyLevel === "cautious"
          ? [
              "Keep message consistency.",
              "Use only proof already visible in the scan.",
              "Avoid over-claiming what the business has not yet proven publicly."
            ]
          : [
              "Keep message consistency.",
              "Use proof where possible.",
              "Turn attention into next-step movement."
            ],
      tools:
        strategyLevel === "cautious" || !executionEligible
          ? ["social posts"]
          : ["social posts", "images"],
      constraint:
        strategyLevel === "cautious"
          ? "Keep the move narrow, evidence-backed, and easy to revise as stronger signal appears."
          : "Do not split focus across too many unrelated themes.",
      schedule: strategyLevel === "cautious" ? "14 days" : "30 days",
      campaignType: strategyLevel === "cautious" ? "cautious_general" : "general",
      successSignal:
        strategyLevel === "cautious"
          ? "Clearer signal with less overreach and a stronger base for the next recommendation."
          : "Clearer public signal and more coordinated business movement.",
      secondaryStrategies: []
    };
  }

  const baseActions = Array.isArray(selectedStrategy.actions)
    ? selectedStrategy.actions
    : [];
  const baseSupportActions = Array.isArray(selectedStrategy.supportActions)
    ? selectedStrategy.supportActions
    : [];
  const baseTools = Array.isArray(selectedStrategy.tools)
    ? selectedStrategy.tools
    : [];

  const chosenActions =
    strategyLevel === "cautious"
      ? [
          `Run a narrower version of ${selectedStrategy.title}.`,
          ...baseActions.slice(0, 2),
          "Use the next scan cycle to validate whether stronger execution is justified."
        ]
      : baseActions;

  const chosenSupportActions =
    strategyLevel === "cautious"
      ? [
          ...baseSupportActions.slice(0, 2),
          "Keep claims, promises, and campaign scope tightly tied to the current evidence."
        ]
      : baseSupportActions;

  const chosenTools =
    !executionEligible
      ? baseTools.filter((tool) => !/image|distribution|community|comment/i.test(String(tool || "")))
      : baseTools;

  return {
    strategyKey: selectedStrategy.key,
    title:
      strategyLevel === "cautious"
        ? `${selectedStrategy.title} (Cautious Mode)`
        : selectedStrategy.title,
    operatorRole:
      strategyLevel === "cautious"
        ? "YEVIB acts with a controlled, evidence-limited strategy posture."
        : selectedStrategy.operatorRole,
    instruction:
      strategyLevel === "cautious"
        ? `Use ${selectedStrategy.title} carefully and keep the move proportional to the current evidence base.`
        : selectedStrategy.strategySummary,
    reason:
      strategyLevel === "cautious"
        ? `${selectedStrategy.reason} Current qualification level requires a narrower execution posture.`
        : selectedStrategy.reason,
    actions: chosenActions,
    supportActions: chosenSupportActions,
    tools: chosenTools.length ? chosenTools : ["social posts"],
    constraint:
      strategyLevel === "cautious"
        ? "Keep the strategy grounded in the real business, limit scope, and avoid presenting full execution certainty too early."
        : "Keep the strategy grounded in the real business, execute one clear system at a time, and make every output serve the same campaign direction.",
    schedule:
      strategyLevel === "cautious"
        ? `Start smaller • ${selectedStrategy.cadence}`
        : `${selectedStrategy.duration} • ${selectedStrategy.cadence}`,
    campaignType:
      strategyLevel === "cautious"
        ? `${selectedStrategy.campaignType}_cautious`
        : selectedStrategy.campaignType,
    successSignal:
      strategyLevel === "cautious"
        ? "A cleaner, evidence-backed public signal that earns stronger strategy confidence next cycle."
        : selectedStrategy.successSignal,
    secondaryStrategies:
      strategyLevel === "cautious"
        ? []
        : supporting.map((item) => ({
            key: item.key,
            title: item.name,
            reason: item.objective
          }))
  };
}
function canYevibSayIsGoingTo(profile = {}, chosenMove = {}) {
  const hasStrategy =
    Boolean(profile?.strategyEngine?.primaryStrategy?.key) ||
    Boolean(chosenMove?.strategyKey);

  const hasChosenMove =
    Boolean(chosenMove?.title) &&
    Array.isArray(chosenMove?.actions) &&
    chosenMove.actions.length > 0;

  const hasExecutionSignals =
    Array.isArray(chosenMove?.actions) &&
    chosenMove.actions.length > 0 &&
    Boolean(chosenMove?.campaignType || chosenMove?.tools?.length);

  return hasStrategy && hasChosenMove && hasExecutionSignals;
}

function buildExecutionEta(profile = {}, chosenMove = {}) {
  const sourceConfidence = String(profile?.discoveryProfile?.sourceConfidence || "medium").toLowerCase();
  const weakVoice = Boolean(profile?.sourceProfile?.weakVoiceSource);
  const channelsFound = profile?.discoveryProfile?.channelsFound || {};
  const hasChannels = Object.values(channelsFound).some(Boolean);
  const actionCount = Array.isArray(chosenMove?.actions) ? chosenMove.actions.length : 0;
  const campaignType = String(chosenMove?.campaignType || "").toLowerCase();

  let setup = "2–3 days";
  let firstSignal = "7–14 days";
  let compounding = "3–6 weeks";

  if (sourceConfidence === "high" && hasChannels && !weakVoice) {
    setup = "1–2 days";
    firstSignal = "3–7 days";
    compounding = "2–4 weeks";
  } else if (sourceConfidence === "low" || weakVoice) {
    setup = "3–5 days";
    firstSignal = "1–2 weeks";
    compounding = "4–8 weeks";
  }

  if (campaignType === "founder_presence") {
    firstSignal = weakVoice ? "1–2 weeks" : "5–10 days";
  }

  if (campaignType === "trust" || campaignType === "proof_harvest") {
    compounding = "3–6 weeks";
  }

  if (campaignType === "visibility") {
    firstSignal = "3–7 days";
    compounding = "2–4 weeks";
  }

  if (campaignType === "subscription") {
    firstSignal = "1–2 weeks";
    compounding = "4–8 weeks";
  }

  if (actionCount >= 5 && setup === "1–2 days") {
    setup = "2–3 days";
  }

  return { setup, firstSignal, compounding };
}

function buildExpectedOutcome(profile = {}, chosenMove = {}) {
  const campaignType = String(chosenMove?.campaignType || "").toLowerCase();

  if (campaignType === "trust") {
    return {
      minimum: "Clearer proof, standards, and reassurance in public-facing content.",
      likely: "Improved trust-bearing engagement and stronger buyer confidence.",
      maximum: "Noticeable lift in conversion quality, inbound trust, and decision speed."
    };
  }

  if (campaignType === "visibility") {
    return {
      minimum: "More consistent public output and stronger message repetition.",
      likely: "Improved reach, profile visits, and repeated audience exposure.",
      maximum: "Noticeable lift in brand familiarity, inbound attention, and momentum."
    };
  }

  if (campaignType === "founder_presence") {
    return {
      minimum: "Stronger founder visibility and less generic brand language.",
      likely: "Improved connection, recognition, and audience memory of the brand.",
      maximum: "Noticeable lift in trust, founder-led loyalty, and brand distinctiveness."
    };
  }

  if (campaignType === "education") {
    return {
      minimum: "Clearer educational output and stronger topic consistency.",
      likely: "Improved authority perception, saves, shares, and trust.",
      maximum: "Noticeable lift in inbound interest, audience confidence, and expert positioning."
    };
  }

  if (campaignType === "offer_clarification") {
    return {
      minimum: "Clearer understanding of what the business offers and why it matters.",
      likely: "Improved response quality, better-fit inquiries, and stronger message clarity.",
      maximum: "Noticeable lift in conversions, offer comprehension, and decision speed."
    };
  }

  if (campaignType === "subscription") {
    return {
      minimum: "Stronger owned-audience direction and clearer subscribe reasons.",
      likely: "Improved sign-up intent and more repeat contact opportunities.",
      maximum: "Noticeable lift in retained audience value, repeat engagement, and future conversion control."
    };
  }

  return {
    minimum: "Increased content consistency and clearer messaging.",
    likely: "Improved audience response and engagement patterns.",
    maximum: "Noticeable shift in trust, inbound interest, or conversions."
  };
}

function buildRiskNotes(profile = {}, chosenMove = {}) {
  const riskNotes = [];
  const weakVoice = Boolean(profile?.sourceProfile?.weakVoiceSource);
  const sourceConfidence = String(profile?.discoveryProfile?.sourceConfidence || "medium").toLowerCase();
  const hasChannels = Object.values(profile?.discoveryProfile?.channelsFound || {}).some(Boolean);

  riskNotes.push("Results depend on consistency of execution across the full strategy window.");

  if (weakVoice) {
    riskNotes.push("Weak founder signal may slow trust-building and differentiation until stronger owner-led language is added.");
  }

  if (sourceConfidence === "low") {
    riskNotes.push("A thinner source base may reduce strategy precision until more business evidence is gathered.");
  }

  if (!hasChannels) {
    riskNotes.push("Limited public channel presence may slow visibility, feedback, and compounding effects.");
  }

  return riskNotes.slice(0, 3);
}

function buildExecutionSummary(profile = {}, chosenMove = {}, canCommit = false) {
  const businessName = profile?.businessProfile?.name || "the business";
  const instruction =
    chosenMove?.instruction ||
    "execute the strongest available strategy";

  const cleanInstruction = String(instruction).replace(/\.$/, "");

  if (canCommit) {
    return `YEVIB is going to ${cleanInstruction.toLowerCase()} for ${businessName}.`;
  }

  return `YEVIB recommends ${cleanInstruction.toLowerCase()} for ${businessName}, but cannot frame it as active execution until a full executable move is locked.`;
}

function normalizePhase3Expectation(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function getPhase3ActualSignalLevel(profile = {}) {
  const overallPct = Number(profile?.groupedSnapshot?.overallPct || 0);
  const sourceConfidence = String(
    profile?.discoveryProfile?.sourceConfidence || "medium"
  ).toLowerCase();

  const evidenceState = String(profile?.evidenceProfile?.state || "").toLowerCase();
  const qualificationConfidence = String(
    profile?.qualificationProfile?.confidence || ""
  ).toLowerCase();

  const qualificationLevel = String(
    profile?.qualificationProfile?.level || ""
  ).toLowerCase();

  const pagesScanned = Number(profile?.evidenceProfile?.pagesScanned || 0);

  const thinUsableSourceSignal =
    pagesScanned <= 1 &&
    evidenceState === "usable" &&
    qualificationConfidence === "medium" &&
    (sourceConfidence === "low" || sourceConfidence === "medium");

  const strongPhase3Evidence =
    overallPct >= 70 &&
    sourceConfidence !== "low" &&
    evidenceState === "strong" &&
    qualificationLevel === "strong" &&
    pagesScanned >= 3;

  if (thinUsableSourceSignal) {
    return "weak";
  }

  if (sourceConfidence === "low") {
    return "limited_to_medium";
  }

  if (strongPhase3Evidence) {
    return "medium_to_strong";
  }

  if (evidenceState === "usable" || pagesScanned <= 1) {
    return overallPct >= 40 ? "limited_to_medium" : "weak";
  }

  if (overallPct >= 70) {
    return "medium_to_strong";
  }

  if (overallPct >= 40) {
    return "limited_to_medium";
  }

  return "weak";
}

function getPhase3ActualQualification(profile = {}, executionPlan = {}) {
  const overallPct = Number(profile?.groupedSnapshot?.overallPct || 0);
  const sourceConfidence = String(
    profile?.discoveryProfile?.sourceConfidence || "medium"
  ).toLowerCase();

  const weakVoice = Boolean(profile?.sourceProfile?.weakVoiceSource);
  const canCommit = Boolean(executionPlan?.canSayIsGoingTo);

  const qualificationLevel = String(
    profile?.qualificationProfile?.level || ""
  ).toLowerCase();
  const qualificationConfidence = String(
    profile?.qualificationProfile?.confidence || ""
  ).toLowerCase();

  const evidenceState = String(profile?.evidenceProfile?.state || "").toLowerCase();
  const pagesScanned = Number(profile?.evidenceProfile?.pagesScanned || 0);

  const thinUsableSourceSignal =
    pagesScanned <= 1 &&
    evidenceState === "usable" &&
    qualificationConfidence === "medium" &&
    (sourceConfidence === "low" || sourceConfidence === "medium");

  const strongPhase3Evidence =
    canCommit &&
    overallPct >= 70 &&
    sourceConfidence !== "low" &&
    evidenceState === "strong" &&
    qualificationLevel === "strong" &&
    pagesScanned >= 3;

  const strongEnoughDespiteWeakVoice =
    weakVoice &&
    strongPhase3Evidence;

  if (
    thinUsableSourceSignal ||
    overallPct < 35 ||
    sourceConfidence === "low" ||
    qualificationLevel === "blocked"
  ) {
    return "blocked_or_low_confidence";
  }

  if (strongPhase3Evidence) {
    return "diagnosable";
  }

  if (
    (weakVoice && !strongEnoughDespiteWeakVoice) ||
    !canCommit ||
    overallPct < 55 ||
    qualificationLevel === "limited" ||
    qualificationLevel === "standard" ||
    evidenceState === "usable" ||
    pagesScanned <= 1
  ) {
    return "cautious";
  }

  return "diagnosable";
}

function getPhase3ActualStrategyPressure(profile = {}, executionPlan = {}) {
  const primaryStrategy =
    profile?.strategyEngine?.primaryStrategy ||
    executionPlan?.primaryStrategy ||
    {};

  const commitmentMode = String(
    executionPlan?.commitmentMode || ""
  ).toLowerCase();

  const campaignType = String(
    executionPlan?.campaignType ||
      primaryStrategy?.campaignType ||
      primaryStrategy?.key ||
      primaryStrategy?.name ||
      ""
  ).toLowerCase();

    const recommendedFocus = String(
    profile?.groupedSnapshot?.recommendedFocus ||
      profile?.advisorSnapshot?.recommendedFocus ||
      ""
  ).toLowerCase();

  const combined = `${campaignType} ${recommendedFocus}`;
  const sourceConfidence = String(
    profile?.discoveryProfile?.sourceConfidence || "medium"
  ).toLowerCase();
  const evidenceState = String(profile?.evidenceProfile?.state || "").toLowerCase();
  const qualificationConfidence = String(
    profile?.qualificationProfile?.confidence || ""
  ).toLowerCase();
  const pagesScanned = Number(profile?.evidenceProfile?.pagesScanned || 0);
  const thinSourceSignal =
    pagesScanned <= 1 &&
    (sourceConfidence === "low" || sourceConfidence === "medium") &&
    evidenceState === "usable" &&
    qualificationConfidence === "medium";

  if (
    thinSourceSignal ||
    commitmentMode === "source_required" ||
    campaignType === "source_strengthening" ||
    /source_strengthening|source required|stronger source|source material|source evidence/.test(combined)
  ) {
    return "request_more_source_signal";
  }

  if (/product_truth|product_truth_system|product|offer|truth|quality|origin|standard|ingredient|routine|use-case|use case/.test(combined)) {
    return "product_truth_or_trust";
  }

  if (/proof|trust|credibility|review|reassurance/.test(combined)) {
    return "trust_or_visibility";
  }

  if (/visibility|awareness|posting|consistency|channel|presence/.test(combined)) {
    return "trust_or_visibility";
  }

    if (
    qualificationConfidence === "medium" ||
    pagesScanned <= 1 ||
    /clarity|positioning|message|voice|brand core/.test(combined)
  ) {
    return "clarity_or_trust";
  }

  if (/source|evidence|weak|limited|more signal|input/.test(combined)) {
    return "request_more_source_signal";
  }

  return "general_strategy";
}

function phase3ExpectationMatches(expected = "", actual = "") {
  const cleanExpected = normalizePhase3Expectation(expected);
  const cleanActual = normalizePhase3Expectation(actual);

  if (!cleanExpected || !cleanActual) return false;
  if (cleanExpected === cleanActual) return true;

    const expectedParts = cleanExpected.split("_or_");
  const actualParts = cleanActual.split("_or_");

  if (expectedParts.includes(cleanActual)) return true;
  if (actualParts.includes(cleanExpected)) return true;

  if (expectedParts.some((part) => actualParts.includes(part))) return true;

  if (cleanExpected.includes(cleanActual) || cleanActual.includes(cleanExpected)) {
    return true;
  }

    return false;
  }

function buildPhase3RegressionResult({
  site = {},
  profile = {},
  cycleResult = {},
  error = "",
}) {
  const executionPlan = profile?.executionPlan || {};
  const actualQualification = error
    ? "error"
    : getPhase3ActualQualification(profile, executionPlan);

  const actualSignalLevel = error
    ? "error"
    : getPhase3ActualSignalLevel(profile);

  const actualStrategyPressure = error
    ? "error"
    : getPhase3ActualStrategyPressure(profile, executionPlan);

  const checks = {
    qualification: {
      expected: site.expectedQualification || "",
      actual: actualQualification,
      pass: phase3ExpectationMatches(
        site.expectedQualification,
        actualQualification
      ),
    },
    signalLevel: {
      expected: site.expectedSignalLevel || "",
      actual: actualSignalLevel,
      pass: phase3ExpectationMatches(
        site.expectedSignalLevel,
        actualSignalLevel
      ),
    },
    strategyPressure: {
      expected: site.expectedStrategyPressure || "",
      actual: actualStrategyPressure,
      pass: phase3ExpectationMatches(
        site.expectedStrategyPressure,
        actualStrategyPressure
      ),
    },
  };

  const passed = Object.values(checks).every((check) => check.pass);

  return {
    id: site.id || "",
    group: site.group || "",
    label: site.label || "",
    businessUrl: site.businessUrl || "",
    passed,
    error,
    checks,
    actual: {
      businessName: profile?.businessProfile?.name || "",
      overallPct: profile?.groupedSnapshot?.overallPct || 0,
      overallState: profile?.groupedSnapshot?.overallState || "",
      sourceConfidence: profile?.discoveryProfile?.sourceConfidence || "",
      weakVoiceSource: Boolean(profile?.sourceProfile?.weakVoiceSource),
      primaryStrategy:
        profile?.strategyEngine?.primaryStrategy?.name ||
        profile?.strategyEngine?.primaryStrategy?.title ||
        profile?.strategyEngine?.primaryStrategy?.key ||
        "",
      rankedStrategies: Array.isArray(profile?.strategyEngine?.rankedStrategies)
        ? profile.strategyEngine.rankedStrategies.map((item) => {
            return `${item?.name || item?.key || "Unknown"}:${item?.score || 0}`;
          })
        : [],
        executionSummary: executionPlan?.summary || "",
        successSignal: executionPlan?.successSignal || "",
        canSayIsGoingTo: Boolean(executionPlan?.canSayIsGoingTo),
        evidenceCaution: executionPlan?.evidenceCaution || null,
        qualificationDebug: {
          evidenceScore: profile?.evidenceProfile?.score || 0,
          evidenceState: profile?.evidenceProfile?.state || "",
          qualificationLevel: profile?.qualificationProfile?.level || "",
          strategyLevel: profile?.qualificationProfile?.strategyLevel || "",
          executionEligible: Boolean(profile?.qualificationProfile?.executionEligible),
          qualificationConfidence: profile?.qualificationProfile?.confidence || "",
          pagesScanned: profile?.evidenceProfile?.pagesScanned || 0,
          hasOwnerWriting: Boolean(profile?.evidenceProfile?.hasOwnerWriting),
          missingEvidence: profile?.evidenceProfile?.missingEvidence || [],
        },
      runLog: cycleResult?.runLog || null,
    },
  };
}

async function runSinglePhase3RegressionSite(site = {}, defaults = {}) {
  const businessUrl = String(site?.businessUrl || "").trim();

  if (!businessUrl) {
    return buildPhase3RegressionResult({
      site,
      error: "Missing businessUrl.",
    });
  }

  try {
    const profile = await buildBusinessProfile({
      mode: site.mode || defaults.mode || "hybrid",
      businessUrl,
      pastedSourceText: site.pastedSourceText || defaults.pastedSourceText || "",
      founderGoal: site.founderGoal || defaults.founderGoal || "Build more trust",
      ownerWritingSample:
        site.ownerWritingSample || defaults.ownerWritingSample || "",
      manualBusinessContext:
        site.manualBusinessContext || defaults.manualBusinessContext || "",
    });

    const cycleResult = await runAgentCycleForProfile(profile);
    const finalProfile = cycleResult?.profile || profile;

    return buildPhase3RegressionResult({
      site,
      profile: finalProfile,
      cycleResult,
    });
  } catch (err) {
    console.error("PHASE 3 REGRESSION SITE ERROR:", site?.id, err.message);

    return buildPhase3RegressionResult({
      site,
      error: err?.message || "Unknown regression site error.",
    });
  }
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getGroupPctByKey(profile = {}, key = "") {
  const groups = Array.isArray(profile?.groupedSnapshot?.groups)
    ? profile.groupedSnapshot.groups
    : [];

  const match = groups.find((group) => group.key === key);
  if (!match || !match.max) return 0;
  return Math.round((match.score / match.max) * 100);
}

function getExecutionReadiness(profile = {}, chosenMove = {}) {
  const sourceMixPct = getGroupPctByKey(profile, "sourceMix");
  const brandCorePct = getGroupPctByKey(profile, "brandCore");
  const marketSignalPct = getGroupPctByKey(profile, "marketSignal");
  const optimizationPct = getGroupPctByKey(profile, "optimization");

  const overallPct = Number(profile?.groupedSnapshot?.overallPct || 0);
  const sourceConfidence = String(profile?.discoveryProfile?.sourceConfidence || "medium").toLowerCase();
  const weakVoice = Boolean(profile?.sourceProfile?.weakVoiceSource);

  const trustSignals = normalizeStringArray(profile?.discoveryProfile?.trustSignals || [], 6);
  const educationSignals = normalizeStringArray(profile?.discoveryProfile?.educationSignals || [], 6);
  const activitySignals = normalizeStringArray(profile?.discoveryProfile?.activitySignals || [], 6);
  const founderSignals = normalizeStringArray(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    6
  );

  const offers = normalizeStringArray(profile?.brandProductTruth?.offers || [], 6);
  const audience = normalizeStringArray(profile?.brandProductTruth?.audience || [], 6);
  const lifeMoments = normalizeStringArray(profile?.customerOutcome?.lifeMoments || [], 6);

  const channelsFound = profile?.discoveryProfile?.channelsFound || {};
  const channelCount = Object.values(channelsFound).filter(Boolean).length;

  let readinessScore = 0;

  readinessScore += overallPct * 0.20;
  readinessScore += sourceMixPct * 0.20;
  readinessScore += brandCorePct * 0.20;
  readinessScore += marketSignalPct * 0.20;
  readinessScore += optimizationPct * 0.20;

  if (sourceConfidence === "high") readinessScore += 8;
  if (sourceConfidence === "medium") readinessScore += 4;
  if (weakVoice) readinessScore -= 8;

  readinessScore += Math.min(channelCount * 3, 12);
  readinessScore += Math.min(trustSignals.length * 2, 8);
  readinessScore += Math.min(educationSignals.length * 2, 8);
  readinessScore += Math.min(activitySignals.length * 2, 8);
  readinessScore += Math.min(offers.length * 2, 8);
  readinessScore += Math.min(audience.length * 2, 8);
  readinessScore += Math.min(lifeMoments.length * 2, 8);

  if (founderSignals.some((s) => /limited/i.test(s))) readinessScore -= 4;

  readinessScore = clampInt(readinessScore, 0, 100);

  let readinessBand = "low";
  if (readinessScore >= 75) readinessBand = "high";
  else if (readinessScore >= 50) readinessBand = "medium";

  return {
    readinessScore,
    readinessBand,
    sourceMixPct,
    brandCorePct,
    marketSignalPct,
    optimizationPct,
    overallPct,
    sourceConfidence,
    weakVoice,
    channelCount,
    trustCount: trustSignals.length,
    educationCount: educationSignals.length,
    activityCount: activitySignals.length,
    offerCount: offers.length,
    audienceCount: audience.length,
    lifeMomentCount: lifeMoments.length,
    founderLimited: founderSignals.some((s) => /limited/i.test(s)),
    campaignType: String(chosenMove?.campaignType || "general").toLowerCase(),
  };
}

function buildUniversalEta(profile = {}, chosenMove = {}) {
  const read = getExecutionReadiness(profile, chosenMove);

  let setupDays = 4;
  let firstSignalDays = 10;
  let compoundingDays = 35;

  // Stronger business = faster setup and earlier signal
  setupDays -= Math.floor(read.readinessScore / 30);
  firstSignalDays -= Math.floor(read.readinessScore / 18);
  compoundingDays -= Math.floor(read.readinessScore / 8);

  // Source and channel effects
  setupDays -= Math.min(read.channelCount, 2);
  firstSignalDays -= Math.min(read.channelCount, 3);

  if (read.sourceConfidence === "high") {
    setupDays -= 1;
    firstSignalDays -= 1;
  }

  if (read.weakVoice) {
    setupDays += 2;
    firstSignalDays += 3;
    compoundingDays += 7;
  }

  if (read.founderLimited && read.campaignType === "founder_presence") {
    firstSignalDays += 3;
    compoundingDays += 7;
  }

  // Campaign-specific modifiers
  if (read.campaignType === "visibility") {
    firstSignalDays -= 2;
    compoundingDays -= 5;
  }

  if (read.campaignType === "trust_build" || read.campaignType === "trust" || read.campaignType === "proof_harvest") {
    firstSignalDays += 2;
    compoundingDays += 7;
  }

  if (read.campaignType === "education" || read.campaignType === "education_authority") {
    firstSignalDays += 1;
    compoundingDays += 5;
  }

  if (read.campaignType === "offer_clarification") {
    firstSignalDays -= 1;
    compoundingDays -= 3;
  }

  if (read.campaignType === "subscription") {
    firstSignalDays += 4;
    compoundingDays += 10;
  }

  if (read.campaignType === "partnership") {
    firstSignalDays += 5;
    compoundingDays += 10;
  }

  setupDays = clampInt(setupDays, 1, 7);
  firstSignalDays = clampInt(firstSignalDays, 3, 21);
  compoundingDays = clampInt(compoundingDays, 14, 70);

  return {
    setup: formatDayRange(setupDays, "day"),
    firstSignal: formatDayRange(firstSignalDays, "day"),
    compounding: formatDayRange(compoundingDays, compoundingDays >= 14 ? "week" : "day"),
    confidence: buildEtaConfidenceLabel(read.readinessBand, read.readinessScore),
    readinessScore: read.readinessScore,
    readinessBand: read.readinessBand,
  };
}

function formatDayRange(value, mode = "day") {
  if (mode === "week") {
    const minWeeks = Math.max(2, Math.floor(value / 7));
    const maxWeeks = Math.max(minWeeks + 1, Math.ceil((value + 7) / 7));
    return `${minWeeks}–${maxWeeks} weeks`;
  }

  const min = Math.max(1, value - 1);
  const max = value + 1;
  return `${min}–${max} days`;
}

function buildEtaConfidenceLabel(band = "medium", score = 0) {
  if (band === "high") return `High confidence ETA (${score}/100 readiness)`;
  if (band === "low") return `Cautious ETA (${score}/100 readiness)`;
  return `Working ETA (${score}/100 readiness)`;
}

function buildUniversalExpectedOutcome(profile = {}, chosenMove = {}) {
  const read = getExecutionReadiness(profile, chosenMove);
  const type = read.campaignType;

  let minimum = "Clearer execution structure and stronger message consistency.";
  let likely = "Improved audience response, stronger business signal, and better campaign direction.";
  let maximum = "Noticeable lift in trust, visibility, engagement, or conversion quality.";

  if (type === "visibility") {
    minimum = "More consistent public presence and stronger repetition of the core message.";
    likely = "Improved reach, impressions, and repeated exposure to the right audience.";
    maximum = "Noticeable lift in familiarity, profile visits, and inbound attention.";
  } else if (type === "trust" || type === "trust_build") {
    minimum = "Clearer proof, reassurance, and visible standards.";
    likely = "Improved trust-bearing engagement and better conversion confidence.";
    maximum = "Noticeable lift in buyer confidence, inquiry quality, and trust-driven conversion.";
  } else if (type === "founder_presence") {
    minimum = "Stronger founder visibility and less generic brand messaging.";
    likely = "Improved human connection, recognition, and brand memory.";
    maximum = "Noticeable lift in founder-led trust, loyalty, and distinctiveness.";
  } else if (type === "education" || type === "education_authority") {
    minimum = "More useful educational content and stronger topical clarity.";
    likely = "Improved authority perception, saves, shares, and trust.";
    maximum = "Noticeable lift in expert positioning, qualified attention, and inbound interest.";
  } else if (type === "offer_clarification") {
    minimum = "Clearer explanation of what the business does and why it matters.";
    likely = "Improved response quality and better-fit customer inquiries.";
    maximum = "Noticeable lift in conversion readiness and offer understanding.";
  } else if (type === "subscription") {
    minimum = "A clearer owned-audience pathway and stronger subscribe logic.";
    likely = "Improved sign-up intent and more repeat contact opportunities.";
    maximum = "Noticeable lift in retention power and owned-audience value.";
  }

  if (read.readinessBand === "low") {
    likely = `Early version of likely outcome: ${likely}`;
    maximum = `If execution stays consistent and signal improves: ${maximum}`;
  }

  return { minimum, likely, maximum };
}

function buildUniversalRiskNotes(profile = {}, chosenMove = {}) {
  const read = getExecutionReadiness(profile, chosenMove);
  const notes = [];

  notes.push("Results depend on consistency across the full campaign window, not one-off execution.");

  if (read.sourceMixPct < 55) {
    notes.push("A narrow source base may reduce strategy precision until more business evidence is gathered.");
  }

  if (read.weakVoice) {
    notes.push("Weak founder signal may slow differentiation until stronger owner-led language is added.");
  }

  if (read.channelCount === 0) {
    notes.push("Limited public channel presence may slow visibility and feedback loops.");
  }

  if (read.marketSignalPct < 55) {
    notes.push("A weaker market signal may delay stronger conversion or response outcomes until the offer is clearer.");
  }

  return notes.slice(0, 3);
}

const AGENT_RUNS_PATH = path.join(__dirname, "agent-runs.json");

function ensureAgentRunsFile() {
  if (!fs.existsSync(AGENT_RUNS_PATH)) {
    fs.writeFileSync(
      AGENT_RUNS_PATH,
      JSON.stringify({ runs: [] }, null, 2),
      "utf8"
    );
  }
}

function readAgentRuns() {
  ensureAgentRunsFile();
  try {
    return JSON.parse(fs.readFileSync(AGENT_RUNS_PATH, "utf8"));
  } catch {
    return { runs: [] };
  }
}

function writeAgentRuns(data) {
  ensureAgentRunsFile();
  fs.writeFileSync(AGENT_RUNS_PATH, JSON.stringify(data, null, 2), "utf8");
}

function createAgentRunLog({
  businessName,
  strategist,
  operator,
  analyst,
  executionPlan,
}) {
  const db = readAgentRuns();

  const run = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    businessName: businessName || "Unknown Business",
    strategist,
    operator,
    analyst,
    executionPlan,
  };

  db.runs.push(run);
  db.runs = db.runs.slice(-200);

  writeAgentRuns(db);
  return run;
}

function buildStrategistAgent(profile = {}) {
  const chosenMove = profile?.chosenMove || buildChosenMove(profile);
  const executionPlan = profile?.executionPlan || buildExecutionPlan(profile);
  const strategyEngine = profile?.strategyEngine || buildStrategyEngine(profile);

  return {
    role: "strategist",
    primaryStrategy: strategyEngine?.primaryStrategy || null,
    supportingStrategies: strategyEngine?.supportingStrategies || [],
    chosenMove: {
      title: chosenMove?.title || "",
      strategyKey: chosenMove?.strategyKey || "",
      reason: chosenMove?.reason || "",
      campaignType: chosenMove?.campaignType || "general",
    },
    mission:
      executionPlan?.summary ||
      chosenMove?.instruction ||
      "Run the strongest available strategy.",
    successSignal:
      executionPlan?.successSignal ||
      chosenMove?.successSignal ||
      "Stronger public performance."
  };
}

function buildOperatorAgent(profile = {}) {
  const chosenMove = profile?.chosenMove || buildChosenMove(profile);
  const executionPlan = profile?.executionPlan || buildExecutionPlan(profile);

  return {
    role: "operator",
    campaignType: chosenMove?.campaignType || "general",
    tools: executionPlan?.tools || ["social posts", "images"],
    actions: executionPlan?.actions || [],
    supportActions: executionPlan?.supportActions || [],
    eta: executionPlan?.eta || null,
  };
}

function buildAnalystAgent(profile = {}) {
  const groupedSnapshot = profile?.groupedSnapshot || {};
  const groups = Array.isArray(groupedSnapshot?.groups) ? groupedSnapshot.groups : [];
  const ranked = [...groups].sort((a, b) => {
    const aPct = a?.max ? a.score / a.max : 0;
    const bPct = b?.max ? b.score / b.max : 0;
    return aPct - bPct;
  });

  const weakest = ranked[0] || null;
  const strongest = ranked[ranked.length - 1] || null;

  return {
    role: "analyst",
    strongestArea: strongest
      ? {
          key: strongest.key,
          title: strongest.title,
          score: strongest.score,
          max: strongest.max,
          nextMove: strongest.nextMove,
        }
      : null,
    weakestArea: weakest
      ? {
          key: weakest.key,
          title: weakest.title,
          score: weakest.score,
          max: weakest.max,
          nextMove: weakest.nextMove,
        }
      : null,
    adjustmentRule: weakest
      ? `Keep strategy pressure on ${weakest.title} until it improves enough to stop being the weakest visible area.`
      : "Keep reviewing performance and adjust based on the weakest visible area.",
  };
}

function buildMultiAgentSystem(profile = {}) {
  const strategist = buildStrategistAgent(profile);
  const operator = buildOperatorAgent(profile);
  const analyst = buildAnalystAgent(profile);
  const executionPlan = profile?.executionPlan || buildExecutionPlan(profile);

  return {
    strategist,
    operator,
    analyst,
    command:
      executionPlan?.canSayIsGoingTo
        ? "active_execution"
        : "advisory_only",
  };
}

function buildExecutionPlan(profile = {}) {
  const chosenMove = profile?.chosenMove || buildChosenMove(profile);
  const sourceConfidence = String(
    profile?.discoveryProfile?.sourceConfidence || "medium"
  ).toLowerCase();

  const ubdgStrength = profile?.ubdgEvidencePacket?.strengthSummary || {};
  const ubdgClaimWording = profile?.ubdgEvidencePacket?.claimWording || {};

  const ubdgEvidenceCount = Number(ubdgStrength?.evidenceCount || 0);
  const ubdgEvidenceState = String(ubdgStrength?.evidenceState || "no_evidence").trim();
  const ubdgSafeClaimLevel = String(ubdgStrength?.safeClaimLevel || "blocked").trim();
  const ubdgClaimLead = String(ubdgClaimWording?.claimLead || "More source signal is needed").trim();

  const sourceConfidenceBlocksExecution = sourceConfidence === "low";
  const ubdgBlocksExecution =
    ubdgSafeClaimLevel === "blocked" ||
    ubdgSafeClaimLevel === "identity_only" ||
    ubdgSafeClaimLevel === "inference_only";

  const ubdgRequiresCaution =
    ubdgSafeClaimLevel === "cautious" ||
    ubdgEvidenceState === "limited" ||
    ubdgEvidenceState === "usable";

  const canCommit =
    !sourceConfidenceBlocksExecution &&
    !ubdgBlocksExecution &&
    canYevibSayIsGoingTo(profile, chosenMove);

  const ubdgEvidenceLimits = [];

  if (ubdgEvidenceCount === 0) {
    ubdgEvidenceLimits.push(
      "No usable UBDG evidence packet was available for this execution plan."
    );
  }

  if (ubdgSafeClaimLevel === "blocked") {
    ubdgEvidenceLimits.push(
      "UBDG marked claim strength as blocked, so YEVIB should ask for stronger owner, website, registry, review, or public profile evidence before execution."
    );
  }

    if (ubdgSafeClaimLevel === "identity_only") {
    ubdgEvidenceLimits.push(
      "UBDG found registry-only evidence, so YEVIB may confirm official identity or registration wording only. It must not claim the business is trustworthy, high quality, safe to buy from, active, successful, customer-approved, or operationally strong from registry evidence alone."
    );
  }

  if (ubdgSafeClaimLevel === "inference_only") {
    ubdgEvidenceLimits.push(
      "UBDG found inference-only evidence, so YEVIB must not present the read as confirmed business truth."
    );
  }

  if (ubdgRequiresCaution) {
    ubdgEvidenceLimits.push(
      "UBDG allows a useful recommendation, but wording should stay cautious and evidence limits should remain visible."
    );
  }

  if (sourceConfidenceBlocksExecution || ubdgBlocksExecution) {
    return {
      title: "Source Strengthening Required",
      summary:
        sourceConfidenceBlocksExecution
          ? "YEVIB needs stronger source material before it can run an active campaign for this business."
          : `${ubdgClaimLead}. YEVIB needs stronger evidence before it can safely run an active campaign for this business.`,
      commitmentMode: "source_required",
      canSayIsGoingTo: false,

      reason:
        sourceConfidenceBlocksExecution
          ? "The scan found low source confidence, so YEVIB should strengthen the evidence base before committing to execution."
          : "The UBDG evidence packet does not yet support active execution language, so YEVIB should surface the evidence gap instead of overclaiming.",

      operatorRole:
        "YEVIB acts as a source-strengthening assistant until the business has enough visible evidence for a confident campaign.",

      actions: [
        "Collect clearer business source material before running a campaign.",
        "Add or paste stronger founder, offer, proof, customer, and public activity signals.",
        "Re-scan the business once the source base is stronger."
      ],

      supportActions: [
        "Avoid overclaiming from thin evidence.",
        "Use the current scan as a starting diagnosis, not a final campaign commitment.",
        "Prioritise source quality before output volume."
      ],

      tools: [
        "source checklist",
        "owner writing prompt",
        "proof collection prompt"
      ],

      constraint:
        "Do not frame YEVIB as actively running a campaign until source confidence and UBDG evidence strength improve.",

      schedule:
        "Source strengthening first, then re-run the strategy cycle.",

      campaignType: "source_strengthening",

      successSignal:
        "The next scan has enough source evidence for a more confident diagnosis and execution plan.",

      evidenceCaution: {
        sourceConfidence,
        ubdgEvidenceCount,
        ubdgEvidenceState,
        ubdgSafeClaimLevel,
        claimLead: ubdgClaimLead,
        limits: ubdgEvidenceLimits,
      },

      eta: {
        setup: "Same day",
        firstSignal: "After stronger source material is added",
        compounding: "After re-scan",
        confidence: "Execution blocked until source confidence and evidence strength improve",
        readinessScore: 0,
        readinessBand: "blocked"
      },

      expectedOutcome: {
        minimum:
          "YEVIB avoids overcommitting from weak source material.",
        likely:
          "The owner adds enough evidence for a more useful scan.",
        maximum:
          "The next scan can produce a confident strategy and execution plan."
      },

      riskNotes: [
        "Low source confidence or weak UBDG evidence means the business may be underrepresented or unclear from available public material.",
        "Running active campaign language too early may reduce trust in YEVIB's judgement.",
        ...ubdgEvidenceLimits,
      ],

      secondaryStrategies: [],
    };
  }

  const baseSummary = buildExecutionSummary(profile, chosenMove, canCommit);
  const safeSummary =
    ubdgRequiresCaution && baseSummary
      ? `${baseSummary} Evidence strength is marked cautious, so YEVIB should keep claim limits visible while executing.`
      : baseSummary;

  return {
    title: chosenMove?.title || "Execution Plan",
    summary: safeSummary,
    commitmentMode: canCommit ? "active_execution" : "advisory_only",
    canSayIsGoingTo: canCommit,

    reason:
      chosenMove?.reason ||
      "This strategy was chosen because it gives the business the strongest practical next move.",

    operatorRole:
      ubdgRequiresCaution
        ? "YEVIB acts as a controlled execution assistant, keeping evidence strength and claim limits visible while moving the business forward."
        : chosenMove?.operatorRole ||
          "YEVIB acts as a digital operator across the selected strategy.",

    actions:
      Array.isArray(chosenMove?.actions) && chosenMove.actions.length
        ? chosenMove.actions
        : [
            "Choose one campaign system.",
            "Build the outputs around that system.",
            "Execute consistently enough for the market to feel it."
          ],

    supportActions:
      Array.isArray(chosenMove?.supportActions) && chosenMove.supportActions.length
        ? chosenMove.supportActions
        : [
            "Support the main campaign with aligned actions.",
            "Keep the message consistent.",
            "Use repetition strategically."
          ],

    tools:
      Array.isArray(chosenMove?.tools) && chosenMove.tools.length
        ? chosenMove.tools
        : ["social posts", "images"],

    constraint:
      ubdgRequiresCaution
        ? "Keep the move practical, specific, directly tied to the real business, and worded according to the available evidence strength."
        : chosenMove?.constraint ||
          "Keep the move practical, specific, and directly tied to the real business.",

    schedule:
      chosenMove?.schedule ||
      "Run the selected strategy over a defined cycle.",

    campaignType:
      chosenMove?.campaignType || "general",

    successSignal:
      chosenMove?.successSignal ||
      "The business should become clearer, stronger, and more effective in public.",

    evidenceCaution: {
      sourceConfidence,
      ubdgEvidenceCount,
      ubdgEvidenceState,
      ubdgSafeClaimLevel,
      claimLead: ubdgClaimLead,
      limits: ubdgEvidenceLimits,
    },

    eta: buildUniversalEta(profile, chosenMove),
    expectedOutcome: buildUniversalExpectedOutcome(profile, chosenMove),
    riskNotes: [
      ...buildUniversalRiskNotes(profile, chosenMove),
      ...ubdgEvidenceLimits,
    ],

    secondaryStrategies:
      chosenMove?.secondaryStrategies || [],
  };
}

function getStrategyCatalog() {
  return [
    {
      key: "trust_build",
      name: "Trust Build",
      objective: "Increase buyer confidence through proof, standards, process, and credibility signals.",
      triggers: [
        "low_trust_signal",
        "unclear_proof",
        "hidden_standards",
        "weak_conversion_confidence"
      ],
      primaryOutputs: [
        "proof-led social post pack",
        "standards and process content series",
        "testimonial/proof collection plan",
        "trust-focused homepage copy direction"
      ]
    },
    {
      key: "visibility_push",
      name: "Visibility Push",
      objective: "Increase consistent brand visibility across public channels and relevant audiences.",
      triggers: [
        "low_public_presence",
        "weak_channel_activity",
        "low_attention",
        "inconsistent_posting"
      ],
      primaryOutputs: [
        "30-day visibility post plan",
        "community posting direction",
        "repeatable awareness content pack",
        "channel consistency schedule"
      ]
    },
    {
      key: "founder_presence_campaign",
      name: "Founder Presence Campaign",
      objective: "Make the founder more visible so the brand feels more human, distinct, and memorable.",
      triggers: [
        "weak_founder_visibility",
        "generic_brand_voice",
        "thin_founder_signal"
      ],
      primaryOutputs: [
        "founder-led post series",
        "founder story prompts",
        "founder presence content calendar",
        "about-page strengthening direction"
      ]
    },
    {
      key: "education_authority_series",
      name: "Education Authority Series",
      objective: "Build authority by teaching clearly and repeatedly from real business knowledge.",
      triggers: [
        "education_signal_present",
        "knowledge_rich_business",
        "needs_authority_build"
      ],
      primaryOutputs: [
        "educational content series",
        "explanation-first post pack",
        "FAQ-to-content conversion plan",
        "authority-building content prompts"
      ]
    },
        {
      key: "offer_clarification_run",
      name: "Offer Clarification Run",
      objective: "Make the offer easier to understand so people know what is sold, who it is for, and why it matters.",
      triggers: [
        "unclear_offer",
        "weak_market_signal",
        "confused_positioning"
      ],
      primaryOutputs: [
        "offer clarification post pack",
        "value proposition rewrite direction",
        "real-life use-case series",
        "homepage/service explanation copy"
      ]
    },
    {
      key: "product_truth_system",
      name: "Product Truth System",
      objective: "Turn real product qualities, use cases, standards, ingredients, proof, and customer value into clearer public content.",
      triggers: [
        "clear_product_signal",
        "product_value_needs_explaining",
        "quality_or_standard_signal",
        "ecommerce_product_brand"
      ],
      primaryOutputs: [
        "product truth post pack",
        "product value explanation series",
        "use-case content angles",
        "standards and proof content direction"
      ]
    },
    {
      key: "reactivation_sequence",
      name: "Reactivation Sequence",
      objective: "Reconnect with warm audiences, past buyers, or quiet followers using simple value-led touchpoints.",
      triggers: [
        "stale_audience",
        "inactive_customer_base",
        "needs_return_attention"
      ],
      primaryOutputs: [
        "reactivation email ideas",
        "return-customer offer prompts",
        "warm audience post sequence",
        "re-engagement content direction"
      ]
    },
    {
      key: "community_penetration_play",
      name: "Community Penetration Play",
      objective: "Place the business deeper into relevant communities, circles, and audience environments.",
      triggers: [
        "community_fit",
        "local_or_niche_brand",
        "weak_external_reach"
      ],
      primaryOutputs: [
        "community-first post pack",
        "group/community outreach angle",
        "local relevance campaign",
        "comment and reciprocity direction"
      ]
    },
    {
      key: "referral_reciprocity_loop",
      name: "Referral / Reciprocity Loop",
      objective: "Create growth through goodwill, referrals, collaboration, and exchanged value.",
      triggers: [
        "good_customer_sentiment",
        "partnership_potential",
        "community_brand",
        "word_of_mouth_fit"
      ],
      primaryOutputs: [
        "referral prompt pack",
        "give-to-get campaign ideas",
        "reciprocity content direction",
        "collaboration incentive prompts"
      ]
    },
    {
      key: "proof_harvest_campaign",
      name: "Proof Harvest Campaign",
      objective: "Actively collect stronger proof assets the business can reuse in content and sales material.",
      triggers: [
        "not_enough_proof_assets",
        "hidden_results",
        "weak_social_proof"
      ],
      primaryOutputs: [
        "proof collection checklist",
        "customer result capture prompts",
        "testimonial gathering plan",
        "before/after or process proof direction"
      ]
    },
    {
      key: "partnership_outreach_pack",
      name: "Partnership Outreach Pack",
      objective: "Open collaboration, stockist, creator, or business partnership opportunities.",
      triggers: [
        "partnership_potential",
        "ecosystem_fit",
        "expansion_ready"
      ],
      primaryOutputs: [
        "partnership outreach angles",
        "collaboration message pack",
        "cross-promotion direction",
        "relationship-building campaign prompts"
      ]
    }
  ];
}

function scoreStrategy(strategy = {}, profile = {}) {
  const groupedSnapshot = profile?.groupedSnapshot || {};
  const advisorSnapshot = profile?.advisorSnapshot || {};
  const discoveryProfile = profile?.discoveryProfile || {};
  const sourceProfile = profile?.sourceProfile || {};
  const contentProfile = profile?.contentProfile || {};
  const brandProductTruth = profile?.brandProductTruth || {};
  const customerOutcome = profile?.customerOutcome || {};

  const founderGoal = String(profile?.founderGoal || "").toLowerCase();
  const recommendedFocus = String(
    groupedSnapshot?.recommendedFocus || advisorSnapshot?.recommendedFocus || ""
  ).toLowerCase();

  const trustSignals = normalizeStringArray(discoveryProfile?.trustSignals, 6);
  const educationSignals = normalizeStringArray(discoveryProfile?.educationSignals, 6);
  const activitySignals = normalizeStringArray(discoveryProfile?.activitySignals, 6);
  const founderVisibilitySignals = normalizeStringArray(discoveryProfile?.founderVisibilitySignals, 6);

  const offers = normalizeStringArray(brandProductTruth?.offers, 6);
  const audience = normalizeStringArray(brandProductTruth?.audience, 6);
  const facts = normalizeStringArray(brandProductTruth?.facts, 8);
  const lifeMoments = normalizeStringArray(customerOutcome?.lifeMoments, 6);

  const productType = String(brandProductTruth?.productType || "").toLowerCase();
  const businessName = String(profile?.businessProfile?.name || "").toLowerCase();
  const suggestedCategory = String(contentProfile?.suggestedCategory || "").toLowerCase();

  const productSignalText = [
    productType,
    businessName,
    suggestedCategory,
    offers.join(" "),
    audience.join(" "),
    facts.join(" "),
    recommendedFocus
  ].join(" ").toLowerCase();

  const ecommerceProductSignal =
    /shop|store|skincare|skin|beauty|cosmetic|cream|serum|cleanser|mask|oil|ingredient|ingredients|product|products|range|collection|collections|kids|body|routine|ecommerce|e-commerce|cart|checkout/.test(
      productSignalText
    );

  const serviceBusinessSignal =
    /plumbing|plumber|electrical|electrician|air conditioning|construction|builder|building|repair|maintenance|installation|service|services|tradie|trade/.test(
      productSignalText
    );

  const productHeavySignal =
    ecommerceProductSignal && !serviceBusinessSignal;

  const scoreBreakdown = [];
  let score = 0;

  const weakVoice = Boolean(sourceProfile?.weakVoiceSource);
  const lowTrust = trustSignals.length === 0;
  const lowEducation = educationSignals.length === 0;
  const lowActivity = activitySignals.length === 0;
  const lowFounderVisibility =
    founderVisibilitySignals.some((s) => /limited/i.test(s)) ||
    founderVisibilitySignals.length === 0 ||
    weakVoice;

  const unclearOffer = offers.length === 0;
  const hasAudience = audience.length > 0;
  const hasLifeMoment = lifeMoments.length > 0;
  const hasTrust = trustSignals.length > 0;
  const hasEducation = educationSignals.length > 0;
  const hasActivity = activitySignals.length > 0;

  function add(points, reason) {
    score += points;
    scoreBreakdown.push({ points, reason });
  }

  switch (strategy.key) {
    case "trust_build":
      if (lowTrust) add(30, "Trust signal is weak or missing.");
      if (/trust/.test(founderGoal)) add(30, "Founder goal is trust-related.");
      if (recommendedFocus.includes("credible") || recommendedFocus.includes("proof") || recommendedFocus.includes("standards")) {
        add(20, "Recommended focus points toward trust, proof, or standards.");
      }
      if (offers.length > 0) add(8, "There is enough offer clarity to support trust-building content.");
      if (hasAudience) add(6, "Audience signal exists, so trust-building has a target.");
      break;

    case "visibility_push":
      if (lowActivity) add(26, "Public activity signal is weak.");
      if (/posting consistency/.test(founderGoal)) add(30, "Founder goal is posting consistency.");
      if (recommendedFocus.includes("repeatable") || recommendedFocus.includes("public") || recommendedFocus.includes("visible")) {
        add(20, "Recommended focus suggests stronger public visibility is needed.");
      }
      if (hasAudience) add(10, "Audience signal exists for visibility work.");
      if (hasLifeMoment) add(8, "There are enough real-life angles to support consistent posting.");
      break;

    case "founder_presence_campaign":
      if (lowFounderVisibility) add(32, "Founder visibility is weak.");
      if (/founder presence/.test(founderGoal)) add(34, "Founder goal is founder presence.");
      if (/clarify brand voice/.test(founderGoal)) add(16, "Founder voice clarity often needs stronger founder presence.");
      if (recommendedFocus.includes("founder") || recommendedFocus.includes("human")) {
        add(18, "Recommended focus points toward founder-led signal.");
      }
      break;

    case "education_authority_series":
      if (hasEducation) add(28, "Education signal already exists.");
      if (/educational/.test(founderGoal)) add(32, "Founder goal is educational content.");
      if (recommendedFocus.includes("educational") || recommendedFocus.includes("teaching") || recommendedFocus.includes("knowledge")) {
        add(18, "Recommended focus points toward education.");
      }
      if (hasTrust) add(8, "Trust signal can support authority-building.");
      break;

    case "offer_clarification_run":
      if (unclearOffer) add(34, "Offer clarity is weak.");
      if (/promote products or services/.test(founderGoal)) add(30, "Founder goal is offer promotion.");
      if (recommendedFocus.includes("offer") || recommendedFocus.includes("value") || recommendedFocus.includes("understand")) {
        add(18, "Recommended focus points toward offer clarity.");
      }
      if (hasLifeMoment) add(10, "Real-life use moments can make offer clarification stronger.");
      break;

    case "product_truth_system":
      if (!productHeavySignal) break;
      add(50, "Strong ecommerce or product-brand signal is present.");
      if (offers.length >= 2) add(18, "There is enough product or offer signal to build product-truth content.");
      if (facts.length >= 2) add(14, "Product facts can support clearer product-truth messaging.");
      if (hasAudience) add(12, "Audience signal exists for product positioning.");
      if (hasLifeMoment) add(12, "Real-life use moments support product-truth messaging.");
      if (hasEducation) add(10, "Education signal can explain product value more clearly.");
      if (hasTrust) add(8, "Trust signal can support product proof.");
      if (/product|quality|standard|ingredient|skincare|routine/.test(recommendedFocus)) {
        add(18, "Recommended focus supports product truth, value, or standards.");
      }
      break;

    case "reactivation_sequence":
      if (hasAudience) add(14, "There is at least some audience to reactivate.");
      if (hasTrust) add(8, "Trust signal supports warm reactivation.");
      if (hasActivity === false) add(10, "Low activity can make reactivation useful.");
      break;

    case "community_penetration_play":
      if (hasAudience) add(16, "There is audience signal for community positioning.");
      if (hasLifeMoment) add(14, "Real-life relevance supports community entry.");
      if (hasActivity) add(12, "Existing activity supports deeper community work.");
      if (recommendedFocus.includes("public") || recommendedFocus.includes("audience")) {
        add(12, "Recommended focus supports broader community presence.");
      }
      break;

    case "referral_reciprocity_loop":
      if (hasTrust) add(18, "Trust signal supports reciprocity and referral.");
      if (hasAudience) add(12, "Audience signal gives referral logic somewhere to travel.");
      if (hasLifeMoment) add(10, "Real-world usefulness supports word of mouth.");
      break;

    case "proof_harvest_campaign":
      if (lowTrust) add(24, "Proof signal is too thin.");
      if (offers.length > 0) add(12, "The business has something clear enough to gather proof around.");
      if (recommendedFocus.includes("proof") || recommendedFocus.includes("trust") || recommendedFocus.includes("credible")) {
        add(18, "Recommended focus points toward proof collection.");
      }
      break;

    case "partnership_outreach_pack":
      if (hasAudience) add(10, "Audience signal supports partnership targeting.");
      if (hasActivity) add(14, "Activity signal suggests collaboration potential.");
      if (hasTrust) add(10, "Trust signal helps partnership readiness.");
      if (recommendedFocus.includes("public") || recommendedFocus.includes("activity")) {
        add(10, "Recommended focus suggests outward-facing growth.");
      }
      break;

    default:
      break;
  }

  return {
    key: strategy.key,
    name: strategy.name,
    objective: strategy.objective,
    triggers: strategy.triggers || [],
    primaryOutputs: strategy.primaryOutputs || [],
    score,
    scoreBreakdown
  };
}

function buildStrategyEngine(profile = {}) {
  const catalog = getStrategyCatalog();
  const scored = catalog
    .map((strategy) => scoreStrategy(strategy, profile))
    .sort((a, b) => b.score - a.score);

  const primary = scored[0] || null;
  const supporting = scored.slice(1, 3);

  return {
    primaryStrategy: primary,
    supportingStrategies: supporting,
    rankedStrategies: scored
  };
}
async function buildBusinessProfile(input = {}) {
  const {
    mode,
    businessUrl,
    pastedSourceText,
    manualBusinessContext,
    founderGoal,
    ownerWritingSample,
  } = input;

  let laneGather = null;
  const normalizedUrl = normalizeUrl(businessUrl);

  if (normalizedUrl) {
    laneGather = await gatherLaneSources(normalizedUrl);
  }

  const founderText = laneText(
    laneGather?.lanes?.founderVoice || [],
    manualBusinessContext || pastedSourceText || ownerWritingSample || ""
  );

  const customerText = laneText(
    laneGather?.lanes?.customerOutcome || [],
    ""
  );

  const productText = laneText(
    laneGather?.lanes?.brandProductTruth || [],
    ""
  );

  const founderSourceInput = clipText(
    mode === "manual"
      ? manualBusinessContext || pastedSourceText || ownerWritingSample
      : mode === "hybrid"
      ? pastedSourceText || manualBusinessContext || ownerWritingSample || founderText
      : founderText || pastedSourceText || manualBusinessContext || ownerWritingSample || productText,
    5000
  );

  const [sourceProfile, customerOutcome, brandProductTruth] = await Promise.all([
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
    runJsonChat(
      customerOutcomePrompt(
        clipText(customerText || pastedSourceText || "", 3000)
      )
    ),
    runJsonChat(
      productTruthPrompt(
        clipText(productText || founderText || pastedSourceText || "", 3000)
      )
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
    voiceAgentPrompt(
      clipText(safeVoiceSourceText || founderSourceInput || "", 5000)
    )
  );

  const finalBusinessName =
    sourceProfile?.businessProfile?.name ||
    brandProductTruth?.productType ||
    "Unknown Business";

  const socialLinks = laneGather?.socialLinks || {};
  const groupedPages = laneGather?.groupedPages || {
    aboutPages: [],
    blogPages: [],
    faqPages: [],
    reviewPages: [],
    activityPages: [],
    pressPages: [],
    productPages: [],
  };

  const discoveryProfile = {
    channelsFound: socialLinks,
    sourcePages: groupedPages,
    locationContext: laneGather?.locationContext || {
      country: "",
      state: "",
      city: "",
      environmentType: "real working environment",
      combinedText: "",
    },
    visualIdentity: laneGather?.visualIdentity || {
      tone: "grounded, real, business-appropriate",
      palette: "natural business-appropriate colours",
      environment: "real working environments",
      brandingStyle: "unbranded, practical, context-led",
    },
    trustSignals: inferTrustSignals({
      groupedPages,
      lanes: laneGather?.lanes || {},
      pages: laneGather?.pages || [],
    }),
    educationSignals: inferEducationSignals({
      groupedPages,
      lanes: laneGather?.lanes || {},
      pages: laneGather?.pages || [],
    }),
    activitySignals: inferActivitySignals({
      groupedPages,
      pages: laneGather?.pages || [],
    }),
    founderVisibilitySignals: inferFounderVisibilitySignals({
      groupedPages,
      founderText,
      pages: laneGather?.pages || [],
    }),
    sourceConfidence: inferSourceConfidence({
      channelsFound: socialLinks,
      groupedPages,
      pagesScanned: laneGather?.pages?.length || 0,
      hasOwnerWriting: Boolean(
        ownerWritingSample || manualBusinessContext || pastedSourceText
      ),
    }),
  };

  const profile = {
    founderGoal: founderGoal || "",
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
    discoveryProfile,
    ownerKbMeta: getBusinessKbMeta(finalBusinessName),
    debug: {
      pagesScanned: laneGather?.pages?.length || 0,
    },
  };

  profile.advisorSnapshot = inferAdvisorSnapshot({
    founderGoal,
    founderVoice: profile.founderVoice,
    brandProductTruth: profile.brandProductTruth,
    customerOutcome: profile.customerOutcome,
    sourceProfile: profile.sourceProfile,
    discoveryProfile: profile.discoveryProfile,
    contentProfile: profile.contentProfile,
  });

  profile.intelligenceRead = buildIntelligenceRead({
    advisorSnapshot: profile.advisorSnapshot,
    discoveryProfile: profile.discoveryProfile,
  });

  profile.groupedSnapshot = buildGroupedSnapshot({
    founderGoal,
    initialProfile: profile,
    hasOwnerWriting: Boolean(
      ownerWritingSample || manualBusinessContext || pastedSourceText
    ),
  });

    profile.evidenceProfile = buildEvidenceProfile(profile);
  profile.ubdgEvidencePacket = buildUbdgEvidencePacketForProfile(profile);
  profile.qualificationProfile = buildQualificationProfile(
    profile.evidenceProfile,
    profile
  );
    profile.readinessProfile = buildReadinessProfile(profile);
  profile.sourceImprovementGuidance = buildSourceImprovementGuidance(profile);

  profile.strategyEngine = buildStrategyEngine(profile);
  profile.brandIntelligence = buildBrandIntelligence(profile);
  profile.chosenMove = buildChosenMove(profile);
  profile.executionPlan = buildExecutionPlan(profile);
  profile.multiAgentSystem = buildMultiAgentSystem(profile);

  return profile;
}


function runAgentCycleForProfile(profile = {}) {
  if (!profile || typeof profile !== "object") {
    throw new Error("profile is required.");
  }

  const refreshedProfile = {
    ...profile,
  };

    refreshedProfile.evidenceProfile = buildEvidenceProfile(refreshedProfile);
  refreshedProfile.ubdgEvidencePacket = buildUbdgEvidencePacketForProfile(refreshedProfile);
  refreshedProfile.qualificationProfile = buildQualificationProfile(
    refreshedProfile.evidenceProfile,
    refreshedProfile
  );
    refreshedProfile.readinessProfile = buildReadinessProfile(refreshedProfile);
  refreshedProfile.sourceImprovementGuidance =
    buildSourceImprovementGuidance(refreshedProfile);
  refreshedProfile.strategyEngine = buildStrategyEngine(refreshedProfile);
  refreshedProfile.brandIntelligence = buildBrandIntelligence(refreshedProfile);
  refreshedProfile.chosenMove = buildChosenMove(refreshedProfile);

  refreshedProfile.executionPlan = buildExecutionPlan(refreshedProfile);
  refreshedProfile.multiAgentSystem = buildMultiAgentSystem(refreshedProfile);

  const strategist = refreshedProfile.multiAgentSystem?.strategist || {};
  const operator = refreshedProfile.multiAgentSystem?.operator || {};
  const analyst = refreshedProfile.multiAgentSystem?.analyst || {};

  const runLog = createAgentRunLog({
    businessName: refreshedProfile?.businessProfile?.name,
    strategist,
    operator,
    analyst,
    executionPlan: refreshedProfile.executionPlan,
  });

  return {
    ok: true,
    profile: refreshedProfile,
    runLog,
  };
}

app.post("/build-profile", async (req, res) => {
  try {
    const profile = await buildBusinessProfile(req.body || {});

    return res.json({
      profile,
      sourceImprovementGuidance: profile.sourceImprovementGuidance || null,
    });
  } catch (err) {
    console.error("BUILD PROFILE ERROR:", err);
    res.status(500).json({
      error: err.message || "Failed to build profile.",
    });
  }
});


app.post("/run-agent-cycle", async (req, res) => {
  try {
    const { profile } = req.body || {};
    const result = runAgentCycleForProfile(profile);

    return res.json({
      ...result,
      sourceImprovementGuidance:
        result?.profile?.sourceImprovementGuidance || null,
    });
  } catch (err) {
    console.error("RUN AGENT CYCLE ERROR:", err);
    res.status(500).json({
      error: err.message || "Failed to run agent cycle.",
    });
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

function getHashtags(category, idea, businessName, initialProfile, postText) {
  const cleanName = String(businessName || "Brand")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim();

  const normalizedName = cleanName.toLowerCase();
  const lowerIdea = String(idea || "").toLowerCase();
  const lowerPost = String(postText || "").toLowerCase();

  const brandTag =
    "#" +
    (cleanName
      ? cleanName
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join("")
      : "YourBrand");

  function toTag(text, fallback = "BrandContent") {
    const cleaned = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");

    return `#${cleaned || fallback}`;
  }

  const offers = normalizeStringArray(initialProfile?.brandProductTruth?.offers, 6)
    .join(" ")
    .toLowerCase();

  const audience = normalizeStringArray(initialProfile?.brandProductTruth?.audience, 6)
    .join(" ")
    .toLowerCase();

  const trustSignals = normalizeStringArray(initialProfile?.discoveryProfile?.trustSignals, 6)
    .join(" ")
    .toLowerCase();

  const educationSignals = normalizeStringArray(initialProfile?.discoveryProfile?.educationSignals, 6)
    .join(" ")
    .toLowerCase();

  const recommendedFocus = String(
    initialProfile?.groupedSnapshot?.recommendedFocus ||
    initialProfile?.advisorSnapshot?.recommendedFocus ||
    ""
  ).toLowerCase();

  const nicheSource = [
    normalizedName,
    lowerIdea,
    offers,
    audience,
    trustSignals,
    educationSignals,
    recommendedFocus,
  ].join(" ");

  function detectNicheTag() {
    if (/matcha|green tea|uji|tea|ceremonial grade/.test(nicheSource)) return "#Matcha";
    if (/coffee|cafe|espresso/.test(nicheSource)) return "#Coffee";
    if (/skincare|skin|facial|cosmetic|beauty|injectable/.test(nicheSource)) return "#Skincare";
    if (/gym|fitness|training|coach|pt|sport/.test(nicheSource)) return "#Fitness";
    if (/volleyball/.test(nicheSource)) return "#Volleyball";
    if (/football|soccer/.test(nicheSource)) return "#Football";
    if (/clothing|fashion|apparel|wear|streetwear/.test(nicheSource)) return "#Apparel";
    if (/electrical|cable|manufacturing|factory/.test(nicheSource)) return "#Manufacturing";
    if (/marketing|brand|content|social media|audience|messaging/.test(nicheSource)) return "#BrandStrategy";
    if (/clinic|treatment|injectable|cosmetic nurse|aesthetic/.test(nicheSource)) return "#Aesthetics";

    return "#SmallBusiness";
  }

  function detectPlanTag() {
    const planSource = `${lowerIdea} ${recommendedFocus}`;

    if (/trust|proof|credible|credibility/.test(planSource)) return "#BuildTrust";
    if (/quality|standard|care|craft|process/.test(planSource)) return "#QualityMatters";
    if (/routine|ritual|daily use|daily practice/.test(planSource)) return "#DailyRitual";
    if (/founder|voice|presence|identity/.test(planSource)) return "#FounderLed";
    if (/education|learn|understand|explain/.test(planSource)) return "#LearnMore";
    if (/offer|service|product|real[- ]life value|real life/.test(planSource)) return "#RealLifeUse";
    if (/consistency|repeatable|weekly/.test(planSource)) return "#Consistency";
    if (/clarity|clarify|clear/.test(planSource)) return "#BrandClarity";

    const map = {
      "Daily Relief": "#DailyRelief",
      "Everyday Ritual": "#DailyRitual",
      "Founder Reflection": "#FounderLed",
      "Product in Real Life": "#RealLifeUse",
      "Quiet Value": "#EverydayValue",
      "Standards and Care": "#QualityMatters",
      "Busy Day Ease": "#BusyDaySupport",
      "Small Moment Real Value": "#DailyMoments",
      "Something Real": "#RealTalk",
    };

    return map[category] || "#BrandStrategy";
  }

  function detectPostTag() {
    if (/morning|woke up|start the day|before the laptop|before work/.test(lowerPost)) return "#MorningRoutine";
    if (/focus|clarity|clear head|clearer|direction|uncertainty into control/.test(lowerPost)) return "#ClearFocus";
    if (/energy|steady energy|without the crash|no crash/.test(lowerPost)) return "#SteadyEnergy";
    if (/stress|pressure|chaos|rush|overwhelmed|deadlines|emails|frustration/.test(lowerPost)) return "#StressSupport";
    if (/authentic|real|truth|something authentic/.test(lowerPost)) return "#AuthenticChoice";
    if (/routine|ritual|daily|every day|habits|patterns|workflow/.test(lowerPost)) return "#DailyRitual";
    if (/quality|standard|care|craft|process|old methods|century-old|discipline/.test(lowerPost)) return "#QualityMatters";
    if (/uji|kyoto|sourced|source|grown|ground|harvested/.test(lowerPost)) return "#SourceMatters";
    if (/nutrition|whole leaf|powdered leaf|results you can feel/.test(lowerPost)) return "#WholeLeaf";
    if (/founder|i insist|i look at|i reach for/.test(lowerPost)) return "#FounderStory";

    if (/accountability|follow through|follow-through|check-in|check in/.test(lowerPost)) return "#Accountability";
    if (/strategy|strategic|plan|planning|action plan|priorities/.test(lowerPost)) return "#GrowthStrategy";
    if (/lead|leadership|teams|manage their teams|team alignment/.test(lowerPost)) return "#LeadershipClarity";
    if (/business owner|owners|entrepreneur|entrepreneurs|small business/.test(lowerPost)) return "#BusinessCoaching";
    if (/teach|teaching|learn|understand|explain|framework/.test(lowerPost)) return "#LearnBusiness";
    if (/confidence|confident|certainty|control/.test(lowerPost)) return "#BusinessConfidence";

    if (/#matcha/i.test(detectNicheTag())) return "#DailyRitual";
    if (/#skincare|#aesthetics/i.test(detectNicheTag())) return "#ClientCare";
    if (/#fitness/i.test(detectNicheTag())) return "#TrainingProgress";
    if (/#volleyball|#football/i.test(detectNicheTag())) return "#Performance";
    if (/#brandstrategy/i.test(detectNicheTag())) return "#ClearMessaging";

    return "#RealLifeUse";
  }

  return `${brandTag} ${detectPlanTag()} ${detectPostTag()}`;
}
function detectNarrativeLane(post = "") {
  const lower = String(post || "").toLowerCase();

  if (
    /kyoto|honeymoon|first tried|first taste|first sip|first cup|café|cafe|remember standing|that day/i.test(lower)
  ) {
    return "founder_origin_memory";
  }

  if (
    /most mornings|this morning|woke up|first thing|kitchen|whisk|froth|pause before the first sip|morning habit|daily ritual|routine/i.test(lower)
  ) {
    return "daily_ritual_moment";
  }

  if (
    /uji|farmers|shaded|shade-grown|shade grown|stone-ground|stone ground|soil|mist|terrain|harvest|steaming|air-drying|air drying|tencha|traditional farming|origin/i.test(lower)
  ) {
    return "origin_method_proof";
  }

  if (
    /energy|jitters|crash|caffeine|focus|clear focus|steady energy|slow-release|slow release/i.test(lower)
  ) {
    return "functional_benefit";
  }

  if (
    /why we source|we decided|we insist|we don.?t blend|don.?t cut corners|sourcing matters|our standard|the defining factor/i.test(lower)
  ) {
    return "founder_standard";
  }

  if (
    /history|centuries|heritage|tradition|passed down generations|practice|ceremony/i.test(lower)
  ) {
    return "cultural_context";
  }

  return "general_value";
}

function detectProofType(post = "") {
  const lower = String(post || "").toLowerCase();

  if (
    /i remember|honeymoon|first tried|first sip|that day|i noticed|i found myself|woke up|this morning/i.test(lower)
  ) {
    return "personal_experience";
  }

  if (
    /uji|farmers|shaded|shade-grown|stone-ground|stone ground|soil|mist|terrain|harvest|steaming|air-drying|air drying|tencha/i.test(lower)
  ) {
    return "production_origin_detail";
  }

  if (
    /whole leaf|nutrients|caffeine|jitters|crash|slow-release|slow release|antioxidants|health benefits|energy/i.test(lower)
  ) {
    return "functional_explanation";
  }

  if (
    /we insist|we make sure|we don.?t blend|we don.?t cut corners|we compare every harvest|we settled on|we decided early/i.test(lower)
  ) {
    return "founder_standard";
  }

  if (
    /history|heritage|centuries|passed down generations|tradition/i.test(lower)
  ) {
    return "historical_context";
  }

  return "general_support";
}

function validateNarrativeDiversity(posts = []) {
  const cleanPosts = Array.isArray(posts)
    ? posts.map((post) => String(post || "").trim()).filter(Boolean)
    : [];

  const narrativeLanes = cleanPosts.map(detectNarrativeLane);
  const proofTypes = cleanPosts.map(detectProofType);

  const laneCounts = {};
  const proofCounts = {};

  for (const lane of narrativeLanes) {
    laneCounts[lane] = (laneCounts[lane] || 0) + 1;
  }

  for (const proof of proofTypes) {
    proofCounts[proof] = (proofCounts[proof] || 0) + 1;
  }

  const repeatedNarrativeLane = Object.values(laneCounts).some((count) => count >= 3);
  const repeatedProofType = Object.values(proofCounts).some((count) => count >= 3);

  const failedReasons = [];

  if (repeatedNarrativeLane) {
    failedReasons.push("All posts are collapsing into the same narrative lane.");
  }

  if (repeatedProofType) {
    failedReasons.push("All posts are relying on the same proof type.");
  }

  return {
    isValid: failedReasons.length === 0,
    failedReasons,
    narrativeLanes,
    proofTypes,
  };
}

function validateAgainstRecentNarrativeHistory(posts = [], recentChosenPosts = []) {
  const cleanPosts = Array.isArray(posts)
    ? posts.map((post) => String(post || "").trim()).filter(Boolean)
    : [];

  const cleanRecentPosts = Array.isArray(recentChosenPosts)
    ? recentChosenPosts.map((post) => String(post || "").trim()).filter(Boolean)
    : [];

  if (cleanPosts.length === 0 || cleanRecentPosts.length === 0) {
    return {
      isValid: true,
      failedReasons: [],
      repeatedNarrativeLanes: [],
      repeatedProofTypes: [],
    };
  }

  const currentNarrativeLanes = cleanPosts.map(detectNarrativeLane).filter(Boolean);
  const currentProofTypes = cleanPosts.map(detectProofType).filter(Boolean);

  const recentNarrativeLanes = cleanRecentPosts.map(detectNarrativeLane).filter(Boolean);
  const recentProofTypes = cleanRecentPosts.map(detectProofType).filter(Boolean);

  const repeatedNarrativeLanes = uniqueStrings(
    currentNarrativeLanes.filter((lane) => recentNarrativeLanes.includes(lane)),
    6
  );

  const repeatedProofTypes = uniqueStrings(
    currentProofTypes.filter((proof) => recentProofTypes.includes(proof)),
    6
  );

  const narrativeOverlapCount = repeatedNarrativeLanes.length;
  const proofOverlapCount = repeatedProofTypes.length;

  const failedReasons = [];

  if (narrativeOverlapCount >= 2) {
    failedReasons.push("Too much overlap with recent narrative lanes.");
  }

  if (proofOverlapCount >= 2) {
    failedReasons.push("Too much overlap with recent proof types.");
  }

  return {
    isValid: failedReasons.length === 0,
    failedReasons,
    repeatedNarrativeLanes,
    repeatedProofTypes,
  };
}

function getRecentChosenPostsForBusiness(businessName = "", limit = 6) {
  const kb = readOwnerKb();
  const key = businessKey(businessName);
  const business = kb.businesses[key];

  if (!business || !Array.isArray(business.entries)) return [];

  return business.entries
    .slice(-limit)
    .map((entry) => String(entry?.chosenPost || "").trim())
    .filter(Boolean);
}

function normalizeOpeningSignature(text = "") {
  return getFirstSentence(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

function validateAgainstRecentPostHistory(posts = [], recentChosenPosts = []) {
  const cleanPosts = Array.isArray(posts)
    ? posts.map((post) => String(post || "").trim()).filter(Boolean)
    : [];

  const cleanRecentPosts = Array.isArray(recentChosenPosts)
    ? recentChosenPosts.map((post) => String(post || "").trim()).filter(Boolean)
    : [];

  if (cleanPosts.length === 0 || cleanRecentPosts.length === 0) {
    return {
      isValid: true,
      failedReasons: [],
      repeatedExactSignatures: [],
      repeatedOpeningStyles: [],
    };
  }

  const currentSignatures = cleanPosts.map(normalizeOpeningSignature).filter(Boolean);
  const recentSignatures = cleanRecentPosts.map(normalizeOpeningSignature).filter(Boolean);

  const currentStyles = cleanPosts.map(detectOpeningStyle).filter(Boolean);
  const recentStyles = cleanRecentPosts.map(detectOpeningStyle).filter(Boolean);

  const repeatedExactSignatures = uniqueStrings(
    currentSignatures.filter((signature) => recentSignatures.includes(signature)),
    6
  );

  const repeatedOpeningStyles = uniqueStrings(
    currentStyles.filter((style) => recentStyles.includes(style)),
    6
  );

  const failedReasons = [];

  if (repeatedExactSignatures.length > 0) {
    failedReasons.push("Recent exact opener signature reused.");
  }

  if (repeatedOpeningStyles.length >= 2) {
    failedReasons.push("Too much overlap with recent opener style history.");
  }

  return {
    isValid: failedReasons.length === 0,
    failedReasons,
    repeatedExactSignatures,
    repeatedOpeningStyles,
  };
}

async function generatePostsWithHistoryGuard(
  promptBase,
  category,
  recentChosenPosts = []
) {
  let posts = await generatePostsWithRetry(promptBase, category);

  if (!recentChosenPosts.length) {
    return posts;
  }

  const openerHistoryCheck = validateAgainstRecentPostHistory(posts, recentChosenPosts);
  const narrativeHistoryCheck = validateAgainstRecentNarrativeHistory(posts, recentChosenPosts);

  if (openerHistoryCheck.isValid && narrativeHistoryCheck.isValid) {
    return posts;
  }

  const blockedSignatures = uniqueStrings(
    recentChosenPosts.map(normalizeOpeningSignature).filter(Boolean),
    6
  );

  const blockedStyles = uniqueStrings(
    recentChosenPosts.map(detectOpeningStyle).filter(Boolean),
    6
  );

  const blockedNarrativeLanes = uniqueStrings(
    recentChosenPosts.map(detectNarrativeLane).filter(Boolean),
    6
  );

  const blockedProofTypes = uniqueStrings(
    recentChosenPosts.map(detectProofType).filter(Boolean),
    6
  );

  const historyRetryBlock = `
RECENT POST HISTORY GUARD:
The batch is too close to recent approved posts for this business.

FAILED FOR:
- ${[...openerHistoryCheck.failedReasons, ...narrativeHistoryCheck.failedReasons].join("\n- ")}

RECENT OPENING STYLES TO AVOID OVERUSING:
- ${blockedStyles.join("\n- ") || "none"}

RECENT OPENER SIGNATURES TO AVOID:
- ${blockedSignatures.join("\n- ") || "none"}

RECENT NARRATIVE LANES TO AVOID OVERUSING:
- ${blockedNarrativeLanes.join("\n- ") || "none"}

RECENT PROOF TYPES TO AVOID OVERUSING:
- ${blockedProofTypes.join("\n- ") || "none"}

STRICT CORRECTION:
- do not reuse those recent opener signatures
- do not overuse those recent opener-style families
- do not overuse those recent narrative lanes
- do not rely on the same proof type across the new batch
- keep owner identity, but change the entry angle
- use fresher first-sentence shape, fresher framing, fresher proof, and fresher thought path
- do not paraphrase the same beginning or same idea path with minor word swaps
`.trim();

  posts = await generatePostsWithRetry(`${promptBase}\n\n${historyRetryBlock}`, category);
  return posts;
}

app.get("/ubdg/self-test", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found." });
  }

  try {
    const packet = await runUbdgEvidenceHelperSelfTest();

    res.json({
      ok: true,
      test: "ubdg_evidence_helper_self_test",
      packet,
    });
  } catch (err) {
    console.error("UBDG SELF TEST ROUTE ERROR:", err);

    res.status(500).json({
      ok: false,
      error: err?.message || "Unknown UBDG self-test error.",
    });
  }
});

app.post("/phase3/run-regression", async (req, res) => {
  const startedAt = new Date().toISOString();

  try {
    const matrix = readPhase3TestMatrix();
    const runnableSites = getRunnablePhase3Sites(matrix);

    const requestedLimit = Number(req.body?.limit || runnableSites.length);
    const safeLimit = clampInt(requestedLimit, 1, runnableSites.length || 1);
    const selectedSites = runnableSites.slice(0, safeLimit);

    if (selectedSites.length === 0) {
      return res.status(400).json({
        error:
          "No runnable Phase 3 regression sites found. Add businessUrl values to phase3-test-matrix.json first.",
        matrixPath: PHASE3_TEST_MATRIX_PATH,
        totalSites: Array.isArray(matrix?.sites) ? matrix.sites.length : 0,
        runnableSites: 0,
      });
    }

    const results = [];

    for (const site of selectedSites) {
      const result = await runSinglePhase3RegressionSite(
        site,
        matrix.defaults || {}
      );

      results.push(result);
    }

    const passedCount = results.filter((item) => item.passed).length;
    const failedCount = results.length - passedCount;

    res.json({
      ok: failedCount === 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      matrix: {
        name: matrix?.meta?.name || "YEVIB Phase 3 Intelligence Regression Matrix",
        version: matrix?.meta?.version || "",
        totalSites: Array.isArray(matrix?.sites) ? matrix.sites.length : 0,
        runnableSites: runnableSites.length,
        executedSites: results.length,
      },
      summary: {
        passed: passedCount,
        failed: failedCount,
      },
      results,
    });
  } catch (err) {
    console.error("PHASE 3 REGRESSION ROUTE ERROR:", err);

    res.status(500).json({
      error: err?.message || "Unknown Phase 3 regression route error.",
    });
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
    founderGoal,
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
      founderGoal,
    });

    const weakVoice = Boolean(initialProfile?.sourceProfile?.weakVoiceSource);
    const { lensTitle, lensRules } = getLensRules({
      quickType: quickType || idea || "",
      category,
      weakVoice,
    });

        const { feelingLabel, feelingRules } = getFeelingRules(ownerNudge || "");
    const postClass = classifyPostClass({
      founderGoal,
      category,
      quickType,
      idea,
      weeklyPosts,
    });
    const postType = classifyPostType({
      postClass,
      quickType,
      ownerNudge,
      category,
    });
    const postClassRules = getPostClassRules(postClass);
    const postTypeRules = getPostTypeRules(postType);
    const postEnforcementRules = getPostEnforcementRules(postClass, postType);
    const variationRules = getVariationRules(category);
    const intelligenceRead = initialProfile?.intelligenceRead || "";
    const recommendedFocus = initialProfile?.groupedSnapshot?.recommendedFocus || initialProfile?.advisorSnapshot?.recommendedFocus || "";
    const groupedSnapshot = initialProfile?.groupedSnapshot?.groups || [];
    const discoveryProfile = initialProfile?.discoveryProfile || {};

    const snapshotLines = groupedSnapshot
      .map((group) => `- ${group.title}: ${group.score}/${group.max} (${group.stateLabel})`)
      .join("\n");

    const discoveryLines = [
      ...(normalizeStringArray(discoveryProfile?.trustSignals, 4).map((x) => `- Trust signal: ${x}`)),
      ...(normalizeStringArray(discoveryProfile?.educationSignals, 4).map((x) => `- Education signal: ${x}`)),
      ...(normalizeStringArray(discoveryProfile?.activitySignals, 4).map((x) => `- Activity signal: ${x}`)),
      ...(normalizeStringArray(discoveryProfile?.founderVisibilitySignals, 4).map((x) => `- Founder visibility: ${x}`)),
    ].join("\n");

    const previousPosts = (initialProfile?.recentPosts || []).join("\n\n");

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

POST CLASS:
${postClass}

POST CLASS RULES:
${postClassRules}

POST TYPE:
${postType}

POST TYPE RULES:
${postTypeRules}

POST ENFORCEMENT RULES:
${postEnforcementRules}

${variationRules}

CURRENT FOUNDER GOAL:
${founderGoal || "Not provided"}

INTELLIGENCE READ:
${intelligenceRead || "Not available"}

RECOMMENDED FOCUS:
${recommendedFocus || "Not available"}

SNAPSHOT READ:
${snapshotLines || "Not available"}

DISCOVERY READ:
${discoveryLines || "Not available"}

LIFE FRAME:
${category}

IDEA:
${clipText(idea || "No idea provided", 300)}

WEEKLY SOURCE MATERIAL:
${clipText(weeklyPosts || "No weekly notes provided", 2000)}

RECENT POSTS TO AVOID COPYING:
${previousPosts || "No previous posts stored yet."}

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

ADVISOR RULE:
- Let the strongest current business opportunity influence the angle of the writing
- If the scan shows trust signal, standards signal, educational signal, founder signal, or daily-use signal, use that as leverage
- Do not force the post to mention the diagnosis directly
- Let the diagnosis shape the angle, not the wording

SNAPSHOT RULE:
- Use the strongest current group score as a clue for where the business already has momentum
- If Brand Core is strongest, lean more into founder-led clarity, identity, or belief
- If Market Signal is strongest, lean more into offer clarity, audience fit, trust, or real-life value
- If Optimization is strongest, lean more into the clearest business opportunity or next-step leverage
- If Source Mix is strongest, lean more into confidence, signal depth, or visible brand presence
- Use the weaker scores to avoid overclaiming what the business has not yet fully shown

DISCOVERY RULE:
- If trust signals are present, you can write with more confidence around standards, proof, or credibility
- If education signals are present, you can lean into useful explanation and teaching
- If activity signals are present, you can make the brand feel more current, active, and in-motion
- If founder visibility is weak, avoid overclaiming founder-led public presence and keep it more grounded

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
- hashtags must be useful: 1 brand tag, 1 niche/search tag, and 1 intent/use-case tag
- avoid abstract, vague, or non-searchable hashtags
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

ANTI-REPETITION RULE:
- Do not repeat or closely resemble any recent posts shown above
- Do not reuse the same opening pattern across outputs
- Do not fall back on familiar brand-script phrasing
- Each post should feel like it was written on a different day from a different real moment
- Vary sentence rhythm, opening angle, and internal structure
- Keep the same owner voice, but change the shape of expression


AVOID:
- generic motivation clichés
- "unlock your potential"
- "embrace the journey"
- "transform your life"
- empty hype
- obvious ad language
- repeated sentence structures across all 3 posts
- repeating the same opener structure across all 3 posts
- repeating opener structures used in recent past posts
- repeating the same narrative lane used in recent past posts
- repeating the same proof type used in recent past posts
- defaulting to phrases like "There’s a reason..."
- defaulting to phrases like "It’s not just..."
- defaulting to phrases like "This isn’t about..."
- review-style phrasing like "we've used them for years"
- praise framing like "would not go anywhere else"
- recommendation framing like "highly recommend"

${extraCategoryRule}

`;

const recentChosenPosts = getRecentChosenPostsForBusiness(finalBusinessName, 6);

let posts = await generatePostsWithHistoryGuard(
  prompt,
  category,
  recentChosenPosts
);

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
  return `${cleaned}\n${getHashtags(category, idea, finalBusinessName, initialProfile, cleaned)}`;
});

        res.json({
  text: finalPosts.join("\n\n\n"),
  postClass,
  postType,
});
  } catch (err) {
    console.error("GENERATE ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to generate posts." });
  }
});

app.post("/generate-image", async (req, res) => {
  const { imagePrompt, discoveryProfile } = req.body;
  const sceneType = classifySceneType(imagePrompt || "");

  try {
    const scenePlan = await buildImageScenePlan(imagePrompt || "", {
      ...(discoveryProfile || {}),
      sceneType,
    });

       const panelLines =
      scenePlan.panels.length === 4
        ? scenePlan.panels
            .map(
              (p) => `PANEL ${p.panel}:
ROLE: ${p.role}
SHOT TYPE: ${p.shotType || (p.panel === 1 ? "wide establishing shot" : p.panel === 2 ? "medium inspection shot" : p.panel === 3 ? "close process shot" : "medium outcome shot")}
LOCKED SUBJECT: ${p.lockedSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET SUBJECT: ${p.targetSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET ACTOR: ${p.targetActor || scenePlan.primaryActor || "the primary actor from the request"}
PROBLEM STATE OWNER: ${p.problemStateOwner || (p.panel === 4 ? "none" : scenePlan.problemStateSubject || scenePlan.primarySubject || "the primary subject from the request")}
RESOLVED STATE OWNER: ${p.resolvedStateOwner || (p.panel === 4 ? scenePlan.resolvedStateSubject || scenePlan.primarySubject || "the primary subject from the request" : "none")}
SERVICEABLE AREA: ${p.serviceableArea || scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}
PRIMARY FRAME OWNER: ${p.primaryFrameOwner || p.targetSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
ONLY OPERATIVE SURFACE: ${p.onlyOperativeSurface || "the one visible surface, part, or area of the target subject where the action is actually happening"}
ACTION ANCHOR: ${p.actionAnchor || "the visible physical point where the action is happening on a plausible serviceable area of the target subject"}
CONTACT POINT: ${p.contactPoint || "hands, tools, gaze, and body orientation must connect clearly to that same target subject and the same operative surface"}
SUBJECT INSTANCE LOCK: ${p.subjectInstanceLock || (scenePlan.sameSubjectInstanceAcrossPanels ? "this must be the exact same physical subject instance across the sequence, not a different but similar one" : "keep the primary subject stable unless the story explicitly changes it")}
ACTOR IDENTITY LOCK: ${p.actorIdentityLock || (scenePlan.sameActorIdentityAcrossPanels ? "this must be the exact same primary actor identity across the sequence unless the story explicitly changes it" : "keep actor identity stable unless the story explicitly changes it")}
SCENE PROXIMITY: ${p.sceneProximity || "all related subjects in the event must appear spatially connected and plausibly near each other, not separated into different locations"}
COMPONENT CONTINUITY: ${p.componentContinuity || "if a specific part or component appears in adjacent action panels, it must remain materially consistent in size, type, shape, and position"}
ENVIRONMENT CONTINUITY: ${p.environmentContinuity || (scenePlan.sameEnvironmentAcrossPanels ? "lighting, time-of-day, background setting, and spatial context must stay consistent across the sequence unless the story explicitly changes them" : "keep environment continuity unless the story explicitly changes it")}
${p.allowedSupportSubject ? `ALLOWED SUPPORT SUBJECT: ${p.allowedSupportSubject}\n` : scenePlan.supportSubjects?.length ? `ALLOWED SUPPORT SUBJECTS: ${scenePlan.supportSubjects.join(", ")}\n` : ""}MUST SHOW: ${p.mustShow || "the primary subject clearly as the main focus of the frame, with the action physically connected to it, not any supporting element"}
MUST NOT SHOW: ${p.mustNotShow || "a supporting object, background element, or secondary subject taking over as the main focus, mixed object identities, contradictory states, gestures/body positions disconnected from the target subject, a second working surface on a different subject, or work being performed on an implausible or invented access point"}
SCENE:
${p.scene}`
            )
            .join("\n\n")
        : `
PANEL 1:
ROLE: establishing
SHOT TYPE: wide establishing shot
LOCKED SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET ACTOR: ${scenePlan.primaryActor || "the primary actor from the request"}
PROBLEM STATE OWNER: ${scenePlan.problemStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
RESOLVED STATE OWNER: none
SERVICEABLE AREA: ${scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}
PRIMARY FRAME OWNER: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
ONLY OPERATIVE SURFACE: the one visible problem area on the same primary subject
ACTION ANCHOR: the visible location on the primary subject where the issue is happening
CONTACT POINT: the primary actor's attention, body position, or pointing must clearly relate to the same target subject
SUBJECT INSTANCE LOCK: ${scenePlan.sameSubjectInstanceAcrossPanels ? "this must be the exact same physical subject instance that appears in later panels, not another similar one" : "keep the primary subject stable unless explicitly changed"}
ACTOR IDENTITY LOCK: ${scenePlan.sameActorIdentityAcrossPanels ? "this must be the exact same primary actor identity that appears in later panels, not another similar one" : "keep actor identity stable unless explicitly changed"}
SCENE PROXIMITY: the support context, primary actor, and target subject must appear as part of one connected event, close enough to read as the same active job
COMPONENT CONTINUITY: if the problem component is implied here, it must match the component later inspected and repaired
ENVIRONMENT CONTINUITY: ${scenePlan.sameEnvironmentAcrossPanels ? "time-of-day, road context, and lighting must match the rest of the sequence unless the story explicitly changes" : "keep time, place, and lighting stable unless explicitly changed"}
${scenePlan.supportSubjects?.length ? `ALLOWED SUPPORT SUBJECTS: ${scenePlan.supportSubjects.join(", ")}\n` : ""}MUST SHOW: the primary subject clearly in the real-world environment where the problem happens, with the problem state readable at first glance
MUST NOT SHOW: fault symbols, warning lights, or problem signals on the wrong subject, a primary actor inspecting empty space, a second subject visually competing as the main problem source, or a target subject that changes identity in later panels
SCENE:
Establish the main situation, environment, or source described in the request.

PANEL 2:
ROLE: inspection
SHOT TYPE: medium inspection shot
LOCKED SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET ACTOR: ${scenePlan.primaryActor || "the primary actor from the request"}
PROBLEM STATE OWNER: ${scenePlan.problemStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
RESOLVED STATE OWNER: none
SERVICEABLE AREA: ${scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}
PRIMARY FRAME OWNER: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
ONLY OPERATIVE SURFACE: the one exact inspection area on the same target subject
ACTION ANCHOR: the exact inspection point on a plausible serviceable area of the same target subject
CONTACT POINT: hands, tools, gaze, and body orientation must visibly connect to the inspection point on the same subject and not to any second subject
SUBJECT INSTANCE LOCK: ${scenePlan.sameSubjectInstanceAcrossPanels ? "this must be the exact same physical subject instance from panel 1, not a different but similar one" : "keep the primary subject stable unless explicitly changed"}
ACTOR IDENTITY LOCK: ${scenePlan.sameActorIdentityAcrossPanels ? "this must be the exact same primary actor identity from panel 1, not a different but similar one" : "keep actor identity stable unless explicitly changed"}
SCENE PROXIMITY: support context may appear, but it must remain physically secondary and plausibly adjacent to the same job scene
COMPONENT CONTINUITY: the inspected component must match the repaired component in the next panel in size, type, form, and position
ENVIRONMENT CONTINUITY: ${scenePlan.sameEnvironmentAcrossPanels ? "the lighting and location must still feel like the same event, not a different place or time" : "keep lighting and location stable unless explicitly changed"}
${scenePlan.supportSubjects?.length ? `ALLOWED SUPPORT SUBJECTS: ${scenePlan.supportSubjects.join(", ")}\n` : ""}MUST SHOW: the exact working area of the same subject clearly in the foreground with visible physical interaction, and that same subject must be the closest and dominant object in the frame
MUST NOT SHOW: inspection focus drifting onto a support subject, the primary actor handling empty space, the target sitting behind while another foreground surface becomes the work area, two separate subjects sharing the action, or work being done on an implausible seam, hinge-like edge, or invented access point
SCENE:
Show preparation, inspection, or method focused on the same subject.

PANEL 3:
ROLE: process
SHOT TYPE: close process shot
LOCKED SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET SUBJECT: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET ACTOR: ${scenePlan.primaryActor || "the primary actor from the request"}
PROBLEM STATE OWNER: ${scenePlan.problemStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
RESOLVED STATE OWNER: none
SERVICEABLE AREA: ${scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}
PRIMARY FRAME OWNER: ${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
ONLY OPERATIVE SURFACE: the one exact repair area on the same target subject
ACTION ANCHOR: the key repair point on a plausible serviceable area of the same target subject
CONTACT POINT: the repair action must visibly connect to the repair point on the same target subject and not to any other surface or subject
SUBJECT INSTANCE LOCK: ${scenePlan.sameSubjectInstanceAcrossPanels ? "this must still be the exact same physical subject instance from panels 1 and 2" : "keep the primary subject stable unless explicitly changed"}
ACTOR IDENTITY LOCK: ${scenePlan.sameActorIdentityAcrossPanels ? "this must still be the exact same primary actor identity from panels 1 and 2" : "keep actor identity stable unless explicitly changed"}
SCENE PROXIMITY: the repair scene must still belong to the same job and same contextual event
COMPONENT CONTINUITY: the repaired component must remain materially consistent with the component shown in panel 2 in size, type, form, and placement
ENVIRONMENT CONTINUITY: ${scenePlan.sameEnvironmentAcrossPanels ? "lighting and scene context must continue the same event unless the story explicitly changes" : "keep lighting and scene context stable unless explicitly changed"}
${scenePlan.supportSubjects?.length ? `ALLOWED SUPPORT SUBJECTS: ${scenePlan.supportSubjects.join(", ")}\n` : ""}MUST SHOW: the key repair process on the same target subject in the foreground with real contact between primary actor, tool, and subject, and that subject must be the dominant and closest object in frame
MUST NOT SHOW: unrelated parts, contradictory fault signals, a different repair target, repair motions disconnected from the subject, the real target pushed into the background while another surface becomes the active work zone, or any foreground object being treated as the repair surface if it is not the target subject
SCENE:
Show the key process, intervention, or transformation focused on the same subject.

PANEL 4:
ROLE: outcome
SHOT TYPE: medium outcome shot
LOCKED SUBJECT: ${scenePlan.resolvedStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET SUBJECT: ${scenePlan.resolvedStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
TARGET ACTOR: ${scenePlan.primaryActor || "the primary actor from the request"}
PROBLEM STATE OWNER: none
RESOLVED STATE OWNER: ${scenePlan.resolvedStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
SERVICEABLE AREA: ${scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}
PRIMARY FRAME OWNER: ${scenePlan.resolvedStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}
ONLY OPERATIVE SURFACE: no active work surface, only the resolved final state of the same subject
ACTION ANCHOR: the resolved final state of the same subject
CONTACT POINT: if a person gestures or interacts, the face, eyes, hands, and posture must be anatomically normal and naturally open-eyed unless explicitly described otherwise
SUBJECT INSTANCE LOCK: ${scenePlan.sameSubjectInstanceAcrossPanels ? "this must still read as the exact same physical subject instance from earlier panels" : "keep the resolved subject stable unless explicitly changed"}
ACTOR IDENTITY LOCK: ${scenePlan.sameActorIdentityAcrossPanels ? "this must still be the exact same primary actor identity from earlier panels unless explicitly changed" : "keep actor identity stable unless explicitly changed"}
SCENE PROXIMITY: any people shown in the outcome must still belong to the same completed event
COMPONENT CONTINUITY: the resolved subject should still read as the same machine/object/product from earlier panels
ENVIRONMENT CONTINUITY: ${scenePlan.sameEnvironmentAcrossPanels ? "the final panel must still feel like the same place and time unless the story explicitly changes" : "keep the final environment stable unless explicitly changed"}
${scenePlan.supportSubjects?.length ? `ALLOWED SUPPORT SUBJECTS: ${scenePlan.supportSubjects.join(", ")}\n` : ""}MUST SHOW: the resolved state of the same subject after the work is complete, with normal human anatomy, open natural eyes, and a believable finished outcome
MUST NOT SHOW: active repair posture, leftover fault-state artifacts, distorted hands, fingers, anatomy, closed-eye handshake portraits, or any second subject acting like the true resolved subject
SCENE:
Show the outcome, result, lived use, or resolved state tied to the same subject.
`.trim();

    const continuityLines =
      scenePlan.continuityRules.length > 0
        ? scenePlan.continuityRules.map((rule) => `- ${rule}`).join("\n")
        : `- the primary subject must stay locked across all 4 panels
- the primary actor must stay locked across all 4 panels unless explicitly changed
- keep the visual world consistent across all 4 panels`;

    const forbiddenSwapLines =
      Array.isArray(scenePlan.forbiddenSwaps) && scenePlan.forbiddenSwaps.length > 0
        ? scenePlan.forbiddenSwaps.map((rule) => `- ${rule}`).join("\n")
        : `- do not replace the primary subject with a nearby support subject
- do not promote a support subject into the hero subject
- do not promote a secondary actor into the primary actor
- do not reinterpret the collage as a different product, machine, vehicle, service, or job
- do not drift into a visually similar but incorrect subject
- do not crop the main working area so tightly that it becomes unclear or partial`;

const hardenedPrompt = `
Create exactly one documentary-realistic 4-panel collage image.

ORIGINAL REQUEST:
${clipText(imagePrompt || "", 2200)}

GLOBAL SCENE:
${scenePlan.globalScene || "A single coherent real-world scene built from the request."}

PRIMARY SUBJECT:
${scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}

SUPPORT SUBJECTS:
${Array.isArray(scenePlan.supportSubjects) && scenePlan.supportSubjects.length > 0 ? scenePlan.supportSubjects.join(", ") : scenePlan.supportingSubject || "none"}

PROBLEM-STATE SUBJECT:
${scenePlan.problemStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}

RESOLVED-STATE SUBJECT:
${scenePlan.resolvedStateSubject || scenePlan.primarySubject || scenePlan.mainSubject || "the primary subject from the request"}

PRIMARY ACTOR:
${scenePlan.primaryActor || "the primary actor from the request"}

SECONDARY ACTORS:
${Array.isArray(scenePlan.secondaryActors) && scenePlan.secondaryActors.length > 0 ? scenePlan.secondaryActors.join(", ") : "none"}

SERVICEABLE AREA:
${scenePlan.serviceableArea || "the plausible serviceable area where hands-on work can realistically happen"}

CONTINUITY RULES:
${continuityLines}

FORBIDDEN SWAPS:
${forbiddenSwapLines}

${panelLines}

NON-NEGOTIABLE STRUCTURE RULES:
- create exactly 4 clearly distinct panels
- each panel must be visually different, but part of the same story
- do not return a single-scene image
- do not collapse all panels into the same shot
- panel-to-panel continuity must make sense

PANEL ROLE ENFORCEMENT:
- panel 1 must establish the situation
- panel 2 must show inspection, setup, or preparation (NOT outcome)
- panel 3 must show the main process or action (NOT setup or filler)
- panel 4 must show the outcome or resolved state (NOT revert backward)

UNIVERSAL SUBJECT-ROLE ENFORCEMENT:
- the primary subject must remain the hero subject in all panels unless the story explicitly changes it
- support subjects may appear but must remain secondary and must never replace the primary subject
- the primary actor must remain the main action owner in all panels unless the story explicitly changes it
- secondary actors may appear but must remain secondary and must never replace the primary actor
- the problem state must belong only to the problem-state subject
- the resolved state must belong only to the resolved-state subject
- if hands-on work is shown, it must happen on a plausible serviceable area of the target subject
- each panel may contain support context, but only one true operative subject may own the action
- the subject being touched, inspected, repaired, or resolved must be the same subject that visually owns the frame

NON-NEGOTIABLE FRAMING RULES:
- each panel must frame its target subject clearly and readably at first glance
- if a panel shows inspection, setup, or repair, the full working area must be clearly visible in frame
- do not crop the operative surface so tightly that it becomes partial, unclear, or secondary
- do not let background subjects, nearby tools, or support objects dominate the frame over the target subject
- use framing that makes the intended action obvious without needing text
- do not allow a foreground surface on one subject while the real target sits in the background
- each action panel must show one operative surface only

NON-NEGOTIABLE IMAGE MATCH RULES:
- the image must align closely with the post meaning
- do not generate a generic business collage
- the final image must feel like a visual translation of the selected post
- each panel should reveal a different part of the post's meaning, scene, effort, or outcome
- if a real-life moment is implied, show that real-life moment clearly
- if the post is about standards, care, routine, pressure, community, education, founder presence, emergency response, or practical support, show those things visibly
- the post should feel recognisable through the image even without words

NON-NEGOTIABLE WEBSITE ALIGNMENT RULES:
- where possible, match the website's imagery style, colour palette, visual tone, atmosphere, textures, and overall theme
- keep the image feeling like it belongs to the same business identity as the website
- do not use random colours, props, or moods that clash with the website
- if the website feels minimal, earthy, luxurious, warm, clinical, handcrafted, industrial, soft, family-led, or modern, reflect that visually

NON-NEGOTIABLE IMAGE SAFETY RULES:
- no readable words anywhere in the image
- no signage text, shop signs, labels, written words, route numbers, motorway names, street names, suburb names, or location text
- no readable logos anywhere in the image
- no fake brand names
- no invented company names on clothing, packaging, signage, or vehicles
- no letters or text on garments
- no readable or semi-readable transport markings, road labels, destination signs, registration text, or roadside information boards
- if a location is implied, show it through environment only, never through text or signage unless exact verified text was explicitly provided and intentionally requested
- do not invent Australian road labels, motorway numbers, or geographic markers
- keep all clothing, vehicles, roads, signage, and objects visually unbranded unless real assets were explicitly provided
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
   scenePlan,
   sceneType,
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
  console.log(`Server running on port ${PORT}`);

  if (
    process.env.NODE_ENV !== "production" &&
    process.argv.includes("--ubdg-self-test")
  ) {
    runUbdgEvidenceHelperSelfTest().catch((err) => {
      console.error("UBDG SELF TEST ERROR:", err);
      process.exitCode = 1;
    });
  }
});