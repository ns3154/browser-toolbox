// SPDX-License-Identifier: GPL-3.0-or-later
// 编号与排序是独立纯函数；叶节点索引保持冻结的字母提示顺序。
(function () {
  function alphabetCodes(count, characters) {
    if (characters.length < 2) throw new Error("INVALID_HINT_CHARACTERS");
    const alphabet = [...characters];
    const base = alphabet.length;
    if (base < 2) throw new Error("INVALID_HINT_CHARACTERS");
    const internal = Math.max(1, Math.ceil((count - 1) / (base - 1)));
    return Array.from({ length: count }, (_, offset) => {
      let index = internal + offset, value = "";
      while (index) {
        value += alphabet[(index - 1) % base];
        index = Math.floor((index - 1) / base);
      }
      return value;
    }).sort().map((value) => value.split("").reverse().join(""));
  }
  function numericCode(index, digits) {
    let value = "";
    for (; index > 0; index = Math.floor(index / digits.length)) {
      value = digits[index % digits.length] + value;
    }
    return value;
  }
  let Matcher;
  function matcherType() {
    return Matcher ||= class Matcher {
      constructor(filtered, characters, numbers, render = () => {}) {
        this.filtered = filtered;
        this.characters = characters.toLowerCase();
        this.numbers = numbers.toUpperCase();
        if ((filtered ? this.numbers : this.characters).length < 2) {
          throw new Error("INVALID_HINT_CHARACTERS");
        }
        this.render = render;
        this.hintKeystrokeQueue = [];
        this.linkTextKeystrokeQueue = [];
        this.split = new RegExp(`[\\W${this.numbers.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+`);
      }
      initialize(markers) {
        if (this.filtered) return this.match(markers, 0);
        const codes = alphabetCodes(markers.length, this.characters);
        markers.forEach((marker, index) => {
          marker.hintString = codes[index];
          this.render(marker);
        });
        return { linksMatched: markers, userMightOverType: false };
      }
      pushKeyChar(character) {
        if (!this.filtered || this.numbers.includes(character)) {
          this.hintKeystrokeQueue.push(character);
        } else if (
          character.toLowerCase() !== character && this.numbers.toLowerCase() !== this.numbers
        ) return;
        else if (character === " " || !this.split.test(character)) {
          this.hintKeystrokeQueue = [];
          this.linkTextKeystrokeQueue.push(character.toLowerCase());
        }
      }
      popKeyChar() {
        return this.hintKeystrokeQueue.pop() || this.linkTextKeystrokeQueue.pop();
      }
      score(marker, terms) {
        const words = marker.linkWords ||= marker.linkText.toLowerCase().split(this.split).filter(
          Boolean,
        );
        let total = 0;
        for (const term of terms) {
          let best = -Infinity;
          words.forEach((word, index) => {
            const position = word.indexOf(term);
            const score = position < 0
              ? 0
              : position > 0
              ? 1
              : term.length === word.length
              ? index === 0 ? 8 : 4
              : index === 0
              ? 6
              : 2;
            best = Math.max(best, score);
          });
          if (best === 0) return 0;
          total += best;
        }
        return total / Math.log(1 + (marker.linkText.length || 100));
      }
      match(markers, tabCount = 0) {
        let matched = markers;
        if (this.filtered) {
          for (;;) {
            const terms = this.linkTextKeystrokeQueue.join("").trim().toLowerCase().split(
              this.split,
            );
            matched = markers.filter((marker) => {
              marker.score = this.score(marker, terms);
              return !this.linkTextKeystrokeQueue.length || marker.score > 0;
            }).sort((a, b) =>
              b.score === a.score ? b.stableSortCount - a.stableSortCount : b.score - a.score
            );
            if (
              matched.length || this.hintKeystrokeQueue.length ||
              !this.linkTextKeystrokeQueue.length
            ) break;
            this.linkTextKeystrokeQueue.pop();
          }
          matched.forEach((marker, index) => {
            marker.hintString = numericCode(index + 1, this.numbers);
            this.render(marker);
          });
        }
        const prefix = this.hintKeystrokeQueue.join("");
        matched = matched.filter((marker) => marker.hintString.startsWith(prefix));
        if (this.filtered) {
          this.activeHintMarker?.element?.classList.remove("vimiumActiveHintMarker");
          this.activeHintMarker =
            matched[((tabCount % matched.length) + matched.length) % matched.length];
          this.activeHintMarker?.element?.classList.add("vimiumActiveHintMarker");
        }
        return {
          linksMatched: matched,
          userMightOverType: this.filtered && !prefix.length &&
            !!this.linkTextKeystrokeQueue.length,
        };
      }
      shouldRotateHints(event) {
        return !this.filtered || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
      }
    };
  }
  globalThis.BrowserToolboxHintsMatcher = Object.freeze({
    get Matcher() {
      return matcherType();
    },
    alphabetCodes,
    numericCode,
  });
})();
