(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat(undefined, { style:"currency", currency:"EUR", maximumFractionDigits:2 });
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits:2 });
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  let periods = [];
  let entries = [];
  let aggregate = { totals:{}, assumptions:{} };
  let liveShopSales = null;
  let googleSheetsClientId = "";
  let nomaSummary = null;
  let nomaConnections = [];
  let nomaFeedstocks = [];
  let nomaExpenses = [];
  let grubzExpenses = [];
  let initialized = false;
  let periodLoadSequence = 0;
  const productionTabKey = "grubz_reports_tab_v1";
  const nomaConnectionKey = "grubz_noma_connection";
  const productEconomicsSheetKey = "grubz_product_economics_sheet_url";
  const nomaEnabled = () => window.grubzNomaEnabled === true;

  function showProductionTab(tab, persist = true) {
    const requested = ["reports", "data", "expenses", "noma", "calculator", "process"].includes(tab) ? tab : "reports";
    const active = requested === "noma" && !nomaEnabled() ? "reports" : requested;
    document.querySelectorAll("[data-production-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.productionPanel !== active));
    document.querySelectorAll("[data-production-tab]").forEach(button => {
      const selected = button.dataset.productionTab === active;
      button.classList.toggle("btn", selected);
      button.classList.toggle("btn-soft", !selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
    if (persist) localStorage.setItem(productionTabKey, active);
  }

  function syncNomaTabAvailability(enabled = nomaEnabled()) {
    const buttons = [$("nomaProductionTab")].filter(Boolean);
    buttons.forEach(button => {
      button.disabled = !enabled;
      button.setAttribute("aria-disabled", enabled ? "false" : "true");
      button.classList.toggle("cursor-not-allowed", !enabled);
      button.classList.toggle("opacity-50", !enabled);
    });
    const nomaPanelOpen = !document.querySelector('[data-production-panel="noma"]')?.classList.contains("hidden");
    if (!enabled && !$("profitCalculatorSection")?.classList.contains("hidden") && nomaPanelOpen) {
      showProductionTab("reports");
    }
  }

  function message(value, ok = true) {
    const el = $("profitDataMsg");
    if (!el) return;
    el.className = `px-4 pb-4 text-sm ${ok ? "text-emerald-700" : "text-red-700"}`;
    el.textContent = value;
  }
  function api(options = {}) {
    if (typeof window.grubzProfitDataApi !== "function") throw new Error("The server connection is not ready yet.");
    return window.grubzProfitDataApi(options);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function selectedPeriod() { return periods.find(period => period.id === $("profitPeriodSelect").value); }
  function selectedCalculatorPeriod() { return periods.find(period => period.id === $("profitCalculatorPeriodSelect")?.value); }
  function selectedReportPeriod() { return periods.find(period => period.id === $("reportPeriodSelect")?.value); }
  function summaryCard(label, value, warning = false) {
    return `<div class="rounded-lg border p-3 ${warning ? "border-amber-200 bg-amber-50" : "border-zinc-200"}"><div class="text-xs font-bold text-zinc-500">${esc(label)}</div><div class="mt-1 font-extrabold tabular-nums">${esc(value)}</div></div>`;
  }
  function renderNoma(summary = nomaSummary) {
    const status = $("nomaProductionStatus");
    const cards = $("nomaProductionSummary");
    const lots = $("nomaProductionLots");
    if (!status || !cards || !lots) return;
    if (!summary) return;
    const totals = summary.totals || {};
    cards.innerHTML = [
      summaryCard("Feedstock", `${number.format(totals.processedFeedstockKg || 0)} kg`),
      summaryCard("Sellable output", `${number.format(totals.sellableOutputKg || 0)} kg`),
      summaryCard("Production loss", `${number.format(totals.productionLossKg || 0)} kg`),
      summaryCard("Lots", number.format((summary.lots || []).length)),
    ].join("");
    const scope = summary.scope || {};
    status.textContent = `Connected · ${scope.tenantId}/${scope.farmId} · generated ${new Date(summary.generatedAt).toLocaleString()}`;
    $("nomaProductionCosts").innerHTML = [
      ["Feedstock", totals.feedstockCost], ["Packaging", totals.packagingCost],
      ["Direct labor", totals.directLaborCost], ["Utilities", totals.utilitiesCost],
      ["Other variable", totals.otherVariableCost],
    ].map(([label, value]) => summaryCard(label, money.format(value || 0))).join("");
    const local = aggregate.totals || {};
    const feedDiff = (totals.processedFeedstockKg || 0) - (local.processedFeedstockKg || 0);
    const outputDiff = (totals.sellableOutputKg || 0) - (local.outputKg || 0);
    $("nomaProductionReconciliation").innerHTML = `<div class="font-bold">GRUBZ reconciliation</div><div class="mt-1 text-zinc-600">Feedstock difference: ${esc(number.format(feedDiff))} kg · Output difference: ${esc(number.format(outputDiff))} kg</div>`;
    lots.innerHTML = (summary.lots || []).length ? summary.lots.map(lot => `<tr class="border-b border-zinc-100"><td class="p-2 font-bold">${esc(lot.lotId)}</td><td class="p-2">${esc(lot.batchId)}</td><td class="p-2">${esc(lot.stage || "—")}</td><td class="p-2">${esc(lot.status || "—")}</td><td class="p-2">${esc(number.format(lot.inputKg || 0))} kg</td><td class="p-2">${esc(number.format(lot.outputKg || 0))} kg</td><td class="p-2">r${esc(lot.revision)}</td><td class="p-2">${esc((lot.parents || []).map(parent => `${parent.lotId} (${number.format(parent.quantityKg || 0)} kg)`).join(", ") || "—")}</td><td class="p-2">${esc(new Date(lot.updatedAt).toLocaleString())}</td></tr>`).join("") : `<tr><td colspan="9" class="p-3 text-center text-zinc-500">No production lots in this period.</td></tr>`;
  }
  async function loadNomaConnections() {
    if (!nomaEnabled()) return;
    const data = await window.grubzNomaProductionApi({ method:"GET", query:"?action=connections" });
    nomaConnections = data.connections || [];
    const select = $("nomaProductionConnection");
    select.innerHTML = nomaConnections.length ? nomaConnections.map(item => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.tenantId)}/${esc(item.farmId)}</option>`).join("") : `<option value="">No connections configured</option>`;
    const preferred = localStorage.getItem(nomaConnectionKey);
    if (preferred && nomaConnections.some(item => item.id === preferred)) select.value = preferred;
    const expenseSelect = $("nomaExpensesConnection");
    if (expenseSelect) {
      expenseSelect.innerHTML = nomaConnections.length ? nomaConnections.map(item => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.tenantId)}/${esc(item.farmId)}</option>`).join("") : `<option value="">No connections configured</option>`;
      if (preferred && nomaConnections.some(item => item.id === preferred)) expenseSelect.value = preferred;
    }
    $("nomaConnectionDetails").innerHTML = nomaConnections.length ? nomaConnections.map(item => `<div class="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span><strong>${esc(item.label)}</strong> · ${esc(item.tenantId)}/${esc(item.farmId)}</span><span class="font-bold ${item.configured ? "text-emerald-700" : "text-amber-700"}">${item.configured ? "Credential configured" : "Credential missing"}</span></div>`).join("") : `<p>No NOMA connections are configured.</p>`;
    renderPeriodNomaConnections();
  }

  function expenseStatus(value, ok = true) {
    const status = $("nomaExpensesStatus");
    if (!status) return;
    status.className = `px-4 pb-4 text-sm ${ok ? "text-emerald-700" : "text-red-700"}`;
    status.textContent = value;
  }
  function grubzExpenseStatus(value, ok = true) {
    const status = $("grubzExpensesStatus");
    status.className = `px-4 pt-3 text-sm ${ok ? "text-emerald-700" : "text-red-700"}`;
    status.textContent = value;
  }
  function resetGrubzExpenseForm() {
    $("grubzExpenseForm").reset();
    $("grubzExpenseId").value = "";
    $("grubzExpenseDate").value = today();
    $("grubzExpenseCurrentInvoice").classList.add("hidden");
    $("grubzExpenseRemoveInvoiceLabel").classList.add("hidden");
  }
  function fileDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 8 * 1024 * 1024) return reject(new Error("Invoice must not exceed 8 MB."));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The invoice file could not be read."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }
  function downloadBase64File(invoice) {
    const bytes = Uint8Array.from(atob(invoice.dataBase64), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type:invoice.contentType || "application/octet-stream" }));
    const link = document.createElement("a"); link.href = url; link.download = invoice.fileName || "invoice"; link.click(); URL.revokeObjectURL(url);
  }
  function renderGrubzExpenses(payload = {}) {
    grubzExpenses = payload.expenses || [];
    $("grubzExpensesSummary").textContent = `${grubzExpenses.length} record${grubzExpenses.length === 1 ? "" : "s"} · ${money.format(payload.totals?.amount || 0)}`;
    $("grubzExpensesTable").innerHTML = grubzExpenses.length ? grubzExpenses.map(item => `<tr class="border-t border-zinc-100"><td class="p-3 whitespace-nowrap">${esc(item.date)}</td><td class="p-3"><div class="font-bold">${esc(item.category)}</div>${item.description ? `<div class="text-xs text-zinc-500">${esc(item.description)}</div>` : ""}</td><td class="p-3">${esc(item.vendor || "—")}${item.invoice ? `<button class="mt-1 block text-xs font-bold text-blue-700 underline" type="button" data-grubz-expense-invoice="${esc(item.id)}">${esc(item.invoice.fileName)}</button>` : ""}</td><td class="p-3 text-right font-bold">${esc(money.format(item.amount || 0))}</td><td class="p-3"><div class="flex justify-end gap-1"><button class="btn-soft px-2 py-1 text-xs" type="button" data-grubz-expense-edit="${esc(item.id)}">Edit</button><button class="btn-danger px-2 py-1 text-xs" type="button" data-grubz-expense-delete="${esc(item.id)}">Delete</button></div></td></tr>`).join("") : '<tr><td colspan="5" class="p-5 text-center text-zinc-500">No GRUBZ expenses in this period.</td></tr>';
  }
  async function loadGrubzExpenses(successMessage = "GRUBZ expenses loaded.") {
    try {
      const data = await window.grubzExpensesApi();
      renderGrubzExpenses(data);
      grubzExpenseStatus(successMessage);
    } catch (err) { grubzExpenseStatus(err.message || "GRUBZ expenses could not be loaded.", false); }
  }
  function renderExpenses(payload = {}) {
    nomaExpenses = payload.expenses || [];
    const total = nomaExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const currency = payload.totals?.currency || nomaExpenses[0]?.currency || "EUR";
    const formatter = new Intl.NumberFormat(undefined, { style:"currency", currency, maximumFractionDigits:2 });
    $("nomaExpensesSummary").innerHTML = [summaryCard("Expenses", number.format(nomaExpenses.length)), summaryCard("Total", formatter.format(payload.totals?.amount ?? total))].join("");
    $("nomaExpensesTable").innerHTML = nomaExpenses.length ? nomaExpenses.map(item => `<tr class="border-t border-zinc-100"><td class="p-3 whitespace-nowrap">${esc(item.date)}</td><td class="p-3"><div class="font-bold">${esc(item.category)}</div>${item.description ? `<div class="text-xs text-zinc-500">${esc(item.description)}</div>` : ""}</td><td class="p-3">${esc(item.vendor || "—")}${item.reference ? `<div class="text-xs text-zinc-500">${esc(item.reference)}</div>` : ""}${item.invoice ? `<button class="mt-1 text-xs font-bold text-blue-700 underline" type="button" data-expense-invoice="${esc(item.id)}">${esc(item.invoice.fileName || "View invoice")}</button>` : '<div class="mt-1 text-xs text-zinc-500">No invoice</div>'}</td><td class="p-3 text-right font-bold tabular-nums">${esc(new Intl.NumberFormat(undefined, { style:"currency", currency:item.currency || currency }).format(Number(item.amount || 0)))}</td></tr>`).join("") : '<tr><td colspan="4" class="p-6 text-center text-zinc-500">No NOMA expenses in this period.</td></tr>';
  }
  async function loadExpenses() {
    if (!nomaEnabled()) return;
    const connection = $("nomaExpensesConnection")?.value;
    if (!connection) { expenseStatus("Configure a NOMA connection first.", false); return; }
    expenseStatus("Loading expenses from NOMA Flow…");
    try {
      const query = new URLSearchParams({ action:"expenses", connection });
      if ($("nomaExpensesStart").value) query.set("startDate", $("nomaExpensesStart").value);
      if ($("nomaExpensesEnd").value) query.set("endDate", $("nomaExpensesEnd").value);
      const data = await window.grubzNomaProductionApi({ method:"GET", query:`?${query}` });
      renderExpenses(data.expenses || {});
      expenseStatus(`${nomaExpenses.length} expense${nomaExpenses.length === 1 ? "" : "s"} loaded from NOMA Flow.`);
    } catch (err) { expenseStatus(err.message || "NOMA expenses could not be loaded.", false); }
  }
  function renderPeriodNomaConnections(selectedId = $("profitPeriodNomaConnection")?.value || "") {
    const select = $("profitPeriodNomaConnection");
    if (!select) return;
    select.innerHTML = '<option value="">No NOMA feedstock</option>' + nomaConnections.map(item => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.tenantId)}/${esc(item.farmId)}</option>`).join("");
    if (nomaConnections.some(item => item.id === selectedId)) select.value = selectedId;
  }
  async function loadPeriodNomaFeedstocks(connectionId, selectedId = "") {
    const select = $("profitPeriodNomaFeedstock");
    const status = $("profitPeriodNomaStatus");
    nomaFeedstocks = [];
    if (!connectionId) {
      select.disabled = true;
      select.innerHTML = '<option value="">Choose a NOMA connection first</option>';
      status.textContent = "";
      return;
    }
    select.disabled = true;
    select.innerHTML = '<option value="">Loading feedstock…</option>';
    status.textContent = "Loading NOMA inventory…";
    try {
      const data = await window.grubzNomaProductionApi({ method:"GET", query:`?action=inventory&connection=${encodeURIComponent(connectionId)}` });
      nomaFeedstocks = (data.inventory?.items || []).filter(item => String(item.category || "").trim().toLowerCase() === "material");
      select.innerHTML = '<option value="">Choose feedstock</option>' + nomaFeedstocks.map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(number.format(item.stock || 0))} ${esc(item.unit || "")}${item.category ? ` · ${esc(item.category)}` : ""}</option>`).join("");
      if (nomaFeedstocks.some(item => item.id === selectedId)) select.value = selectedId;
      select.disabled = false;
      status.textContent = nomaFeedstocks.length ? `${nomaFeedstocks.length} feedstock material${nomaFeedstocks.length === 1 ? "" : "s"} available.` : "No feedstock materials are available from this connection.";
    } catch (err) {
      select.innerHTML = '<option value="">Could not load feedstock</option>';
      status.textContent = err.message || "NOMA inventory could not be loaded.";
    }
  }
  async function loadNoma(period = selectedPeriod()) {
    if (!nomaEnabled()) return;
    if (!period) {
      $("nomaProductionStatus").textContent = "Choose a measurement period to load production totals.";
      return;
    }
    const button = $("nomaProductionRefreshBtn");
    button.disabled = true;
    $("nomaProductionStatus").textContent = "Synchronizing with NOMA Flow…";
    try {
      const connection = period.nomaConnectionId || $("nomaProductionConnection").value;
      if (period.nomaConnectionId && nomaConnections.some(item => item.id === period.nomaConnectionId)) {
        $("nomaProductionConnection").value = period.nomaConnectionId;
      }
      const query = `?startDate=${encodeURIComponent(period.startDate)}&endDate=${encodeURIComponent(period.endDate)}&connection=${encodeURIComponent(connection)}`;
      const data = await window.grubzNomaProductionApi({ method:"GET", query });
      nomaSummary = data.summary;
      renderNoma();
    } catch (err) {
      $("nomaProductionStatus").textContent = err.message || "NOMA Flow could not be reached.";
      nomaSummary = null;
    } finally { button.disabled = false; }
  }
  function renderPeriods(selectedId = $("profitPeriodSelect")?.value || "") {
    const select = $("profitPeriodSelect");
    const calculatorSelect = $("profitCalculatorPeriodSelect");
    const reportSelect = $("reportPeriodSelect");
    const options = periods.length ? periods.map(period => `<option value="${esc(period.id)}">${esc(period.name)} · ${esc(period.status)}</option>`).join("") : '<option value="">Create a period first</option>';
    select.innerHTML = options;
    if (calculatorSelect) calculatorSelect.innerHTML = options;
    if (reportSelect) reportSelect.innerHTML = options;
    const resolvedId = periods.some(period => period.id === selectedId) ? selectedId : (periods[0]?.id || "");
    select.value = resolvedId;
    if (calculatorSelect) calculatorSelect.value = resolvedId;
    if (reportSelect) reportSelect.value = resolvedId;
    $("profitEditPeriodBtn").disabled = !select.value;
    $("profitDeletePeriodBtn").disabled = !select.value;
    if ($("profitCalculatorUseActualsBtn")) $("profitCalculatorUseActualsBtn").disabled = !resolvedId;
    renderReportPreview();
  }

  const reportMetricLabels = {
    processedFeedstockKg:"Feedstock processed (kg)", outputKg:"Sellable output (kg)", soldKg:"Product sold (kg)",
    frassKg:"Frass output (kg)", productRevenue:"Product revenue (€)", frassRevenue:"Frass revenue (€)",
    byproductRevenue:"Other by-product revenue (€)", salesFees:"Payment and sales fees (€)", feedstockCost:"Feedstock cost (€)",
    packaging:"Packaging (€)", frassHandling:"Frass handling (€)", labor:"Direct labor (€)", utilities:"Utilities (€)",
    logistics:"Logistics (€)", otherVariable:"Other variable costs (€)", fixed:"Fixed overhead (€)",
    depreciation:"Depreciation (€)", interest:"Interest (€)", investment:"Initial investment (€)",
  };
  function exportedTaxPercent() {
    const value = Number($("profitCalculatorForm")?.elements?.taxPercent?.value);
    if (Number.isFinite(value)) return Math.min(100, Math.max(0, value));
    return Number(window.GrubzProfitCalculator?.DEFAULTS?.taxPercent || 0);
  }
  function reportSummaryRows(period = selectedReportPeriod()) {
    const totals = aggregate.totals || {};
    return [
      ["GRUBZ operating report", period?.name || ""], ["Period", `${period?.startDate || ""} to ${period?.endDate || ""}`], ["Status", period?.status || ""],
      ["Estimated income tax rate (%)", exportedTaxPercent()],
      ["Metric", "Value"],
      ...Object.entries(reportMetricLabels).map(([key, label]) => [label, Number(totals[key] || 0)]),
    ];
  }
  function reportRecordRows() {
    const headers = ["Date", "Type", "Reference / category", "Description", "Feedstock kg", "Output kg", "Frass kg", "Loss kg", "Sold kg", "Product revenue €", "Frass revenue €", "Other revenue €", "Fees / cost €"];
    return [headers, ...entries.map(entry => [
      entry.date || "", entry.type || "", entry.batchId || entry.category || entry.source || "", entry.description || "",
      Number(entry.feedstockKg || entry.quantityKg || 0), Number(entry.outputKg || 0), Number(entry.frassKg || entry.frassSoldKg || 0), Number(entry.lossKg || 0),
      Number(entry.soldKg || 0), Number(entry.productRevenue || 0), Number(entry.frassRevenue || 0), Number(entry.byproductRevenue || 0), Number(entry.salesFees || entry.totalCost || entry.amount || 0),
    ])];
  }
  function reportProfitRows() {
    const taxPercent = exportedTaxPercent();
    const result = window.GrubzProfitCalculator?.calculate({ ...(aggregate.assumptions || {}), taxPercent }) || {};
    const rows = [
      ["Profitability metric", "Value"], ["Estimated income tax rate (%)", taxPercent], ["Estimated tax (€)", result.tax],
      ["Total revenue (€)", result.revenue], ["Gross profit (€)", result.grossProfit],
      ["EBITDA (€)", result.ebitda], ["Net profit (€)", result.netProfit], ["Net margin", result.netMargin],
      ["Operating cash flow (€)", result.operatingCashFlow], ["Full cost / kg (€)", result.costPerKg],
      ["Contribution / kg (€)", result.contributionPerKg], ["Accounting break-even (kg)", result.breakEvenKg],
      ["Cash break-even (kg)", result.cashBreakEvenKg], ["ROI per period", result.roi],
    ];
    return rows.map(row => [row[0], Number.isFinite(row[1]) ? row[1] : ""]);
  }
  function reportSheets() {
    const type = $("reportTypeSelect")?.value || "complete";
    const available = {
      summary:{ title:"Summary", rows:reportSummaryRows() },
      records:{ title:"Source records", rows:reportRecordRows() },
      profitability:{ title:"Profitability", rows:reportProfitRows() },
    };
    return type === "complete" ? [available.summary, available.records, available.profitability] : [available[type]];
  }
  function renderReportPreview() {
    const preview = $("reportPreview");
    if (!preview) return;
    const period = selectedReportPeriod();
    const hasPeriod = Boolean(period);
    $("createGoogleSheetReportBtn").disabled = !hasPeriod || !googleSheetsClientId;
    if ($("syncProductEconomicsSheetBtn")) $("syncProductEconomicsSheetBtn").disabled = !hasPeriod || !googleSheetsClientId || !(liveShopSales?.summary?.products || []).length;
    $("downloadReportCsvBtn").disabled = !hasPeriod;
    const status = $("reportBuilderMsg");
    if (status && !googleSheetsClientId) {
      status.className = "text-sm text-amber-700";
      status.textContent = "Google Sheets needs an OAuth client ID before first use. Configure GOOGLE_SHEETS_OAUTH_CLIENT_ID in Functions.";
    } else if (status?.classList.contains("text-amber-700")) status.textContent = "";
    $("reportPreviewPeriod").textContent = period ? `${period.name} · ${entries.length} records` : "Choose a period";
    if (!period) { preview.innerHTML = '<p class="p-6 text-center text-sm text-zinc-500">Choose a period to preview the report.</p>'; return; }
    if (!$("reportTitleInput").value) $("reportTitleInput").value = `GRUBZ ${period.name} report`;
    const sheet = reportSheets()[0];
    preview.innerHTML = `<table class="w-full text-sm"><thead><tr class="bg-zinc-50">${(sheet.rows[0] || []).map(value => `<th class="p-2 text-left">${esc(value)}</th>`).join("")}</tr></thead><tbody>${sheet.rows.slice(1, 13).map(row => `<tr class="border-t border-zinc-100">${row.map(value => `<td class="p-2">${esc(value ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>${sheet.rows.length > 13 ? `<p class="border-t p-2 text-center text-xs text-zinc-500">Previewing 12 of ${sheet.rows.length - 1} rows</p>` : ""}`;
  }
  function csvCell(value) { const text = String(value == null ? "" : value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  function downloadReportCsv() {
    const sheet = reportSheets()[0];
    const blob = new Blob(["\uFEFF" + sheet.rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type:"text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${($("reportTitleInput").value || "grubz-report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  function googleAccessToken() {
    return new Promise((resolve, reject) => {
      if (!googleSheetsClientId) return reject(new Error("Google Sheets is not configured. Set GOOGLE_SHEETS_OAUTH_CLIENT_ID for the Functions service and redeploy."));
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google sign-in is still loading. Try again in a moment."));
      const client = google.accounts.oauth2.initTokenClient({ client_id:googleSheetsClientId, scope:"https://www.googleapis.com/auth/spreadsheets", callback:response => response.error ? reject(new Error(response.error_description || response.error)) : resolve(response.access_token), error_callback:error => reject(new Error(error.message || "Google authorization was cancelled.")) });
      client.requestAccessToken({ prompt:"consent" });
    });
  }
  async function googleApi(url, token, options = {}) {
    const response = await fetch(url, { ...options, headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Google Sheets request failed (${response.status}).`);
    return data;
  }
  async function createGoogleSheetReport() {
    const token = await googleAccessToken();
    const sheets = reportSheets();
    const title = $("reportTitleInput").value.trim() || `GRUBZ ${selectedReportPeriod()?.name || "operating"} report`;
    const created = await googleApi("https://sheets.googleapis.com/v4/spreadsheets", token, { method:"POST", body:JSON.stringify({ properties:{ title }, sheets:sheets.map(sheet => ({ properties:{ title:sheet.title, gridProperties:{ frozenRowCount:1 } } })) }) });
    await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values:batchUpdate`, token, { method:"POST", body:JSON.stringify({ valueInputOption:"RAW", data:sheets.map(sheet => ({ range:`'${sheet.title.replace(/'/g, "''")}'!A1`, majorDimension:"ROWS", values:sheet.rows })) }) });
    const requests = (created.sheets || []).flatMap((createdSheet, index) => {
      const sheetId = createdSheet.properties.sheetId;
      const metricHeaderRow = sheets[index].rows.findIndex(row => row?.[0] === "Metric");
      const headerRows = sheets[index].title === "Summary" && metricHeaderRow >= 0 ? [0, metricHeaderRow] : [0];
      return [
        ...headerRows.map(row => ({ repeatCell:{ range:{ sheetId, startRowIndex:row, endRowIndex:row + 1 }, cell:{ userEnteredFormat:{ backgroundColor:{ red:0.96, green:0.94, blue:0.91 }, textFormat:{ bold:true, foregroundColor:{ red:0.27, green:0.14, blue:0.07 } } } }, fields:"userEnteredFormat(backgroundColor,textFormat)" } })),
        { autoResizeDimensions:{ dimensions:{ sheetId, dimension:"COLUMNS", startIndex:0, endIndex:Math.max(1, ...sheets[index].rows.map(row => row.length)) } } },
      ];
    });
    await googleApi(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}:batchUpdate`, token, { method:"POST", body:JSON.stringify({ requests }) });
    return created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`;
  }
  function spreadsheetIdFromUrl(value) {
    const match = String(value || "").trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(String(value || "").trim())) return String(value).trim();
    throw new Error("Enter a valid Google Sheets URL.");
  }
  function ensureProductEconomicsSyncUi() {
    if ($("productEconomicsSheetUrl")) return;
    const form = $("reportBuilderForm");
    if (!form) return;
    const section = document.createElement("div");
    section.className = "border-t border-zinc-200 pt-4";
    section.innerHTML = `<div class="font-bold">Connect Product Economics</div><p class="mt-1 text-xs text-zinc-500">Update an existing GRUBZ economics workbook with paid orders from the selected period.</p><label class="mt-3 block"><span class="label">Google Sheet URL</span><input id="productEconomicsSheetUrl" class="input mt-1" type="url" value="https://docs.google.com/spreadsheets/d/1Zpxsd-thoHQWnkpQ60LhqmX-KU5yuRuq1FGB718UVuk/edit" placeholder="https://docs.google.com/spreadsheets/d/…/edit"></label><button id="syncProductEconomicsSheetBtn" class="btn mt-3 w-full" type="button" disabled>Sync real e-shop sales</button><p id="productEconomicsSyncMsg" class="mt-2 text-sm" role="status" aria-live="polite"></p>`;
    form.appendChild(section);
  }
  function sheetName(value) { return `'${String(value).replace(/'/g, "''")}'`; }
  function formulaNumber(value) { return Number(value || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0"; }
  async function syncProductEconomicsSheet() {
    const period = selectedReportPeriod();
    const summary = liveShopSales?.summary;
    const products = summary?.products || [];
    if (!period || !products.length) throw new Error("The selected period has no paid product sales to sync.");
    const input = $("productEconomicsSheetUrl");
    const spreadsheetId = spreadsheetIdFromUrl(input.value);
    localStorage.setItem(productEconomicsSheetKey, input.value.trim());
    const token = await googleAccessToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
    let metadata = await googleApi(`${base}?includeGridData=false`, token);
    let productSheet = (metadata.sheets || []).find(sheet => sheet.properties?.title === "Product Economics");
    if (!productSheet) throw new Error('The workbook must contain a "Product Economics" tab.');
    let salesSheet = (metadata.sheets || []).find(sheet => sheet.properties?.title === "E-shop Sales");
    if (!salesSheet) {
      const added = await googleApi(`${base}:batchUpdate`, token, { method:"POST", body:JSON.stringify({ requests:[{ addSheet:{ properties:{ title:"E-shop Sales", gridProperties:{ frozenRowCount:4 } } } }] }) });
      salesSheet = added.replies?.[0]?.addSheet;
      metadata = await googleApi(`${base}?includeGridData=false`, token);
      productSheet = metadata.sheets.find(sheet => sheet.properties?.title === "Product Economics");
    }
    const [existing, existingAssumptions, existingUnitEconomics] = await Promise.all([
      googleApi(`${base}/values/${encodeURIComponent("'Product Economics'!A1:L80")}?valueRenderOption=FORMATTED_VALUE`, token),
      googleApi(`${base}/values/${encodeURIComponent("'Assumptions'!A1:D80")}?valueRenderOption=FORMATTED_VALUE`, token),
      googleApi(`${base}/values/${encodeURIComponent("'Unit Economics'!A1:B80")}?valueRenderOption=FORMULA`, token),
    ]);
    const rows = existing.values || [];
    const assumptionRows = existingAssumptions.values || [];
    const assumptionRow = (labels, excludedRows = []) => {
      const normalized = labels.map(label => label.toLowerCase());
      const index = assumptionRows.findIndex((row, rowIndex) => !excludedRows.includes(rowIndex + 1) && normalized.includes(String(row?.[0] || "").trim().toLowerCase()));
      return index >= 0 ? index + 1 : 0;
    };
    const labelledIncomeTaxRow = assumptionRow(["Income tax", "Estimated income tax rate"]);
    const unitTaxFormula = (existingUnitEconomics.values || []).find(row => String(row?.[0] || "").trim().toLowerCase() === "tax")?.[1] || "";
    const formulaTaxRow = Number(String(unitTaxFormula).match(/'?Assumptions'?\s*!\s*\$?B\$?(\d+)/i)?.[1] || 0);
    const incomeTaxRow = labelledIncomeTaxRow || formulaTaxRow;
    const ordersRow = assumptionRow(["Orders in exported period", "Orders per period", "Orders per month"], [incomeTaxRow]);
    if (!incomeTaxRow) throw new Error('Could not locate the "Income tax" assumption.');
    if (!ordersRow) throw new Error('Could not locate the orders assumption.');
    const summaryIndex = rows.findIndex(row => row?.[0] === "Blended order economics");
    if (summaryIndex < 6) throw new Error('Could not locate "Blended order economics" in Product Economics.');
    const productStartIndex = 4;
    const existingSlots = summaryIndex - 6;
    const extraRows = Math.max(0, products.length - existingSlots);
    if (extraRows) {
      await googleApi(`${base}:batchUpdate`, token, { method:"POST", body:JSON.stringify({ requests:[{ insertDimension:{ range:{ sheetId:productSheet.properties.sheetId, dimension:"ROWS", startIndex:summaryIndex - 2, endIndex:summaryIndex - 2 + extraRows }, inheritFromBefore:true } }] }) });
    }
    const currentSlots = existingSlots + extraRows;
    const currentSummaryRow = summaryIndex + 1 + extraRows;
    const productEndRow = 4 + currentSlots;
    const economics = summary.orderEconomics || {};
    const exportedPeriod = `${period.startDate} to ${period.endDate}`;
    const taxPercent = exportedTaxPercent();
    const productRows = products.map((product, index) => {
      const row = 5 + index;
      const larvae = formulaNumber(product.larvaeKgPerUnit);
      const frass = formulaNumber(product.frassKgPerUnit);
      return [
        product.name, product.unitWeightKg, product.averageGrossUnitPrice, product.averageNetUnitRevenue,
        `=IF(B${row}=0,0,D${row}/B${row})`,
        `=${larvae}*('Unit Economics'!$B$35-Assumptions!$B$18-Assumptions!$B$21)+${frass}*IF('Unit Economics'!$B$10=0,0,('Unit Economics'!$B$18+'Unit Economics'!$B$20+Assumptions!$B$24+Assumptions!$B$25)/'Unit Economics'!$B$10)`,
        `=${larvae}*(Assumptions!$B$18+Assumptions!$B$21)+${frass}*Assumptions!$B$16`,
        `=D${row}*Assumptions!$B$23`, `=D${row}-F${row}-G${row}-H${row}`, `=IF(D${row}=0,0,I${row}/D${row})`,
        product.unitsSold, `=IF(SUM($K$5:$K$${4 + products.length})=0,0,K${row}/SUM($K$5:$K$${4 + products.length}))`,
      ];
    });
    await googleApi(`${base}/values/${encodeURIComponent(`'Product Economics'!A5:L${productEndRow}`)}:clear`, token, { method:"POST", body:"{}" });
    const s = currentSummaryRow;
    const summaryWrites = [
      { range:`${sheetName("Product Economics")}!K4:L4`, values:[["Units sold","Sales mix"]] },
      { range:`${sheetName("Product Economics")}!A5:L${4 + products.length}`, values:productRows },
      { range:`${sheetName("Product Economics")}!A${s - 1}:C${s - 1}`, values:[["Exported period", exportedPeriod, period.name || ""]] },
      { range:`${sheetName("Assumptions")}!A${incomeTaxRow}:D${incomeTaxRow}`, values:[["Income tax", taxPercent / 100, "% of positive pre-tax profit", `Console calculator setting exported for ${period.name || exportedPeriod}`]] },
      { range:`${sheetName("Assumptions")}!A${ordersRow}:D${ordersRow}`, values:[["Orders in exported period", summary.orderCount, "orders", `Console export: ${period.name || exportedPeriod} (${exportedPeriod})`]] },
      { range:`${sheetName("Product Economics")}!B${s + 2}`, values:[[economics.averageGrossOrderValue]] },
      { range:`${sheetName("Product Economics")}!D${s + 2}:E${s + 2}`, values:[["Orders in exported period", summary.orderCount]] },
      { range:`${sheetName("Product Economics")}!B${s + 3}`, values:[[economics.averageNetOrderRevenue]] },
      { range:`${sheetName("Product Economics")}!E${s + 3}`, values:[[economics.netProductRevenue]] },
      { range:`${sheetName("Product Economics")}!B${s + 10}:B${s + 12}`, values:[
        [`=IF(E${s + 2}=0,0,SUMPRODUCT(F5:F${4 + products.length}+G5:G${4 + products.length},K5:K${4 + products.length})/E${s + 2})`],
        [`=B${s + 9}-B${s + 10}`], [`=IF(B${s + 3}=0,0,B${s + 11}/B${s + 3})`],
      ] },
      { range:`${sheetName("Product Economics")}!E${s + 6}:E${s + 9}`, values:[
        [`=B${s + 10}*E${s + 2}`], [`=B${s + 11}*E${s + 2}`],
        [`=B${s + 11}+B${s + 8}-Assumptions!B34`], [`=IF(B${s + 11}<=0,"No break-even",Assumptions!B24/B${s + 11})`],
      ] },
    ];
    const sourceRows = [
      ["GRUBZ live e-shop sales", period.name || ""], ["Period", `${period.startDate} to ${period.endDate}`],
      ["Included paid orders", summary.orderCount, "Excluded unpaid", summary.skippedOrderCount, "Refunded", summary.refundedOrderCount, "Estimated income tax rate", taxPercent, "%"],
      ["SKU","Product","Category","Units sold","Sold kg","Gross revenue","Discount","Net revenue ex VAT","Avg gross / unit","Avg net / unit","Larvae kg / unit","Frass kg / unit"],
      ...products.map(product => [product.sku,product.name,product.category,product.unitsSold,product.soldKg,product.grossRevenue,product.discount,product.netRevenueExVat,product.averageGrossUnitPrice,product.averageNetUnitRevenue,product.larvaeKgPerUnit,product.frassKgPerUnit]),
    ];
    await googleApi(`${base}/values/${encodeURIComponent("'E-shop Sales'!A1:L1000")}:clear`, token, { method:"POST", body:"{}" });
    await googleApi(`${base}/values:batchUpdate`, token, { method:"POST", body:JSON.stringify({ valueInputOption:"USER_ENTERED", data:[...summaryWrites,{ range:"'E-shop Sales'!A1", values:sourceRows }] }) });
    await googleApi(`${base}:batchUpdate`, token, { method:"POST", body:JSON.stringify({ requests:[
      { repeatCell:{ range:{ sheetId:salesSheet.properties.sheetId, startRowIndex:3, endRowIndex:4, startColumnIndex:0, endColumnIndex:12 }, cell:{ userEnteredFormat:{ backgroundColor:{ red:0.95, green:0.96, blue:0.96 }, textFormat:{ bold:true } } }, fields:"userEnteredFormat(backgroundColor,textFormat)" } },
      { autoResizeDimensions:{ dimensions:{ sheetId:salesSheet.properties.sheetId, dimension:"COLUMNS", startIndex:0, endIndex:12 } } },
      { addConditionalFormatRule:{ rule:{ ranges:[{ sheetId:productSheet.properties.sheetId, startRowIndex:4, endRowIndex:4 + products.length, startColumnIndex:8, endColumnIndex:10 }], booleanRule:{ condition:{ type:"NUMBER_LESS", values:[{ userEnteredValue:"0" }] }, format:{ backgroundColor:{ red:0.976, green:0.839, blue:0.839 }, textFormat:{ foregroundColor:{ red:0.6, green:0.106, blue:0.106 }, bold:true } } } }, index:0 } },
    ] }) });
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${productSheet.properties.sheetId}`;
  }
  function entryTitle(entry) {
    if (entry.type === "batch") return `Batch ${entry.batchId || "record"}: ${number.format(entry.feedstockKg)} kg → ${number.format(entry.outputKg)} kg larvae + ${number.format(entry.frassKg || 0)} kg frass`;
    if (entry.type === "feedstock") return `Feedstock: ${number.format(entry.quantityKg)} kg · ${money.format(entry.totalCost)}`;
    if (entry.type === "sale") return `Sales: ${number.format(entry.soldKg)} kg larvae · ${number.format(entry.frassSoldKg || 0)} kg frass · ${money.format((entry.productRevenue || 0) + (entry.frassRevenue || 0) + (entry.byproductRevenue || 0))}`;
    const labels = { packaging:"Larvae packaging", frassHandling:"Frass handling & packaging", labor:"Direct labor", utilities:"Utilities", logistics:"Logistics", otherVariable:"Other variable", fixed:"Fixed overhead", depreciation:"Depreciation", interest:"Interest", investment:"Initial investment" };
    return `${labels[entry.category] || "Cost"}: ${money.format(entry.amount)}`;
  }
  function renderData() {
    const period = selectedPeriod();
    const totals = aggregate.totals || {};
    $("profitEntryPeriodLabel").textContent = period ? period.name : "Choose a period";
    $("profitSaveEntryBtn").disabled = !period || period.status === "closed";
    $("profitUseActualsBtn").disabled = !period || !entries.length;
    $("profitEditPeriodBtn").disabled = !period;
    $("profitDeletePeriodBtn").disabled = !period;
    $("profitDataSummary").innerHTML = [
      summaryCard("Feedstock processed", `${number.format(totals.processedFeedstockKg || 0)} kg`, !(totals.processedFeedstockKg > 0)),
      summaryCard("Sellable output", `${number.format(totals.outputKg || 0)} kg`, !(totals.outputKg > 0)),
      summaryCard("Product sold", `${number.format(totals.soldKg || 0)} kg`, !(totals.soldKg > 0)),
      summaryCard("Frass output", `${number.format(totals.frassKg || 0)} kg`, !(totals.frassKg > 0)),
      summaryCard("Gross revenue", money.format((totals.productRevenue || 0) + (totals.frassRevenue || 0) + (totals.byproductRevenue || 0)), !(totals.productRevenue > 0)),
      summaryCard("NOMA feedstock", period?.nomaFeedstockName || "Not selected", !period?.nomaFeedstockId),
    ].join("");
    $("profitRecordCount").textContent = `${entries.length} record${entries.length === 1 ? "" : "s"}`;
    $("profitEntryList").innerHTML = entries.length ? entries.map(entry => `
      <article class="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-3">
        <div class="min-w-0"><div class="font-bold">${esc(entryTitle(entry))}${entry.virtual ? ' <span class="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">LIVE</span>' : ""}</div><div class="mt-1 text-xs text-zinc-500">${esc(entry.date)}${entry.description ? ` · ${esc(entry.description)}` : ""}</div></div>
        ${entry.virtual ? "" : `<button class="btn-danger shrink-0 px-2 py-1 text-xs" type="button" data-profit-delete-entry="${esc(entry.id)}" aria-label="Delete record">Delete</button>`}
      </article>`).join("") : '<p class="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">No records yet. Add the first source record above.</p>';
    const salesResult = $("profitEshopSyncResult");
    if (salesResult && liveShopSales?.summary) {
      const summary = liveShopSales.summary;
      salesResult.textContent = `Automatically loaded ${number.format(summary.orderCount || 0)} current order(s): ${number.format(summary.soldKg || 0)} kg dried larvae / ${money.format(summary.productRevenue || 0)}, and ${number.format(summary.frassSoldKg || 0)} kg frass / ${money.format(summary.frassRevenue || 0)}. ${number.format(summary.skippedOrderCount || 0)} unpaid order(s) excluded.`;
    }
    renderReportPreview();
  }
  async function loadPeriod(periodId) {
    const loadSequence = ++periodLoadSequence;
    try {
      message(periodId ? "Loading period records…" : "Loading operating periods…");
      const query = periodId ? `?periodId=${encodeURIComponent(periodId)}` : "";
      const data = await api({ method:"GET", query });
      if (loadSequence !== periodLoadSequence) return;
      googleSheetsClientId = data.integrations?.googleSheets?.clientId || googleSheetsClientId;
      liveShopSales = data.shopSales || null;
      periods = data.periods || periods;
      if (!periodId && periods.length) return loadPeriod(periods[0].id);
      entries = data.entries || [];
      aggregate = data.aggregate || { totals:{}, assumptions:{} };
      renderPeriods(periodId);
      renderData();
      if (nomaEnabled()) await loadNoma(selectedPeriod());
      message("Operating data is synced.");
    } catch (err) { message(err.message || "Period records could not be loaded.", false); }
  }
  function showEntryFields() {
    const type = $("profitEntryType").value;
    document.querySelectorAll("[data-profit-entry-fields]").forEach(group => group.classList.toggle("hidden", group.dataset.profitEntryFields !== type));
  }
  async function showPeriodForm(period = null) {
    $("profitPeriodForm").classList.remove("hidden");
    $("profitPeriodId").value = period?.id || "";
    $("profitPeriodName").value = period?.name || "";
    $("profitPeriodStart").value = period?.startDate || today().slice(0, 8) + "01";
    $("profitPeriodEnd").value = period?.endDate || today();
    $("profitPeriodStatus").value = period?.status || "open";
    $("profitPeriodNotes").value = period?.notes || "";
    $("profitPeriodNomaFields").classList.toggle("hidden", !nomaEnabled());
    if (nomaEnabled()) {
      if (!nomaConnections.length) await loadNomaConnections();
      renderPeriodNomaConnections(period?.nomaConnectionId || "");
      await loadPeriodNomaFeedstocks(period?.nomaConnectionId || "", period?.nomaFeedstockId || "");
    }
    $("profitPeriodName").focus();
  }
  function entryPayload() {
    const type = $("profitEntryType").value;
    const base = { type, date:$("profitEntryDate").value, description:$("profitEntryDescription").value };
    if (type === "batch") return { ...base, batchId:$("profitBatchId").value, feedstockKg:$("profitBatchFeedstockKg").value, outputKg:$("profitBatchOutputKg").value, frassKg:$("profitBatchFrassKg").value, lossKg:$("profitBatchLossKg").value };
    if (type === "feedstock") return { ...base, quantityKg:$("profitFeedstockQuantityKg").value, totalCost:$("profitFeedstockTotalCost").value };
    if (type === "sale") return { ...base, soldKg:$("profitSaleSoldKg").value, productRevenue:$("profitSaleRevenue").value, frassSoldKg:$("profitSaleFrassKg").value, frassRevenue:$("profitSaleFrassRevenue").value, byproductRevenue:$("profitSaleByproduct").value, salesFees:$("profitSaleFees").value };
    return { ...base, category:$("profitCostCategory").value, amount:$("profitCostAmount").value };
  }
  function init() {
    ensureProductEconomicsSyncUi();
    if ($("productEconomicsSheetUrl")) $("productEconomicsSheetUrl").value = localStorage.getItem(productEconomicsSheetKey) || $("productEconomicsSheetUrl").value;
    if (initialized || !$("profitDataAppTitle")) return;
    initialized = true;
    $("profitEntryDate").value = today();
    showEntryFields();
    document.querySelectorAll("[data-production-tab]").forEach(button => button.addEventListener("click", () => showProductionTab(button.dataset.productionTab)));
    showProductionTab(localStorage.getItem(productionTabKey) || "reports", false);
    syncNomaTabAvailability();
    const monthStart = today().slice(0, 8) + "01";
    $("nomaExpensesStart").value = monthStart;
    $("nomaExpensesEnd").value = today();
    resetGrubzExpenseForm();
    $("nomaProductionRefreshBtn").addEventListener("click", () => loadNoma());
    $("nomaProductionConnection").addEventListener("change", () => {
      localStorage.setItem(nomaConnectionKey, $("nomaProductionConnection").value);
      loadNoma();
    });
    // Authentication restoration is asynchronous. Loading before the console's
    // admin-ready event leaves a stale "Please sign in again" message behind.
    if (window.grubzAdminReady === true) loadGrubzExpenses();
    window.addEventListener("grubz:admin-ready", () => loadGrubzExpenses());
    if (nomaEnabled()) loadNomaConnections().then(() => Promise.all([loadNoma(), loadExpenses()])).catch(err => { $("nomaProductionStatus").textContent = err.message || "NOMA connections could not be loaded."; });
    window.addEventListener("grubz:noma-enabled", event => {
      const enabled = event.detail?.enabled === true;
      syncNomaTabAvailability(enabled);
      if (enabled) loadNomaConnections().then(() => Promise.all([loadNoma(), loadExpenses()])).catch(err => { $("nomaProductionStatus").textContent = err.message || "NOMA connections could not be loaded."; });
      else { nomaConnections = []; nomaSummary = null; nomaExpenses = []; }
    });
    $("nomaExpensesRefreshBtn").addEventListener("click", () => Promise.all([loadExpenses(), loadGrubzExpenses()]));
    $("nomaExpensesConnection").addEventListener("change", () => { localStorage.setItem(nomaConnectionKey, $("nomaExpensesConnection").value); loadExpenses(); });
    $("nomaExpensesTable").addEventListener("click", async event => {
      const invoiceButton = event.target.closest("[data-expense-invoice]");
      if (invoiceButton) {
        try {
          invoiceButton.disabled = true;
          expenseStatus("Downloading invoice from NOMA Flow…");
          const query = new URLSearchParams({ action:"expenseInvoice", connection:$("nomaExpensesConnection").value, expenseId:invoiceButton.dataset.expenseInvoice });
          const data = await window.grubzNomaProductionApi({ method:"GET", query:`?${query}` });
          const binary = atob(data.invoice.dataBase64);
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type:data.invoice.contentType || "application/octet-stream" }));
          const link = document.createElement("a"); link.href = url; link.download = data.invoice.fileName || "invoice"; link.click(); URL.revokeObjectURL(url);
          expenseStatus("Invoice downloaded.");
        } catch (err) { expenseStatus(err.message || "The invoice could not be downloaded.", false); }
        finally { invoiceButton.disabled = false; }
        return;
      }
    });
    $("grubzExpenseNewBtn").addEventListener("click", resetGrubzExpenseForm);
    $("grubzExpenseForm").addEventListener("submit", async event => {
      event.preventDefault();
      const id = $("grubzExpenseId").value;
      const file = $("grubzExpenseInvoice").files[0];
      const body = { id, expense:{ date:$("grubzExpenseDate").value, amount:Number($("grubzExpenseAmount").value), currency:"EUR", category:$("grubzExpenseCategory").value, vendor:$("grubzExpenseVendor").value, reference:$("grubzExpenseReference").value, description:$("grubzExpenseDescription").value }, removeInvoice:$("grubzExpenseRemoveInvoice").checked };
      try {
        $("grubzExpenseSaveBtn").disabled = true;
        grubzExpenseStatus("Saving GRUBZ expense…");
        if (file) { body.invoiceDataUrl = await fileDataUrl(file); body.invoiceFileName = file.name; }
        await window.grubzExpensesApi({ method:id ? "PATCH" : "POST", body:JSON.stringify(body) });
        resetGrubzExpenseForm();
        await loadGrubzExpenses(id ? "GRUBZ expense updated." : "GRUBZ expense saved.");
      } catch (err) { grubzExpenseStatus(err.message || "GRUBZ expense could not be saved.", false); }
      finally { $("grubzExpenseSaveBtn").disabled = false; }
    });
    $("grubzExpensesTable").addEventListener("click", async event => {
      const edit = event.target.closest("[data-grubz-expense-edit]");
      if (edit) {
        const item = grubzExpenses.find(value => value.id === edit.dataset.grubzExpenseEdit);
        if (!item) return;
        resetGrubzExpenseForm();
        $("grubzExpenseId").value = item.id; $("grubzExpenseDate").value = item.date; $("grubzExpenseAmount").value = item.amount; $("grubzExpenseCategory").value = item.category; $("grubzExpenseVendor").value = item.vendor; $("grubzExpenseReference").value = item.reference; $("grubzExpenseDescription").value = item.description;
        if (item.invoice) { $("grubzExpenseCurrentInvoice").textContent = `Current invoice: ${item.invoice.fileName}`; $("grubzExpenseCurrentInvoice").classList.remove("hidden"); $("grubzExpenseRemoveInvoiceLabel").classList.remove("hidden"); $("grubzExpenseRemoveInvoiceLabel").classList.add("flex"); }
        $("grubzExpenseCategory").focus(); return;
      }
      const invoice = event.target.closest("[data-grubz-expense-invoice]");
      if (invoice) {
        try { const data = await window.grubzExpensesApi({ query:`?invoice=${encodeURIComponent(invoice.dataset.grubzExpenseInvoice)}` }); downloadBase64File(data.invoice); grubzExpenseStatus("Invoice downloaded."); }
        catch (err) { grubzExpenseStatus(err.message || "Invoice could not be downloaded.", false); }
        return;
      }
      const remove = event.target.closest("[data-grubz-expense-delete]");
      if (!remove) return;
      const item = grubzExpenses.find(value => value.id === remove.dataset.grubzExpenseDelete);
      if (!item || !window.confirm(`Delete the GRUBZ expense “${item.category}”?`)) return;
      try { await window.grubzExpensesApi({ method:"DELETE", query:`?id=${encodeURIComponent(item.id)}` }); if ($("grubzExpenseId").value === item.id) resetGrubzExpenseForm(); await loadGrubzExpenses(); }
      catch (err) { grubzExpenseStatus(err.message || "GRUBZ expense could not be deleted.", false); }
    });
    $("profitEntryType").addEventListener("change", showEntryFields);
    $("profitNewPeriodBtn").addEventListener("click", () => showPeriodForm());
    $("profitEditPeriodBtn").addEventListener("click", () => showPeriodForm(selectedPeriod()));
    $("profitPeriodNomaConnection").addEventListener("change", event => loadPeriodNomaFeedstocks(event.target.value));
    $("profitDeletePeriodBtn").addEventListener("click", async () => {
      const period = selectedPeriod();
      if (!period) return;
      const recordText = entries.length === 1 ? "1 associated record" : `${entries.length} associated records`;
      if (!window.confirm(`Delete “${period.name}” and ${recordText}? This cannot be undone.`)) return;
      const button = $("profitDeletePeriodBtn");
      try {
        button.disabled = true;
        message(`Deleting ${period.name}…`);
        const result = await api({ method:"DELETE", query:`?kind=period&id=${encodeURIComponent(period.id)}` });
        periods = periods.filter(item => item.id !== period.id);
        entries = [];
        aggregate = { totals:{}, assumptions:{} };
        await loadPeriod(periods[0]?.id || "");
        message(`${period.name} deleted with ${number.format(result.deletedEntries || 0)} associated record${result.deletedEntries === 1 ? "" : "s"}.`);
      } catch (err) {
        message(err.message || "The operating period could not be deleted.", false);
        renderData();
      }
    });
    $("profitCancelPeriodBtn").addEventListener("click", () => $("profitPeriodForm").classList.add("hidden"));
    $("profitPeriodSelect").addEventListener("change", () => loadPeriod($("profitPeriodSelect").value));
    $("profitCalculatorPeriodSelect").addEventListener("change", () => loadPeriod($("profitCalculatorPeriodSelect").value));
    $("reportPeriodSelect").addEventListener("change", () => {
      const periodId = $("reportPeriodSelect").value;
      const period = periods.find(item => item.id === periodId);
      $("reportTitleInput").value = "";
      $("reportPreviewPeriod").textContent = period ? `${period.name} · loading records…` : "Choose a period";
      $("reportPreview").innerHTML = '<p class="p-6 text-center text-sm text-zinc-500">Loading the selected period…</p>';
      loadPeriod(periodId);
    });
    $("reportTypeSelect").addEventListener("change", renderReportPreview);
    $("downloadReportCsvBtn").addEventListener("click", downloadReportCsv);
    $("syncProductEconomicsSheetBtn").addEventListener("click", async () => {
      const button = $("syncProductEconomicsSheetBtn");
      const status = $("productEconomicsSyncMsg");
      try {
        button.disabled = true;
        status.className = "mt-2 text-sm text-zinc-600";
        status.textContent = "Connecting to Google Sheets and loading real e-shop sales…";
        const url = await syncProductEconomicsSheet();
        status.className = "mt-2 text-sm text-emerald-700";
        status.innerHTML = `Product Economics updated from real paid orders. <a class="font-bold underline" href="${esc(url)}" target="_blank" rel="noopener">Open workbook</a>`;
      } catch (err) {
        status.className = "mt-2 text-sm text-red-700";
        status.textContent = err.message || "Product Economics could not be synchronized.";
      } finally {
        button.disabled = !selectedReportPeriod() || !googleSheetsClientId || !(liveShopSales?.summary?.products || []).length;
      }
    });
    $("reportBuilderForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = $("createGoogleSheetReportBtn");
      const status = $("reportBuilderMsg");
      try {
        button.disabled = true;
        status.className = "text-sm text-zinc-600";
        status.textContent = "Connecting to Google Sheets…";
        const url = await createGoogleSheetReport();
        status.className = "text-sm text-emerald-700";
        status.innerHTML = `Report created. <a class="font-bold underline" href="${esc(url)}" target="_blank" rel="noopener">Open Google Sheet</a>`;
        window.open(url, "_blank", "noopener");
      } catch (err) {
        status.className = "text-sm text-red-700";
        status.textContent = err.message || "The Google Sheet could not be created.";
      } finally { button.disabled = !selectedReportPeriod() || !googleSheetsClientId; }
    });
    $("profitDataRefreshBtn").addEventListener("click", () => loadPeriod($("profitPeriodSelect").value));
    $("profitPeriodForm").addEventListener("submit", async event => {
      event.preventDefault();
      try {
        message("Saving period…");
        const feedstock = nomaFeedstocks.find(item => item.id === $("profitPeriodNomaFeedstock").value);
        const result = await api({ method:"POST", body:JSON.stringify({ action:"savePeriod", id:$("profitPeriodId").value, period:{ name:$("profitPeriodName").value, startDate:$("profitPeriodStart").value, endDate:$("profitPeriodEnd").value, status:$("profitPeriodStatus").value, notes:$("profitPeriodNotes").value, nomaConnectionId:$("profitPeriodNomaConnection").value, nomaFeedstockId:feedstock?.id || "", nomaFeedstockName:feedstock?.name || "" } }) });
        $("profitPeriodForm").classList.add("hidden");
        await loadPeriod(result.period.id);
      } catch (err) { message(err.message || "Period could not be saved.", false); }
    });
    $("profitEntryForm").addEventListener("submit", async event => {
      event.preventDefault();
      const period = selectedPeriod();
      if (!period) return message("Choose a measurement period first.", false);
      try {
        $("profitSaveEntryBtn").disabled = true;
        message("Saving source record…");
        await api({ method:"POST", body:JSON.stringify({ action:"saveEntry", periodId:period.id, entry:entryPayload() }) });
        event.currentTarget.reset();
        $("profitEntryDate").value = today();
        showEntryFields();
        await loadPeriod(period.id);
      } catch (err) { message(err.message || "Record could not be saved.", false); renderData(); }
    });
    $("profitEntryList").addEventListener("click", async event => {
      const button = event.target.closest("[data-profit-delete-entry]");
      if (!button || !window.confirm("Delete this source record? This cannot be undone.")) return;
      try {
        message("Deleting record…");
        await api({ method:"DELETE", query:`?kind=entry&id=${encodeURIComponent(button.dataset.profitDeleteEntry)}` });
        await loadPeriod($("profitPeriodSelect").value);
      } catch (err) { message(err.message || "Record could not be deleted.", false); }
    });
    const useActuals = () => {
      const form = $("profitCalculatorForm");
      Object.entries(aggregate.assumptions || {}).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = Number(value || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); });
      form.dispatchEvent(new Event("input", { bubbles:true }));
      const period = selectedCalculatorPeriod() || selectedPeriod();
      message(`${period?.name || "Selected period"} actuals loaded into the calculator.`);
      showProductionTab("calculator");
      form.scrollIntoView({ behavior:"smooth", block:"start" });
    };
    $("profitUseActualsBtn").addEventListener("click", useActuals);
    $("profitCalculatorUseActualsBtn").addEventListener("click", useActuals);
    document.querySelector('[data-section-tab="profitCalculator"]')?.addEventListener("click", () => setTimeout(() => loadPeriod($("profitPeriodSelect").value), 0));
    window.grubzReloadProfitPeriods = () => loadPeriod($("profitPeriodSelect")?.value || "");
  }
  window.addEventListener("grubz-profit-api-ready", () => {
    if (window.grubzAdminReady === true) loadPeriod($("profitPeriodSelect")?.value || "");
  });
  window.addEventListener("grubz:admin-ready", () => loadPeriod($("profitPeriodSelect")?.value || ""));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
