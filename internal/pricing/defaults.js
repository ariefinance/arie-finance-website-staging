// Standard wording and pricing per brand. The ARIE record is a lift-and-shift of the previous
// hardcoded values (same strings, same fee tiles, same conditions, same footer) so ARIE outputs
// are unchanged. ACBM is added as a second brand with its own eyebrow, templates, and empty
// regulator/licence/footer (deliberate — ACBM must not inherit ARIE's licence or contacts).
// The active brand is picked at runtime; D.brand() returns the active record and the legacy
// top-level getters (D.indicative/client/welcome, D.FOOTER, D.REGULATOR, D.LICENCE) forward to it
// so render.js/exports.js keep working unchanged where they just read a string.
(function () {
  'use strict';

  let seq = 1;
  const uid = () => 'b' + (seq++) + '_' + Math.random().toString(36).slice(2, 7);

  // ---------- ARIE Finance templates (unchanged) ----------
  const ARIE_THIRD_PARTY = () => ({
    id: uid(), type: 'table', title: 'Third-Party Payment Charges',
    columns: ['Charge', 'Incoming', 'Outgoing'],
    rows: [['Correspondent-Bank / SWIFT Charges', 'Not applicable', '0.15%\nMinimum USD 70 · Maximum USD 150\nPlus applicable SWIFT charges']],
    note: 'Additional third-party, correspondent-bank and foreign exchange charges may apply depending on the payment route, currency and transaction requirements.'
  });
  const ARIE_ADDITIONAL = () => ({
    id: uid(), type: 'feeList', title: 'Additional Fees',
    rows: [{ label: 'Service Closure Fee', fee: 'USD 300' }]
  });
  const ARIE_CONDITIONS = () => ({
    id: uid(), type: 'bullets', title: 'Commercial Conditions',
    items: [
      'Account funding: an aggregate minimum balance of USD 5,000, or equivalent, is required within one month of service activation.',
      'Pricing reflects the agreed service scope. Material changes to expected activity, jurisdiction or ownership structure may be subject to review.',
      "All services remain subject to ARIE Finance's standard terms, ongoing compliance requirements and applicable third-party conditions."
    ]
  });

  function arieIndicative() {
    return {
      kind: 'indicative',
      eyebrow: 'ARIE FINANCE',
      title: 'Indicative Fee Schedule',
      subtitle: 'For International Business Clients',
      clientFields: false,
      preparedFor: '', reference: '', date: '',
      intro: 'ARIE Finance provides relationship-led international payment services for globally active businesses, supported by structured onboarding and a dedicated Relationship Manager.',
      note: 'The fees below are indicative and intended as a guide only. Final pricing is subject to onboarding and compliance approval and may vary according to the client profile, jurisdiction, ownership structure, expected transaction activity and service requirements.',
      blocks: [
        {
          id: uid(), type: 'feeGrid', title: 'Fee Structure',
          profiles: [
            { label: 'Standard Profile', fees: [{ label: 'Onboarding Fee', value: 'From USD 2,000' }, { label: 'Monthly Service Fee', value: 'USD 150 / month' }, { label: 'Payment Transaction Fee', value: 'USD 40 / payment' }] },
            { label: 'Enhanced Review Profile', fees: [{ label: 'Onboarding Fee', value: 'From USD 5,000' }, { label: 'Monthly Service Fee', value: 'USD 250 / month' }, { label: 'Payment Transaction Fee', value: 'USD 60 / payment' }] }
          ]
        },
        ARIE_THIRD_PARTY(),
        ARIE_ADDITIONAL()
      ]
    };
  }
  function arieClient() {
    return {
      kind: 'client',
      eyebrow: 'ARIE FINANCE',
      title: 'Client Fee Schedule',
      subtitle: 'Client-Specific Commercial Terms',
      clientFields: true,
      preparedFor: '', reference: '', date: '',
      intro: 'Following approval of your onboarding application, this Client Fee Schedule sets out the commercial terms applicable to your ARIE Finance relationship.',
      note: 'The fees below reflect the applicable service scope and should be read together with the relevant third-party charges, operational conditions and contractual terms.',
      blocks: [
        {
          id: uid(), type: 'feeGrid', title: 'Applicable Fees',
          profiles: [
            { label: '', fees: [{ label: 'Onboarding Fee', value: 'USD 2,000' }, { label: 'Monthly Service Fee', value: 'USD 150 / month' }, { label: 'Payment Transaction Fee', value: 'USD 40 / payment' }] }
          ]
        },
        ARIE_THIRD_PARTY(),
        ARIE_ADDITIONAL(),
        ARIE_CONDITIONS()
      ]
    };
  }
  function arieWelcome() {
    return {
      kind: 'welcome',
      clientName: '',
      packRef: '',
      cfsRef: '',
      date: '',
      coverTitle: 'Welcome Pack',
      readyLine: 'Your account is ready',
      coverText: 'We are pleased to confirm that your account opening process has been completed.',
      coverCurrencyLine: 'Your {currencies} funding details are provided on the next page.',
      coverClose: 'If you have any questions about the contents of this pack, please contact us using the contact details provided in this pack.',
      fundingTitle: 'Your Funding Details',
      fundingIntro: 'Please use the account details below when funding the account. The IBANs and BICs shown should be used with the matching currency.',
      fundingNote: 'Please quote the correspondent account shown for the relevant currency when sending a payment.',
      accounts: [],
      stepsTitle: 'Getting Started',
      steps: [
        { title: 'When making a payment', body: 'Where supporting documents are required for an outgoing transaction, please upload them on the ARIE Finance platform when creating the payment.\nSupporting documents may be requested for incoming transactions and should be provided promptly on request.' },
        { title: 'Keep your information current', body: 'Please notify ARIE Finance promptly of material changes to your legal status, ownership, control, directors, Authorised Users, contact details, business activities, expected payment activity, regulatory status or financial standing, and of any insolvency, winding-up or strike-off event.\nPlease use the prescribed format where applicable.' },
        { title: 'Need assistance?', body: 'ARIE FINANCE CLIENT CARE\ncustomercare@ariefinance.com\n+230 468 6497' }
      ],
      governsTitle: 'For reference · Which document governs what',
      governs: [
        'The Client Fee Schedule governs the fees applicable to you and the commercial conditions specific to those fees.',
        'An accepted Payment Instruction governs the particulars of that individual payment.',
        'The Terms & Conditions govern the ongoing provision of services generally.',
        'This Welcome Pack provides operational and account-activation information.'
      ],
      tcLineEnclosed: 'ARIE Finance Terms & Conditions version 1.4 are enclosed with this pack',
      tcLineSeparate: 'ARIE Finance Terms & Conditions version 1.4 apply to your account and are provided separately',
      feeSource: 'current',
      includeTc: false,
      mismatchAck: ''
    };
  }

  // ---------- ACBM templates (seeded from the reference pricing PDF) ----------
  // ACBM has its own copy — intentionally not shared with ARIE — so changes to one don't leak.
  const ACBM_THIRD_PARTY = () => ({
    id: uid(), type: 'table', title: 'Correspondent Bank Fees',
    columns: ['Charge', 'Incoming', 'Outgoing'],
    rows: [['Correspondent-Bank / SWIFT Charges', 'Not applicable', '0.15%\nMinimum USD 70 · Maximum USD 150\nPlus applicable SWIFT charges']],
    // Note intentionally empty — the same "Additional third-party…" line appears as the second
    // bullet under Important Conditions, where the user wants it. Keeping it in both places
    // duplicates text and pushes the schedule onto a second page.
    note: ''
  });
  const ACBM_ADDITIONAL = () => ({
    id: uid(), type: 'feeList', title: 'General Fees',
    rows: [{ label: 'Account Closure Fee', fee: 'USD 300' }]
  });
  const ACBM_CONDITIONS = () => ({
    id: uid(), type: 'bullets', title: 'Important Conditions',
    items: [
      'Account funding: the account should be funded within one month with an aggregate minimum balance of USD 5,000, or equivalent.',
      'Additional third-party, correspondent-bank and foreign exchange charges may apply depending on the payment route, currency and transaction requirements.',
      "All services remain subject to ACBM's standard terms, ongoing compliance requirements and applicable third-party conditions."
    ]
  });

  // ACBM has ONE fee-schedule mode. The ARIE "Indicative" vs "Client" split does not apply —
  // ACBM's single fee schedule carries client fields (preparedFor / reference / date), is titled
  // "Indicative Fee Schedule" per the reference, and is also what gets allocated a reference.
  function acbmClient() {
    return {
      kind: 'client',
      eyebrow: 'ACBM',
      title: 'Client Fee Schedule',
      subtitle: 'Client-Specific Commercial Terms',
      clientFields: true,
      preparedFor: '', reference: '', date: '',
      intro: "Following approval of your onboarding application, this Client Fee Schedule sets out the commercial terms applicable to your Arie Capital Investment (ACBM) Ltd (‘ACBM’) relationship.",
      note: 'The fees below reflect the applicable service scope and should be read together with the relevant third-party charges, operational conditions and contractual terms.',
      blocks: [
        {
          id: uid(), type: 'feeGrid', title: 'Fee Structure',
          profiles: [
            { label: '', fees: [
              { label: 'Onboarding Fee', value: 'USD 2,500' },
              { label: 'Monthly Service Fee', value: 'USD 150 / month' },
              { label: 'Payment Transaction Fee', value: 'USD 40 / payment' }
            ] }
          ]
        },
        ACBM_THIRD_PARTY(),
        ACBM_ADDITIONAL(),
        ACBM_CONDITIONS()
      ]
    };
  }

  function account(partial) {
    return Object.assign({
      id: uid(), currency: '', beneficiaryName: '', accountNo: '', iban: '', bank: '', bankAddress: '',
      bankSwift: '', corrBank: '', corrSwift: '', corrAccount: '',
      na: {}, sourceName: '', sourceText: '', parsedBy: 'manual'
    }, partial || {});
  }

  // ---------- Brand registry ----------
  // Each brand owns: its logo assets key (into window.ARIE_ASSETS), its header strap-line (regulator /
  // licence — null hides the whole strap-line), its footer contacts (null hides the contacts row and
  // leaves only Private & Confidential + page number), the modes it offers, its filename prefix, its
  // reference regex, its DOCX creator string and the custom-property prefix used to round-trip CFS state.
  //
  // The `label` is for the UI entity switcher; `displayName` is the human name used in modals.
  // ACBM intentionally reuses ARIE's logo (confirmed by the user) and intentionally has no footer,
  // regulator, or licence (confirmed — ACBM must not inherit ARIE's licence or contacts).
  const BRANDS = {
    arie: {
      id: 'arie',
      label: 'ARIE Finance',
      displayName: 'ARIE Finance',
      eyebrow: 'ARIE FINANCE',
      assets: { logoWide: 'LOGO_WIDE', markA: 'MARK_A', markB: 'MARK_B' },
      regulator: 'Regulated by the Financial Services Commission (Mauritius)',
      licence: 'Payment Intermediary Services Licence · GB25205028',
      footer: { web: 'www.ariefinance.com', email: 'customercare@ariefinance.com', phone: '+230 468 6497' },
      modes: ['indicative', 'client', 'welcome'],
      // Default per-mode button labels. Omitted brands fall back to the global MODE_NAMES map.
      filenamePrefix: 'ARIE',
      referenceRegex: /\b(ARIE-FS-[A-Z0-9-]+)\b/i,
      docxCreator: 'ARIE Document Builder',
      statePropPrefix: 'ARIE_STATE_',
      // Visual theme — ARIE's existing navy + gold on cream paper.
      theme: {
        navy: '06113A', navy2: '0C1B45', slate: '3A4256', sand: '9A9078',
        gold: 'C99B3F', gold2: 'B88A32', gold3: 'E6CB86',
        paper: 'F6F1E6', paper2: 'FDFBF6',
        rule: 'E4D8BE', rule2: 'EADFC6', rule3: 'DBCBA0',
        headFill: 'F1E7CE', headText: '06113A', tileFill: 'FDFBF6'
      },
      indicative: arieIndicative,
      client: arieClient,
      welcome: arieWelcome
    },
    acbm: {
      id: 'acbm',
      label: 'ACBM',
      displayName: 'Arie Capital Investment (ACBM) Ltd',
      eyebrow: 'ACBM',
      // ACBM uses its own logo variant (teal mark + dark grey "ARIE FINANCE" wordmark) plus two
      // teal-palette watermark assets: ACBM_MARK_A sits top-left behind the logo as a subtle
      // decorative panel; ACBM_MARK_B carries the signature teal gradient footer bar.
      assets: { logoWide: 'ACBM_LOGO_WIDE', markA: 'ACBM_MARK_A', markB: 'ACBM_MARK_B' },
      regulator: null,
      licence: null,
      footer: null,
      // ACBM has a SINGLE fee-schedule mode — Indicative and Client are the same document under ACBM.
      modes: ['client'],
      modeLabels: { client: 'Fee Schedule' },
      filenamePrefix: 'ACBM',
      referenceRegex: /\b(ACBM-FS-[A-Z0-9-]+)\b/i,
      docxCreator: 'ACBM Document Builder',
      statePropPrefix: 'ACBM_STATE_',
      // Visual theme — ACBM uses teal (sampled from the logo) on white paper, no gold accents.
      // Replaces every "gold" accent with teal in both the HTML and DOCX outputs.
      theme: {
        navy: '1F2A3A', navy2: '2A3645', slate: '3A4256', sand: '5A6A6E',
        gold: '1B4C58', gold2: '164049', gold3: '6FA4AE',
        paper: 'FFFFFF', paper2: 'F7FAFB',
        rule: 'D4E1E4', rule2: 'DFE8EA', rule3: 'B9CDD2',
        // Correspondent-bank table header: deep teal (sampled from the logo) with white text,
        // matching the user's icons. ARIE keeps its beige-on-navy combination unchanged.
        headFill: '1B4C58', headText: 'FFFFFF', tileFill: 'F7FAFB'
      },
      client: acbmClient
      // No welcome(): ACBM has no Welcome Pack.
    }
  };

  let activeBrand = 'arie';
  const brand = () => BRANDS[activeBrand];
  function setBrand(id) { if (BRANDS[id]) activeBrand = id; }

  window.ARIE_DEFAULTS = {
    VERSION: '0.7.3',
    SCHEMA_VERSION: 7,
    BRANDS,
    brand,
    setBrand,
    get activeBrand() { return activeBrand; },
    // Legacy top-level getters forward to the active brand so render.js / exports.js keep working.
    get FOOTER() { return brand().footer || { web: '', email: '', phone: '' }; },
    get REGULATOR() { return brand().regulator || ''; },
    get LICENCE() { return brand().licence || ''; },
    indicative: () => brand().indicative(),
    client: () => brand().client(),
    welcome: () => (brand().welcome ? brand().welcome() : null),
    account,
    uid
  };
})();
