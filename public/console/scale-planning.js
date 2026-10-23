(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrubzScalePlanning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "grubz_scale_planning_v1";
  const TAB_KEY = "grubz_scale_planning_tab";
  const DEFAULTS = {
    investment: 200000,
    eggsPerBatchG: 50,
    batchesPerMonth: 10,
    dryFeedPerGramEggsKg: 10,
    waterLitersPer25Kg: 50,
    theoreticalWetLarvaePerGramEggsKg: 3,
    hatchSuccess: 90,
    survivalToHarvest: 90,
    driedRecovery: 30,
    salesUtilization: 100,
    driedLarvaePricePerKg: 5,
    frassYieldPreparedFeed: 15,
    frassSalesUtilization: 100,
    frassSalePricePerKg: 2.5,
    frassHandlingCostPerKg: 0.08,
    feedstockCostPerKg: 0.25,
    containerCapex: 10000,
    containerOpexMonthly: 500,
    dryerCapex: 18000,
    dryerInstallation: 6000,
    dryerWetThroughputKgHour: 100,
    dryerHoursMonth: 100,
    sifterCapex: 2000,
    preparedFeedPerStaffHourKg: 150,
    productiveHoursPerFte: 100,
    minimumProductionFte: 1,
    monthlyCostPerAddedFte: 1500,
    fixedOverheadMonthly: 1000,
    operatingRunwayMonths: 3,
    workingCapitalMonths: 1,
    contingency: 10,
  };

  const GROUPS = [
    { title:"Biology & feed", icon:"biology-feed.png", iconClass:"bg-amber-50 ring-amber-100", fields:[
      ["eggsPerBatchG","Egg capacity per breeding unit","g / unit / batch"], ["batchesPerMonth","Batches per month","batches / month"],
      ["dryFeedPerGramEggsKg","Dry rice bran per gram eggs","dry kg / g eggs"], ["waterLitersPer25Kg","Water added per 25 kg dry feed","litres"],
      ["theoreticalWetLarvaePerGramEggsKg","Wet-larvae yield per gram eggs","kg / g eggs"], ["hatchSuccess","Hatch success","%"],
      ["survivalToHarvest","Survival to harvest","%"], ["driedRecovery","Dried recovery from wet larvae","%"],
    ]},
    { title:"Sales & co-products", icon:"sales-coproducts.png", iconClass:"bg-emerald-50 ring-emerald-100", fields:[
      ["salesUtilization","Dried-larvae sales utilization","%"],["driedLarvaePricePerKg","Dried larvae price","€ / kg"],
      ["frassYieldPreparedFeed","Frass yield from prepared feed","%"],["frassSalesUtilization","Frass sales utilization","%"],
      ["frassSalePricePerKg","Frass sale price","€ / kg"],["frassHandlingCostPerKg","Frass handling cost","€ / kg produced"],
      ["feedstockCostPerKg","Dry rice bran cost","€ / kg"],
    ]},
    { title:"Equipment & facilities", icon:"equipment-facilities.png", iconClass:"bg-cyan-50 ring-cyan-100", fields:[
      ["containerCapex","Breeding unit capex","€ / unit"],["containerOpexMonthly","Breeding unit operating cost","€ / month"],
      ["dryerCapex","Dryer equipment capex","€ / dryer"],["dryerInstallation","Dryer installation","€ / dryer"],
      ["dryerWetThroughputKgHour","Dryer wet throughput","kg / hour"],["dryerHoursMonth","Dryer operating hours","hours / month"],["sifterCapex","Shared sifter capex","€"],
    ]},
    { title:"Workforce & funding", icon:"workforce-funding.png", iconClass:"bg-violet-50 ring-violet-100", fields:[
      ["minimumProductionFte","Funded production FTE","minimum FTE"],["monthlyCostPerAddedFte","Cost per added FTE","€ / month"],
      ["productiveHoursPerFte","Productive hours per FTE","hours / month"],["preparedFeedPerStaffHourKg","Prepared feed handled","kg / staff-hour"],
      ["fixedOverheadMonthly","Fixed overhead","€ / month"],["operatingRunwayMonths","Operating runway funded","months"],
      ["workingCapitalMonths","Feed working capital","months"],["contingency","Deployment contingency","%"],
    ]},
  ];

  const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const positive = value => Math.max(0, n(value));
  const rate = value => Math.min(100, positive(value)) / 100;
  const ceil = value => Math.max(0, Math.ceil(value));

  function scenario(raw, setups) {
    const a = { ...DEFAULTS, ...raw };
    const containers = Math.max(0, Math.floor(setups));
    const totalEggsPerBatchG = containers * positive(a.eggsPerBatchG);
    const batchDryFeedKg = totalEggsPerBatchG * positive(a.dryFeedPerGramEggsKg);
    const dryFeedKg = batchDryFeedKg * positive(a.batchesPerMonth);
    const preparedFeedKg = dryFeedKg * (1 + positive(a.waterLitersPer25Kg) / 25);
    const wetLarvaeKg = totalEggsPerBatchG * positive(a.batchesPerMonth)
      * positive(a.theoreticalWetLarvaePerGramEggsKg) * rate(a.hatchSuccess) * rate(a.survivalToHarvest);
    const driedLarvaeKg = wetLarvaeKg * rate(a.driedRecovery) * rate(a.salesUtilization);
    const frassKg = preparedFeedKg * rate(a.frassYieldPreparedFeed);
    const frassSoldKg = frassKg * rate(a.frassSalesUtilization);
    const dryerMonthlyCapacityKg = positive(a.dryerWetThroughputKgHour) * positive(a.dryerHoursMonth);
    const dryers = containers ? Math.max(1, ceil(wetLarvaeKg / dryerMonthlyCapacityKg)) : 0;
    const feedPerFte = positive(a.preparedFeedPerStaffHourKg) * positive(a.productiveHoursPerFte);
    const fte = containers ? Math.max(1, ceil(a.minimumProductionFte), ceil(preparedFeedKg / feedPerFte)) : 0;
    const addedFte = Math.max(0, fte - 1);
    const equipmentCapex = containers * positive(a.containerCapex) + dryers * (positive(a.dryerCapex) + positive(a.dryerInstallation)) + (containers ? positive(a.sifterCapex) : 0);
    const payrollReserve = addedFte * positive(a.monthlyCostPerAddedFte) * positive(a.operatingRunwayMonths);
    const containerReserve = containers * positive(a.containerOpexMonthly) * positive(a.operatingRunwayMonths);
    const overheadReserve = containers ? positive(a.fixedOverheadMonthly) * positive(a.operatingRunwayMonths) : 0;
    const workingCapital = dryFeedKg * positive(a.feedstockCostPerKg) * positive(a.workingCapitalMonths);
    const subtotal = equipmentCapex + payrollReserve + containerReserve + overheadReserve + workingCapital;
    const contingencyAmount = subtotal * rate(a.contingency);
    const totalFunding = subtotal + contingencyAmount;
    const driedLarvaeRevenue = driedLarvaeKg * positive(a.driedLarvaePricePerKg);
    const frassRevenue = frassSoldKg * positive(a.frassSalePricePerKg);
    const revenue = driedLarvaeRevenue + frassRevenue;
    const feedCost = dryFeedKg * positive(a.feedstockCostPerKg);
    const frassHandlingCost = frassKg * positive(a.frassHandlingCostPerKg);
    const payroll = addedFte * positive(a.monthlyCostPerAddedFte);
    const containerOpex = containers * positive(a.containerOpexMonthly);
    const overhead = containers ? positive(a.fixedOverheadMonthly) : 0;
    const monthlyCosts = feedCost + frassHandlingCost + payroll + containerOpex + overhead;
    const ebitda = revenue - monthlyCosts;
    return { containers, totalEggsPerBatchG, batchDryFeedKg, dryFeedKg, preparedFeedKg, wetLarvaeKg, driedLarvaeKg, frassKg, frassSoldKg, dryerMonthlyCapacityKg, dryers, fte, addedFte, equipmentCapex, payrollReserve, containerReserve, overheadReserve, workingCapital, subtotal, contingencyAmount, totalFunding, driedLarvaeRevenue, frassRevenue, revenue, feedCost, frassHandlingCost, payroll, containerOpex, overhead, monthlyCosts, ebitda, paybackMonths:ebitda > 0 ? totalFunding / ebitda : null };
  }

  function calculate(raw = {}) {
    const assumptions = { ...DEFAULTS, ...raw };
    const budget = positive(assumptions.investment);
    let affordable = scenario(assumptions, 0);
    const ladder = [];
    for (let setups = 1; setups <= 100; setups += 1) {
      const item = scenario(assumptions, setups);
      if (setups <= 10) ladder.push(item);
      if (item.totalFunding <= budget) affordable = item;
      else break;
    }
    const next = scenario(assumptions, affordable.containers + 1);
    return { assumptions, budget, affordable, next, ladder, unallocated:Math.max(0, budget - affordable.totalFunding), gapToNext:Math.max(0, next.totalFunding - budget) };
  }

  function analyzeBottlenecks(result) {
    const { assumptions:a, affordable:s } = result;
    if (!s.containers) {
      return {
        primary:{
          name:"Available investment",
          utilization:100,
          headroom:0,
          detail:`€${Math.round(result.gapToNext).toLocaleString()} additional funding is required for the first breeding unit.`,
          action:{ key:"investment", value:result.next.totalFunding, label:`Set investment to €${Math.ceil(result.next.totalFunding).toLocaleString()}` },
        },
        resources:[],
        expansion:{
          name:"Available investment",
          constrained:true,
          detail:`The first breeding unit requires €${Math.round(result.gapToNext).toLocaleString()} more.`,
          resolutions:[
            `Add at least €${Math.ceil(result.gapToNext).toLocaleString()} to fund the first breeding unit.`,
            "Reduce capex, runway, working capital, or contingency only if the operational risk remains acceptable.",
          ],
          action:{ key:"investment", value:result.next.totalFunding, label:`Fund first breeding unit at €${Math.ceil(result.next.totalFunding).toLocaleString()}` },
        },
      };
    }
    const dryerCapacity = s.dryers * s.dryerMonthlyCapacityKg;
    const workforceCapacity = s.fte * positive(a.preparedFeedPerStaffHourKg) * positive(a.productiveHoursPerFte);
    const targetUtilization = 0.85;
    const dryerHoursAtTarget = s.dryers && positive(a.dryerWetThroughputKgHour)
      ? s.wetLarvaeKg / (s.dryers * positive(a.dryerWetThroughputKgHour) * targetUtilization) : 0;
    const feedRateAtTarget = s.fte && positive(a.productiveHoursPerFte)
      ? s.preparedFeedKg / (s.fte * positive(a.productiveHoursPerFte) * targetUtilization) : 0;
    const workforceHoursAtTarget = s.fte && positive(a.preparedFeedPerStaffHourKg)
      ? s.preparedFeedKg / (s.fte * positive(a.preparedFeedPerStaffHourKg) * targetUtilization) : 0;
    const resources = [
      {
        key:"dryer",
        name:"Dryer throughput",
        utilization:dryerCapacity > 0 ? s.wetLarvaeKg / dryerCapacity * 100 : 100,
        headroom:Math.max(0, dryerCapacity - s.wetLarvaeKg),
        headroomLabel:"wet larvae",
        detail:`${s.dryers} dryer${s.dryers === 1 ? "" : "s"} × ${positive(a.dryerWetThroughputKgHour).toLocaleString()} kg/hour × ${positive(a.dryerHoursMonth).toLocaleString()} hours/month`,
        why:`The dryer must process ${Math.round(s.wetLarvaeKg).toLocaleString()} kg of wet larvae against ${Math.round(dryerCapacity).toLocaleString()} kg of monthly wet-input capacity.`,
        resolutions:[
          `Run the existing dryer about ${Math.ceil(dryerHoursAtTarget).toLocaleString()} hours/month to restore 15% operating headroom.`,
          `Add one dryer to gain ${Math.round(s.dryerMonthlyCapacityKg).toLocaleString()} kg/month of wet-input capacity.`,
          "Increase hourly throughput through larger equipment, shorter loading cycles, or better moisture removal before drying.",
        ],
        action:{ key:"dryerHoursMonth", value:Math.ceil(dryerHoursAtTarget), label:`Set dryer time to ${Math.ceil(dryerHoursAtTarget).toLocaleString()} hours/month` },
      },
      {
        key:"workforce",
        name:"Feed-handling workforce",
        utilization:workforceCapacity > 0 ? s.preparedFeedKg / workforceCapacity * 100 : 100,
        headroom:Math.max(0, workforceCapacity - s.preparedFeedKg),
        headroomLabel:"prepared feed",
        detail:`${s.fte} FTE × ${positive(a.productiveHoursPerFte).toLocaleString()} hours × ${positive(a.preparedFeedPerStaffHourKg).toLocaleString()} kg/hour`,
        why:`The team must handle ${Math.round(s.preparedFeedKg).toLocaleString()} kg of prepared feed against ${Math.round(workforceCapacity).toLocaleString()} kg of monthly handling capacity.`,
        resolutions:[
          `Add one production FTE, providing about ${Math.round(positive(a.preparedFeedPerStaffHourKg) * positive(a.productiveHoursPerFte)).toLocaleString()} kg/month of additional handling capacity.`,
          `Raise handling productivity from ${positive(a.preparedFeedPerStaffHourKg).toLocaleString()} to about ${Math.ceil(feedRateAtTarget).toLocaleString()} kg/staff-hour to restore 15% headroom.`,
          `Increase productive time from ${positive(a.productiveHoursPerFte).toLocaleString()} to about ${Math.ceil(workforceHoursAtTarget).toLocaleString()} hours/FTE/month, or automate mixing, dosing, loading, and tray movement.`,
        ],
        action:{ key:"minimumProductionFte", value:s.fte + 1, label:"Add 1 production FTE" },
      },
    ].sort((left,right) => right.utilization - left.utilization);
    return {
      primary:resources[0],
      resources,
      expansion:{
        name:result.gapToNext > 0 ? "Available investment" : "No funding constraint",
        constrained:result.gapToNext > 0,
        detail:result.gapToNext > 0 ? `The next breeding unit requires €${Math.round(result.gapToNext).toLocaleString()} more.` : "The current investment can fund another breeding unit.",
        resolutions:result.gapToNext > 0 ? [
          `Add at least €${Math.ceil(result.gapToNext).toLocaleString()} to fund the next breeding unit under the current assumptions.`,
          "Reduce equipment capex, funded runway, working capital, or contingency only if the operational risk remains acceptable.",
          "Improve utilization or yield in the current setup before adding another breeding unit.",
        ] : ["No funding action is required for the next breeding unit."],
        action:result.gapToNext > 0 ? { key:"investment", value:result.next.totalFunding, label:`Fund next breeding unit at €${Math.ceil(result.next.totalFunding).toLocaleString()}` } : null,
      },
    };
  }

  function mount() {
    if (typeof document === "undefined") return;
    const form = document.getElementById("scaleAssumptionsForm");
    if (!form || form.dataset.ready) return;
    form.dataset.ready = "true";
    const money = new Intl.NumberFormat(undefined,{style:"currency",currency:"EUR",maximumFractionDigits:0});
    const number = new Intl.NumberFormat(undefined,{maximumFractionDigits:1});
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const fmtMoney = value => money.format(n(value));
    const fmtKg = value => `${number.format(n(value))} kg`;
    const read = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; } catch (_) { return { ...DEFAULTS }; } };
    let values = read();
    let saveTimer = null;
    let saveRevision = 0;

    const status = (message, ok = true) => {
      const element = document.getElementById("scalePlanningStatus");
      if (!element) return;
      element.className = `text-sm ${ok ? "text-zinc-500" : "text-red-700"}`;
      element.textContent = message;
    };
    const saveToFirebase = async () => {
      if (typeof window.grubzScalePlanningApi !== "function" || !window.grubzAdminReady) {
        status("Saved in this browser; waiting for Firebase connection.");
        return;
      }
      const revision = ++saveRevision;
      status("Saving to Firebase…");
      try {
        await window.grubzScalePlanningApi({ method:"PATCH", body:JSON.stringify({ scalePlanning:values }) });
        if (revision === saveRevision) status("Saved to Firebase.");
      } catch (error) {
        if (revision === saveRevision) status(`Saved in this browser, but Firebase sync failed: ${error.message || "Unknown error"}`, false);
      }
    };
    const scheduleFirebaseSave = () => {
      clearTimeout(saveTimer);
      status("Saving changes…");
      saveTimer = setTimeout(saveToFirebase, 650);
    };
    const loadFromFirebase = async () => {
      if (typeof window.grubzScalePlanningApi !== "function" || !window.grubzAdminReady) return;
      status("Loading assumptions from Firebase…");
      try {
        const data = await window.grubzScalePlanningApi();
        if (data.scalePlanning && typeof data.scalePlanning === "object") {
          values = { ...DEFAULTS, ...data.scalePlanning };
          syncInputs();
          render();
          status("Loaded from Firebase.");
        } else {
          await saveToFirebase();
        }
      } catch (error) {
        status(`Using assumptions saved in this browser; Firebase load failed: ${error.message || "Unknown error"}`, false);
      }
    };

    const card = (label,value,hint="") => `<div class="panel p-4"><div class="text-xs font-bold uppercase tracking-wide text-zinc-500">${escape(label)}</div><div class="mt-1 text-2xl font-extrabold">${escape(value)}</div>${hint ? `<div class="mt-1 text-xs text-zinc-500">${escape(hint)}</div>` : ""}</div>`;
    const line = (label,value,strong=false) => `<div class="flex items-center justify-between gap-4 px-4 py-2.5 ${strong ? "bg-zinc-50 font-extrabold" : ""}"><span>${escape(label)}</span><span class="tabular-nums text-right">${escape(value)}</span></div>`;
    const formulaLine = (label,formula,result) => `<div class="rounded-lg border border-zinc-200 p-3"><div class="font-bold">${escape(label)}</div><div class="mt-1 text-xs text-zinc-500">${escape(formula)}</div><div class="mt-1 text-lg font-extrabold">${escape(result)}</div></div>`;

    async function downloadScenarioPdf(setups) {
      const JsPdf = window.jspdf?.jsPDF;
      if (!JsPdf) throw new Error("PDF generator is not available. Refresh the page and try again.");
      const s = scenario(values, setups);
      const doc = new JsPdf({ unit:"mm", format:"a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const left = 16;
      const right = 16;
      const valueX = 128;
      const brand = { brown:[113,57,29], amber:[245,158,11], cream:[255,247,237], green:[5,150,105], ink:[39,39,42], muted:[113,113,122], line:[228,228,231] };
      let logo = null;
      try {
        const response = await fetch("/images/grubz-icon-80.png");
        if (response.ok) {
          const blob = await response.blob();
          logo = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      } catch (_) { /* The report remains usable if the logo cannot be loaded. */ }
      let y = 50;
      const continuationHeader = () => {
        doc.setFillColor(...brand.brown);
        doc.rect(0, 0, pageWidth, 12, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(255,255,255);
        doc.text("GRUBZ", left, 7.5);
        doc.setFont("helvetica", "normal");
        doc.text(`${setups} BREEDING UNIT${setups === 1 ? "" : "S"} · SCENARIO REPORT`, pageWidth - right, 7.5, { align:"right" });
        y = 20;
      };
      const ensureSpace = height => {
        if (y + height <= pageHeight - 20) return;
        doc.addPage();
        continuationHeader();
      };
      const section = title => {
        ensureSpace(14);
        y += 3;
        doc.setFillColor(...brand.cream);
        doc.rect(left, y - 5, pageWidth - left - right, 9, "F");
        doc.setFillColor(...brand.amber);
        doc.rect(left, y - 5, 2, 9, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...brand.brown);
        doc.text(title, left + 5, y + 1);
        y += 9;
      };
      let rowIndex = 0;
      const row = (label,value) => {
        ensureSpace(7);
        if (rowIndex++ % 2) {
          doc.setFillColor(250,250,250);
          doc.rect(left, y - 4, pageWidth - left - right, 6, "F");
        }
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...brand.muted);
        doc.text(String(label), left, y);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...brand.ink);
        const lines = doc.splitTextToSize(String(value), pageWidth - valueX - right);
        doc.text(lines, valueX, y, { align:"left" });
        y += Math.max(6, lines.length * 4.5);
      };
      doc.setFillColor(...brand.brown);
      doc.rect(0, 0, pageWidth, 40, "F");
      doc.setFillColor(...brand.amber);
      doc.rect(0, 40, pageWidth, 2, "F");
      if (logo) doc.addImage(logo, "PNG", left, 10, 20, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(255,255,255);
      doc.text("GRUBZ", logo ? left + 25 : left, 17);
      doc.setFontSize(13);
      doc.text("BREEDING-UNIT SCENARIO", logo ? left + 25 : left, 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(245,245,244);
      doc.text(`Scale-planning report · Generated ${new Date().toLocaleString()}`, logo ? left + 25 : left, 30);

      const kpis = [["BREEDING UNITS",String(setups)],["FUNDING REQUIRED",fmtMoney(s.totalFunding)],["MONTHLY EBITDA",fmtMoney(s.ebitda)],["EST. PAYBACK",s.paybackMonths == null ? "No payback" : `${number.format(s.paybackMonths)} months`]];
      const cardGap = 3;
      const cardWidth = (pageWidth - left - right - cardGap * 3) / 4;
      kpis.forEach(([label,value],index) => {
        const x = left + index * (cardWidth + cardGap);
        doc.setFillColor(255,255,255);
        doc.setDrawColor(...brand.line);
        doc.roundedRect(x, y, cardWidth, 20, 2, 2, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(...brand.muted);
        doc.text(label, x + 3, y + 6);
        doc.setFontSize(10);
        doc.setTextColor(...(index === 2 && s.ebitda >= 0 ? brand.green : brand.brown));
        doc.text(doc.splitTextToSize(value, cardWidth - 6), x + 3, y + 13);
      });
      y += 25;

      section("Scenario summary");
      row("Breeding units", setups);
      row("Required funding", fmtMoney(s.totalFunding));
      row("Available investment", fmtMoney(values.investment));
      row("Funding headroom", fmtMoney(Math.max(0, values.investment - s.totalFunding)));

      section("Production capacity per month");
      row("Eggs per batch", `${number.format(s.totalEggsPerBatchG)} g`);
      row("Batches", number.format(values.batchesPerMonth));
      row("Dry rice bran", fmtKg(s.dryFeedKg));
      row("Prepared feed", fmtKg(s.preparedFeedKg));
      row("Wet larvae", fmtKg(s.wetLarvaeKg));
      row("Dried larvae sold", fmtKg(s.driedLarvaeKg));
      row("Frass produced", fmtKg(s.frassKg));
      row("Frass sold", fmtKg(s.frassSoldKg));

      section("Equipment and workforce");
      row("Breeding units", s.containers);
      row("Dryers", `${s.dryers} · ${fmtKg(s.dryerMonthlyCapacityKg)} wet capacity per dryer/month`);
      row("Production FTE", s.fte);
      row("Added FTE funded", s.addedFte);

      section("Funding requirement");
      row("Equipment capex", fmtMoney(s.equipmentCapex));
      row("Added-FTE runway", fmtMoney(s.payrollReserve));
      row("Breeding-unit operating runway", fmtMoney(s.containerReserve));
      row("Fixed-overhead runway", fmtMoney(s.overheadReserve));
      row("Feed working capital", fmtMoney(s.workingCapital));
      row("Subtotal", fmtMoney(s.subtotal));
      row(`Contingency (${number.format(values.contingency)}%)`, fmtMoney(s.contingencyAmount));
      row("Total funding required", fmtMoney(s.totalFunding));

      section("Monthly operating result");
      row("Dried-larvae revenue", fmtMoney(s.driedLarvaeRevenue));
      row("Frass revenue", fmtMoney(s.frassRevenue));
      row("Total revenue", fmtMoney(s.revenue));
      row("Dry rice bran", `-${fmtMoney(s.feedCost)}`);
      row("Frass handling", `-${fmtMoney(s.frassHandlingCost)}`);
      row("Added payroll", `-${fmtMoney(s.payroll)}`);
      row("Breeding-unit operating cost", `-${fmtMoney(s.containerOpex)}`);
      row("Fixed overhead", `-${fmtMoney(s.overhead)}`);
      row("Total monthly cost", fmtMoney(s.monthlyCosts));
      row("Estimated EBITDA", fmtMoney(s.ebitda));
      row("Estimated payback", s.paybackMonths == null ? "No payback" : `${number.format(s.paybackMonths)} months`);

      section("Assumptions");
      GROUPS.forEach(group => group.fields.forEach(([key,label,unit]) => row(`${group.title} · ${label}`, `${number.format(values[key])} ${unit}`)));
      ensureSpace(15);
      y += 3;
      doc.setFillColor(...brand.cream);
      doc.rect(left, y - 4, pageWidth - left - right, 12, "F");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...brand.muted);
      doc.text(doc.splitTextToSize("Planning estimate based on the assumptions shown above. Validate prices, capacity, staffing, and operating conditions before committing capital.", pageWidth - left - right - 8), left + 4, y + 1);

      const pageCount = doc.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(...brand.line);
        doc.line(left, pageHeight - 13, pageWidth - right, pageHeight - 13);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...brand.muted);
        doc.text("GRUBZ · Scale Planning · Confidential planning estimate", left, pageHeight - 8);
        doc.text(`Page ${page} of ${pageCount}`, pageWidth - right, pageHeight - 8, { align:"right" });
      }
      doc.save(`grubz-${setups}-breeding-unit-scenario.pdf`);
    }

    const assumptionInput = (key,unit) => {
      const currency = /^€\s*(.*)$/.exec(unit);
      if (!currency) return `<div class="mt-1 flex"><input class="input" style="border-radius:0" name="${key}" type="number" min="0" step="any"><span class="inline-flex min-w-fit items-center border border-l-0 border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-500">${escape(unit)}</span></div>`;
      const qualifier = currency[1].trim();
      return `<div class="mt-1 flex"><span class="inline-flex items-center border border-r-0 border-zinc-300 bg-zinc-50 px-3 font-bold text-zinc-700">€</span><input class="input" style="border-radius:0" name="${key}" type="number" min="0" step="any">${qualifier ? `<span class="inline-flex min-w-fit items-center border border-l-0 border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-500">${escape(qualifier)}</span>` : ""}</div>`;
    };
    form.innerHTML = GROUPS.map(group => `<fieldset class="panel overflow-hidden"><legend class="sr-only">${escape(group.title)}</legend><div class="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3"><span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl p-1 ring-2 ${escape(group.iconClass)}"><img src="/images/console/scale-planning/${escape(group.icon)}" width="192" height="192" alt="" class="h-full w-full object-contain"></span><span class="font-extrabold">${escape(group.title)}</span></div><div class="grid gap-3 p-4 sm:grid-cols-2">${group.fields.map(([key,label,unit]) => `<label><span class="label">${escape(label)}</span>${assumptionInput(key,unit)}</label>`).join("")}</div></fieldset>`).join("");
    const investmentInput = document.getElementById("scaleInvestmentInput");
    const syncInputs = () => { investmentInput.value = values.investment; Object.entries(values).forEach(([key,value]) => { if (form.elements[key]) form.elements[key].value = value; }); };

    function render() {
      const r = calculate(values); const s = r.affordable; const bottlenecks = analyzeBottlenecks(r);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
      const banner = document.getElementById("scaleDecisionBanner");
      banner.className = `rounded-lg border p-4 ${s.containers ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`;
      banner.innerHTML = `<div class="font-extrabold">${s.containers ? `${s.containers} breeding unit${s.containers === 1 ? "" : "s"} affordable` : "Investment does not yet fund one breeding unit"}</div><p class="mt-1 text-sm">${s.containers ? `${fmtMoney(s.totalFunding)} allocated, including equipment, staffing runway, overhead, working capital, and contingency.` : `${fmtMoney(r.gapToNext)} more is required for the first breeding unit.`}</p>`;
      document.getElementById("scaleOverviewKpis").innerHTML = [card("Investment",fmtMoney(r.budget)),card("Allocated",fmtMoney(s.totalFunding)),card("Unallocated",fmtMoney(r.unallocated)),card("Gap to next breeding unit",fmtMoney(r.gapToNext))].join("");
      const primary = bottlenecks.primary;
      const primaryElement = document.getElementById("scalePrimaryBottleneck");
      primaryElement.className = "rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950";
      const actionButton = action => action ? `<button class="btn mt-3" type="button" data-scale-resolve="${escape(action.key)}" data-scale-value="${escape(action.value)}">${escape(action.label)}</button>` : "";
      primaryElement.innerHTML = `<div class="text-xs font-bold uppercase tracking-wide">Primary production bottleneck</div><div class="mt-1 text-xl font-extrabold">${escape(primary.name)}</div><p class="mt-1 text-sm">${escape(primary.why || primary.detail)}${bottlenecks.resources.length ? ` ${number.format(primary.utilization)}% is utilized, leaving ${fmtKg(primary.headroom)} of ${escape(primary.headroomLabel)} capacity.` : ""}</p>${primary.resolutions?.[0] ? `<p class="mt-2 text-sm font-bold">First resolution: ${escape(primary.resolutions[0])}</p>` : ""}${actionButton(primary.action)}`;
      document.getElementById("scaleConfiguration").innerHTML = [line("Breeding units",s.containers),line("Dryers",s.dryers),line("Total production FTE",s.fte),line("Added FTE funded",s.addedFte),line("Wet-larvae capacity",fmtKg(s.wetLarvaeKg),true),line("Dried-larvae output sold",fmtKg(s.driedLarvaeKg),true),line("Frass produced",fmtKg(s.frassKg),true)].join("");
      document.getElementById("scaleFinancialSummary").innerHTML = [line("Dried-larvae revenue",fmtMoney(s.driedLarvaeRevenue)),line("Frass revenue",fmtMoney(s.frassRevenue)),line("Total revenue",fmtMoney(s.revenue),true),line("Rice bran",`(${fmtMoney(s.feedCost)})`),line("Frass handling",`(${fmtMoney(s.frassHandlingCost)})`),line("Added payroll",`(${fmtMoney(s.payroll)})`),line("Breeding unit operating cost",`(${fmtMoney(s.containerOpex)})`),line("Fixed overhead",`(${fmtMoney(s.overhead)})`),line("Estimated EBITDA",fmtMoney(s.ebitda),true),line("Investment payback",s.paybackMonths == null ? "No payback" : `${number.format(s.paybackMonths)} months`,true)].join("");
      document.getElementById("scaleInvestmentKpis").innerHTML = [card("Breeding units",s.containers),card("Required funding",fmtMoney(s.totalFunding)),card("Equipment capex",fmtMoney(s.equipmentCapex)),card("Operating reserves",fmtMoney(s.payrollReserve+s.containerReserve+s.overheadReserve+s.workingCapital))].join("");
      const investmentRows = [["Breeding units + dryers + installation + sifter",`${s.containers} breeding units · ${s.dryers} dryers`,s.equipmentCapex],["Added-FTE runway",`${s.addedFte} FTE × ${values.operatingRunwayMonths} months`,s.payrollReserve],["Breeding unit operating runway",`${s.containers} × ${values.operatingRunwayMonths} months`,s.containerReserve],["Fixed-overhead runway",`${values.operatingRunwayMonths} months`,s.overheadReserve],["Feed working capital",`${values.workingCapitalMonths} months`,s.workingCapital],["Contingency",`${values.contingency}%`,s.contingencyAmount],["Total funding required","",s.totalFunding]];
      document.getElementById("scaleInvestmentTable").innerHTML = investmentRows.map((row,index)=>`<tr class="border-t ${index === investmentRows.length-1 ? "bg-zinc-50 font-extrabold" : ""}"><td class="p-3">${escape(row[0])}</td><td class="p-3 text-right text-zinc-500">${escape(row[1])}</td><td class="p-3 text-right tabular-nums">${escape(fmtMoney(row[2]))}</td></tr>`).join("");
      const affordableScenarios = r.ladder.filter(item => item.totalFunding <= r.budget);
      const bestAffordableEbitda = affordableScenarios.length ? Math.max(...affordableScenarios.map(item => item.ebitda)) : null;
      document.getElementById("scaleScenarioLadder").innerHTML = `<table class="w-full min-w-[880px] text-sm"><thead><tr class="bg-zinc-50"><th class="p-2 text-left">Breeding units</th><th class="p-2 text-right">Dryers</th><th class="p-2 text-right">FTE</th><th class="p-2 text-right">Wet larvae / month</th><th class="p-2 text-right">Frass / month</th><th class="p-2 text-right">Monthly EBITDA</th><th class="p-2 text-right">Funding required</th><th class="p-2 text-right">Status / action</th></tr></thead><tbody>${r.ladder.map(item=>{ const affordable=item.totalFunding<=r.budget; const best=affordable && item.ebitda===bestAffordableEbitda; const gap=Math.max(0,item.totalFunding-r.budget); return `<tr class="border-t ${best ? "bg-amber-50" : ""}"><td class="p-2">${item.containers}</td><td class="p-2 text-right">${item.dryers}</td><td class="p-2 text-right">${item.fte}</td><td class="p-2 text-right">${escape(fmtKg(item.wetLarvaeKg))}</td><td class="p-2 text-right">${escape(fmtKg(item.frassKg))}</td><td class="p-2 text-right font-extrabold tabular-nums ${item.ebitda >= 0 ? "text-emerald-700" : "text-red-700"}">${escape(fmtMoney(item.ebitda))}${best ? `<span class="ml-2 inline-flex bg-amber-200 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-amber-950">Best</span>` : ""}</td><td class="p-2 text-right">${escape(fmtMoney(item.totalFunding))}</td><td class="p-2 text-right">${affordable ? `<span class="inline-flex items-center justify-end gap-2"><span class="font-bold text-emerald-700">Affordable</span><button class="btn-soft whitespace-nowrap" type="button" data-scale-pdf="${item.containers}">Download PDF</button></span>` : `<button class="btn-soft whitespace-nowrap text-red-700" type="button" data-scale-resolve="investment" data-scale-value="${escape(item.totalFunding)}" title="Increase investment by ${escape(fmtMoney(gap))}">Fund ${item.containers} breeding unit${item.containers === 1 ? "" : "s"} (+${escape(fmtMoney(gap))})</button>`}</td></tr>`; }).join("")}</tbody></table>`;
      document.getElementById("scaleCapacityKpis").innerHTML = [card("Egg capacity / breeding unit",`${number.format(values.eggsPerBatchG)} g / batch`),card("Total eggs / batch",`${number.format(s.totalEggsPerBatchG)} g`),card("Dry rice bran / batch",fmtKg(s.batchDryFeedKg)),card("Prepared feed / month",fmtKg(s.preparedFeedKg)),card("Wet larvae / month",fmtKg(s.wetLarvaeKg)),card("Frass / month",fmtKg(s.frassKg))].join("");
      const resolutionItems = items => (Array.isArray(items) ? items : []).map(item=>`<li>${escape(item)}</li>`).join("");
      const bottleneckCard = (resource,index) => `<section class="p-4 ${index === 0 ? "bg-amber-50" : ""}"><div class="flex flex-wrap items-start justify-between gap-2"><div><div class="font-extrabold">${index === 0 ? "Primary: " : ""}${escape(resource.name)}</div><div class="mt-1 text-xs text-zinc-500">${escape(resource.detail)}</div></div><div class="font-extrabold tabular-nums">${number.format(resource.utilization)}% utilized</div></div><p class="mt-2">${escape(resource.why)}</p><p class="mt-1 text-zinc-600">Remaining headroom: <strong>${escape(fmtKg(resource.headroom))} ${escape(resource.headroomLabel)}</strong></p><div class="mt-3 font-bold">Ways to resolve it</div><ul class="mt-1 list-disc space-y-1 pl-5 text-zinc-700">${resolutionItems(resource.resolutions)}</ul>${actionButton(resource.action)}</section>`;
      const expansionCard = `<section class="p-4"><div class="font-extrabold">Expansion constraint: ${escape(bottlenecks.expansion.name)}</div><p class="mt-1">${escape(bottlenecks.expansion.detail)}</p><ul class="mt-2 list-disc space-y-1 pl-5 text-zinc-700">${resolutionItems(bottlenecks.expansion.resolutions)}</ul>${actionButton(bottlenecks.expansion.action)}</section>`;
      const commercialCard = `<section class="p-4"><div class="font-extrabold">Commercial constraints</div><p class="mt-1 text-zinc-600">Dried-larvae sales utilization is ${number.format(values.salesUtilization)}%; frass sales utilization is ${number.format(values.frassSalesUtilization)}%. These limit sold output and revenue, but do not limit physical production.</p></section>`;
      document.getElementById("scaleBottleneckAnalysis").innerHTML = bottlenecks.resources.length ? `${bottlenecks.resources.map(bottleneckCard).join("")}${expansionCard}${commercialCard}` : expansionCard;
      document.getElementById("scaleCapacityFormula").innerHTML = [formulaLine("Total eggs per batch",`${s.containers} breeding units × ${values.eggsPerBatchG} g/unit`,`${number.format(s.totalEggsPerBatchG)} g`),formulaLine("Dry feedstock per batch",`${number.format(s.totalEggsPerBatchG)} g total eggs × ${values.dryFeedPerGramEggsKg} kg/g`,fmtKg(s.batchDryFeedKg)),formulaLine("Prepared feed per month",`${values.batchesPerMonth} batches × ${number.format(s.batchDryFeedKg)} kg × water factor ${number.format(1+values.waterLitersPer25Kg/25)}`,fmtKg(s.preparedFeedKg)),formulaLine("Wet-larvae capacity",`${number.format(s.totalEggsPerBatchG)} g eggs × ${values.batchesPerMonth} batches × ${values.theoreticalWetLarvaePerGramEggsKg} kg/g × ${values.hatchSuccess}% × ${values.survivalToHarvest}%`,fmtKg(s.wetLarvaeKg)),formulaLine("Dried output sold",`${number.format(s.wetLarvaeKg)} kg wet × ${values.driedRecovery}% recovery × ${values.salesUtilization}% sold`,fmtKg(s.driedLarvaeKg)),formulaLine("Frass produced",`${number.format(s.preparedFeedKg)} kg prepared feed × ${values.frassYieldPreparedFeed}% yield`,fmtKg(s.frassKg)),formulaLine("Frass sold",`${number.format(s.frassKg)} kg frass × ${values.frassSalesUtilization}% sold`,fmtKg(s.frassSoldKg))].join("");
      document.getElementById("scaleWorkforceKpis").innerHTML = [card("Production FTE",s.fte),card("Added FTE",s.addedFte),card("Feed per FTE",fmtKg(values.preparedFeedPerStaffHourKg*values.productiveHoursPerFte)),card("Monthly recurring cost",fmtMoney(s.monthlyCosts))].join("");
      document.getElementById("scaleRecurringCosts").innerHTML = [line("Dry rice bran",fmtMoney(s.feedCost)),line("Frass handling",fmtMoney(s.frassHandlingCost)),line("Added payroll",fmtMoney(s.payroll)),line("Breeding unit operating cost",fmtMoney(s.containerOpex)),line("Fixed overhead",fmtMoney(s.overhead)),line("Total monthly cost",fmtMoney(s.monthlyCosts),true)].join("");
      document.getElementById("scaleStaffingFormula").innerHTML = formulaLine("Required production FTE",`${number.format(s.preparedFeedKg)} kg prepared feed ÷ (${values.preparedFeedPerStaffHourKg} kg/hour × ${values.productiveHoursPerFte} hours/FTE)`,`${s.fte} FTE`)+formulaLine("Added payroll",`max(0, ${s.fte} total − 1 existing) × ${fmtMoney(values.monthlyCostPerAddedFte)}`,`${fmtMoney(s.payroll)} / month`);
    }

    function showTab(name) {
      document.querySelectorAll("[data-scale-tab]").forEach(button => { const active=button.dataset.scaleTab===name; button.classList.toggle("btn",active); button.classList.toggle("btn-soft",!active); button.setAttribute("aria-selected",String(active)); });
      document.querySelectorAll("[data-scale-panel]").forEach(panel=>panel.classList.toggle("hidden",panel.dataset.scalePanel!==name));
      localStorage.setItem(TAB_KEY,name);
    }
    form.addEventListener("input", event => { if (!event.target.name) return; values[event.target.name]=n(event.target.value); render(); scheduleFirebaseSave(); });
    investmentInput.addEventListener("input",()=>{ values.investment=n(investmentInput.value); render(); scheduleFirebaseSave(); });
    document.querySelectorAll("[data-scale-tab]").forEach(button=>button.addEventListener("click",()=>showTab(button.dataset.scaleTab)));
    document.getElementById("scalePlanningSection")?.addEventListener("click", async event => {
      const pdfButton = event.target.closest("[data-scale-pdf]");
      if (pdfButton) {
        const originalLabel = pdfButton.textContent;
        pdfButton.disabled = true;
        pdfButton.textContent = "Preparing PDF…";
        try {
          await downloadScenarioPdf(Math.max(1, Math.floor(n(pdfButton.dataset.scalePdf))));
          status("Scenario PDF downloaded.");
        } catch (error) {
          status(error.message || "Scenario PDF could not be generated.", false);
        } finally {
          pdfButton.disabled = false;
          pdfButton.textContent = originalLabel;
        }
        return;
      }
      const button = event.target.closest("[data-scale-resolve]");
      if (!button) return;
      const key = button.dataset.scaleResolve;
      const value = n(button.dataset.scaleValue);
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key) || value < 0) return;
      values[key] = value;
      syncInputs();
      render();
      scheduleFirebaseSave();
    });
    document.getElementById("scalePlanningReset")?.addEventListener("click",()=>{ if(!confirm("Reset every scale-planning assumption to its default value?")) return; values={...DEFAULTS}; syncInputs(); render(); scheduleFirebaseSave(); });
    document.getElementById("scalePlanningExport")?.addEventListener("click",()=>{ const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),assumptions:values,results:calculate(values)},null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download="grubz-scale-plan.json"; link.click(); URL.revokeObjectURL(url); });
    syncInputs(); showTab(localStorage.getItem(TAB_KEY)||"overview"); render();
    status("Saved in this browser; waiting for Firebase connection.");
    if (window.grubzAdminReady) loadFromFirebase();
    else window.addEventListener("grubz:admin-ready", loadFromFirebase, { once:true });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mount);
    else mount();
  }
  return { DEFAULTS, GROUPS, scenario, calculate, analyzeBottlenecks, mount };
});
