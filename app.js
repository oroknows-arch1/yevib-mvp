const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");
const imageStatus = document.getElementById("imageStatus");

const intakeStatus = document.getElementById("intakeStatus");
const ownerKbStatus = document.getElementById("ownerKbStatus");
const sourceChangePrompt = document.getElementById("sourceChangePrompt");
const profilePrompt = document.getElementById("profilePrompt");
const feelingPrompt = document.getElementById("feelingPrompt");
const generatePrompt = document.getElementById("generatePrompt");
const postsPrompt = document.getElementById("postsPrompt");

const founderGoalInput = document.getElementById("founderGoal");
const founderGoalDisplay = document.getElementById("founderGoalDisplay");
const voiceSummaryDisplay = document.getElementById("voiceSummaryDisplay");
const offersDisplay = document.getElementById("offersDisplay");
const audienceDisplay = document.getElementById("audienceDisplay");
const opportunitiesDisplay = document.getElementById("opportunitiesDisplay");
const recommendedFocusDisplay = document.getElementById("recommendedFocusDisplay");
const recommendedFocusWrap = document.getElementById("recommendedFocusWrap");

const channelsDisplay = document.getElementById("channelsDisplay");
const trustSignalsDisplay = document.getElementById("trustSignalsDisplay");
const educationSignalsDisplay = document.getElementById("educationSignalsDisplay");
const activitySignalsDisplay = document.getElementById("activitySignalsDisplay");
const founderVisibilitySignalsDisplay = document.getElementById("founderVisibilitySignalsDisplay");
const intelligenceSummaryDisplay = document.getElementById("intelligenceSummaryDisplay");

const sourceConfidenceDisplay = document.getElementById("sourceConfidenceDisplay");
const activeSourceSegmentDisplay = document.getElementById("activeSourceSegmentDisplay");
const sourceSegmentSummary = document.getElementById("sourceSegmentSummary");
const sourceRatingCanvas = document.getElementById("sourceRatingChart");

const toggleBrandIntelligenceBtn = document.getElementById("toggleBrandIntelligenceBtn");
const brandIntelligenceDrawer = document.getElementById("brandIntelligenceDrawer");
const continueToGenerateBtn = document.getElementById("continueToGenerateBtn");

let initialProfile = null;
let voiceProfile = null;
let sourceRatingChart = null;
let sourceBreakdown = null;

let currentQuickType = "";
let currentCategory = "";
let selectedPost = "";
let selectedFeeling = "";
let selectedFounderGoal = "";
let profileBuilt = false;
let sourceChangedSinceBuild = false;
let lastWeakVoice = false;

const QUICK_TYPES = {
  Business: {
    category: "Product in Real Life",
    idea: "business",
  },
  Family: {
    category: "Small Moment Real Value",
    idea: "family",
  },
  Educational: {
    category: "Standards and Care",
    idea: "educational",
  },
  Community: {
    category: "Quiet Value",
    idea: "community",
  },
  Personal: {
    category: "Founder Reflection",
    idea: "personal",
  },
  "Something Real": {
    category: "Something Real",
    idea: "something real",
  },
};

function scrollToSection(id, behavior = "smooth") {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior, block: "start" });
}

function forceSnapshotStop() {
  requestAnimationFrame(() => {
    scrollToSection("section-profile", "auto");
    setTimeout(() => {
      scrollToSection("section-profile", "smooth");
    }, 120);
    setTimeout(() => {
      scrollToSection("section-profile", "auto");
    }, 320);
  });
}

function clearOutputs() {
  postsDiv.innerHTML = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  selectedPost = "";
  postsPrompt.innerText = "";
}

function destroySourceChart() {
  if (sourceRatingChart) {
    sourceRatingChart.destroy();
    sourceRatingChart = null;
  }
}

