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

let initialProfile = null;
let selectedPost = "";

/* ------------------ CORE HELPERS ------------------ */

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
  const businessUrl = document.getElementById("businessUrl").value.trim();
  const pastedSourceText = document.getElementById("pastedSourceText").value.trim();

  clearOutputs();

  if (!businessUrl && !pastedSourceText) {
    intakeStatus.innerText = "Add a website or text first.";
    return;
  }

  intakeStatus.innerText = "Scanning and building execution plan...";

  try {
    const res = await fetch("/build-profile", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessUrl,
        pastedSourceText,
        founderGoal: getFounderGoal(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      intakeStatus.innerText = data.error || "Scan failed.";
      return;
    }

    initialProfile = data.profile;

    intakeStatus.innerText = "Execution plan ready.";
    profilePrompt.innerText = "Press generate to execute your plan.";

  } catch (err) {
    intakeStatus.innerText = "Error: " + err.message;
  }
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

  generateExecutionPlan();
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

${plan.actions.join("\n")}

CONSTRAINT:
${plan.constraint}

SCHEDULE:
${plan.schedule}
        `,
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
      document.querySelectorAll(".post-choice-card").forEach(el => {
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
      body: JSON.stringify({ post }),
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

generatePostsBtn.addEventListener("click", handleGeneratePostsClick);