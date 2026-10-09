"use strict";

const EXPECTED_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const MAX_PAGES = 100;

function integrationError(message, status = 502, code = "noma_integration_error") {
  return Object.assign(new Error(message), { status, code });
}

function validateDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw integrationError(`${name} must be YYYY-MM-DD`, 400, "invalid_date");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw integrationError(`${name} is invalid`, 400, "invalid_date");
  }
  return date;
}

function validateSummary(payload) {
  if (!payload || payload.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw integrationError("NOMA returned an unsupported schema version", 502, "schema_mismatch");
  }
  if (!payload.scope?.tenantId || !payload.scope?.farmId || !payload.period?.startDate || !payload.period?.endDate) {
    throw integrationError("NOMA returned an incomplete production scope", 502, "invalid_response");
  }
  if (!payload.totals || !Array.isArray(payload.lots)) {
    throw integrationError("NOMA returned an incomplete production summary", 502, "invalid_response");
  }
  for (const lot of payload.lots) {
    if (!lot?.lotId || !lot.updatedAt || !Number.isInteger(lot.revision) || lot.revision < 1 || !Array.isArray(lot.parents)) {
      throw integrationError("NOMA returned an invalid production lot", 502, "invalid_response");
    }
  }
  return payload;
}

function retryable(error) {
  return error?.name === "AbortError" || error?.status === 429 || Number(error?.status) >= 500;
}

function validateExpensePayload(payload) {
  if (!payload || payload.schemaVersion !== EXPECTED_SCHEMA_VERSION || !payload.scope?.tenantId || !payload.scope?.farmId || !Array.isArray(payload.expenses)) {
    throw integrationError("NOMA returned an invalid expenses response", 502, "invalid_response");
  }
  for (const expense of payload.expenses) {
    if (!expense?.id || !expense.date || !expense.category || !Number.isFinite(Number(expense.amount)) || Number(expense.amount) < 0 || !expense.currency) {
      throw integrationError("NOMA returned an invalid expense", 502, "invalid_response");
    }
  }
  return payload;
}

async function fetchNomaExpenses(options = {}) {
  const baseUrl = String(options.baseUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  if (!baseUrl) throw integrationError("NOMA_API_BASE_URL is not configured", 503, "not_configured");
  if (!apiKey) throw integrationError("NOMA integration credential is not configured", 503, "not_configured");
  if (options.startDate) validateDate(options.startDate, "startDate");
  if (options.endDate) validateDate(options.endDate, "endDate");
  if (options.startDate && options.endDate && options.startDate > options.endDate) throw integrationError("startDate must not be after endDate", 400, "invalid_date_range");
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") throw integrationError("NOMA expenses are read-only", 405, "read_only");
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : DEFAULT_RETRIES;
  const url = new URL("/api/v1/integrations/grubz/expenses", baseUrl);
  [["startDate", options.startDate], ["endDate", options.endDate], ["expenseId", options.expenseId]].forEach(([key, value]) => { if (value) url.searchParams.set(key, String(value)); });
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers:{ Authorization:`Bearer ${apiKey}`, Accept:"application/json" },
        signal:controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream = integrationError(body.error || `NOMA request failed (${response.status})`, response.status, "upstream_error");
        if (attempt < retries && retryable(upstream)) continue;
        throw upstream;
      }
      return validateExpensePayload(body);
    } catch (error) {
      if (attempt < retries && retryable(error)) continue;
      if (error?.name === "AbortError") throw integrationError("NOMA request timed out", 504, "timeout");
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw integrationError("NOMA expenses request failed");
}

async function fetchNomaExpenseInvoice(options = {}) {
  const baseUrl = String(options.baseUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const expenseId = String(options.expenseId || "").trim();
  if (!baseUrl) throw integrationError("NOMA_API_BASE_URL is not configured", 503, "not_configured");
  if (!apiKey) throw integrationError("NOMA integration credential is not configured", 503, "not_configured");
  if (!expenseId) throw integrationError("Expense ID is required", 400, "missing_expense");
  const fetchImpl = options.fetchImpl || global.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS);
  try {
    const url = new URL(`/api/v1/integrations/grubz/expenses/${encodeURIComponent(expenseId)}/invoice`, baseUrl);
    const response = await fetchImpl(url, { method:"GET", headers:{ Authorization:`Bearer ${apiKey}`, Accept:"application/pdf,image/jpeg,image/png,image/webp" }, signal:controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw integrationError(body.error || `NOMA request failed (${response.status})`, response.status, "upstream_error");
    }
    const contentType = String(response.headers?.get?.("content-type") || "application/octet-stream").split(";")[0];
    const fileName = String(response.headers?.get?.("content-disposition") || "").match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1] || "invoice";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw integrationError("NOMA returned an invalid invoice file", 502, "invalid_response");
    return { fileName:decodeURIComponent(fileName), contentType, dataBase64:buffer.toString("base64") };
  } catch (error) {
    if (error?.name === "AbortError") throw integrationError("NOMA request timed out", 504, "timeout");
    throw error;
  } finally { clearTimeout(timer); }
}