function clearSnapshotDisplays() {
  founderGoalDisplay.innerText = "No goal selected yet.";
  voiceSummaryDisplay.innerText = "Voice summary will appear here after the scan.";
  offersDisplay.innerText = "Offers and services will appear here after the scan.";
  audienceDisplay.innerText = "Audience clues will appear here after the scan.";
  opportunitiesDisplay.innerText = "Opportunities will appear here after the scan.";
  intelligenceSummaryDisplay.innerText = "Brand intelligence summary will appear here after the scan.";

  recommendedFocusDisplay.innerText = "";
  recommendedFocusWrap.style.display = "none";

  channelsDisplay.innerText = "Detected channels will appear here after the scan.";
  trustSignalsDisplay.innerText = "Trust and proof signals will appear here after the scan.";
  educationSignalsDisplay.innerText = "Education signals will appear here after the scan.";
  activitySignalsDisplay.innerText = "Public activity signals will appear here after the scan.";
  founderVisibilitySignalsDisplay.innerText =
    "Founder visibility signals will appear here after the scan.";

  sourceConfidenceDisplay.innerText = "Not scanned yet";
  activeSourceSegmentDisplay.innerText = "None selected";
  sourceSegmentSummary.innerText = "Scan source details will appear here after the scan.";

  sourceBreakdown = null;
  destroySourceChart();

  if (toggleBrandIntelligenceBtn) {
    toggleBrandIntelligenceBtn.style.display = "none";
    toggleBrandIntelligenceBtn.innerText = "Open Brand Intelligence";
  }

  if (brandIntelligenceDrawer) {
    brandIntelligenceDrawer.style.display = "none";
  }

  if (continueToGenerateBtn) {
    continueToGenerateBtn.style.display = "none";
  }
}

function setInitialGuidance() {
  profilePrompt.innerText =
    "Scan the business first. Review the brand snapshot before moving into content action.";
  feelingPrompt.innerText =
    "Optional: choose a feeling if you want today's content to better match your current tone.";
  generatePrompt.innerText =
    "After the brand snapshot is ready, choose the content lens you want YEVIB to generate from.";
}

function updateSourceChangePrompt() {
  if (profileBuilt && sourceChangedSinceBuild) {
    sourceChangePrompt.innerText =
      "Source material changed after the last scan. Scan brand again to fully apply the new inputs.";
  } else {
    sourceChangePrompt.innerText = "";
  }
}

function markSourceChanged() {
  if (!profileBuilt) return;
  sourceChangedSinceBuild = true;
  updateSourceChangePrompt();
}

function setupSourceWatchers() {
  ["businessName", "businessUrl", "pastedSourceText", "manualBusinessContext", "founderGoal"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", markSourceChanged);
      if (el && el.tagName === "SELECT") {
        el.addEventListener("change", markSourceChanged);
      }
    }
  );
}

function setupContinueButton() {
  if (!continueToGenerateBtn) return;

  continueToGenerateBtn.addEventListener("click", () => {
    scrollToSection("section-generate");
  });
}

function setupIntelligenceDrawer() {
  if (!toggleBrandIntelligenceBtn || !brandIntelligenceDrawer) return;

  toggleBrandIntelligenceBtn.addEventListener("click", () => {
    const isOpen = brandIntelligenceDrawer.style.display === "block";
    brandIntelligenceDrawer.style.display = isOpen ? "none" : "block";
    toggleBrandIntelligenceBtn.innerText = isOpen
      ? "Open Brand Intelligence"
      : "Hide Brand Intelligence";

    if (!isOpen) {
      setTimeout(() => {
        brandIntelligenceDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  });
}

function setupFeelingButtons() {
  const buttons = document.querySelectorAll(".feeling-btn");
  const customFeelingInput = document.getElementById("customFeeling");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((btn) => {
        btn.classList.remove("is-active");
      });

      button.classList.add("is-active");
      selectedFeeling = button.dataset.feeling || "";
      customFeelingInput.value = "";

      feelingPrompt.innerText = `Feeling set: ${selectedFeeling}. Now choose the content lens you want.`;
      scrollToSection("section-generate");
    });
  });

  customFeelingInput.addEventListener("input", () => {
    if (customFeelingInput.value.trim()) {
      buttons.forEach((btn) => {
        btn.classList.remove("is-active");
      });
      selectedFeeling = "";
      feelingPrompt.innerText =
        "Custom feeling added. Now choose the content lens you want.";
    } else if (!getFeelingInput()) {
      feelingPrompt.innerText =
        "Optional: choose a feeling if you want today's content to better match your current tone.";
    }
  });
}

function getFeelingInput() {
  const customFeeling = document.getElementById("customFeeling").value.trim();
  return customFeeling || selectedFeeling || "";
}

