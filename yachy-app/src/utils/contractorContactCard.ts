import type { Contractor } from '../services/contractors';

const titleCaseDepartment = (department: Contractor['department']) =>
  department.charAt(0) + department.slice(1).toLowerCase();

export const formatContractorContactCard = (contractor: Contractor): string => {
  const details = [
    contractor.knownFor ? `Known For: ${contractor.knownFor}` : null,
    contractor.companyName ? `Company: ${contractor.companyName}` : null,
    contractor.department ? `Department: ${titleCaseDepartment(contractor.department)}` : null,
    contractor.description ? `Description: ${contractor.description}` : null,
    contractor.companyAddress ? `Company Address: ${contractor.companyAddress}` : null,
  ].filter((line): line is string => Boolean(line));

  const contacts = contractor.contacts.flatMap((contact, index) => {
    const prefix = contractor.contacts.length > 1 ? `Contact ${index + 1}` : 'Contact';
    return [
      contact.name ? `${prefix}: ${contact.name}` : null,
      contact.mobile ? `Mobile: ${contact.mobile}` : null,
      contact.email ? `Email: ${contact.email}` : null,
    ].filter((line): line is string => Boolean(line));
  });

  return [
    'Nautical Ops Contractor Contact',
    '',
    ...details,
    ...(contacts.length ? ['', ...contacts] : []),
  ]
    .join('\n')
    .trim();
};
