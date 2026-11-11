(function() {
  var p = new URLSearchParams(window.location.search);
  var g = p.get("gclid") || p.get("wbraid") || p.get("gbraid");
  var k = p.get("utm_term") || "";
  var c = p.get("utm_campaign") || "";
  var ad = p.get("utm_content") || p.get("utm_adgroup") || p.get("adgroup") || "";

  if (g || k || c || ad) {
    try {
      if (g) sessionStorage.setItem("a_g", g);
      if (k) sessionStorage.setItem("a_k", k);
      if (c) sessionStorage.setItem("a_c", c);
      if (ad) sessionStorage.setItem("a_ad", ad);
    } catch(e) {}
  } else {
    try {
      g = sessionStorage.getItem("a_g") || "";
      k = sessionStorage.getItem("a_k") || "";
      c = sessionStorage.getItem("a_c") || "";
      ad = sessionStorage.getItem("a_ad") || "";
    } catch(e) {}
  }

  function appendParams(url) {
    if (!g && !k && !c && !ad) return url;
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    var qs = [];
    if (g) qs.push("gclid=" + encodeURIComponent(g));
    if (k) qs.push("utm_term=" + encodeURIComponent(k));
    if (c) qs.push("utm_campaign=" + encodeURIComponent(c));
    if (ad) qs.push("utm_content=" + encodeURIComponent(ad));
    return url + sep + qs.join("&");
  }

  function patchLinks() {
    var selectors = 'a[href*="/r/"], a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="api.whatsapp.com"]';
    var links = document.querySelectorAll(selectors);
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