function getFounderGoal() {
  return founderGoalInput?.value?.trim() || selectedFounderGoal || "";
}

function getCurrentBusinessName() {
  return (
    initialProfile?.businessProfile?.name ||
    document.getElementById("businessName").value.trim() ||
    "Your Brand"
  );
}

function getCurrentBusinessSummary() {
  return (
    initialProfile?.businessProfile?.summary ||
    document.getElementById("businessSummary").value.trim() ||
    ""
  );
}

function toDisplayList(items = [], fallback = "Not enough information yet.") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `• ${item}`).join("\n");
}

function channelsToDisplay(channels = {}) {
  const labels = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    youtube: "YouTube",
    x: "X",
    linkedin: "LinkedIn",
  };

  const found = Object.entries(channels || {})
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `• ${labels[key] || key}: ${value}`);

  return found.length > 0
    ? found.join("\n")
    : "No public channels were clearly detected yet.";
}

function buildOpportunitiesFromProfile(profile) {
  const backendOpportunities = profile?.advisorSnapshot?.opportunities || [];
  if (Array.isArray(backendOpportunities) && backendOpportunities.length > 0) {
    return backendOpportunities.slice(0, 6);
  }

  const opportunities = [];
  const category = profile?.contentProfile?.suggestedCategory || "";
  const idea = profile?.contentProfile?.suggestedIdea || "";
  const weakVoice = Boolean(profile?.sourceProfile?.weakVoiceSource);
  const offers = profile?.brandProductTruth?.offers || [];
  const audience = profile?.brandProductTruth?.audience || [];

  if (category) opportunities.push(`Lean harder into ${category} content.`);
  if (idea) opportunities.push(`Use this as an early content direction: ${idea}`);
  if (offers.length > 0) opportunities.push("Turn offers and services into clearer lived-use content.");
  if (audience.length > 0) opportunities.push("Speak more directly to the audience the brand already appears to serve.");
  if (weakVoice) opportunities.push("Add more owner writing to strengthen founder voice consistency.");

  const founderGoal = getFounderGoal();
  if (founderGoal) {
    opportunities.push(`Bias future content toward this founder goal: ${founderGoal}`);
  }

  return opportunities.slice(0, 5);
}

function buildIntelligenceSummary(profile) {
  const trustSignals = profile?.discoveryProfile?.trustSignals || [];
  const educationSignals = profile?.discoveryProfile?.educationSignals || [];
  const activitySignals = profile?.discoveryProfile?.activitySignals || [];
  const founderSignals = profile?.discoveryProfile?.founderVisibilitySignals || [];
  const opportunities = profile?.advisorSnapshot?.opportunities || [];
  const recommendedFocus = profile?.advisorSnapshot?.recommendedFocus || "";
  const confidence = profile?.discoveryProfile?.sourceConfidence || "unknown";

  const parts = [];

  if (trustSignals.length > 0) {
    parts.push("YEVIB found visible trust and proof signal in the current public source set.");
  }

  if (educationSignals.length > 0) {
    parts.push("There is usable education signal that can be turned into clearer teaching and authority content.");
  }

  if (activitySignals.length > 0) {
    parts.push("There are signs of public activity or wider ecosystem movement that the brand can surface more clearly.");
  }

  if (founderSignals.length > 0) {
    parts.push("Founder visibility signal exists, but may still need stronger public positioning depending on the goal.");
  }

  if (opportunities.length > 0) {
    parts.push(`The strongest current optimization direction is to ${opportunities[0].replace(/^./, (m) => m.toLowerCase())}`);
  }

  if (recommendedFocus) {
    parts.push(`Overall, the current recommended focus is: ${recommendedFocus}`);
  }

  if (parts.length === 0) {
    parts.push(`This scan is running on ${confidence} confidence and is still building a useful first-pass picture of the business.`);
  }

  return parts.join(" ");
}

