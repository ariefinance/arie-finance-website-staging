/*
 * Synthetic input configuration for the SYNTHETIC regression pack.
 * All values are fabricated. Do NOT edit to match real ARIE data.
 *
 * For external mode (see render-baseline.js --external), the operator
 * supplies their own JSON file with the same shape via --input-config.
 */
'use strict';

module.exports = {
  previousReportingMonth: '2026-08',
  kpi: {
    activeClients: 3,
    activeBasis:   'Regression fixture (synthetic)',
    accountsActive: 5,
    accountsHeld:   5,
    jurisdictions:  3,
    intlPct:        66,
    volSinceInc:    5.0,
  },
  juris: [
    { name: 'Mauritius',             count: 1 },
    { name: 'United Kingdom',        count: 1 },
    { name: 'United Arab Emirates',  count: 1 },
  ],
  industries: [
    { name: 'Financial Services', count: 2 },
    { name: 'Technology',         count: 1 },
  ],
  commentary: {
    pipeline:    { noUpdate: true, text: '', review: true },
    regulatory:  { noUpdate: true, text: '', review: true },
    tech:        { noUpdate: true, text: '', review: true },
    ebitdaNote:  { noUpdate: true, text: '', review: true },
    metricsNote: { noUpdate: true, text: '', review: true },
  },
  adjustments: {},
  overrides:   {},
  confirmations: { accounts: true, adjYtd: true, dist: true, republish: true },
};
