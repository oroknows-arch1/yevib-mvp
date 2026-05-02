const postsDiv = document.getElementById("posts");
const selectedPostBox = document.getElementById("selectedPost");
const generatedImage = document.getElementById("generatedImage");

let selectedPost = "";

const imageStatus = document.getElementById("imageStatus");
const approvePostBtn = document.getElementById("approvePostBtn");

const intakeStatus = document.getElementById("intakeStatus");
const ownerKbStatus = document.getElementById("ownerKbStatus");
const sourceChangePrompt = document.getElementById("sourceChangePrompt");
const profilePrompt = document.getElementById("profilePrompt");
const postsPrompt = document.getElementById("postsPrompt");
const generatePrompt = document.getElementById("generatePrompt");

const founderGoalInput = document.getElementById("founderGoal");
const businessSummaryInput = document.getElementById("businessSummary");
const pastedSourceTextInput = document.getElementById("pastedSourceText");
const businessUrlInput = document.getElementById("businessUrl");

const generatePostsBtn = document.getElementById("generatePostsBtn");
const runPlanBtn = document.getElementById("runPlanBtn");
const runPlanStatus = document.getElementById("runPlanStatus");

const founderGoalDisplay = document.getElementById("founderGoalDisplay");
const brandSignalScore = document.getElementById("brandSignalScore");
const brandSignalLabel = document.getElementById("brandSignalLabel");

const toggleBrandIntelligenceBtn = document.getElementById("toggleBrandIntelligenceBtn");
const continueToGenerateBtn = document.getElementById("continueToGenerateBtn");
const brandIntelligenceDrawer = document.getElementById("brandIntelligenceDrawer");

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

const executionSummary = document.getElementById("executionSummary");
const executionEta = document.getElementById("executionEta");
const executionOutcome = document.getElementById("executionOutcome");
const executionActions = document.getElementById("executionActions");

const primaryStrategyDisplay = document.getElementById("primaryStrategyDisplay");
const supportingStrategiesDisplay = document.getElementById("supportingStrategiesDisplay");
const chosenMoveDisplay = document.getElementById("chosenMoveDisplay");
const successSignalDisplay = document.getElementById("successSignalDisplay");

const activeSliceWrap = document.getElementById("activeSliceWrap");
const activeSliceTitle = document.getElementById("activeSliceTitle");
const activeSliceMeta = document.getElementById("activeSliceMeta");
const activeSliceSummary = document.getElementById("activeSliceSummary");
const activeSliceNextMove = document.getElementById("activeSliceNextMove");
const activeSliceStrengths = document.getElementById("activeSliceStrengths");
const activeSliceWeaknesses = document.getElementById("activeSliceWeaknesses");
const closeActiveSliceBtn = document.getElementById("closeActiveSliceBtn");

const lensButtons = document.querySelectorAll(".lens-btn");
const feelingButtons = document.querySelectorAll(".feeling-btn");
const selectedLensPrompt = document.getElementById("selectedLensPrompt");
const feelingPrompt = document.getElementById("feelingPrompt");
const customFeelingInput = document.getElementById("customFeeling");



let initialProfile = null;
let selectedLens = "";
let selectedFeeling = "";
let snapshotChart = null;
let activeSliceIndex = null;

/* ------------------ SCREEN FLOW ------------------ */

const appScreens = {
  intake: document.getElementById("section-intake"),
  profile: document.getElementById("section-profile"),
  generate: document.getElementById("section-generate"),
  posts: document.getElementById("section-posts"),
  output: document.getElementById("section-output"),
};

const screenExtras = {
  profile: [document.getElementById("executionPlanWrap")],
};

