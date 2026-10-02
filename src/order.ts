import type { DishEntry } from "./ui";

/*
 * The Order sheet: pick a size, set the quantity, place the order, and — once you've ordered the
 * dish — rate it. DEMO ONLY: no payment, nothing is sent anywhere. Orders and reviews are kept in
 * this browser (localStorage), so a guest who ordered a dish on this phone can review it.
 * Plain DOM, no three.js, so it opens instantly on the start screen as well as in AR.
 */

type Size = { key: "S" | "M" | "L"; name: string; price: number };
type DemoOrder = { slug: string; size: Size["key"]; qty: number; total: number; code: string; at: number };
type Review = { slug: string; stars: number; text: string; size: Size["key"]; at: number };

const ORDERS = "biteme-ar-orders";
const REVIEWS = "biteme-ar-reviews";

const read = <T>(key: string): T[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked (private mode): the order/review just isn't remembered */
  }
};

const taka = (n: number) => `৳${n.toLocaleString("en-IN")}`;
const round10 = (n: number) => Math.round(n / 10) * 10;

/** Small / Medium / Large from the dish's base (medium) price. */
export function sizesFor(dish: DishEntry): Size[] {
  const m = dish.price ?? 0;
  return [
    { key: "S", name: "Small", price: round10(m * 0.8) },
    { key: "M", name: "Medium", price: m },
    { key: "L", name: "Large", price: round10(m * 1.25) },
  ];
}

const $ = <T extends Element>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

let current: { slug: string; dish: DishEntry } | null = null;
let size: Size["key"] = "M";
let qty = 1;
let stars = 0;
let lastFocus: Element | null = null;

const sheet = () => $<HTMLDivElement>("#order-sheet");

export function setupOrder(slug: string, dish: DishEntry) {
  current = { slug, dish };
  const s = sheet();
  $<HTMLImageElement>("#os-img", s).src = dish.poster ?? "";
  $<HTMLImageElement>("#os-img", s).hidden = !dish.poster;
  $<HTMLElement>("#os-name", s).textContent = dish.label;

  s.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-close]")) closeOrder();
    const sz = t.closest<HTMLElement>("[data-size]");
    if (sz) {
      size = sz.dataset.size as Size["key"];
      render();
    }
    if (t.closest("#os-minus")) {
      qty = Math.max(1, qty - 1);
      render();
    }
    if (t.closest("#os-plus")) {
      qty = Math.min(20, qty + 1);
      render();
    }
    const st = t.closest<HTMLElement>("[data-star]");
    if (st) {
      stars = Number(st.dataset.star);
      renderStars();
    }
  });
  $<HTMLButtonElement>("#os-place", s).addEventListener("click", place);
  $<HTMLButtonElement>("#os-again", s).addEventListener("click", () => {
    $<HTMLElement>("#os-done", s).hidden = true;
    $<HTMLElement>("#os-form", s).hidden = false;
  });
  $<HTMLFormElement>("#os-review", s).addEventListener("submit", (e) => {
    e.preventDefault();
    submitReview();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet().hidden) closeOrder();
  });
}

export function openOrder() {
  if (!current) return;
  lastFocus = document.activeElement;
  size = "M";
  qty = 1;
  stars = 0;
  const s = sheet();
  $<HTMLElement>("#os-done", s).hidden = true;
  $<HTMLElement>("#os-form", s).hidden = false;
  render();
  s.hidden = false;
  requestAnimationFrame(() => s.classList.add("open"));
  $<HTMLButtonElement>("#os-place", s).focus({ preventScroll: true });
}

