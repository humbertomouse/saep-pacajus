/* Planilha institucional SME Pacajus — SheetJS + imagens de canvas (sem gráfico nativo). */
(function (global) {
  function xlsxLib() {
    if (typeof XLSX !== "undefined") return XLSX;
    if (typeof require === "function") {
      try { return require("./xlsx.full.min.js"); } catch (e) { /* continua */ }
    }
    throw new Error("xlsx.full.min.js não foi carregado.");
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
  function u32be(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  function dosDateTime(d) {
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { date: date & 0xffff, time: time & 0xffff };
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const now = dosDateTime(new Date());
    const timeBytes = u16(now.time);
    const dateBytes = u16(now.date);
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, timeBytes[0], timeBytes[1], dateBytes[0], dateBytes[1]]),
        new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
        new Uint8Array(u16(name.length)), new Uint8Array(u16(0)), name, data,
      ]);
      locals.push(local);
      centrals.push(concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, timeBytes[0], timeBytes[1], dateBytes[0], dateBytes[1]]),
        new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
        new Uint8Array(u16(name.length)), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint8Array(u32(offset)), name,
      ]));
      offset += local.length;
    });
    const centralSize = centrals.reduce((s, p) => s + p.length, 0);
    return concat([...locals, ...centrals, concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]),
      new Uint8Array(u16(files.length)), new Uint8Array(u16(files.length)),
      new Uint8Array(u32(centralSize)), new Uint8Array(u32(offset)), new Uint8Array([0, 0]),
    ])]);
  }

  function unzipStore(buf) {
    const dec = new TextDecoder();
    const files = [];
    let o = 0;
    while (o + 4 <= buf.length) {
      const sig = u32le(buf, o);
      if (sig === 0x02014b50 || sig === 0x06054b50) break;
      if (sig !== 0x04034b50) throw new Error("ZIP local header inválido");
      const flags = u16le(buf, o + 6);
      const method = u16le(buf, o + 8);
      let comp = u32le(buf, o + 18);
      const nameLen = u16le(buf, o + 26);
      const extraLen = u16le(buf, o + 28);
      const name = dec.decode(buf.subarray(o + 30, o + 30 + nameLen));
      let dataStart = o + 30 + nameLen + extraLen;
      if (flags & 8) throw new Error("ZIP data descriptor não suportado: " + name);
      if (method !== 0) throw new Error("ZIP precisa ser STORE para sanitizar: " + name);
      files.push({ name: name, data: buf.slice(dataStart, dataStart + comp) });
      o = dataStart + comp;
    }
    return files;
  }

  function asText(data) {
    return typeof data === "string" ? data : new TextDecoder().decode(data);
  }

  function isXmlPart(name) {
    return /\.(xml|rels)$/i.test(name);
  }

  const C = {
    brand: "#1f6feb",
    ink: "#12203a",
    muted: "#5b6b86",
    line: "#d7e0ee",
    paper: "#ffffff",
    zebra: "#f4f8fe",
    ok: "#0f9d58",
    mid: "#1a73e8",
    crit: "#e37400",
    bad: "#d93025",
    grid: "#e8eef6",
  };
  const NIVEIS = ["ADEQUADO", "INTERMEDIÁRIO", "CRÍTICO", "MUITO CRÍTICO"];
  const NIVEL_COR = { ADEQUADO: C.ok, INTERMEDIÁRIO: C.mid, CRÍTICO: C.crit, "MUITO CRÍTICO": C.bad };

  function xmlSafe(v) {
    return String(v == null ? "" : v);
  }

  function num(v) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "";
    return Number(v);
  }

  function dataHoje() {
    return new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function recorteTexto(p) {
    const visao = p.visao === "turmas" ? "Por turmas" : "Geral da rede";
    return [visao, p.ano || "", p.disciplina || "", p.escola || ""].filter(Boolean).join(" · ");
  }

  function fmtBr(n, casas) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }

  function faixaNivel(media) {
    const v = Number(media) || 0;
    if (v <= 400) return "MUITO CRÍTICO";
    if (v <= 580) return "CRÍTICO";
    if (v <= 850) return "INTERMEDIÁRIO";
    return "ADEQUADO";
  }

  function niveisDe(e) {
    const nv = e && e.niveis ? e.niveis : {};
    return [num(nv.ADEQUADO), num(nv.INTERMEDIÁRIO), num(nv.CRÍTICO), num(nv["MUITO CRÍTICO"])];
  }

  function colWidths(ws, widths) {
    ws["!cols"] = widths.map((wch) => ({ wch: wch }));
  }

  function freeze(ws, rows) {
    ws["!freeze"] = { xSplit: 0, ySplit: rows, topLeftCell: "A" + (rows + 1), state: "frozen" };
    ws["!views"] = [{ state: "frozen", ySplit: rows, topLeftCell: "A" + (rows + 1), activeCell: "A" + (rows + 1) }];
  }

  function autoFilter(ws, ref) {
    ws["!autofilter"] = { ref: ref };
  }

  function mergeRow(ws, r, lastC) {
    const merges = ws["!merges"] || [];
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: lastC } });
    ws["!merges"] = merges;
  }

  function applyFmt(ws, addr, fmt) {
    const cell = ws[addr];
    if (cell && cell.t === "n") cell.z = fmt;
  }

  function colLetter(i) {
    let n = i;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetFromAoA(aoa, opts) {
    const XLSX = xlsxLib();
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
    if (opts && opts.widths) colWidths(ws, opts.widths);
    if (opts && opts.freezeRows) freeze(ws, opts.freezeRows);
    if (opts && opts.filter) autoFilter(ws, opts.filter);
    if (opts && opts.mergeTitleCols) {
      const last = opts.mergeTitleCols - 1;
      for (let r = 0; r < 4; r++) mergeRow(ws, r, last);
    }
    if (opts && opts.numFmts) {
      opts.numFmts.forEach((item) => applyFmt(ws, item.addr, item.fmt));
    }
    if (opts && opts.rowHeights) {
      const rows = [];
      Object.keys(opts.rowHeights).forEach((k) => { rows[+k] = { hpt: opts.rowHeights[k] }; });
      ws["!rows"] = rows;
    }
    return ws;
  }

  /* ---------- estilos institucionais (Excel 2016) ---------- */
  function professionalStyles() {
    const fonts = [
      "<font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font>",
      "<font><b/><sz val=\"16\"/><color rgb=\"FF1F6FEB\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"12\"/><color rgb=\"FF12203A\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><sz val=\"10\"/><color rgb=\"FF5B6B86\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FF12203A\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FF0F9D58\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FF1A73E8\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FFE37400\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
      "<font><b/><sz val=\"11\"/><color rgb=\"FFD93025\"/><name val=\"Calibri\"/><family val=\"2\"/></font>",
    ];
    const fills = [
      "<fill><patternFill patternType=\"none\"/></fill>",
      "<fill><patternFill patternType=\"gray125\"/></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1F6FEB\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFF4F8FE\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFD6E6FF\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE8F5E9\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE8F0FE\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFF3E0\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFDECEA\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF0F9D58\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF1A73E8\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE37400\"/><bgColor indexed=\"64\"/></patternFill></fill>",
      "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFD93025\"/><bgColor indexed=\"64\"/></patternFill></fill>",
    ];
    const borders = [
      "<border><left/><right/><top/><bottom/><diagonal/></border>",
      "<border><left style=\"thin\"><color rgb=\"FFD7E0EE\"/></left><right style=\"thin\"><color rgb=\"FFD7E0EE\"/></right><top style=\"thin\"><color rgb=\"FFD7E0EE\"/></top><bottom style=\"thin\"><color rgb=\"FFD7E0EE\"/></bottom><diagonal/></border>",
    ];
    function xf(numFmtId, fontId, fillId, borderId, extra, align) {
      let s = "<xf numFmtId=\"" + numFmtId + "\" fontId=\"" + fontId + "\" fillId=\"" + fillId + "\" borderId=\"" + borderId + "\" xfId=\"0\"";
      if (extra) s += " " + extra;
      if (align) s += ">" + align + "</xf>";
      else s += "/>";
      return s;
    }
    const center = "<alignment horizontal=\"center\" vertical=\"center\"/>";
    const wrap = "<alignment wrapText=\"1\" vertical=\"center\"/>";
    const xfs = [
      xf(0, 0, 0, 0),
      xf(0, 1, 0, 0, "applyFont=\"1\"", wrap),
      xf(0, 2, 0, 0, "applyFont=\"1\"", wrap),
      xf(0, 3, 0, 0, "applyFont=\"1\"", wrap),
      xf(0, 2, 0, 0, "applyFont=\"1\""),
      xf(0, 4, 2, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 0, 0, 1, "applyBorder=\"1\""),
      xf(0, 0, 3, 1, "applyFill=\"1\" applyBorder=\"1\""),
      xf(165, 0, 0, 1, "applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(165, 0, 3, 1, "applyNumberFormat=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(166, 0, 0, 1, "applyNumberFormat=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(166, 0, 3, 1, "applyNumberFormat=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 5, 4, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\""),
      xf(165, 5, 4, 1, "applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(166, 5, 4, 1, "applyNumberFormat=\"1\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 6, 5, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 7, 6, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 8, 7, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 9, 8, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 4, 9, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 4, 10, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 4, 11, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
      xf(0, 4, 12, 1, "applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\" applyAlignment=\"1\"", center),
    ];
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
      "<numFmts count=\"3\">" +
      "<numFmt numFmtId=\"164\" formatCode=\"0.0\"/>" +
      "<numFmt numFmtId=\"165\" formatCode=\"#,##0\"/>" +
      "<numFmt numFmtId=\"166\" formatCode=\"#,##0.0\"/>" +
      "</numFmts>" +
      "<fonts count=\"" + fonts.length + "\">" + fonts.join("") + "</fonts>" +
      "<fills count=\"" + fills.length + "\">" + fills.join("") + "</fills>" +
      "<borders count=\"" + borders.length + "\">" + borders.join("") + "</borders>" +
      "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
      "<cellXfs count=\"" + xfs.length + "\">" + xfs.join("") + "</cellXfs>" +
      "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
      "</styleSheet>";
  }

  const S = {
    title: 1, subtitle: 2, meta: 3, section: 4, header: 5,
    body: 6, zebra: 7, int: 8, intZ: 9, dec: 10, decZ: 11,
    total: 12, totalInt: 13, totalDec: 14,
    nvOk: 15, nvMid: 16, nvCrit: 17, nvBad: 18,
    hdOk: 19, hdMid: 20, hdCrit: 21, hdBad: 22,
  };

  function nivelStyle(nome, header) {
    if (nome === "ADEQUADO" || nome === "ADEQUADO".slice(0, 8)) return header ? S.hdOk : S.nvOk;
    if (String(nome).indexOf("INTERMEDI") === 0) return header ? S.hdMid : S.nvMid;
    if (String(nome) === "CRÍTICO" || String(nome) === "CRITICO") return header ? S.hdCrit : S.nvCrit;
    if (String(nome).indexOf("MUITO") === 0) return header ? S.hdBad : S.nvBad;
    return header ? S.header : S.body;
  }

  function cleanCore() {
    const iso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n" +
      "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
      "<dc:title>1o SAEP Pacajus</dc:title>" +
      "<dc:creator>SME Pacajus</dc:creator>" +
      "<cp:lastModifiedBy>SME Pacajus</cp:lastModifiedBy>" +
      "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + iso + "</dcterms:created>" +
      "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + iso + "</dcterms:modified>" +
      "</cp:coreProperties>";
  }

  function sanitizeFiles(files) {
    const out = [];
    files.forEach((f) => {
      if (f.name === "xl/metadata.xml") return;
      if (!isXmlPart(f.name)) {
        out.push(f);
        return;
      }
      let data = asText(f.data);
      if (f.name === "[Content_Types].xml") {
        data = data.replace(/<Override PartName="\/xl\/metadata\.xml"[^>]*\/>/g, "");
      } else if (f.name === "xl/_rels/workbook.xml.rels") {
        data = data.replace(/<Relationship[^>]*Target="metadata\.xml"[^>]*\/>/g, "");
      } else if (f.name === "xl/workbook.xml") {
        data = data.replace(/<workbookPr[^>]*\/>/g, "");
      } else if (f.name === "xl/styles.xml") {
        data = professionalStyles();
      } else if (f.name === "docProps/core.xml") {
        data = cleanCore();
      } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)) {
        data = data.replace(/<ignoredErrors>[\s\S]*?<\/ignoredErrors>/g, "");
      }
      out.push({ name: f.name, data: data });
    });
    return out;
  }

  function sheetMap(files) {
    const wb = asText(files.find((f) => f.name === "xl/workbook.xml").data);
    const rels = asText(files.find((f) => f.name === "xl/_rels/workbook.xml.rels").data);
    const ridTo = {};
    rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
      const id = (tag.match(/Id="([^"]+)"/) || [])[1];
      const tgt = (tag.match(/Target="([^"]+)"/) || [])[1];
      if (id && tgt) ridTo[id] = tgt.replace(/^\//, "");
    });
    const map = {};
    wb.replace(/<sheet\b[^>]*>/g, (tag) => {
      const name = (tag.match(/name="([^"]+)"/) || [])[1];
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
      if (!name || !rid || !ridTo[rid]) return;
      let t = ridTo[rid];
      if (t.indexOf("xl/") !== 0) t = "xl/" + t;
      map[name] = t;
    });
    return map;
  }

  function styleFromPlan(plan, col, row) {
    if (!plan) return null;
    if (plan.title && plan.title.indexOf(row) >= 0) return S.title;
    if (plan.subtitle && plan.subtitle.indexOf(row) >= 0) return S.subtitle;
    if (plan.meta && plan.meta.indexOf(row) >= 0) return S.meta;
    if (plan.sections && plan.sections.indexOf(row) >= 0) return S.section;
    if (plan.headers && plan.headers.indexOf(row) >= 0) {
      const hn = (plan.headerNivelByRow && plan.headerNivelByRow[row]) || plan.headerNivel;
      if (hn && hn[col] != null) return hn[col];
      return S.header;
    }
    if (plan.totals && plan.totals.indexOf(row) >= 0) {
      if (plan.intCols && plan.intCols.indexOf(col) >= 0) return S.totalInt;
      if (plan.decCols && plan.decCols.indexOf(col) >= 0) return S.totalDec;
      return S.total;
    }
    if (plan.legend && plan.legend[row]) return plan.legend[row];
    const ranges = plan.dataRanges || [];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (row < r.start || row > r.end) continue;
      const zebra = (row - r.start) % 2 === 1;
      if (r.nivelCol && col === r.nivelCol) {
        return null;
      }
      if (r.intCols && r.intCols.indexOf(col) >= 0) return zebra ? S.intZ : S.int;
      if (r.decCols && r.decCols.indexOf(col) >= 0) return zebra ? S.decZ : S.dec;
      return zebra ? S.zebra : S.body;
    }
    return null;
  }

  function patchCellStyles(xml, plan, nivelValues) {
    return xml.replace(/<c(\s+[^>/]*)(\/?)>/g, (full, attrs, self) => {
      const rm = /r="([A-Z]+)(\d+)"/.exec(attrs);
      if (!rm) return full;
      const col = rm[1];
      const row = +rm[2];
      let style = styleFromPlan(plan, col, row);
      if (nivelValues && nivelValues[rm[1] + rm[2]] != null) style = nivelValues[rm[1] + rm[2]];
      if (style == null) return full;
      attrs = attrs.replace(/\s+s="\d+"/, "");
      attrs += " s=\"" + style + "\"";
      return "<c" + attrs + (self ? "/>" : ">");
    });
  }

  function collectNivelStyles(xml, plan) {
    const out = {};
    if (!plan || !plan.dataRanges) return out;
    xml.replace(/<c\s+([^>]*)>[\s\S]*?<v>([\s\S]*?)<\/v>/g, (full, attrs, v) => {
      const rm = /r="([A-Z]+)(\d+)"/.exec(attrs);
      if (!rm) return;
      const col = rm[1];
      const row = +rm[2];
      plan.dataRanges.forEach((r) => {
        if (r.nivelCol && col === r.nivelCol && row >= r.start && row <= r.end) {
          let nome = v;
          if (/t="s"/.test(attrs)) return;
          out[col + row] = nivelStyle(nome, false);
        }
      });
    });
    return out;
  }

  function sharedStringList(files) {
    const f = files.find((x) => x.name === "xl/sharedStrings.xml");
    if (!f) return [];
    const out = [];
    asText(f.data).replace(/<si>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/g, (_, t) => {
      out.push(String(t).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    });
    return out;
  }

  function applySheetPlans(files, plans) {
    const sst = sharedStringList(files);
    const map = sheetMap(files);
    Object.keys(plans).forEach((name) => {
      const path = map[name];
      if (!path) return;
      const file = files.find((f) => f.name === path);
      if (!file) return;
      let xml = asText(file.data);
      const nivelVals = {};
      xml.replace(/<c\s+([^>]*)>(?:<v>([\s\S]*?)<\/v>)?/g, (full, attrs, v) => {
        const rm = /r="([A-Z]+)(\d+)"/.exec(attrs);
        if (!rm || v == null) return;
        const plan = plans[name];
        const text = /t="s"/.test(attrs) ? (sst[+v] || "") : String(v).replace(/&amp;/g, "&");
        const ranges = (plan && plan.dataRanges) || [];
        ranges.forEach((r) => {
          if (r.nivelCol && rm[1] === r.nivelCol && +rm[2] >= r.start && +rm[2] <= r.end) {
            nivelVals[rm[1] + rm[2]] = nivelStyle(text, false);
          }
        });
      });
      file.data = patchCellStyles(xml, plans[name], nivelVals);
    });
    return files;
  }

  /* ---------- canvas / PNG ---------- */
  const FONT5 = {
    " ": [0, 0, 0, 0, 0, 0, 0],
    "-": [0, 0, 0, 14, 0, 0, 0],
    "–": [0, 0, 0, 14, 0, 0, 0],
    ".": [0, 0, 0, 0, 0, 0, 4],
    ",": [0, 0, 0, 0, 0, 4, 8],
    ":": [0, 0, 4, 0, 4, 0, 0],
    "+": [0, 4, 4, 31, 4, 4, 0],
    "%": [17, 18, 4, 8, 16, 9, 17],
    "/": [1, 2, 4, 8, 16, 0, 0],
    "(": [4, 8, 8, 8, 8, 8, 4],
    ")": [8, 4, 4, 4, 4, 4, 8],
    "º": [14, 10, 14, 0, 0, 0, 0],
    "0": [14, 17, 19, 21, 25, 17, 14],
    "1": [4, 12, 4, 4, 4, 4, 14],
    "2": [14, 17, 1, 6, 8, 16, 31],
    "3": [14, 17, 1, 6, 1, 17, 14],
    "4": [2, 6, 10, 18, 31, 2, 2],
    "5": [31, 16, 30, 1, 1, 17, 14],
    "6": [14, 17, 16, 30, 17, 17, 14],
    "7": [31, 1, 2, 4, 8, 8, 8],
    "8": [14, 17, 17, 14, 17, 17, 14],
    "9": [14, 17, 17, 15, 1, 17, 14],
    "A": [14, 17, 17, 31, 17, 17, 17],
    "B": [30, 17, 17, 30, 17, 17, 30],
    "C": [14, 17, 16, 16, 16, 17, 14],
    "D": [30, 17, 17, 17, 17, 17, 30],
    "E": [31, 16, 16, 30, 16, 16, 31],
    "F": [31, 16, 16, 30, 16, 16, 16],
    "G": [14, 17, 16, 19, 17, 17, 14],
    "H": [17, 17, 17, 31, 17, 17, 17],
    "I": [14, 4, 4, 4, 4, 4, 14],
    "J": [1, 1, 1, 1, 17, 17, 14],
    "K": [17, 18, 20, 24, 20, 18, 17],
    "L": [16, 16, 16, 16, 16, 16, 31],
    "M": [17, 27, 21, 21, 17, 17, 17],
    "N": [17, 25, 21, 19, 17, 17, 17],
    "O": [14, 17, 17, 17, 17, 17, 14],
    "P": [30, 17, 17, 30, 16, 16, 16],
    "Q": [14, 17, 17, 17, 21, 18, 13],
    "R": [30, 17, 17, 30, 20, 18, 17],
    "S": [14, 17, 16, 14, 1, 17, 14],
    "T": [31, 4, 4, 4, 4, 4, 4],
    "U": [17, 17, 17, 17, 17, 17, 14],
    "V": [17, 17, 17, 17, 17, 10, 4],
    "W": [17, 17, 17, 21, 21, 21, 10],
    "X": [17, 17, 10, 4, 10, 17, 17],
    "Y": [17, 17, 10, 4, 4, 4, 4],
    "Z": [31, 1, 2, 4, 8, 16, 31],
  };

  function foldAscii(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[—–]/g, "-")
      .replace(/[·•]/g, ".")
      .replace(/º/g, "o");
  }

  function parseColor(s) {
    if (!s) return [18, 32, 58, 255];
    s = String(s).trim();
    if (s.charAt(0) === "#") {
      let h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
    }
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 255 : Math.round(+m[4] * 255)];
    return [18, 32, 58, 255];
  }

  function SoftCanvas(w, h) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = 255; this.data[i + 1] = 255; this.data[i + 2] = 255; this.data[i + 3] = 255;
    }
    const self = this;
    this.getContext = function () { return new SoftCtx(self); };
    this.toPngBytes = function () { return encodePngRgb(self.width, self.height, self.data); };
  }

  function SoftCtx(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000000";
    this.strokeStyle = "#000000";
    this.lineWidth = 1;
    this.font = "12px sans-serif";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
    this._path = [];
    this._stack = [];
  }
  SoftCtx.prototype.save = function () {
    this._stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline });
  };
  SoftCtx.prototype.restore = function () {
    const s = this._stack.pop();
    if (s) Object.keys(s).forEach((k) => { this[k] = s[k]; });
  };
  SoftCtx.prototype._set = function (x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const i = (y * this.canvas.width + x) * 4;
    const a = rgba[3] / 255;
    this.canvas.data[i] = Math.round(rgba[0] * a + this.canvas.data[i] * (1 - a));
    this.canvas.data[i + 1] = Math.round(rgba[1] * a + this.canvas.data[i + 1] * (1 - a));
    this.canvas.data[i + 2] = Math.round(rgba[2] * a + this.canvas.data[i + 2] * (1 - a));
    this.canvas.data[i + 3] = 255;
  };
  SoftCtx.prototype.fillRect = function (x, y, w, h) {
    const c = parseColor(this.fillStyle);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.canvas.width, Math.ceil(x + w));
    const y1 = Math.min(this.canvas.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this._set(xx, yy, c);
  };
  SoftCtx.prototype.strokeRect = function (x, y, w, h) {
    const lw = Math.max(1, Math.round(this.lineWidth));
    this.save();
    this.fillStyle = this.strokeStyle;
    this.fillRect(x, y, w, lw);
    this.fillRect(x, y + h - lw, w, lw);
    this.fillRect(x, y, lw, h);
    this.fillRect(x + w - lw, y, lw, h);
    this.restore();
  };
  SoftCtx.prototype.beginPath = function () { this._path = []; };
  SoftCtx.prototype.moveTo = function (x, y) { this._path.push({ t: "m", x: x, y: y }); };
  SoftCtx.prototype.lineTo = function (x, y) { this._path.push({ t: "l", x: x, y: y }); };
  SoftCtx.prototype.closePath = function () { this._path.push({ t: "z" }); };
  SoftCtx.prototype.stroke = function () {
    const c = parseColor(this.strokeStyle);
    let x = 0, y = 0, sx = 0, sy = 0;
    const self = this;
    function line(x0, y0, x1, y1) {
      let dx = Math.abs(x1 - x0), sxn = x0 < x1 ? 1 : -1;
      let dy = -Math.abs(y1 - y0), syn = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      for (;;) {
        self._set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sxn; }
        if (e2 <= dx) { err += dx; y0 += syn; }
      }
    }
    this._path.forEach((p) => {
      if (p.t === "m") { x = sx = p.x; y = sy = p.y; }
      else if (p.t === "l") { line(x, y, p.x, p.y); x = p.x; y = p.y; }
      else if (p.t === "z") { line(x, y, sx, sy); x = sx; y = sy; }
    });
  };
  SoftCtx.prototype.fill = function () {};
  SoftCtx.prototype.roundRect = function (x, y, w, h) { this.fillRect(x, y, w, h); };
  SoftCtx.prototype._fontSize = function () {
    const m = /(\d+)px/.exec(this.font);
    return m ? +m[1] : 12;
  };
  SoftCtx.prototype.measureText = function (text) {
    const scale = Math.max(1, Math.round(this._fontSize() / 8));
    return { width: foldAscii(text).length * 6 * scale };
  };
  SoftCtx.prototype.fillText = function (text, x, y) {
    const scale = Math.max(1, Math.round(this._fontSize() / 8));
    const src = foldAscii(text).toUpperCase();
    const w = src.length * 6 * scale;
    let px = Math.round(x);
    if (this.textAlign === "center") px -= Math.round(w / 2);
    if (this.textAlign === "right") px -= w;
    let py = Math.round(y);
    if (this.textBaseline === "middle" || this.textBaseline === "alphabetic") py -= Math.round((7 * scale) / 2);
    const c = parseColor(this.fillStyle);
    for (let i = 0; i < src.length; i++) {
      const g = FONT5[src.charAt(i)] || FONT5[" "];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row] & (16 >> col)) {
            for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
              this._set(px + i * 6 * scale + col * scale + sx, py + row * scale + sy, c);
            }
          }
        }
      }
    }
  };

  function pngChunk(type, data) {
    const t = new TextEncoder().encode(type);
    const body = concat([t, data]);
    return concat([new Uint8Array(u32be(data.length)), body, new Uint8Array(u32be(crc32(body)))]);
  }

  function encodePngRgb(w, h, rgba) {
    const raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const o = y * (w * 3 + 1) + 1 + x * 3;
        raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2];
      }
    }
    let compressed;
    if (typeof require === "function") {
      compressed = new Uint8Array(require("zlib").deflateSync(Buffer.from(raw)));
    } else {
      throw new Error("PNG software precisa de zlib");
    }
    const ihdr = concat([new Uint8Array(u32be(w)), new Uint8Array(u32be(h)), new Uint8Array([8, 2, 0, 0, 0])]);
    return concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", compressed),
      pngChunk("IEND", new Uint8Array(0)),
    ]);
  }

  function createSurface(w, h) {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.textBaseline = "middle";
      return { canvas: c, ctx: ctx, kind: "dom" };
    }
    const c = new SoftCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.textBaseline = "middle";
    return { canvas: c, ctx: ctx, kind: "soft" };
  }

  function surfacePng(surface) {
    if (surface.kind === "soft") return surface.canvas.toPngBytes();
    const url = surface.canvas.toDataURL("image/png");
    const b64 = url.split(",")[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r || 0, w / 2, h / 2);
    if (ctx.roundRect && rad) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rad);
      ctx.fill();
      return;
    }
    ctx.fillRect(x, y, w, h);
  }

  function paintFrame(ctx, w, h, title, subtitle) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.brand;
    ctx.fillRect(0, 0, w, 56);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 22px Segoe UI, Calibri, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(title, 24, 28);
    ctx.font = "400 12px Segoe UI, Calibri, Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(subtitle, 24, 46);
    ctx.fillStyle = C.muted;
    ctx.font = "400 11px Segoe UI, Calibri, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("SME Pacajus — 1º SAEP", 24, h - 16);
    ctx.textAlign = "right";
    ctx.fillText("Painel institucional", w - 24, h - 16);
    ctx.textAlign = "left";
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  function chartKpis(p) {
    const w = 1400, h = 220;
    const s = createSurface(w, h);
    const ctx = s.ctx;
    const recorte = recorteTexto(p);
    paintFrame(ctx, w, h, "Indicadores do recorte", recorte);
    const linhas = p.linhasPainel || p.ranking || [];
    const escolas = p.linhasEscolas || [];
    const focoNome = p.visao === "turmas" ? (p.turma && p.turma !== "Todas" ? p.turma : "") : (p.escola || "");
    const foco = (p.linhasPainel || []).find((e) => e.nome === focoNome) || linhas[0] || {};
    const redeAlunos = escolas.reduce((a, e) => a + (e.avaliados || 0), 0);
    const redeSoma = escolas.reduce((a, e) => a + (e.mediaProf || 0) * (e.avaliados || 0), 0);
    const mediaRede = redeAlunos ? redeSoma / redeAlunos : 0;
    const adeq = Number((p.niveisFoco || {}).ADEQUADO || 0);
    const inter = Number((p.niveisFoco || {}).INTERMEDIÁRIO || 0);
    const cards = [
      { k: p.visao === "turmas" ? "Turmas / escola" : "Escola em destaque", v: focoNome || p.escola || "Rede", s: (foco.avaliados || 0) + " avaliados" },
      { k: "Proficiência média", v: fmtBr(foco.mediaProf, 1), s: faixaNivel(foco.mediaProf) },
      { k: p.rotuloRef || "Rede", v: fmtBr(mediaRede || (p.ranking && p.ranking[0] && 0), 1), s: escolas.length + " escolas" },
      { k: "Adequado + intermediário", v: fmtBr(adeq + inter, 1) + "%", s: (p.rotuloFoco || "Foco") },
    ];
    if (!mediaRede && p.niveisRef) cards[2].v = fmtBr(mediaRede, 1);
    const boxY = 72, boxH = 118, gap = 16;
    const boxW = (w - 48 - gap * 3) / 4;
    const accents = [C.brand, NIVEL_COR[faixaNivel(foco.mediaProf)] || C.brand, C.mid, C.ok];
    cards.forEach((card, i) => {
      const x = 24 + i * (boxW + gap);
      ctx.fillStyle = C.zebra;
      rr(ctx, x, boxY, boxW, boxH, 10);
      ctx.fillStyle = accents[i];
      ctx.fillRect(x, boxY, 6, boxH);
      ctx.fillStyle = C.muted;
      ctx.font = "600 12px Segoe UI, Calibri, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(card.k, x + 20, boxY + 28);
      ctx.fillStyle = C.ink;
      ctx.font = "700 28px Segoe UI, Calibri, Arial, sans-serif";
      ctx.fillText(String(card.v), x + 20, boxY + 64);
      ctx.fillStyle = C.muted;
      ctx.font = "400 12px Segoe UI, Calibri, Arial, sans-serif";
      ctx.fillText(String(card.s), x + 20, boxY + 94);
    });
    return { png: surfacePng(s), w: w, h: h, name: "Indicadores" };
  }

  function chartRanking(p) {
    const rows = (p.linhasPainel && p.linhasPainel.length ? p.linhasPainel : (p.ranking || [])).slice();
    const n = Math.max(rows.length, 1);
    const w = 1400, h = Math.min(1100, 130 + n * 36 + 48);
    const s = createSurface(w, h);
    const ctx = s.ctx;
    paintFrame(ctx, w, h, p.visao === "turmas" ? "Ranking de turmas" : "Ranking de escolas", recorteTexto(p) + "  ·  média de proficiência");
    const top = 78, bottom = h - 40, left = 320, right = w - 90;
    const plotH = bottom - top;
    const rowH = plotH / n;
    const max = 1000;
    ctx.font = "400 11px Segoe UI, Calibri, Arial, sans-serif";
    ctx.fillStyle = C.muted;
    ctx.textAlign = "center";
    [0, 250, 500, 750, 1000].forEach((tick) => {
      const x = left + (right - left) * (tick / max);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.fillText(fmtBr(tick, 0), x, bottom + 14);
    });
    const focoNome = p.visao === "turmas" ? (p.turma && p.turma !== "Todas" ? p.turma : "") : (p.escola || "");
    rows.forEach((e, i) => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(244,248,254,0.85)";
        ctx.fillRect(16, y, w - 32, rowH);
      }
      const val = Number(e.mediaProf) || 0;
      const bw = (right - left) * Math.max(0, Math.min(1, val / max));
      ctx.fillStyle = NIVEL_COR[faixaNivel(val)];
      rr(ctx, left, cy - 10, Math.max(bw, 2), 20, 4);
      if (e.nome === focoNome) {
        ctx.strokeStyle = C.brand;
        ctx.lineWidth = 2;
        ctx.strokeRect(16, y + 2, w - 32, rowH - 4);
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = C.ink;
      ctx.font = "700 13px Segoe UI, Calibri, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText((i + 1) + "º  " + (e.nome || ""), 24, cy);
      ctx.textAlign = "right";
      ctx.font = "700 13px Segoe UI, Calibri, Arial, sans-serif";
      ctx.fillText(fmtBr(val, 1), w - 24, cy);
    });
    return { png: surfacePng(s), w: w, h: h, name: "Ranking" };
  }

  function chartNiveis(p) {
    const w = 1400, h = 520;
    const s = createSurface(w, h);
    const ctx = s.ctx;
    const foco = p.rotuloFoco || "Foco";
    const ref = p.rotuloRef || "Rede";
    paintFrame(ctx, w, h, "Níveis de aprendizagem", recorteTexto(p) + "  ·  " + foco + " versus " + ref);
    const top = 100, bottom = h - 70, left = 90, right = w - 40;
    const groupW = (right - left) / NIVEIS.length;
    ctx.font = "400 11px Segoe UI, Calibri, Arial, sans-serif";
    ctx.textAlign = "right";
    [0, 25, 50, 75, 100].forEach((tick) => {
      const y = bottom - (bottom - top) * (tick / 100);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.fillText(tick + "%", left - 10, y);
    });
    NIVEIS.forEach((nv, i) => {
      const gx = left + i * groupW;
      const vf = Number((p.niveisFoco || {})[nv] || 0);
      const vr = Number((p.niveisRef || {})[nv] || 0);
      const barW = 42;
      const x1 = gx + groupW / 2 - barW - 8;
      const x2 = gx + groupW / 2 + 8;
      const h1 = (bottom - top) * Math.max(0, Math.min(1, vf / 100));
      const h2 = (bottom - top) * Math.max(0, Math.min(1, vr / 100));
      ctx.fillStyle = NIVEL_COR[nv];
      rr(ctx, x1, bottom - h1, barW, Math.max(h1, 2), 4);
      ctx.fillStyle = "rgba(18,32,58,0.28)";
      rr(ctx, x2, bottom - h2, barW, Math.max(h2, 2), 4);
      ctx.fillStyle = C.ink;
      ctx.font = "700 11px Segoe UI, Calibri, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fmtBr(vf, 1) + "%", x1 + barW / 2, bottom - h1 - 12);
      ctx.fillStyle = C.muted;
      ctx.fillText(fmtBr(vr, 1) + "%", x2 + barW / 2, bottom - h2 - 12);
      ctx.fillStyle = C.ink;
      ctx.font = "700 12px Segoe UI, Calibri, Arial, sans-serif";
      ctx.fillText(nv, gx + groupW / 2, bottom + 22);
    });
    ctx.fillStyle = NIVEL_COR.ADEQUADO;
    ctx.fillRect(w - 360, 70, 14, 14);
    ctx.fillStyle = C.ink;
    ctx.font = "600 12px Segoe UI, Calibri, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(foco, w - 340, 77);
    ctx.fillStyle = "rgba(18,32,58,0.28)";
    ctx.fillRect(w - 220, 70, 14, 14);
    ctx.fillStyle = C.ink;
    ctx.fillText(ref, w - 200, 77);
    return { png: surfacePng(s), w: w, h: h, name: "Niveis" };
  }

  function chartComposicao(p) {
    const rows = (p.linhasPainel || p.linhasEscolas || []).filter((e) => e.niveis);
    if (!rows.length) return null;
    const n = rows.length;
    const w = 1400, h = Math.min(1100, 130 + n * 34 + 48);
    const s = createSurface(w, h);
    const ctx = s.ctx;
    paintFrame(ctx, w, h, "Composição por nível", recorteTexto(p) + "  ·  participação percentual dos avaliados");
    const top = 88, bottom = h - 40, left = 280, right = w - 40;
    const rowH = (bottom - top) / n;
    rows.forEach((e, i) => {
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      const total = NIVEIS.reduce((a, nv) => a + ((e.niveis && e.niveis[nv]) || 0), 0) || 1;
      let x = left;
      NIVEIS.forEach((nv) => {
        const part = ((e.niveis && e.niveis[nv]) || 0) / total;
        const bw = (right - left) * part;
        ctx.fillStyle = NIVEL_COR[nv];
        ctx.fillRect(x, cy - 9, Math.max(bw, part ? 1 : 0), 18);
        x += bw;
      });
      ctx.fillStyle = C.ink;
      ctx.font = "600 12px Segoe UI, Calibri, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(e.nome || "", 24, cy);
    });
    let lx = 280;
    NIVEIS.forEach((nv) => {
      ctx.fillStyle = NIVEL_COR[nv];
      ctx.fillRect(lx, h - 28, 10, 10);
      ctx.fillStyle = C.ink;
      ctx.font = "600 10px Segoe UI, Calibri, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(nv, lx + 14, h - 23);
      lx += 160;
    });
    return { png: surfacePng(s), w: w, h: h, name: "Composicao" };
  }

  function renderDashboardImages(p) {
    const imgs = [];
    try { imgs.push(chartKpis(p)); } catch (e) { /* segue */ }
    try { imgs.push(chartRanking(p)); } catch (e) { /* segue */ }
    try { imgs.push(chartNiveis(p)); } catch (e) { /* segue */ }
    try {
      const extra = chartComposicao(p);
      if (extra) imgs.push(extra);
    } catch (e) { /* segue */ }
    return imgs.filter(Boolean);
  }

  /* ---------- desenho OOXML (após SheetJS) ---------- */
  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function nextRid(relsXml) {
    let max = 0;
    const re = /Id="rId(\d+)"/g;
    let m;
    while ((m = re.exec(relsXml || ""))) max = Math.max(max, +m[1]);
    return max + 1;
  }

  function drawingXml(images) {
    let body = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
    body += "<xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">";
    let row = 6;
    images.forEach((img, i) => {
      const cx = Math.round(img.w * 9525);
      const cy = Math.round(img.h * 9525);
      const id = i + 2;
      body += "<xdr:oneCellAnchor>";
      body += "<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>" + row + "</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>";
      body += "<xdr:ext cx=\"" + cx + "\" cy=\"" + cy + "\"/>";
      body += "<xdr:pic><xdr:nvPicPr>";
      body += "<xdr:cNvPr id=\"" + id + "\" name=\"" + escXml(img.name) + "\"/>";
      body += "<xdr:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></xdr:cNvPicPr>";
      body += "</xdr:nvPicPr><xdr:blipFill>";
      body += "<a:blip xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" r:embed=\"rId" + (i + 1) + "\"/>";
      body += "<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>";
      body += "<xdr:spPr><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></xdr:spPr>";
      body += "</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>";
      row += Math.ceil(img.h / 20) + 1;
    });
    body += "</xdr:wsDr>";
    return body;
  }

  function drawingRels(images) {
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
    xml += "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">";
    images.forEach((img, i) => {
      xml += "<Relationship Id=\"rId" + (i + 1) + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/" + img.file + "\"/>";
    });
    xml += "</Relationships>";
    return xml;
  }

  function embedSheetImages(files, sheetName, images) {
    if (!images || !images.length) return files;
    const map = sheetMap(files);
    const sheetPath = map[sheetName];
    if (!sheetPath) return files;
    const sheetFile = files.find((f) => f.name === sheetPath);
    if (!sheetFile) return files;

    const drawName = "drawing1.xml";
    images.forEach((img, i) => {
      img.file = "image" + (i + 1) + ".png";
      files.push({ name: "xl/media/" + img.file, data: img.png });
    });
    files.push({ name: "xl/drawings/" + drawName, data: drawingXml(images) });
    files.push({ name: "xl/drawings/_rels/" + drawName + ".rels", data: drawingRels(images) });

    const relsPath = sheetPath.replace("worksheets/", "worksheets/_rels/") + ".rels";
    let relsFile = files.find((f) => f.name === relsPath);
    let rels = relsFile ? asText(relsFile.data) : "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>";
    const rid = "rId" + nextRid(rels);
    rels = rels.replace("</Relationships>", "<Relationship Id=\"" + rid + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/" + drawName + "\"/></Relationships>");
    if (relsFile) relsFile.data = rels;
    else files.push({ name: relsPath, data: rels });

    let sheet = asText(sheetFile.data);
    if (!/xmlns:r=/.test(sheet)) {
      sheet = sheet.replace("<worksheet ", "<worksheet xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
    }
    if (!/<drawing /.test(sheet)) {
      sheet = sheet.replace("</worksheet>", "<drawing r:id=\"" + rid + "\"/></worksheet>");
    }
    sheetFile.data = sheet;

    const ct = files.find((f) => f.name === "[Content_Types].xml");
    if (ct) {
      let xml = asText(ct.data);
      if (!/Extension="png"/.test(xml)) {
        xml = xml.replace("<Default Extension=\"rels\"", "<Default Extension=\"png\" ContentType=\"image/png\"/><Default Extension=\"rels\"");
        if (!/Extension="png"/.test(xml)) {
          xml = xml.replace("</Types>", "<Default Extension=\"png\" ContentType=\"image/png\"/></Types>");
        }
      }
      if (!/drawings\/drawing1\.xml/.test(xml)) {
        xml = xml.replace("</Types>", "<Override PartName=\"/xl/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/></Types>");
      }
      ct.data = xml;
    }
    return files;
  }

  /* ---------- abas ---------- */
  function capaSheet(p, hoje) {
    const recorte = recorteTexto(p);
    const aoa = [
      ["SECRETARIA MUNICIPAL DE EDUCAÇÃO DE PACAJUS"],
      ["1º SAEP — relatório institucional"],
      [recorte],
      ["Gerado em " + hoje],
      [],
      ["Como usar esta pasta"],
      ["Aba Painel: dashboard com gráficos institucionais (imagens, não o gráfico padrão do Excel)."],
      ["Aba Resumo: ranking, escolas, turmas e totais da rede."],
      ["Aba Alunos: lançamentos feitos nesta página."],
      ["Aba Para graficos: faixas numéricas limpas caso queira inserir um gráfico no Excel."],
      [],
      ["Níveis de aprendizagem"],
      ["Nível", "Faixa", "Cor"],
      ["ADEQUADO", "acima de 850 até 1000", "verde"],
      ["INTERMEDIÁRIO", "acima de 580 até 850", "azul"],
      ["CRÍTICO", "acima de 400 até 580", "laranja"],
      ["MUITO CRÍTICO", "até 400", "vermelho"],
    ];
    const plan = {
      title: [1], subtitle: [2], meta: [3, 4], sections: [6, 12],
      headers: [13],
      legend: { 14: S.nvOk, 15: S.nvMid, 16: S.nvCrit, 17: S.nvBad },
    };
    return {
      ws: sheetFromAoA(aoa, { widths: [42, 28, 16, 14, 14, 16], mergeTitleCols: 6, rowHeights: { 0: 24, 1: 20 } }),
      plan: plan,
    };
  }

  function alunosSheet(p, hoje) {
    const recorte = recorteTexto(p);
    const alunos = p.baseAlunos || [];
    const headers = ["Escola", "Turma", "Ano", "Disciplina", "Aluno", "NEE", "Falta", "Finalizado", "Acertos", "Porcentagem", "Proficiencia", "Nivel"];
    const aoa = [
      ["SECRETARIA MUNICIPAL DE EDUCAÇÃO DE PACAJUS"],
      ["1º SAEP — alunos"],
      [recorte],
      ["Gerado em " + hoje],
      headers,
    ];
    const numFmts = [];
    if (!alunos.length) {
      aoa.push(["Nenhum lançamento local nesta página."]);
    } else {
      alunos.forEach((r, i) => {
        aoa.push([
          xmlSafe(r.escola), xmlSafe(r.turma), xmlSafe(r.ano), xmlSafe(r.disciplina),
          xmlSafe(r.aluno), r.nee ? "X" : "", r.falta ? "X" : "", r.finalizado ? "X" : "",
          num(r.acertos), num(r.porc), num(r.prof), xmlSafe(r.nivel),
        ]);
        const row = 6 + i;
        numFmts.push({ addr: "I" + row, fmt: "0" });
        numFmts.push({ addr: "J" + row, fmt: "0.0" });
        numFmts.push({ addr: "K" + row, fmt: "0.0" });
      });
    }
    const last = Math.max(5, aoa.length);
    const plan = {
      title: [1], subtitle: [2], meta: [3, 4], headers: [5],
      dataRanges: alunos.length ? [{ start: 6, end: last, intCols: ["I"], decCols: ["J", "K"], nivelCol: "L" }] : [],
    };
    return {
      ws: sheetFromAoA(aoa, {
        widths: [22, 12, 8, 18, 36, 8, 8, 12, 10, 12, 13, 18],
        freezeRows: 5,
        filter: alunos.length ? "A5:L" + last : null,
        mergeTitleCols: 12,
        numFmts: numFmts,
      }),
      plan: plan,
    };
  }

  function resumoSheet(p, hoje) {
    const recorte = recorteTexto(p);
    const escolas = p.linhasEscolas || [];
    const turmas = p.linhasTurmas || [];
    const rank = p.ranking || [];
    const numFmts = [];
    const aoa = [
      ["SECRETARIA MUNICIPAL DE EDUCAÇÃO DE PACAJUS"],
      ["1º SAEP — resumo (escolas, turmas e ranking)"],
      [recorte],
      ["Gerado em " + hoje],
      [],
      ["Escolas"],
      ["Posicao", "Escola", "Alunos", "Avaliados", "Faltas", "Media", "ADEQUADO", "INTERMEDIARIO", "CRITICO", "MUITO CRITICO"],
    ];
    function pushNumFmts(row, mediaCol, intCols) {
      intCols.forEach((col) => numFmts.push({ addr: colLetter(col) + row, fmt: "0" }));
      if (mediaCol) numFmts.push({ addr: colLetter(mediaCol) + row, fmt: "0.0" });
    }
    const hEscolas = 7;
    const d0 = 8;
    escolas.forEach((e, i) => {
      aoa.push([i + 1, xmlSafe(e.nome), num(e.alunos), num(e.avaliados), num(e.faltas), num(e.mediaProf), ...niveisDe(e)]);
      pushNumFmts(aoa.length, 6, [1, 3, 4, 5, 7, 8, 9, 10]);
    });
    let tEscolas = 0;
    if (escolas.length) {
      aoa.push([
        "", "Total da rede",
        escolas.reduce((s, e) => s + (e.alunos || 0), 0),
        escolas.reduce((s, e) => s + (e.avaliados || 0), 0),
        escolas.reduce((s, e) => s + (e.faltas || 0), 0),
        "",
        escolas.reduce((s, e) => s + ((e.niveis && e.niveis.ADEQUADO) || 0), 0),
        escolas.reduce((s, e) => s + ((e.niveis && e.niveis.INTERMEDIÁRIO) || 0), 0),
        escolas.reduce((s, e) => s + ((e.niveis && e.niveis.CRÍTICO) || 0), 0),
        escolas.reduce((s, e) => s + ((e.niveis && e.niveis["MUITO CRÍTICO"]) || 0), 0),
      ]);
      tEscolas = aoa.length;
    } else {
      aoa.push(["", "Sem dados neste recorte."]);
    }
    const d1 = tEscolas ? tEscolas - 1 : aoa.length;
    aoa.push([]);
    aoa.push(["Turmas"]);
    const secTurmas = aoa.length;
    aoa.push(["Posicao", "Escola", "Turma", "Alunos", "Avaliados", "Faltas", "Media", "ADEQUADO", "INTERMEDIARIO", "CRITICO", "MUITO CRITICO"]);
    const hTurmas = aoa.length;
    const t0 = aoa.length + 1;
    turmas.forEach((e, i) => {
      aoa.push([i + 1, xmlSafe(e.escola), xmlSafe(e.nome), num(e.alunos), num(e.avaliados), num(e.faltas), num(e.mediaProf), ...niveisDe(e)]);
      pushNumFmts(aoa.length, 7, [1, 4, 5, 6, 8, 9, 10, 11]);
    });
    let tTurmas = 0;
    if (turmas.length) {
      aoa.push([
        "", "Total", "",
        turmas.reduce((s, e) => s + (e.alunos || 0), 0),
        turmas.reduce((s, e) => s + (e.avaliados || 0), 0),
        turmas.reduce((s, e) => s + (e.faltas || 0), 0),
        "",
        turmas.reduce((s, e) => s + ((e.niveis && e.niveis.ADEQUADO) || 0), 0),
        turmas.reduce((s, e) => s + ((e.niveis && e.niveis.INTERMEDIÁRIO) || 0), 0),
        turmas.reduce((s, e) => s + ((e.niveis && e.niveis.CRÍTICO) || 0), 0),
        turmas.reduce((s, e) => s + ((e.niveis && e.niveis["MUITO CRÍTICO"]) || 0), 0),
      ]);
      tTurmas = aoa.length;
    } else {
      aoa.push(["", "Sem dados neste recorte."]);
    }
    const t1 = tTurmas ? tTurmas - 1 : aoa.length;
    aoa.push([]);
    aoa.push(["Dados para gráfico"]);
    const secGraf = aoa.length;
    aoa.push(["Item", "Proficiencia", "", "Nivel", p.rotuloFoco || "Foco", p.rotuloRef || "Referencia"]);
    const hGraf = aoa.length;
    const g0 = aoa.length + 1;
    const gMax = Math.max(rank.length, NIVEIS.length, 1);
    for (let i = 0; i < gMax; i++) {
      const item = rank[i];
      const nv = NIVEIS[i];
      aoa.push([
        item ? xmlSafe(item.nome) : "",
        item ? num(item.mediaProf) : "",
        "",
        nv || "",
        nv ? num((p.niveisFoco || {})[nv] || 0) : "",
        nv ? num((p.niveisRef || {})[nv] || 0) : "",
      ]);
      pushNumFmts(aoa.length, 2, [5, 6]);
    }
    const g1 = aoa.length;
    const plan = {
      title: [1], subtitle: [2], meta: [3, 4],
      sections: [6, secTurmas, secGraf],
      headers: [hEscolas, hTurmas, hGraf],
      headerNivelByRow: (function () {
        const o = {};
        o[hEscolas] = { G: S.hdOk, H: S.hdMid, I: S.hdCrit, J: S.hdBad };
        o[hTurmas] = { H: S.hdOk, I: S.hdMid, J: S.hdCrit, K: S.hdBad };
        return o;
      })(),
      totals: [tEscolas, tTurmas].filter(Boolean),
      intCols: ["A", "C", "D", "E", "G", "H", "I", "J"],
      decCols: ["F"],
      dataRanges: [
        { start: d0, end: Math.max(d0, d1), intCols: ["A", "C", "D", "E", "G", "H", "I", "J"], decCols: ["F"] },
        { start: t0, end: Math.max(t0, t1), intCols: ["A", "D", "E", "F", "H", "I", "J", "K"], decCols: ["G"] },
        { start: g0, end: g1, intCols: ["E", "F"], decCols: ["B"], nivelCol: "D" },
      ],
    };
    return {
      ws: sheetFromAoA(aoa, {
        widths: [12, 28, 14, 16, 12, 14, 12, 14, 16, 12, 16],
        freezeRows: 4,
        mergeTitleCols: 11,
        numFmts: numFmts,
      }),
      plan: plan,
    };
  }

  function painelSheet(p, hoje) {
    const aoa = [
      ["SECRETARIA MUNICIPAL DE EDUCAÇÃO DE PACAJUS"],
      ["Painel institucional — 1º SAEP"],
      [recorteTexto(p)],
      ["Gerado em " + hoje],
      ["Os painéis abaixo são imagens institucionais geradas nesta página (não usam o gráfico padrão do Excel)."],
    ];
    return {
      ws: sheetFromAoA(aoa, { widths: [18, 18, 18, 18, 18, 18, 18, 18], mergeTitleCols: 8, rowHeights: { 0: 24, 1: 20 } }),
      plan: { title: [1], subtitle: [2], meta: [3, 4, 5] },
    };
  }

  function paraGraficosSheet(p) {
    const rank = p.ranking || [];
    const linhas = p.linhasPainel || p.linhasEscolas || [];
    const aoa = [
      ["Ranking"],
      ["Item", "Proficiencia"],
    ];
    rank.forEach((e) => aoa.push([xmlSafe(e.nome), num(e.mediaProf)]));
    aoa.push([]);
    aoa.push(["Niveis"]);
    aoa.push(["Nivel", p.rotuloFoco || "Foco", p.rotuloRef || "Referencia"]);
    NIVEIS.forEach((nv) => {
      aoa.push([nv, num((p.niveisFoco || {})[nv] || 0), num((p.niveisRef || {})[nv] || 0)]);
    });
    aoa.push([]);
    aoa.push(["Escolas ou turmas do recorte"]);
    aoa.push(["Nome", "Avaliados", "Media", "ADEQUADO", "INTERMEDIARIO", "CRITICO", "MUITO CRITICO"]);
    linhas.forEach((e) => {
      aoa.push([
        xmlSafe(e.nome),
        num(e.avaliados),
        num(e.mediaProf),
        ...niveisDe(e),
      ]);
    });
    const rankEnd = 2 + rank.length;
    const nivStart = rankEnd + 3;
    const nivEnd = nivStart + 3;
    const tabStart = nivEnd + 3;
    const tabEnd = tabStart + Math.max(0, linhas.length) - 1;
    const plan = {
      sections: [1, rankEnd + 2, nivEnd + 2],
      headers: [2, rankEnd + 3, nivEnd + 3],
      headerNivel: { D: S.hdOk, E: S.hdMid, F: S.hdCrit, G: S.hdBad },
      dataRanges: [
        { start: 3, end: Math.max(3, rankEnd), decCols: ["B"] },
        { start: nivStart, end: nivEnd, decCols: ["B", "C"], nivelCol: "A" },
        { start: tabStart, end: Math.max(tabStart, tabEnd), intCols: ["B", "D", "E", "F", "G"], decCols: ["C"] },
      ],
    };
    return {
      ws: sheetFromAoA(aoa, { widths: [28, 14, 12, 14, 16, 12, 16] }),
      plan: plan,
    };
  }

  function buildWorkbook(p) {
    const XLSX = xlsxLib();
    const src = p || {};
    const hoje = dataHoje();
    const capa = capaSheet(src, hoje);
    const alunos = alunosSheet(src, hoje);
    const resumo = resumoSheet(src, hoje);
    const painel = painelSheet(src, hoje);
    const graf = paraGraficosSheet(src);
    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: "1o SAEP Pacajus",
      Author: "SME Pacajus",
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(wb, capa.ws, "Capa");
    XLSX.utils.book_append_sheet(wb, alunos.ws, "Alunos");
    XLSX.utils.book_append_sheet(wb, resumo.ws, "Resumo");
    XLSX.utils.book_append_sheet(wb, painel.ws, "Painel");
    XLSX.utils.book_append_sheet(wb, graf.ws, "Para graficos");
    return {
      wb: wb,
      plans: {
        Capa: capa.plan,
        Alunos: alunos.plan,
        Resumo: resumo.plan,
        Painel: painel.plan,
        "Para graficos": graf.plan,
      },
    };
  }

  function buildXlsxBytes(p) {
    const XLSX = xlsxLib();
    const built = buildWorkbook(p);
    const out = XLSX.write(built.wb, {
      bookType: "xlsx",
      type: "array",
      cellDates: false,
      compression: false,
    });
    const raw = out instanceof Uint8Array ? out : new Uint8Array(out);
    let files = unzipStore(raw);
    files = sanitizeFiles(files);
    files = applySheetPlans(files, built.plans);
    const images = renderDashboardImages(p || {});
    files = embedSheetImages(files, "Painel", images);
    return zipStore(files);
  }

  function exportarExcelSaep(p) {
    const bytes = buildXlsxBytes(p || {});
    if (typeof document === "undefined") return bytes;
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = p && p.arquivo ? p.arquivo : "saep-pacajus.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return bytes;
  }

  global.exportarExcelSaep = exportarExcelSaep;
  global.buildXlsxBytes = buildXlsxBytes;
  if (typeof module !== "undefined") module.exports = { exportarExcelSaep, buildXlsxBytes };
})(typeof window !== "undefined" ? window : globalThis);
