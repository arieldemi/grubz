# GRUBZ ↔ NOMA Flow integration contract

## Status

Planning complete for Phase 1: authenticated, read-only production integration.

Do not enable production synchronization until NOMA Flow authenticates the integration identity and derives tenant/farm scope from that identity. A caller-provided `tenantId` or `farmId` must never grant access by itself.

## System ownership

NOMA Flow owns:

- egg, feeding, cooling, drying, processing, and finished-production lots;
- batch lineage, splits, merges, transfers, weights, losses, and stage history;
- production tasks, rooms, processing records, quality status, and physical inventory.

GRUBZ owns:

- products, customers, orders, sales, discounts, refunds, and payment fees;
- sellable reservations and commercial availability;
- profitability reports that combine GRUBZ sales with NOMA production facts.

Production records are edited only in NOMA Flow. GRUBZ initially receives a read-only projection.

## Phase 1 scope

Phase 1 must provide:

1. A dedicated NOMA integration identity for GRUBZ.
2. One versioned, read-only NOMA endpoint.
3. A GRUBZ server-side client using a secret credential.
4. A Production overview in GRUBZ showing synchronization status and NOMA totals.
5. No inventory writes and no webhooks yet.

## Required NOMA endpoint

`GET /api/v1/integrations/grubz/production-summary`

Supported query parameters:

- `startDate`: required ISO date (`YYYY-MM-DD`).
- `endDate`: required ISO date (`YYYY-MM-DD`).
- `updatedSince`: optional ISO timestamp for later incremental synchronization.
- `cursor`: optional opaque pagination cursor.

Tenant and farm are not accepted as authorization inputs. They are resolved from the integration credential.

### Response

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-19T12:00:00.000Z",
  "scope": {
    "tenantId": "grubz",
    "farmId": "primary"
  },
  "period": {
    "startDate": "2026-09-01",
    "endDate": "2026-09-30"
  },
  "totals": {
    "processedFeedstockKg": 0,
    "sellableOutputKg": 0,
    "productionLossKg": 0,
    "feedstockCost": 0,
    "packagingCost": 0,
    "directLaborCost": 0,
    "utilitiesCost": 0,
    "otherVariableCost": 0
  },
  "lots": [
    {
      "lotId": "DRY-2026-0042",
      "batchId": "BATCH-2026-0018",
      "stage": "drying",
      "status": "released",
      "inputKg": 30,
      "outputKg": 8.7,
      "updatedAt": "2026-09-19T10:30:00.000Z",
      "revision": 4,
      "parents": [
        { "lotId": "COOL-2026-0018", "quantityKg": 18 },
        { "lotId": "COOL-2026-0019", "quantityKg": 12 }
      ]
    }
  ],
  "nextCursor": null
}
```

All monetary values use the tenant currency and decimal major units. All mass values use kilograms. Every returned record must have a stable identifier, `updatedAt`, and monotonically increasing `revision`.

## Authentication requirements

Preferred mechanism: OAuth 2.0 client credentials with a short-lived bearer token.

Acceptable Phase 1 mechanism: a randomly generated integration key stored only as:

- a hash in NOMA Flow;
- a Firebase secret in GRUBZ.

The credential record must contain:

- integration ID;
- tenant ID;
- farm ID;
- allowed scopes (`production:read` only for Phase 1);
- status;
- created and last-used timestamps;
- optional expiry and rotation metadata.

NOMA must reject:

- missing, invalid, expired, or disabled credentials;
- credentials without `production:read`;
- attempts to override credential scope with query/body tenant or farm IDs;
- invalid date ranges or excessive page sizes.

Responses must use `Cache-Control: no-store`. Logs must never contain the raw credential.

## GRUBZ configuration

GRUBZ will require:

- `NOMA_API_BASE_URL` — non-secret production configuration pointing to NOMA Flow;
- `NOMA_CREDENTIAL_ENCRYPTION_KEY` — Firebase secret containing a stable,
  base64-encoded 32-byte key used only to encrypt credentials stored by GRUBZ;
- NOMA API keys are added through **Console → Integrations → NOMA Flow** and
  stored encrypted. Tenant and farm scope are discovered from NOMA and are not
  entered in GRUBZ.

For local development, `npm run dev` creates `functions/.secret.local` when
needed and reuses it on subsequent starts. Do not delete that file while it
contains configured connections: replacing the master key makes existing
encrypted credentials unreadable. Production setup requires creating the
secret before deploying the function, for example:

```sh
openssl rand -base64 32 | firebase functions:secrets:set NOMA_CREDENTIAL_ENCRYPTION_KEY --data-file=-
```

The local GRUBZ function defaults to `http://127.0.0.1:5517` for NOMA Flow.
Production never uses this fallback and requires `NOMA_API_BASE_URL`.
- expected `schemaVersion`;
- request timeout and retry policy.

The GRUBZ browser must call only the GRUBZ backend. It must never receive or send the NOMA credential.

## Phase 1 acceptance checks

- A valid GRUBZ integration credential returns only its configured tenant/farm data.
- Missing and invalid credentials return `401`.
- Insufficient scope returns `403`.
- Caller-supplied tenant/farm values cannot change the resolved scope.
- Date boundaries and units are tested.
- Split/merge parents are preserved in the lot projection.
- Repeating the same request returns stable IDs without creating data.
- GRUBZ displays the response but does not modify NOMA or inventory.

## Later phases

After read-only results reconcile for at least three periods:

1. Add signed NOMA webhooks and nightly reconciliation.
2. Map released NOMA finished lots to GRUBZ products/inventory pools.
3. Add reservation and availability synchronization.
4. Retire duplicate production-entry fields in GRUBZ.

## Expenses management endpoint

The Reports → Expenses manager uses a credential-scoped NOMA endpoint. GRUBZ
never accepts tenant or farm identifiers from the browser and never exposes the
NOMA credential.

`GET /api/v1/integrations/grubz/expenses`

- `GET` accepts optional `startDate` and `endDate` (`YYYY-MM-DD`).
- `GET /api/v1/integrations/grubz/expenses/:expenseId/invoice` returns the
  invoice bytes with `Content-Type` and `Content-Disposition` headers.
- The credential must carry the NOMA expense read scope. Expense records and
  invoice files remain managed exclusively in NOMA Flow.

The list response is versioned and credential-scoped:

```json
{
  "schemaVersion": 1,
  "scope": { "tenantId": "grubz", "farmId": "primary" },
  "expenses": [
    {
      "id": "expense-123",
      "date": "2026-10-07",
      "category": "utilities",
      "amount": 42.5,
      "currency": "EUR",
      "vendor": "Example Energy",
      "reference": "INV-123",
      "description": "Production electricity",
      "invoice": {
        "fileName": "INV-123.pdf",
        "contentType": "application/pdf",
        "size": 42817
      }
    }
  ],
  "totals": { "amount": 42.5, "currency": "EUR" }
}
```
