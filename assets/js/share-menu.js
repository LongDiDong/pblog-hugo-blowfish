(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        if (document.execCommand("copy")) resolve();
        else reject(new Error("copy failed"));
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function canvasToPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("toBlob failed"));
        }, "image/png");
        return;
      }
      try {
        var dataUrl = canvas.toDataURL("image/png");
        var parts = dataUrl.split(",");
        var bin = atob(parts[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: "image/png" }));
      } catch (err) {
        reject(err);
      }
    });
  }

  function copyImageBlob(blob) {
    if (!navigator.clipboard || !window.ClipboardItem) {
      return Promise.reject(new Error("clipboard image unsupported"));
    }
    return navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
  }

  function initRoot(root) {
    var toggle = root.querySelector("[data-share-toggle]");
    var menu = root.querySelector("[data-share-menu]");
    var copyLinkBtn = root.querySelector("[data-share-copy-link]");
    var copyQrBtn = root.querySelector("[data-share-copy-qr]");
    var panel = root.querySelector("[data-share-qr-panel]");
    var canvas = root.querySelector("[data-share-qr-canvas]");
    var hint = root.querySelector("[data-share-qr-hint]");
    var toast = root.querySelector("[data-share-toast]");
    // Prefer the live page URL so relativeURLs / baseURL quirks never
    // produce a relative path when copying for WeChat etc.
    var rawUrl = root.getAttribute("data-url") || "";
    var url =
      rawUrl.indexOf("://") !== -1
        ? rawUrl
        : window.location.href.replace(/#.*$/, "");
    var toastTimer = null;

    function showToast(message) {
      if (!toast) return;
      toast.textContent = message;
      toast.hidden = false;
      toast.classList.add("is-visible");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove("is-visible");
        toast.hidden = true;
      }, 1600);
    }

    function setOpen(open) {
      if (!toggle || !menu) return;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      menu.hidden = !open;
      root.classList.toggle("is-open", open);
      if (!open && panel) {
        panel.hidden = true;
      }
    }

    function ensureQr() {
      if (!canvas || !window.ArticleQR || typeof window.ArticleQR.draw !== "function") {
        throw new Error("QR unavailable");
      }
      window.ArticleQR.draw(canvas, url, { scale: 4, margin: 2 });
      return canvas;
    }

    function showQrFallback(message) {
      try {
        ensureQr();
        if (panel) panel.hidden = false;
        if (hint) hint.textContent = message || "长按或扫码分享";
        showToast(message || "请扫码或长按保存二维码");
      } catch (err) {
        showToast("二维码生成失败");
      }
    }

    if (toggle) {
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        setOpen(menu.hidden);
      });
    }

    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        copyText(url)
          .then(function () {
            showToast("链接已复制");
            setOpen(false);
          })
          .catch(function () {
            showToast("复制链接失败");
          });
      });
    }

    if (copyQrBtn) {
      copyQrBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        try {
          ensureQr();
        } catch (err) {
          showToast("二维码生成失败");
          return;
        }
        canvasToPngBlob(canvas)
          .then(function (blob) {
            return copyImageBlob(blob).then(
              function () {
                showToast("二维码已复制");
                setOpen(false);
                if (panel) panel.hidden = true;
              },
              function () {
                showQrFallback("当前浏览器不支持复制图片，请扫码或长按保存");
              }
            );
          })
          .catch(function () {
            showQrFallback("当前浏览器不支持复制图片，请扫码或长按保存");
          });
      });
    }

    document.addEventListener("click", function (event) {
      if (!root.contains(event.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });
  }

  ready(function () {
    var roots = document.querySelectorAll("[data-share-root]");
    for (var i = 0; i < roots.length; i++) initRoot(roots[i]);
  });
})();
