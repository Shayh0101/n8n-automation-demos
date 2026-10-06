// n8n Code node: "Flag Unreadable PDF" (mode: Run Once for All Items)
// Input : items from "Has Text?" false branch (scanned / image-only / empty PDFs)
// Output: a NEEDS_OCR row so nothing is silently dropped from the sheet.

return $input.all().map((item, i) => {
  const j = item.json || {};
  return {
    json: {
      'Processed At': new Date().toISOString(),
      'File Name': j.fileName || '',
      'File ID': j.fileId || '',
      'File URL': j.fileUrl || '',
      Status: 'NEEDS_OCR',
      Notes: `No selectable text found (${j.textLength || 0} chars, ${j.pages || '?'} pages). Likely a scanned PDF - enable OCR.`,
    },
    pairedItem: { item: i },
  };
});
