// SPDX-License-Identifier: GPL-3.0-or-later
// 候选发现与命中检测只使用公共 DOM 几何工具，不调用兼容 LocalHints。
(function () {
  const roles = new Set([
    "button",
    "tab",
    "link",
    "checkbox",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "radio",
    "textbox",
  ]);
  function deepHit(x, y) {
    let root = document;
    const seen = new Set();
    let last;
    for (;;) {
      const hit = root.elementsFromPoint
        ? root.elementsFromPoint(x, y)[0]
        : root.elementFromPoint(x, y);
      if (!hit) return last;
      if (seen.has(hit) || !hit.shadowRoot) return hit;
      seen.add(hit);
      last = hit;
      root = hit.shadowRoot;
    }
  }
  let Scanner;
  function scannerType() {
    return Scanner ||= class Scanner {
      elements() {
        const stack = [...(document.documentElement?.children || [])].reverse();
        const result = [];
        while (stack.length) {
          const element = stack.pop();
          result.push(element);
          stack.push(...[...element.children].reverse());
          if (element.shadowRoot) stack.push(...[...element.shadowRoot.children].reverse());
        }
        return result;
      }
      angular(element) {
        if (this.angularAttributes == null) {
          this.angularAttributes = document.getElementsByClassName("ng-scope").length
            ? ["", "data-", "x-"].flatMap((prefix) =>
              ["-", ":", "_"].map((separator) => `${prefix}ng${separator}click`)
            )
            : [];
        }
        return this.angularAttributes.some((attribute) => element.hasAttribute(attribute));
      }
      candidate(element) {
        const tag = element.tagName?.toLowerCase?.() || "";
        if (element.getAttribute("aria-disabled")?.toLowerCase() === "true") return [];
        let reason;
        let clickable = this.angular(element) || element.hasAttribute("onclick") ||
          roles.has(element.getAttribute("role")?.toLowerCase()) ||
          ["", "contenteditable", "true"].includes(
            element.getAttribute("contenteditable")?.toLowerCase(),
          );
        if (!clickable && element.hasAttribute("jsaction")) {
          clickable = element.getAttribute("jsaction").split(";").some((rule) => {
            const parts = rule.trim().split(":");
            if (parts.length > 2) return false;
            const event = parts.length === 1 ? "click" : parts[0];
            const [namespace, action = "_"] = parts.at(-1).trim().split(".");
            return event === "click" && namespace !== "none" && action !== "_";
          });
        }
        let areas = [];
        if (tag === "img" && element.getAttribute("usemap")) {
          const name = element.getAttribute("usemap").replace(/^#/, "").replace('"', '\\"');
          const map = document.querySelector(`map[name="${name}"]`);
          const rect = element.getClientRects()[0];
          if (map && rect) {
            clickable = true;
            areas = DomUtils.getClientRectsForAreas(rect, map.getElementsByTagName("area"));
          }
        }
        switch (tag) {
          case "a":
          case "object":
          case "embed":
            clickable = true;
            break;
          case "textarea":
            clickable ||= !element.disabled && !element.readOnly;
            break;
          case "input":
            clickable ||= element.getAttribute("type")?.toLowerCase() !== "hidden" &&
              !element.disabled && !(element.readOnly && DomUtils.isSelectable(element));
            break;
          case "button":
          case "select":
            clickable ||= !element.disabled;
            break;
          case "label":
            clickable ||= !!element.control && !element.control.disabled &&
              !this.candidate(element.control).length;
            break;
          case "body":
            if (element === document.body && !clickable) {
              if (!windowIsFocused() && innerWidth > 3 && innerHeight > 3) {
                clickable = true;
                reason = "Frame.";
              } else if (
                windowIsFocused() &&
                BrowserToolboxScrollControllerInstance.isScrollableElement(element)
              ) {
                clickable = true;
                reason = "Scroll.";
              }
            }
            break;
          case "img":
            clickable ||= ["zoom-in", "zoom-out"].includes(element.style.cursor);
            break;
          case "div":
          case "ol":
          case "ul":
            if (
              !clickable && element.clientHeight < element.scrollHeight &&
              BrowserToolboxScrollControllerInstance.isScrollableElement(element)
            ) {
              clickable = true;
              reason = "Scroll.";
            }
            break;
          case "details":
            clickable = true;
            reason = "Open.";
            break;
        }
        const weakClass = !clickable &&
          /button|btn/.test(element.getAttribute("class")?.toLowerCase() || "");
        clickable ||= weakClass;
        const tabIndex = parseInt(element.getAttribute("tabindex") || "-1");
        const secondClassCitizen = !clickable && Number.isFinite(tabIndex) && tabIndex >= 0;
        if (!clickable && !secondClassCitizen) return [];
        const common = {
          reason,
          secondClassCitizen,
          possibleFalsePositive: weakClass || tag === "span",
        };
        if (areas.length) return areas.map((area) => ({ ...common, ...area, image: element }));
        const rect = DomUtils.getVisibleClientRect(element, true);
        return rect ? [{ ...common, element, rect }] : [];
      }
      unobscured(hint) {
        if (hint.secondClassCitizen) return false;
        const { left, top, right, bottom, width, height } = hint.rect;
        const hits = [
          [left + width / 2, top + height / 2],
          [left + 0.1, top + 0.1],
          [right - 0.1, top + 0.1],
          [left + 0.1, bottom - 0.1],
          [right - 0.1, bottom - 0.1],
        ];
        return hits.some(([x, y], index) => {
          const hit = deepHit(x, y);
          return hit && (hint.element.contains(hit) || hit.contains(hint.element) ||
            index === 0 && hint.element.localName === "area" && hint.image === hit);
        });
      }
      text(hint) {
        const element = hint.element;
        let linkText = "", showLinkText = false;
        if (element.localName === "input") {
          if (element.labels?.length) {
            linkText = element.labels[0].textContent.trim().replace(/:$/, "");
            showLinkText = true;
          } else if (element.type === "file") linkText = "Choose File";
          else if (element.type !== "password") {
            linkText = element.value || element.placeholder || "";
          }
        } else if (
          element.localName === "a" && !element.textContent.trim() &&
          element.firstElementChild?.localName === "img"
        ) {
          linkText = element.firstElementChild.alt || element.firstElementChild.title;
          showLinkText = !!linkText;
        } else if (hint.reason != null) {
          linkText = hint.reason;
          showLinkText = true;
        } else {linkText = element.textContent.length
            ? element.textContent.slice(0, 256)
            : element.hasAttribute("title")
            ? element.getAttribute("title")
            : element.innerHTML.slice(0, 256);}
        return { linkText: linkText.trim(), showLinkText };
      }
      collect(requireHref = false, filtered = Settings.get("filterLinkHints")) {
        const candidates = this.elements().flatMap((element) =>
          requireHref && !element.href ? [] : this.candidate(element)
        ).reverse();
        const reliable = candidates.filter((hint, index) => {
          if (!hint.possibleFalsePositive) return true;
          for (let earlier = Math.max(0, index - 6); earlier < index; earlier++) {
            let ancestor = candidates[earlier].element;
            for (let depth = 0; depth < 3; depth++) {
              ancestor = ancestor?.parentElement;
              if (ancestor === hint.element) return false;
            }
          }
          return true;
        });
        const hints = reliable.filter((hint) => this.unobscured(hint)).reverse();
        const offset = DomUtils.getViewportTopLeft();
        for (const hint of hints) {
          hint.rect.top += offset.top;
          hint.rect.left += offset.left;
          if (filtered) Object.assign(hint, this.text(hint));
        }
        return hints;
      }
    };
  }
  globalThis.BrowserToolboxHintsScanner = Object.freeze({
    get Scanner() {
      return scannerType();
    },
    deepHit,
  });
})();
