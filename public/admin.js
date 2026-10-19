async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch { /* Keep the server status as the useful failure. */ }
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const loginSection = document.querySelector("#login-section");
const workspace = document.querySelector("#admin-workspace");
const loginMessage = document.querySelector("#login-message");
const PAGE_SIZE = 25;
const state = {
  overview: null,
  spaces: [],
  membersOffset: 0,
  membersSearch: "",
  responsesOffset: 0,
  responsesSearch: "",
  geocodeMatches: [],
};

function formatDate(value, options = { dateStyle: "medium", timeStyle: "short" }) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, options).format(date) : "Date not recorded";
}

async function loadAdminData() {
  const [overview, questionData, spaces] = await Promise.all([
    api("/api/admin/overview"), api("/api/questions"), api("/api/spaces"),
  ]);
  state.overview = overview;
  renderOverview(overview);
  renderQuestions(questionData);
  renderLocations(spaces);
  await Promise.all([loadMembers(), loadResponses()]);
}

function localDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function chartBuckets(range, daily) {
  const today = new Date(`${localDateKey(new Date())}T00:00:00Z`);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  if (range === "30" || range === "90") {
    const days = Number(range);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - days + 1 + index);
      const key = date.toISOString().slice(0, 10);
      return { key, label: date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) };
    });
  }
  const firstMonth = range === "365"
    ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 11, 1))
    : daily.length
      ? new Date(`${daily[0].date.slice(0, 7)}-01T00:00:00Z`)
      : monthStart;
  const months = Math.max(1, (monthStart.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + monthStart.getUTCMonth() - firstMonth.getUTCMonth() + 1);
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + index, 1));
    return { key: date.toISOString().slice(0, 7), label: date.toLocaleDateString(undefined, { month: "short", year: months > 12 ? "2-digit" : undefined, timeZone: "UTC" }) };
  });
}

function renderChart(targetId, totalId, daily, range, total, label) {
  const container = document.querySelector(`#${targetId}`);
  const totalLabel = document.querySelector(`#${totalId}`);
  const ns = "http://www.w3.org/2000/svg";
  const buckets = chartBuckets(range, daily);
  const counts = new Map(daily.map((item) => [item.date, Number(item.count) || 0]));
  const values = buckets.map((bucket) => range === "30" || range === "90"
    ? (counts.get(bucket.key) || 0)
    : daily.reduce((sum, item) => sum + (item.date.startsWith(bucket.key) ? Number(item.count) || 0 : 0), 0));
  totalLabel.textContent = `${total.toLocaleString()} total`;
  container.replaceChildren();
  container.setAttribute("aria-label", `${label}: ${total} total. ${buckets.length ? "Chart grouped by " + (range === "30" || range === "90" ? "day." : "month.") : "No dated entries yet."}`);
  if (!daily.length) {
    const empty = document.createElement("p");
    empty.className = "admin-chart-empty";
    empty.textContent = "No dated activity yet.";
    container.append(empty);
    return;
  }

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 680 250");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const left = 42, right = 666, top = 18, bottom = 194;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => ({
    x: buckets.length === 1 ? (left + right) / 2 : left + index * (right - left) / (buckets.length - 1),
    y: bottom - value / max * (bottom - top),
  }));
  for (let line = 0; line < 4; line += 1) {
    const y = top + line * (bottom - top) / 3;
    const grid = document.createElementNS(ns, "line");
    grid.setAttribute("x1", left); grid.setAttribute("x2", right); grid.setAttribute("y1", y); grid.setAttribute("y2", y); grid.setAttribute("class", "admin-chart-gridline");
    svg.append(grid);
    const tick = document.createElementNS(ns, "text");
    tick.setAttribute("x", left - 10); tick.setAttribute("y", y + 4); tick.setAttribute("text-anchor", "end"); tick.setAttribute("class", "admin-chart-tick");
    tick.textContent = String(Math.round(max * (3 - line) / 3));
    svg.append(tick);
  }
  const area = document.createElementNS(ns, "path");
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  area.setAttribute("d", `${linePath} L${points.at(-1).x},${bottom} L${points[0].x},${bottom} Z`);
  area.setAttribute("class", "admin-chart-area");
  svg.append(area);
  const line = document.createElementNS(ns, "path");
  line.setAttribute("d", linePath);
  line.setAttribute("class", "admin-chart-line");
  svg.append(line);
  const lastPoint = points.at(-1);
  const marker = document.createElementNS(ns, "circle");
  marker.setAttribute("cx", lastPoint.x); marker.setAttribute("cy", lastPoint.y); marker.setAttribute("r", "5"); marker.setAttribute("class", "admin-chart-marker");
  svg.append(marker);
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  buckets.forEach((bucket, index) => {
    if (index % labelStep !== 0 && index !== buckets.length - 1) return;
    const tick = document.createElementNS(ns, "text");
    tick.setAttribute("x", points[index].x); tick.setAttribute("y", 224); tick.setAttribute("text-anchor", index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"); tick.setAttribute("class", "admin-chart-date");
    tick.textContent = bucket.label;
    svg.append(tick);
  });
  container.append(svg);
}

