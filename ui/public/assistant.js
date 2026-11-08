// The assistant's button, in the bottom corner of the Algorithm and Guidebook pages. No model is connected to this
// server, so for now it opens the demo run (demo.js): a recorded session of an AI agent proposing changes through
// Tosi's MCP server in test-run mode. Assistants that use the MCP server for real can only propose; a person decides.
import { icon } from "./icons.js";
import * as demo from "./demo.js";

export function init(c) {
  const btn = c.el("button", { id: "ask", class: "ask", title: "Assistant: demo run", "aria-label": "Open the assistant's demo run", html: icon("comments") });
  btn.onclick = () => demo.toggle();
  document.body.append(btn);
}
