import { openOrder, setupOrder } from "./order";
import { dishList, fine, orderAr, orderOpen, poster, say, setButton, startBtn, startTitle, tableBtn, type DishEntry, type Manifest } from "./ui";

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
  showDish(slug, dish);
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

function showDish(slug: string, dish: DishEntry) {
  document.title = `${dish.label} — BiteME AR`;
  startTitle.textContent = dish.label;
  // Order sheet (demo): from the start screen and from the button shown in AR
  setupOrder(slug, dish);
  orderAr.onclick = openOrder;
  orderOpen.onclick = openOrder;
  orderOpen.hidden = false;
  if (dish.poster) {
    poster.src = dish.poster;
    poster.alt = dish.label;
    poster.hidden = false;
  }

  if (dish.table) void showTable(dish);

  if (!navigator.mediaDevices?.getUserMedia) {
    if (dish.table) {
      startBtn.hidden = true;
      say("Open this page on your phone to put this dish on your table.");
      return;
    }
    say("This needs a phone camera. Open this page on your phone — scan the QR code on the coaster.", true);
    setButton("Camera not available", false);
    fine.hidden = true;
    return;
  }

  if (dish.table) {
    // Table AR is the main path here; the coaster is the alternative. Its tracker and media only
    // download if the guest actually picks it — no wasted mobile data for everyone else.
    say("See it on your real table at real size — or use the coaster.");
    startBtn.classList.add("secondary");
    setButton("Scan the coaster instead", true, () => {
      const assets = loadCoaster(dish);
      assets.then(([mediaUrl, targetUrl, { MindARThree }, ar]) => void ar.begin(dish, mediaUrl, targetUrl, MindARThree), coasterFailed);
    });
    return;
  }

  say("Point your camera at the coaster on your table and watch this dish appear on it.");
  loadCoaster(dish).then(
    ([mediaUrl, targetUrl, { MindARThree }, ar]) =>
      setButton("Start camera", true, () => void ar.begin(dish, mediaUrl, targetUrl, MindARThree)),
    coasterFailed,
  );
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
    preload(dish.model ?? dish.bowl?.texture ?? dish.disc ?? dish.sprite ?? dish.video!, progress("media")),
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
 * The start screen keeps showing the dish photo; the table button appears only on phones that
 * can actually do AR.
 */
async function showTable(dish: DishEntry) {
  const table = dish.table!;
  await import("../vendor/model-viewer/model-viewer.min.js");
  type ModelViewer = HTMLElement & {
    canActivateAR: boolean;
    activateAR: () => Promise<void>;
    dismissPoster: () => void;
    showPoster: () => void;
  };
  const mv = document.createElement("model-viewer") as ModelViewer;
  // The start screen shows the dish PHOTO, not a 3D view: the viewer keeps its poster (the photo)
  // up — reveal="manual" — and only reveals the 3D dish when AR starts, then puts the photo back.
  // It stays a normal, full-size element, so loading and the in-Chrome AR work exactly as before.
  const attrs: Record<string, string> = {
    src: table.model,
    alt: dish.label,
    poster: dish.poster ?? "",
    reveal: "manual",
    loading: "eager",
    ar: "",
    "ar-modes": "webxr scene-viewer quick-look",
    "ar-scale": "fixed", // true size — a 30 cm pizza is 30 cm on the table
    "interaction-prompt": "none",
    "camera-orbit": "0deg 58deg auto",
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

  let inAR = false;
  mv.addEventListener("ar-status", (e) => {
    const status = (e as CustomEvent<{ status: string }>).detail.status;
    if (status === "session-started") inAR = true;
    if (status === "not-presenting" || status === "failed") {
      inAR = false;
      mv.showPoster(); // back to the photo
    }
  });
  // back from Google's / Apple's AR app (they leave the page): photo again
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !inAR) mv.showPoster();
  });

  mv.addEventListener("load", () => {
    if (!mv.canActivateAR) return;
    tableBtn.hidden = false;
    tableBtn.onclick = () => {
      mv.dismissPoster();
      void mv.activateAR();
    };
  });
}

main();
