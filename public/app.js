async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const surveyForm = document.querySelector("#survey-form");
if (surveyForm) {
  async function initializeSurvey() {
    const message = document.querySelector("#survey-message");
    try {
      const questions = await request("/api/questions");
      const answers = Object.fromEntries(questions.map(({ id }) => [id, ""]));
      let index = 0;
      const questionLabel = document.querySelector("#survey-question");
      const answerField = document.querySelector("#survey-answer");
      const back = document.querySelector("#survey-back");
      const next = document.querySelector("#survey-next");
      const submit = document.querySelector("#survey-submit");
      const showQuestion = () => {
        document.querySelector("#survey-progress").textContent = `Question ${index + 1} of ${questions.length}`;
        questionLabel.textContent = questions[index].text;
        answerField.value = answers[questions[index].id];
        back.disabled = index === 0;
        next.hidden = index === questions.length - 1;
        submit.hidden = index !== questions.length - 1;
      };
      answerField.addEventListener("input", () => { answers[questions[index].id] = answerField.value; });
      back.addEventListener("click", () => { answers[questions[index].id] = answerField.value; index--; showQuestion(); });
      next.addEventListener("click", () => { answers[questions[index].id] = answerField.value; index++; showQuestion(); });
      showQuestion();

      surveyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        answers[questions[index].id] = answerField.value;
        if (!answers[questions[0].id].trim()) {
          message.textContent = "Please answer the first question before sending.";
          index = 0;
          showQuestion();
          return;
        }
        message.textContent = "Sending…";
        try {
          const result = await request("/api/surveys", {
            method: "POST",
            body: JSON.stringify({ answers, consent: document.querySelector("#survey-consent").checked }),
          });
          message.textContent = result.message;
          for (const id of Object.keys(answers)) answers[id] = "";
          document.querySelector("#survey-consent").checked = false;
          index = 0;
          showQuestion();
        } catch (error) { message.textContent = error.message; }
      });
    } catch (error) { message.textContent = error.message; }
  }
  initializeSurvey();
}

const memberForm = document.querySelector("#member-form");
if (memberForm) {
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#member-message");
    message.textContent = "Saving…";
    try {
      const result = await request("/api/members", {
        method: "POST",
        body: JSON.stringify({ email: document.querySelector("#member-email").value, phone: document.querySelector("#member-phone").value, consent: document.querySelector("#member-consent").checked }),
      });
      message.textContent = result.message;
      event.target.reset();
    } catch (error) { message.textContent = error.message; }
  });
}

const mapElement = document.querySelector("#map");
if (mapElement) {
  async function loadSpaces(markers) {
    try {
      const spaces = await request("/api/spaces");
      markers.clearLayers();
      for (const space of spaces) {
        const details = [space.address, space.description, space.cost].filter(Boolean).map(escapeHtml);
        const popup = `<strong>${escapeHtml(space.name)}</strong>${details.length ? `<br>${details.join("<br>")}` : ""}`;
        L.marker([space.latitude, space.longitude]).bindPopup(popup).addTo(markers);
      }
      document.querySelector("#map-message").textContent = spaces.length ? `${spaces.length} space${spaces.length === 1 ? "" : "s"} on the map.` : "No spaces added yet. Know a welcoming place? Add it below.";
    } catch (error) { document.querySelector("#map-message").textContent = error.message; }
  }

  async function initializeMap() {
    if (!window.L) {
      document.querySelector("#map-message").textContent = "The map library could not load. Check your internet connection.";
      return;
    }
    try {
      const config = await request("/api/config");
      document.querySelector("#city-name").textContent = `A map of youth voices, spaces, and opportunities in ${config.city}.`;
      const map = L.map("map").setView(config.center, 13);
      const key = config.cartoApiKey ? `?key=${encodeURIComponent(config.cartoApiKey)}` : "";
      L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${key}`, {
        attribution: "© OpenStreetMap contributors, © CARTO",
        maxZoom: 20,
      }).addTo(map);
      const markers = L.layerGroup().addTo(map);
      await loadSpaces(markers);
    } catch (error) { document.querySelector("#map-message").textContent = error.message; }
  }
  initializeMap();
}

const insightContainer = document.querySelector("#question-insights");
if (insightContainer) {
  async function loadInsights() {
    try {
      const data = await request("/api/insights");
      document.querySelector("#response-count").textContent = `${data.responseCount} survey response${data.responseCount === 1 ? "" : "s"} (${data.analyzedResponses} included in these insights).`;
      insightContainer.replaceChildren();
      for (const question of data.questions) {
        const section = document.createElement("section");
        const heading = document.createElement("h3");
        heading.textContent = question.label;
        const count = document.createElement("p");
        count.textContent = `${question.answerCount} answer${question.answerCount === 1 ? "" : "s"}`;
        const words = document.createElement("p");
        words.textContent = question.words.length ? question.words.map(({ word, count: total }) => `${word} (${total})`).join(" · ") : "No shared themes yet.";
        section.append(heading, count, words);
        insightContainer.append(section);
      }
      document.querySelector("#summary-text").textContent = data.summary;
    } catch (error) {
      document.querySelector("#response-count").textContent = error.message;
    }
  }

  loadInsights();
  document.querySelector("#summary-button").addEventListener("click", async () => {
    const status = document.querySelector("#summary-status");
    status.textContent = "Creating a summary from anonymous survey answers…";
    try {
      const data = await request("/api/insights/summary", { method: "POST", body: "{}" });
      document.querySelector("#summary-text").textContent = data.summary;
      status.textContent = `Summary based on ${data.responseCount} responses.`;
    } catch (error) { status.textContent = error.message; }
  });
}
