async function request(url, options = {}) {
  const isRead = (options.method || "GET").toUpperCase() === "GET";
  const delays = [750, 1500, 3000, 5000, 8000, 8000];
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    } catch (error) {
      if (!isRead || attempt >= delays.length) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
      continue;
    }
    let data = {};
    try { data = await response.json(); } catch { /* Keep a useful fallback for empty or non-JSON server errors. */ }
    if (response.ok) return data;
    if (isRead && response.status === 503 && attempt < delays.length) {
      await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
      continue;
    }
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function linkedSpaceName(space, label) {
  let url;
  try {
    const parsed = new URL(space.website || "");
    if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href;
  } catch { /* Spaces without a valid public link keep a plain-text name. */ }
  const safeLabel = escapeHtml(label);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>` : safeLabel;
}


const menuToggle = document.querySelector(".menu-toggle");
menuToggle?.addEventListener("click", () => {
  const expanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!expanded));
  document.querySelector("#main-menu")?.classList.toggle("is-open", !expanded);
});

const rotatingWord = document.querySelector("#rotating-word");
if (rotatingWord && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const words = ["people.", "places.", "opportunities."];
  let wordIndex = 0;
  window.setInterval(() => {
    wordIndex = (wordIndex + 1) % words.length;
    rotatingWord.textContent = words[wordIndex];
    rotatingWord.animate(
      [
        { opacity: 0, transform: "translateY(.16em)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 750, easing: "cubic-bezier(.2,.75,.2,1)" },
    );
  }, 3000);
}

const heroArt = document.querySelector(".hero-art");
const heroLogo = document.querySelector(".hero-logo-panel");
const heroStars = heroArt?.querySelectorAll(".hero-star");
if (heroArt && heroStars?.length && window.gsap) {
  const gsap = window.gsap;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  heroStars.forEach((star, index) => {
    const svg = star.querySelector("svg");
    gsap.set(star, { x: 0, y: 0, rotation: 0, transformOrigin: "50% 50%", force3D: true });
    const rotationTween = reduceMotion ? null : gsap.to(star, { rotation: 360, duration: [28, 21, 25][index], ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    if (svg && !reduceMotion) {
      gsap.fromTo(svg, { y: -8 }, {
        y: 10,
        duration: 3.2 + index * 0.8,
        delay: index * 0.35,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    }
    let drag;
    star.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      gsap.killTweensOf(star, "x,y");
      rotationTween?.pause();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: Number(gsap.getProperty(star, "x")) || 0,
        y: Number(gsap.getProperty(star, "y")) || 0,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
      };
      star.classList.add("is-dragging");
      star.setPointerCapture(event.pointerId);
    });
    star.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const now = performance.now();
      const elapsed = Math.max(1, now - drag.lastTime);
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (Math.hypot(deltaX, deltaY) > 4) star.classList.add("has-been-dragged");
      const maxTravel = event.pointerType === "touch" ? 115 : 190;
      const clamp = (value) => gsap.utils.clamp(-maxTravel, maxTravel, value);
      gsap.set(star, {
        x: clamp(drag.x + deltaX),
        y: clamp(drag.y + deltaY),
      });
      drag.velocityX = (event.clientX - drag.lastX) / elapsed * 16;
      drag.velocityY = (event.clientY - drag.lastY) / elapsed * 16;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastTime = now;
    });
    const releaseStar = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { velocityX, velocityY } = drag;
      drag = undefined;
      star.classList.remove("is-dragging");
      const maxTravel = event.pointerType === "touch" ? 115 : 190;
      const clamp = (value) => gsap.utils.clamp(-maxTravel, maxTravel, value);
      const currentX = Number(gsap.getProperty(star, "x")) || 0;
      const currentY = Number(gsap.getProperty(star, "y")) || 0;
      gsap.to(star, {
        x: clamp(currentX + velocityX * 3),
        y: clamp(currentY + velocityY * 3),
        duration: reduceMotion ? 0 : 1.25,
        ease: "power3.out",
        overwrite: "auto",
        onComplete: () => rotationTween?.resume(),
      });
    };
    star.addEventListener("pointerup", releaseStar);
    star.addEventListener("pointercancel", releaseStar);
  });
}
if (heroArt && heroLogo) {
  const recentLogoClicks = [];
  const popShapes = ["✦", "✳", "●", "♥", "✦", "✧", "↗"];
  const popColors = ["#f15528", "#f7d83f", "#ee91bd", "#3e2b7d", "#f5f2e3"];
  const idleNudgeInterval = 3000;
  const idleNudgeDuration = 650;
  let idleNudgeTimer;
  const dismissIdleNudge = () => {
    window.clearTimeout(idleNudgeTimer);
    heroLogo.classList.remove("is-idle-nudge");
  };
  const scheduleIdleNudge = (delay = idleNudgeInterval) => {
    window.clearTimeout(idleNudgeTimer);
    idleNudgeTimer = window.setTimeout(() => {
      if (!heroLogo.matches(":hover") && document.activeElement !== heroLogo) heroLogo.classList.add("is-idle-nudge");
    }, delay);
  };
  heroLogo.addEventListener("pointerenter", dismissIdleNudge);
  heroLogo.addEventListener("pointerleave", () => scheduleIdleNudge());
  heroLogo.addEventListener("focus", dismissIdleNudge);
  heroLogo.addEventListener("blur", () => scheduleIdleNudge());
  heroLogo.addEventListener("animationend", (event) => {
    if (event.animationName !== "hero-logo-nudge") return;
    heroLogo.classList.remove("is-idle-nudge");
    if (!heroLogo.matches(":hover") && document.activeElement !== heroLogo) {
      scheduleIdleNudge(idleNudgeInterval - idleNudgeDuration);
    }
  });
  scheduleIdleNudge();

  heroLogo.addEventListener("click", () => {
    dismissIdleNudge();
    const now = performance.now();
    while (recentLogoClicks.length && now - recentLogoClicks[0] > 1100) recentLogoClicks.shift();
    recentLogoClicks.push(now);
    const pieceCount = Math.min(18, 2 + recentLogoClicks.length * 2);
    const artBounds = heroArt.getBoundingClientRect();
    const logoBounds = heroLogo.getBoundingClientRect();
    const originX = logoBounds.left - artBounds.left + logoBounds.width / 2;
    const originY = logoBounds.top - artBounds.top + logoBounds.height / 2;

    for (let index = 0; index < pieceCount; index += 1) {
      const piece = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const distance = 90 + Math.random() * 150;
      piece.className = "hero-pop-piece";
      piece.setAttribute("aria-hidden", "true");
      piece.textContent = popShapes[Math.floor(Math.random() * popShapes.length)];
      piece.style.left = `${originX}px`;
      piece.style.top = `${originY}px`;
      piece.style.setProperty("--burst-x", `${Math.cos(angle) * distance}px`);
      piece.style.setProperty("--burst-y", `${Math.sin(angle) * distance}px`);
      piece.style.setProperty("--burst-turn", `${Math.round(Math.random() * 260 - 130)}deg`);
      piece.style.setProperty("--piece-size", `${16 + Math.random() * 20}px`);
      piece.style.setProperty("--piece-color", popColors[Math.floor(Math.random() * popColors.length)]);
      heroArt.append(piece);
      piece.addEventListener("animationend", () => piece.remove(), { once: true });
      window.setTimeout(() => piece.remove(), 1000);
    }

    const burstStatus = document.querySelector("#logo-burst-status");
    if (burstStatus) burstStatus.textContent = `A burst of ${pieceCount} shapes.`;
    scheduleIdleNudge();
  });
}

const carousel = document.querySelector("#space-carousel");
if (carousel) {
  let spaces = [];
  let activeIndex = 0;
  let homeMap;
  let markers;
  let mapMarkers = [];
  const label = document.querySelector("#home-map-label");
  const count = document.querySelector("#space-count");

  function showSpace(index, { fromMap = false, scrollCard = true } = {}) {
    if (!spaces.length) return;
    activeIndex = (index + spaces.length) % spaces.length;
    const space = spaces[activeIndex];
    carousel.querySelectorAll(".space-card").forEach((card, cardIndex) => card.classList.toggle("is-selected", cardIndex === activeIndex));
    if (scrollCard) carousel.querySelector(`[data-space-index="${activeIndex}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    label.textContent = `${String(activeIndex + 1).padStart(2, "0")} · ${space.name}`;
    if (homeMap && Number.isFinite(Number(space.latitude)) && Number.isFinite(Number(space.longitude))) {
      const position = [Number(space.latitude), Number(space.longitude)];
      mapMarkers.forEach((marker, markerIndex) => {
        const icon = marker.getElement();
        icon?.classList.toggle("is-active", markerIndex === activeIndex);
      });
      if (!fromMap) {
        homeMap.flyTo(position, Math.max(homeMap.getZoom(), 15), { duration: 0.7 });
        mapMarkers[activeIndex]?.openPopup();
      }
    }
  }

  function renderSpaces() {
    carousel.replaceChildren();
    count.textContent = `${spaces.length} ${spaces.length === 1 ? "space" : "spaces"} in the Inner City`;
    if (!spaces.length) {
      const empty = document.createElement("div");
      empty.className = "space-empty";
      empty.textContent = "No third spaces have been added yet.";
      carousel.append(empty);
      return;
    }
    spaces.forEach((space, index) => {
      const card = document.createElement("article");
      card.className = `space-card${index === 0 ? " is-selected" : ""}`;
      card.dataset.spaceIndex = String(index);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Show ${space.name} on the map`);
      const number = String(index + 1).padStart(2, "0");
      const marker = document.createElement("span"); marker.className = "space-card-number"; marker.textContent = number;
      const title = document.createElement("h3"); title.textContent = space.name;
      const description = document.createElement("p"); description.textContent = space.description || "Meet people, work on ideas, and try something new.";
      const details = document.createElement("span"); details.className = "space-card-address"; details.textContent = [space.address, space.cost].filter(Boolean).join(" · ");
      card.append(marker, title, description, details);
      card.addEventListener("click", () => showSpace(index));
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showSpace(index); } });
      carousel.append(card);
    });
    showSpace(0, { scrollCard: false, fromMap: document.body.classList.contains("spaces-page") });
  }

  document.querySelector("#space-prev")?.addEventListener("click", () => showSpace(activeIndex - 1));
  document.querySelector("#space-next")?.addEventListener("click", () => showSpace(activeIndex + 1));
  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") showSpace(activeIndex + 1);
    if (event.key === "ArrowLeft") showSpace(activeIndex - 1);
  });

  if (window.L) {
    homeMap = L.map("home-map", { zoomControl: false, scrollWheelZoom: false }).setView([-33.9249, 18.4241], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(homeMap);
    L.control.zoom({ position: "bottomright" }).addTo(homeMap);
    markers = L.layerGroup().addTo(homeMap);
  }

  request("/api/spaces").then((loaded) => {
    spaces = loaded.filter((space) => Number.isFinite(Number(space.latitude)) && Number.isFinite(Number(space.longitude)));
    if (markers) {
      mapMarkers = spaces.map((space, index) => {
        const number = String(index + 1).padStart(2, "0");
        const icon = L.divIcon({ className: "yc-map-icon", html: `<span class="map-marker-shape" aria-hidden="true"><span>${number}</span></span>`, iconSize: [48, 56], iconAnchor: [24, 52] });
        const marker = L.marker([space.latitude, space.longitude], { icon, keyboard: true, title: `${number} · ${space.name}` }).bindPopup(`<strong>${linkedSpaceName(space, `${number} · ${space.name}`)}</strong>`).addTo(markers);
        marker.on("click", () => showSpace(index, { fromMap: true }));
        return marker;
      });
    }
    renderSpaces();
    setTimeout(() => {
      homeMap?.invalidateSize();
      if (document.body.classList.contains("spaces-page") && mapMarkers.length > 1) {
        homeMap.fitBounds(mapMarkers.map((marker) => marker.getLatLng()), { padding: [45, 45], maxZoom: 14 });
      }
    }, 100);
  }).catch(() => { spaces = []; renderSpaces(); });
}

const revealItems = document.querySelectorAll(".home-page .reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14 });
  revealItems.forEach((item) => revealObserver.observe(item));
} else revealItems.forEach((item) => item.classList.add("is-visible"));

const scrollRevealHeadings = document.querySelectorAll(".home-page .scroll-reveal-text");
if (scrollRevealHeadings.length && window.gsap && window.ScrollTrigger && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.gsap.registerPlugin(window.ScrollTrigger);
  scrollRevealHeadings.forEach((heading) => {
    const textNodes = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    const words = [];
    textNodes.forEach((textNode) => {
      const fragment = document.createDocumentFragment();
      (textNode.textContent.match(/\s+|[^\s]+/g) || []).forEach((part) => {
        if (/^\s+$/.test(part)) {
          fragment.append(document.createTextNode(part));
          return;
        }
        const word = document.createElement("span");
        word.className = "scroll-reveal-word";
        word.textContent = part;
        words.push(word);
        fragment.append(word);
      });
      textNode.replaceWith(fragment);
    });

    window.gsap.fromTo(words, { y: 22 }, {
      y: 0,
      stagger: 0.06,
      ease: "none",
      scrollTrigger: {
        trigger: heading,
        start: "top 88%",
        end: "top 58%",
        scrub: 0.6,
      },
    });
  });
}

const storyWords = {
  work: document.querySelector("#story-word-work"),
  connect: document.querySelector("#story-word-connect"),
  create: document.querySelector("#story-word-create"),
};
const storySection = document.querySelector(".third-space-story");
if (storySection && Object.values(storyWords).every(Boolean) && window.gsap && window.ScrollTrigger && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.gsap.registerPlugin(window.ScrollTrigger);
  const storyTitle = document.querySelector("#third-space-story-title");
  const wordSequence = window.gsap.timeline({
    scrollTrigger: { trigger: storyTitle, start: "top 85%", end: "bottom 50%", scrub: 0.35 },
  });
  const purple = "#3e2b7d";
  const orange = "#f15528";
  wordSequence.to(storyWords.work, { color: orange, duration: 0.2, ease: "none" }, 0);
  wordSequence.to(storyWords.work, { color: purple, duration: 0.16, ease: "none" }, 0.35);
  wordSequence.to(storyWords.connect, { color: orange, duration: 0.16, ease: "none" }, 0.35);
  wordSequence.to(storyWords.connect, { color: purple, duration: 0.16, ease: "none" }, 0.7);
  wordSequence.to(storyWords.create, { color: orange, duration: 0.16, ease: "none" }, 0.7);
}

const surveyForm = document.querySelector("#survey-form");
if (surveyForm) {
  async function initializeSurvey() {
    const message = document.querySelector("#survey-message");
    const spaceSelect = document.querySelector("#survey-space");
    const introCard = document.querySelector("#survey-intro-card");
    const surveyDeck = document.querySelector("#survey-deck");
    const success = document.querySelector("#survey-success");
    const questionCard = document.querySelector("#survey-question-card");
    const start = document.querySelector("#survey-start");
    try {
      let spaces = [];
      try { spaces = await request("/api/spaces"); } catch {}
      const other = document.createElement("option"); other.value = "Somewhere else"; other.textContent = "Somewhere else"; spaceSelect.append(other);
      for (const space of spaces) {
        const option = document.createElement("option"); option.value = space.name; option.textContent = space.name; spaceSelect.append(option);
      }
      const questions = await request("/api/questions");
      introCard.querySelector(".card-count").textContent = `01 / ${String(questions.length + 1).padStart(2, "0")}`;
      const answers = Object.fromEntries(questions.map(({ id }) => [id, ""]));
      let index = 0;
      const questionLabel = document.querySelector("#survey-question");
      const answerField = document.querySelector("#survey-answer");
      const back = document.querySelector("#survey-back");
      const next = document.querySelector("#survey-next");
      const submit = document.querySelector("#survey-submit");
      let transitionPending = false;
      const showQuestion = (direction = 1) => {
        questionCard.classList.remove("card-enter-next", "card-enter-back", "card-leave-next", "card-leave-back");
        void questionCard.offsetWidth;
        questionCard.classList.add(direction < 0 ? "card-enter-back" : "card-enter-next");
        document.querySelector("#survey-progress").textContent = `QUESTION ${index + 1} / ${questions.length}`;
        questionLabel.textContent = questions[index].text;
        answerField.value = answers[questions[index].id];
        back.disabled = index === 0;
        next.hidden = index === questions.length - 1;
        submit.hidden = index !== questions.length - 1;
        questionCard.querySelector(".card-count").textContent = `${String(index + 2).padStart(2, "0")} / ${String(questions.length + 1).padStart(2, "0")}`;
        surveyDeck.classList.remove("is-dealing-forward", "is-dealing-back");
        surveyDeck.classList.add(direction < 0 ? "is-dealing-back" : "is-dealing-forward");
        window.setTimeout(() => surveyDeck.classList.remove("is-dealing-forward", "is-dealing-back"), 480);
      };
      const moveQuestion = (direction) => {
        const nextIndex = index + direction;
        if (transitionPending || nextIndex < 0 || nextIndex >= questions.length) return;
        answers[questions[index].id] = answerField.value;
        transitionPending = true;
        surveyDeck.classList.remove("is-dealing-forward", "is-dealing-back");
        void surveyDeck.offsetWidth;
        surveyDeck.classList.add(direction > 0 ? "is-dealing-forward" : "is-dealing-back");
        questionCard.classList.remove("card-enter-next", "card-enter-back", "card-leave-next", "card-leave-back");
        questionCard.classList.add(direction > 0 ? "card-leave-next" : "card-leave-back");
        window.setTimeout(() => {
          index = nextIndex;
          showQuestion(direction);
          window.setTimeout(() => { transitionPending = false; }, 480);
        }, 270);
      };
      start.addEventListener("click", () => {
        const introFields = [spaceSelect, document.querySelector("#survey-first-name"), document.querySelector("#survey-last-name")];
        const valid = introFields.every((field) => {
          if (field.checkValidity()) return true;
          field.reportValidity();
          return false;
        });
        if (!valid) return;
        introCard.hidden = true;
        surveyDeck.hidden = false;
        showQuestion(1);
      });
      answerField.addEventListener("input", () => { answers[questions[index].id] = answerField.value; });
      back.addEventListener("click", () => moveQuestion(-1));
      next.addEventListener("click", () => moveQuestion(1));
      let touchX = 0;
      questionCard.addEventListener("pointerdown", (event) => { touchX = event.clientX; });
      questionCard.addEventListener("pointerup", (event) => {
        const delta = event.clientX - touchX;
        if (Math.abs(delta) < 70) return;
        if (delta < 0) moveQuestion(1);
        if (delta > 0) moveQuestion(-1);
      });
      surveyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        answers[questions[index].id] = answerField.value;
        message.textContent = "Sending…";
        try {
          const result = await request("/api/surveys", {
            method: "POST",
            body: JSON.stringify({ answers, consent: document.querySelector("#survey-consent").checked, thirdSpace: spaceSelect.value, firstName: document.querySelector("#survey-first-name").value, lastName: document.querySelector("#survey-last-name").value }),
          });
          introCard.hidden = true;
          surveyDeck.hidden = true;
          success.hidden = false;
          message.textContent = "";
          success.focus();
        } catch (error) { message.textContent = error.message; }
      });
    } catch (error) { message.textContent = error.message; }
  }
  initializeSurvey();
}

const memberForm = document.querySelector("#member-form");
if (memberForm) {
  const fields = document.querySelector("#member-fields");
  const success = document.querySelector("#member-success");
  const errorMessage = document.querySelector("#member-error");
  const submitButton = memberForm.querySelector(".member-submit");
  const submitLabel = memberForm.querySelector(".submit-label");
  const nameField = document.querySelector("#member-name");
  const emailField = document.querySelector("#member-email");
  const consentField = document.querySelector("#member-consent");

  function clearMemberError() {
    errorMessage.hidden = true;
    errorMessage.textContent = "";
    [nameField, emailField, consentField].forEach((field) => field.removeAttribute("aria-invalid"));
  }

  function showMemberError(message, field) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    } else errorMessage.focus();
  }

  [nameField, emailField, consentField].forEach((field) => field.addEventListener("input", clearMemberError));
  consentField.addEventListener("change", clearMemberError);

  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMemberError();
    if (!nameField.value.trim()) return showMemberError("Pop your name in so we know who to say hello to.", nameField);
    if (!emailField.checkValidity()) return showMemberError("That email address doesn’t look quite right. Try checking it for a typo.", emailField);
    if (!consentField.checked) return showMemberError("Please agree to receive emails before joining.", consentField);

    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitLabel.textContent = "Joining you…";
    memberForm.classList.add("is-submitting");
    try {
      await request("/api/members", {
        method: "POST",
        body: JSON.stringify({ name: nameField.value.trim(), email: emailField.value.trim(), consent: consentField.checked }),
      });
      document.querySelector("#member-success-copy").textContent = `Thanks, ${nameField.value.trim()}! You’re on the list. We can’t wait to share what’s happening with the Inner City Youth Collective.`;
      fields.hidden = true;
      success.hidden = false;
      success.focus();
      memberForm.reset();
    } catch (error) {
      showMemberError(error.message || "We couldn’t save your sign-up just now. Please try again in a moment.");
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitLabel.textContent = "Count me in";
      memberForm.classList.remove("is-submitting");
    }
  });

  memberForm.querySelector(".member-again").addEventListener("click", () => {
    success.hidden = true;
    fields.hidden = false;
    clearMemberError();
    nameField.focus();
  });
}

const mapElement = document.querySelector("#map");
if (mapElement) {
  async function initializeMap() {
    if (!window.L) { document.querySelector("#map-message").textContent = "The map could not load. Check your internet connection."; return; }
    try {
      const config = await request("/api/config");
      document.querySelector("#city-name").textContent = `A map of youth voices, spaces, and opportunities in ${config.city}.`;
      const map = L.map("map").setView(config.center, 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
      const spaces = await request("/api/spaces");
      const markers = [];
      for (const space of spaces) {
        const details = [space.address, space.description, space.cost].filter(Boolean).map(escapeHtml);
        L.circleMarker([space.latitude, space.longitude], { radius: 8, color: "#3e2b7d", weight: 2, fillColor: "#ee91bd", fillOpacity: 1 }).bindPopup(`<strong>${linkedSpaceName(space, space.name)}</strong>${details.length ? `<br>${details.join("<br>")}` : ""}`).addTo(map);
        markers.push([space.latitude, space.longitude]);
      }
      if (markers.length > 1) map.fitBounds(markers, { padding: [32, 32] });
      document.querySelector("#map-message").textContent = spaces.length ? `${spaces.length} ${spaces.length === 1 ? "space" : "spaces"} on the map.` : "No third spaces have been added yet.";
    } catch (error) { document.querySelector("#map-message").textContent = error.message; }
  }
  initializeMap();
}
