import trackingConfig from "./tracking-config.js";
import AOS from "aos";
import "aos/dist/aos.css";

const primaryNav = document.querySelector(".primary-nav");
const navToggle = document.querySelector(".mobile-nav-toggle");

const navLink = document.querySelectorAll(".nav-link");

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
