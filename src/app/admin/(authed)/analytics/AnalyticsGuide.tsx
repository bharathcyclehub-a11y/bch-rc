const readings = [
  { title: "Daily: sales and checkout health", body: "Read active sales, orders, average order value, payment failures and blocked pincodes together. Compare equal periods and distinguish booked COD sales from collected cash.", href: "https://support.google.com/analytics/answer/13128171?hl=en", source: "Google: purchase journey report" },
  { title: "Weekly: content and buying friction", body: "Compare product views and cart interest by device and channel, then inspect recordings for rage clicks, dead clicks and confusing checkout fields. High interest with few purchases is a prompt to investigate, not proof of a pricing problem.", href: "https://clarity.microsoft.com/insights", source: "Microsoft: Clarity insights" },
  { title: "Monthly: acquisition and repeat buying", body: "Review campaign sales, coupons, returning visitors and repeat buyers. Add ad spend and product costs before using ROAS, acquisition cost or contribution margin to decide budgets." },
  { title: "Yearly: seasonality and customer value", body: "Compare the same calendar months year over year. Build first-purchase cohorts and 30/60/90/180-day repeat rates once enough history exists. Use net sales after returns and refunds for lifetime value." },
  { title: "Audience research: ask buyers directly", body: "Gender is unknown unless voluntarily supplied. An optional post-purchase survey can ask who the product is for, gift versus self-purchase, interests and optional gender including Prefer not to say. Show the sample size and response rate; never treat a name-based guess as a customer fact." },
];

export function AnalyticsGuide() {
  return <div className="grid gap-4 md:grid-cols-2">{readings.map((r) => <article key={r.title} className="rounded-2xl border border-brand-line bg-white p-4 sm:p-5">
    <h2 className="font-semibold text-brand-ink">{r.title}</h2><p className="mt-2 text-sm leading-relaxed text-brand-ink-soft">{r.body}</p>
    {r.href && <a href={r.href} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-brand-red underline underline-offset-4">{r.source}</a>}
  </article>)}</div>;
}
