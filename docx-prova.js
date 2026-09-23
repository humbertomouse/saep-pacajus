/* Parser e exportação de documento da prova (.docx / .txt / HTML) no navegador. */
(function (global) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

  function mimeFromName(name) {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
  }

  function bytesToDataUrl(bytes, mime, name) {
    let bin = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    const url = "data:" + mime + ";base64," + btoa(bin);
    return name ? url + "#" + encodeURIComponent(name) : url;
  }

  function ehFiguraQuestaoNome(name) {
    return /peanuts|boco|quadrinho|tirinha|snoopy/i.test(String(name || ""));
  }

  function ehLogoCabecalhoNome(name) {
    const n = String(name || "").toLowerCase();
    if (ehFiguraQuestaoNome(n)) return false;
    return /warles|caed|saego|marca|letterhead|logo|header|cabec|blog/i.test(n);
  }

  async function inflateRaw(compressed) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Este navegador não consegue abrir .docx. Use Chrome ou Edge.");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzipArrayBuffer(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    let eocd = buf.byteLength - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
    if (eocd < 0) throw new Error("Arquivo .docx inválido.");
    const count = view.getUint16(eocd + 10, true);
    let cd = view.getUint32(eocd + 16, true);
    const files = {};
    for (let i = 0; i < count; i += 1) {
      if (view.getUint32(cd, true) !== 0x02014b50) throw new Error("Arquivo .docx inválido.");
      const method = view.getUint16(cd + 10, true);
      const compSize = view.getUint32(cd + 20, true);
      const nameLen = view.getUint16(cd + 28, true);
      const extraLen = view.getUint16(cd + 30, true);
      const commentLen = view.getUint16(cd + 32, true);
      const localOff = view.getUint32(cd + 42, true);
      const name = new TextDecoder("utf-8").decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
      const localNameLen = view.getUint16(localOff + 26, true);
      const localExtra = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + localNameLen + localExtra;
      const compressed = bytes.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) data = await inflateRaw(compressed);
      else throw new Error("Compactação não suportada no documento.");
      files[name] = data;
      cd += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function textOf(el) {
    let out = "";
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        out += node.textContent || "";
        return;
      }
      if (node.nodeType !== 1) return;
      const local = node.localName;
      if (local === "br" || local === "cr") {
        out += "\n";
        return;
      }
      if (local === "tab") {
        out += " ";
        return;
      }
      for (let i = 0; i < node.childNodes.length; i += 1) walk(node.childNodes[i]);
    }
    walk(el);
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  function blipsOf(el) {
    const nodes = el.getElementsByTagNameNS(A, "blip");
    const ids = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const id = nodes[i].getAttributeNS(R, "embed") || nodes[i].getAttribute("r:embed");
      if (id) ids.push(id);
    }
    return ids;
  }

  function parseRels(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const rels = {};
    const nodes = doc.getElementsByTagNameNS(PKG, "Relationship");
    for (let i = 0; i < nodes.length; i += 1) {
      rels[nodes[i].getAttribute("Id")] = nodes[i].getAttribute("Target");
    }
    return rels;
  }

  function resolveMedia(target, files) {
    if (!target) return null;
    const clean = target.replace(/^\//, "").replace(/\\/g, "/");
    const candidates = [
      clean,
      "word/" + clean,
      "word/" + clean.replace(/^\.\.\//, ""),
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      if (files[candidates[i]]) return { name: candidates[i], bytes: files[candidates[i]] };
    }
    const key = Object.keys(files).find((k) => k.endsWith(clean.split("/").pop()));
    return key ? { name: key, bytes: files[key] } : null;
  }

  function questaoDaTabela(tbl) {
    const cells = [];
    const tcs = tbl.getElementsByTagNameNS(W, "tc");
    for (let i = 0; i < tcs.length; i += 1) cells.push(textOf(tcs[i]));
    const joined = cells.join(" ");
    let m = joined.match(/Quest[aã]o\s*0*(\d+)/i);
    if (m) return Number(m[1]);
    for (let i = 0; i < cells.length; i += 1) {
      if (/^0?\d{1,2}$/.test(cells[i]) && /quest/i.test(joined)) return Number(cells[i]);
    }
    return null;
  }

  function blocoDe(text, images) {
    return { text: text || "", images: images || [] };
  }

  function montarBlocosApoio(itens) {
    const blocos = [];
    let i = 0;
    while (i < itens.length) {
      const apoio = itens[i].apoio || [];
      if (apoio.length) {
        let j = i;
        while (j + 1 < itens.length && !(itens[j + 1].apoio || []).length) j += 1;
        blocos.push({
          de: i + 1,
          ate: j + 1,
          partes: apoio.map((p) => ({ texto: p.text || "", imagens: p.images || [] })),
        });
        i = j + 1;
      } else {
        i += 1;
      }
    }
    return blocos;
  }

  function parseBlocosEmQuestoes(blocos, tituloHint) {
    const headerSkip = /^(escola|prof\.?|nome)\b/i;
    const altRe = /^([A-Da-d])(?:[)\].]| - )\s*(.*)$/;
    const qHeadRe = /^(?:quest[aã]o|item)\s*0*(\d+)\b/i;
    const qNumRe = /^0*(\d{1,2})\s*[-.)]\s+(.*)$/;

    const itens = [];
    let pending = [];
    let atual = null;

    function fecha() {
      if (!atual) return;
      const linhas = atual.linhas.filter((b) => b.text || (b.images && b.images.length));
      let stemIdx = -1;
      for (let i = linhas.length - 1; i >= 0; i -= 1) {
        if (linhas[i].text) { stemIdx = i; break; }
      }
      atual.apoio = stemIdx > 0 ? linhas.slice(0, stemIdx) : (stemIdx === -1 ? linhas : []);
      atual.enunciado = stemIdx >= 0 ? linhas[stemIdx].text : "";
      itens.push(atual);
      atual = null;
    }

    function inicia(n) {
      fecha();
      atual = { n: n || itens.length + 1, linhas: pending, alts: [] };
      pending = [];
    }

    blocos.forEach((b) => {
      if (b.question) {
        inicia(b.question);
        return;
      }
      const txt = (b.text || "").trim();
      if (!atual && headerSkip.test(txt) && !b.images.length) return;
      const qh = txt.match(qHeadRe);
      if (qh) {
        inicia(Number(qh[1]));
        return;
      }
      const qn = txt.match(qNumRe);
      if (qn && Number(qn[1]) === (atual ? atual.n + 1 : itens.length + 1) && qn[2].length < 180) {
        inicia(Number(qn[1]));
        if (qn[2]) atual.linhas.push(blocoDe(qn[2], []));
        return;
      }
      const alt = txt.match(altRe);
      if (atual && alt) {
        const letra = alt[1].toUpperCase();
        const idx = "ABCD".indexOf(letra);
        if (idx >= 0) atual.alts[idx] = alt[2] || "";
        return;
      }
      if (atual && atual.alts.some(Boolean)) pending.push(b);
      else if (atual) atual.linhas.push(b);
      else pending.push(b);
    });
    fecha();

    if (!itens.length && pending.length) {
      pending.filter((b) => b.text).forEach((b, i) => {
        itens.push({ n: i + 1, enunciado: b.text, apoio: [], alts: [] });
      });
    }

    itens.sort((a, b) => a.n - b.n);
    const enunciados = itens.map((it) => it.enunciado || "");
    const alternativas = itens.map((it) => {
      const row = [];
      for (let i = 0; i < 4; i += 1) row.push(it.alts[i] || "");
      return row.some(Boolean) ? row : [];
    });
    return {
      titulo: tituloHint || "",
      subtitulo: "",
      marcas: [],
      enunciados,
      alternativas,
      apoioBlocos: montarBlocosApoio(itens),
    };
  }

  async function parseDocx(buffer, nomeArquivo) {
    const files = await unzipArrayBuffer(buffer);
    const docXml = files["word/document.xml"];
    if (!docXml) throw new Error("O arquivo não tem word/document.xml.");
    const relXml = files["word/_rels/document.xml.rels"];
    const rels = relXml ? parseRels(new TextDecoder("utf-8").decode(relXml)) : {};
    const xml = new TextDecoder("utf-8").decode(docXml);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    if (!body) throw new Error("Documento Word sem corpo de texto.");

    const blocos = [];
    let passouLeia = false;
    let viuTextoApoio = false;
    let logosInicio = 0;
    for (let i = 0; i < body.childNodes.length; i += 1) {
      const child = body.childNodes[i];
      if (child.nodeType !== 1) continue;
      const local = child.localName;
      if (local === "p") {
        const txt = textOf(child);
        const rids = blipsOf(child);
        if (/^leia\b/i.test(txt) || /quest[aã]o/i.test(txt)) passouLeia = true;
        if (/^leia\b|^texto\s+\d/i.test(txt)) viuTextoApoio = true;
        const images = [];
        rids.forEach((rid) => {
          if (!passouLeia) return;
          const media = resolveMedia(rels[rid], files);
          if (!media) return;
          if (ehLogoCabecalhoNome(media.name)) return;
          if (!viuTextoApoio && !txt && !ehFiguraQuestaoNome(media.name)) {
            if (logosInicio < 3) {
              logosInicio += 1;
              return;
            }
          }
          images.push(bytesToDataUrl(media.bytes, mimeFromName(media.name), media.name));
        });
        if (txt || images.length) blocos.push(blocoDe(txt, images));
      } else if (local === "tbl") {
        const n = questaoDaTabela(child);
        if (n) {
          passouLeia = true;
          blocos.push({ question: n, text: "", images: [] });
        } else {
          const tcs = child.getElementsByTagNameNS(W, "tc");
          for (let c = 0; c < tcs.length; c += 1) {
            const txt = textOf(tcs[c]);
            if (txt) blocos.push(blocoDe(txt, []));
          }
        }
      }
    }

    const parsed = parseBlocosEmQuestoes(blocos, nomeArquivo.replace(/\.[^.]+$/, ""));
    if (!parsed.enunciados.length) throw new Error("Não foi possível identificar questões no documento.");
    return parsed;
  }

  function parseTxt(texto, nomeArquivo) {
    const linhas = String(texto).replace(/\r/g, "").split("\n").map((l) => l.trim());
    const blocos = linhas.filter(Boolean).map((text) => blocoDe(text, []));
    const parsed = parseBlocosEmQuestoes(blocos, nomeArquivo.replace(/\.[^.]+$/, ""));
    if (!parsed.enunciados.length) throw new Error("Não foi possível identificar questões no texto.");
    return parsed;
  }

  async function parseDocumentoProva(file) {
    const nome = file.name || "prova";
    const ext = nome.split(".").pop().toLowerCase();
    if (ext === "docx") return parseDocx(await file.arrayBuffer(), nome);
    if (ext === "txt") return parseTxt(await file.text(), nome);
    if (ext === "html" || ext === "htm" || ext === "doc") {
      const html = await file.text();
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const blocos = [];
      tmp.querySelectorAll("h1,h2,h3,p,li").forEach((el) => {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text) blocos.push(blocoDe(text, []));
      });
      return parseBlocosEmQuestoes(blocos, nome.replace(/\.[^.]+$/, ""));
    }
    throw new Error("Use um arquivo .docx, .txt ou .html.");
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function htmlPartes(partes) {
    return (partes || []).map((parte) => {
      const imgs = (parte.imagens || [])
        .filter((src) => !ehLogoCabecalhoNome(src) && !/warles|caed|saego|letterhead|marca-|logo/i.test(String(src || "")))
        .map((src) => `<p><img src="${esc(src)}" alt="" /></p>`).join("");
      const p = parte.texto ? `<p>${esc(parte.texto)}</p>` : "";
      return p + imgs;
    }).join("");
  }

  function montarHtmlProva(p) {
    const titulo = p.tituloProva || "Documento da prova";
    const blocos = p.apoioBlocos || [];
    let corpo = `<h1>${esc(titulo)}</h1>`;
    if (p.subtituloProva) corpo += `<p>${esc(p.subtituloProva)}</p>`;
    for (let i = 0; i < (p.qtd || (p.enunciados || []).length); i += 1) {
      const bloco = blocos.find((b) => b.de === i + 1);
      if (bloco) corpo += `<section>${htmlPartes(bloco.partes)}</section>`;
      corpo += `<h2>Questão ${i + 1}</h2>`;
      if (p.enunciados && p.enunciados[i]) corpo += `<p><strong>${esc(p.enunciados[i])}</strong></p>`;
      const alts = (p.alternativas && p.alternativas[i]) || [];
      if (alts.length) {
        corpo += "<ol type='A'>";
        alts.forEach((a) => { corpo += `<li>${esc(a)}</li>`; });
        corpo += "</ol>";
      }
    }
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title></head><body>${corpo}</body></html>`;
  }

  global.parseDocumentoProva = parseDocumentoProva;
  global.montarHtmlProva = montarHtmlProva;
})(window);