function showAppScreen(screenName = "intake") {
  Object.values(appScreens).forEach((section) => {
    if (!section) return;
    section.style.display = "none";
    section.style.opacity = "0";
    section.style.transform = "translateY(12px)";
  });

  Object.values(screenExtras).flat().forEach((extra) => {
    if (!extra) return;
    extra.style.display = "none";
    extra.style.opacity = "0";
    extra.style.transform = "translateY(12px)";
  });

  const activeScreen = appScreens[screenName] || appScreens.intake;

  if (activeScreen) {
    activeScreen.style.display = "block";
    activeScreen.style.opacity = "0";
    activeScreen.style.transform = "translateY(12px)";
    activeScreen.style.transition = "opacity 650ms ease, transform 650ms ease";

    requestAnimationFrame(() => {
      activeScreen.style.opacity = "1";
      activeScreen.style.transform = "translateY(0)";
    });

    activeScreen.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  (screenExtras[screenName] || []).forEach((extra) => {
    if (!extra) return;

    extra.style.display = "block";
    extra.style.opacity = "0";
    extra.style.transform = "translateY(12px)";
    extra.style.transition = "opacity 650ms ease, transform 650ms ease";

    requestAnimationFrame(() => {
      extra.style.opacity = "1";
      extra.style.transform = "translateY(0)";
    });
  });
}

showAppScreen("intake");


/* ------------------ CORE HELPERS ------------------ */

function getFounderGoal() {
  return founderGoalInput?.value?.trim() || "";
}

function getBusinessSummary() {
  return businessSummaryInput?.value?.trim() || "";
}

function getPastedSourceText() {
  return pastedSourceTextInput?.value?.trim() || "";
}

function getBusinessUrl() {
  return businessUrlInput?.value?.trim() || "";
}

function getOwnerFeeling() {
  const custom = customFeelingInput?.value?.trim();
  return custom || selectedFeeling || "";
}

function safeJoin(items, fallback = "Not enough signal yet.") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return "• " + items.join("\n• ");
}

function safeText(value, fallback = "Not enough signal yet.") {
  const text = String(value || "").trim();
  return text || fallback;
}

function renderSourceImprovementPrompt(profile = {}) {
  if (!sourceChangePrompt) return;

  const guidance = profile?.sourceImprovementGuidance || {};
  const shouldImproveSources = guidance?.shouldImproveSources === true;
  const minimumUsefulAction = safeText(guidance?.minimumUsefulAction, "");

  if (
    !shouldImproveSources ||
    !minimumUsefulAction ||
    minimumUsefulAction === "No extra source material is needed right now."
  ) {
    sourceChangePrompt.innerText = "";
    return;
  }

  sourceChangePrompt.innerText =
    `To make this scan more useful, add one real proof point: ${minimumUsefulAction} This helps YEVIB give advice based on what the business can actually prove.`;
}

function clearOutputs() {
  postsDiv.innerHTML = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";
  postsPrompt.innerText = "";
  selectedPost = "";

  if (approvePostBtn) {
    approvePostBtn.style.display = "none";
    approvePostBtn.disabled = true;
    approvePostBtn.innerText = "Approve & Continue";
  }
}

function clearSnapshotUI() {
  founderGoalDisplay.innerText = "No goal selected yet.";
  brandSignalScore.innerText = "-- / 100";
  brandSignalLabel.innerText = "Not scanned yet";

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
  founderVisibilitySignalsDisplay.innerText = "Founder visibility signals will appear here after the scan.";
    voiceInput.value = "";

  if (sourceChangePrompt) {
    sourceChangePrompt.innerText = "";
  }
  
  executionSummary.innerText = "";
  executionEta.innerText = "";
  executionOutcome.innerText = "";
  executionActions.innerHTML = "";

  toggleBrandIntelligenceBtn.style.display = "none";
  continueToGenerateBtn.style.display = "none";
  brandIntelligenceDrawer.style.display = "none";

if (runPlanStatus) {
  runPlanStatus.innerText = "";
}
  closeActiveSlice();
  destroySnapshotChart();
}

function destroySnapshotChart() {
  if (snapshotChart) {
    snapshotChart.destroy();
    snapshotChart = null;
  }
}

function scrollToGenerateSection() {
  showAppScreen("generate");
}

function formatChannelList(channels = {}) {
  const found = [];

  if (channels.instagram) found.push("Instagram");
  if (channels.facebook) found.push("Facebook");
  if (channels.tiktok) found.push("TikTok");
  if (channels.youtube) found.push("YouTube");
  if (channels.x) found.push("X");
  if (channels.linkedin) found.push("LinkedIn");

  return found.length ? "• " + found.join("\n• ") : "No public channels detected yet.";
}

/* ------------------ LENS + FEELING ------------------ */

lensButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    lensButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedLens = btn.dataset.type || "";
    selectedLensPrompt.innerText = selectedLens
      ? `Selected lens: ${selectedLens}`
      : "";
  });
});

feelingButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    feelingButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedFeeling = btn.dataset.feeling || "";
    if (customFeelingInput) customFeelingInput.value = "";
    feelingPrompt.innerText = selectedFeeling
      ? `Selected feeling: ${selectedFeeling}`
      : "";
  });
});

if (customFeelingInput) {
  customFeelingInput.addEventListener("input", () => {
    if (customFeelingInput.value.trim()) {
      feelingButtons.forEach((b) => b.classList.remove("selected"));
      selectedFeeling = "";
      feelingPrompt.innerText = `Custom feeling: ${customFeelingInput.value.trim()}`;
    } else {
      feelingPrompt.innerText = "";
    }
  });
}

/* ------------------ PIE CHART / SNAPSHOT ------------------ */

function closeActiveSlice() {
  activeSliceIndex = null;
  activeSliceWrap.style.display = "none";
  activeSliceTitle.innerText = "Snapshot Detail";
  activeSliceMeta.innerText = "";
  activeSliceSummary.innerText = "";
  activeSliceNextMove.innerText = "";
  activeSliceStrengths.innerText = "";
  activeSliceWeaknesses.innerText = "";
}

function openActiveSlice(group, index) {
  activeSliceIndex = index;
  activeSliceWrap.style.display = "block";

  activeSliceTitle.innerText = group.title || "Snapshot Detail";
  activeSliceMeta.innerText = `${group.score || 0}/${group.max || 0} • ${group.stateLabel || "Unknown"}`;
  activeSliceSummary.innerText = safeText(group.summary, "No summary yet.");
  activeSliceNextMove.innerText = safeText(group.nextMove, "No next move yet.");
  activeSliceStrengths.innerText = `Strengths\n${safeJoin(group.strengths, "• Not enough strengths detected yet.")}`;
  activeSliceWeaknesses.innerText = `Weaknesses\n${safeJoin(group.weaknesses, "• No clear weaknesses detected yet.")}`;
}

function renderSnapshotChart(groupedSnapshot) {
  const canvas = document.getElementById("snapshotPieChart");
  if (!canvas || !groupedSnapshot || !Array.isArray(groupedSnapshot.groups)) return;

  destroySnapshotChart();

  const groups = groupedSnapshot.groups;
  const labels = groups.map((g) => g.title || "Group");
  const data = groups.map((g) => g.score || 0);

  snapshotChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          data
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const group = groups[context.dataIndex];
              return `${group.title}: ${group.score}/${group.max} (${group.stateLabel})`;
            }
          }
        }
      },
      onClick: (event, elements) => {
        if (!elements || elements.length === 0) return;

        const index = elements[0].index;

        if (activeSliceIndex === index) {
          closeActiveSlice();
          return;
        }

        const group = groups[index];
        openActiveSlice(group, index);
      }
    }
  });
}

