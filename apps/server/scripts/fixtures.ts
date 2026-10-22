export function lecturePdf(): Uint8Array {
  const stream = "BT /F1 24 Tf 72 720 Td (Kirchhoff Circuit Laws) Tj 0 -40 Td /F1 16 Tf (KCL: currents entering a node equal currents leaving.) Tj 0 -30 Td (KVL: voltages around a loop sum to zero.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(content.length);
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(content);
}

/**
 * A real multi-page PDF, one page per slide (title + bullets, Helvetica, an accent bar). poppler renders and
 * extracts it like any deck. ASCII only: other characters become "-".
 */
export function textDeckPdf(slides: { title: string; bullets: string[] }[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "-");
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const stream = [
      "0.15 0.39 0.92 rg 0 586 960 14 re f",
      "0.06 0.09 0.16 rg",
      `BT /F1 34 Tf 60 500 Td (${esc(slide.title)}) Tj ET`,
      "0.2 0.25 0.33 rg",
      `BT /F2 22 Tf 72 430 Td ${slide.bullets.map((b, i) => `${i ? "0 -46 Td " : ""}(${esc(`-  ${b}`)}) Tj`).join(" ")} ET`,
      `0.4 0.45 0.55 rg BT /F2 14 Tf 900 30 Td (${index + 1}) Tj ET`,
    ].join("\n");
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contents = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 600] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contents} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let content = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, o] of objects.entries()) {
    offsets.push(content.length);
    content += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(content);
}
