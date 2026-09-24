import { formatContractorContactCard } from '../../src/utils/contractorContactCard';
import type { Contractor } from '../../src/services/contractors';

const contractor: Contractor = {
  id: 'contractor-1',
  vesselId: 'vessel-1',
  department: 'ENGINEERING',
  companyName: 'Atlantic Marine Electrical',
  companyAddress: '1450 Marina Mile Blvd, Fort Lauderdale',
  knownFor: 'Marine electrical repairs',
  description: 'Troubleshooting and emergency electrical call-outs.',
  contacts: [
    {
      name: 'Michael Turner',
      mobile: '+1 954 555 0184',
      email: 'michael@atlanticmarine.com',
    },
    {
      name: 'Sarah Klein',
      mobile: '+1 954 555 0117',
      email: 'sarah@atlanticmarine.com',
    },
  ],
  createdAt: '2026-09-25T00:00:00.000Z',
};

describe('formatContractorContactCard', () => {
  it('includes the complete user-facing contractor record and every contact', () => {
    expect(formatContractorContactCard(contractor)).toBe(
      [
        'Nautical Ops Contractor Contact',
        '',
        'Known For: Marine electrical repairs',
        'Company: Atlantic Marine Electrical',
        'Department: Engineering',
        'Description: Troubleshooting and emergency electrical call-outs.',
        'Company Address: 1450 Marina Mile Blvd, Fort Lauderdale',
        '',
        'Contact 1: Michael Turner',
        'Mobile: +1 954 555 0184',
        'Email: michael@atlanticmarine.com',
        'Contact 2: Sarah Klein',
        'Mobile: +1 954 555 0117',
        'Email: sarah@atlanticmarine.com',
      ].join('\n')
    );
  });

  it('omits blank optional fields without leaving empty labels', () => {
    expect(
      formatContractorContactCard({
        ...contractor,
        companyName: '',
        companyAddress: '',
        description: '',
        contacts: [],
      })
    ).toBe(
      [
        'Nautical Ops Contractor Contact',
        '',
        'Known For: Marine electrical repairs',
        'Department: Engineering',
      ].join('\n')
    );
  });
});