function buildSourceBreakdown(profile) {
  const discovery = profile?.discoveryProfile || {};
  const channelsFound = discovery.channelsFound || {};
  const channelCount = Object.values(channelsFound).filter(Boolean).length;

  const localItems = [];
  const globalItems = [];

  if (profile?.sourceProfile?.urlUsed) localItems.push("website URL");
  if (profile?.sourceProfile?.pastedTextUsed) localItems.push("pasted owner writing");
  if (profile?.sourceProfile?.manualContextUsed) localItems.push("manual business context");

  if (channelCount > 0) globalItems.push(`${channelCount} detected public channel${channelCount === 1 ? "" : "s"}`);
  if ((discovery.trustSignals || []).length > 0) globalItems.push("public trust/proof signals");
  if ((discovery.educationSignals || []).length > 0) globalItems.push("public education signals");
  if ((discovery.activitySignals || []).length > 0) globalItems.push("public activity signals");
  if ((discovery.founderVisibilitySignals || []).length > 0) globalItems.push("founder visibility signals");

  const localScore = Math.max(localItems.length, 1);
  const globalScore = Math.max(globalItems.length, 1);

  return {
    labels: ["Local", "Global"],
    values: [localScore, globalScore],
    localSummary:
      localItems.length > 0
        ? `This scan used local source material from ${localItems.join(", ")}.`
        : "No strong local source inputs were detected beyond the current scan base.",
    globalSummary:
      globalItems.length > 0
        ? `This scan also used wider public signal from ${globalItems.join(", ")}.`
        : "Very limited global public signal was detected in this scan.",
  };
}

function renderSourceSegmentSummary(segmentName) {
  if (!sourceBreakdown) {
    activeSourceSegmentDisplay.innerText = "None selected";
    sourceSegmentSummary.innerText = "Scan source details will appear here after the scan.";
    return;
  }

  activeSourceSegmentDisplay.innerText = segmentName;

  if (segmentName === "Local") {
    sourceSegmentSummary.innerText = sourceBreakdown.localSummary;
    return;
  }

  if (segmentName === "Global") {
    sourceSegmentSummary.innerText = sourceBreakdown.globalSummary;
    return;
  }

  sourceSegmentSummary.innerText = "Scan source details will appear here after the scan.";
}

function renderSourceRatingChart(profile) {
  destroySourceChart();

  sourceBreakdown = buildSourceBreakdown(profile);
  const confidence = profile?.discoveryProfile?.sourceConfidence || "unknown";
  sourceConfidenceDisplay.innerText = confidence;
  activeSourceSegmentDisplay.innerText = "None selected";
  sourceSegmentSummary.innerText =
    "Tap Local or Global in the chart to inspect that part of the scan.";

  if (!sourceRatingCanvas || typeof Chart === "undefined") return;

  sourceRatingChart = new Chart(sourceRatingCanvas, {
    type: "pie",
    data: {
      labels: sourceBreakdown.labels,
      datasets: [
        {
          data: sourceBreakdown.values,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
        },
      },
      onClick: (event, elements) => {
        if (!elements || elements.length === 0) return;
        const index = elements[0].index;
        const label = sourceBreakdown.labels[index];
        renderSourceSegmentSummary(label);
      },
    },
  });
}

function renderDiscoverySnapshot(profile) {
  const discovery = profile?.discoveryProfile || {};

  channelsDisplay.innerText = channelsToDisplay(discovery.channelsFound || {});
  trustSignalsDisplay.innerText = toDisplayList(
    discovery.trustSignals || [],
    "No clear trust or proof signals were detected yet."
  );
  educationSignalsDisplay.innerText = toDisplayList(
    discovery.educationSignals || [],
    "No clear education signals were detected yet."
  );
  activitySignalsDisplay.innerText = toDisplayList(
    discovery.activitySignals || [],
    "No clear public activity signals were detected yet."
  );
  founderVisibilitySignalsDisplay.innerText = toDisplayList(
    discovery.founderVisibilitySignals || [],
    "No clear founder visibility signals were detected yet."
  );

  intelligenceSummaryDisplay.innerText = buildIntelligenceSummary(profile);
  renderSourceRatingChart(profile);
}