function populateSnapshot(profile) {
  const groupedSnapshot = profile?.groupedSnapshot || {};
  const advisorSnapshot = profile?.advisorSnapshot || {};
  const founderVoice = profile?.founderVoice || {};
  const brandProductTruth = profile?.brandProductTruth || {};
  const discoveryProfile = profile?.discoveryProfile || {};
  const sourceProfile = profile?.sourceProfile || {};
  const strategyEngine = profile?.strategyEngine || {};
const chosenMove = profile?.chosenMove || {};
const executionPlan = profile?.executionPlan || {};

primaryStrategyDisplay.innerText = safeText(
  strategyEngine?.primaryStrategy?.name || strategyEngine?.primaryStrategy?.title,
  "Strategy will appear here after the scan."
);

supportingStrategiesDisplay.innerText = safeJoin(
  (strategyEngine?.supportingStrategies || []).map(
    (s) => s?.name || s?.title || ""
  ),
  "Supporting strategies will appear here."
);

// WHY THIS MOVE
chosenMoveDisplay.innerText = safeText(
  chosenMove?.reason,
  "Decision logic will appear here."
);

// SUCCESS SIGNAL
successSignalDisplay.innerText = safeText(
  executionPlan?.successSignal,
  "Success signal will appear here."
);

  businessSummaryInput.value = safeText(profile?.businessProfile?.summary, "");
  founderGoalDisplay.innerText = getFounderGoal() || "No goal selected yet.";

  brandSignalScore.innerText = `${groupedSnapshot?.overallPct ?? "--"} / 100`;
  brandSignalLabel.innerText = groupedSnapshot?.overallStateLabel || "Not scanned yet";

  intelligenceSummaryDisplay.innerText = safeText(
    profile?.intelligenceRead,
    "Brand intelligence summary will appear here after the scan."
  );

  voiceSummaryDisplay.innerText = safeText(
    founderVoice?.voiceSummary,
    "Voice summary will appear here after the scan."
  );

  recommendedFocusDisplay.innerText = safeText(
    groupedSnapshot?.recommendedFocus || advisorSnapshot?.recommendedFocus,
    "Recommended focus will appear here after the scan."
  );

  offersDisplay.innerText = safeJoin(
    brandProductTruth?.offers,
    "Offers and services will appear here after the scan."
  );

  audienceDisplay.innerText = safeJoin(
    brandProductTruth?.audience,
    "Audience clues will appear here after the scan."
  );

  opportunitiesDisplay.innerText = safeJoin(
    advisorSnapshot?.opportunities,
    "Opportunities will appear here after the scan."
  );

  channelsDisplay.innerText = formatChannelList(discoveryProfile?.channelsFound || {});
  trustSignalsDisplay.innerText = safeJoin(
    discoveryProfile?.trustSignals,
    "Trust and proof signals will appear here after the scan."
  );

  educationSignalsDisplay.innerText = safeJoin(
    discoveryProfile?.educationSignals,
    "Education signals will appear here after the scan."
  );

  activitySignalsDisplay.innerText = safeJoin(
    discoveryProfile?.activitySignals,
    "Public activity signals will appear here after the scan."
  );

  founderVisibilitySignalsDisplay.innerText = safeJoin(
    discoveryProfile?.founderVisibilitySignals,
    "Founder visibility signals will appear here after the scan."
  );

  voiceInput.value = safeText(
    sourceProfile?.voiceSourceText,
    ""
  );
    populateExecutionPlan(profile);
  renderSourceImprovementPrompt(profile);

  toggleBrandIntelligenceBtn.style.display = "inline-flex";
  continueToGenerateBtn.style.display = "inline-flex";

  renderSnapshotChart(groupedSnapshot);
}

function populateExecutionPlan(profile) {
  const plan = profile?.executionPlan || {};

  // RESET FIRST (IMPORTANT)
  executionSummary.innerText = "";
  executionEta.innerText = "";
  executionOutcome.innerText = "";
  executionActions.innerHTML = "";

  // ✅ SUMMARY (THIS is your "YEVIB WILL DO")
  executionSummary.innerText = plan.summary || "";

  // ✅ ADD CORE CAMPAIGN (THIS IS WHAT YOU’RE MISSING)
  if (plan.coreCampaign) {
    const core = document.createElement("p");
    core.style.marginTop = "10px";
    core.style.fontWeight = "600";
    core.innerText = `Core Campaign: ${plan.coreCampaign}`;
    executionSummary.appendChild(core);
  }

  // ✅ SCHEDULE
  if (plan.schedule) {
    const schedule = document.createElement("p");
    schedule.style.marginTop = "6px";
    schedule.innerText = `Schedule: ${plan.schedule}`;
    executionSummary.appendChild(schedule);
  }

  // ✅ ETA
  if (plan.eta) {
    executionEta.innerText =
      `ETA: Setup ${plan.eta.setup}, First signal ${plan.eta.firstSignal}, Compounding ${plan.eta.compounding}`;
  }

  // ✅ EXPECTED OUTCOME
  if (plan.expectedOutcome) {
    executionOutcome.innerText =
      `Expected: ${plan.expectedOutcome.likely}`;
  }

  // ✅ ACTIONS (MAIN LIST)
  (plan.actions || []).forEach((action) => {
    const li = document.createElement("li");
    li.innerText = action;
    executionActions.appendChild(li);
  });

  // ✅ 🔥 THIS IS THE BIG ONE → CAMPAIGN LAYERS
  if (plan.campaignLayers) {
    const layersWrap = document.createElement("div");
    layersWrap.style.marginTop = "15px";

    Object.entries(plan.campaignLayers).forEach(([key, items]) => {
      const title = document.createElement("h4");
      title.innerText = key.toUpperCase();
      title.style.marginTop = "10px";

      const ul = document.createElement("ul");

      items.forEach((item) => {
        const li = document.createElement("li");
        li.innerText = item;
        ul.appendChild(li);
      });

      layersWrap.appendChild(title);
      layersWrap.appendChild(ul);
    });

    executionActions.appendChild(layersWrap);
  }

  // ✅ TOOLS
  if (plan.tools?.length) {
    const tools = document.createElement("p");
    tools.style.marginTop = "10px";
    tools.innerText = `Tools: ${plan.tools.join(", ")}`;
    executionActions.appendChild(tools);
  }

  // ✅ SUCCESS SIGNAL
  if (plan.successSignal) {
    const success = document.createElement("p");
    success.style.marginTop = "10px";
    success.innerText = `Success looks like: ${plan.successSignal}`;
    executionActions.appendChild(success);
  }
}

