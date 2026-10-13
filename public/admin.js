async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const loginSection = document.querySelector("#login-section");
const workspace = document.querySelector("#admin-workspace");
const loginMessage = document.querySelector("#login-message");

async function loadAdminData() {
  const [responseData, questionData, spaces] = await Promise.all([
    api("/api/admin/responses"),
    api("/api/questions"),
    api("/api/spaces"),
  ]);
  renderResponses(responseData);
  renderQuestions(questionData);
  renderLocations(spaces);
}

function renderResponses(data) {
  document.querySelector("#response-total").textContent = `${data.count} responses total. Showing the latest ${data.responses.length}.`;
  const list = document.querySelector("#response-list");
  list.replaceChildren();
  for (const response of data.responses) {
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = response.createdAt ? new Date(response.createdAt).toLocaleString() : "Response";
    article.append(heading);
    if (response.respondent) {
      const respondent = document.createElement("p");
      respondent.textContent = `${response.respondent.firstName} ${response.respondent.lastName} · ${response.respondent.thirdSpace}`;
      article.append(respondent);
    }
    for (const entry of response.answers) {
      const question = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = `${entry.question} `;
      question.append(label, document.createTextNode(entry.answer));
      article.append(question);
    }
    list.append(article);
  }
  if (!data.responses.length) list.textContent = "No survey responses yet.";
}

function renderQuestions(questions) {
  const list = document.querySelector("#question-list");
  list.replaceChildren();
  questions.forEach((question, index) => list.append(makeQuestionRow(question, index, questions.length)));
}

function makeQuestionRow(question, index, length) {
  const row = document.createElement("div");
  row.dataset.id = question.id;
  const input = document.createElement("input");
  input.type = "text";
  input.value = question.text;
  input.maxLength = 300;
  input.required = true;
  input.setAttribute("aria-label", `Question ${index + 1}`);
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "Up";
  up.disabled = index === 0;
  up.addEventListener("click", () => {
    const previous = row.previousElementSibling;
    if (previous) row.parentElement.insertBefore(row, previous);
    refreshQuestionButtons();
  });
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "Down";
  down.disabled = index === length - 1;
  down.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next) row.parentElement.insertBefore(next, row);
    refreshQuestionButtons();
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.disabled = length === 1;
  remove.addEventListener("click", () => { row.remove(); refreshQuestionButtons(); });
  row.append(input, document.createTextNode(" "), up, down, remove);
  return row;
}

function refreshQuestionButtons() {
  const rows = [...document.querySelectorAll("#question-list > div")];
  rows.forEach((row, index) => {
    const buttons = row.querySelectorAll("button");
    buttons[0].disabled = index === 0;
    buttons[1].disabled = index === rows.length - 1;
    buttons[2].disabled = rows.length === 1;
  });
}

function renderLocations(spaces) {
  const list = document.querySelector("#location-list");
  list.replaceChildren();
  for (const space of spaces) {
    const form = document.createElement("form");
    form.dataset.id = space.id;
    const fields = [
      ["name", "Place name", space.name],
      ["address", "Address or area", space.address],
      ["description", "Description", space.description || ""],
      ["cost", "Cost", space.cost || ""],
      ["latitude", "Latitude", space.latitude],
      ["longitude", "Longitude", space.longitude],
    ];
    for (const [name, labelText, value] of fields) {
      const label = document.createElement("label");
      label.textContent = `${labelText}: `;
      const input = name === "description" ? document.createElement("textarea") : document.createElement("input");
      input.name = name;
      input.value = value;
      input.maxLength = name === "description" ? 500 : 240;
      if (name === "latitude" || name === "longitude") {
        input.type = "number";
        input.step = "any";
        input.required = true;
      }
      if (name === "name" || name === "address") input.required = true;
      label.append(input);
      form.append(label, document.createElement("br"));
    }
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save changes";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete location";
    form.append(save, document.createTextNode(" "), remove);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      body.latitude = Number(body.latitude);
      body.longitude = Number(body.longitude);
      try {
        const result = await api(`/api/admin/spaces/${form.dataset.id}`, { method: "PUT", body: JSON.stringify(body) });
        document.querySelector("#location-message").textContent = result.message;
        await loadSpacesOnly();
      } catch (error) { document.querySelector("#location-message").textContent = error.message; }
    });
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove ${space.name} from the map?`)) return;
      try {
        const result = await api(`/api/admin/spaces/${form.dataset.id}`, { method: "DELETE" });
        document.querySelector("#location-message").textContent = result.message;
        await loadSpacesOnly();
      } catch (error) { document.querySelector("#location-message").textContent = error.message; }
    });
    list.append(form, document.createElement("hr"));
  }
  if (!spaces.length) list.textContent = "No locations have been added yet.";
}

async function loadSpacesOnly() {
  renderLocations(await api("/api/spaces"));
}

async function showWorkspace() {
  loginSection.hidden = true;
  workspace.hidden = false;
  loginMessage.textContent = "";
  try { await loadAdminData(); }
  catch (error) {
    workspace.hidden = true;
    loginSection.hidden = false;
    loginMessage.textContent = error.message;
  }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Signing in…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: document.querySelector("#admin-password").value }) });
    event.target.reset();
    await showWorkspace();
  } catch (error) { loginMessage.textContent = error.message; }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); }
  finally {
    workspace.hidden = true;
    loginSection.hidden = false;
    loginMessage.textContent = "Signed out.";
  }
});

document.querySelector("#add-question").addEventListener("click", () => {
  const list = document.querySelector("#question-list");
  const rows = [...list.querySelectorAll(":scope > div")];
  if (rows.length >= 25) return;
  const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  list.append(makeQuestionRow({ id, text: "" }, rows.length, rows.length + 1));
  refreshQuestionButtons();
  list.lastElementChild.querySelector("input").focus();
});

document.querySelector("#save-questions").addEventListener("click", async () => {
  const status = document.querySelector("#question-message");
  const questions = [...document.querySelectorAll("#question-list > div")].map((row) => ({ id: row.dataset.id, text: row.querySelector("input").value }));
  if (!questions.length || questions.some((question) => !question.text.trim())) {
    status.textContent = "Keep at least one question and fill in every question.";
    return;
  }
  try {
    const result = await api("/api/admin/questions", { method: "PUT", body: JSON.stringify({ questions }) });
    status.textContent = result.message;
    renderQuestions(result.questions);
  } catch (error) { status.textContent = error.message; }
});

document.querySelector("#location-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  body.latitude = Number(body.latitude);
  body.longitude = Number(body.longitude);
  const status = document.querySelector("#location-message");
  status.textContent = "Adding location…";
  try {
    const result = await api("/api/admin/spaces", { method: "POST", body: JSON.stringify(body) });
    status.textContent = result.message;
    form.reset();
    await loadSpacesOnly();
  } catch (error) { status.textContent = error.message; }
});

api("/api/admin/status").then((status) => {
  if (!status.enabled) document.querySelector("#login-help").textContent = "Admin sign-in is disabled until ADMIN_PASSWORD is set in .env (at least 12 characters).";
  if (status.authenticated) showWorkspace();
}).catch((error) => { loginMessage.textContent = error.message; });
