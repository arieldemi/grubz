(function () {
  "use strict";
  const storageKey = "grubz_profit_calculator_v1";
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const pct = value => value == null ? "—" : `${number.format(value * 100)}%`;
  const eur = value => money.format(Number.isFinite(value) ? value : 0);
  const qty = value => value == null ? "—" : `${number.format(value)} kg`;
  const readStored = () => {
    try { return { ...GrubzProfitCalculator.DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; }
    catch (_) { return { ...GrubzProfitCalculator.DEFAULTS }; }
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));

  function mount() {
    const form = document.getElementById("profitCalculatorForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "true";

    function fill(values) {
      Object.entries(values).forEach(([key, value]) => {
        if (form.elements[key]) form.elements[key].value = value;
      });
    }
    function values() {
      return Object.fromEntries(Array.from(form.elements).filter(el => el.name).map(el => [el.name, Number(el.value)]));
    }
    function card(label, value, hint = "") {
      return `<div class="panel p-4"><div class="text-xs font-bold uppercase tracking-wide text-zinc-500">${escapeHtml(label)}</div><div class="mt-1 text-2xl font-extrabold">${escapeHtml(value)}</div>${hint ? `<div class="mt-1 text-xs text-zinc-500">${escapeHtml(hint)}</div>` : ""}</div>`;
    }
    function line(label, value, strong = false, negative = false) {
      return `<div class="flex items-center justify-between gap-4 px-4 py-2.5 ${strong ? "font-extrabold bg-zinc-50" : ""}"><span>${escapeHtml(label)}</span><span class="tabular-nums ${negative ? "text-red-700" : ""}">${escapeHtml(value)}</span></div>`;
    }
    function metric(label, value, hint = "") {
      return `<div class="rounded-lg border border-zinc-200 p-3"><div class="text-xs font-bold text-zinc-500">${escapeHtml(label)}</div><div class="mt-1 text-lg font-extrabold">${escapeHtml(value)}</div>${hint ? `<div class="text-xs text-zinc-500">${escapeHtml(hint)}</div>` : ""}</div>`;
    }
    function render() {
      const assumptions = values();
      localStorage.setItem(storageKey, JSON.stringify(assumptions));
      const r = GrubzProfitCalculator.calculate(assumptions);
      const banner = document.getElementById("profitDecisionBanner");
      const contributionWarning = r.contributionPerKg == null || r.contributionPerKg <= 0;
      banner.className = `rounded-lg border p-4 ${r.viable ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-red-200 bg-red-50 text-red-950"}`;
      banner.innerHTML = `<div class="font-extrabold">${r.viable ? "Profitable under these assumptions" : "Not profitable under these assumptions"}</div><p class="mt-1 text-sm">${contributionWarning ? "Each additional kilogram loses money before fixed costs. Raise price, improve yield, or reduce variable cost first." : r.viable ? `Estimated net profit is ${escapeHtml(eur(r.netProfit))} per operating period, with a ${escapeHtml(pct(r.netMargin))} net margin.` : `The model loses ${escapeHtml(eur(Math.abs(r.netProfit)))} per period. Break-even requires ${escapeHtml(qty(r.breakEvenKg))} sold.`}</p>`;

      document.getElementById("profitTotalFeedstockCost").textContent = eur(r.feedstockCost);
      document.getElementById("profitTotalFeedstockCostExplanation").textContent = `${number.format(r.processedFeedstockKg)} kg processed × ${eur(assumptions.feedstockCostPerKg)}/kg.`;

      document.getElementById("profitKpis").innerHTML = [
        card("Net profit", eur(r.netProfit), "after estimated tax"),
        card("Net margin", pct(r.netMargin), "net profit ÷ revenue"),
        card("Operating cash flow", eur(r.operatingCashFlow), "net profit + depreciation"),
        card("Sellable output", qty(r.sellableKg), `${qty(r.processedFeedstockKg)} feedstock processed`),
        card("Full cost / kg", r.costPerKg == null ? "—" : eur(r.costPerKg), "at current utilization"),
        card("Contribution / kg", r.contributionPerKg == null ? "—" : eur(r.contributionPerKg), "before fixed costs"),
      ].join("");

      document.getElementById("profitInvestorSnapshot").innerHTML = [
        metric("Dried larvae produced", qty(r.sellableKg), `${eur(r.larvaeCostPerKg)}/kg fully loaded cost`),
        metric("Frass produced", qty(r.frassKg), `${eur(r.frassCostPerKg)}/kg fully loaded cost`),
        metric("Gross revenue", eur(r.revenue), `${eur(r.productRevenue)} larvae + ${eur(r.frassRevenue)} frass`),
        metric("Gross profit", eur(r.grossProfit), `${pct(r.grossMargin)} gross margin`),
        metric("EBITDA", eur(r.ebitda), `${pct(r.ebitdaMargin)} EBITDA margin`),
        metric("Net profit", eur(r.netProfit), `${pct(r.netMargin)} net margin`),
      ].join("");
      document.getElementById("profitCostAllocationNote").textContent = `Joint production costs are allocated by relative sales value: ${pct(r.larvaeAllocationPercent)} to dried larvae and ${pct(r.frassAllocationPercent)} to frass. Larvae packaging/logistics and frass handling stay with their respective product. Interest, tax and sales fees are excluded from production cost per kg.`;

      document.getElementById("profitWaterfall").innerHTML = [
        line("Dried larvae revenue", eur(r.productRevenue)), line("Frass revenue", eur(r.frassRevenue)),
        line("Other by-product revenue", eur(r.otherByproductRevenue)),
        line("Total revenue", eur(r.revenue), true), line("Feedstock", `(${eur(r.feedstockCost)})`, false, true),
        line("Larvae conversion & fulfilment", `(${eur(r.conversionCosts)})`, false, true), line("Frass handling & packaging", `(${eur(r.frassHandlingCosts)})`, false, true), line("Sales & payment fees", `(${eur(r.salesFees)})`, false, true),
        line("Contribution", eur(r.contribution), true, r.contribution < 0), line("Fixed cash costs", `(${eur(r.fixedCosts)})`, false, true),
        line("EBITDA", eur(r.ebitda), true, r.ebitda < 0), line("Depreciation", `(${eur(r.depreciation)})`, false, true),
        line("Operating profit (EBIT)", eur(r.ebit), true, r.ebit < 0), line("Interest", `(${eur(r.interest)})`, false, true),
        line("Estimated tax", `(${eur(r.tax)})`, false, true), line("Net profit", eur(r.netProfit), true, r.netProfit < 0),
      ].join("");

      document.getElementById("profitBreakEven").innerHTML = [
        metric("Accounting break-even", qty(r.breakEvenKg), r.breakEvenRevenue == null ? "No break-even at this unit price" : `${eur(r.breakEvenRevenue)} product revenue`),
        metric("Cash break-even", qty(r.cashBreakEvenKg), "excludes depreciation"),
        metric("Capacity needed", pct(r.capacityNeededPercent), "to reach accounting break-even"),
        metric("Margin of safety", qty(r.marginOfSafetyKg), pct(r.marginOfSafetyPercent)),
        metric("ROI / period", pct(r.roi), "net profit ÷ initial investment"),
        metric("Payback", r.paybackPeriods == null ? "No payback" : `${number.format(r.paybackPeriods)} periods`, "investment ÷ operating cash flow"),
      ].join("");

      const priceChanges = [-0.2, -0.1, 0, 0.1, 0.2];
      const rows = GrubzProfitCalculator.sensitivity(assumptions, priceChanges);
      document.getElementById("profitSensitivity").innerHTML = `<table class="w-full text-sm"><thead><tr class="bg-zinc-50"><th class="p-2 text-left">Utilization</th>${priceChanges.map(change => `<th class="p-2 text-right">${change > 0 ? "+" : ""}${change * 100}% price</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr class="border-t"><th class="p-2 text-left">${number.format(row.utilizationPercent)}%</th>${row.results.map(cell => `<td class="p-2 text-right font-bold tabular-nums ${cell.netProfit < 0 ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50"}" title="Selling price ${escapeHtml(eur(cell.price))}/kg">${escapeHtml(eur(cell.netProfit))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }

    fill(readStored());
    form.addEventListener("input", render);
    document.getElementById("profitResetBtn")?.addEventListener("click", () => { fill(GrubzProfitCalculator.DEFAULTS); render(); });
    document.getElementById("profitPrintBtn")?.addEventListener("click", () => window.print());
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
