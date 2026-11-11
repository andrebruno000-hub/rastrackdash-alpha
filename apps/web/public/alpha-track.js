(function() {
  var p = new URLSearchParams(window.location.search);
  var g = p.get("gclid") || p.get("wbraid") || p.get("gbraid");
  var k = p.get("utm_term") || "";
  var c = p.get("utm_campaign") || "";

  if (g) {
    try {
      sessionStorage.setItem("a_g", g);
      sessionStorage.setItem("a_k", k);
      sessionStorage.setItem("a_c", c);
    } catch(e) {}
  } else {
    try {
      g = sessionStorage.getItem("a_g") || "";
      k = sessionStorage.getItem("a_k") || "";
      c = sessionStorage.getItem("a_c") || "";
    } catch(e) {}
  }

  function appendParams(url) {
    if (!g && !k && !c) return url;
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    var qs = [];
    if (g) qs.push("gclid=" + encodeURIComponent(g));
    if (k) qs.push("utm_term=" + encodeURIComponent(k));
    if (c) qs.push("utm_campaign=" + encodeURIComponent(c));
    return url + sep + qs.join("&");
  }

  function patchLinks() {
    var links = document.querySelectorAll('a[href*="/r/"]');
    links.forEach(function(el) {
      var currentHref = el.getAttribute("href");
      if (currentHref && !el.getAttribute("data-alpha-ready")) {
        el.setAttribute("href", appendParams(currentHref));
        el.setAttribute("data-alpha-ready", "true");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchLinks);
  } else {
    patchLinks();
  }
  setInterval(patchLinks, 1000);
})();