function renderOverview(data) {
  document.querySelector("#member-total").textContent = Number(data.members).toLocaleString();
  document.querySelector("#survey-total").textContent = Number(data.surveys).toLocaleString();
  document.querySelector("#space-total").textContent = Number(data.spaces).toLocaleString();
  document.querySelector("#overview-updated").textContent = `Updated ${formatDate(data.generatedAt)}`;
  const range = document.querySelector("#chart-range").value;
  renderChart("member-chart", "member-chart-total", data.memberDaily, range, data.members, "Sign-ups over time");
  renderChart("survey-chart", "survey-chart-total", data.surveyDaily, range, data.surveys, "Survey responses over time");
}

function pageUrl(path, offset, search) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  if (search) query.set("search", search);
  return `${path}?${query}`;
}

function updatePagination(prefix, offset, limit, count, listLength, action) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(count / limit));
  document.querySelector(`#${prefix}-page`).textContent = `${count ? offset + 1 : 0}–${offset + listLength} of ${count} · Page ${page} of ${pages}`;
  document.querySelector(`#${prefix}-previous`).disabled = offset === 0;
  document.querySelector(`#${prefix}-next`).disabled = offset + limit >= count;
  document.querySelector(`#${prefix}-previous`).onclick = () => action(Math.max(0, offset - limit));
  document.querySelector(`#${prefix}-next`).onclick = () => action(offset + limit);
}

async function loadMembers() {
  const data = await api(pageUrl("/api/admin/members", state.membersOffset, state.membersSearch));
  const list = document.querySelector("#member-list");
  list.replaceChildren();
  document.querySelector("#members-count").textContent = `${data.count.toLocaleString()} people`;
  if (!data.members.length) {
    list.textContent = state.membersSearch ? "No sign-ups match that search." : "No sign-ups yet.";
  }
  for (const member of data.members) {
    const row = document.createElement("article");
    row.className = "admin-member-row";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = member.name || "Name not recorded";
    const email = document.createElement("a"); email.href = `mailto:${member.email}`; email.textContent = member.email;
    info.append(name, email);
    const date = document.createElement("time");
    const createdAt = member.createdAt ? new Date(member.createdAt) : null;
    if (createdAt && Number.isFinite(createdAt.getTime())) date.dateTime = createdAt.toISOString();
    date.textContent = formatDate(member.createdAt);
    row.append(info, date);
    list.append(row);
  }
  updatePagination("members", data.offset, data.limit, data.count, data.members.length, async (offset) => { state.membersOffset = offset; await loadMembers(); });
}

