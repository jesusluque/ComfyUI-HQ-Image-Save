// ComfyUI-HQ-Image-Save (fork oveCom) — navegador de ficheros del SERVIDOR para los
// nodos por ruta (Load/Save EXR, etc.). Añade un botón "📁 Browse…" + opción de menú
// contextual que abre un modal para navegar carpetas del servidor (incl. rutas
// absolutas como /mnt/s3files/<proyecto>) y elegir un fichero EXR/imagen o una
// carpeta; rellena el widget `filepath` (o `filename_prefix`). Reutiliza la ruta
// /hqis/browse del __init__.py.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Nodos del pack y el widget de ruta que rellena el browser (preferimos filepath).
const NODE_WIDGET = {
  LoadEXR: "filepath", LoadEXRFrames: "filepath", SaveEXRFrames: "filepath",
  LoadLatentEXR: "filepath", LoadImageAndPrompt: "filepath",
  SaveImageAndPromptExact: "filepath", SaveImageAndPromptIncremental: "filepath",
  SaveEXR: "filename_prefix", SaveTiff: "filename_prefix", SaveLatentEXR: "filename_prefix",
};
const EXTS = "exr,png,jpg,jpeg,tif,tiff,webp,bmp,hdr,dpx,tga";
const BTN = "📁 Browse…";
// Nodos de SECUENCIA (patrón %0Nd). Al elegir un frame, el nº se convierte a
// padding printf con el MISMO ancho que los dígitos del frame — como Nuke resuelve
// `####` (p.ej. shot.0042.exr -> shot.%04d.exr; render.123.exr -> render.%03d.exr).
const SEQ_NODES = new Set(["LoadEXRFrames", "SaveEXRFrames"]);
function toSeqPattern(path) {
  return path.replace(/(\d+)(\.[^.\/]+)$/, (_m, num, ext) => "%0" + num.length + "d" + ext);
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Auto-detección de SECUENCIA: dado el fichero elegido y la lista de la carpeta,
// localiza los hermanos con el mismo prefijo/sufijo y nº variable → devuelve el
// patrón printf (padding = ancho de dígitos del frame, estilo Nuke) y el rango.
function detectSeq(filename, files) {
  const m = filename.match(/^(.*?)(\d+)(\.[^.]+)$/);
  if (!m) return null;
  const [, prefix, digits, ext] = m;
  const re = new RegExp("^" + escRe(prefix) + "(\\d+)" + escRe(ext) + "$");
  const nums = [];
  for (const f of files || []) { const mm = f.match(re); if (mm) nums.push(parseInt(mm[1], 10)); }
  if (nums.length < 2) return null;  // un solo frame → no es secuencia
  nums.sort((a, b) => a - b);
  return { pattern: prefix + "%0" + digits.length + "d" + ext,
           start: nums[0], end: nums[nums.length - 1], count: nums.length };
}

function dirname(p) {
  if (!p) return "/";
  p = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}
function joinPath(a, b) { return (a.replace(/\/?$/, "/") + b).replace(/\/{2,}/g, "/"); }

async function browse(path) {
  const q = new URLSearchParams({ path: path || "/", exts: EXTS });
  const r = await api.fetchApi("/hqis/browse?" + q.toString());
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

function el(tag, style) {
  if (typeof tag !== "string") { style = tag; tag = "div"; }
  const n = document.createElement(tag);
  Object.assign(n.style, style || {});
  return n;
}
function btn(text, onclick) {
  const b = el("button", { background: "#2a2a30", color: "#eee", border: "1px solid #444",
    borderRadius: "6px", padding: "6px 9px", cursor: "pointer", whiteSpace: "nowrap" });
  b.textContent = text; b.onclick = onclick; return b;
}

function openBrowser(startPath, onPick) {
  const ov = el("div", { position: "fixed", inset: "0", zIndex: "10010",
    background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = el("div", { width: "min(640px,92vw)", maxHeight: "78vh", display: "flex",
    flexDirection: "column", background: "#1b1b1f", color: "#eee", border: "1px solid #444",
    borderRadius: "10px", fontFamily: "system-ui", fontSize: "13px", overflow: "hidden",
    boxShadow: "0 10px 40px rgba(0,0,0,.5)" });
  const pathInput = el("input", { flex: "1", background: "#111", color: "#eee",
    border: "1px solid #444", borderRadius: "6px", padding: "6px" });
  pathInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nav(pathInput.value); });
  const head = el("div", { display: "flex", gap: "6px", alignItems: "center", padding: "10px", borderBottom: "1px solid #333" });
  head.append(btn("⬆", () => nav(dirname(cur))), pathInput, btn("Ir", () => nav(pathInput.value)),
    btn("📂 Usar carpeta", () => { onPick(cur, { isFile: false, dir: cur }); ov.remove(); }), btn("✕", () => ov.remove()));
  const list = el("div", { overflowY: "auto", padding: "6px 10px" });
  box.append(head, list); ov.append(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  document.body.append(ov);

  let cur = "/", curFiles = [];
  function row(icon, name, onclick) {
    const d = el("div", { display: "flex", gap: "8px", padding: "5px 6px", borderRadius: "6px", cursor: "pointer", alignItems: "center" });
    d.onmouseenter = () => (d.style.background = "#2a2a30");
    d.onmouseleave = () => (d.style.background = "");
    const i = el("span", {}); i.textContent = icon;
    const n = el("span", { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }); n.textContent = name;
    d.append(i, n); d.onclick = onclick; return d;
  }
  async function nav(path) {
    cur = (path || "/").replace(/\\/g, "/");
    pathInput.value = cur; list.textContent = "cargando…";
    let j;
    try { j = await browse(cur); } catch (e) { list.textContent = "❌ " + e.message; return; }
    if (j.error) { list.textContent = "❌ " + j.error; return; }
    curFiles = j.files || [];
    list.textContent = "";
    (j.dirs || []).forEach((d) => list.append(row("📁", d, () => nav(joinPath(cur, d)))));
    curFiles.forEach((f) => list.append(row("🖼", f, () => { onPick(joinPath(cur, f), { isFile: true, dir: cur, file: f, files: curFiles }); ov.remove(); })));
    if (!(j.dirs || []).length && !(j.files || []).length) list.append(row("·", "(sin carpetas ni imágenes)", () => {}));
  }
  nav(startPath || "/");
}

function setW(node, name, value) {
  const w = node.widgets?.find((x) => x.name === name);
  if (w) { w.value = value; try { w.callback?.(value); } catch (e) {} }
}
function attach(node, widgetName) {
  const w = node.widgets?.find((x) => x.name === widgetName);
  const isSeqNode = SEQ_NODES.has(node.comfyClass || node.type);
  const start = w && w.value && String(w.value).includes("/") ? dirname(w.value) : "/";
  openBrowser(start, (picked, info) => {
    let value = picked;
    if (info.isFile && isSeqNode) {
      // Auto-detecta la secuencia en la carpeta (hermanos con mismo prefijo/sufijo).
      const seq = detectSeq(info.file, info.files);
      if (seq) {
        value = joinPath(info.dir, seq.pattern);          // patrón %0Nd (Nuke)
        setW(node, "start_frame", seq.start);             // rango auto
        setW(node, "end_frame", seq.end);
      } else {
        value = toSeqPattern(picked);                     // un solo frame → aún patrón
      }
    }
    if (w) { w.value = value; try { w.callback?.(value); } catch (e) {} }
    node.setDirtyCanvas(true, true);
  });
}

app.registerExtension({
  name: "HQImageSave.ServerBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const widgetName = NODE_WIDGET[nodeData?.name];
    if (!widgetName) return;

    // Menú contextual (robusto).
    const getOpts = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      const r = getOpts ? getOpts.apply(this, arguments) : undefined;
      options.unshift({ content: "📁 Browse server…", callback: () => attach(this, widgetName) });
      return r;
    };

    // Botón en el nodo.
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      const self = this;
      if (!self.widgets?.some((w) => w.name === BTN)) {
        self.addWidget("button", BTN, null, () => attach(self, widgetName));
      }
      return r;
    };
  },
});
