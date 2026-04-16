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
    const res = await fetch("/generate-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imagePrompt: post, // <-- fixed to match server.js
      }),
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