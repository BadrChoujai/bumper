// Shared mobile burger-menu behavior for the site header, used by every page.
(function () {
  var toggle = document.getElementById("nav-toggle");
  var menu = document.getElementById("site-nav-menu");
  if (!toggle || !menu) return;

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.classList.toggle("open", open);
  }

  toggle.addEventListener("click", function () {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
  menu.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", function () { setOpen(false); });
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 640) setOpen(false);
  });
})();