function renderBrandSnapshot(profile) {
  const founderGoal = profile?.founderGoal || getFounderGoal();
  const recommendedFocus = profile?.advisorSnapshot?.recommendedFocus || "";

  founderGoalDisplay.innerText = founderGoal || "No goal selected yet.";

  if (recommendedFocus) {
    recommendedFocusWrap.style.display = "block";
    recommendedFocusDisplay.innerText = recommendedFocus;
  } else {
    recommendedFocusWrap.style.display = "none";
    recommendedFocusDisplay.innerText = "";
  }

  voiceSummaryDisplay.innerText =
    profile?.founderVoice?.voiceSummary || "No voice summary returned yet.";

  offersDisplay.innerText = toDisplayList(
    profile?.brandProductTruth?.offers || [],
    "No clear offers or services detected yet."
  );

  audienceDisplay.innerText = toDisplayList(
    profile?.brandProductTruth?.audience || [],
    "No clear audience clues detected yet."
  );

  opportunitiesDisplay.innerText = toDisplayList(
    buildOpportunitiesFromProfile(profile),
    "No clear opportunities detected yet."
  );

  renderDiscoverySnapshot(profile);
}

async function buildInitialProfile() {
  const mode = document.getElementById("generationMode").value;
  const businessName = document.getElementById("businessName").value.trim();
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const manualBusinessContext = document.getElementById("manualBusinessContext").value.trim();
  const founderGoal = getFounderGoal();

  clearOutputs();
  clearSnapshotDisplays();
  ownerKbStatus.innerText = "";
  postsPrompt.innerText = "";

  if (!businessUrl && !pastedSourceText && !manualBusinessContext) {
    intakeStatus.innerText = "Please add at least one source before scanning.";
    return;
  }

  intakeStatus.innerText = "Scanning brand and building snapshot...";

  try {
    const res = await fetch("/build-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        businessName,
        founderGoal,
        businessUrl,
        pastedSourceText,
        manualBusinessContext,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /build-profile:", text);
      intakeStatus.innerText =
        "Brand scan failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Brand scan failed.";
      return;
    }

    initialProfile = data.profile || null;
    voiceProfile = data.profile?.founderVoice || null;
    profileBuilt = true;
    sourceChangedSinceBuild = false;
    updateSourceChangePrompt();

    selectedFounderGoal = data.profile?.founderGoal || founderGoal;

    const resolvedBusinessName =
      businessName || data.profile?.businessProfile?.name || "";

    document.getElementById("businessName").value = resolvedBusinessName;
    document.getElementById("businessSummary").value =
      data.profile?.businessProfile?.summary || "";
    document.getElementById("voiceInput").value =
      data.profile?.sourceProfile?.voiceSourceText || "";

    renderBrandSnapshot(data.profile);

    lastWeakVoice = Boolean(data.profile?.sourceProfile?.weakVoiceSource);
    const kbMeta = data.profile?.ownerKbMeta || {};
    const sourceConfidence = data.profile?.discoveryProfile?.sourceConfidence || "";

    intakeStatus.innerText = lastWeakVoice
      ? "Brand snapshot ready. Voice source is thin."
      : "Brand snapshot ready.";

    if (lastWeakVoice) {
      profilePrompt.innerText =
        "The scan worked, but the founder voice source is still thin. Review the snapshot first, then add more owner writing and scan again for stronger results if needed.";
    } else if (sourceConfidence) {
      profilePrompt.innerText =
        `Review the brand snapshot first. Discovery confidence is ${sourceConfidence}. Open Brand Intelligence only when you want the deeper read.`;
    } else {
      profilePrompt.innerText =
        "Review the brand snapshot first. Open Brand Intelligence only when you want the deeper read.";
    }

    if (kbMeta.entryCount > 0) {
      ownerKbStatus.innerText = `Owner KB active — ${kbMeta.entryCount} saved choice${
        kbMeta.entryCount === 1 ? "" : "s"
      } for this business.`;
    } else {
      ownerKbStatus.innerText =
        "Owner KB active — no saved choices yet. It will start learning when you choose posts.";
    }

    feelingPrompt.innerText =
      "Optional: choose a feeling if you want today's content to better match your current tone.";
    generatePrompt.innerText =
      "Choose the content lens you want YEVIB to generate from the brand snapshot.";

    if (toggleBrandIntelligenceBtn) {
      toggleBrandIntelligenceBtn.style.display = "inline-flex";
    }

    if (continueToGenerateBtn) {
      continueToGenerateBtn.style.display = "inline-flex";
    }

    forceSnapshotStop();
  } catch (error) {
    console.error(error);
    intakeStatus.innerText = "Error: " + error.message;
  }
}