async function runAgentCycle() {
  if (!initialProfile) return null;

  if (runPlanBtn) {
    runPlanBtn.disabled = true;
    runPlanBtn.innerText = "Running Plan...";
  }

  if (runPlanStatus) {
    runPlanStatus.innerText = "YEVIB is running the current strategy cycle...";
  }

  try {
    const res = await fetch("/run-agent-cycle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ profile: initialProfile })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Agent cycle failed:", data.error);

      if (runPlanStatus) {
        runPlanStatus.innerText = "Plan run failed.";
      }

      return null;
    }

    initialProfile = data.profile;
      console.log("UBDG PACKET (SCAN):", initialProfile?.ubdgEvidencePacket);
    populateSnapshot(initialProfile);

    if (runPlanStatus) {
      runPlanStatus.innerText = "Plan run complete. YEVIB refreshed the strategy cycle.";
    }

    console.log("Agent cycle complete:", data.runLog);
    return data;
  } catch (err) {
    console.error("Agent cycle error:", err.message);

    if (runPlanStatus) {
      runPlanStatus.innerText = `Plan run error: ${err.message}`;
    }

    return null;
  } finally {
    if (runPlanBtn) {
      runPlanBtn.disabled = false;
      runPlanBtn.innerText = "Run This Plan";
    }
  }
}

async function runPlanAndGenerateFirstArtifact() {
  if (!initialProfile) return;

  const cycleResult = await runAgentCycle();

  if (!cycleResult) return;

  if (!selectedLens) {
    selectedLens = "Business";

    lensButtons.forEach((btn) => {
      const isBusiness = (btn.dataset.type || "") === "Business";
      btn.classList.toggle("selected", isBusiness);
    });

    selectedLensPrompt.innerText = "Selected lens: Business";
  }

  if (runPlanStatus) {
    runPlanStatus.innerText = "YEVIB completed the strategy cycle and is now generating the first execution artifact...";
  }

  generatePrompt.innerText = "YEVIB is generating the first execution artifact...";
  await generateExecutionPlan();

    showAppScreen("posts");

  if (runPlanStatus) {
    runPlanStatus.innerText = "First execution artifact generated. Review the post options below.";
  }
}

function selectPost(post, element) {
  selectedPost = post;

  if (selectedPostBox) {
    selectedPostBox.innerText = post;
  }

  document.querySelectorAll(".post-choice-card").forEach((el) => {
    el.classList.remove("selected");
    el.style.border = "";
  });

  if (element) {
    element.classList.add("selected");
    element.style.border = "2px solid #2563eb";
  }

  if (approvePostBtn) {
    approvePostBtn.disabled = false;
    approvePostBtn.innerText = "Approve & Continue";
  }
}

/* ------------------ BUILD PROFILE ------------------ */

