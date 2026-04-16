const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");
const imageStatus = document.getElementById("imageStatus");

const intakeStatus = document.getElementById("intakeStatus");
const ownerKbStatus = document.getElementById("ownerKbStatus");
const profilePrompt = document.getElementById("profilePrompt");
const postsPrompt = document.getElementById("postsPrompt");

const founderGoalInput = document.getElementById("founderGoal");
const businessSummaryInput = document.getElementById("businessSummary");

const generatePostsBtn = document.getElementById("generatePostsBtn");
const buildProfileBtn = document.getElementById("buildProfileBtn"); // <-- make sure this id exists in index.html

let initialProfile = null;
let selectedPost = "";

/* ------------------ CORE HELPERS ------------------ */

function safeJoin(items, fallback = "Not enough signal yet.") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return "• " + items.join("\n• ");
}
function getFounderGoal() {
  return founderGoalInput?.value?.trim() || "";
}

function getBusinessSummary() {
  return businessSummaryInput?.value?.trim() || "";
}

function clearOutputs() {
  postsDiv.innerHTML = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  selectedPost = "";
}

/* ------------------ BUILD PROFILE ------------------ */

async function buildInitialProfile() {
  const businessUrl = document.getElementById("businessUrl")?.value?.trim() || "";
  const pastedSourceText = document.getElementById("pastedSourceText")?.value?.trim() || "";

  clearOutputs();
  initialProfile = null;

  if (!businessUrl && !pastedSourceText) {
    intakeStatus.innerText = "Add a website or text first.";
    return;
  }

  intakeStatus.innerText = "Scanning and building execution plan...";
  profilePrompt.innerText = "";
  postsPrompt.innerText = "";

  try {
    const res = await fetch("/build-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: businessUrl && pastedSourceText ? "hybrid" : businessUrl ? "express" : "manual",
        businessUrl,
        pastedSourceText,
        manualBusinessContext: getBusinessSummary(),
        founderGoal: getFounderGoal(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Scan failed.";
      return;
    }

    initialProfile = data.profile;

renderSnapshot(initialProfile);

intakeStatus.innerText = "Execution plan ready.";

profilePrompt.innerText =
  initialProfile?.executionPlan?.summary ||
  "Press generate to execute your plan.";
  } catch (err) {
    intakeStatus.innerText = "Error: " + err.message;
  }
}
/* ------------------ SNAPSHOT RENDER ------------------ */

function renderSnapshot(profile) {
  if (!profile) return;

  const grouped = profile.groupedSnapshot || {};
  const advisor = profile.advisorSnapshot || {};
  const discovery = profile.discoveryProfile || {};
  const business = profile.businessProfile || {};
  const founderVoice = profile.founderVoice || {};
  const productTruth = profile.brandProductTruth || {};

  document.getElementById("businessSummary").value = business.summary || "";

  document.getElementById("founderGoalDisplay").innerText =
    getFounderGoal() || "No goal selected yet.";

  document.getElementById("brandSignalScore").innerText =
    `${grouped.overallPct || 0} / 100`;

  document.getElementById("brandSignalLabel").innerText =
    grouped.overallStateLabel || "Not scanned yet";

  document.getElementById("voiceSummaryDisplay").innerText =
    founderVoice.voiceSummary || "No voice summary available yet.";

  document.getElementById("recommendedFocusDisplay").innerText =
    grouped.recommendedFocus ||
    advisor.recommendedFocus ||
    "No recommended focus yet.";

  document.getElementById("offersDisplay").innerText =
    safeJoin(productTruth.offers, "No clear offers detected yet.");

  document.getElementById("audienceDisplay").innerText =
    safeJoin(productTruth.audience, "No clear audience signal detected yet.");

  document.getElementById("opportunitiesDisplay").innerText =
    safeJoin(advisor.opportunities, "No clear opportunities detected yet.");

  const channels = Object.entries(discovery.channelsFound || {})
    .filter(([, url]) => url)
    .map(([name, url]) => `${name}: ${url}`);

  document.getElementById("channelsDisplay").innerText =
    channels.length ? "• " + channels.join("\n• ") : "No channels detected.";

  document.getElementById("trustSignalsDisplay").innerText =
    safeJoin(discovery.trustSignals, "No strong trust signals.");

  document.getElementById("educationSignalsDisplay").innerText =
    safeJoin(discovery.educationSignals, "No education signals.");

  document.getElementById("activitySignalsDisplay").innerText =
    safeJoin(discovery.activitySignals, "No activity signals.");

  document.getElementById("founderVisibilitySignalsDisplay").innerText =
    safeJoin(discovery.founderVisibilitySignals, "No founder presence detected.");

  document.getElementById("intelligenceSummaryDisplay").innerText =
    profile.intelligenceRead || "No intelligence summary yet.";

  document.getElementById("voiceInput").value =
    profile.sourceProfile?.voiceSourceText || "";

  document.getElementById("toggleBrandIntelligenceBtn").style.display = "inline-flex";
  document.getElementById("continueToGenerateBtn").style.display = "inline-flex";
}

/* ------------------ EXECUTION ENGINE ------------------ */

async function handleGeneratePostsClick() {
  if (!initialProfile) {
    alert("Scan first.");
    return;
  }

  if (!initialProfile.executionPlan) {
    alert("No execution plan found.");
    return;
  }

  await generateExecutionPlan();
}

async function generateExecutionPlan() {
  const plan = initialProfile.executionPlan;

  postsDiv.innerHTML = "Executing plan...";
  postsPrompt.innerText = "YEVIB is executing your plan.";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "execution",
        idea: `
EXECUTE EXACTLY:

${(plan.actions || []).join("\n")}

CONSTRAINT:
${plan.constraint || ""}

SCHEDULE:
${plan.schedule || ""}
        `.trim(),
        category: initialProfile?.contentProfile?.suggestedCategory || "Product in Real Life",
        founderGoal: getFounderGoal(),
        businessSummary: getBusinessSummary(),
        initialProfile,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      postsDiv.innerHTML = "Error: " + (data.error || "Failed.");
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    renderPostChoices(posts);

  } catch (err) {
    postsDiv.innerHTML = "Error: " + err.message;
  }
}

