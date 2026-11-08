// The assistant: a floating chat panel. You write to a model; its replies can carry proposed changes to what Tosi reads,
// shown as cards a person accepts or declines. No model is connected yet: the server says so, and assistants that use
// Tosi's MCP server can already propose changes, which appear here too.
import { icon } from "./icons.js";

let ctx = null, panel = null, openState = false;
const messages = [];

export function init(c) {
  ctx = c;
  const { el } = ctx;
  const btn = el("button", { id: "ask", class: "ask", title: "Assistant", "aria-label": "Open the assistant", html: icon("comments") });
  panel = el("aside", { id: "chat", class: "chat", hidden: true, "aria-label": "Assistant" });
  btn.onclick = () => toggle(!openState);
  document.body.append(btn, panel);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && openState) toggle(false); });
}

function toggle(v) {
  openState = v;
  panel.hidden = !v;
  document.getElementById("ask").classList.toggle("on", v);
  if (v) draw();
}

async function send(text) {
  messages.push({ who: "you", text });
  draw(true);
  const r = await fetch("/api/assistant", { method: "POST", body: JSON.stringify({ message: text, history: messages }) }).then((x) => x.json()).catch(() => ({ reply: "The server did not answer." }));
  messages.push({ who: "assistant", text: r.reply, connected: r.connected });
  draw();
}

async function decide(id, accept) {
  const r = await fetch(`/api/proposals/${id}/${accept ? "accept" : "decline"}`, { method: "POST" }).then((x) => x.json());
  if (r.error) ctx.toast(r.error);
  draw();
}

async function draw(thinking) {
  const { el } = ctx;
  const [proposals, about] = await Promise.all([fetch("/api/proposals").then((r) => r.json()).catch(() => []), fetch("/api/about").then((r) => r.json()).catch(() => ({}))]);
  const pending = proposals.filter((p) => p.state === "pending");
  const input = el("textarea", { rows: "2", placeholder: "Ask about the algorithm, or ask for a change…" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = input.value.trim(); if (v) send(v); } });
  const describe = (c) => c.field === "add" ? `Start reading ${c.table} (${c.kind})` : c.field === "read" ? `${c.value ? "Start" : "Stop"} reading ${c.table} (${c.kind})` : c.field === "columns" ? `Require columns of ${c.table}: ${(c.value || []).join(", ")}` : `Set ${c.field} of ${c.table} to “${c.value}”`;
  panel.replaceChildren(
    el("header", { class: "chat-h" }, el("b", {}, "Assistant"), el("span", { class: "meta" }, "No model connected")),
    el("div", { class: "chat-log" },
      messages.length ? messages.map((m) => el("div", { class: "msgl " + m.who }, m.text)) : el("p", { class: "meta pad" }, "Ask what a step does, why a table is read, or ask for a change. Changes come back as proposals for you to accept or decline."),
      thinking ? el("div", { class: "msgl assistant" }, el("span", { class: "sk line", style: "width:180px" })) : null,
      pending.length ? el("div", { class: "props" }, el("div", { class: "props-h" }, `Proposed changes · ${pending.length}`), pending.map((p) => el("div", { class: "prop" },
        el("b", {}, describe(p.change)), el("p", {}, p.why), el("span", { class: "meta" }, `by ${p.by}`),
        el("div", { class: "prop-a" },
          el("button", { class: "act on", disabled: about.editing ? null : true, title: about.editing ? "" : "The algorithm is read-only for now", onclick: () => decide(p.id, true) }, "Accept"),
          el("button", { class: "act", onclick: () => decide(p.id, false) }, "Decline"))))) : null),
    el("div", { class: "chat-in" }, input, el("button", { class: "send", "aria-label": "Send", html: icon("paper-plane"), onclick: () => { const v = input.value.trim(); if (v) send(v); } })));
  panel.querySelector(".chat-log").scrollTop = 1e9;
  if (!thinking) input.focus();
}
