import ExcelJS from "exceljs";
import { TStandardRow } from "@/lib/types";
import { readWorkbook, getFirstSheet, readHeadersFromRow1 } from "./read";

const dedupeByOrderKey = <T extends { channel: string; orderKey: string }>(
  rows: T[],
) => {
  const map = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.channel}:${r.orderKey}`;
    if (!map.has(key)) map.set(key, r);
  }
  return Array.from(map.values());
};

// ✅ ArrayBuffer로 강제 변환 (SharedArrayBuffer 대응)
const toArrayBuffer = (out: unknown): ArrayBuffer => {
  if (out instanceof ArrayBuffer) return out;

  if (
    typeof SharedArrayBuffer !== "undefined" &&
    out instanceof SharedArrayBuffer
  ) {
    const ab = new ArrayBuffer(out.byteLength);
    new Uint8Array(ab).set(new Uint8Array(out));
    return ab;
  }

  if (out instanceof Uint8Array) {
    const ab = new ArrayBuffer(out.byteLength);
    new Uint8Array(ab).set(out);
    return ab;
  }

  throw new Error("엑셀 버퍼 변환에 실패했어요.");
};

export const buildIntegrationWorkbook = async (
  templateArrayBuffer: ArrayBuffer,
  standardRows: TStandardRow[],
): Promise<ArrayBuffer> => {
  const wb = await readWorkbook(templateArrayBuffer);
  const ws = getFirstSheet(wb);

  const headers = readHeadersFromRow1(ws);
  const rows = dedupeByOrderKey(standardRows);
  const baseRow = ws.getRow(2);
  const rowHeight = baseRow.height;
  const cellStyles = headers.map((_, i) => ({ ...baseRow.getCell(i + 1).style }));

  // 서식만 있는 빈 행도 있으므로 기존 본문을 비우고 2행부터 씁니다.
  for (let r = 2; r <= ws.rowCount; r++) {
    ws.getRow(r).values = [];
  }

  rows.forEach((s, i) => {
    // 발송인 정보는 주문자 정보와 구분하며, 제공되지 않은 값은 비워 둡니다.
    const values: Record<string, ExcelJS.CellValue> = {
      기타1: "",
      보내는분성명: "",
      보내는분전화번호: "",
      보내는분우편번호: "",
      "보내는분주소(전체, 분할)": "",
      품목명: s.productName,
      박스수량: s.quantity,
      받는분성명: s.receiverName,
      받는분전화번호: s.receiverPhone,
      받는분우편번호: s.zipCode ?? "",
      "받는분주소(전체, 분할)": s.address,
      배송메세지1: s.message ?? "",
      고객주문번호: s.orderKey,
      운송장번호: "",
    };
    const row = ws.getRow(i + 2);
    row.height = rowHeight;

    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1);
      cell.style = { ...cellStyles[i] };
      cell.value = values[header] ?? "";
      // 전화번호·우편번호·긴 주문번호의 앞자리 0과 원문을 보존합니다.
      cell.numFmt = header === "박스수량" ? "0" : "@";
    });

    row.commit();
  });

  const out = await wb.xlsx.writeBuffer();
  return toArrayBuffer(out);
};
