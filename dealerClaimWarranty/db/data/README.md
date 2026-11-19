# Dealer Warranty Claim Management – Seed Data

Copy every `dc-*.csv` file into your project's `db/data/` folder. Keep `db/schema.cds` in place.

Then, from the project root, run:
```bash
npx cds deploy --to sqlite:db.sqlite
```
Use your configured HANA deployment target when testing against HANA. Do not reset a database containing data you need.

## Included records
3 dealers; 5 categories; 3 warranty policies; 6 vehicles; 10 parts; 9 labour operations; 15 policy/category coverage rows; 8 claims and related parts/labour; document metadata; eligibility checks; review tasks, decisions, status history; 3 settlements.

## Test scenarios
- CLM-2026-0001: Draft baseline expected to pass eligibility.
- CLM-2026-0002: Draft with expired warranty.
- CLM-2026-0003: Draft with failure mileage above policy maximum.
- CLM-2026-0004: Draft submitted beyond policy submission window.
- CLM-2026-0005: UnderTechnicalReview with part-price and labour-rate variance; technical task open.
- CLM-2026-0006: Finance-approved amount differs from technical approved amount; settlement Pending.
- CLM-2026-0007: Settled; payment Paid.
- CLM-2026-0008: Approved; payment Failed.

Association columns follow CAP CSV conventions: `dealer_ID`, `vehicle_ID`, `policy_ID`, `category_code`, `partMaster_ID`, `labourOperation_ID`, `claim_ID`, and `reviewTask_ID`.

`ClaimDocuments.content` is intentionally omitted: these are metadata-only sample documents. Upload actual binary files through the app. No duplicate repair reference is pre-seeded because a global duplicate check could mark both matching claims as duplicates; create a second claim using an existing repair reference to test that case.

This is development sample data, not production data.
