"use client";

/**
 * Customer review slider — 18 real buyer photos with short quoted reviews
 * in a horizontally-scrolling rail. Auto-drifts left at ~24 px/sec on its
 * own, but users can also drag, swipe, or wheel-scroll horizontally to
 * browse manually. Auto-scroll pauses for 3 sec after any user input,
 * then resumes.
 *
 * Implementation notes:
 *  - Two copies of the REVIEWS list rendered in the track so the
 *    auto-scroll loop is seamless: when scrollLeft passes half the
 *    track width, we subtract half so the visual position is identical
 *    and we have room to keep advancing.
 *  - requestAnimationFrame keeps the auto-scroll silky vs setInterval(30)
 *    (which judders under load).
 *  - Native horizontal overflow scroll handles user input — no
 *    embla/swiper dependency needed. Momentum scrolling on iOS works
 *    out of the box.
 *  - prefers-reduced-motion stops the auto-scroll entirely (user can
 *    still drag/swipe).
 *  - Above-fold cards (first 3) get `priority` on next/image; the rest
 *    lazy-load via the default loading="lazy".
 */

import { useEffect, useRef } from "react";
import Image from "next/image";

type Review = {
  img: number;
  name: string;
  city: string;
  text: string;
};

const REVIEWS: readonly Review[] = [
  { img: 1, name: "Arjun K.", city: "Bangalore", text: "Hallway became his racetrack from day one." },
  { img: 2, name: "Rohan S.", city: "Pune", text: "Box is so neat, didn't even need wrapping paper." },
  { img: 3, name: "Vivaan M.", city: "Mumbai", text: "Tiny car, real weight — feels properly premium." },
  { img: 4, name: "Aryan T.", city: "Hyderabad", text: "USB-C charge in 30 min, runs longer than my phone." },
  { img: 5, name: "Aditya P.", city: "Bangalore", text: "Wheels actually slide on marble. Real drift, not toy drift." },
  { img: 6, name: "Ishaan R.", city: "Delhi NCR", text: "Decals are crisp, BMW grille is bang on." },
  { img: 7, name: "Karan N.", city: "Chennai", text: "COD pe trust kiya — paid cash, all clean." },
  { img: 8, name: "Yash V.", city: "Ahmedabad", text: "Son dropped it off the table. Not a single scratch." },
  { img: 9, name: "Krishna G.", city: "Bangalore", text: "Range covers my full ground floor. No signal drop." },
  { img: 10, name: "Devansh A.", city: "Indore", text: "Gave it as a birthday gift — packaging stole the show." },
  { img: 11, name: "Atharv B.", city: "Pune", text: "Friend saw it at my place, ordered one same evening." },
  { img: 12, name: "Kabir J.", city: "Mumbai", text: "Same charger as my laptop. Zero hassle." },
  { img: 13, name: "Veer D.", city: "Bangalore", text: "Bought two so my dad could race me. He won." },
  { img: 14, name: "Aarav L.", city: "Surat", text: "₹999 mein it feels like a 3k product. Genuinely." },
  { img: 15, name: "Reyansh H.", city: "Kolkata", text: "On vitrified tiles it slides like a real drift car." },
  { img: 16, name: "Daksh O.", city: "Bangalore", text: "Battery survives an entire after-school session." },
  { img: 17, name: "Vihaan W.", city: "Chennai", text: "Fits in my palm but performs like a full-size RC." },
  { img: 18, name: "Aniruddh F.", city: "Pune", text: "Ordered Monday, in my hands by Wednesday. Fast." },
];

const SCROLL_SPEED_PX_PER_FRAME = 0.4; // ~24 px/sec at 60fps
const RESUME_AFTER_USER_INTERACTION_MS = 3000;

/** `compact` (hub) shrinks the mobile cards/heading so the section stays
 *  short — desktop and the auto-scroll behaviour are identical. */
