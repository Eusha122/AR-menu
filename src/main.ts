import { dishList, fine, orderLink, poster, say, setButton, startBtn, startTitle, tableBtn, type DishEntry, type Manifest } from "./ui";

/*
 * Entry point. Deliberately tiny (no three.js): it renders the start screen immediately, then
 * downloads everything heavy in parallel while the guest reads it — the dish video, the coaster
 * tracking data, the AR code (./ar) and the tracking engine (mind-ar).
 */

/** /dish/truffle-pizza → "truffle-pizza" (falls back to ?dish= for local file testing) */
function readSlug(): string | null {
  const m = location.pathname.match(/\/dish\/([a-z0-9-]+)/i);
  return m ? m[1] : new URLSearchParams(location.search).get("dish");
}

/**
 * Fetches a file fully into memory and returns an object URL for it, reporting progress.
 * Doing this up front means that when the guest taps Start, the video and tracking data are
 * already on the phone: no stall, no half-loaded video on iOS, and mind-ar reads the target from
 * memory instead of downloading it a second time.
 */
async function preload(url: string, onProgress: (loaded: number, total: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't load ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type }));
}

async function main() {
  const manifest = (await fetch("/dishes.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as Manifest | null;

  if (!manifest) {
    say("Couldn't load the menu. Check your connection and try again.", true);
    return setButton("Reload", true, () => location.reload());
  }

  const slug = readSlug();
  if (!slug) return showDishList(manifest);

  const dish = manifest[slug];
  if (!dish) {
    startTitle.textContent = "Not on the AR menu yet";
    say("This dish isn't available in AR yet — here's what you can see on your table right now.");
    return showDishList(manifest, false);
  }
  showDish(dish);
}

/** Landing page (no dish in the link): every AR dish, each linking to its own page. */
function showDishList(manifest: Manifest, retitle = true) {
  if (retitle) {
    startTitle.textContent = "See it on your table";
    say("Pick a dish, or scan the QR code on the coaster at your table.");
  }
  poster.hidden = true;
  startBtn.hidden = true;
  dishList.hidden = false;
  dishList.replaceChildren(
    ...Object.entries(manifest).map(([slug, d]) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `/dish/${slug}`;
      if (d.poster) {
        const img = document.createElement("img");
        img.src = d.poster;
        img.alt = "";
        img.loading = "lazy";
        a.append(img);
      }
      a.append(d.label);
      li.append(a);
      return li;
    }),
  );
}

function showDish(dish: DishEntry) {
  document.title = `${dish.label} — BiteME AR`;
  startTitle.textContent = dish.label;
  orderLink.href = dish.order;
  orderLink.textContent = `Order ${dish.label}`;
  if (dish.poster) {
    poster.src = dish.poster;
    poster.alt = dish.label;
    poster.hidden = false;
  }

  const tableAR = dish.table ? canUseTableAR() : Promise.resolve(false);
  if (dish.table) void showTable(dish, tableAR);

  if (!navigator.mediaDevices?.getUserMedia) {
    if (dish.table) {
      startBtn.hidden = true; // the 3D view above still works on a computer
      say("Spin the dish with your finger or mouse. Open this page on your phone to put it on your table.");
      return;
    }
    say("This needs a phone camera. Open this page on your phone — scan the QR code on the coaster.", true);
    setButton("Camera not available", false);
    fine.hidden = true;
    return;
  }

  void tableAR.then((ok) => {
    if (!ok) return coasterFirst(dish);
    // Table AR is the main path here; the coaster is the alternative. Its tracker and media only
    // download if the guest actually picks it — no wasted mobile data for everyone else.
    say("See it on your real table at real size — or use the coaster.");
    startBtn.classList.add("secondary");
    setButton("Scan the coaster instead", true, () => {
      startBtn.classList.remove("secondary");
      loadCoaster(dish).then(([mediaUrl, targetUrl, { MindARThree }, ar]) => void ar.begin(dish, mediaUrl, targetUrl, MindARThree), coasterFailed);
    });
  });
}

/** The coaster as the main (or only) way in: start its downloads now, "Start camera" when ready. */
function coasterFirst(dish: DishEntry) {
  tableBtn.hidden = true;
  startBtn.classList.remove("secondary");
  say("Point your camera at the coaster on your table and watch this dish appear on it.");
  loadCoaster(dish).then(
    ([mediaUrl, targetUrl, { MindARThree }, ar]) =>
      setButton("Start camera", true, () => void ar.begin(dish, mediaUrl, targetUrl, MindARThree)),
    coasterFailed,
  );
}

/*
 * Can THIS phone place a dish on the real table? Asked of the phone itself, because
 * <model-viewer>'s own `canActivateAR` says yes on every Android in Chrome — it can't tell whether
 * the phone supports Google's AR (ARCore), and on one that doesn't the button opened a 3D view
 * with no camera, or did nothing. When in doubt the answer is no: the coaster works everywhere.
 */
const NO_TABLE_AR = "biteme-no-table-ar";
const FALLBACK_HASH = "#model-viewer-no-ar-fallback"; // where Android returns when its AR app can't run

async function canUseTableAR(): Promise<boolean> {
  if (location.hash === FALLBACK_HASH) return false; // just came back from a failed attempt
  try {
    if (localStorage.getItem(NO_TABLE_AR)) return false; // it already failed on this phone once
  } catch {
    /* storage blocked — just check again */
  }
  const ua = navigator.userAgent;
  // Instagram, Facebook, TikTok, Snapchat, LINE, WeChat… open links in their own built-in
  // browser, which blocks the hand-off to the phone's AR — the button would do nothing.
  if (/FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|MicroMessenger|musical_ly|TikTok|BytedanceWebview/i.test(ua)) return false;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // iPhone: Safari advertises Quick Look support on links (false in apps' built-in browsers)
  if (iOS) return document.createElement("a").relList.supports("ar");
  if (/Android/i.test(ua)) {
    // Android: Chrome and Samsung Internet only report immersive AR on ARCore-supported phones
    type XR = { isSessionSupported: (mode: string) => Promise<boolean> };
    const xr = (navigator as Navigator & { xr?: XR }).xr;
    if (!xr) return false;
    return xr.isSessionSupported("immersive-ar").catch(() => false);
  }
  return false; // computers
}

/** Table AR failed on this phone after all: remember it, hide the button, lead with the coaster. */
function tableARFailed(dish: DishEntry) {
  try {
    localStorage.setItem(NO_TABLE_AR, "1");
  } catch {
    /* storage blocked */
  }
  if (location.hash === FALLBACK_HASH) history.replaceState(null, "", location.pathname + location.search);
  tableBtn.hidden = true;
  // switch only if the guest hasn't already started the coaster (that click drops "secondary")
  if (startBtn.classList.contains("secondary")) coasterFirst(dish);
}

function coasterFailed(err: unknown) {
  console.error(err);
  say("Couldn't download this dish. Check your connection and try again.", true);
  setButton("Try again", true, () => location.reload());
}

/** Coaster AR's downloads, in parallel, with progress on the button. */
function loadCoaster(dish: DishEntry) {
  const sizes = new Map<string, [number, number]>();
  const progress = (key: string) => (loaded: number, total: number) => {
    sizes.set(key, [loaded, total]);
    let l = 0;
    let t = 0;
    for (const [a, b] of sizes.values()) {
      l += a;
      t += b || a;
    }
    if (t) setButton(`Loading… ${Math.min(99, Math.round((l / t) * 100))}%`, false);
  };
  setButton("Loading…", false);
  return Promise.all([
    preload(dish.model ?? dish.bowl?.texture ?? dish.stack?.texture ?? dish.disc ?? dish.sprite ?? dish.video!, progress("media")),
    preload(dish.target, progress("target")),
    import("../vendor/mind-ar/mindar-image-three.prod.js"),
    import("./ar"),
  ]);
}

/**
 * "View on your table": the phone's own AR (Android Scene Viewer / WebXR, iPhone Quick Look)
 * through Google's <model-viewer>, which finds the real table and places the dish at true size.
 * Its self-contained build (with its own, newer three.js — mind-ar needs the older one) is
 * vendored and only loaded for dishes that have a table model.
 *
 * The start screen's photo becomes a live 3D view of the dish you can spin; the table button
 * appears only on phones that can actually do AR (canUseTableAR).
 */
async function showTable(dish: DishEntry, tableAR: Promise<boolean>) {
  const table = dish.table!;
  // Back from a failed AR hand-off (Android returns here with this hash): never offer it again.
  if (location.hash === FALLBACK_HASH) tableARFailed(dish);
  addEventListener("hashchange", () => location.hash === FALLBACK_HASH && tableARFailed(dish));
  await import("../vendor/model-viewer/model-viewer.min.js");
  type ModelViewer = HTMLElement & { canActivateAR: boolean; activateAR: () => Promise<void> };
  const mv = document.createElement("model-viewer") as ModelViewer;
  const attrs: Record<string, string> = {
    src: table.model,
    alt: `${dish.label}, in 3D`,
    poster: dish.poster ?? "",
    ar: "",
    "ar-modes": "webxr scene-viewer quick-look",
    "ar-scale": "fixed", // true size — a 30 cm pizza is 30 cm on the table
    "camera-controls": "",
    "auto-rotate": "",
    "rotation-per-second": "18deg",
    "auto-rotate-delay": "0",
    "interaction-prompt": "none",
    // a burger looks best from the side, near its photo's own angle; flat dishes from higher up
    "camera-orbit": table.kind === "stack" ? "0deg 68deg auto" : "0deg 58deg auto",
    "shadow-intensity": "1",
    "shadow-softness": "0.9",
    "environment-image": "neutral",
    exposure: "1.05",
    "touch-action": "pan-y",
  };
  for (const [k, v] of Object.entries(attrs)) mv.setAttribute(k, v);
  mv.className = "dish-3d";
  // model-viewer's own little AR icon would duplicate our big "View on your table" button
  const noIcon = document.createElement("span");
  noIcon.slot = "ar-button";
  noIcon.hidden = true;
  mv.append(noIcon);
  poster.replaceWith(mv);

  // AR started but failed (e.g. the phone's AR session couldn't start): fall back to the coaster
  mv.addEventListener("ar-status", (e) => {
    if ((e as CustomEvent<{ status: string }>).detail.status === "failed") tableARFailed(dish);
  });

  mv.addEventListener("load", async () => {
    if (!mv.canActivateAR || !(await tableAR)) return;
    tableBtn.hidden = false;
    tableBtn.onclick = () => void mv.activateAR();
  });
}

main();