async function requestPage({ baseUrl, apiKey, params, fetchImpl, timeoutMs, retries }) {
  const url = new URL("/api/v1/integrations/grubz/production-summary", baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream = integrationError(body.error || `NOMA request failed (${response.status})`, response.status, "upstream_error");
        if (attempt < retries && retryable(upstream)) continue;
        throw upstream;
      }
      return validateSummary(body);
    } catch (error) {
      if (attempt < retries && retryable(error)) continue;
      if (error?.name === "AbortError") throw integrationError("NOMA request timed out", 504, "timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw integrationError("NOMA request failed");
}

async function fetchNomaProductionSummary(options = {}) {
  const start = validateDate(options.startDate, "startDate");
  const end = validateDate(options.endDate, "endDate");
  if (start > end) throw integrationError("startDate must not be after endDate", 400, "invalid_date_range");
  const baseUrl = String(options.baseUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  if (!baseUrl) throw integrationError("NOMA_API_BASE_URL is not configured", 503, "not_configured");
  if (!apiKey) throw integrationError("NOMA_INTEGRATION_KEY is not configured", 503, "not_configured");

  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : DEFAULT_RETRIES;
  let cursor = "";
  let first = null;
  const lots = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const summary = await requestPage({
      baseUrl, apiKey, fetchImpl, timeoutMs, retries,
      params: { startDate: options.startDate, endDate: options.endDate, updatedSince: options.updatedSince, cursor },
    });
    if (!first) first = summary;
    else if (summary.scope.tenantId !== first.scope.tenantId || summary.scope.farmId !== first.scope.farmId) {
      throw integrationError("NOMA scope changed during pagination", 502, "scope_mismatch");
    }
    if (options.expectedScope && (
      summary.scope.tenantId !== options.expectedScope.tenantId ||
      summary.scope.farmId !== options.expectedScope.farmId
    )) {
      throw integrationError("NOMA credential scope does not match the configured connection", 502, "scope_mismatch");
    }
    lots.push(...summary.lots);
    cursor = summary.nextCursor || "";
    if (!cursor) return { ...first, generatedAt: summary.generatedAt || first.generatedAt, lots, nextCursor: null };
  }
  throw integrationError("NOMA pagination exceeded the safety limit", 502, "pagination_limit");
}

async function fetchNomaCredentialInfo(options = {}) {
  const baseUrl = String(options.baseUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  if (!baseUrl) throw integrationError("NOMA_API_BASE_URL is not configured", 503, "not_configured");
  if (!apiKey) throw integrationError("NOMA API key is required", 400, "missing_credential");
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : DEFAULT_RETRIES;
  const url = new URL("/api/v1/integrations/credential-info", baseUrl);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method:"GET", headers:{ Authorization:`Bearer ${apiKey}`, Accept:"application/json" }, signal:controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream = integrationError(body.error || `NOMA request failed (${response.status})`, response.status, "upstream_error");
        if (attempt < retries && retryable(upstream)) continue;
        throw upstream;
      }
      const credential = body?.credential;
      if (body?.schemaVersion !== EXPECTED_SCHEMA_VERSION || !credential?.scope?.tenantId || !credential?.scope?.farmId || !Array.isArray(credential.allowedScopes)) {
        throw integrationError("NOMA returned invalid credential metadata", 502, "invalid_response");
      }
      return credential;
    } catch (error) {
      if (attempt < retries && retryable(error)) continue;
      if (error?.name === "AbortError") throw integrationError("NOMA request timed out", 504, "timeout");
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw integrationError("NOMA credential lookup failed");
}

async function fetchNomaInventorySummary(options = {}) {
  const baseUrl = String(options.baseUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  if (!baseUrl) throw integrationError("NOMA_API_BASE_URL is not configured", 503, "not_configured");
  if (!apiKey) throw integrationError("NOMA integration credential is not configured", 503, "not_configured");
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : DEFAULT_RETRIES;
  const url = new URL("/api/v1/integrations/grubz/inventory-summary", baseUrl);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { method:"GET", headers:{ Authorization:`Bearer ${apiKey}`, Accept:"application/json" }, signal:controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream = integrationError(body.error || `NOMA request failed (${response.status})`, response.status, "upstream_error");
        if (attempt < retries && retryable(upstream)) continue;
        throw upstream;
      }
      if (body?.schemaVersion !== EXPECTED_SCHEMA_VERSION || !body.scope?.tenantId || !body.scope?.farmId || !Array.isArray(body.items)) {
        throw integrationError("NOMA returned an invalid inventory summary", 502, "invalid_response");
      }
      for (const item of body.items) {
        if (!item?.id || !item?.name || !Number.isFinite(Number(item.stock)) || Number(item.stock) < 0 || !item?.unit) {
          throw integrationError("NOMA returned an invalid inventory item", 502, "invalid_response");
        }
      }
      return body;
    } catch (error) {
      if (attempt < retries && retryable(error)) continue;
      if (error?.name === "AbortError") throw integrationError("NOMA request timed out", 504, "timeout");
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw integrationError("NOMA inventory lookup failed");
}

module.exports = { EXPECTED_SCHEMA_VERSION, fetchNomaCredentialInfo, fetchNomaExpenseInvoice, fetchNomaExpenses, fetchNomaInventorySummary, fetchNomaProductionSummary, validateSummary };