/* ------------------ POST SELECTION ------------------ */

function renderPostChoices(posts) {
  postsDiv.innerHTML = "";
  postsPrompt.innerText = "Choose one. This locks execution.";

  posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-choice-card";
    card.innerText = post;

    card.onclick = async () => {
      document.querySelectorAll(".post-choice-card").forEach((el) => {
        el.classList.remove("selected");
      });

      card.classList.add("selected");

      selectedPost = post;
      selectedPostBox.innerText = post;

      imageStatus.innerText = "Generating image...";

      await generateImage(post);
    };

    postsDiv.appendChild(card);
  });
}

/* ------------------ IMAGE ------------------ */

async function generateImage(post) {
  try {
    const businessName = initialProfile?.businessProfile?.name || "the business";
    const businessSummary = initialProfile?.businessProfile?.summary || "";
    const recommendedFocus =
      initialProfile?.groupedSnapshot?.recommendedFocus ||
      initialProfile?.advisorSnapshot?.recommendedFocus ||
      "";

    const offers = (initialProfile?.brandProductTruth?.offers || []).join(", ");
    const audience = (initialProfile?.brandProductTruth?.audience || []).join(", ");
    const lifeMoments = (initialProfile?.customerOutcome?.lifeMoments || []).join(", ");

    const trustSignals = (initialProfile?.discoveryProfile?.trustSignals || []).join(", ");
    const educationSignals = (initialProfile?.discoveryProfile?.educationSignals || []).join(", ");
    const activitySignals = (initialProfile?.discoveryProfile?.activitySignals || []).join(", ");
    const founderSignals = (initialProfile?.discoveryProfile?.founderVisibilitySignals || []).join(", ");

    const visualDirections = (initialProfile?.visualProfile?.visualDirections || []).join(", ");
    const avoidRules = (initialProfile?.visualProfile?.avoidRules || []).join(", ");

    const imagePrompt = `
Create a documentary-realistic 4-panel collage image that visually matches this exact post as closely as possible.

BUSINESS:
${businessName}

BUSINESS SUMMARY:
${businessSummary}

POST TO VISUALISE:
${post}

RECOMMENDED FOCUS:
${recommendedFocus}

OFFERS / SERVICES:
${offers || "Not enough signal yet"}

AUDIENCE:
${audience || "Not enough signal yet"}

CUSTOMER LIFE MOMENTS:
${lifeMoments || "Not enough signal yet"}

TRUST SIGNALS:
${trustSignals || "Not enough signal yet"}

EDUCATION SIGNALS:
${educationSignals || "Not enough signal yet"}

ACTIVITY SIGNALS:
${activitySignals || "Not enough signal yet"}

FOUNDER VISIBILITY SIGNALS:
${founderSignals || "Not enough signal yet"}

WEBSITE VISUAL DIRECTIONS:
${visualDirections || "Use the website's visible tone, colour mood, and styling where possible"}

WEBSITE VISUAL AVOID RULES:
${avoidRules || "Avoid anything that clashes with the website identity"}

STRICT IMAGE GOAL:
- the viewer should be able to understand the post through the image alone
- do not make a generic brand collage
- make the image specifically about the selected post
- each of the 4 panels must represent a different visual part, beat, or implication of the post
- if the post suggests effort, standards, routine, pressure, relief, community, education, or founder presence, show those things visually
- if the post contains a real-life situation, build the collage around that real-life situation
- if the post is reflective, still show visible real-world scenes, not abstract mood only
- if the post implies before/after, process/result, pressure/relief, or work/value, use the panels to show that progression
- if the business is service-based, show people, process, environment, and real use
- if the business is product-based, show the product naturally inside lived situations, not like an ad
- make the post feel visible in the image

WEBSITE ALIGNMENT RULE:
- where possible, match the imagery style, colours, materials, atmosphere, and theme of the website
- if the website feels earthy, natural, minimal, luxurious, clinical, family-oriented, bold, soft, premium, handcrafted, industrial, or modern, carry that into the image
- keep the image visually consistent with the business identity already detected from the site
- do not force random colours that clash with the website feel
- let the collage feel like it belongs to the same business world as the website

STRICT COLLAGE RULES:
- exactly 4 clearly separate panels
- all 4 panels should feel connected to the same post
- no single-scene image
- no random unrelated panels
- documentary realism
- warm natural lighting unless the website identity clearly suggests a cooler or cleaner tone
- grounded, believable, human scenes
- visually rich but not fantasy-like
- no over-stylised ad look
- no polished stock-photo feeling
- the founder / human being behind the business may appear where appropriate
- where possible, show action, environment, effort, and result

AVOID:
${avoidRules || "Anything visually off-brand or unrelated to the business"}

NON-NEGOTIABLE SAFETY / VISUAL RULES:
- no readable text anywhere in the image
- no captions
- no signage words
- no logos
- no fake brand names
- no letters on clothing
- no packaging text
- no UI screenshots
- no social media post text inside the image
`;

    const res = await fetch("/generate-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imagePrompt }),
    });

    const data = await res.json();

    if (!res.ok || !data.imageUrl) {
      imageStatus.innerText = "Image failed.";
      return;
    }

    generatedImage.src = data.imageUrl;
    generatedImage.style.display = "block";
    imageStatus.innerText = "Execution complete.";
  } catch (err) {
    imageStatus.innerText = "Error: " + err.message;
  }
}

/* ------------------ INIT ------------------ */

if (buildProfileBtn) {
  buildProfileBtn.addEventListener("click", buildInitialProfile);
}

if (generatePostsBtn) {
  generatePostsBtn.addEventListener("click", handleGeneratePostsClick);
}