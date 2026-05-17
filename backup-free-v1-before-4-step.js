cat > free-v1.js <<'EOF'
const stepButtons = document.querySelectorAll("[data-step]");
const nextButtons = document.querySelectorAll("[data-next]");

let freeV1Profile = null;
let freeV1Posts = [];
let selectedPost = "";

function $(selector) {
  return document.querySelector(selector);
}

function setActiveStep(step) {
  document.querySelectorAll(".side-link, .track-step").forEach((button) => {
    button.classList.toggle("active", button.dataset.step === String(step));
  });

  document.querySelectorAll(".step-card").forEach((card) => {
    card.classList.toggle("focused", card.dataset.panel === String(step));
  });

  const panel = document.querySelector(`[data-panel="${step}"]`);
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getBusinessUrl() {
  return ($("#businessUrl")?.value || "").trim();
}

function getOwnerTruth() {
  return [
    ($("#ownerTruth")?.value || "").trim(),
    ($("#ownerMisunderstanding")?.value || "").trim(),
  ].filter(Boolean).join("\n\n");
}

function setButtonLoading(button, text) {
  if (!button) return;
  button.dataset.originalText = button.dataset.originalText || button.innerHTML;
  button.disabled = true;
  button.innerHTML = text;
}

function resetButton(button) {
  if (!button) return;
  button.disabled = false;
  if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
}

function setScanRows(state = "loading") {
  const rows = document.querySelectorAll(".scan-row");

  rows.forEach((row, index) => {
    row.classList.remove("done", "active", "muted");

    if (state === "loading") {
      if (index < 3) row.classList.add("done");
      if (index === 3) row.classList.add("active");
      if (index > 3) row.classList.add("muted");
    }

    if (state === "done") {
      row.classList.add("done");
      const strong = row.querySelector("strong");
      if (strong) {
        strong.className = "";
        strong.textContent = "✓";
      }
    }

    if (state === "error") {
      if (index === 0) row.classList.add("active");
      if (index > 0) row.classList.add("muted");
    }
  });
}

function getProfileBusinessName(profile) {
  return (
    profile?.businessProfile?.name ||
    profile?.brandProductTruth?.businessName ||
    "this business"
  );
}

function getRecommendedMove(profile) {
  return (
    profile?.executionPlan?.summary ||
    profile?.groupedSnapshot?.recommendedFocus ||
    profile?.advisorSnapshot?.recommendedFocus ||
    "Show the business more clearly through one useful, owner-led post."
  );
}

function renderRecommendation(profile) {
  const card = document.querySelector('[data-panel="4"] .recommend-box');
  if (!card) return;

  const businessName = getProfileBusinessName(profile);
  const move = getRecommendedMove(profile);
  const actions = Array.isArray(profile?.executionPlan?.actions)
    ? profile.executionPlan.actions.slice(0, 4)
    : [];

  card.innerHTML = `
    <p class="label">🌿 Top Recommendation</p>
    <h3>${escapeHtml(move)}</h3>
    <p>${escapeHtml(businessName)} has enough signal for a practical first content move. YEVIB is focusing on the clearest useful action from the scan.</p>

    <h4>Why this is the next move</h4>
    <ul>
      ${
        actions.length
          ? actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
          : `
            <li>Clarifies what the business does</li>
            <li>Builds trust from available website signals</li>
            <li>Gives the owner one usable post instead of a long strategy list</li>
            <li>Keeps claims grounded in the scan</li>
          `
      }
    </ul>
  `;
}

function renderPostOptions(posts) {
  const wrap = $(".post-options");
  if (!wrap) return;

  freeV1Posts = posts.slice(0, 3);
  selectedPost = freeV1Posts[0] || "";

  wrap.innerHTML = freeV1Posts.map((post, index) => `
    <div class="post-option ${index === 0 ? "recommended selected" : ""}" data-post-index="${index}">
      ${index === 0 ? "<small>⭐ Recommended</small>" : ""}
      <h3>Option ${index + 1}</h3>
      <p>${escapeHtml(post)}</p>
      <ul>
        <li>${index === 0 ? "Best first move" : "Alternative angle"}</li>
        <li>Grounded from scan</li>
        <li>Review before posting</li>
      </ul>
    </div>
  `).join("");

  document.querySelectorAll("[data-post-index]").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll("[data-post-index]").forEach((item) => item.classList.remove("selected"));
      card.classList.add("selected");
      selectedPost = freeV1Posts[Number(card.dataset.postIndex)] || "";
      renderReadyToUse();
    });
  });

  renderReadyToUse();
}

