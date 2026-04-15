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
const businessSummaryInput = document.getElementById("businessSummary");

const brandSignalScore = document.getElementById("brandSignalScore");
const brandSignalLabel = document.getElementById("brandSignalLabel");
const snapshotPieCanvas = document.getElementById("snapshotPieChart");

const activeSliceWrap = document.getElementById("activeSliceWrap");
const activeSliceTitle = document.getElementById("activeSliceTitle");
const activeSliceMeta = document.getElementById("activeSliceMeta");
const activeSliceSummary = document.getElementById("activeSliceSummary");
const activeSliceStrengths = document.getElementById("activeSliceStrengths");
const activeSliceWeaknesses = document.getElementById("activeSliceWeaknesses");
const activeSliceNextMove = document.getElementById("activeSliceNextMove");

const toggleBrandIntelligenceBtn = document.getElementById("toggleBrandIntelligenceBtn");
const brandIntelligenceDrawer = document.getElementById("brandIntelligenceDrawer");
const continueToGenerateBtn = document.getElementById("continueToGenerateBtn");

const intelligenceSummaryDisplay = document.getElementById("intelligenceSummaryDisplay");
const voiceSummaryDisplay = document.getElementById("voiceSummaryDisplay");
const recommendedFocusDisplay = document.getElementById("recommendedFocusDisplay");
const offersDisplay = document.getElementById("offersDisplay");
const audienceDisplay = document.getElementById("audienceDisplay");
const opportunitiesDisplay = document.getElementById("opportunitiesDisplay");
const channelsDisplay = document.getElementById("channelsDisplay");
const trustSignalsDisplay = document.getElementById("trustSignalsDisplay");
const educationSignalsDisplay = document.getElementById("educationSignalsDisplay");
const activitySignalsDisplay = document.getElementById("activitySignalsDisplay");
const founderVisibilitySignalsDisplay = document.getElementById("founderVisibilitySignalsDisplay");
const voiceInput = document.getElementById("voiceInput");

let initialProfile = null;
let voiceProfile = null;
let snapshotPieChart = null;

let currentQuickType = "";
let currentCategory = "";
let selectedPost = "";
let selectedFeeling = "";
let selectedFounderGoal = "";
let profileBuilt = false;
let sourceChangedSinceBuild = false;

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
    setTimeout(() => scrollToSection("section-profile", "smooth"), 120);
    setTimeout(() => scrollToSection("section-profile", "auto"), 320);
  });
}

