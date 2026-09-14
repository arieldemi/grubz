const ACS_API_URL = "https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest";

class AcsApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AcsApiError";
    this.status = details.status || 502;
    this.alias = details.alias || "";
    this.response = details.response || null;
  }
}

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing ACS ${name}`);
  return normalized;
}

function acsCredentials(input = {}) {
  return {
    companyId: requiredText(input.companyId, "company ID"),
    companyPassword: requiredText(input.companyPassword, "company password"),
    userId: requiredText(input.userId, "user ID"),
    userPassword: requiredText(input.userPassword, "user password"),
    billingCode: requiredText(input.billingCode, "billing code"),
    apiKey: requiredText(input.apiKey, "API key"),
  };
}

function authenticatedParameters(credentials, parameters = {}) {
  const config = acsCredentials(credentials);
  return {
    Company_ID: config.companyId,
    Company_Password: config.companyPassword,
    User_ID: config.userId,
    User_Password: config.userPassword,
    ...parameters,
  };
}

function acsOutput(response = {}) {
  // ACS documents and live examples use the misspelled "Responce"; accept both.
  return response.ACSOutputResponce || response.ACSOutputResponse || {};
}

function acsValueRows(response = {}) {
  const rows = acsOutput(response).ACSValueOutput;
  return Array.isArray(rows) ? rows : [];
}

function acsTableRows(response = {}) {
  const rows = acsOutput(response).ACSTableOutput?.Table_Data;
  return Array.isArray(rows) ? rows : [];
}

function acsBusinessError(response = {}) {
  if (response.ACSExecution_HasError === true) {
    return String(response.ACSExecutionErrorMessage || "ACS could not execute the request").trim();
  }
  const rowError = acsValueRows(response)
    .map(row => String(row?.Error_Message || row?.Error_msg || row?.error_message || "").trim())
    .find(Boolean);
  return rowError || "";
}

async function acsRequest(alias, parameters, options = {}) {
  const normalizedAlias = requiredText(alias, "alias");
  const apiKey = requiredText(options.apiKey, "API key");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs || 20000)));
  let response;
  try {
    response = await fetchImpl(options.apiUrl || ACS_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        AcsApiKey: apiKey,
      },
      body: JSON.stringify({ ACSAlias: normalizedAlias, ACSInputParameters: parameters }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error?.name === "AbortError" ? "ACS request timed out" : `ACS request failed: ${error.message || "network error"}`;
    throw new AcsApiError(message, { alias: normalizedAlias, status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new AcsApiError(`ACS returned an invalid JSON response (HTTP ${response.status})`, {
      alias: normalizedAlias,
      status: 502,
    });
  }
  if (!response.ok) {
    throw new AcsApiError(`ACS rejected the request (HTTP ${response.status})`, {
      alias: normalizedAlias,
      status: response.status === 403 ? 502 : response.status,
      response: payload,
    });
  }
  const businessError = acsBusinessError(payload);
  if (businessError) throw new AcsApiError(businessError, { alias: normalizedAlias, response: payload });
  return payload;
}

function createAcsClient(credentials, options = {}) {
  const config = acsCredentials(credentials);
  const call = (alias, parameters) => acsRequest(alias, authenticatedParameters(config, parameters), {
    ...options,
    apiKey: config.apiKey,
  });
  return {
    createVoucher: parameters => call("ACS_Create_Voucher", parameters),
    printVoucher: parameters => call("ACS_Print_Voucher", parameters),
    deleteVoucher: parameters => call("ACS_Delete_Voucher", parameters),
    issuePickupList: parameters => call("ACS_Issue_Pickup_List", parameters),
    printPickupList: parameters => call("ACS_Print_Pickup_List", parameters),
    getPickupLists: parameters => call("ACS_Get_Pickup_Lists", parameters),
    getStationsForPlugin: parameters => call("ACS_Get_Stations_For_Plugin", parameters),
    trackingSummary: parameters => call("ACS_Trackingsummary", parameters),
    trackingDetails: parameters => call("ACS_TrackingDetails", parameters),
    findStationByZipCode: parameters => call("ACS_Find_Station_By_Zip_Code", parameters),
    priceCalculation: parameters => call("ACS_Price_Calculation", parameters),
  };
}

function extractPdf(response = {}) {
  const candidates = [
    ...acsValueRows(response),
    ...acsTableRows(response),
    acsOutput(response),
  ];
  const visit = value => {
    if (value == null) return "";
    if (typeof value === "string") {
      const compact = value.replace(/\s/g, "");
      if (compact.startsWith("JVBERi0")) return compact;
      return "";
    }
    if (Array.isArray(value)) {
      if (value.length > 4 && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) {
        const buffer = Buffer.from(value);
        if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return buffer.toString("base64");
      }
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return "";
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) {
        const found = visit(item);
        if (found) return found;
      }
    }
    return "";
  };
  const base64 = visit(candidates);
  if (!base64) throw new AcsApiError("ACS did not return PDF data", { response });
  return { base64, contentType: "application/pdf", size: Buffer.from(base64, "base64").length };
}

module.exports = {
  ACS_API_URL,
  AcsApiError,
  acsBusinessError,
  acsOutput,
  acsTableRows,
  acsValueRows,
  authenticatedParameters,
  createAcsClient,
  extractPdf,
};
