// Shopping list export utilities for inventory and kit requirements

export interface ShoppingListItem {
  dmcNumber: string;
  colorName: string;
  quantity: number;
  unit: "skeins" | "yards";
  hex?: string;
  notes?: string;
}

/**
 * Generate CSV content for a shopping list
 */
export function generateShoppingListCSV(items: ShoppingListItem[], title?: string): string {
  const lines: string[] = [];

  // Add title as comment if provided
  if (title) {
    lines.push(`# ${title}`);
    lines.push(`# Generated: ${new Date().toLocaleDateString()}`);
    lines.push("");
  }

  // Header row
  lines.push("DMC Number,Color Name,Quantity,Unit,Notes");

  // Data rows
  for (const item of items) {
    const row = [
      item.dmcNumber,
      `"${item.colorName.replace(/"/g, '""')}"`, // Escape quotes in CSV
      item.quantity.toString(),
      item.unit,
      item.notes ? `"${item.notes.replace(/"/g, '""')}"` : "",
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/**
 * Generate printable HTML content for a shopping list
 */
export function generateShoppingListHTML(
  items: ShoppingListItem[],
  title: string,
  subtitle?: string
): string {
  const totalSkeins = items
    .filter(i => i.unit === "skeins")
    .reduce((sum, i) => sum + i.quantity, 0);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title} - Shopping List</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
      color: #1e293b;
    }
    .header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #e2e8f0;
    }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 14px; }
    .date { color: #94a3b8; font-size: 12px; margin-top: 8px; }
    .summary {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .summary-item { text-align: center; }
    .summary-value { font-size: 28px; font-weight: bold; color: #881337; }
    .summary-label { font-size: 12px; color: #64748b; text-transform: uppercase; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th {
      text-align: left;
      padding: 12px 8px;
      background: #f1f5f9;
      border-bottom: 2px solid #e2e8f0;
      font-weight: 600;
    }
    td {
      padding: 10px 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:hover { background: #f8fafc; }
    .color-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .color-swatch {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
      flex-shrink: 0;
    }
    .dmc-number { font-weight: 600; font-family: monospace; }
    .quantity { font-weight: 600; text-align: center; }
    .checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #cbd5e1;
      border-radius: 4px;
    }
    .notes { color: #64748b; font-size: 12px; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Shopping List</h1>
    ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
    <p class="date">Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
  </div>

  <div class="summary">
    <div class="summary-item">
      <div class="summary-value">${items.length}</div>
      <div class="summary-label">Colors</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${totalSkeins}</div>
      <div class="summary-label">Total Skeins</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 40px;"></th>
        <th style="width: 80px;">DMC #</th>
        <th>Color Name</th>
        <th style="width: 80px; text-align: center;">Qty</th>
        <th style="width: 60px;">Unit</th>
        ${items.some(i => i.notes) ? '<th>Notes</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td><div class="checkbox"></div></td>
          <td class="dmc-number">${item.dmcNumber}</td>
          <td>
            <div class="color-cell">
              ${item.hex ? `<div class="color-swatch" style="background: ${item.hex};"></div>` : ''}
              <span>${item.colorName}</span>
            </div>
          </td>
          <td class="quantity">${item.quantity}</td>
          <td>${item.unit}</td>
          ${items.some(i => i.notes) ? `<td class="notes">${item.notes || ''}</td>` : ''}
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

  return html;
}

/**
 * Download a file with the given content
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open printable HTML in a new window
 */
export function openPrintableWindow(html: string): void {
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    // Auto-trigger print dialog after a short delay
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
}
