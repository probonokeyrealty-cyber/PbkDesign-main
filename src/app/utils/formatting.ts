/**
 * Shared formatting utilities for the PBK Deal Command Center
 * Centralizes currency, percentage, and date formatting across all components
 */

export const formatCurrency = (n: number): string => {
  if (!n || isNaN(n)) return '$0';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

export const formatPercent = (n: number, decimals: number = 1): string => {
  if (!n || isNaN(n)) return '0%';
  return `${n.toFixed(decimals)}%`;
};

export const formatDate = (date?: Date | string): string => {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
};

export const formatNumber = (n: number, decimals: number = 0): string => {
  if (!n || isNaN(n)) return '0';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

export const sanitizeLegacyCopy = (text: string): string => {
  if (!text) return '';

  const replacements: Array<[string, string]> = [
    ['â€™', "'"],
    ['â€œ', '"'],
    ['â€\u009d', '"'],
    ['â€"', '"'],
    ['â€"', '"'],
    ['â€“', '-'],
    ['â€”', '--'],
    ['â€¢', '-'],
    ['âœ“', '-'],
    ['âœ…', ''],
    ['ðŸ“ž', ''],
    ['ðŸŽ¯', ''],
    ['ðŸ“Š', ''],
    ['ðŸ“ˆ', ''],
    ['ðŸŒ³', ''],
    ['ðŸ‘¤', ''],
    ['ðŸ¤', ''],
    ['ðŸ“§', ''],
    ['ðŸ“‹', ''],
    ['ðŸ›‘', 'Pass'],
    ['âš ï¸', 'Review'],
    ['ï¸', ''],
    ['â†’', '->'],
  ];

  return replacements
    .reduce((result, [from, to]) => result.split(from).join(to), text)
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€“|â€”/g, '-')
    .replace(/â†’/g, '->')
    .replace(/âœ…|ðŸ“ž|ðŸŽ¯|ðŸ“Š|ðŸ“ˆ|ðŸŒ³|ðŸ‘¤|ðŸ¤|ðŸ“§|ðŸ“‹/g, '')
    .replace(/ðŸ›‘/g, 'Pass')
    .replace(/âš ï¸/g, 'Warning');
};