async function buildInitialProfile() {
  const businessUrl = getBusinessUrl();
  const pastedSourceText = getPastedSourceText();

  clearOutputs();
  clearSnapshotUI();

  if (!businessUrl && !pastedSourceText) {
    intakeStatus.innerText = "Add a website or text first.";
    return;
  }

  intakeStatus.innerText = "Scanning brand...";
  profilePrompt.innerText = "";
  generatePrompt.innerText = "";

  try {
    const res = await fetch("/build-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "hybrid",
        businessUrl,
        pastedSourceText,
        founderGoal: getFounderGoal(),
        ownerWritingSample: pastedSourceText
      })
        });

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = "Scan failed: " + (data.error || "Failed to build profile.");
      return;
    }

    initialProfile = data.profile;

    console.log("UBDG PACKET (RAW SCAN):", data.profile?.ubdgEvidencePacket);

    await runAgentCycle();

    intakeStatus.innerText = "Brand scan complete.";
    profilePrompt.innerText = "Snapshot ready. YEVIB has run its agent cycle. Open Brand Intelligence or continue to content action.";
    

        if (initialProfile?.ownerKbMeta?.entryCount) {
      ownerKbStatus.innerText = `Owner KB entries found for this business: ${initialProfile.ownerKbMeta.entryCount}`;
    } else {
      ownerKbStatus.innerText = "No owner KB history detected for this business yet.";
    }

    showAppScreen("profile");
  } catch (err) {
    intakeStatus.innerText = "Error: " + err.message;
  }
}

/* ------------------ BRAND INTELLIGENCE TOGGLE ------------------ */

if (toggleBrandIntelligenceBtn) {
  toggleBrandIntelligenceBtn.addEventListener("click", () => {
    const isOpen = brandIntelligenceDrawer.style.display === "block";
    brandIntelligenceDrawer.style.display = isOpen ? "none" : "block";
    toggleBrandIntelligenceBtn.innerText = isOpen
      ? "Open Brand Intelligence"
      : "Close Brand Intelligence";
  });
}

if (continueToGenerateBtn) {
  continueToGenerateBtn.addEventListener("click", () => {
    scrollToGenerateSection();
  });
}

if (runPlanBtn) {
  runPlanBtn.addEventListener("click", async () => {
    await runPlanAndGenerateFirstArtifact();
  });
}

if (approvePostBtn) {
  approvePostBtn.addEventListener("click", async () => {
    if (!selectedPost) {
      alert("Select a post first.");
      return;
    }

    approvePostBtn.disabled = true;
    approvePostBtn.innerText = "Generating Image...";

    selectedPostBox.innerText = selectedPost;
    imageStatus.innerText = "Generating image from approved post...";

    await generateImage(selectedPost);

    approvePostBtn.innerText = "Approved";
    approvePostBtn.disabled = false;

        showAppScreen("output");
  });
}

/* ------------------ EXECUTION ENGINE ------------------ */

async function handleGeneratePostsClick() {
  if (!initialProfile) {
    alert("Scan first.");
    return;
  }

  if (!selectedLens) {
    alert("Choose a lens first.");
    return;
  }

  generatePrompt.innerText = "Generating posts...";
  await generateExecutionPlan();
}

async function generateExecutionPlan() {
  postsDiv.innerHTML = "Generating...";
  postsPrompt.innerText = "YEVIB is generating your posts.";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode: "execution",
        idea: initialProfile?.executionPlan?.instruction || initialProfile?.groupedSnapshot?.recommendedFocus || "Best next move",
        category: initialProfile?.contentProfile?.suggestedCategory || "Product in Real Life",
        businessUrl: getBusinessUrl(),
        pastedSourceText: getPastedSourceText(),
        businessSummary: getBusinessSummary(),
        manualVoiceInput: getPastedSourceText(),
        voiceProfile: initialProfile?.founderVoice || null,
        initialProfile,
        quickType: selectedLens,
        ownerNudge: getOwnerFeeling(),
        founderGoal: getFounderGoal(),
        weeklyPosts: [
          initialProfile?.executionPlan?.summary || "",
          ...(initialProfile?.executionPlan?.actions || [])
        ].filter(Boolean).join("\n")
      })
    });

    const data = await res.json();

    if (!res.ok) {
      postsDiv.innerHTML = "Error: " + (data.error || "Failed.");
      generatePrompt.innerText = "Post generation failed.";
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    renderPostChoices(posts);
    generatePrompt.innerText = "Posts ready. Choose the one that feels most right.";
    showAppScreen("posts");
  } catch (err) {
    postsDiv.innerHTML = "Error: " + err.message;
    generatePrompt.innerText = "Post generation failed.";
  }
}

