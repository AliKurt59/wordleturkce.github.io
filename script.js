(() => {
  const ROWS = 6;
  const COLS = 5;

  // ✅ Klavye düzeni: üstte i, altta ı
  const KB_ROWS = [
    ["e","r","t","y","u","i","o","p","ğ","ü"],
    ["a","s","d","f","g","h","j","k","l","ş","ı"],
    ["enter","z","c","v","b","n","m","ö","ç","back"]
  ];

  const STATS_KEY = "wordle_tr_stats_v3";
  const HOWTO_KEY = "wordle_tr_seen_howto_v1";

  // DOM
  const elTiles = document.getElementById("tiles");
  const elKbd = document.getElementById("kbd");
  const elStreak = document.getElementById("streak");
  const elBest = document.getElementById("bestStreak");
  const elWins = document.getElementById("wins");

  const overlay = document.getElementById("howtoOverlay");
  const helpBtn = document.getElementById("helpBtn");
  const closeHowto = document.getElementById("closeHowto");
  const startBtn = document.getElementById("startBtn");
  const toast = document.getElementById("toast");

  // State
  let dict = [];
  let dictSet = new Set();

  let answer = "";
  let row = 0;
  let col = 0;
  let locked = false;

  let board = Array.from({ length: ROWS }, () => Array(COLS).fill(""));

  let stats = loadStats();
  renderStats();

  // ====== Turkish case helpers ======
  function trLower(s) {
    return String(s)
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .toLocaleLowerCase("tr-TR");
  }

  function trUpper(s) {
    return String(s)
      .replace(/i/g, "İ")
      .replace(/ı/g, "I")
      .toLocaleUpperCase("tr-TR");
  }

  function normalizeWordList(list) {
    const out = [];
    for (const w of (list || [])) {
      const x = trLower(String(w).trim());
      if (x.length === 5 && /^[a-zçğıöşü]+$/.test(x)) out.push(x);
    }
    return Array.from(new Set(out));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ====== Toast ======
  function showToast(msg, ms = 1200) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.style.display = "none";
    }, ms);
  }

  // ====== Modal ======
  function showOverlay() {
    if (!overlay) return;
    overlay.style.display = "flex";
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    try { localStorage.setItem(HOWTO_KEY, "1"); } catch {}
  }

  helpBtn?.addEventListener("click", showOverlay);
  closeHowto?.addEventListener("click", hideOverlay);
  startBtn?.addEventListener("click", hideOverlay);
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) hideOverlay();
  });

  // ====== Stats ======
  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return { streak: 0, best: 0, wins: 0 };
      const s = JSON.parse(raw);
      return { streak: +s.streak || 0, best: +s.best || 0, wins: +s.wins || 0 };
    } catch {
      return { streak: 0, best: 0, wins: 0 };
    }
  }

  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
    renderStats();
  }

  function renderStats() {
    if (elStreak) elStreak.textContent = stats.streak;
    if (elBest) elBest.textContent = stats.best;
    if (elWins) elWins.textContent = stats.wins;
  }

  // ====== Build UI ======
  function buildBoard() {
    elTiles.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      rowEl.dataset.r = r;

      for (let c = 0; c < COLS; c++) {
        const t = document.createElement("div");
        t.className = "tile";
        t.dataset.r = r;
        t.dataset.c = c;
        rowEl.appendChild(t);
      }
      elTiles.appendChild(rowEl);
    }
  }

  function buildKeyboard() {
    elKbd.innerHTML = "";

    for (let r = 0; r < KB_ROWS.length; r++) {
      const line = KB_ROWS[r];
      const rowEl = document.createElement("div");
      rowEl.className = "kbdRow " + (r === 0 ? "r0" : r === 1 ? "r1" : "r2");

      for (const k of line) {
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        key.dataset.key = k;

        if (k === "enter") {
          key.textContent = "Enter";
          key.classList.add("wide");
        } else if (k === "back") {
          key.textContent = "Sil";
          key.classList.add("wide");
        } else {
          key.textContent = k; // i/ı aynen görünsün
        }

        key.addEventListener("click", () => handleKey(k));
        rowEl.appendChild(key);
      }

      elKbd.appendChild(rowEl);
    }
  }

  function renderBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = document.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
        if (!t) continue;
        const ch = board[r][c];
        t.textContent = ch ? trUpper(ch) : "";
      }
    }
  }

  function clearMarks() {
    document.querySelectorAll(".tile").forEach((t) => {
      t.classList.remove("good", "present", "bad", "flip");
    });
    document.querySelectorAll(".key").forEach((k) => {
      k.classList.remove("good", "present", "bad");
    });
  }

  function hardShake(r) {
    const rowEl = document.querySelector(`.row[data-r="${r}"]`);
    if (!rowEl) return;
    rowEl.classList.remove("shake");
    void rowEl.offsetWidth;
    rowEl.classList.add("shake");
  }

  // ====== Game ======
  function setRandomAnswer() {
    if (!dict.length) {
      answer = "";
      return;
    }
    answer = dict[Math.floor(Math.random() * dict.length)];
  }

  function resetRound() {
    locked = false;
    row = 0;
    col = 0;
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(""));
    clearMarks();
    setRandomAnswer();
    renderBoard();
  }

  function currentGuess() {
    return board[row].join("");
  }

  function handleKey(k) {
    if (locked) return;

    if (k === "enter") {
      submit();
      return;
    }
    if (k === "back") {
      if (col > 0) {
        col--;
        board[row][col] = "";
        renderBoard();
      }
      return;
    }

    if (col >= COLS) return;

    const ch = trLower(k).slice(0, 1);
    if (!/^[a-zçğıöşü]$/.test(ch)) return;

    board[row][col] = ch;
    col++;
    renderBoard();
  }

  function computeResult(guess, ans) {
    const res = Array(COLS).fill("bad");
    const a = ans.split("");
    const g = guess.split("");
    const remain = new Map();

    // pass1 exact
    for (let i = 0; i < COLS; i++) {
      if (g[i] === a[i]) {
        res[i] = "good";
      } else {
        remain.set(a[i], (remain.get(a[i]) || 0) + 1);
      }
    }

    // pass2 present
    for (let i = 0; i < COLS; i++) {
      if (res[i] === "good") continue;
      const cnt = remain.get(g[i]) || 0;
      if (cnt > 0) {
        res[i] = "present";
        remain.set(g[i], cnt - 1);
      }
    }
    return res;
  }

  function paintKeyboard(guess, res) {
    const pr = { bad: 1, present: 2, good: 3 };

    for (let i = 0; i < COLS; i++) {
      const ch = guess[i];
      const keyEl = document.querySelector(`.key[data-key="${ch}"]`);
      if (!keyEl) continue;

      const cur = keyEl.classList.contains("good")
        ? "good"
        : keyEl.classList.contains("present")
          ? "present"
          : keyEl.classList.contains("bad")
            ? "bad"
            : null;

      const next = res[i];

      if (!cur || pr[next] > pr[cur]) {
        keyEl.classList.remove("good", "present", "bad");
        keyEl.classList.add(next);
      }
    }
  }

  async function submit() {
    if (!answer) {
      showToast("Kelime listesi yüklenmedi.", 1600);
      return;
    }

    if (board[row].some((x) => !x)) {
      showToast("5 harf gir 😅", 900);
      hardShake(row);
      return;
    }

    const guess = currentGuess();

    if (!dictSet.has(guess)) {
      showToast("Bu kelime kabul edilmiyor 👀", 1200);
      hardShake(row);
      return;
    }

    locked = true;

    const res = computeResult(guess, answer);

    // flip animation
    for (let c = 0; c < COLS; c++) {
      const tile = document.querySelector(`.tile[data-r="${row}"][data-c="${c}"]`);
      if (tile) tile.classList.add("flip");
      await sleep(70);
    }
    await sleep(160);

    for (let c = 0; c < COLS; c++) {
      const tile = document.querySelector(`.tile[data-r="${row}"][data-c="${c}"]`);
      if (!tile) continue;
      tile.classList.remove("flip");
      tile.classList.add(res[c]);
    }

    paintKeyboard(guess, res);

    // WIN => infinite
    if (guess === answer) {
      stats.wins++;
      stats.streak++;
      if (stats.streak > stats.best) stats.best = stats.streak;
      saveStats();

      showToast(`Doğru! (${trUpper(answer)})`, 900);
      await sleep(1000);
      resetRound();
      return;
    }

    // next row / lose
    row++;
    col = 0;

    if (row >= ROWS) {
      stats.streak = 0;
      saveStats();

      showToast(`Bilemedin: ${trUpper(answer)}`, 1400);
      await sleep(1400);
      resetRound();
      return;
    }

    locked = false;
  }

  function wireEvents() {
    window.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      if (ev.key === "Enter") {
        ev.preventDefault();
        handleKey("enter");
        return;
      }
      if (ev.key === "Backspace") {
        ev.preventDefault();
        handleKey("back");
        return;
      }

      const lower = trLower(ev.key);
      if (lower.length === 1 && /^[a-zçğıöşü]$/.test(lower)) {
        handleKey(lower);
      }
    });

    // DEV: Ctrl + Shift + C -> cevabı göster
    window.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "c") {
        if (answer) {
          showToast(`DEV: ${trUpper(answer)}`, 2500);
          console.log("DEV ANSWER:", answer);
        }
      }
    });
  }

  function init() {
    dict = normalizeWordList(window.TR_WORDS_5 || []);
    dictSet = new Set(dict);

    buildBoard();
    buildKeyboard();
    wireEvents();

    resetRound();

    try {
      if (!localStorage.getItem(HOWTO_KEY)) showOverlay();
    } catch {
      showOverlay();
    }
  }

  init();
})();