export default function CustomerReviewsSlider({ compact = false }: { compact?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let paused = false;
    let resumeAt = 0;
    let rafId = 0;
    let reducedMotion = false;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = mq.matches;
    const onMqChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    mq.addEventListener("change", onMqChange);

    const tick = (now: number) => {
      // Resume after the post-interaction quiet period.
      if (paused && resumeAt > 0 && now >= resumeAt) {
        paused = false;
        resumeAt = 0;
      }

      if (!reducedMotion && !paused) {
        track.scrollLeft += SCROLL_SPEED_PX_PER_FRAME;
        // Seamless loop: position N and N+halfWidth render identical
        // cards, so warping back by halfWidth keeps the visual flow.
        const half = track.scrollWidth / 2;
        if (half > 0 && track.scrollLeft >= half) {
          track.scrollLeft -= half;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const pauseTemporarily = () => {
      paused = true;
      resumeAt = performance.now() + RESUME_AFTER_USER_INTERACTION_MS;
    };
    const pauseIndefinitely = () => {
      paused = true;
      resumeAt = 0;
    };
    const resume = () => {
      paused = false;
      resumeAt = 0;
    };

    track.addEventListener("touchstart", pauseTemporarily, { passive: true });
    track.addEventListener("touchmove", pauseTemporarily, { passive: true });
    track.addEventListener("wheel", pauseTemporarily, { passive: true });
    track.addEventListener("mouseenter", pauseIndefinitely);
    track.addEventListener("mouseleave", resume);

    // Desktop click-and-drag horizontal scroll. Native overflow-x scroll
    // doesn't expose drag-to-scroll on a mouse - only via the scrollbar
    // (which we hide) or shift+wheel (which most users don't know). So we
    // wire mousedown/move/up to push scrollLeft proportional to drag
    // distance. Touch is already handled natively by the browser's momentum
    // scrolling - this only fires for mouse pointers.
    let isDragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      dragStartX = e.pageX;
      dragStartScroll = track.scrollLeft;
      track.style.cursor = "grabbing";
      // Prevent text/image selection from kicking in during the drag.
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      track.scrollLeft = dragStartScroll - (e.pageX - dragStartX);
    };
    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      track.style.cursor = "grab";
    };

    track.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    // If the mouse leaves the viewport while dragging, release.
    window.addEventListener("blur", endDrag);

    return () => {
      cancelAnimationFrame(rafId);
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, []);

  return (
    <section
      aria-labelledby="customer-reviews-title"
      className={`bg-brand-cream border-y border-brand-line ${compact ? "py-7" : "py-10"} sm:py-16`}
    >
      <header className={`text-center ${compact ? "mb-4" : "mb-6"} sm:mb-10 px-4`}>
        <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-brand-red">
          Real buyers · real cars
        </p>
        <h2
          id="customer-reviews-title"
          className={`font-display ${compact ? "text-xl" : "text-2xl"} sm:text-4xl font-bold text-brand-ink mt-2`}
        >
          What <span className="text-brand-red">buyers actually</span> say.
        </h2>
        <p className="hidden sm:block text-sm sm:text-base text-brand-ink-soft mt-2 max-w-xl mx-auto">
          Unedited photos. Honest one-liners. Drag to browse — or just let it auto-scroll.
        </p>
      </header>

      <div
        ref={trackRef}
        role="region"
        aria-label="Customer photo gallery — auto-scrolling, drag or swipe to browse"
        className="overflow-x-auto overflow-y-hidden no-scrollbar select-none cursor-grab"
      >
        <ul className="flex gap-3 sm:gap-4 px-4 w-max">
          {[...REVIEWS, ...REVIEWS].map((r, i) => (
            <ReviewCard key={i} review={r} compact={compact} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReviewCard({
  review,
  compact = false,
}: {
  review: Review;
  compact?: boolean;
}) {
  const padded = String(review.img).padStart(2, "0");
  return (
    <li className={`shrink-0 ${compact ? "w-[160px]" : "w-[220px]"} sm:w-[260px] relative rounded-2xl overflow-hidden bg-brand-ink`}>
      <div className="relative aspect-[3/4]">
        <Image
          src={`/reviews/review-${padded}.webp`}
          alt={`${review.name} from ${review.city} with their PRC drift car`}
          fill
          sizes={compact ? "(max-width: 640px) 160px, 260px" : "(max-width: 640px) 220px, 260px"}
          loading="lazy"
          className="object-cover"
        />
        {/* Quote overlay — gradient floor so text stays readable against
            any photo background. */}
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent ${compact ? "p-2.5 pt-9" : "p-3.5 pt-12"} sm:p-4 sm:pt-14`}>
          <p className={`text-white ${compact ? "text-[11px]" : "text-[13px]"} sm:text-sm font-medium leading-snug`}>
            &ldquo;{review.text}&rdquo;
          </p>
          <p className={`text-white/70 ${compact ? "text-[8px] mt-1" : "text-[10px] mt-2"} font-mono uppercase tracking-widest sm:mt-2 sm:text-[10px]`}>
            — {review.name} · {review.city}
          </p>
        </div>
      </div>
    </li>
  );
}