async function quickGenerate(type) {
  if (!initialProfile) {
    alert("Scan the brand first.");
    return;
  }

  if (sourceChangedSinceBuild) {
    alert(
      "Source material changed after the last scan. Scan brand again to fully apply the new inputs."
    );
    return;
  }

  const config = QUICK_TYPES[type];
  if (!config) {
    alert("Unknown content lens.");
    return;
  }

  const ownerFeeling = getFeelingInput();

  currentQuickType = type;
  currentCategory = config.category;
  selectedPost = "";

  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  postsDiv.innerHTML = "Generating posts...";
  postsPrompt.innerText = ownerFeeling
    ? `Generating ${type} posts with feeling: ${ownerFeeling}.`
    : `Generating ${type} posts from the brand snapshot.`;

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "hybrid",
        idea: config.idea,
        quickType: type,
        ownerNudge: ownerFeeling,
        category: config.category,
        founderGoal: getFounderGoal(),
        businessName: getCurrentBusinessName(),
        businessSummary: getCurrentBusinessSummary(),
        manualVoiceInput: document.getElementById("voiceInput").value.trim(),
        voiceProfile,
        initialProfile,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /generate:", text);
      postsDiv.innerHTML = "Generate failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      postsDiv.innerHTML = "Error: " + (data.error || "Generate failed.");
      return;
    }

    if (!data.text) {
      postsDiv.innerHTML = "No posts returned.";
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    renderPostChoices(posts, type, ownerFeeling);
    scrollToSection("section-posts");
  } catch (error) {
    console.error(error);
    postsDiv.innerHTML = "Error: " + error.message;
  }
}

async function saveOwnerChoice({ chosenPost, ownerFeeling }) {
  try {
    const res = await fetch("/save-owner-choice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessName: getCurrentBusinessName(),
        businessSummary: getCurrentBusinessSummary(),
        founderGoal: getFounderGoal(),
        quickType: currentQuickType,
        category: currentCategory,
        ownerFeeling: ownerFeeling || "",
        chosenPost,
        voiceSourceText: document.getElementById("voiceInput").value.trim(),
        ownerWritingSample: document.getElementById("pastedSourceText").value.trim(),
        manualBusinessContext: document.getElementById("manualBusinessContext").value.trim(),
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /save-owner-choice:", text);
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      console.error("Owner KB save failed:", data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Owner KB save failed:", error);
  }
}

function renderPostChoices(posts, typeLabel, ownerFeeling) {
  postsDiv.innerHTML = "";
  postsPrompt.innerText =
    "Choose one of the 3 posts. Your choice will update Owner KB and generate the image.";

  const intro = document.createElement("div");
  intro.className = "posts-intro";
  intro.innerText = ownerFeeling
    ? `${typeLabel} posts — feeling: ${ownerFeeling} — choose one to generate its image.`
    : `${typeLabel} posts — choose one to generate its image.`;
  postsDiv.appendChild(intro);

  posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-choice-card";

    const postText = document.createElement("div");
    postText.className = "post-text";
    postText.innerText = post;
    card.appendChild(postText);

    const counter = document.createElement("div");
    counter.className = "post-meta";
    counter.innerText = `Characters: ${post.length}`;
    card.appendChild(counter);

    const helper = document.createElement("div");
    helper.className = "post-helper";
    helper.innerText = "Click to choose this post and generate its image.";
    card.appendChild(helper);

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "secondary-btn";
    copyBtn.innerText = "Copy Post";

    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(post);
        copyBtn.innerText = "Copied";
        setTimeout(() => {
          copyBtn.innerText = "Copy Post";
        }, 1200);
      } catch (err) {
        console.error("Copy failed:", err);
        copyBtn.innerText = "Copy failed";
        setTimeout(() => {
          copyBtn.innerText = "Copy Post";
        }, 1200);
      }
    };

    actions.appendChild(copyBtn);
    card.appendChild(actions);

    card.onclick = async () => {
      document.querySelectorAll(".post-choice-card").forEach((el) => {
        el.classList.remove("selected");
      });

      card.classList.add("selected");

      selectedPost = post;
      selectedPostBox.innerText = post;
      generatedImage.style.display = "none";
      generatedImage.src = "";
      imageStatus.innerText = "Saving choice and generating image...";

      await saveOwnerChoice({
        chosenPost: post,
        ownerFeeling,
      });

      const imagePrompt = buildImagePrompt({
        post,
        quickType: currentQuickType,
        category: currentCategory,
        ownerFeeling,
        initialProfile,
      });

      try {
        const imgRes = await fetch("/generate-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imagePrompt,
          }),
        });

        const contentType = imgRes.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await imgRes.text();
          console.error("Non-JSON response from /generate-image:", text);
          imageStatus.innerText =
            "Image generation failed: server returned HTML instead of JSON.";
          return;
        }

        const imgData = await imgRes.json();

        if (!imgRes.ok) {
          imageStatus.innerText =
            "Image generation failed: " + (imgData.error || "Unknown error.");
          return;
        }

        if (!imgData.imageUrl) {
          imageStatus.innerText = "Image generation failed: No image returned.";
          return;
        }

        generatedImage.src = imgData.imageUrl;
        generatedImage.style.display = "block";
        imageStatus.innerText = "Post ready. This sounds like the business today.";
        ownerKbStatus.innerText = "Owner KB updated from the latest chosen post.";

        scrollToSection("section-output");
      } catch (error) {
        console.error(error);
        imageStatus.innerText = "Image generation failed: " + error.message;
      }
    };

    postsDiv.appendChild(card);
  });
}

