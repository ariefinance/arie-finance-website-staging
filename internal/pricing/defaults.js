// Standard ARIE wording and pricing. Carried over verbatim from the existing
// Indicative and Client Fee Schedule builders. Edit here to change the defaults
// that every new document starts from. Nothing in the app rewrites these.
(function () {
  'use strict';

  let seq = 1;
  const uid = () => 'b' + (seq++) + '_' + Math.random().toString(36).slice(2, 7);

  const THIRD_PARTY_TABLE = () => ({
    id: uid(), type: 'table', title: 'Third-Party Payment Charges',
    columns: ['Charge', 'Incoming', 'Outgoing'],
    rows: [['Correspondent-Bank / SWIFT Charges', 'Not applicable', '0.15%\nMinimum USD 70 · Maximum USD 150\nPlus applicable SWIFT charges']],
    note: 'Additional third-party, correspondent-bank and foreign exchange charges may apply depending on the payment route, currency and transaction requirements.'
  });

  const ADDITIONAL_FEES = () => ({
    id: uid(), type: 'feeList', title: 'Additional Fees',
    rows: [{ label: 'Service Closure Fee', fee: 'USD 300' }]
  });

  const CONDITIONS = () => ({
    id: uid(), type: 'bullets', title: 'Commercial Conditions',
    items: [
      'Account funding: an aggregate minimum balance of USD 5,000, or equivalent, is required within one month of service activation.',
      'Pricing reflects the agreed service scope. Material changes to expected activity, jurisdiction or ownership structure may be subject to review.',
      "All services remain subject to ARIE Finance's standard terms, ongoing compliance requirements and applicable third-party conditions."
    ]
  });

  function indicative() {
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
        THIRD_PARTY_TABLE(),
        ADDITIONAL_FEES()
      ]
    };
  }

  function client() {
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
        THIRD_PARTY_TABLE(),
        ADDITIONAL_FEES(),
        CONDITIONS()
      ]
    };
  }

  function welcome() {
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
        { title: 'Need assistance?', body: 'ARIE FINANCE CLIENT CARE\ncustomercare@ariefinance.com\n+230 5468 6497' }
      ],
      governsTitle: 'For reference · Which document governs what',
      governs: [
        'The Client Fee Schedule governs the fees applicable to you and the commercial conditions specific to those fees.',
        'An accepted Payment Instruction governs the particulars of that individual payment.',
        'The Terms & Conditions govern the ongoing provision of services generally.',
        'This Welcome Pack provides operational and account-activation information.'
      ],
      // The Terms & Conditions line is chosen automatically from the attachment state (render.js tcLine):
      tcLineEnclosed: 'ARIE Finance Terms & Conditions version 1.4 are enclosed with this pack',
      tcLineSeparate: 'ARIE Finance Terms & Conditions version 1.4 apply to your account and are provided separately',
      feeSource: 'current',   // 'current' | 'upload' | 'none'
      includeTc: false,
      mismatchAck: ''         // the exact set of client-name differences staff confirmed as intentional
    };
  }

  function account(partial) {
    return Object.assign({
      id: uid(), currency: '', beneficiaryName: '', accountNo: '', iban: '', bank: '', bankAddress: '',
      bankSwift: '', corrBank: '', corrSwift: '', corrAccount: '',
      na: {}, sourceName: '', sourceText: '', parsedBy: 'manual'
    }, partial || {});
  }

  window.ARIE_DEFAULTS = { VERSION: '0.6.0', SCHEMA_VERSION: 2, indicative, client, welcome, account, uid,
    FOOTER: { web: 'www.ariefinance.com', email: 'customercare@ariefinance.com', phone: '+230 5468 6497' },
    REGULATOR: 'Regulated by the Financial Services Commission (Mauritius)',
    LICENCE: 'Payment Intermediary Services Licence · GB25205028'
  };
})();
