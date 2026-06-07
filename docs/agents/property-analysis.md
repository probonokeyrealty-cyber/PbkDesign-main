# Property Analysis Capability

Property analysis is a bridge capability, not a separately deployed agent.
Creating an `property-analyzer` agent card would imply remote health and routing
that do not currently exist.

## Inputs

- Canonical property address
- Beds, baths, square feet, year built, lot and condition
- Repairs, ARV, mortgage balance, seller ask, and deal path
- Cached or researched property data

## Outputs

- Normalized property facts
- ARV and repair context
- Deal path calculations and confidence
- Analyzer state stored with the lead/deal record

## Runtime wiring

- Tools: `getPropertyData`, `cachePropertyData`, `scrape_property`,
  `analyzeDeal`, `simulateDealConfidence`
- Browser research: `launchBrowserResearch` when an approved research path is
  required
- Persistent source: canonical lead/property records and analyzer runs

If property analysis becomes independently deployable, add it to the registry only
after it has an authenticated `/invoke`, `/health`, timeout, and owned deployment.
