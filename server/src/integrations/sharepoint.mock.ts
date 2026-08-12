/**
 * MOCK ADAPTER - SharePoint document repository.
 * Production implementation uses Microsoft Graph against the ESSA SharePoint
 * site. The portal stores metadata + stable references only (P11 - no
 * duplicate binary ownership); this mock fabricates stable repository URLs.
 */
export const SharePointMock = {
  siteRoot: 'https://essa.sharepoint.com/sites/ap-automation',

  storeDocument(invoiceNumber: string, fileName: string): { url: string; checksum: string } {
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const checksum = 'sha256:' + Array.from(fileName + invoiceNumber)
      .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 7)
      .toString(16)
      .replace('-', 'a')
      .padStart(12, '0');
    return {
      url: `${this.siteRoot}/Shared%20Documents/Invoices/${invoiceNumber}/${safe}`,
      checksum,
    };
  },
};