async function loadResponses() {
  const data = await api(pageUrl("/api/admin/responses", state.responsesOffset, state.responsesSearch));
  const list = document.querySelector("#response-list");
  list.replaceChildren();
  document.querySelector("#response-total").textContent = `${data.count.toLocaleString()} responses`;
  if (!data.responses.length) list.textContent = state.responsesSearch ? "No responses match that search." : "No survey responses yet.";
  for (const response of data.responses) {
    const details = document.createElement("details");
    details.className = "admin-response-record";
    const summary = document.createElement("summary");
    const respondent = response.respondent || {};
    const identity = document.createElement("span"); identity.className = "admin-response-identity";
    const name = document.createElement("strong"); name.textContent = [respondent.firstName, respondent.lastName].filter(Boolean).join(" ") || "Anonymous response";
    const metadata = document.createElement("small"); metadata.textContent = [respondent.thirdSpace || "Third space not recorded", formatDate(response.createdAt)].join(" · ");
    identity.append(name, metadata);
    const answerCount = document.createElement("span"); answerCount.className = "admin-answer-count"; answerCount.textContent = `${response.answers.length} ${response.answers.length === 1 ? "answer" : "answers"}`;
    summary.append(identity, answerCount);
    details.append(summary);
    if (response.answers.length) {
      const answerList = document.createElement("div"); answerList.className = "admin-answer-list";
      response.answers.forEach((entry, index) => {
        const answer = document.createElement("article");
        const question = document.createElement("h4"); question.textContent = entry.question || `Question ${index + 1}`;
        const text = document.createElement("p"); text.textContent = entry.answer;
        answer.append(question, text); answerList.append(answer);
      });
      details.append(answerList);
    } else {
      const empty = document.createElement("p"); empty.className = "admin-answer-empty"; empty.textContent = "No answers were saved with this response."; details.append(empty);
    }
    list.append(details);
  }
  updatePagination("responses", data.offset, data.limit, data.count, data.responses.length, async (offset) => { state.responsesOffset = offset; await loadResponses(); });
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
  input.type = "text"; input.value = question.text; input.maxLength = 300; input.required = true; input.setAttribute("aria-label", `Question ${index + 1}`);
  const up = document.createElement("button"); up.type = "button"; up.textContent = "Up"; up.disabled = index === 0;
  up.addEventListener("click", () => { const previous = row.previousElementSibling; if (previous) row.parentElement.insertBefore(row, previous); refreshQuestionButtons(); });
  const down = document.createElement("button"); down.type = "button"; down.textContent = "Down"; down.disabled = index === length - 1;
  down.addEventListener("click", () => { const next = row.nextElementSibling; if (next) row.parentElement.insertBefore(next, row); refreshQuestionButtons(); });
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.disabled = length === 1;
  remove.addEventListener("click", () => { row.remove(); refreshQuestionButtons(); });
  row.append(input, document.createTextNode(" "), up, down, remove);
  return row;
}

function refreshQuestionButtons() {
  const rows = [...document.querySelectorAll("#question-list > div")];
  rows.forEach((row, index) => {
    const buttons = row.querySelectorAll("button");
    buttons[0].disabled = index === 0; buttons[1].disabled = index === rows.length - 1; buttons[2].disabled = rows.length === 1;
  });
}

function spacePayload(form) {
  const body = Object.fromEntries(new FormData(form).entries());
  body.latitude = Number(body.latitude); body.longitude = Number(body.longitude);
  return body;
}

function setSpaceEditor(space) {
  const form = document.querySelector("#space-edit-form");
  const empty = document.querySelector("#space-editor-empty");
  if (!space) { form.hidden = true; empty.hidden = false; return; }
  empty.hidden = true; form.hidden = false; form.dataset.id = space.id;
  for (const field of ["name", "address", "description", "cost", "website", "latitude", "longitude"]) {
    form.elements[field].value = space[field] ?? "";
  }
}

