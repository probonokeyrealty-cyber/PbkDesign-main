/**
 * File export utilities for documents, scripts, and PDFs
 * Centralizes all download and export logic
 */

/**
 * Download text content as a .txt file
 */
export const downloadTextFile = (content: string, filename: string): void => {
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.txt') ? filename : `${filename}.txt`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the URL object
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading text file:', error);
    throw new Error('Failed to download file. Please try again.');
  }
};

/**
 * Copy text content to clipboard
 */
export const copyToClipboard = async (content: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (error) {
    // Fallback for older browsers
    try {
      const textArea = document.createElement('textarea');
      textArea.value = content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';

      document.body.appendChild(textArea);
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      return successful;
    } catch (fallbackError) {
      console.error('Error copying to clipboard:', fallbackError);
      return false;
    }
  }
};

/**
 * Download JSON data as a file
 */
export const downloadJSON = (data: any, filename: string): void => {
  try {
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.json') ? filename : `${filename}.json`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading JSON file:', error);
    throw new Error('Failed to download JSON file. Please try again.');
  }
};

/**
 * Download CSV data as a file
 */
export const downloadCSV = (data: string[][], filename: string): void => {
  try {
    const csvContent = data.map(row =>
      row.map(cell => {
        // Escape cells that contain commas or quotes
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading CSV file:', error);
    throw new Error('Failed to download CSV file. Please try again.');
  }
};

/**
 * Generate safe filename from deal address or default name
 */
export const generateFilename = (
  prefix: string,
  address?: string,
  suffix?: string
): string => {
  const sanitized = address
    ? address.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)
    : 'Template';

  const parts = [prefix, sanitized];
  if (suffix) parts.push(suffix);

  return parts.join('_');
};

/**
 * Print current page or specific element
 */
export const printPage = (elementId?: string): void => {
  if (elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
      console.error(`Element with id "${elementId}" not found`);
      return;
    }

    // Create a new window with just the element content
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Print</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              @media print {
                body { padding: 0; }
              }
            </style>
          </head>
          <body>
            ${element.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }
  } else {
    window.print();
  }
};

/**
 * Share content via Web Share API (mobile-friendly)
 */
export const shareContent = async (
  title: string,
  text: string,
  url?: string
): Promise<boolean> => {
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url,
      });
      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing content:', error);
      }
      return false;
    }
  }

  // Fallback: copy to clipboard
  return copyToClipboard(text + (url ? `\n\n${url}` : ''));
};

/**
 * Validate file size before download (prevent browser crashes)
 */
export const validateFileSize = (content: string, maxSizeMB: number = 10): boolean => {
  const sizeInMB = new Blob([content]).size / (1024 * 1024);
  return sizeInMB <= maxSizeMB;
};
