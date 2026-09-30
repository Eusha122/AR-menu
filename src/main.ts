import { dishList, fine, orderLink, poster, say, setButton, startBtn, startTitle, type DishEntry, type Manifest } from "./ui";

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

  if (!navigator.mediaDevices?.getUserMedia) {
    say("This needs a phone camera. Open this page on your phone — scan the QR code on the coaster.", true);
    setButton("Camera not available", false);
    fine.hidden = true;
    return;
  }

  say("Point your camera at the coaster on your table and watch this dish appear on it.");

  // Everything heavy starts downloading NOW, in parallel. Progress covers the two big files.
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
  const assets = Promise.all([
    preload(dish.model ?? dish.disc ?? dish.video!, progress("media")),
    preload(dish.target, progress("target")),
    import("../vendor/mind-ar/mindar-image-three.prod.js"),
    import("./ar"),
  ]);

  assets.then(
    ([mediaUrl, targetUrl, { MindARThree }, ar]) =>
      setButton("Start camera", true, () => void ar.begin(dish, mediaUrl, targetUrl, MindARThree)),
    (err) => {
      console.error(err);
      say("Couldn't download this dish. Check your connection and try again.", true);
      setButton("Try again", true, () => location.reload());
    },
  );
}

main();