function renderLocations(spaces) {
  state.spaces = spaces;
  document.querySelector("#space-count").textContent = `${spaces.length} ${spaces.length === 1 ? "space" : "spaces"}`;
  const select = document.querySelector("#space-select");
  const selected = select.value && spaces.some((space) => space.id === select.value) ? select.value : spaces[0]?.id || "";
  select.replaceChildren();
  if (!spaces.length) {
    const option = document.createElement("option"); option.value = ""; option.textContent = "No third spaces yet"; select.append(option);
  } else {
    spaces.forEach((space) => { const option = document.createElement("option"); option.value = space.id; option.textContent = space.name; select.append(option); });
    select.value = selected;
  }
  setSpaceEditor(spaces.find((space) => space.id === selected));
}

async function refreshSpaces(message) {
  const [spaces, overview] = await Promise.all([api("/api/spaces"), api("/api/admin/overview")]);
  state.overview = overview; renderLocations(spaces); renderOverview(overview);
  if (message) document.querySelector("#space-edit-message").textContent = message;
}

function applyGeocodeMatch(index) {
  const match = state.geocodeMatches[index];
  if (!match) return false;
  document.querySelector("#location-latitude").value = match.latitude;
  document.querySelector("#location-longitude").value = match.longitude;
  document.querySelector("#geocode-message").textContent = "Map coordinates found. Check the pin location, then add the space.";
  return true;
}

async function findLocationMatches() {
  const address = document.querySelector("#location-address").value.trim();
  const message = document.querySelector("#geocode-message");
  const matchLabel = document.querySelector("#geocode-match-label");
  const select = document.querySelector("#geocode-match");
  if (!address) { message.textContent = "Enter an address or area first."; return false; }
  const button = document.querySelector("#find-location");
  button.disabled = true; message.textContent = "Looking up this address…";
  try {
    const result = await api("/api/admin/geocode", { method: "POST", body: JSON.stringify({ address }) });
    state.geocodeMatches = result.matches;
    select.replaceChildren();
    if (!result.matches.length) {
      matchLabel.hidden = true; message.textContent = "No matching address found. Try adding the suburb or set coordinates manually."; return false;
    }
    result.matches.forEach((match, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = match.label; select.append(option); });
    matchLabel.hidden = result.matches.length === 1;
    if (result.matches.length === 1) { applyGeocodeMatch(0); return true; }
    select.selectedIndex = -1;
    message.textContent = `${result.matches.length} matches found. Choose the correct place to set its coordinates.`;
    return false;
  } catch (error) {
    message.textContent = `${error.message} You can enter coordinates manually.`;
    return false;
  } finally { button.disabled = false; }
}

async function showWorkspace() {
  loginSection.hidden = true; workspace.hidden = false; loginMessage.textContent = "";
  try { await loadAdminData(); }
  catch (error) { workspace.hidden = true; loginSection.hidden = false; loginMessage.textContent = error.message; }
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); loginMessage.textContent = "Signing in…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: document.querySelector("#admin-password").value }) });
    event.target.reset(); await showWorkspace();
  } catch (error) { loginMessage.textContent = error.message; }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); }
  finally { workspace.hidden = true; loginSection.hidden = false; loginMessage.textContent = "Signed out."; }
});

document.querySelector("#chart-range").addEventListener("change", () => { if (state.overview) renderOverview(state.overview); });
document.querySelector("#member-search-form").addEventListener("submit", async (event) => {
  event.preventDefault(); state.membersSearch = document.querySelector("#member-search").value.trim(); state.membersOffset = 0;
  try { await loadMembers(); } catch (error) { document.querySelector("#member-list").textContent = error.message; }
});
document.querySelector("#clear-member-search").addEventListener("click", async () => {
  document.querySelector("#member-search").value = ""; state.membersSearch = ""; state.membersOffset = 0;
  try { await loadMembers(); } catch (error) { document.querySelector("#member-list").textContent = error.message; }
});
document.querySelector("#response-search-form").addEventListener("submit", async (event) => {
  event.preventDefault(); state.responsesSearch = document.querySelector("#response-search").value.trim(); state.responsesOffset = 0;
  try { await loadResponses(); } catch (error) { document.querySelector("#response-list").textContent = error.message; }
});
document.querySelector("#clear-response-search").addEventListener("click", async () => {
  document.querySelector("#response-search").value = ""; state.responsesSearch = ""; state.responsesOffset = 0;
  try { await loadResponses(); } catch (error) { document.querySelector("#response-list").textContent = error.message; }
});

