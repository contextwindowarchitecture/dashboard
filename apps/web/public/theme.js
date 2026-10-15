// Applies the reader's theme before the first paint (STYLE.md 3, Dark mode). The key is the CWA
// website's, so a theme chosen on the site carries over. Light unless "dark" is stored;
// prefers-color-scheme is not consulted. A plain file, never inline: the CSP allows no inline script.
;(function () {
  var theme = "light"
  try {
    if (window.localStorage.getItem("cwa-theme") === "dark") theme = "dark"
  } catch {
    // Storage can be unavailable (privacy settings, sandboxed frames); the default stands.
  }
  document.documentElement.setAttribute("data-theme", theme)
})()
