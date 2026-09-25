/* Email parsing: .eml (RFC 5322) and .msg (via bundled MsgReader).
   Returns { subject, from, text } for downstream label extraction. */
(function (root) {
  function decodeQP(s) {
    return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  function b64(s) {
    try { return decodeURIComponent(escape(atob(s.replace(/\s+/g, "")))); }
    catch (e) { try { return atob(s.replace(/\s+/g, "")); } catch (_) { return ""; } }
  }
  function stripHtml(h) {
    return h.replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
            .replace(/[ \t]+\n/g, "\n");
  }
  function parseHeaders(block) {
    const h = {};
    block.replace(/\r\n/g, "\n").split("\n").forEach(line => {
      const m = line.match(/^([\w-]+):\s?(.*)$/);
      if (m) h[m[1].toLowerCase()] = m[2];
    });
    return h;
  }
  function decodePart(headers, body) {
    const enc = (headers["content-transfer-encoding"] || "").toLowerCase();
    if (enc.includes("quoted-printable")) return decodeQP(body);
    if (enc.includes("base64")) return b64(body);
    return body;
  }
  function decodeMimeWord(s) {
    return String(s || "").replace(/=\?[^?]+\?([bBqQ])\?([^?]*)\?=/g, (_, enc, data) => {
      if (enc.toLowerCase() === "b") return b64(data);
      return decodeQP(data.replace(/_/g, " "));
    });
  }
  function parseEml(raw) {
    raw = String(raw || "").replace(/\r\n/g, "\n");
    const sep = raw.indexOf("\n\n");
    const head = sep >= 0 ? raw.slice(0, sep) : raw;
    const body = sep >= 0 ? raw.slice(sep + 2) : "";
    const H = parseHeaders(head);
    const subject = decodeMimeWord(H["subject"] || "");
    const from = decodeMimeWord(H["from"] || "");
    const ct = H["content-type"] || "";
    let text = "";
    const bmatch = ct.match(/boundary="?([^";]+)"?/i);
    if (bmatch) {
      const boundary = "--" + bmatch[1];
      const parts = body.split(boundary);
      let plain = "", html = "";
      for (const p of parts) {
        const s2 = p.indexOf("\n\n");
        if (s2 < 0) continue;
        const ph = parseHeaders(p.slice(0, s2));
        const pb = p.slice(s2 + 2);
        const pct = (ph["content-type"] || "").toLowerCase();
        if (pct.includes("text/plain") && !plain) plain = decodePart(ph, pb);
        else if (pct.includes("text/html") && !html) html = decodePart(ph, pb);
      }
      text = plain || (html ? stripHtml(html) : "");
    } else {
      text = decodePart(H, body);
      if ((ct || "").toLowerCase().includes("text/html")) text = stripHtml(text);
    }
    return { subject, from, text };
  }
  function parseMsgBuffer(buffer) {
    if (typeof self === "undefined" || !self.MsgReader) {
      throw new Error("MsgReader not loaded");
    }
    const r = new self.MsgReader(new Uint8Array(buffer));
    const d = r.getFileData();
    return { subject: d.subject || "", from: d.senderName || d.senderEmail || "", text: d.body || "" };
  }

  const api = { parseEml, parseMsgBuffer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ARIE_parser = api;
})(typeof self !== "undefined" ? self : this);