document.querySelector("#find-location").addEventListener("click", findLocationMatches);
document.querySelector("#geocode-match").addEventListener("change", (event) => applyGeocodeMatch(Number(event.target.value)));
document.querySelector("#location-address").addEventListener("input", () => {
  state.geocodeMatches = [];
  document.querySelector("#location-latitude").value = ""; document.querySelector("#location-longitude").value = "";
  document.querySelector("#geocode-match-label").hidden = true;
  document.querySelector("#geocode-message").textContent = "Address changed. Find its map location again.";
});
document.querySelector("#location-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const latitude = document.querySelector("#location-latitude").value;
  const longitude = document.querySelector("#location-longitude").value;
  if (!latitude || !longitude) {
    const found = await findLocationMatches();
    if (!found) return;
  }
  const status = document.querySelector("#location-message"); status.textContent = "Adding third space…";
  try {
    const result = await api("/api/admin/spaces", { method: "POST", body: JSON.stringify(spacePayload(event.currentTarget)) });
    event.currentTarget.reset(); state.geocodeMatches = [];
    document.querySelector("#geocode-match-label").hidden = true;
    document.querySelector("#geocode-message").textContent = "Enter the address and find its map location.";
    status.textContent = result.message; await refreshSpaces();
  } catch (error) { status.textContent = error.message; }
});

document.querySelector("#space-select").addEventListener("change", (event) => setSpaceEditor(state.spaces.find((space) => space.id === event.target.value)));
document.querySelector("#space-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api(`/api/admin/spaces/${form.dataset.id}`, { method: "PUT", body: JSON.stringify(spacePayload(form)) });
    await refreshSpaces(result.message);
  } catch (error) { document.querySelector("#space-edit-message").textContent = error.message; }
});
document.querySelector("#delete-space").addEventListener("click", async () => {
  const space = state.spaces.find((item) => item.id === document.querySelector("#space-select").value);
  if (!space || !window.confirm(`Remove ${space.name} from the map?`)) return;
  try {
    const result = await api(`/api/admin/spaces/${space.id}`, { method: "DELETE" });
    await refreshSpaces(result.message);
  } catch (error) { document.querySelector("#space-edit-message").textContent = error.message; }
});

document.querySelector("#add-question").addEventListener("click", () => {
  const list = document.querySelector("#question-list");
  const rows = [...list.querySelectorAll(":scope > div")];
  if (rows.length >= 25) return;
  const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  list.append(makeQuestionRow({ id, text: "" }, rows.length, rows.length + 1)); refreshQuestionButtons();
  list.lastElementChild.querySelector("input").focus();
});
document.querySelector("#save-questions").addEventListener("click", async () => {
  const status = document.querySelector("#question-message");
  const questions = [...document.querySelectorAll("#question-list > div")].map((row) => ({ id: row.dataset.id, text: row.querySelector("input").value }));
  if (!questions.length || questions.some((question) => !question.text.trim())) { status.textContent = "Keep at least one question and fill in every question."; return; }
  try {
    const result = await api("/api/admin/questions", { method: "PUT", body: JSON.stringify({ questions }) });
    status.textContent = result.message; renderQuestions(result.questions);
  } catch (error) { status.textContent = error.message; }
});

api("/api/admin/status").then((status) => {
  if (!status.enabled) document.querySelector("#login-help").textContent = "Admin sign-in is disabled until ADMIN_PASSWORD is set in .env (at least 12 characters).";
  if (status.authenticated) showWorkspace();
}).catch((error) => { loginMessage.textContent = error.message; });