function destroySnapshotPieChart() {
  if (snapshotPieChart) {
    snapshotPieChart.destroy();
    snapshotPieChart = null;
  }
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

function setInitialGuidance() {
  profilePrompt.innerText =
    "Use this page as a quick glance. Tap the pie only if you want YEVIB to open up more of the scan.";
  feelingPrompt.innerText =
    "Optional: choose a feeling if you want today's content to better match your current tone.";
  generatePrompt.innerText =
    "Choose the content lens you want YEVIB to generate from the brand snapshot.";
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
  ["businessUrl", "pastedSourceText", "founderGoal"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", markSourceChanged);
    el.addEventListener("change", markSourceChanged);
  });
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
      buttons.forEach((btn) => btn.classList.remove("is-active"));
      button.classList.add("is-active");
      selectedFeeling = button.dataset.feeling || "";
      customFeelingInput.value = "";
      feelingPrompt.innerText = `Feeling set: ${selectedFeeling}.`;
    });
  });

  customFeelingInput.addEventListener("input", () => {
    if (customFeelingInput.value.trim()) {
      buttons.forEach((btn) => btn.classList.remove("is-active"));
      selectedFeeling = "";
      feelingPrompt.innerText = "Custom feeling added.";
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
  return initialProfile?.businessProfile?.name || "Your Brand";
}

function getCurrentBusinessSummary() {
  return initialProfile?.businessProfile?.summary || businessSummaryInput.value.trim() || "";
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
    parts.push(`The strongest current optimization direction is to ${String(opportunities[0]).replace(/^./, (m) => m.toLowerCase())}`);
  }
  if (recommendedFocus) {
    parts.push(`Overall, the current recommended focus is: ${recommendedFocus}`);
  }
  if (parts.length === 0) {
    parts.push(`This scan is running on ${confidence} confidence and is still building a useful first-pass picture of the business.`);
  }

  return parts.join(" ");
}

function getColorForState(colorKey = "") {
  if (colorKey === "green") return "#2e7d32";
  if (colorKey === "amber") return "#b26a00";
  return "#b42318";
}

function getPieGroupOrder(snapshotGroups = {}) {
  return [
    snapshotGroups.brandCore,
    snapshotGroups.marketSignal,
    snapshotGroups.optimization,
    snapshotGroups.sourceMix,
  ].filter(Boolean);
}

function renderActiveSlice(group) {
  if (!group) {
    activeSliceWrap.style.display = "none";
    return;
  }

  activeSliceWrap.style.display = "block";
  activeSliceTitle.innerText = group.title;
  activeSliceMeta.innerText = `${group.score} / ${group.max} • ${group.stateLabel}`;
  activeSliceSummary.innerText = group.summary || "";

  activeSliceStrengths.innerText = `Strengths\n${toDisplayList(
    group.strengths || [],
    "No clear strengths detected yet."
  )}`;

  activeSliceWeaknesses.innerText = `Weaknesses\n${toDisplayList(
    group.weaknesses || [],
    "No clear weaknesses detected yet."
  )}`;

  activeSliceNextMove.innerText = `Next move\n${group.nextMove || "No next move available yet."}`;
}

function renderSnapshotPie(profile) {
  destroySnapshotPieChart();

  const brandSignalState = profile?.groupedSnapshot?.brandSignalState || {};
  const snapshotGroups = profile?.groupedSnapshot?.snapshotGroups || {};
  const orderedGroups = getPieGroupOrder(snapshotGroups);

  brandSignalScore.innerText = `${brandSignalState.score ?? "--"} / ${brandSignalState.max ?? 100}`;
  brandSignalLabel.innerText = brandSignalState.label || "Not scanned yet";
  brandSignalLabel.style.color = getColorForState(brandSignalState.colorKey);

  if (!snapshotPieCanvas || typeof Chart === "undefined" || orderedGroups.length === 0) return;

  snapshotPieChart = new Chart(snapshotPieCanvas, {
    type: "pie",
    data: {
      labels: orderedGroups.map((group) => group.title),
      datasets: [
        {
          data: orderedGroups.map((group) => group.score),
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        animateRotate: true,
        animateScale: true,
      },
      plugins: {
        legend: {
          position: "bottom",
        },
      },
      onClick: (event, elements) => {
        if (!elements || elements.length === 0) return;
        const index = elements[0].index;
        renderActiveSlice(orderedGroups[index]);
        setTimeout(() => {
          activeSliceWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 60);
      },
    },
  });
}

function renderBrandSnapshot(profile) {
  businessSummaryInput.value = profile?.businessProfile?.summary || "";
  founderGoalDisplay.innerText = profile?.founderGoal || "No goal selected yet.";

  renderSnapshotPie(profile);

  voiceSummaryDisplay.innerText =
    profile?.founderVoice?.voiceSummary || "No voice summary returned yet.";

  recommendedFocusDisplay.innerText =
    profile?.advisorSnapshot?.recommendedFocus || "No recommended focus returned yet.";

  offersDisplay.innerText = toDisplayList(
    profile?.brandProductTruth?.offers || [],
    "No clear offers or services detected yet."
  );

  audienceDisplay.innerText = toDisplayList(
    profile?.brandProductTruth?.audience || [],
    "No clear audience clues detected yet."
  );

  opportunitiesDisplay.innerText = toDisplayList(
    profile?.advisorSnapshot?.opportunities || [],
    "No clear opportunities detected yet."
  );

  channelsDisplay.innerText = channelsToDisplay(profile?.discoveryProfile?.channelsFound || {});
  trustSignalsDisplay.innerText = toDisplayList(
    profile?.discoveryProfile?.trustSignals || [],
    "No clear trust or proof signals were detected yet."
  );
  educationSignalsDisplay.innerText = toDisplayList(
    profile?.discoveryProfile?.educationSignals || [],
    "No clear education signals were detected yet."
  );
  activitySignalsDisplay.innerText = toDisplayList(
    profile?.discoveryProfile?.activitySignals || [],
    "No clear public activity signals were detected yet."
  );
  founderVisibilitySignalsDisplay.innerText = toDisplayList(
    profile?.discoveryProfile?.founderVisibilitySignals || [],
    "No clear founder visibility signals were detected yet."
  );

  intelligenceSummaryDisplay.innerText = buildIntelligenceSummary(profile);
  voiceInput.value = profile?.sourceProfile?.voiceSourceText || "";
}

function clearSnapshotDisplays() {
  businessSummaryInput.value = "";
  founderGoalDisplay.innerText = "No goal selected yet.";
  brandSignalScore.innerText = "-- / 100";
  brandSignalLabel.innerText = "Not scanned yet";
  brandSignalLabel.style.color = "";
  activeSliceWrap.style.display = "none";

  intelligenceSummaryDisplay.innerText = "Brand intelligence summary will appear here after the scan.";
  voiceSummaryDisplay.innerText = "Voice summary will appear here after the scan.";
  recommendedFocusDisplay.innerText = "Recommended focus will appear here after the scan.";
  offersDisplay.innerText = "Offers and services will appear here after the scan.";
  audienceDisplay.innerText = "Audience clues will appear here after the scan.";
  opportunitiesDisplay.innerText = "Opportunities will appear here after the scan.";
  channelsDisplay.innerText = "Detected channels will appear here after the scan.";
  trustSignalsDisplay.innerText = "Trust and proof signals will appear here after the scan.";
  educationSignalsDisplay.innerText = "Education signals will appear here after the scan.";
  activitySignalsDisplay.innerText = "Public activity signals will appear here after the scan.";
  founderVisibilitySignalsDisplay.innerText =
    "Founder visibility signals will appear here after the scan.";
  voiceInput.value = "";

  destroySnapshotPieChart();

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

async function buildInitialProfile() {
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();
  const founderGoal = getFounderGoal();

  clearOutputs();
  clearSnapshotDisplays();
  ownerKbStatus.innerText = "";
  postsPrompt.innerText = "";

  if (!businessUrl && !pastedSourceText) {
    intakeStatus.innerText = "Please add a website URL or owner writing before scanning.";
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
        mode: "hybrid",
        businessUrl,
        founderGoal,
        pastedSourceText,
        manualBusinessContext: "",
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

    renderBrandSnapshot(data.profile);

    intakeStatus.innerText = "Brand snapshot ready.";
    profilePrompt.innerText =
      "Quick glance first. Tap the pie only if you want YEVIB to open up more of the scan before generating outputs.";

    const kbMeta = data.profile?.ownerKbMeta || {};
    if (kbMeta.entryCount > 0) {
      ownerKbStatus.innerText = `Owner KB active — ${kbMeta.entryCount} saved choice${
        kbMeta.entryCount === 1 ? "" : "s"
      } for this business.`;
    } else {
      ownerKbStatus.innerText =
        "Owner KB active — no saved choices yet. It will start learning when you choose posts.";
    }

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
    alert("Inputs changed after the last scan. Scan brand again first.");
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
        manualVoiceInput: voiceInput.value.trim(),
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
        voiceSourceText: voiceInput.value.trim(),
        ownerWritingSample: document.getElementById("pastedSourceText").value.trim(),
        manualBusinessContext: "",
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
    storyLines.push("- Include a late-afternoon work atmosphere if it fits the post.");
  } else {
    storyLines.push("- Panel 1 should show the clearest real-world moment implied by the post.");
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
    storyLines.push(`- Include one panel that shows the origin/craft side of the story: ${originCue}.`);
  }

  storyLines.push("- Do not jump straight to generic product marketing imagery. Start with the human story in the post, then widen outward.");
  storyLines.push("- Make the 4 panels feel like one connected narrative, not 4 random brand photos.");
  storyLines.push("- If the post contains a memory, discovery, or turning point, make that the emotional anchor of the collage.");

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
    "the business";

  const businessSummary =
    initialProfile?.businessProfile?.summary ||
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