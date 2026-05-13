const stepButtons = document.querySelectorAll("[data-step]");
const nextButtons = document.querySelectorAll("[data-next]");

function setActiveStep(step) {
  document.querySelectorAll(".side-link, .track-step").forEach((button) => {
    button.classList.toggle("active", button.dataset.step === String(step));
  });

  document.querySelectorAll(".step-card").forEach((card) => {
    card.classList.toggle("focused", card.dataset.panel === String(step));
  });
}

stepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveStep(button.dataset.step);
  });
});

nextButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveStep(button.dataset.next);
  });
});

setActiveStep(1);