function stripPostHashtags(text = "") {
  return String(text).replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();
}

function extractQuotedSnippets(text = "") {
  const matches = [...String(text).matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  return matches.filter(Boolean);
}

function detectLocationCue(text = "") {
  const locations = [
    "Kyoto",
    "Uji",
    "Japan",
    "Macarthur",
    "Sydney",
    "Melbourne",
    "Brisbane",
    "Perth",
    "Adelaide",
    "Auckland",
  ];

  const lower = String(text).toLowerCase();
  const found = locations.find((loc) => lower.includes(loc.toLowerCase()));
  return found || "";
}

function detectRelationshipCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("my wife")) return "wife";
  if (lower.includes("my husband")) return "husband";
  if (lower.includes("my son")) return "son";
  if (lower.includes("my daughter")) return "daughter";
  if (lower.includes("my family")) return "family";
  if (lower.includes("my mum")) return "mum";
  if (lower.includes("my mom")) return "mom";
  if (lower.includes("my dad")) return "dad";

  return "";
}

function detectMemoryCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("i remember")) return "memory";
  if (lower.includes("the first time")) return "first_time";
  if (lower.includes("last week")) return "last_week";
  if (lower.includes("this morning")) return "this_morning";
  if (lower.includes("late afternoon")) return "late_afternoon";
  if (lower.includes("on weekends")) return "weekend";
  if (lower.includes("watching her")) return "observed_moment";

  return "";
}

function detectOriginCue(text = "") {
  const lower = String(text).toLowerCase();

  if (lower.includes("farm")) return "farm";
  if (lower.includes("harvest")) return "harvest";
  if (lower.includes("shade") || lower.includes("shading")) return "shaded cultivation";
  if (lower.includes("uji")) return "traditional tea region";
  if (lower.includes("kyoto")) return "japanese origin";
  if (lower.includes("tradition")) return "tradition";
  if (lower.includes("ancient")) return "heritage";
  if (lower.includes("care behind")) return "craft";
  if (lower.includes("whisk")) return "preparation";

  return "";
}

