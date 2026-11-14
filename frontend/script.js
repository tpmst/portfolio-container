import trackingConfig from "./tracking-config.js";
import AOS from "aos";
import "aos/dist/aos.css";

const primaryNav = document.querySelector(".primary-nav");
const navToggle = document.querySelector(".mobile-nav-toggle");
const backToTop = document.querySelector(".back-to-top");
const themeToggle = document.querySelector(".theme-toggle");

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function assetPath(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^\.\/assets\/images\//, "/images/")
    .replace(/^\.\/assets\/icons\//, "/icons/")
    .replace(/^\/assets\/icons\//, "/icons/");
}

function renderContent(content) {
  const about = document.querySelector("#about-content");
  about.replaceChildren(
    textElement("p", content.about.lead, "about-lead"),
    textElement("p", content.about.body)
  );

  const projects = document.querySelector("#projects-content");
  projects.replaceChildren(...content.projects.map((project) => {
    const card = document.createElement("section");
    card.className = "project-card";
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const dialog = document.querySelector("#project-dialog");
      const detail = document.querySelector("#project-detail");
      detail.replaceChildren(
        textElement("h2", project.title),
        Object.assign(document.createElement("img"), { src: assetPath(project.image), alt: project.title }),
        textElement("p", project.description)
      );
      const tags = document.createElement("div");
      tags.className = "technology-tags";
      project.technologies.forEach((technology) => tags.append(textElement("span", technology)));
      detail.append(tags);
      dialog.showModal();
    });
    const image = document.createElement("img");
    image.className = "project-img";
    image.src = assetPath(project.image);
    image.alt = project.title;
    const status = textElement("span", project.status === "in-progress" ? "In progress" : project.status[0].toUpperCase() + project.status.slice(1), "project-status");
    const tags = document.createElement("div");
    tags.className = "technology-tags";
    project.technologies.forEach((technology) => tags.append(textElement("span", technology)));
    card.append(image, textElement("h3", project.title), status, textElement("p", project.description), tags);
    const links = document.createElement("div");
    links.className = "project-card-links";
    project.links.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.url;
      const icon = document.createElement("img");
      icon.className = "project-icons";
      icon.src = assetPath(link.icon);
      icon.alt = "";
      anchor.append(icon, document.createTextNode(` ${link.label}`));
      links.append(anchor);
    });
    card.append(links);
    return card;
  }));

  const renderResume = (section, target) => {
    document.querySelector(target).replaceChildren(...content[section].map((item) => {
      const article = document.createElement("article");
      article.className = "resume-entry";
      const heading = document.createElement("div");
      heading.className = "resume-entry-heading";
      heading.append(textElement("h3", item.title), textElement("span", item.period));
      article.append(heading, textElement("h4", item.organization));
      if (section === "education") article.append(textElement("p", item.description));
      else {
        const list = document.createElement("ul");
        item.details.forEach((detail) => list.append(textElement("li", detail)));
        article.append(list);
      }
      return article;
    }));
  };
  renderResume("experience", "#experience-content");
  renderResume("education", "#education-content");
  renderList("skills", "#skills-section-content");
}

function renderList(section, target) {
  const container = document.querySelector(target);
  container.replaceChildren(...(window.portfolioContent[section] || []).map((item) => {
    const element = document.createElement("span");
    element.className = "skill-item";
    element.textContent = `${item.name} - ${item.level}`;
    if (item.icon) {
      const icon = document.createElement("img");
      icon.src = item.icon;
      icon.alt = "";
      element.prepend(icon);
    }
    return element;
  }));
}

fetch("/api/content")
  .then((response) => {
    if (!response.ok) throw new Error("Portfolio content could not be loaded.");
    return response.json();
  })
  .then((content) => {
    const draft = localStorage.getItem("portfolio-preview-draft");
    const selectedContent = draft ? JSON.parse(draft) : content;
    window.portfolioContent = selectedContent;
    renderContent(selectedContent);
  })
  .catch((error) => console.error(error));

const navLink = document.querySelectorAll(".nav-link");

const savedTheme = localStorage.getItem("theme");
const initialTheme = savedTheme === "dark" ? "dark" : "light";
document.body.dataset.theme = initialTheme;
themeToggle.setAttribute("aria-pressed", initialTheme === "dark");
themeToggle.textContent = initialTheme === "dark" ? "Light mode" : "Dark mode";

function trackEvent(name, properties = {}) {
  if (!trackingConfig.enabled || !trackingConfig.endpoint) {
    return;
  }

  const payload = JSON.stringify({
    name,
    properties,
    path: window.location.pathname,
    referrer: document.referrer || null,
    timestamp: new Date().toISOString(),
  });

  fetch(trackingConfig.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch((error) => {
    console.warn("First-party analytics request failed:", error);
  });
}

navToggle.addEventListener("click", () => {
  const visibility = primaryNav.getAttribute("data-visible");

  if (visibility === "false") {
    primaryNav.setAttribute("data-visible", true);
    navToggle.setAttribute("aria-expanded", true);
  }

  if (visibility === "true") {
    primaryNav.setAttribute("data-visible", false);
    navToggle.setAttribute("aria-expanded", false);
  }
});

backToTop.addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

themeToggle.addEventListener("click", () => {
  const isDark = document.body.dataset.theme === "dark";
  const nextTheme = isDark ? "light" : "dark";

  document.body.dataset.theme = nextTheme;
  localStorage.setItem("theme", nextTheme);
  themeToggle.setAttribute("aria-pressed", nextTheme === "dark");
  themeToggle.textContent = nextTheme === "dark" ? "Light mode" : "Dark mode";
});

[...navLink].forEach((nav) => {
  nav.addEventListener("click", () => {
    if (primaryNav.getAttribute("data-visible") === "true") {
      primaryNav.setAttribute("data-visible", false);
      navToggle.setAttribute("aria-expanded", false);
    }
  });
});

document.querySelectorAll("a[href]").forEach((link) => {
  link.addEventListener("click", () => {
    const href = link.getAttribute("href");

    if (!href || href === "#") {
      return;
    }

    const url = new URL(href, window.location.href);
    trackEvent(
      url.origin === window.location.origin
        ? "navigation_link_click"
        : "outbound_link_click",
      {
        url: url.href,
        text: link.textContent.trim(),
      }
    );
  });
});

trackEvent("page_view");

const contactForm = document.querySelector("#contact-form");
const contactStatus = document.querySelector("#contact-status");

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  contactStatus.textContent = "Sending...";

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: contactForm.email.value,
        message: contactForm.message.value,
      }),
    });

    if (!response.ok) {
      throw new Error("The message could not be sent.");
    }

    contactForm.reset();
    contactStatus.textContent = "Thanks, your message was sent.";
  } catch (error) {
    contactStatus.textContent = error.message;
  }
});

AOS.init({
  once: true,
  delay: 0,
});

document.querySelector("#project-dialog .dialog-close").addEventListener("click", () => {
  document.querySelector("#project-dialog").close();
});