export function closeOrder() {
  const s = sheet();
  s.classList.remove("open");
  setTimeout(() => (s.hidden = true), 280);
  (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
}

function render() {
  if (!current) return;
  const s = sheet();
  const sizes = sizesFor(current.dish);
  const chosen = sizes.find((x) => x.key === size)!;
  $<HTMLElement>("#os-sizes", s).replaceChildren(
    ...sizes.map((x) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.size = x.key;
      b.setAttribute("aria-pressed", String(x.key === size));
      b.innerHTML = `<b>${x.name}</b><span>${taka(x.price)}</span>`;
      return b;
    }),
  );
  $<HTMLElement>("#os-qty", s).textContent = String(qty);
  $<HTMLButtonElement>("#os-minus", s).disabled = qty <= 1;
  $<HTMLButtonElement>("#os-place", s).textContent = `Place order · ${taka(chosen.price * qty)}`;
  renderReviews();
}

function place() {
  if (!current) return;
  const chosen = sizesFor(current.dish).find((x) => x.key === size)!;
  const order: DemoOrder = {
    slug: current.slug,
    size,
    qty,
    total: chosen.price * qty,
    code: `BM-${Math.floor(1000 + Math.random() * 9000)}`,
    at: Date.now(),
  };
  write(ORDERS, [...read<DemoOrder>(ORDERS), order]);
  const s = sheet();
  $<HTMLElement>("#os-done-text", s).textContent =
    `${qty} × ${chosen.name} ${current.dish.label} — ${taka(order.total)}. Order ${order.code}.`;
  $<HTMLElement>("#os-form", s).hidden = true;
  $<HTMLElement>("#os-done", s).hidden = false;
  stars = 0;
  renderReviews();
}

const orderedHere = (slug: string) => read<DemoOrder>(ORDERS).filter((o) => o.slug === slug);

function renderReviews() {
  if (!current) return;
  const s = sheet();
  const all = read<Review>(REVIEWS).filter((r) => r.slug === current!.slug).sort((a, b) => b.at - a.at);
  const avg = all.length ? all.reduce((t, r) => t + r.stars, 0) / all.length : 0;
  $<HTMLElement>("#os-rating", s).textContent = all.length
    ? `★ ${avg.toFixed(1)} · ${all.length} review${all.length > 1 ? "s" : ""}`
    : "No reviews yet";

  // only guests who ordered this dish (on this phone) can review it — once per order
  const orders = orderedHere(current.slug);
  const canReview = orders.length > all.length;
  $<HTMLFormElement>("#os-review", s).hidden = !canReview;
  $<HTMLElement>("#os-locked", s).hidden = canReview || orders.length > 0;
  $<HTMLElement>("#os-thanks", s).hidden = canReview || orders.length === 0;
  renderStars();

  $<HTMLElement>("#os-list", s).replaceChildren(
    ...all.map((r) => {
      const li = document.createElement("li");
      const head = document.createElement("div");
      head.className = "os-rv-head";
      head.innerHTML = `<span class="os-rv-stars" aria-label="${r.stars} out of 5">${"★".repeat(r.stars)}<i>${"★".repeat(5 - r.stars)}</i></span>`;
      const meta = document.createElement("span");
      meta.className = "os-rv-meta";
      meta.textContent = `Verified order · ${({ S: "Small", M: "Medium", L: "Large" } as const)[r.size]} · ${new Date(r.at).toLocaleDateString([], { day: "numeric", month: "short" })}`;
      head.append(meta);
      li.append(head);
      if (r.text) {
        const p = document.createElement("p");
        p.textContent = r.text;
        li.append(p);
      }
      return li;
    }),
  );
}

function renderStars() {
  sheet()
    .querySelectorAll<HTMLButtonElement>("[data-star]")
    .forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.star) <= stars)));
  $<HTMLButtonElement>("#os-submit", sheet()).disabled = stars === 0;
}

function submitReview() {
  if (!current || stars === 0) return;
  const s = sheet();
  const box = $<HTMLTextAreaElement>("#os-text", s);
  const mine = orderedHere(current.slug);
  const last = mine[mine.length - 1];
  const review: Review = { slug: current.slug, stars, text: box.value.trim().slice(0, 400), size: last?.size ?? "M", at: Date.now() };
  write(REVIEWS, [...read<Review>(REVIEWS), review]);
  box.value = "";
  stars = 0;
  renderReviews();
}