function buildStoryPriority({ post, quickType, category, businessName }) {
  const clean = stripPostHashtags(post);
  const quotedSnippets = extractQuotedSnippets(clean);
  const quotedPrimary = quotedSnippets[0] || clean;

  const locationCue = detectLocationCue(clean);
  const relationshipCue = detectRelationshipCue(clean);
  const memoryCue = detectMemoryCue(clean);
  const originCue = detectOriginCue(clean);

  const storyLines = [];

  if (memoryCue === "first_time") {
    storyLines.push(
      "- Panel 1 should show the very first discovery moment from the post, not a generic lifestyle shot."
    );
  } else if (memoryCue === "memory") {
    storyLines.push(
      "- Panel 1 should feel like a remembered real-life moment from the post, as if the scene actually happened."
    );
  } else if (memoryCue === "late_afternoon") {
    storyLines.push(
      "- Include a late-afternoon work atmosphere if it fits the post."
    );
  } else {
    storyLines.push(
      "- Panel 1 should show the clearest real-world moment implied by the post."
    );
  }

  if (relationshipCue) {
    storyLines.push(
      `- Because the post mentions the owner's ${relationshipCue}, at least one panel must include that relational moment or connection.`
    );
  }

  if (locationCue) {
    storyLines.push(
      `- Because the post mentions ${locationCue}, at least one panel should visually reflect that location or its atmosphere in a believable way.`
    );
  }

  if (originCue) {
    storyLines.push(
      `- Include one panel that shows the origin/craft side of the story: ${originCue}.`
    );
  }

  storyLines.push(
    "- Do not jump straight to generic product marketing imagery. Start with the human story in the post, then widen outward."
  );
  storyLines.push(
    "- Make the 4 panels feel like one connected narrative, not 4 random brand photos."
  );
  storyLines.push(
    "- If the post contains a memory, discovery, or turning point, make that the emotional anchor of the collage."
  );

  const narrativeSequence = `
NARRATIVE SEQUENCE FOR THE 4 PANELS:
1. Human story moment from the post
2. Preparation / work / hands-on action related to the post
3. Origin / source / process / environment behind the thing
4. Wider meaning or lived result that connects back to the post
`.trim();

  const postAnchor = `
POST STORY ANCHOR:
- Business: ${businessName}
- Quick type: ${quickType}
- Internal frame: ${category}
- Use this sentence as the emotional source: "${quotedPrimary}"
`.trim();

  return `${postAnchor}

${narrativeSequence}

STORY-SPECIFIC VISUAL RULES:
${storyLines.join("\n")}`;
}

function buildImagePrompt({ post, quickType, category, ownerFeeling, initialProfile }) {
  const cleanedPost = stripPostHashtags(post);

  const businessName =
    initialProfile?.businessProfile?.name ||
    document.getElementById("businessName").value.trim() ||
    "the business";

  const businessSummary =
    initialProfile?.businessProfile?.summary ||
    document.getElementById("businessSummary").value.trim() ||
    "a real business";

  const audience =
    (initialProfile?.brandProductTruth?.audience || []).join(", ") || "not specified";

  const offers =
    (initialProfile?.brandProductTruth?.offers || []).join(", ") || "not specified";

  const visualDirections =
    (initialProfile?.visualProfile?.visualDirections || []).join(", ") ||
    "grounded, realistic, documentary";

  const storyPriority = buildStoryPriority({
    post: cleanedPost,
    quickType,
    category,
    businessName,
  });

  return `
Create a realistic 4-panel image collage that matches this post exactly and tells the same story.

POST TO VISUALIZE:
"${cleanedPost}"

${storyPriority}

CURRENT OWNER FEELING:
${ownerFeeling || "not specified"}

BUSINESS CONTEXT:
- Business name: ${businessName}
- Business summary: ${businessSummary}
- Audience: ${audience}
- Offers/services: ${offers}
- Visual direction hints: ${visualDirections}

GLOBAL RULES:
- documentary realism
- grounded and believable
- modern real-life business context
- natural lighting
- no fantasy
- no stock-photo feel
- each panel must show a different but related real-world moment
- each panel must contain distinct people or a distinct group
- no duplicate people across panels unless the post clearly requires a recurring main person
- if the post strongly implies one recurring founder or one recurring personal memory, it is allowed to keep that same person across some panels
- otherwise avoid visual cloning of the same subject across the collage
- show realistic people, places, tasks, interactions, tools, workflow, ingredients, craft, or environments relevant to the post
- if a specific place is mentioned in the post, reflect it visually
- if a specific relationship is mentioned in the post, reflect it visually
- if a process, craft, farm, workshop, source region, or origin story is mentioned, reflect it visually
- the collage should feel like visual proof of the post, not generic inspiration
- plain unbranded clothing only
- no logos
- no text
- no symbols
- no fake brand marks
- no lettering on clothing
- no pseudo-branding
- no invented company names on signage, vehicles, garments, packaging, or walls
- keep the whole collage truthful to the business and the post
`.trim();
}

setupFeelingButtons();
setupSourceWatchers();
setupContinueButton();
setupIntelligenceDrawer();
clearSnapshotDisplays();
setInitialGuidance();