function renderVisualDirection(profile) {
  const visualText = document.querySelector('[data-panel="6"] .visual-layout > div');
  const businessName = getProfileBusinessName(profile);

  if (!visualText) return;

  visualText.innerHTML = `
    <h4>Visual Direction</h4>
    <p>Use a real owner-shot style photo that matches ${escapeHtml(businessName)}. Show the real work context, practical environment, and human trust signal. Avoid fake branding, fake signage, unreadable text, or invented claims.</p>

    <h4>Suggested Overlay Text</h4>
    <p>No text overlay preferred for Free V1 unless the owner supplies approved words.</p>

    <h4>Tone</h4>
    <div class="tone-tags"><span>Real</span><span>Owner-shot</span><span>Trustworthy</span></div>
  `;
}

function renderReadyToUse() {
  const finalPost = $(".final-post");
  if (!finalPost) return;

  finalPost.innerHTML = `
    <h4>Your Post</h4>
    <p>${escapeHtml(selectedPost || "Choose a post option first.")}</p>

    <div class="button-row">
      <button type="button" id="copyFinalPostBtn">Copy Text</button>
      <button type="button">Save Draft</button>
    </div>
  `;

  const copyBtn = $("#copyFinalPostBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      if (!selectedPost) return;
      await navigator.clipboard.writeText(selectedPost);
      copyBtn.textContent = "Copied";
    });
  }
}

function parsePosts(text = "") {
  return String(text || "")
    .split(/\n{2,}/)
    .map((item) => item.replace(/^Post\s*\d+[:.)-]?\s*/i, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

async function runFreeV1Scan(button) {
  const businessUrl = getBusinessUrl();
  const ownerTruth = getOwnerTruth();

  if (!businessUrl) {
    alert("Add a business website URL first.");
    return;
  }

  setButtonLoading(button, "Scanning...");
  setActiveStep(3);
  setScanRows("loading");

  try {
    const profileRes = await fetch("/build-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "hybrid",
        businessUrl,
        pastedSourceText: ownerTruth,
        manualBusinessContext: ownerTruth,
        founderGoal: ownerTruth,
        ownerWritingSample: ownerTruth,
      }),
    });

    const profileData = await profileRes.json();

    if (!profileRes.ok) {
      throw new Error(profileData.error || "Failed to scan business.");
    }

    freeV1Profile = profileData.profile;
    setScanRows("done");
    renderRecommendation(freeV1Profile);
    setActiveStep(4);

    const generateRes = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "execution",
        idea: getRecommendedMove(freeV1Profile),
        category: freeV1Profile?.contentProfile?.suggestedCategory || "Product in Real Life",
        businessUrl,
        pastedSourceText: ownerTruth,
        manualBusinessContext: ownerTruth,
        businessSummary: freeV1Profile?.businessProfile?.summary || "",
        manualVoiceInput: ownerTruth,
        voiceProfile: freeV1Profile?.founderVoice || null,
        initialProfile: freeV1Profile,
        quickType: "Business",
        ownerNudge: "",
        founderGoal: ownerTruth,
        weeklyPosts: [
          freeV1Profile?.executionPlan?.summary || "",
          ...(freeV1Profile?.executionPlan?.actions || []),
        ].filter(Boolean).join("\n"),
      }),
    });

    const generateData = await generateRes.json();

    if (!generateRes.ok) {
      throw new Error(generateData.error || "Failed to generate posts.");
    }

    const posts = parsePosts(generateData.text);

    if (!posts.length) {
      throw new Error("YEVIB did not return usable post options.");
    }

    renderPostOptions(posts);
    renderVisualDirection(freeV1Profile);
    setActiveStep(5);
  } catch (err) {
    setScanRows("error");
    alert(err.message);
    setActiveStep(1);
  } finally {
    resetButton(button);
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

stepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveStep(button.dataset.step);
  });
});

nextButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const next = button.dataset.next;

    if (next === "3") {
      await runFreeV1Scan(button);
      return;
    }

    if (next === "6") {
      renderVisualDirection(freeV1Profile || {});
    }

    if (next === "7") {
      renderReadyToUse();
    }

    setActiveStep(next);
  });
});

setActiveStep(1);
EOF