/* ------------------ POST SELECTION ------------------ */

function renderPostChoices(posts) {
  postsDiv.innerHTML = "";
  postsPrompt.innerText = "Choose one, then click Approve & Continue.";
  selectedPost = "";
  selectedPostBox.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  imageStatus.innerText = "";

  if (approvePostBtn) {
    approvePostBtn.style.display = "inline-block";
    approvePostBtn.disabled = true;
    approvePostBtn.innerText = "Approve & Continue";
  }

  posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "post-choice-card";
    card.innerText = post;

    card.onclick = () => {
      document.querySelectorAll(".post-choice-card").forEach((el) => {
        el.classList.remove("selected");
        el.style.border = "";
      });

      selectPost(post, card);
    };

    postsDiv.appendChild(card);
  });
}

/* ------------------ IMAGE ------------------ */

async function generateImage(post = selectedPost) {
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
Create a documentary-realistic 4-panel collage image that follows the storyline of this exact post in sequence.

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

PRIMARY INSTRUCTION:
- do NOT make a generic brand collage
- do NOT make 4 similar product shots
- do NOT summarize the industry in a broad way
- the image must visually retell the post from panel 1 to panel 4
- each panel must show a different beat in the post's meaning
- the 4 panels must work like a visual explanation of the post
- the viewer should understand the post even without reading it

MANDATORY PANEL LOGIC:
- Panel 1 = the cause, source, setting, or origin mentioned in the post
- Panel 2 = the method, craft, process, effort, or standard described in the post
- Panel 3 = the transformation, proof, or key difference described in the post
- Panel 4 = the outcome, lived use, felt result, or final meaning of the post

PANEL DISCIPLINE RULES:
- all 4 panels must be different from one another
- no repeated angle of the same bowl, jar, product, or person
- no filler panels
- no vague lifestyle shots unless the post clearly calls for them
- if the post names a place, source, material, ritual, sequence, or standard, the panels must reflect that sequence
- if the post contains comparison logic such as why this source matters, why this process matters, or why this result matters, the panels must make that logic visible
- if the founder voice is present in the post, include a human sourcing, choosing, preparing, teaching, or demonstrating where appropriate
- if the post is product-based, show the product in process and result, not just beauty shots
- if the post is service-based, show the service through human action, environment, and outcome

FOR THIS IMAGE, PRIORITISE:
1. exact post meaning over generic brand mood
2. sequence over aesthetics
3. proof over decoration
4. real-world scenes over abstract symbolism

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
- grounded, believable, human scenes
- warm natural lighting unless the website identity clearly suggests a cooler or cleaner tone
- visually rich but not fantasy-like
- no over-stylised ad look
- no polished stock-photo feeling
- where possible, show action, environment, process, and result
- if one panel shows origin, another should show method, another transformation, another lived outcome

AVOID:
- generic premium lifestyle collage
- generic artisanal workshop montage
- repeated bowl shots
- repeated product close-ups
- empty aesthetic filler
- anything visually off-brand or unrelated to the business
${avoidRules ? `- ${avoidRules}` : ""}

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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imagePrompt,
        discoveryProfile: initialProfile?.discoveryProfile || {}
      })
    });

    const data = await res.json();

    if (!res.ok || !data.imageUrl) {
      generatedImage.style.display = "none";
      generatedImage.src = "";
      imageStatus.innerText = "Image failed: " + (data.error || "No image returned.");
      return;
    }

    generatedImage.src = data.imageUrl;
    generatedImage.style.display = "block";
    imageStatus.innerText = "Execution complete.";
  } catch (err) {
    generatedImage.style.display = "none";
    generatedImage.src = "";
    imageStatus.innerText = "Error: " + err.message;
  }
}
window.buildInitialProfile = buildInitialProfile;
window.handleGeneratePostsClick = handleGeneratePostsClick;