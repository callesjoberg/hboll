/* admin.js — redigerar data/cups.json via GitHubs Contents-API och kan
   starta ProCup-workflowen. GitHub-tokenen krypteras med användarens
   lösenord (PBKDF2 → AES-GCM) och sparas bara i localStorage på enheten.
   Observera: sidan är publik — säkerheten ligger i GitHubs behörigheter,
   lösenordet skyddar bara den lokalt sparade tokenen. */

(function () {
  "use strict";

  // Ägare/repo härleds från Pages-URL:en (callesjoberg.github.io/hboll).
  const OWNER = location.hostname.endsWith(".github.io")
    ? location.hostname.split(".")[0] : "callesjoberg";
  const REPO = location.hostname.endsWith(".github.io")
    ? (location.pathname.split("/")[1] || "hboll") : "hboll";
  const API = "https://api.github.com";
  const FILE = "data/cups.json";
  const WORKFLOW = "procup.yml";
  const STORE_KEY = "hb:admintoken";

  const $ = (s) => document.querySelector(s);
  let token = null;
  let cups = [];
  let fileSha = null;

  // --- kryptering av token ------------------------------------------------

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(pw, salt) {
    const base = await crypto.subtle.importKey(
      "raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function sealToken(tok, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pw, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(tok));
    localStorage.setItem(STORE_KEY, JSON.stringify(
      { salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  }

  async function openToken(pw) {
    const blob = JSON.parse(localStorage.getItem(STORE_KEY));
    const key = await deriveKey(pw, unb64(blob.salt));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return dec.decode(pt);
  }

  // --- GitHub-API ---------------------------------------------------------

  async function gh(path, opts) {
    const r = await fetch(API + path, Object.assign({
      headers: {
        authorization: "Bearer " + token,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    }, opts));
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error("GitHub " + r.status + ": " + body.slice(0, 140));
    }
    return r.status === 204 ? null : r.json();
  }

  async function loadCups() {
    const j = await gh(`/repos/${OWNER}/${REPO}/contents/${FILE}?ref=main`);
    fileSha = j.sha;
    const text = dec.decode(unb64(j.content.replace(/\n/g, "")));
    cups = (JSON.parse(text).cups || []);
  }

  async function saveCups() {
    const text = JSON.stringify({ cups }, null, 2) + "\n";
    const j = await gh(`/repos/${OWNER}/${REPO}/contents/${FILE}`, {
      method: "PUT",
      body: JSON.stringify({
        message: "Uppdatera cuplistan via admin",
        content: b64(enc.encode(text)),
        sha: fileSha,
        branch: "main",
      }),
    });
    fileSha = j.content.sha;
  }

  function runWorkflow() {
    return gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
  }

  // --- test av cupmanager-anslutning ---------------------------------------

  async function testCup(cup) {
    if (cup.dataUrl) {
      const r = await fetch(cup.dataUrl + "?_=" + Date.now().toString(36));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return (j.matches || []).length + " matcher i datafilen";
    }
    const q = "MatchWindow({limit:1,offset:0,tournamentId:" + cup.tournamentId +
      "}){matches:[{... on Match:{start:{}}}]}";
    const url = "https://" + cup.host + "/rest/results_api/call?call=" +
      encodeURIComponent(q) + "&lang=sv&tournamentId=" + cup.tournamentId +
      "&_=" + Date.now().toString(36);
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const n = Object.values(j.responses || {}).filter(
      (v) => v && v.entity && v.entity.__typename === "Match").length;
    return n ? "OK — API:t svarar med matcher" : "API:t svarar men utan matcher (schema ej publicerat?)";
  }

  // --- UI ------------------------------------------------------------------

  function msg(el, text, ok) {
    el.hidden = false;
    el.textContent = text;
    el.className = "admin-msg " + (ok ? "ok" : "err");
  }

  function slugify(s) {
    return (s || "").toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function cupRow(cup, idx) {
    const row = document.createElement("div");
    row.className = "admin-cup";
    const field = (label, key, placeholder, type) => {
      const wrap = document.createElement("label");
      wrap.className = "admin-field";
      wrap.append(label);
      const inp = document.createElement("input");
      inp.type = type || "text";
      inp.placeholder = placeholder || "";
      inp.value = cup[key] == null ? "" : cup[key];
      inp.addEventListener("input", () => {
        const v = inp.value.trim();
        if (key === "tournamentId" || key === "lat" || key === "lon") {
          cup[key] = v ? +v : undefined;
        } else {
          cup[key] = v || undefined;
        }
        if (key === "name" && !cup._existing) cup.id = slugify(v);
      });
      wrap.append(inp);
      return wrap;
    };
    const head = document.createElement("div");
    head.className = "admin-cup-head";
    const title = document.createElement("strong");
    title.textContent = cup.name || "Ny cup";
    const status = document.createElement("span");
    status.className = "muted";
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn small";
    testBtn.textContent = "Testa";
    testBtn.addEventListener("click", async () => {
      status.textContent = "testar …";
      try { status.textContent = "✓ " + await testCup(cup); }
      catch (e) { status.textContent = "✗ " + e.message; }
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn small";
    delBtn.textContent = "Ta bort";
    delBtn.addEventListener("click", () => {
      cups.splice(idx, 1);
      renderCups();
    });
    head.append(title, status, testBtn, delBtn);

    const grid = document.createElement("div");
    grid.className = "admin-grid";
    grid.append(
      field("Namn", "name", "Åhus Beach"),
      field("Ort", "place", "Åhus"),
      field("År", "edition", "2026"),
      field("Värd", "host", "…cupmanager.net"),
      field("Turnerings-ID", "tournamentId", "8 siffror (Cup Manager)"),
      field("Datafil (ProCup)", "dataUrl", "data/….json"),
      field("Breddgrad (lat)", "lat", "t.ex. 55.9167", "number"),
      field("Längdgrad (lon)", "lon", "t.ex. 14.2833", "number"));
    row.append(head, grid);
    return row;
  }

  function renderCups() {
    const list = $("#cupList");
    list.replaceChildren();
    cups.forEach((c, i) => { c._existing = c._existing !== false; list.append(cupRow(c, i)); });
  }

  async function unlock(pw) {
    token = await openToken(pw);
    await loadCups();
    cups.forEach((c) => { c._existing = true; });
    $("#gate").hidden = true;
    $("#editor").hidden = false;
    renderCups();
  }

  function init() {
    const has = !!localStorage.getItem(STORE_KEY);
    $("#gateUnlock").hidden = !has;
    $("#gateSetup").hidden = has;

    $("#unlockForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await unlock(e.target.pw.value); }
      catch (err) {
        msg($("#gateMsg"), err.name === "OperationError"
          ? "Fel lösenord." : "Kunde inte låsa upp: " + err.message, false);
      }
    });

    $("#setupForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const tok = e.target.token.value.trim();
      const pw = e.target.pw.value;
      try {
        token = tok;
        await loadCups();          // verifierar att tokenen funkar
        await sealToken(tok, pw);
        cups.forEach((c) => { c._existing = true; });
        $("#gate").hidden = true;
        $("#editor").hidden = false;
        renderCups();
      } catch (err) {
        token = null;
        msg($("#gateMsg"), "Tokenen funkar inte: " + err.message, false);
      }
    });

    $("#forgetBtn").addEventListener("click", () => {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    });

    $("#lockBtn").addEventListener("click", () => location.reload());

    $("#addBtn").addEventListener("click", () => {
      cups.push({ id: "", name: "", place: "", edition: "", host: "",
                  _existing: false });
      renderCups();
      const inputs = $("#cupList").querySelectorAll("input");
      if (inputs.length) inputs[inputs.length - 6].focus();
    });

    $("#saveBtn").addEventListener("click", async () => {
      const bad = cups.find((c) => !c.name || !(c.tournamentId || c.dataUrl));
      if (bad) {
        msg($("#editorMsg"),
          "Alla cuper behöver namn samt turnerings-ID eller datafil.", false);
        return;
      }
      const clean = cups.map((c) => {
        const { _existing, ...rest } = c;
        if (!rest.id) rest.id = slugify(rest.name);
        return rest;
      });
      const prev = cups;
      cups = clean;
      try {
        await saveCups();
        cups.forEach((c) => { c._existing = true; });
        msg($("#editorMsg"),
          "Publicerat! Sajten uppdateras inom någon minut.", true);
      } catch (err) {
        cups = prev;
        msg($("#editorMsg"), "Kunde inte publicera: " + err.message, false);
      }
    });

    $("#runProcupBtn").addEventListener("click", async () => {
      try {
        await runWorkflow();
        msg($("#editorMsg"),
          "ProCup-jobbet startat — klart om ett par minuter.", true);
      } catch (err) {
        msg($("#editorMsg"), "Kunde inte starta jobbet: " + err.message, false);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
